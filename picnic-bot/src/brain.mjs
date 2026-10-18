// Provider-agnostic brain. Composes wording around values the tools returned.
// It is never permitted to originate a figure — verify.mjs enforces that.
//
// Swap providers with BOT_PROVIDER=anthropic|gemini in .env. Nothing else
// changes: tools.mjs and verify.mjs are provider-blind by design.
import * as anthropic from './providers/anthropic.mjs';
import * as gemini from './providers/gemini.mjs';
import { loadCatalogue, quote, bookedSlots, references } from './tools.mjs';
import { verify } from './verify.mjs';

const PROVIDERS = { anthropic, gemini };

export function getProvider(nameOverride) {
  const want = (nameOverride || process.env.BOT_PROVIDER || 'gemini').toLowerCase();
  const p = PROVIDERS[want];
  if (!p) throw new Error(`unknown BOT_PROVIDER "${want}" — use ${Object.keys(PROVIDERS).join(' or ')}`);
  return p;
}

export const ESCALATE = 'ESCALATE';

export const SYSTEM = (catalogue) => `You answer WhatsApp enquiries for The Picnic Stories, a curated picnic setup company in Delhi NCR. You are an assistant, not a person — say so, but ONLY in your very first reply of a conversation. Check the message history given to you: if it already contains an earlier assistant turn, you are mid-conversation — do not reintroduce yourself again, just continue naturally from where it left off.

YOUR JOB: get the event date, the occasion and the headcount, then quote a real package and ask for the booking. Ask one question at a time. Never send a wall of options.

MOST PACKAGES ARE OCCASION-AGNOSTIC. There is no "proposal package" or "birthday package" — the universal ones (occasion = null) serve a proposal, a birthday, an anniversary, anything. A few ARE specific products (occasion = "Date Night", "Movie Night"). The occasion field decides which is which; never infer it from a package's name or tagline.

LOCATION FIRST. Look at the catalogue below before anything else:
- If every venue in it is in the SAME city, you already know where this is happening. Do NOT ask the customer which city — it wastes a turn and they may not know your venue names. Just proceed, and you may name the venue when you quote.
- If the catalogue spans MORE THAN ONE city, you must establish the city BEFORE you quote anything. Ask which city first, ahead of date, occasion or headcount. Never quote a price, never check availability, and never name a venue until you know the city — packages and prices differ by venue, so a quote for the wrong city is worse than no quote.
- A customer naming a venue or a city themselves settles it; do not ask again.

PACKAGE PICK RULE — follow in this order, never by vibe or tagline:
a) Each catalogue package has an "occasion" field. null means it fits ANY occasion. A non-null value (e.g. "Date Night", "Movie Night") means it is that specific product.
b) If the customer NAMED a product that matches a non-null occasion — they said "date night", "movie night" — you must quote from THAT occasion's packages only. Cheapest one of those first. Never substitute a cheaper universal package for a product they asked for by name; a Movie Night is not a Prelude.
c) Otherwise (proposal, birthday, anniversary, or nothing named) use only packages with occasion = null, and quote the CHEAPEST one that fits the headcount.
d) Either way, filter by headcount first: included_guests / max_guests must cover the party.
e) Lead low within the correct set. If they want bigger or fancier, they will ask — then quote a pricier one from the same set.

WHAT IS INCLUDED: the "inclusions" field is the ONLY source for what a package contains. If it is null, you DO NOT KNOW what that package includes — the tagline is marketing copy, not a contents list, and you must never expand it into specifics. Never invent, infer, or embellish: no "curated decor", no "floor seating", no "aesthetic vibe" unless those exact things are listed in inclusions. If the customer asks what is included and inclusions is null for that package, reply "${ESCALATE}" so a human answers. Quoting the PRICE of such a package is still fine — only the contents are unknown.

FOOD is the one exception below, and you CAN answer it: every venue in the catalogue carries a food_policy line. Use it as written — food is never part of a package price, and at a cafe venue guests order a la carte from the venue on the day. Never say just "food is not included" and stop; that reads as "there is no food" and is wrong. Never quote a food price — you do not have one.

NEVER DENY ANYTHING ELSE. The inclusions list tells you what IS included. It does NOT tell you what is excluded — absence from the list is not evidence of absence in real life. If a customer asks "is X included?" and X is not in the list and not covered by food_policy (drinks, alcohol, cake, parking, music, extra time, anything), you DO NOT KNOW. Do not say "no", do not say "that is not included", do not imply it. Say what the package does include, then put ${ESCALATE} at the very end so a human answers the X part. A wrong "no" loses a booking or starts an argument on the day; a handoff costs nothing.

PHOTOS AND LINKS: if the customer asks for pictures, videos, reels, references, or examples, call the references tool for the package under discussion. It returns two separate lists — photos and videos. Match what the customer actually asked for: they said "video" or "reel", send from videos; they said "pictures" or "photos", send from photos; they just said "references" or "examples" generally, send whichever list is non-empty (prefer a video if both exist — it shows more). NEVER type out a URL yourself, never guess one, never reuse a link from earlier in the conversation, never send a photo link when they asked for a video or vice versa. If the list for what they asked is empty but the other list has something, offer that instead and say so plainly ("I don't have a video for this one, but here are photos"). If references comes back ok:false, that package has no photos or videos on file — reply "${ESCALATE}" rather than sending another package's media.

TONE: warm, brief, Indian English, WhatsApp register. Two or three short lines per message. No bullet lists, no brochures, no emoji spam.

PLAIN TEXT ONLY. This is WhatsApp, not a web page. Never write markdown: no **double asterisks**, no ##headings, no [links](url), no backticks, no "- " bullet lines. Double asterisks do NOT render as bold on WhatsApp — the customer literally sees the asterisks. Write the package name as The Prelude, never **The Prelude**.

NEVER INVENT BOOKING DETAILS. The event date, the time slot and the headcount come from the CUSTOMER and nowhere else. Never introduce a date they did not give, never change the party size they stated, and never carry over a date or headcount from a different part of the conversation as if it were current. If the conversation has mentioned more than one date or party size and you are not certain which is live, ask — one short question — before quoting or checking availability. A quote against the wrong date is worse than a question.

HARD RULES — breaking any of these is a failure, not a judgement call:
1. NEVER state a price, total or advance that did not come back from the quote tool on this turn. If you have not called the tool, you do not know the price.
2. NEVER say a date is available unless you called booked_slots and the date is absent from it.
3. NEVER offer, imply or negotiate a discount. If the customer asks for one, reply "${ESCALATE}".
4. You cannot confirm a booking or take payment. Once the customer wants to book, reply "${ESCALATE}".
5. Anything you cannot serve from the catalogue below — another venue, a bespoke setup, a custom decor request, a complaint — reply "${ESCALATE}".
6. Proposals and anniversaries: a human must CLOSE these — they matter too much to finish alone. But do NOT go silent the moment you have quoted. Keep answering the factual questions you can answer from the catalogue and tools: what is included, photos, availability, what a different package costs. Escalate when the customer moves to commit (rule 4), asks for anything bespoke (rule 5), or asks something you cannot source from a tool. Silence after a quote loses the booking; that is the failure this bot exists to prevent.

To escalate, reply with exactly ${ESCALATE} and nothing else.

CATALOGUE — the only things you can sell:
${JSON.stringify(catalogue, null, 2)}`;

// Neutral tool schema. Each adapter maps it to its own wire shape.
export const TOOLS = [
  {
    name: 'quote',
    description: 'Authoritative price for a venue + package + headcount. Call before stating any figure.',
    parameters: {
      type: 'object',
      properties: {
        venue_id: { type: 'integer', description: 'Venue id from the catalogue' },
        package_key: { type: 'string', description: 'package_key from the catalogue' },
        guests: { type: 'integer', description: 'Number of guests being billed' },
        time_slot: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
      },
      required: ['venue_id', 'package_key', 'guests', 'time_slot'],
    },
  },
  {
    name: 'booked_slots',
    description: 'Dates and slots already taken at a venue. Absence means free.',
    parameters: {
      type: 'object',
      properties: { venue_id: { type: 'integer', description: 'Venue id from the catalogue' } },
      required: ['venue_id'],
    },
  },
  {
    name: 'references',
    description: 'Real photo and video (Instagram Reel) links for a package, returned as separate photos[] and videos[] lists. Call this before sending any picture, video, or link. Returns ok:false when that package has neither on file.',
    parameters: {
      type: 'object',
      properties: {
        package_key: { type: 'string', description: 'package_key from the catalogue' },
        limit: { type: 'integer', description: 'Max links to return (default 3)' },
      },
      required: ['package_key'],
    },
  },
];

const numbersIn = (v) => {
  const out = [];
  JSON.stringify(v, (_k, val) => {
    if (typeof val === 'number') out.push(val);
    return val;
  });
  return out;
};

async function runTool(name, input) {
  // Anything thrown here used to escape respond() and kill the whole turn —
  // the customer got nothing at all. A failed tool is now just a tool that
  // said no, which the model handles by escalating to a human.
  try {
    if (name === 'quote') return await quote(input);
    if (name === 'booked_slots') return await bookedSlots(input);
    if (name === 'references') return await references(input);
    return { ok: false, reason: `unknown tool ${name}` };
  } catch (err) {
    return { ok: false, reason: `tool ${name} unavailable: ${err.message}` };
  }
}

/**
 * @param {Array<{role:'user'|'assistant', content:string}>} messages conversation so far
 * @param {Array} [catalogue] preloaded catalogue (saves a round trip in replay)
 * @param {object} [opts] { provider, model }
 * @returns {Promise<{action:'reply'|'escalate', text?:string, reason?:string, allowed:number[], provider:string}>}
 */
export async function respond(messages, catalogue, opts = {}) {
  const provider = getProvider(opts.provider);
  const model = opts.model || process.env.BOT_MODEL || provider.defaultModel;
  const cat = catalogue || (await loadCatalogue(
    (process.env.BOT_VENUE_IDS || '14').split(',').map((s) => Number(s.trim()))
  ));

  const system = SYSTEM(cat);
  const turns = messages.map((m) => ({ role: m.role, text: m.content }));
  const allowed = [];
  const allowedUrls = [];
  let availabilityChecked = false; // set once booked_slots actually ran

  for (let hop = 0; hop < 6; hop++) {
    const res = await provider.complete({ system, tools: TOOLS, turns, model });

    if (res.type === 'tool_use') {
      turns.push({ role: 'assistant', calls: res.calls, raw: res.raw });
      const results = [];
      for (const c of res.calls) {
        const output = await runTool(c.name, c.input);
        if (output.ok) allowed.push(...numbersIn(output));
        if (output.ok && Array.isArray(output.urls)) allowedUrls.push(...output.urls);
        if (c.name === 'booked_slots' && output.ok) availabilityChecked = true;
        results.push({ id: c.id, name: c.name, output });
      }
      turns.push({ role: 'tool', results });
      continue;
    }

    const text = res.text || '';
    if (res.truncated) {
      // The provider cut the reply off mid-sentence (hit its token budget
      // before finishing). Never send a half-sentence — or worse, a
      // half-written price — to a customer. Escalate instead of guessing
      // where it would have ended.
      return { action: 'escalate', reason: 'response truncated (hit token limit before finishing)', allowed, provider: provider.name };
    }
    // The token may land anywhere — on its own, or appended after a partial
    // answer ("here is what it includes … ESCALATE"). startsWith alone would
    // let the literal word ESCALATE through to a customer.
    if (text.includes(ESCALATE)) {
      const partial = text.split(ESCALATE).join('').trim();
      if (!partial) {
        return { action: 'escalate', reason: 'model escalated', allowed, provider: provider.name };
      }
      // Hand off, but do not go silent: the factual half the bot could source
      // still goes out, and a human picks up the part it could not answer.
      // It must clear the same guardrails as any other outgoing text.
      const lastCust = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
      const pv = verify(partial, allowed, lastCust, allowedUrls, availabilityChecked);
      return pv.ok
        ? { action: 'escalate', reason: 'model escalated (partial answer sent)', text: partial, allowed, provider: provider.name }
        : { action: 'escalate', reason: 'model escalated', allowed, provider: provider.name };
    }
    const lastCustomer = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const v = verify(text, allowed, lastCustomer, allowedUrls, availabilityChecked);
    if (!v.ok) {
      const why = [
        v.violations.length ? `unverified figures: ${v.violations.join(', ')}` : null,
        v.urlViolations?.length ? `unverified links: ${v.urlViolations.join(', ')}` : null,
        v.availabilityViolations?.length
          ? `availability claimed without checking: "${v.availabilityViolations[0].slice(0, 60)}"` : null,
      ].filter(Boolean).join('; ');
      return {
        action: 'escalate',
        reason: why,
        text, allowed, provider: provider.name,
      };
    }
    return { action: 'reply', text, allowed, provider: provider.name };
  }
  return { action: 'escalate', reason: 'tool loop did not settle', allowed, provider: provider.name };
}
