// Wire-format check for both adapters. No network, no API keys.
// Catches the class of bug that only shows up as a 400 from the provider.
import * as anthropic from './anthropic.mjs';
import * as gemini from './gemini.mjs';
import { TOOLS } from '../brain.mjs';

const TURNS = [
  { role: 'user', text: 'birthday picnic for 6 on 22 Oct evening?' },
  { role: 'assistant', calls: [{ id: 'c1', name: 'quote', input: { venue_id: 14, package_key: 'setting', guests: 6, time_slot: 'evening' } }] },
  { role: 'tool', results: [{ id: 'c1', name: 'quote', output: { ok: true, total: 8900, advance: 2670 } }] },
  { role: 'assistant', text: 'The Setting is Rs 8,900 for 6.' },
];

let fail = 0;
const check = (label, cond, got) => {
  if (!cond) { fail++; console.log(`FAIL  ${label}\n      got: ${JSON.stringify(got)}`); }
  else console.log(`PASS  ${label}`);
};

// ---- anthropic -------------------------------------------------------------
console.log('\nanthropic');
const aw = anthropic.toWire(TURNS);
const at = anthropic.toolsToWire(TOOLS);
check('user turn is plain string content', aw[0].role === 'user' && typeof aw[0].content === 'string', aw[0]);
check('tool call uses type tool_use with id', aw[1].role === 'assistant' && aw[1].content[0].type === 'tool_use' && aw[1].content[0].id === 'c1', aw[1]);
check('tool result rides on a user turn', aw[2].role === 'user' && aw[2].content[0].type === 'tool_result', aw[2]);
check('tool result references tool_use_id', aw[2].content[0].tool_use_id === 'c1', aw[2].content[0]);
check('tool result content is a JSON string', typeof aw[2].content[0].content === 'string' && JSON.parse(aw[2].content[0].content).total === 8900, aw[2].content[0]);
check('assistant text turn keeps role assistant', aw[3].role === 'assistant' && typeof aw[3].content === 'string', aw[3]);
check('tools use input_schema', at[0].input_schema?.type === 'object' && !!at[0].name, at[0]);

// ---- gemini ----------------------------------------------------------------
console.log('\ngemini');
const gw = gemini.toWire(TURNS);
const gt = gemini.toolsToWire(TOOLS);
check('user turn uses parts[].text', gw[0].role === 'user' && gw[0].parts[0].text.length > 0, gw[0]);
check('tool call turn uses role model', gw[1].role === 'model', gw[1]);
check('tool call uses functionCall.args', gw[1].parts[0].functionCall?.name === 'quote' && gw[1].parts[0].functionCall.args.venue_id === 14, gw[1].parts[0]);
check('tool result rides on a user turn', gw[2].role === 'user', gw[2]);
check('tool result uses functionResponse matched by name', gw[2].parts[0].functionResponse?.name === 'quote', gw[2].parts[0]);
check('functionResponse.response is an object, not a string', typeof gw[2].parts[0].functionResponse.response === 'object', gw[2].parts[0]);
check('assistant text turn is remapped to role model', gw[3].role === 'model' && gw[3].parts[0].text.length > 0, gw[3]);
check('tools wrapped in functionDeclarations', Array.isArray(gt[0].functionDeclarations) && gt[0].functionDeclarations[0].parameters?.type === 'object', gt[0]);

// ---- raw passthrough --------------------------------------------------------
// Regression guard for the Gemini 400 "Function call is missing a
// thought_signature" seen 2026-09-11: provider metadata must survive the round
// trip, so a turn carrying raw parts must be replayed verbatim.
console.log('\nraw passthrough');
const RAW_G = [{ functionCall: { name: 'quote', args: { venue_id: 14 } }, thoughtSignature: 'SIG123' }];
const RAW_A = [{ type: 'tool_use', id: 'c1', name: 'quote', input: { venue_id: 14 }, cache_control: null }];
const gRaw = gemini.toWire([{ role: 'assistant', calls: [{ id: 'c1', name: 'quote', input: {} }], raw: RAW_G }]);
const aRaw = anthropic.toWire([{ role: 'assistant', calls: [{ id: 'c1', name: 'quote', input: {} }], raw: RAW_A }]);
check('gemini replays raw parts verbatim', JSON.stringify(gRaw[0].parts) === JSON.stringify(RAW_G), gRaw[0].parts);
check('gemini preserves thoughtSignature', gRaw[0].parts[0].thoughtSignature === 'SIG123', gRaw[0].parts[0]);
check('anthropic replays raw content verbatim', JSON.stringify(aRaw[0].content) === JSON.stringify(RAW_A), aRaw[0].content);
check('both still fall back when raw absent', gw[1].parts[0].functionCall?.name === 'quote' && aw[1].content[0].type === 'tool_use', null);

// ---- parity ----------------------------------------------------------------
console.log('\nparity');
check('both adapters emit one wire turn per neutral turn', aw.length === TURNS.length && gw.length === TURNS.length, { a: aw.length, g: gw.length });
check('both expose the same tool names', JSON.stringify(at.map(t => t.name)) === JSON.stringify(gt[0].functionDeclarations.map(t => t.name)), null);
check('defaults differ per provider', anthropic.defaultModel !== gemini.defaultModel, null);

console.log(fail === 0 ? '\nAll wire-format checks passed.' : `\n${fail} check(s) failed.`);
process.exit(fail === 0 ? 0 : 1);
