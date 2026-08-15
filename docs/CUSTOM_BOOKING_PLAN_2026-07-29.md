# Custom / bespoke booking support — implementation plan

**Date**: 2026-07-29
**Status**: PLAN ONLY — nothing here has been applied. No DB, RPC, edge function or file changed. No test rows created.
**Trigger**: booking #75 (Madhvi Rattan) sent a confirmation email reading "INCLUDED: 3 food items · 2 beverages" because it was inserted with `package_key = null`. Investigating surfaced a wider gap: bespoke setups cannot state what they include, and the venue F&B line is gated on the wrong signal.
**Decision taken 2026-07-29 (operator)**: whether a cafe package includes F&B **depends on the deal** → the fix must be a per-booking override, not a global rule.

---

## 0. If you read one section

Phase 1 (§6) fixes the reported bug and is fully reversible in under a minute. It is additive-only: two nullable columns, two RPC bodies, one edge-function branch that reproduces today's behaviour byte-for-byte when the new column is null. **Everything else is optional and can be deferred indefinitely.**

**First action**: apply the migration in §3.1 and immediately re-probe `information_schema.columns` to confirm both columns landed. Nothing else moves until that returns two rows.

---

## 1. What already works (probed live 2026-07-29 — not read from docs, memory or handoffs)

Most of "everything is custom" already exists. Per CLAUDE.md §2, each row below names the live probe it came from.

| Requirement | Status | Probe + evidence |
|---|---|---|
| Custom venue | **Live** | `select … from venues` → `type='custom'`, id 5 "Your Own Space", `is_active=true`. Free-text `venue_address` written at `app.js:9826`. |
| Custom price | **Live** | `pg_get_functiondef` on both admin RPCs → `total_amount = nullif(p_booking->>'total_amount','')::numeric`. Verbatim, no formula (§7). |
| Custom advance | **Live** | Same probe → `advance_amount = coalesce((p_booking->>'advance_amount')::numeric, 0)`. **Exception**: `admin_edit_booking` freezes the advance when `payment_status='paid'` (records what Razorpay actually charged) and raises if `total < advance` (no-refunds rule). |
| Custom add-ons | **Live at DB/RPC, missing in UI** | `information_schema.columns` → `booking_add_ons.addon_id` is **nullable**; `pg_constraint` → FK is `ON DELETE SET NULL`; `name` NOT NULL default `''`, `price_at_booking` NOT NULL default 0. Both RPCs do `(a->>'addon_id')::int` with **no validation against `add_ons`** — a null id inserts cleanly today. `splitAddons()` in `notify-booking-received` already routes null-id rows to "extras" and renders them. **Only the admin UI blocks it**: `abkAddonsHtml()` (`app.js:9770`) is a checkbox list off `add_ons`; `abk.addonIds` holds integer ids only. |
| "Includes food or not" | **Missing** | Not representable per booking. See §2. |
| What the setup includes | **Missing** | No field. `packages.inclusions` (jsonb) exists for defined tiers but `notify-booking-confirmed` never renders it. |

**No other consumer reads what we're adding.** Verified by inspecting every reader of `bookings`: the four other edge functions (`post-event-nudge`, `lead-digest`, `export-ical`, `create-order`) select explicit column lists that cannot include columns that don't exist yet; `scripts/google-sheet-sync.gs` likewise selects an explicit list. Adding columns is inert to all of them.

### Why NOT a `packages` row

- `loadPackages()` (`app.js:1505`) and `abkPackagesForVenue()` (`app.js:9431`) read the **same** source. A package lists publicly when `is_active=true`; the admin dropdown only shows it if a `venue_packages` row exists. So a "Custom" package either appears on picnicstories.com as a bookable tier, or is invisible in the admin dropdown. Neither works without a code special-case — at which point it isn't reuse.
- A package is a **shared, venue-priced, reusable definition** carrying one `inclusions` list. A bespoke setup is a **one-off** whose inclusions differ every time. One shared list cannot express them.
- `package_key` is *already* overloaded as an F&B switch — that overload caused the #75 email. `package_key='custom'` would overload it again and in the worst direction: suppressing the F&B line on exactly the bookings where inclusions are least certain. It would encode the bug into the fix.

---

## 2. The F&B gate is on the wrong signal

`notify-booking-confirmed` (live **v27**, `verify_jwt=false` — both confirmed via `get_edge_function` / `list_edge_functions`):

```ts
const inclusionText = record.package_key ? "" : await getInclusionText(record.venue_id, adults)
```

`getInclusionText` reads `venues.metadata.food_multiplier` / `drink_multiplier`. Live values, all active venues:

| Type | Venues | food_mult | drink_mult |
|---|---|---|---|
| `cafe` | Beige (14), The Sunroom (18), Castle Valley (19), Om Niwas (20), Once Upon A Time At The Bagh (21), House of Amer (24) | 1.5 | 1 |
| everything else | combo / self_managed / partner_bnb / custom | null | null |

Effective behaviour today: "cafe ⇒ show, everything else ⇒ hide", *unless* a package is attached, in which case it silently vanishes. Since inclusion depends on the deal, neither "always show" nor "hide when packaged" is right. It needs a per-booking override.

---

## 3. Proposed change

### 3.1 Schema — one migration, additive only

Both columns are **reporting/presentation**. Neither is a money source; `total_amount` stays authoritative (§7 unchanged).

```sql
-- supabase/migrations/20260729_add_custom_booking_fields.sql
alter table public.bookings
  add column if not exists custom_inclusions  jsonb   not null default '[]'::jsonb,
  add column if not exists include_venue_fnb  boolean;          -- nullable ON PURPOSE

comment on column public.bookings.custom_inclusions is
  'Per-booking "what is included" bullets for bespoke setups. jsonb array of strings. Snapshot at booking time, no FK, never backfilled — same convention as package_name/package_tagline (CLAUDE.md §6).';
comment on column public.bookings.include_venue_fnb is
  'Per-booking override for the venue food/drink line in the confirmation email. NULL = default rule (show when package_key is null); TRUE = force show; FALSE = force hide. Three-state on purpose so every existing row renders exactly as it does today.';
```

`jsonb` (not `text[]`) to match the existing `packages.inclusions` column type.

**Rollback**: none needed. Both columns are additive with safe defaults and nothing reads them until §3.3 ships. If the project is abandoned mid-way, **leave the columns in place** — dropping a column that has acquired real data is the destructive act, not keeping an unused one.

### 3.2 Semantics — decide these before writing code

These are the cases that produce a wrong customer email if left implicit:

1. **Both `package_key` and `custom_inclusions` set** → render **both**, package block first, then a "Also included" block. A bespoke add to a standard tier is a real scenario (#75 was arguably one). Do *not* make them mutually exclusive.
2. **Switching a booking back to a package** → the operator must clear the inclusions textarea themselves; `admin_edit_booking` writes whatever the form sends. Do **not** auto-clear `custom_inclusions` when `package_key` becomes non-null — silent data loss on a snapshot column violates §6.
3. **Stale `include_venue_fnb` after a venue change** → if the new venue has no F&B multipliers, `getInclusionText` returns `""` regardless of the override, so a stale `true` is inert. No cleanup needed; the UI hides the control for such venues (§3.4.3).
4. **Empty inclusions + `include_venue_fnb = false`** → the email states nothing about what's included. Acceptable and intentional: silence is better than a wrong promise. The operator sees the field is empty when they tick the box.

### 3.3 RPC changes — signatures must NOT change

Both fields ride inside the existing `p_booking jsonb`. **No `DROP FUNCTION`, no new parameters** (§4 — a second overload makes PostgREST ambiguous and breaks the frontend; this is why `submit_booking_intent` still carries an unread `p_advance_amount`).

- `admin_add_manual_booking(p_booking jsonb, p_add_ons jsonb)` — add to the INSERT:
  ```sql
  custom_inclusions = coalesce(p_booking->'custom_inclusions', '[]'::jsonb),
  include_venue_fnb = (p_booking->>'include_venue_fnb')::boolean   -- null when key absent
  ```
- `admin_edit_booking(p_booking_id bigint, p_booking jsonb, p_add_ons jsonb)` — same two assignments in the UPDATE SET list.
- `admin_resend_confirmation` — **no change.** It posts `to_jsonb(b.*)`, so new columns ride automatically.

Migrations: `20260729_admin_add_manual_booking_custom.sql`, `20260729_admin_edit_booking_custom.sql`. Apply via `apply_migration` **and** write the repo file, same session (§4).

**Rollback**: re-apply the current function bodies, captured verbatim via `pg_get_functiondef` **before** the first edit and saved to `docs/rollback/20260729_rpc_before.sql`. Capturing this is a prerequisite, not an afterthought — do it first.

### 3.4 Edge function — `notify-booking-confirmed`

**1. Replace the gate** with three-state resolution. Backward compatible by construction: `include_venue_fnb` is null on every existing row, so the fallback branch is today's logic unchanged.

```ts
const fnbOverride = record.include_venue_fnb        // true | false | null | undefined
const showFnb =
  fnbOverride === true  ? true  :
  fnbOverride === false ? false :
  !record.package_key                                // unchanged default
const inclusionText = showFnb ? await getInclusionText(record.venue_id, adults) : ""
```

**2. Add a "What's included" block** rendered from `record.custom_inclusions`, placed directly above `extrasSection(addons)`. Reuse the visual language of `packageInclusionsSection()` from `notify-booking-received` so the two emails stay consistent. Must be applied to **both** `buildPicnicEmail()` and `buildStayEmail()` — v26 deliberately split them, and editing one is a silent half-fix.

Deploy rules (§4): fetch live source via `get_edge_function` as the editing base (never the repo file — it has been broken-stale before); esbuild bundle-check a `/tmp` copy (never the mount, §3.4); deploy with **`verify_jwt=false` preserved** (checked in `list_edge_functions` first — the wrong flag silently kills trigger-driven email); then sync `supabase/functions/notify-booking-confirmed/` to byte-match what was deployed.

**Rollback**: Supabase keeps prior versions. Revert = redeploy **v27** with `verify_jwt=false`. Note the current version number before deploying so the target is unambiguous. Estimated revert time: under 2 minutes.

### 3.5 Admin form (`app.js`, `abk` module)

1. **Custom add-on rows.** New state `abk.customAddons: [{name, price}]` **alongside** `abk.addonIds` (which stays integer-only — do not overload it, that is the same class of mistake as `package_key`). Render "+ Add custom item" under `abkAddonsHtml()` (`app.js:9770`). In `abkSave()` (`app.js:9835`) append as `{addon_id: null, name, price, requires_confirmation: false}`. Include in the total prefill at `app.js:9458`.
2. **Inclusions textarea** — one bullet per line, split to an array on save → `custom_inclusions`.
3. **F&B select** — "Venue default" / "Yes — include food & drinks" / "No — not included". Render **only** when the selected venue has `metadata.food_multiplier`; noise otherwise. `abk.venues` already loads `metadata` (`app.js:9391`), so no extra fetch.

Standard `abk` plumbing for each: state init (`app.js:9372`), `abkResetForm` (`app.js:9511`), `abkRead` (`app.js:9484`), `abkSave` payload (`app.js:9831`), `abkStartEdit` prefill (`app.js:9917`).

---

## 4. 🔴 Traps that cause real damage if missed

1. **`admin_edit_booking` deletes and re-inserts every add-on.** Confirmed in the live body: `delete from public.booking_add_ons where booking_id = p_booking_id;` then re-insert from `p_add_ons`. `abkStartEdit` rebuilds `abk.addonIds` by matching `addon_id` against `add_ons` — a custom add-on has `addon_id = null` and **matches nothing**. Opening such a booking in the edit form and saving will **silently delete it**, and the money it represented vanishes from `booking_add_ons` while `total_amount` stays put. **Guard**: the `abkStartEdit` round-trip into `abk.customAddons` must be written and tested *before* the "+ Add custom item" control is ever exposed. This is why Phase 3 is last.
2. **No staging.** Every migration, RPC and deploy is production on landing (§1). The confirmation email is customer-facing — a broken template reaches a real guest immediately.
3. **`verify_jwt = false` on `notify-booking-confirmed`.** Check `list_edge_functions` *before* deploying, not after.
4. **Do not backfill.** Existing rows keep `custom_inclusions='[]'` and `include_venue_fnb=null`. Snapshot columns are history (§6).
5. **Timing.** Do not deploy §3.4 while a booking is being entered in the admin panel, and prefer a window with no event in the next 48h (post-event-nudge and confirmations both touch guest inboxes). The `lead-digest-daily` cron is 03:30 UTC and `post-event-nudge-daily` 04:30 UTC — avoid those windows.
6. **Google Sheet sync unaffected** — explicit column list, and neither new column is a money figure. Separately: `scripts/google-sheet-sync.gs` still carries an **uncommitted** change from 2026-07-27 that has not been pasted into either Apps Script editor. Unrelated to this work; do not bundle them.

---

## 5. Verification — the §11 gate, written to be executable

### 5.1 RPC branch tests (rolled back, nothing persists)

Run as `DO $$ … RAISE EXCEPTION 'RESULT %' … $$`. Resolve the admin email from the live function body via `pg_get_functiondef` — **do not copy it from this document.**

| # | RPC | Input | Expected |
|---|---|---|---|
| 1 | add | no `custom_inclusions`, no `include_venue_fnb` keys | `'[]'::jsonb`, `null` |
| 2 | add | `custom_inclusions: ["Bespoke floral arch","Live saxophonist"]`, `include_venue_fnb: true` | stored verbatim, `true` |
| 3 | add | `include_venue_fnb: false` | `false` (not null — distinguishes "explicitly no" from "unset") |
| 4 | add | add-on with `addon_id: null`, name + price | inserts; `name`/`price_at_booking` correct |
| 5 | edit | set both fields on an existing row | both updated; `confirmed`/`payment_status`/`entry_source` untouched |
| 6 | edit | row with `payment_status='paid'` | advance still frozen; new fields still written (no interaction) |
| 7 | edit | `total_amount` < stored advance | still raises the no-refunds exception (regression check) |
| 8 | edit | row that already has a `addon_id = null` add-on; `p_add_ons` re-sends it | add-on survives with same name + price. **This is trap §4.1 as a test.** Run it before Phase 3 UI work starts, not after. |

Then `get_advisors`; explain any new warning.

### 5.2 Email render check — method, not gesture

Extract both builders into a standalone `/tmp` script driven by sample record objects (this is exactly the harness v26 used for its whitespace-normalised diff — precedent exists in the function's own header comment). Render the matrix and read the HTML:

`{package, no package} × {override true, override false, override null} × {picnic, stay}` = 12 outputs.

**Phase 1 assertion**: the six `override = null` cases must be **byte-identical** to v27's output for the same record. That is the backward-compatibility proof and the single most important check in this plan.

**Phase 2 assertion** (the block is added, so identity narrows): the six `override = null` cases must be byte-identical to the **Phase-1 build** whenever `custom_inclusions` is empty — i.e. the new block renders nothing at all, not an empty container with padding. Compare against the Phase-1 build, not against v27; v27 is no longer the baseline once Phase 1 lands.

### 5.3 Live smoke test (`picnic-smoke-test`)

- Temp booking through the **real** path — `admin_add_manual_booking`, so the insert trigger fires. Guest email `aksheevs+custominc@gmail.com`. **Never a real customer address.**
- Confirm via `get_logs` that `notify-booking-confirmed` returned 200 and Resend accepted (the fn logs the Resend message id).
- Delete the booking row **and** its `booking_add_ons` children; prove `count(*) = 0` for the test phone and email. A 503 mid-delete has happened before — retry and re-verify, never assume.
- Tell the operator which admin-alert emails in team@ to ignore.

### 5.4 Frontend

Trusted-copy `node --check` on `app.js` (Read-tool output → `/tmp`, per §3.4). Read-tool review is not a parse. Admin form rendering is a **browser-eyeball item** — hand over explicitly as owed-by-user.

### 5.5 Cannot be verified by me — owed by user

The visual appearance of the new inclusions block in a real inbox, on mobile.

---

## 6. Phases — each with an owner, an exit condition, and a way back

| Phase | Scope | Owner | Size | Exit condition (observable) | Revert |
|---|---|---|---|---|---|
| **0** | Capture current RPC bodies + edge fn version to `docs/rollback/`. | Claude | ~10 min | `docs/rollback/20260729_rpc_before.sql` exists; v27 recorded. | n/a |
| **1** | Migration + both RPCs + `include_venue_fnb` branch in `notify-booking-confirmed`. **Fixes the #75 bug.** | Claude | 1 migration, 2 RPC bodies, ~6 lines of TS | §5.1 tests 1–7 pass; §5.2 Phase-1 assertion holds; §5.3 smoke test 200 + zero residue. | Redeploy v27; re-apply Phase-0 RPC bodies. Leave columns. **<5 min.** |
| **2** | `custom_inclusions` textarea + email "What's included" block. | Claude builds; **user eyeballs the email** | ~1 form field + 1 HTML block × 2 builders | §5.2 Phase-2 assertion holds; a test booking with two inclusions renders both as bullets in a real inbox. | Redeploy the Phase-1 function build. |
| **3** | Custom add-on rows in the admin UI. | Claude builds; **user eyeballs the form** | New state array + render + save + prefill round-trip — the largest of the three | §5.1 test 8 passes, **then** round-trip proven end-to-end: create booking with a custom add-on → open in edit form → save → add-on **still exists**, same name and price. Do not ship without this exact test passing. | Revert the `app.js` block; DB rows are unaffected. |
| **4** *(separate decision, not part of this request)* | Render `packages.inclusions` so defined packages also list inclusions. Note `package_add_ons` for `setting` is currently empty, so this may surface nothing until packages are populated. | — | — | — |

### 6.1 The case for building less

Before committing to Phases 2–3, weigh them against doing nothing, because the volume argument cuts hard:

- Real leads run ~3–7 per 60 days (§8), of which bespoke setups are a subset. Phase 3 may be built for **one or two bookings a month**.
- **A zero-code alternative already exists for custom add-ons**: fold the amount into `total_amount` and record the split in `discount_amount` — negative means an extra earned at the event. That is exactly the pattern booking #60 (BEIGE-004, `discount_amount = −2952`) already uses, and the sheet already derives `Base Package = total − add-ons + discount` from it. The cost is that the guest's email doesn't itemise the extra.
- **A near-zero-code alternative exists for inclusions too**: the operator could keep writing them in the WhatsApp thread, as presumably happens today.

So the honest framing: **Phase 1 is a bug fix and should ship. Phases 2–3 are a convenience purchase.** Phase 2 is cheap enough to be worth it if bespoke setups happen at all regularly. Phase 3 is the expensive one and carries the only dangerous trap in the plan (§4.1) — build it only if the `discount_amount` workaround is actively causing confusion, not pre-emptively. Reassess after Phase 2 has been live for a few bookings.

**Abort triggers** — stop and revert immediately, don't debug forward:
- Any real (non-test) confirmation email goes out wrong during the window.
- `get_logs` shows a non-200 from `notify-booking-confirmed` on a real booking.
- §5.2's byte-identity check fails and the cause isn't understood within one attempt.

**Phase 1 alone resolves the reported problem.** Phases 2–3 deliver the bespoke capability and can be deferred indefinitely without leaving anything half-built.

---

## 7. Success signals — how you'll know it worked, in production

1. The next bespoke booking at a cafe where F&B is **not** included shows **no** food/beverage line, without needing a package to be attached as a workaround.
2. A packaged booking where F&B **is** included now shows it — previously impossible.
3. Zero regressions: for 30 days after Phase 1, every confirmation email on a booking with `include_venue_fnb IS NULL` **and** empty `custom_inclusions` matches what the pre-change build would have produced. Spot-check the first three against the §5.2 harness output rather than by eye.
4. Custom add-on money reconciles: `total_amount − Σ booking_add_ons.price_at_booking` stays consistent with the sheet's Base Package derivation, and no add-on disappears after an edit.

---

## 8. Explicitly out of scope (and why)

- **`notify-booking-received`.** `admin_add_manual_booking` always inserts `confirmed=true`, and that function skips the guest ack for confirmed rows. So no admin bespoke booking ever produces a T1 ack. Its `splitAddons` / `packageInclusionsSection` logic only affects site bookings, which aren't bespoke. Untouched.
- **Site-facing bespoke bookings.** Guests cannot request a custom setup on the storefront; this is an admin-entry capability only. No change to `submit_booking_intent` or the public flow.
- **Pricing logic.** `compute_booking_advance` / `compute_booking_total` untouched. Admin flows take entered totals verbatim (§7) and that stays true.

---

## 9. Open items carried from the #75 investigation

- **Booking #75 money mismatch, unresolved.** `package_key='setting'` (Beige list ₹8,900) + Skyshots ₹4,000, but `total_amount = 25,000` — exactly Beige's price for **The Story**. `advance_amount = 7,500` is a clean 30% of 25,000, so the total looks deliberate and the package label looks like the mis-pick. The guest's email reads "PACKAGE: The Setting · TOTAL ₹25,000". If it should be The Story: edit + resend. **Operator's call — not changed.**
- **Booking #61 (Maheep) still has `preferred_date = '0026-07-25'`** (year 0026). Carried from the 2026-07-27b handoff, still not corrected.
- The guest on #75 received **two** confirmation emails (13:45:44 and 13:49:18 UTC). The second is correct and supersedes the first.
