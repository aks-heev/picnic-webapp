// Run: node --env-file=.env replay/shadow.mjs --text "customer's message"
//   or: node --env-file=.env replay/shadow.mjs --file replay/shadow-cases/some-thread.json
//
// SHADOW MODE — not connected to real WhatsApp. Purpose: during the 15-26 Sep
// manual-pursuit test, run the SAME real enquiries the bot would have seen
// through the actual brain, side by side with what the human closer (you)
// actually did. No message is ever sent to a customer by this script.
//
// Every run appends one row to replay/shadow-log.csv so the two weeks build
// up a comparable dataset: bot_action / bot_reply next to a blank
// human_outcome column you fill in by hand once you know how the real
// conversation ended. That comparison is the evidence for "does the bot
// replace the hire, or not" — not more argument, an actual number.
//
// --text is for the common case: one customer message, no prior history.
// --file points at a JSON file shaped like a replay case ({id, messages}) —
// use this for a thread that already has back-and-forth, e.g. you already
// asked "which date?" and the customer replied.

import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadCatalogue } from '../src/tools.mjs';
import { respond } from '../src/brain.mjs';

function parseArgs(argv) {
  const out = { provider: process.env.BOT_PROVIDER || 'gemini' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--text') out.text = argv[++i];
    else if (argv[i] === '--file') out.file = argv[++i];
    else if (argv[i] === '--id') out.id = argv[++i];
    else if (argv[i] === '--provider') out.provider = argv[++i];
  }
  return out;
}

function csvEscape(s) {
  const str = String(s ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.text && !args.file) {
    console.error('Usage: node replay/shadow.mjs --text "customer message" [--id thread-1] [--provider gemini|anthropic]');
    console.error('   or: node replay/shadow.mjs --file replay/shadow-cases/thread.json');
    process.exit(1);
  }

  let messages, id;
  if (args.file) {
    const raw = JSON.parse(await readFile(args.file, 'utf8'));
    messages = raw.messages;
    id = args.id || raw.id || args.file;
  } else {
    messages = [{ role: 'user', content: args.text }];
    id = args.id || `shadow-${Date.now()}`;
  }

  const cat = await loadCatalogue((process.env.BOT_VENUE_IDS || '14').split(',').map(Number));
  const r = await respond(messages, cat, { provider: args.provider });

  console.log(`\nid: ${id}`);
  console.log(`provider: ${r.provider}`);
  console.log(`action: ${r.action}${r.reason ? ` (${r.reason})` : ''}`);
  if (r.text) console.log(`reply: ${r.text.replace(/\n/g, ' ')}`);
  if (r.allowed?.length) console.log(`tool figures: [${[...new Set(r.allowed)].join(', ')}]`);
  console.log('\n>>> Nothing was sent. This is what the bot WOULD have said.');
  console.log('>>> Log human_outcome by hand in replay/shadow-log.csv once you know how the real thread ended.\n');

  const logDir = 'replay';
  const logPath = `${logDir}/shadow-log.csv`;
  if (!existsSync(logDir)) await mkdir(logDir, { recursive: true });
  if (!existsSync(logPath)) {
    await appendFile(logPath, 'timestamp,id,provider,action,reason,reply,tool_figures,human_outcome\n');
  }
  const row = [
    new Date().toISOString(),
    id,
    r.provider,
    r.action,
    r.reason || '',
    r.text || '',
    (r.allowed || []).join('|'),
    '', // human_outcome — fill in by hand later
  ].map(csvEscape).join(',');
  await appendFile(logPath, row + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
