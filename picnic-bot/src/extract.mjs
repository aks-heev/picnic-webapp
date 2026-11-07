// Booking extractor. Reads a whole WhatsApp thread (staff + customer) and
// returns the booking as structured fields, or says there is no booking.
//
// Different job from brain.mjs: brain TALKS to customers with tools; this
// only READS a finished or in-progress thread and fills a form. Output is a
// DRAFT for staff to approve — it never writes to the database itself.
//
// Rules learned from real threads (27 Oct 2026 sample, 24 chats):
//  - Details change after payment ("date is 5th, not 4th"). Always take the
//    LATEST value stated in the thread, not the first.
//  - "Asked for an advance" is not "booked". Many threads stop there.
//  - Package is often only implied ("the setting and photo printouts").
//  - The add-on price list staff send is a MENU, not a selection.
//  - Payment screenshots arrive as [media]; the model cannot see them, so it
//    reports payment as "claimed", never "verified".

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- catalogue (live, anon key; packages/add_ons/venues are anon-readable)

export async function loadExtractCatalogue() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY required');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (path) => {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`catalogue ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  const [packages, addOns, venues] = await Promise.all([
    get('packages?select=name&is_active=eq.true&order=sort_order'),
    get('add_ons?select=name&is_active=eq.true&order=sort_order'),
    get('venues?select=name&order=name'),
  ]);
  const pkgNames = packages.map((p) => p.name).filter(Boolean);
  return {
    packages: pkgNames,
    // package tiers are also stored as add_ons rows; never offer them as add-ons
    // the board is captured as board_message, so it is never an add-on here
    addOns: [...new Set(addOns.map((a) => a.name))].filter((n) => !pkgNames.includes(n) && n !== 'White Board Message'),
    venues: [...new Set(venues.map((v) => v.name).filter(Boolean))],
  };
}

// ---------- prompt

const TEMPLATE_NOTE = {
  T1: 'automated brochure-link message',
  T2: 'automated 4-question intake form',
  T3: 'automated 4-question intake form',
  T4: 'add-on PRICE LIST sent by staff (a menu, not a selection)',
};

// WhatsApp call events come through as bracketed system lines, e.g.
// "[Voice call Accepted on another device 19:26]", "[Missed voice call Click to call back 16:59]".
// Deals are often settled on these calls, so they are first-class events here.
const CALL_RE = /^\[(missed )?(voice|video) call|^\[(voice|video) call/i;
export function callKind(text) {
  if (!CALL_RE.test(text)) return null;
  return /missed|declined|no answer/i.test(text) ? 'missed' : 'connected';
}

export function threadToText(chat) {
  return chat.messages.map((m) => {
    const kind = callKind(m.text);
    if (kind) return `[${m.ts || 'no time'}] PHONE CALL (${kind}) ${m.text.match(/\d{1,2}:\d{2}/)?.[0] || ''}`.trim();
    const who = m.dir === 'STAFF' ? 'STAFF' : 'CUSTOMER';
    let t = m.text;
    const tm = t.match(/^\[(T\d)\]$/);
    if (tm) t = `[${TEMPLATE_NOTE[tm[1]] || 'template'}]`;
    return `[${m.ts || 'no time'}] ${who}: ${t.replace(/ ⏎ /g, ' / ')}`;
  }).join('\n');
}

function systemPrompt(cat, today) {
  return `You extract picnic bookings from WhatsApp threads for The Picnic Stories (Delhi NCR). Today is ${today}.

You get one full thread between STAFF and a CUSTOMER. Decide whether a booking was confirmed, and if so fill in its details.

DECISION (pick exactly one):
- "booking_confirmed": the customer paid or clearly committed AFTER staff asked for the advance. Signals: customer sends [media] (usually the payment screenshot) or says they paid, right after an advance request; staff then says the confirmation mail/ticket was sent, or asks for board message/photos/cake flavour as next steps of a done deal.
- "advance_requested_unpaid": staff asked for the advance but there is no sign it was paid.
- "not_booking": the customer declined, postponed without a date ("not this week"), or only enquired.
- "unclear": signals conflict.
A website message "I'd like to confirm my picnic booking ... Booking ref #PS-..." is a REQUEST, not a confirmed booking, unless payment follows.

VENUES (how people refer to them in chat):
- "Beige Cafe": the Gurgaon venue. Also called Leopard Trail, Garat Pur Bas, the Gurgaon/Gurugram venue, or the one with the Aravalli hills backdrop.
- "The Sunroom": the Delhi venue in Palam Vihar ("Sunroom cafe", "the Delhi venue").
- "Countryside Offgrid": the off-grid stay with cottages ("countryside", "small/big cottage").
- "Your Own Space": the setup is at the customer's own home, terrace or venue.
Staff often mention a second venue only as an alternative or for comparison. Use the venue the booking ended up at, not the last venue name mentioned.

PHONE CALLS:
Lines "PHONE CALL (connected)" mark WhatsApp calls between staff and customer. Many calls happen on a normal phone line instead and leave no such line, so ALSO treat as a call any message that asks for or refers to a call: "please call me", "call me at 98...", "can we connect on a call", "I'll call you", "as discussed", "as we spoke", "call kar lo", "baat ho gayi", or a phone number shared so staff can ring. Deals are often finalised on these calls, and what was agreed is NOT in the chat. For every field you fill, check whether a call (connected WhatsApp call, or a call request/reference that staff agreed to) happened after the last message that stated that field's value. If so, the value may have changed on the call: add the field name to call_changed_fields. Missed calls that were never returned do not count. Field names to use: date, slot, guests, package, venue, addons, board_message, total_quoted.

WRITTEN RECAP:
If STAFF sends a summary of the booking (e.g. "Confirmed: 1 Nov, 5-8 pm, Beige Cafe, The Story, 2 guests, Rs 24,900") and the customer does not dispute it, that recap is the final word: take every field it states from it, and those fields are not call_changed.

FIELD RULES:
- Take the LATEST value in the thread. Customers correct dates, slots and guest counts after paying.
- date: YYYY-MM-DD. Resolve "4th November" against the message timestamps (day/month/year). Never guess a year earlier than the message date.
- slot_start / slot_end: 24h "HH:MM". "5pm to 7:30pm" -> 17:00 / 19:30. If only "evening" is said, leave both null and put "evening" in slot_label.
- guests: total people. "couple", "for 2", "for two of us" -> 2. If nothing in the thread states or clearly implies a number, null. Do not assume 2 from the occasion alone.
- package: exactly one of ${JSON.stringify(cat.packages)} or null. Staff often say "The setting" / "prelude" in lower case; map it. If only implied, choose it only when the thread makes it unambiguous.
- addons: ONLY extras the customer chose ON TOP of the package, using these exact names: ${JSON.stringify(cat.addOns)}. Items that are part of a package's inclusions are not add-ons. The add-on price list staff send is a menu: do not copy it. Items mentioned as "not available" are not add-ons.
- venue: the venue name as used in the thread, mapped to one of ${JSON.stringify(cat.venues)} when it clearly matches, else the thread's wording, else null.
- board_message: the exact text for the welcome board, without the label ("Board message-"). Keep the customer's capitalisation.
- total_quoted: the booking total staff last STATED as a total ("Total 8000", "for couple 13900"). advance_requested: the advance staff last asked for. "4k" -> 4000, "2.9k" -> 2900. Never add up prices yourself: if no total was stated, null. Pricing is computed later by the system from package, venue and add-ons.
- payment: "claimed" if the customer sent [media] or said they paid after the advance request, else "none". Never say verified: you cannot see images.
- email: the customer's email if given.
- Use null, never an empty string, for anything not stated. Do not invent.

Also return:
- evidence: up to 3 short quotes (under 15 words each, with their timestamps) that decided the decision.
- unsure_fields: field names you filled but are not sure about.
- missing_fields: fields a booking needs that the thread never states (date, slot, guests, package, venue, board_message, email).`;
}

const S = (type, extra = {}) => ({ type, ...extra });
const nullable = (type, extra = {}) => ({ type, nullable: true, ...extra });

const SCHEMA = S('OBJECT', {
  properties: {
    decision: S('STRING', { enum: ['booking_confirmed', 'advance_requested_unpaid', 'not_booking', 'unclear'] }),
    customer_name: nullable('STRING'),
    email: nullable('STRING'),
    date: nullable('STRING'),
    slot_label: nullable('STRING'),
    slot_start: nullable('STRING'),
    slot_end: nullable('STRING'),
    guests: nullable('INTEGER'),
    occasion: nullable('STRING'),
    package: nullable('STRING'),
    venue: nullable('STRING'),
    addons: S('ARRAY', { items: S('STRING') }),
    board_message: nullable('STRING'),
    special_requests: nullable('STRING'),
    total_quoted: nullable('NUMBER'),
    advance_requested: nullable('NUMBER'),
    payment: S('STRING', { enum: ['claimed', 'none'] }),
    evidence: S('ARRAY', { items: S('STRING') }),
    unsure_fields: S('ARRAY', { items: S('STRING') }),
    missing_fields: S('ARRAY', { items: S('STRING') }),
    call_changed_fields: S('ARRAY', { items: S('STRING') }),
  },
  required: ['decision', 'addons', 'payment', 'evidence', 'unsure_fields', 'missing_fields', 'call_changed_fields'],
});

// ---------- call

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function post(url, body, key, attempts = 6) {
  let wait = 1500;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(120000),
    });
    if (!RETRYABLE.has(res.status) || i === attempts - 1) return res;
    const hdr = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(hdr) && hdr > 0 ? hdr * 1000 : wait);
    wait = Math.min(wait * 2, 30000);
  }
}

export async function extractBooking(chat, cat, { model, today } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const m = model || process.env.BOT_MODEL || 'gemini-3.5-flash';
  const day = today || new Date().toISOString().slice(0, 10);

  const res = await post(`${BASE}/${m}:generateContent`, JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt(cat, day) }] },
    contents: [{ role: 'user', parts: [{ text: `THREAD:\n${threadToText(chat)}` }] }],
    generationConfig: {
      temperature: 0,
      // thinking model: this budget is shared with hidden reasoning tokens
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
    },
  }), key);

  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const body = await res.json();
  const cand = body?.candidates?.[0];
  if (cand?.finishReason === 'MAX_TOKENS') throw new Error('gemini cut the answer off (MAX_TOKENS)');
  const text = (cand?.content?.parts || []).filter((p) => typeof p.text === 'string').map((p) => p.text).join('');
  try {
    return { model: m, usage: body?.usageMetadata, result: JSON.parse(text) };
  } catch {
    throw new Error(`gemini returned non-JSON: ${text.slice(0, 300)}`);
  }
}
