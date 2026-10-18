// Gemini adapter. Same neutral turn format as the Anthropic adapter, so
// brain.mjs does not know or care which one is loaded.
//
// Two wire-level differences worth knowing:
//  - Gemini calls the assistant role "model".
//  - functionResponse carries no call id; responses are matched by name and
//    order. We synthesise stable ids on the way in so the neutral layer and
//    the verifier stay uniform across providers.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const name = 'gemini';
export const defaultModel = 'gemini-3.5-flash';
export const envKey = 'GEMINI_API_KEY';

export function toWire(turns) {
  const out = [];
  for (const t of turns) {
    if (t.calls) {
      // Gemini 3 thinking models attach a thoughtSignature to functionCall parts
      // and REQUIRE it back verbatim on the next turn. Replay the raw parts
      // rather than rebuilding them, so any metadata survives untouched.
      out.push({
        role: 'model',
        parts: t.raw || t.calls.map((c) => ({ functionCall: { name: c.name, args: c.input } })),
      });
    } else if (t.results) {
      out.push({
        role: 'user',
        parts: t.results.map((r) => ({
          functionResponse: { name: r.name, response: r.output },
        })),
      });
    } else {
      out.push({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] });
    }
  }
  return out;
}

export function toolsToWire(tools) {
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  }];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 429 (rate limit) is expected on the free tier (10 RPM) and still happens on
// paid under burst. 503 (UNAVAILABLE / "high demand") and the other 5xx codes
// are Google-side transient overload, unrelated to our request. Retry both
// classes with exponential backoff, honouring Retry-After when Google sends
// one. Six attempts covers a free-tier minute boundary and a short 503 blip.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function postWithRetry(url, body, key, attempts = 6) {
  let wait = 1500;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body,
    });
    if (!RETRYABLE_STATUS.has(res.status)) return res;
    if (i === attempts - 1) return res;
    const hdr = Number(res.headers.get('retry-after'));
    const delay = Number.isFinite(hdr) && hdr > 0 ? hdr * 1000 : wait;
    if (process.env.BOT_VERBOSE) {
      console.warn(`  gemini ${res.status}, retrying in ${delay}ms (${i + 1}/${attempts})`);
    }
    await sleep(delay);
    wait = Math.min(wait * 2, 30000);
  }
}

// gemini-3.5-flash is a THINKING model: maxOutputTokens is a shared budget
// across its hidden reasoning tokens AND the visible reply text — confirmed
// live 2026-09-14, e.g. thoughtsTokenCount 306-412 on a single short reply.
// At 500 total, a run with heavier reasoning leaves too little room for the
// answer and Google cuts the reply off mid-sentence (finishReason MAX_TOKENS)
// rather than erroring. 2048 gives real headroom; the finishReason check
// below is the actual safety net — no half-sentence reaches verify() or a
// customer no matter what the budget is, because a run can always think
// more than expected.
export async function complete({ system, tools, turns, model, maxTokens = 2048, apiKey }) {
  const key = apiKey || process.env[envKey];
  if (!key) throw new Error(`${envKey} not set`);
  const m = model || defaultModel;

  const res = await postWithRetry(`${BASE}/${m}:generateContent`, JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    tools: toolsToWire(tools),
    contents: toWire(turns),
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
  }), key);

  if (res.status === 429) {
    throw new Error('gemini 429: rate limited after retries. Free tier is 10 RPM — ' +
      'enable billing on the key\'s Cloud project, or run replay with fewer cases at once.');
  }
  if (res.status === 503) {
    throw new Error('gemini 503: still UNAVAILABLE (high demand) after retries. ' +
      'This is Google-side, not a bug here — re-run in a minute.');
  }
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const finishReason = body?.candidates?.[0]?.finishReason;
  if (process.env.DIAG) console.error('DIAG finishReason=%s usage=%o', finishReason, body?.usageMetadata);

  const parts = body?.candidates?.[0]?.content?.parts || [];
  const calls = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({ id: `gem_${i}_${p.functionCall.name}`, name: p.functionCall.name, input: p.functionCall.args || {} }));
  if (calls.length) return { type: 'tool_use', calls, raw: parts };

  const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('').trim();
  // A cut-off reply must never reach a customer — mark it, brain.mjs escalates
  // instead of returning a half-sentence (or worse, a half-quoted price).
  return { type: 'text', text, truncated: finishReason === 'MAX_TOKENS' };
}
