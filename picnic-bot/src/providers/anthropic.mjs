// Anthropic adapter. Translates the neutral turn format used by brain.mjs into
// the Messages API wire format and back.
//
// Neutral turn format (shared by every provider):
//   { role: 'user'|'assistant', text: string }
//   { role: 'assistant', calls: [{ id, name, input }] }
//   { role: 'tool',      results: [{ id, name, output }] }
//
// complete() returns either
//   { type: 'tool_use', calls: [{ id, name, input }] }
//   { type: 'text',     text: string }

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

export const name = 'anthropic';
export const defaultModel = 'claude-haiku-4-5';
export const envKey = 'ANTHROPIC_API_KEY';

export function toWire(turns) {
  const out = [];
  for (const t of turns) {
    if (t.calls) {
      // Echo the model's own content blocks verbatim where we have them, so any
      // provider metadata (signatures, thinking blocks) survives the round trip.
      out.push({
        role: 'assistant',
        content: t.raw || t.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })),
      });
    } else if (t.results) {
      out.push({
        role: 'user',
        content: t.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: JSON.stringify(r.output),
        })),
      });
    } else {
      out.push({ role: t.role, content: t.text });
    }
  }
  return out;
}

export function toolsToWire(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export async function complete({ system, tools, turns, model, maxTokens = 1024, apiKey }) {
  const key = apiKey || process.env[envKey];
  if (!key) throw new Error(`${envKey} not set`);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model || defaultModel,
      max_tokens: maxTokens,
      // cache the catalogue: it is the same on every call and is most of the prompt
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: toolsToWire(tools),
      messages: toWire(turns),
    }),
  });

  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const body = await res.json();

  const calls = (body.content || [])
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  if (calls.length) return { type: 'tool_use', calls, raw: body.content };

  const text = (body.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  // Same safety net as the Gemini adapter: never let a cut-off reply through.
  return { type: 'text', text, truncated: body.stop_reason === 'max_tokens' };
}
