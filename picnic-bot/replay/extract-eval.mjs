// Run: npm run extract:eval
//   flags: --chats <path>  --key <path>  --limit N  --only chat_03  --model <id>
//
// Scores src/extract.mjs against real bookings in Supabase.
// Inputs (real customer data, kept OUT of the repo by default):
//   chats: C:\Users\akshe\Downloads\picnic_chats.json       (from WhatsApp Web)
//   key:   C:\Users\akshe\Downloads\picnic_chats_answer_key.json (from Supabase)
// Output: replay/private/extract-results.json (gitignored) + a summary table.
//
// Cost: one Gemini call per chat (24 by default). Uses GEMINI_API_KEY from .env,
// which must be the BILLED project's key: these are real customers.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadExtractCatalogue, extractBooking } from '../src/extract.mjs';

const DL = 'C:\\Users\\akshe\\Downloads';
const args = { chats: `${DL}\\picnic_chats.json`, key: `${DL}\\picnic_chats_answer_key.json` };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i];
}

// Chats whose WhatsApp name hides the number.
const ALIAS = { Shoorveerfightclub: '9625250941' };

const phoneOf = (contact) => ALIAS[contact] || (contact.replace(/\D/g, '').slice(-10) || null);
const norm = (s) => (s ?? '').toString().toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '');
const loose = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
// occasion labels staff use interchangeably
const OCC = { bachelorette: 'bridalshower', bridetobe: 'bridalshower', weddinganniversary: 'anniversary' };
const occ = (s) => { const n = norm(s); return OCC[n] || n; };
// the board is scored as board_message, never as an add-on
const addonSet = (xs) => new Set(xs.map(norm).filter((x) => x && x !== 'whiteboardmessage'));

// a field the extractor flagged as "may have changed on a call" is shown to staff
// for checking, so a wrong value there is FLAGGED, not a silent error
const FLAG_OF = { slot_start: 'slot', slot_end: 'slot', board: 'board_message', total: 'total_quoted' };

function scoreFields(got, exp) {
  const flagged = new Set([...(got.call_changed_fields || []), ...(got.unsure_fields || [])].map((f) => f.toLowerCase()));
  const [s, e] = (exp.slot || '').split('-');
  const checks = {
    date: [got.date, exp.date, (a, b) => a === b],
    slot_start: [got.slot_start, s || null, (a, b) => a === b],
    slot_end: [got.slot_end, e || null, (a, b) => a === b],
    guests: [got.guests, exp.guests, (a, b) => Number(a) === Number(b)],
    occasion: [got.occasion, exp.occasion, (a, b) => occ(a) === occ(b) || loose(a, b)],
    package: [got.package, exp.package, (a, b) => norm(a) === norm(b)],
    venue: [got.venue, exp.venue, loose],
    addons: [got.addons || [], exp.addons || [], (a, b) => {
      const A = addonSet(a), B = addonSet(b);
      return A.size === B.size && [...B].every((x) => A.has(x));
    }],
    board: [got.board_message, exp.board, loose],
    total: [got.total_quoted, exp.total, (a, b) => Number(a) === Number(b)],
  };
  const out = {};
  for (const [f, [g, x, eq]] of Object.entries(checks)) {
    if (x === null || x === undefined) continue; // answer key has no value: not scored
    const blank = g === null || g === undefined || (Array.isArray(g) && !g.length && Array.isArray(x) && x.length);
    const ok = !blank && eq(g, x) || (Array.isArray(g) && Array.isArray(x) && eq(g, x));
    // missing = staff has to type it in; wrong = staff could approve a bad value
    const isFlagged = flagged.has(FLAG_OF[f] || f) || flagged.has(f);
    out[f] = { ok, status: ok ? 'ok' : blank ? 'missing' : isFlagged ? 'flagged' : 'wrong', got: g ?? null, expected: x };
  }
  return out;
}

async function main() {
  const chats = JSON.parse(await readFile(args.chats, 'utf8'));
  const key = JSON.parse(await readFile(args.key, 'utf8'));
  const pos = new Map(key.positives.map((p) => [p.phone, p]));
  const neg = new Map(key.negatives.map((n) => [n.phone, n]));

  let list = chats.chats.map((c) => ({ ...c, phone: phoneOf(c.contact) }))
    .filter((c) => pos.has(c.phone) || neg.has(c.phone));
  if (args.only) list = list.filter((c) => c.id === args.only);
  if (args.limit) list = list.slice(0, Number(args.limit));

  const cat = await loadExtractCatalogue();
  // "today" pinned to the export date so date resolution is reproducible
  const today = (chats.exported_at || '').slice(0, 10) || undefined;
  console.log(`Scoring ${list.length} chats with ${args.model || process.env.BOT_MODEL || 'gemini-3.5-flash'} ` +
    `(${pos.size} bookings, ${neg.size} non-bookings in key). Catalogue: ${cat.packages.length} packages, ${cat.addOns.length} add-ons.\n`);

  const rows = [];
  let tokIn = 0, tokOut = 0;
  for (const c of list) {
    const isPos = pos.has(c.phone);
    const t0 = Date.now();
    let r, err;
    try { r = await extractBooking(c, cat, { model: args.model, today }); } catch (e) { err = e.message; }
    const ms = Date.now() - t0;
    if (r?.usage) { tokIn += r.usage.promptTokenCount || 0; tokOut += (r.usage.candidatesTokenCount || 0) + (r.usage.thoughtsTokenCount || 0); }
    const got = r?.result;
    const decisionOk = got ? (isPos ? got.decision === 'booking_confirmed' : got.decision !== 'booking_confirmed') : false;
    const fields = got && isPos ? scoreFields(got, pos.get(c.phone)) : {};
    const nOk = Object.values(fields).filter((f) => f.ok).length, nAll = Object.keys(fields).length;
    rows.push({ id: c.id, expected: isPos ? `booking #${pos.get(c.phone).booking_id}` : 'no booking', decision: got?.decision, decisionOk, fields, result: got, error: err, ms });
    const flag = err ? 'ERROR' : decisionOk ? 'ok   ' : 'WRONG';
    const miss = Object.entries(fields).filter(([, f]) => !f.ok).map(([k, f]) => `${f.status.toUpperCase().padEnd(7)} ${k}: got ${JSON.stringify(f.got)} want ${JSON.stringify(f.expected)}`);
    console.log(`${flag} ${c.id}  expected=${isPos ? 'booking' : 'none   '}  got=${got?.decision ?? '-'}` +
      (isPos && got ? `  fields ${nOk}/${nAll}` : '') + `  (${(ms / 1000).toFixed(1)}s)` + (err ? `  ${err}` : ''));
    for (const m of miss) console.log(`        ${m}`);
  }

  // ---- summary
  const done = rows.filter((r) => !r.error);
  const P = done.filter((r) => r.expected.startsWith('booking'));
  const N = done.filter((r) => !r.expected.startsWith('booking'));
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
  console.log('\n=== Decision ===');
  console.log(`bookings found:        ${P.filter((r) => r.decisionOk).length}/${P.length}  (${pct(P.filter((r) => r.decisionOk).length, P.length)})`);
  console.log(`non-bookings rejected: ${N.filter((r) => r.decisionOk).length}/${N.length}  (${pct(N.filter((r) => r.decisionOk).length, N.length)})`);
  console.log(`false bookings (would create a wrong draft): ${N.filter((r) => !r.decisionOk).map((r) => r.id).join(', ') || 'none'}`);

  console.log('\n=== Field accuracy on real bookings ===');
  const per = {};
  for (const r of P) for (const [f, v] of Object.entries(r.fields)) {
    if (f === 'total') continue; // priced by compute_booking_total, not the model; shown per chat only
    const p = (per[f] ||= { ok: 0, missing: 0, flagged: 0, wrong: 0, n: 0 }); p.n++; p[v.status]++;
  }
  console.log(`${'field'.padEnd(11)} correct  missing  flagged  SILENT-WRONG`);
  const tot = { ok: 0, missing: 0, flagged: 0, wrong: 0, n: 0 };
  for (const [f, p] of Object.entries(per)) {
    for (const k of Object.keys(tot)) tot[k] += p[k];
    console.log(`${f.padEnd(11)} ${`${p.ok}/${p.n}`.padStart(7)}  ${String(p.missing).padStart(7)}  ${String(p.flagged).padStart(7)}  ${String(p.wrong).padStart(12)}`);
  }
  console.log(`${'ALL'.padEnd(11)} ${`${tot.ok}/${tot.n}`.padStart(7)}  ${String(tot.missing).padStart(7)}  ${String(tot.flagged).padStart(7)}  ${String(tot.wrong).padStart(12)}   (${pct(tot.ok, tot.n)} correct, ${pct(tot.wrong, tot.n)} silently wrong)`);
  console.log('flagged = wrong but marked "check: may have changed on a call" or unsure, so staff are told to verify it. Totals excluded: priced by the system.');
  console.log(`\nerrors: ${rows.filter((r) => r.error).length}   tokens in/out: ${tokIn}/${tokOut}`);

  await mkdir('replay/private', { recursive: true });
  await writeFile('replay/private/extract-results.json', JSON.stringify({ ran_at: new Date().toISOString(), rows }, null, 1));
  console.log('Full results: replay/private/extract-results.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
