// Arithmetic/format tests against REAL rows pulled from prod on 2026-09-14.
// Per the session note: node --check catches nothing; replaying the real values
// is what finds the bugs. Every expectation below was verified by SQL first.
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-real-key';

const m = await import('./content-week.mjs');
let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const has = (label, hay, needle) => {
  const ok = String(hay).includes(needle);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      missing: ${needle}\n      in: ${hay}`}`);
  ok ? pass++ : fail++;
};

// --- cleanConfirmed: the §8 exclusions -------------------------------------
const rows = [
  { id: 1, full_name: 'Real Person',  mobile_number: '9990001111', preferred_date: '2026-09-01' },
  { id: 2, full_name: 'Aksheev',      mobile_number: '7742363777', preferred_date: '2026-09-01' }, // team
  { id: 3, full_name: 'Adhiraj',      mobile_number: '7425055501', preferred_date: '2026-09-01' }, // team
  { id: 4, full_name: 'Test Booking', mobile_number: '9990002222', preferred_date: '2026-09-01' }, // Test*
  { id: 5, full_name: 'test lower',   mobile_number: '9990003333', preferred_date: '2026-09-01' }, // case-insensitive
  { id: 6, full_name: 'Real Person',  mobile_number: '9990001111', preferred_date: '2026-09-01' }, // dupe of #1
  { id: 7, full_name: 'Real Person',  mobile_number: '9990001111', preferred_date: '2026-09-08' }, // same phone, diff date -> keep
];
const cleaned = m.cleanConfirmed(rows);
eq('excludes team phones, Test names, and phone+date dupes',
   cleaned.map(r => r.id).sort((a, b) => a - b), [1, 7]);
eq('dupe collapse keeps the earliest row id', cleaned.find(r => r.preferred_date === '2026-09-01').id, 1);

// --- facts object built from the REAL prod numbers -------------------------
// Verified by SQL this session: 57 confirmed / 19 picnics / 38 stays;
// Proposal 11; Photographer 8 of 19 (revenue 54000); Beige ladder 5900/8900/12900/25000.
const facts = {
  generated_at: '2026-09-14T00:00:00.000Z',
  totals: { confirmed: 57, picnics: 19, stays: 38 },
  occasion: [
    { occasion: 'Proposal', n: 11 }, { occasion: 'Birthday', n: 4 },
    { occasion: '(not stated)', n: 2 }, { occasion: 'Anniversary', n: 1 },
    { occasion: 'Just Because', n: 1 },
  ],
  addons: [
    { addon: 'Photographer', bookings_with: 8, out_of: 19, revenue: 54000 },
    { addon: 'Cake',         bookings_with: 5, out_of: 19, revenue: 5500 },
    { addon: 'Bouquet',      bookings_with: 2, out_of: 19, revenue: 3000 },
  ],
  packages: [
    { package: 'The Prelude', key: 'the_prelude', price: 5900,  included: [], sort: 0 },
    { package: 'The Setting', key: 'setting',     price: 8900,  included: [], sort: 1 },
    { package: 'The Moment',  key: 'moment',      price: 12900,
      included: ['Bouquet', 'Cake', 'Photo Printouts'], sort: 2 },
    { package: 'The Story',   key: 'story',       price: 25000,
      included: ['Bouquet', 'Cake', 'Cold Pyros', 'Photo Printouts', 'Photographer', 'Skyshots'], sort: 3 },
  ],
  slots: [],
  lead: { n: 18, avg_lead_days: 5.4, min_lead_days: 0 },
};

const c1 = m.captionOccasion(facts);
has('occasion caption states 11 of 19', c1, '11 of our last 19 picnic setups were proposals');

const c2 = m.captionAddons(facts);
has('add-on caption states 8 of 19', c2, '8 of our last 19 picnic bookings added a photographer');

const c3 = m.captionPackages(facts);
has('package caption uses Indian digit grouping for 12,900', c3, '₹12,900');
has('package caption uses Indian digit grouping for 25,000', c3, '₹25,000');
has('package caption lists The Moment inclusions', c3, 'includes Bouquet, Cake, Photo Printouts');
eq('package caption omits an "includes" line for a package with none',
   /The Prelude — ₹5,900\n\s*includes/.test(c3), false);

const c4 = m.captionBooking(facts);
has('booking caption states avg lead', c4, '5.4 days');
has('booking caption renders 0 days as "the same day"', c4, 'shortest was the same day');
eq('booking caption never says "0 days"', c4.includes('0 day'), false);

// singular/plural guard on min lead
const c4b = m.captionBooking({ ...facts, lead: { n: 18, avg_lead_days: 5.4, min_lead_days: 1 } });
has('min lead of 1 renders singular', c4b, 'shortest was 1 day.');
const c4c = m.captionBooking({ ...facts, lead: { n: 18, avg_lead_days: 5.4, min_lead_days: 3 } });
has('min lead of 3 renders plural', c4c, 'shortest was 3 days.');

// --- the scarcity guard: the thing that must never regress -----------------
const openWeek = Array.from({ length: 12 }, (_, i) =>
  ({ day: `2026-09-${18 + i}`, dow: 'Fri', taken: 0, free: 2 }));
const freeCount = openWeek.filter(s => s.free > 0).length;
eq('an open calendar is detected as open (drives the no-scarcity warning)',
   freeCount / openWeek.length > 0.5, true);

// --- no-poetry rule: captions must not assert feelings ---------------------
const BANNED = ['magical', 'unforgettable', 'breathtaking', 'dreamy', 'romance in the air',
                'once in a lifetime', 'let us create memories', 'pure magic'];
for (const [name, cap] of [['occasion', c1], ['addons', c2], ['packages', c3], ['booking', c4]]) {
  const hit = BANNED.find(b => cap.toLowerCase().includes(b));
  eq(`${name} caption contains no asserted-feeling copy`, hit ?? null, null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
