# picnic-bot

WhatsApp closer for The Picnic Stories. Picnics only — Airbnb/stays are out of scope.

Deployed separately from the main site, like `hosted-dashboard/`. Never wire it in as a
route inside picnic-webapp.

## Why it is built this way

The failure this replaces is not slow replies — it is passive ones. Enquiries arrive,
get an automated 4-field form and an 8-page PDF, and die. The bot's job is to ask one
question, quote a real package, and chase twice.

The thing that must never happen is a wrong price or a wrong availability claim. So the
model never originates a figure. It fills a sentence around values the database
returned, and `src/verify.mjs` rejects the draft if any money figure in it did not come
from a tool call on that turn. Three separate paths escalate to a human: an intent the
bot is not scoped for, a lookup that raises, and a verifier mismatch.

## Status

Built and passing:

- `src/tools.mjs` — retrieval against `compute_booking_total`, `compute_booking_advance`,
  `get_cafe_booked_slots`. Anon key only; all three grant EXECUTE to anon.
- `src/verify.mjs` — the money guardrail. 10/10 self-tests pass.
- `src/catalogue.mjs` — live proof of what is sellable.
- `src/brain.mjs` — provider-agnostic tool-use loop with the hard rules in the system prompt.
- `src/providers/anthropic.mjs`, `src/providers/gemini.mjs` — two adapters behind one
  interface. 18/18 wire-format checks pass with no API key needed.
- `replay/` — the Phase 1 exit gate.

Not built yet: the WhatsApp transport. Deliberate — the core is transport-agnostic so
the BSP-vs-Cloud-API decision does not block anything.

## Run it

Zero dependencies. Node 20.6+ (uses built-in `fetch` and `--env-file`).

```
npm run selftest          # guardrail + both provider wire formats. No network, no keys
npm run catalogue         # live: what the bot can quote, priced through the real RPC
npm run replay            # cases through whichever provider BOT_PROVIDER names
npm run replay:both       # run the same cases through Gemini and Anthropic, compare
```

`.env` already has the Supabase publishable key. Add a provider key for `replay`.

## Switching brains

`BOT_PROVIDER=gemini|anthropic` in `.env`. Defaults: `gemini-3.5-flash` and
`claude-haiku-4-5`. `BOT_MODEL` overrides.

Gemini 3.5 Flash is the default because this is a tool-use agent and it leads that
lane decisively (agentic 51.8 vs 27.0; Terminal-Bench 74.2% vs 43.8%). At ~900
conversations a month the whole LLM line is Rs 542-1,625 either way — about a tenth of
one booking. Do not economise here.

### Free vs paid, and the billing trap

Free tier is fine for `npm run replay` — synthetic cases, no real customer data, and the
Gemini adapter retries 429s with backoff. It is **not** fine once a real customer
message reaches the bot: free-tier inputs and outputs may be used to improve Google's
models, and this bot handles names, phone numbers and the fact that someone is planning
a proposal.

**Do not just enable billing on the free project.** Enabling billing *deletes* that
project's free tier — every call becomes billable from the first token, with no hybrid
and no easy way back. Run two projects instead:

| | project | key | used for |
| --- | --- | --- | --- |
| dev | billing off | current key | `npm run replay`, local work |
| prod | billing on | new key | shadow mode and live |

Tier 1 (paid) is 150-300 RPM against a peak need of maybe 15 — roughly 20x headroom.
Cost at ~900 conversations/month is about Rs 1,625, a sixth of one booking.

Keep the prod key out of anything that loops: a replay run pointed at the billed project
is the classic source of a surprise bill.

Adding a third provider means one file in `src/providers/` exporting `name`,
`defaultModel`, `envKey`, `toWire`, `toolsToWire` and `complete`. `tools.mjs` and
`verify.mjs` are provider-blind and never change.

> Note: the npm registry and DNS are blocked inside the Claude device sandbox, so these
> were verified in a cloud container. Run them from your own terminal.

## Scope of v1

`BOT_VENUE_IDS=14` — Beige Cafe only. That is 13 of 17 confirmed picnics and 79% of
picnic revenue, and it is the only NCR venue the pricing system can quote at all.

A venue with no `venue_packages` rows makes `compute_booking_total` raise
`PACKAGE_NOT_AVAILABLE`. `loadCatalogue` drops such venues so they can never reach the
model. Verified: with `BOT_VENUE_IDS=14,18,19`, The Sunroom (18) is silently excluded.

To widen scope, backfill `venue_packages` first, re-run `npm run catalogue`, then add
the id. Never add an id without the backfill.

## Rules the build must not break

1. No discount authority, ever. A discount request escalates.
2. Retrieval, never generation, for prices and availability.
3. Resolve venue and add-on ids live — there are two "House of Amer" rows and duplicate
   add-on names. Never bake an id into a prompt.
4. The bot does not confirm bookings or take payment in v1.
5. It says it is an assistant, once, early.
6. Two follow-ups maximum, then stop. Blocks drive the WhatsApp quality rating.

## Next

1. Log real conversations during the manual fortnight — they become `replay/cases.json`.
2. Choose transport: BSP (inbox + templates included) or Cloud API direct (no markup,
   you build the inbox). Write the adapter against `respond()` in `src/brain.mjs`.
   Transport and brain are independent — neither decision blocks the other.
3. Shadow mode: bot drafts, human sends. Gate is two weeks at >=70% sent unedited and
   zero pricing errors.
