// The guardrail. A draft reply may only contain money figures that came back
// from a tool call on this turn. Fails closed: anything unexplained escalates.
//
// Rule: a "money number" is either prefixed with Rs/INR/the rupee sign, or is a
// bare integer >= 1000. Guest counts, hours and similar small numbers are
// exempt; dates, times, years and phone numbers are stripped before checking.

const STRIP = [
  /\+?\d{1,3}[\s-]?\d{5}[\s-]?\d{5}/g,        // +91 99999 99999
  /\b\d{10}\b/g,                                // bare 10-digit phone
  /\b\d{4}-\d{2}-\d{2}\b/g,                     // 2026-10-12
  /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g,     // 12/10/2026
  /\b\d{1,2}:\d{2}\s?(?:am|pm)?\b/gi,           // 17:30, 5:30 pm
  /\b\d{1,2}\s?(?:am|pm)\b/gi,                  // 5 pm
  /\b(?:19|20)\d{2}\b/g,                        // bare year
];

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
STRIP.push(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\w*`, 'gi'));
STRIP.push(new RegExp(`\\b(?:${MONTHS})\\w*\\s+\\d{1,2}(?:st|nd|rd|th)?`, 'gi'));

const toNum = (s) => Number(String(s).replace(/[,\s]/g, ''));

export function findMoney(text) {
  let t = String(text);
  for (const re of STRIP) t = t.replace(re, ' ');
  const found = new Set();

  // Currency-prefixed, Indian or plain grouping.
  // Two traps, both hit in production prose:
  //  - `Rs` needs a word boundary, else it matches the "rs" inside "flowers"
  //    and similar, and then happily reads the next comma as the amount.
  //  - the amount must START with a digit; `[\d,]+` alone matches a bare ","
  //    and Number(",".replace(/,/g,'')) is Number('') === 0, so every such
  //    reply escalated with a phantom "unverified figure: 0".
  for (const m of t.matchAll(/(?:₹|\bRs\.?|\bINR\b)\s?(\d[\d,]*(?:\.\d+)?)/gi)) {
    const n = toNum(m[1]);
    if (Number.isFinite(n)) found.add(n);
  }
  // bare integers >= 1000
  for (const m of t.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)) {
    const n = toNum(m[0]);
    if (Number.isFinite(n) && n >= 1000) found.add(n);
  }
  return [...found];
}

/**
 * @param {string} draft        reply the model wants to send
 * @param {number[]} allowed    every number returned by tools this turn
 * @param {string} [customerText] customer's own message; figures they quoted may be echoed
 * @returns {{ok:boolean, violations:number[], found:number[]}}
 */
// Availability is the third thing the bot must never originate, alongside
// money and links. Saying a date or slot is free — or taken — when
// booked_slots was never called is how a double booking starts.
//
// Scoped deliberately narrowly: an availability WORD alone is not enough
// ("The Prelude is available at Beige Cafe" is about the package, not a
// date). The sentence must also carry a date or a slot for it to count as a
// claim about when. Over-blocking here would silence legitimate replies,
// which is its own failure.
const AVAIL_WORD = /\b(available|unavailable|free|open|booked|taken|no longer|fully booked)\b/i;
const WHEN_TOKEN = new RegExp(
  '\\b(' +
  'morning|afternoon|evening|slot|slots|' +
  'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec' +
  ')\\b|\\b\\d{1,2}(st|nd|rd|th)?\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b',
  'i'
);

/** Sentences that assert whether a date/slot is free or taken. */
export function findAvailabilityClaims(text) {
  return String(text || '')
    .split(/(?<=[.!?\n])\s+/)
    .map((x) => x.trim())
    .filter((sentence) => AVAIL_WORD.test(sentence) && WHEN_TOKEN.test(sentence));
}

/** Every http(s) link in a piece of text. */
export function findUrls(text) {
  return String(text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
}

/**
 * @param {string} draft         the model's proposed reply
 * @param {number[]} allowed     figures returned by tools this turn
 * @param {string} customerText  the customer's own last message
 * @param {string[]} allowedUrls links returned by the references tool this turn
 */
export function verify(draft, allowed, customerText = '', allowedUrls = [], availabilityChecked = true) {
  const ok = new Set((allowed || []).map(Number).filter(Number.isFinite));
  for (const n of findMoney(customerText)) ok.add(n);
  const found = findMoney(draft);
  const violations = found.filter((n) => !ok.has(n));

  // Same rule as money, applied to links: a URL the model typed itself is as
  // bad as a price it invented — a dead or wrong link reads as broken to the
  // customer. Trailing punctuation is stripped so "…webp." still matches.
  const okUrls = new Set(allowedUrls || []);
  const foundUrls = findUrls(draft).map((u) => u.replace(/[.,;:]+$/, ''));
  const urlViolations = foundUrls.filter((u) => !okUrls.has(u));

  // Only meaningful when the tool was NOT called this turn; if it was, the
  // model has real data and may say whatever that data supports.
  const availabilityViolations = availabilityChecked ? [] : findAvailabilityClaims(draft);

  return {
    ok: violations.length === 0 && urlViolations.length === 0 && availabilityViolations.length === 0,
    violations,
    found,
    urlViolations,
    foundUrls,
    availabilityViolations,
  };
}

// ---- self-test -------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  const cases = [
    ['The Setting at Beige Cafe is ₹8,900 for 6 guests.', [8900], '', true],
    ['The Setting at Beige Cafe is ₹8,900.', [12900], '', false],
    ['Sure — 6 guests on 12 Oct, 5:30 PM works.', [], '', true],
    ['Total ₹8,900, advance ₹2,670 to confirm.', [8900, 2670], '', true],
    ['It comes to around 10000 all in.', [8900], '', false],
    ['Booked for 2026-10-12 at 17:30.', [], '', true],
    ['You mentioned a budget of ₹12,000 — The Moment is ₹12,900.', [12900], 'budget is 12000', true],
    ['Call me on +91 99901 17333', [], '', true],
    ['We can do ₹1,84,914 for the lot.', [184914], '', true],
    ['We can do ₹1,84,914 for the lot.', [8900], '', false],
  ];
  // URL guard: [draft, allowed, customerText, want, allowedUrls]
  const IMG = 'https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/package-images/a.webp';
  const OTHER = 'https://instagram.com/reel/xyz';
  cases.push(
    // prose that used to trip the `Rs`-inside-a-word / bare-comma bug
    ['Fresh fruits and flowers, wax candles, and host support.', [], '', true, []],
    ['Photo Printouts(10 Colored Photos), a bouquet, cake and skyshots.', [], '', true, []],
    ['Includes a photographer, cold pyros, and cutlery & essentials.', [], '', true, []],
    ['It is Rs 8,900 all in.', [8900], '', true, []],
    ['It is Rs 8,900 all in.', [12900], '', false, []],
    [`Here you go: ${IMG}`, [], '', true, [IMG]],
    [`Here you go: ${IMG}`, [], '', false, []],
    [`Have a look: ${OTHER}`, [], '', false, [IMG]],
    [`Here it is: ${IMG}.`, [], '', true, [IMG]],
    ['No links at all in this one.', [], '', true, []],
  );
  // availability guard: [draft, allowed, cust, want, urls, availabilityChecked]
  cases.push(
    ['23rd September is available.', [], '', false, [], false],
    ['For 2nd October, our evening slot is already booked.', [], '', false, [], false],
    ['We have the morning and afternoon slots open.', [], '', false, [], false],
    ['23rd September is available.', [], '', true, [], true],
    ['The Prelude is available at Beige Cafe.', [], '', true, [], false],
    ['Which date did you have in mind?', [], '', true, [], false],
  );

  let pass = 0;
  cases.forEach(([draft, allowed, cust, want, urls, availChecked], i) => {
    const r = verify(draft, allowed, cust, urls || [], availChecked !== false);
    const good = r.ok === want;
    if (good) pass++;
    console.log(`${good ? 'PASS' : 'FAIL'}  case ${i + 1}  ok=${r.ok} want=${want}` +
      (good ? '' : `  found=[${r.found}] violations=[${r.violations}]`));
  });
  console.log(`\n${pass}/${cases.length} passed`);
  process.exit(pass === cases.length ? 0 : 1);
}
