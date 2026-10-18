// Run: npm run replay
// Exit gate for Phase 1. Every case must land on the expected action and no
// reply may contain an unverified figure. Zero failures before shadow mode.

import { readFile } from 'node:fs/promises';
import { loadCatalogue } from '../src/tools.mjs';
import { respond } from '../src/brain.mjs';

const argProvider = process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1];
const provider = argProvider || process.env.BOT_PROVIDER || 'gemini';
const needed = provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
if (!process.env[needed]) {
  console.error(`${needed} missing in .env — replay with provider "${provider}" needs it. \`npm run catalogue\` does not.`);
  process.exit(1);
}

const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const cat = await loadCatalogue((process.env.BOT_VENUE_IDS || '14').split(',').map(Number));
console.log(`provider: ${provider}`);
console.log(`catalogue: ${cat.map((v) => `${v.name} (${v.packages.length} pkgs)`).join(', ')}\n`);

let fail = 0;
for (const c of cases) {
  const r = await respond(c.messages, cat, { provider });
  const okAction = c.expect === 'either' ? true : r.action === c.expect;
  const body = r.text || '';
  const banned = (c.must_not_contain || []).filter((w) => body.toLowerCase().includes(w.toLowerCase()));
  const unverified = r.action === 'escalate' && /unverified figures/.test(r.reason || '');
  const good = okAction && banned.length === 0 && !unverified;
  if (!good) fail++;

  console.log(`${good ? 'PASS' : 'FAIL'}  ${c.id}`);
  console.log(`      expected=${c.expect}  got=${r.action}${r.reason ? ` (${r.reason})` : ''}`);
  if (body) console.log(`      reply: ${body.replace(/\n/g, ' ')}`);
  if (r.allowed?.length) console.log(`      tool figures: [${[...new Set(r.allowed)].join(', ')}]`);
  if (banned.length) console.log(`      BANNED WORD: ${banned.join(', ')}`);
  console.log();
}
console.log(fail === 0 ? 'All cases passed.' : `${fail} case(s) failed — do not proceed to shadow mode.`);
process.exit(fail === 0 ? 0 : 1);
