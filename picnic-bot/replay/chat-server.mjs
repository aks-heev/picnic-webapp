// Run: node --env-file=.env replay/chat-server.mjs
// Then open http://localhost:8787 in a browser.
//
// A local, zero-dependency chat UI for talking to the bot yourself — nothing
// is sent to WhatsApp or any customer. Conversation state lives in the
// browser tab (sent back on every request), so the bot sees real multi-turn
// history exactly like brain.mjs expects. Switch provider live with the
// dropdown to compare Gemini vs Anthropic on the same conversation.
//
// This is for POKING AT THE BOT BY HAND. For the daily real-enquiry log
// during the 15-26 Sep test, use replay/shadow.mjs instead — that one
// writes to shadow-log.csv for the 29 Sep comparison. This one does not
// log anything; it's disposable, restart the server to reset.

import { createServer } from 'node:http';
import { loadCatalogue } from '../src/tools.mjs';
import { respond } from '../src/brain.mjs';

const PORT = Number(process.env.CHAT_PORT || 8787);
const VENUE_IDS = (process.env.BOT_VENUE_IDS || '14').split(',').map(Number);

let catalogue = null;
async function getCatalogue() {
  if (!catalogue) catalogue = await loadCatalogue(VENUE_IDS);
  return catalogue;
}

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Picnic Stories bot — local test chat</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #e5ddd5; }
  header { background: #075e54; color: #fff; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; }
  header .sub { font-size: 11px; opacity: 0.85; }
  header select, header button { font-size: 12px; padding: 4px 8px; border-radius: 6px; border: none; }
  #log { height: calc(100vh - 130px); overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .bubble { max-width: 78%; padding: 8px 12px; border-radius: 8px; font-size: 14px; line-height: 1.4; white-space: pre-wrap; box-shadow: 0 1px 1px rgba(0,0,0,.1); }
  .customer { align-self: flex-end; background: #dcf8c6; border-top-right-radius: 2px; }
  .bot { align-self: flex-start; background: #fff; border-top-left-radius: 2px; }
  .escalate { align-self: flex-start; background: #fff3cd; border: 1px solid #f0ad4e; border-top-left-radius: 2px; }
  .meta { font-size: 10px; color: #667781; margin-top: 4px; }
  .escalate .meta { color: #8a6d3b; }
  form { display: flex; gap: 8px; padding: 10px; background: #f0f0f0; }
  input[type=text] { flex: 1; padding: 10px 14px; border-radius: 20px; border: 1px solid #ccc; font-size: 14px; }
  button.send { padding: 10px 18px; border-radius: 20px; border: none; background: #075e54; color: #fff; font-size: 14px; }
  .err { color: #b00020; font-size: 12px; padding: 8px 16px; }
</style>
</head>
<body>
<header>
  <div>
    <h1>The Picnic Stories — bot test chat</h1>
    <div class="sub">Local only. Nothing sent to WhatsApp or any customer.</div>
  </div>
  <div style="display:flex; gap:8px; align-items:center;">
    <select id="provider">
      <option value="gemini">Gemini</option>
      <option value="anthropic">Anthropic</option>
    </select>
    <button type="button" onclick="resetChat()">Reset</button>
  </div>
</header>
<div id="log"></div>
<form id="f">
  <input type="text" id="text" placeholder="Type as the customer..." autocomplete="off" autofocus>
  <button class="send" type="submit">Send</button>
</form>
<script>
let history = [];

function bubble(role, text, meta, escalate) {
  const log = document.getElementById('log');
  const div = document.createElement('div');
  div.className = 'bubble ' + (role === 'user' ? 'customer' : (escalate ? 'escalate' : 'bot'));
  div.textContent = text;
  if (meta) {
    const m = document.createElement('div');
    m.className = 'meta';
    m.textContent = meta;
    div.appendChild(m);
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function resetChat() {
  history = [];
  document.getElementById('log').innerHTML = '';
}

document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('text');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  bubble('user', text);
  history.push({ role: 'user', content: text });

  const provider = document.getElementById('provider').value;
  const log = document.getElementById('log');
  const thinking = document.createElement('div');
  thinking.className = 'bubble bot';
  thinking.textContent = '...';
  thinking.id = 'thinking';
  log.appendChild(thinking);
  log.scrollTop = log.scrollHeight;

  try {
    const res = await fetch('/api/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history, provider }),
    });
    const data = await res.json();
    document.getElementById('thinking')?.remove();
    if (data.error) {
      const div = document.createElement('div');
      div.className = 'err';
      div.textContent = 'Error: ' + data.error;
      log.appendChild(div);
      return;
    }
    if (data.action === 'escalate') {
      bubble('bot', data.text || '[escalated to human — no message sent]', 'ESCALATED — ' + (data.reason || 'no reason given') + ' · ' + data.provider, true);
      // Escalation ends the bot's turn — do not add it to history as a normal reply,
      // matches how brain.mjs is actually used (a human takes over from here).
    } else {
      bubble('bot', data.text, data.provider + (data.allowed?.length ? ' · used: ' + data.allowed.join(', ') : ''));
      history.push({ role: 'assistant', content: data.text });
    }
  } catch (err) {
    document.getElementById('thinking')?.remove();
    const div = document.createElement('div');
    div.className = 'err';
    div.textContent = 'Request failed: ' + err.message;
    log.appendChild(div);
  }
});
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/message') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { messages, provider } = JSON.parse(body);
        const cat = await getCatalogue();
        const r = await respond(messages, cat, { provider });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(r));
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Bot test chat running: http://localhost:${PORT}`);
  console.log('Local only — nothing here reaches WhatsApp or a real customer. Ctrl+C to stop.');
});
