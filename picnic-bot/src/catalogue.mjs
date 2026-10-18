// Run: npm run catalogue
// Prints exactly what the bot is allowed to quote, and live-tests every
// package through the real pricing RPC. If a package does not appear here,
// the bot cannot sell it and must escalate.

import { loadCatalogue, quote, bookedSlots } from './tools.mjs';

const ids = (process.env.BOT_VENUE_IDS || '14').split(',').map((s) => Number(s.trim()));

const cat = await loadCatalogue(ids);
if (cat.length === 0) {
  console.error(`No priceable venue in [${ids}]. Bot has nothing to sell — stop here.`);
  process.exit(1);
}

let failures = 0;
for (const v of cat) {
  console.log(`\n${v.name}  (venue ${v.venue_id}, ${v.region})  ${v.packages.length} packages`);
  for (const p of v.packages) {
    const guests = p.included_guests ?? 2;
    const r = await quote({
      venue_id: v.venue_id, package_key: p.package_key, guests, time_slot: 'evening',
    });
    if (!r.ok) {
      failures++;
      console.log(`  FAIL  ${p.package_key.padEnd(20)} ${r.reason}`);
    } else {
      const drift = r.total !== p.price ? `  <-- differs from venue_packages.price ${p.price}` : '';
      console.log(
        `  ok    ${p.package_key.padEnd(20)} ${String(guests).padStart(2)}g  ` +
        `total ${String(r.total).padStart(7)}  advance ${String(r.advance).padStart(7)}${drift}`
      );
    }
  }
  const b = await bookedSlots({ venue_id: v.venue_id });
  console.log(b.ok ? `  booked slots on file: ${b.booked.length}` : `  FAIL booked slots: ${b.reason}`);
}
console.log(failures === 0 ? '\nAll packages priceable.' : `\n${failures} package(s) unpriceable — fix before launch.`);
process.exit(failures === 0 ? 0 : 1);
