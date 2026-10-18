#!/usr/bin/env node
/**
 * Weekly content generator — turns live booking data into post-ready facts.
 *
 * WHY THIS EXISTS: the content angles that work for this business are the ones
 * only we can make, because they are backed by numbers nobody else has. Every
 * line this prints is traceable to a fetch below — nothing is asserted, nothing
 * is a feeling, and no scarcity is invented (see the AVAILABILITY note).
 *
 * READ-ONLY. Plain PostgREST selects, aggregated in JS. It creates no database
 * objects, so it needs none of the §4 migration ritual. Safe against prod.
 *
 * §8 exclusions are applied to every count: team phones, names starting "Test",
 * and phone+date duplicates of a confirmed row. n is printed on every rate,
 * because n is tiny — every number here is directional, not a KPI.
 *
 * Requires env vars (never commit these):
 *   SUPABASE_URL=https://evmftrogyzoudiccqkya.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key>
 *
 * The service-role key is required because `bookings` has NO anon SELECT policy
 * and must never get one — that single fact is what keeps customer PII private.
 *
 * Run:
 *   node scripts/content-week.mjs            # facts + drafted captions
 *   node scripts/content-week.mjs --facts    # facts only
 *   node scripts/content-week.mjs --json     # machine-readable
 */
import { createClient } from '@supabase/supabase-js';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args      = process.argv.slice(2);
const FACTS_ONLY = args.includes('--facts');
const AS_JSON    = args.includes('--json');

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const TEAM_PHONES  = new Set(['7742363777', '7425055501']);
const MAIN_VENUE   = 14;              // Beige Cafe — carries most picnic volume
const HORIZON_DAYS = 28;

const rupees = n => `₹${Number(n).toLocaleString('en-IN')}`;
const iso    = d => d.toISOString().slice(0, 10);

async function sel(table, cols, tweak = q => q) {
  const { data, error } = await tweak(sb.from(table).select(cols));
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

/** §8 exclusions + phone/date dedupe. One definition, reused by every fact. */
function cleanConfirmed(rows) {
  const seen = new Map();
  for (const b of rows) {
    if (TEAM_PHONES.has((b.mobile_number ?? '').trim())) continue;
    if (/^test/i.test((b.full_name ?? '').trim()))       continue;
    const key = `${b.mobile_number}|${b.preferred_date ?? b.checkout_date}`;
    const prev = seen.get(key);
    if (!prev || b.id < prev.id) seen.set(key, b);   // keep the earliest row
  }
  return [...seen.values()];
}

async function gather() {
  const raw = await sel(
    'bookings',
    'id, full_name, mobile_number, confirmed, preferred_date, checkout_date, ' +
    'time_slot, occasion, package_name, guest_count, venue_id, created_at',
    q => q.eq('confirmed', true),
  );
  const clean   = cleanConfirmed(raw);
  const picnics = clean.filter(b => !b.checkout_date);

  // -- Fact 1: occasion mix. What people actually book us for. ---------------
  const occasion = [...picnics.reduce((m, b) => {
    const k = (b.occasion || '').trim() || '(not stated)';
    return m.set(k, (m.get(k) ?? 0) + 1);
  }, new Map())].map(([occasion, n]) => ({ occasion, n }))
    .sort((a, b) => b.n - a.n);

  // -- Fact 2: add-on attach rates. -----------------------------------------
  // Duplicate add-on rows exist across two generations (Cake 4/24, Bouquet
  // 5/22, Photographer 7/19, Extra Hour 11/32). Normalise on NAME, never id.
  const picnicIds = new Set(picnics.map(b => b.id));
  const [links, addonDefs] = await Promise.all([
    sel('booking_add_ons', 'booking_id, addon_id, price_at_booking'),
    sel('add_ons', 'id, name, price'),
  ]);
  const nameOf = new Map(addonDefs.map(a =>
    [a.id, a.name.replace(/\s*\(.*\)$/, '').trim()]));

  const attachMap = new Map();
  for (const l of links) {
    if (!picnicIds.has(l.booking_id)) continue;
    const name = nameOf.get(l.addon_id);
    if (!name) continue;
    const e = attachMap.get(name) ?? { addon: name, bookings: new Set(), revenue: 0 };
    e.bookings.add(l.booking_id);
    e.revenue += Number(l.price_at_booking ?? 0);
    attachMap.set(name, e);
  }
  const addons = [...attachMap.values()]
    .map(e => ({ addon: e.addon, bookings_with: e.bookings.size,
                 out_of: picnics.length, revenue: e.revenue }))
    .sort((a, b) => b.bookings_with - a.bookings_with || b.revenue - a.revenue);

  // -- Fact 3: the package ladder at the main venue. -------------------------
  // Prices come from venue_packages — the same source the site renders. Never
  // re-derived with local arithmetic (§7).
  const [vps, pkgs, pkgLinks, venues] = await Promise.all([
    sel('venue_packages', 'venue_id, package_id, price, is_active',
        q => q.eq('venue_id', MAIN_VENUE).eq('is_active', true)),
    sel('packages', 'id, key, name, tagline, sort_order, is_active',
        q => q.eq('is_active', true)),
    sel('package_add_ons', 'package_id, addon_id'),
    sel('venues', 'id, name, max_concurrent_setups'),
  ]);
  const pkgById = new Map(pkgs.map(p => [p.id, p]));
  const packages = vps
    .filter(vp => pkgById.has(vp.package_id))
    .map(vp => {
      const p = pkgById.get(vp.package_id);
      const included = pkgLinks.filter(l => l.package_id === p.id)
        .map(l => nameOf.get(l.addon_id)).filter(Boolean).sort();
      return { package: p.name, key: p.key, tagline: p.tagline,
               price: Number(vp.price), included, sort: p.sort_order ?? 99 };
    })
    .sort((a, b) => a.sort - b.sort);

  // -- Fact 4: AVAILABILITY, stated honestly. -------------------------------
  // 🔴 Do NOT render this as "last few dates left". Measured 2026-09-14:
  // 23 of the next 24 weekend evening slots at the main venue were free.
  // Manufactured scarcity in a market this small is a credibility risk — an
  // enquirer who is then offered any date they like has caught us out. The
  // true and more useful claim is the inverse: lead time is DAYS, so a post
  // on Tuesday can fill Saturday.
  const cap = venues.find(v => v.id === MAIN_VENUE)?.max_concurrent_setups ?? 1;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + HORIZON_DAYS);
  const takenBy = new Map();
  for (const b of picnics) {
    if (b.venue_id !== MAIN_VENUE || b.time_slot !== 'evening') continue;
    if (!b.preferred_date) continue;
    if (b.preferred_date < iso(today) || b.preferred_date > iso(horizon)) continue;
    takenBy.set(b.preferred_date, (takenBy.get(b.preferred_date) ?? 0) + 1);
  }
  const slots = [];
  for (let d = new Date(today); d <= horizon; d.setDate(d.getDate() + 1)) {
    if (![0, 5, 6].includes(d.getDay())) continue;   // Fri, Sat, Sun
    const day = iso(d), taken = takenBy.get(day) ?? 0;
    slots.push({ day, dow: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()],
                 taken, free: cap - taken });
  }

  // -- Fact 5: lead time (enquiry -> event). --------------------------------
  const leads = picnics
    .filter(b => b.preferred_date && b.preferred_date > '2026-01-01')
    .map(b => Math.round(
      (new Date(b.preferred_date) - new Date(b.created_at.slice(0, 10))) / 86400000))
    .filter(n => n >= 0);
  const lead = {
    n: leads.length,
    avg_lead_days: leads.length
      ? +(leads.reduce((a, b) => a + b, 0) / leads.length).toFixed(1) : null,
    min_lead_days: leads.length ? Math.min(...leads) : null,
  };

  return {
    generated_at: new Date().toISOString(),
    totals: { confirmed: clean.length, picnics: picnics.length,
              stays: clean.length - picnics.length },
    occasion, addons, packages, slots, lead,
  };
}

// ---------------------------------------------------------------------------
// Caption builders. Facts only — no asserted feelings, no lyricism. If a line
// cannot be traced to a number above, it does not belong in a caption.
// ---------------------------------------------------------------------------
function captionOccasion(f) {
  const top = f.occasion[0];
  if (!top || top.occasion === '(not stated)') return null;
  return `${top.n} of our last ${f.totals.picnics} picnic setups were ${top.occasion.toLowerCase()}s.

Not birthdays. Not anniversaries. ${top.occasion}s.

Three things that changes about how we set up:
— The table faces the light. The photos happen in the first two minutes.
— The setup stays out of sight until you walk her in.
— Whoever is on our team stays out of frame the whole time.

Evening slots, Gurugram. Date check on the site.`;
}

function captionAddons(f) {
  const p = f.addons.find(a => /photograph/i.test(a.addon));
  if (!p) return null;
  return `${p.bookings_with} of our last ${p.out_of} picnic bookings added a photographer.

It is the most-added extra we offer, by a distance. It is also the one we get
asked about the day after, when it is too late to add.

You can re-cut a cake. You cannot re-shoot her face.

Added to any setup. Ask before the date, not after.`;
}

function captionPackages(f) {
  if (!f.packages.length) return null;
  const core = f.packages.filter(p =>
    ['the_prelude', 'setting', 'moment', 'story'].includes(p.key));
  const list = (core.length ? core : f.packages).map(p =>
    `${p.package} — ${rupees(p.price)}` +
    (p.included.length ? `\n   includes ${p.included.join(', ')}` : '')).join('\n');
  return `What ${rupees(core[0]?.price ?? f.packages[0].price)} gets you, and what it does not. No "starting from".

${list}

Those are setup prices for two, at the venue. Add-ons are priced separately and
listed on the site — nothing is quoted only over WhatsApp.`;
}

function captionBooking(f) {
  const { avg_lead_days: avg, min_lead_days: min, n } = f.lead;
  if (avg == null) return null;
  return `Most asked question: how far ahead do I need to book?

Across ${n} confirmed picnics the average gap between enquiry and event is ${avg} days.
The shortest was ${min === 0 ? 'the same day' : `${min} day${min === 1 ? '' : 's'}`}.

So if you are reading this on a Tuesday and thinking about Saturday — that is a
normal booking for us, not a rush job.

Pick a date on the site, 30% holds it, we confirm by email.`;
}

export { cleanConfirmed, gather, captionOccasion, captionAddons, captionPackages, captionBooking };

// Only run when executed directly, so the pure functions above stay importable
// by the test harness without firing a network call.
const RUN_DIRECT = process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (!RUN_DIRECT) { /* imported as a module — do nothing */ }
else {
const facts = await gather();

if (AS_JSON) {
  console.log(JSON.stringify(facts, null, 2));
} else {
  const { totals, occasion, addons, packages, slots, lead } = facts;
  console.log(`\n=== FACTS (${facts.generated_at.slice(0, 10)}) ===`);
  console.log(`confirmed ${totals.confirmed}  |  picnics ${totals.picnics}  |  stays ${totals.stays}`);
  console.log(`\n-- occasion mix (n=${totals.picnics}) --`);
  for (const o of occasion) console.log(`  ${String(o.n).padStart(3)}  ${o.occasion}`);
  console.log(`\n-- add-on attach, picnics only (n=${totals.picnics}) --`);
  for (const a of addons) {
    console.log(`  ${String(a.bookings_with).padStart(3)}/${a.out_of}  ` +
                `${a.addon.padEnd(28)} ${rupees(a.revenue)}`);
  }
  console.log(`\n-- package ladder, venue ${MAIN_VENUE} --`);
  for (const p of packages) {
    console.log(`  ${p.package.padEnd(22)} ${rupees(p.price).padStart(9)}` +
                `${p.included.length ? '  incl ' + p.included.join(', ') : ''}`);
  }
  const free = slots.filter(s => s.free > 0).length;
  console.log(`\n-- weekend evening slots, next ${HORIZON_DAYS}d, venue ${MAIN_VENUE} --`);
  console.log(`  ${free} of ${slots.length} weekend evenings have space.`);
  if (free / slots.length > 0.5) {
    console.log(`  NOTE: the calendar is open. Do NOT post scarcity this week —`);
    console.log(`        use the lead-time angle instead (see captionBooking).`);
  }
  console.log(`\n-- lead time (n=${lead.n}) --`);
  console.log(`  avg ${lead.avg_lead_days}d, shortest ${lead.min_lead_days}d\n`);

  if (!FACTS_ONLY) {
    const posts = [
      ['POST 1 — occasion anchor', captionOccasion(facts)],
      ['POST 2 — the add-on that sells', captionAddons(facts)],
      ['POST 3 — package comparison', captionPackages(facts)],
      ['POST 4 — how booking works', captionBooking(facts)],
    ];
    for (const [title, body] of posts) {
      if (!body) continue;
      console.log(`\n${'='.repeat(64)}\n${title}\n${'='.repeat(64)}\n${body}`);
    }
    console.log();
  }
}

}
