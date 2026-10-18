// Run: npm run probe
// Answers one question: is this Gemini key on the free tier or a paid one?
//
// Method: the free tier caps Flash models at ~10 requests/minute. Paid does not.
// We send one tiny call to prove the key works, then a short burst and count
// 429s. Costs ~15 near-empty requests — fractions of a paisa on paid, and a
// rounding error against the free tier's 1,500/day.
//
// This does NOT read or transmit your key anywhere except to Google.

const key = process.env.GEMINI_API_KEY;
const model = process.env.BOT_MODEL || 'gemini-3.5-flash';
if (!key) {
  console.error('GEMINI_API_KEY not set in .env');
  process.exit(1);
}

const URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const ping = () =>
  fetch(URL, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      generationConfig: { maxOutputTokens: 1 },
    }),
  });

console.log(`model: ${model}\n`);

// --- 1. does the key work at all? -------------------------------------------
const first = await ping();
if (first.status === 400 || first.status === 403) {
  const body = await first.text();
  console.error(`Key rejected (${first.status}).`);
  console.error(body.slice(0, 400));
  console.error('\nCheck the key is correct and the Generative Language API is enabled.');
  process.exit(1);
}
if (first.status === 404) {
  console.error(`Model "${model}" not found for this key (404).`);
  console.error('Either the name is wrong or your project has no access to it.');
  console.error('Try BOT_MODEL=gemini-3-flash or gemini-2.5-flash.');
  process.exit(1);
}
if (first.status === 429) {
  console.log('RESULT: FREE TIER  (rate limited on the very first call)\n');
  reportFree();
  process.exit(0);
}
if (!first.ok) {
  console.error(`Unexpected ${first.status}: ${(await first.text()).slice(0, 300)}`);
  process.exit(1);
}
console.log('key works.\n');

// --- 2. burst past the free-tier ceiling ------------------------------------
const BURST = 14;
console.log(`sending ${BURST} requests in one burst (free tier allows ~10/min)...`);
const results = await Promise.all(Array.from({ length: BURST }, () => ping().then((r) => r.status)));
const limited = results.filter((s) => s === 429).length;
const ok = results.filter((s) => s === 200).length;
console.log(`  ${ok} succeeded, ${limited} rate-limited (429)\n`);

if (limited > 0) {
  console.log('RESULT: FREE TIER\n');
  reportFree();
} else {
  console.log('RESULT: PAID TIER — good, this is what the bot should run on.\n');
  console.log('Paid tier does not use your inputs or outputs to improve Google models,');
  console.log('and will not throttle during a Saturday enquiry burst.');
}

function reportFree() {
  console.log('Two reasons this matters for picnic-bot:\n');
  console.log('1. DATA. Free-tier inputs and outputs may be used to improve Google models.');
  console.log('   This bot handles customer names, phone numbers, event dates and the fact');
  console.log('   that a named person is planning a proposal. That should not go into a');
  console.log('   training pipeline.\n');
  console.log('2. THROTTLING. 10 RPM. One customer turn is 1-3 API calls once the tool loop');
  console.log('   runs. Sat 5 Sep had 31 enquiries; four or five at once exceeds the cap, so');
  console.log('   the bot goes slow exactly when it is busy — which is the whole point of it.\n');
  console.log('FIX: link billing to the Cloud project behind this key, or make a key in a');
  console.log('project that already has billing. Cost at your volume is Rs ~1,600/month,');
  console.log('about one sixth of one picnic booking.');
  console.log('  https://aistudio.google.com/apikey');
}
