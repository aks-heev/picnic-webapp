# PLAN — Package price table: food / guests / weekday-weekend / Countryside cottages

Status: Phase 0 done; **Phases 1–3 SHIPPED-verified 2026-10-21.** Phases 4–6 NOT done. Written 2026-10-21 via plan-optimizer (score 88/100, trajectory 66 → 78 → 86 → 88 → 88).
Supersedes nothing; extends `SPEC_stored_package_pricing_2026-07-10.md` (one price per venue × package) to many prices per venue × package.
Source of the numbers: OneDrive `Ledger Picnic stories.xlsx` → Packages tab (read 2026-10-21) + Aksheev's answers in chat the same day.

## 0. Goal and definition of done

Every price on the website, in the brochure grid, in emails and in the amount Razorpay charges comes from ONE table (`package_prices`),
read by ONE function (`compute_booking_total`). Done when:

1. An assertion query shows **0 mismatches** between `package_prices` and the price list in §2 (every cell, incl. midpoints).
2. Rolled-back DO-block tests show every existing price that is NOT supposed to change (Beige no-food, all non-package venues, stays) is **byte-identical** to today.
3. A real-path smoke booking (via `submit_booking_intent`, test phone, then deleted with `count(*)=0` proven) stores `total_amount`, `advance_amount`, `with_food`, `food_credit` exactly as §2 predicts.
4. The brochure grid renders "from ₹X" per package × venue straight from the table, with no price typed into HTML.

## 1. Decisions already made (Aksheev, 2026-10-21)

- Food pricing in the sheet is final, even though it is not a formula. → Prices are **stored**, never computed from multipliers.
- Without food: price does not depend on guest count (Prelude covers up to 4, the others up to 6).
- With food: priced by guest count. 2/4/6 come from the sheet; **3 and 5 are the midpoint, rounded up to the next ₹100** — with-food only.
- Prelude is capped at 4 guests (sheet's 6-guest Prelude ignored).
- Countryside: couples only (cottage holds 2). Two cottages, both bookable the same night → **two stay listings**. Stay ₹5,000/night small, ₹7,000/night big. Countryside is request-based (no Airbnb links/iCal yet).
- A guest may book the Countryside stay themselves and buy only the picnic from us → picnic-only at Countryside stays sold.
- Sunroom: food credit = that much of the food bill is covered; anything above is paid by the guest; unused credit lapses.

## 2. The price list (seed data)

Without food (guests not a dimension):

| Venue | Prelude | Setting | Moment | Story |
|---|---|---|---|---|
| Beige Cafe | 5,900 | 8,900 | 12,900 | 24,900 |
| Countryside picnic (venue 27) | 5,900 | 8,900 | 12,900 | 24,900 |

With food:

| Venue | Guests | Prelude | Setting | Moment | Story |
|---|---|---|---|---|---|
| Beige | 2 | 7,399 | 9,900 | 13,900 | 25,900 |
| Beige | 3 | 8,100 (mid 8,049) | 11,400 | 15,400 | 27,400 |
| Beige | 4 | 8,699 | 12,900 | 16,900 | 28,900 |
| Beige | 5 | — | 14,400 | 18,400 | 30,400 |
| Beige | 6 | — | 15,900 | 19,900 | 31,900 |
| Countryside picnic (27) | 2 only | 7,399 | 9,900 | 13,900 | 25,900 |

Countryside picnic + stay = nights × cottage rate + venue 27 picnic price. Expected 1-night totals (must reproduce the sheet):

| | Prelude | Setting | Moment | Story |
|---|---|---|---|---|
| Small, no food | 10,900 | 13,900 | 17,900 | 29,900 |
| Big, no food | 12,900 | 15,900 | 19,900 | 31,900 |
| Small, with food | 12,399 | 14,900 | 18,900 | 30,900 |
| Big, with food | 14,399 | 16,900 | 20,900 | 32,900 |

Sunroom — "Setting" only, always with food credit:

| Guests | Weekday | Weekend | Food credit |
|---|---|---|---|
| 2 | 13,900 | 15,900 | 3,000 |
| 3 | 14,900 | 16,900 | 4,000 |
| 4 | 15,900 | 17,900 | 5,000 |
| 5 | 16,900 | 18,900 | 6,000 |
| 6 | 17,900 | 19,900 | 7,000 |

More than 6 guests anywhere → custom quote (WhatsApp/Instagram), not self-serve.

## 3. Decision gates — DECIDED by Aksheev 2026-10-21

| # | Question | Decision |
|---|---|---|
| G1 | Which days are "weekend" at Sunroom? | Saturday + Sunday, by event date |
| G2 | Sunroom food credit for 3 and 5 guests | 4,000 / 6,000 |
| G3 | Sunroom package key | reuse `setting` |
| G4 | Brochure "from" price | both: "from ₹5,900 · with food from ₹7,399" |
| G5 | Venue 22 (old single Countryside stay listing) | deactivate once the two cottage venues exist; its bookings untouched |

## 4. Schema

New table `public.package_prices`:

```
id            bigint generated always as identity primary key
venue_id      bigint  not null references venues(id)
package_id    bigint  not null references packages(id)
with_food     boolean not null
guests        integer null      -- null = any guest count (no-food rows)
day_type      text    not null default 'any' check (day_type in ('any','weekday','weekend'))
price         numeric not null check (price >= 0)
food_credit   numeric null check (food_credit >= 0)   -- Sunroom-style credit; null = food served, no credit
is_active     boolean not null default true
unique (venue_id, package_id, with_food, coalesce(guests,0), day_type)   -- via unique index on expression
```

- RLS on, **anon SELECT allowed** (prices are public, brochure needs them), INSERT/UPDATE/DELETE admin-email only.
  🔴 Do NOT copy the blanket-authenticated write policy of `venue_packages` (known hole, see memory `rls-authenticated-write-holes`).
- Midpoints are stored as rows, not interpolated at runtime — one place to read, editable by hand later.
- `bookings` gets two nullable snapshot columns: `with_food boolean`, `food_credit numeric`. No backfill (old rows = null = "not recorded").
- View `public.package_price_grid` (`security_invoker = true`): per active venue × active package, `min(price) filter (where not with_food)` and `min(price) filter (where with_food)`, plus `food_credit` for the min row. Excludes `date_night_*` / `movie_night_*` keys (dropped 2026-10-11). This is the ONLY thing the brochure reads.

## 5. Pricing function

`compute_booking_total` gains two **defaulted** params: `p_with_food boolean default false`, `p_date date default null`.
Same migration DROPs the 6-arg version so exactly one overload exists (PostgREST ambiguity rule). Every existing caller —
`compute_booking_advance`, `submit_booking_intent`, both admin RPCs, `app.js:6489` (named args) — keeps resolving with no edit.

Resolution for the picnic part, in order:
1. If `package_prices` has ANY active row for (venue, package): use it.
   - `with_food = p_with_food`; guests: no-food → the `guests is null` row; with-food → exact `guests = p_billing_guests` row.
   - day_type: row matching the weekday/weekend of `p_date` (IST), else the `'any'` row.
   - No matching row → `RAISE 'PRICE_NOT_AVAILABLE'` (e.g. Prelude for 5, Countryside with food for 3). Never fall through to a guess.
2. Else: today's `venue_packages.price` path, untouched (keeps every venue not yet migrated working).

The picnic_stay branch already prices the picnic from the twin (`picnic_venue_id`) and adds `nights × stay rate`. It passes
`p_with_food`/`p_date` down to the twin lookup. Add-ons stay at the outer level, as today.

`compute_booking_advance` gains the same two defaulted params and passes them through (still 30%, still the only place the rate lives).

## 6. Phases (each phase is independently shippable and leaves production consistent)

**Phase 0 — verify live (read-only, ~30 min).** Re-probe before building:
`pg_get_functiondef` of compute_booking_total / advance / submit_booking_intent / both admin RPCs; where the picnic_stay branch reads
the nightly rate (base_price vs metadata.tiers — venue 22 has tiers 9,900/12,900/15,900); how `requires_confirmation` makes a
booking request-only in `submit_booking_intent`; every booking at venues 22 and 27; `packages_enabled` on Sunroom (18).
Save each current function body to `supabase/migrations/_rollback/20261021_*.sql` — that is the rollback.
Exit: a short findings note; any finding that contradicts §5 stops the plan for a rewrite.

**Phase 1 — table + seed (inert; nothing reads it yet).** Migration `20261021_package_prices.sql`: table, index, RLS, the §2 seed
resolved by `venues.name`/`packages.key` at apply time (never hardcoded ids), grid view.
Exit: assertion query — §2 as a VALUES list full-outer-joined to the table → **0 rows differ, row count = 40**
(Beige 4 no-food + 18 with-food; venue 27 4 + 4; Sunroom 10 → recount at build time and fix the number here if the gates change it).
`get_advisors` shows no new finding.

**Phase 2 — pricing function.** Migration `20261021_compute_booking_total_price_table.sql` (defaulted params, drop old overload,
§5 resolution; advance passthrough). Edit from the LIVE body, then diff old vs new text programmatically — only intended lines may change.
Exit — rolled-back DO block, assertions in the RAISE message:
- Regression: for every active (venue, package) not in `package_prices`, and every stay/combo/custom venue, old fn = new fn. Run the old
  body as a temp function inside the same txn to compare.
- Every §2 cell reproduced (no-food, with-food 2–6, Sunroom weekday/weekend on a known Sat and Wed).
- Countryside picnic-only (venue 27): 5,900 / 7,399 for Prelude.
- `PRICE_NOT_AVAILABLE` for Prelude 5 guests and venue 27 with food 3 guests.
- Advance = 30% of each.

**Phase 3 — persist the choice.** `bookings.with_food`, `bookings.food_credit`; `submit_booking_intent` gets `p_with_food boolean default false`
(drop old overload in the same migration), passes `p_with_food` + `p_preferred_date` to compute, writes the snapshots.
Admin RPCs take totals verbatim → do NOT edit them; add `admin_set_booking_food(bigint, boolean, numeric)` (same pattern and
admin guard as `admin_set_booking_split`). Exit: DO-block insert via the real RPC, read back, roll back; residue `count(*)=0`.

**Phase 4 — Countryside listings.** Two stay venues ("Countryside Offgrid — Small Cottage" ₹5,000/night, "— Big Cottage" ₹7,000/night),
type matching venue 22's branch, capacity 2–2, `requires_confirmation = true`, `picnic_venue_id` = 27, request-only.
Venue 27: capacity 2–2; also set its `venue_packages.price` to the Beige numbers so any display path still reading that table agrees.
Venue 22: set `is_active=false` (G5) — ONLY after §9.6 is resolved. Exit: Phase 2's DO block re-run → the four Countryside picnic+stay rows in §2 reproduce exactly (1 night),
and 2 nights adds exactly 5,000 / 7,000.

**Phase 5 — frontend, prerender, emails.**
- Booking flow: "With food" toggle after the package step; price shown comes from an RPC call, never local arithmetic.
  🔴 `abkComputeTotal` (app.js ~11583) mirrors the SQL — either delete the mirror and call the RPC, or extend it and add a parity check.
  Mirrors are how the 50% advance bug happened.
- Sunroom: no toggle (always with food); show "₹3,000 food & drinks covered — anything above is paid at the café; unused credit lapses."
- Brochure grid + `scripts/prerender-venues.mjs`: read `package_price_grid` at build time.
- `notify-booking-received` / `notify-booking-confirmed`: add a "Food: included / not included / ₹X credit" line from the booking snapshot
  (emails read the booking only — rule from the v30 food-inclusion fix). Keep `verify_jwt=false`; fetch live source first; esbuild check.

**Phase 6 — smoke test + handoff.** Real-path bookings with `aksheevs+pricing@gmail.com` / a test phone: Beige with food 3 guests,
Sunroom weekend 4 guests, Countryside small cottage 1 night with food. Stop at the Razorpay modal (never charge). Delete rows + children,
prove `count(*)=0`. Tell Aksheev which team@ admin emails to ignore. Handoff with SHIPPED-verified / built-unverified labels.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Wrong price charged — no staging, Razorpay charges `advance_amount` as stored | Phase 1 is inert; Phase 2 ships only after the full DO-block regression; rollback bodies saved in Phase 0 |
| Second overload breaks every PostgREST call | DROP old signature in the same migration; `select count(*) from pg_proc where proname='compute_booking_total'` = 1 as an exit check |
| Weekend computed in UTC → Friday-night bookings priced as Saturday | Compute day of week from the event date (a `date`, no timezone); test a Sat and a Wed explicitly |
| Midpoint typo in seed | The §2 VALUES assertion is the seed's own test; nothing reads the table until it passes |
| Frontend mirror drifts from SQL | Remove `abkComputeTotal` arithmetic or add a parity check (Phase 5) |
| Countryside double-booked with the partner's own Airbnb guests | Request-only (`requires_confirmation`) until iCal links exist; Todoist task tracks getting them |
| Brochure resurrects dropped Date/Movie Night packages | Grid view excludes them by key |
| Old bookings misread | No backfill; null `with_food` = "not recorded" everywhere |

## 8. Out of scope (tracked separately)

- Splitting the brochure into occasion/package pages and the reel "View references" buttons — runs AFTER Phase 5, reading `package_price_grid`.
- Cottage Airbnb/iCal sync — blocked on the partner's links.
- Fixing the authenticated-write hole on `venue_packages` — existing Todoist item.

## 9. Phase 0 findings — live probe 2026-10-21 (read-only, nothing changed)

1. `compute_booking_total` / `compute_booking_advance` / `submit_booking_intent`: exactly 1 overload each. All three are
   **SECURITY DEFINER** with `search_path = public, pg_temp` — keep DEFINER (changing it would change what the anon caller can read).
2. Only DB caller of compute is `submit_booking_intent` (line 55, plus advance at 58). Admin RPCs never call it (totals verbatim) — confirmed.
   Frontend caller `app.js:6489` (admin edit recompute) uses named args → survives defaulted new params.
3. Package pricing = `price + max(guests − included_guests, 0) × overage_per_person`. Beige/27: Setting/Moment/Story include 6, ₹2,000
   per extra guest; Prelude includes 4, max 4. → No-food stays on this path for 7+ guests (no regression); with-food has no row above 6 →
   `PRICE_NOT_AVAILABLE` → custom quote, as the sheet says.
4. picnic_stay stay rate = `base_price` when `free_guests_upto` is set, else `metadata.tiers`. Venue 22: free_guests_upto null, tiers
   9,900/12,900/15,900. → New cottages: `base_price` 5,000 / 7,000, `free_guests_upto` 2, `overage_per_person` 0, empty tiers.
5. 🔴 "Request-only" is enforced ONLY in the frontend (`app.js:4487`); `submit_booking_intent` forces query mode only for `combo`.
   Acceptable today (existing behaviour), but a crafted RPC call could lock a request-only venue. Not in scope; noted.
6. 🔴 G5 trap: venue 22 has a CONFIRMED upcoming picnic_stay — booking **263, 2026-11-02, ₹14,900**. Conflict checks are per `venue_id`,
   so deactivating 22 means that night will NOT block either new cottage. **Answered 2026-10-21: booking 263 is the SMALL cottage.** Before deactivating 22,
   and Phase 4 adds a `venue_availability` block (source `admin`) on that cottage for 2026-11-02. Same check for any other future 22 booking.
7. Pending lead **276** (venue 27, Moment, 2026-10-22, unconfirmed) was quoted ₹18,900 at the old stay-inclusive price. Stored totals are
   never rewritten by this plan — Aksheev to decide the quote by hand.
8. Sunroom (18): type cafe, `packages_enabled = false`, capacity 2–10, request-only. Phase 1 must set `packages_enabled = true` and add the
   `setting` row to `venue_packages` (the package must be "offered" for the existing lookup); 7–10 guests → custom quote.
9. Pre-existing, out of scope: `app.js:6489` recompute omits `p_package_key` and hardcodes `× 0.3` → editing a packaged booking in admin
   resets its total to the venue base price. Tracked in Todoist.

## 10. Phase 1 result — SHIPPED-verified 2026-10-21

- Migration `20261021_package_prices` applied; repo file `supabase/migrations/20261021_package_prices.sql` is the same SQL.
- Seed: 40 rows. Independent checks: 21 sheet cells → 0 mismatches; 11 midpoints recomputed from neighbours (ceil to 100) → 0 mismatches;
  venue 27 rows = Beige rows → 0 mismatches; cottage totals (row + 5,000 / + 7,000) vs the sheet's 8 Countryside cells → 0 mismatches.
- `package_price_grid`: 9 rows (Beige 4, Countryside picnic 4, Sunroom 1).
- RLS (rolled-back tests): anon reads 40 rows / grid 9; anon INSERT → 42501; non-admin authenticated INSERT → 42501; admin INSERT ok. Residue: 40 rows after tests.
- Inert: 0 functions reference the table; `compute_booking_total` still returns 8,900 (Beige Setting) and 11,900 (venue 27 Prelude, old price — fixed in Phase 2/4).
- `get_advisors` security: 48 findings before and after, none naming the new table or view.

## 11. Phase 2 result — SHIPPED-verified 2026-10-21

- Applied by Aksheev in the Supabase SQL editor (the MCP `apply_migration` call was cancelled twice at the DROP-confirmation step),
  from `supabase/migrations/20261021_compute_booking_total_price_table.sql`. Because it went through the SQL editor it is NOT recorded in
  `supabase_migrations.schema_migrations` — the repo file is the record.
- Rollback: `supabase/migrations/_rollback/20261021_compute_booking_{total,advance}_before.sql` — md5 verified byte-identical to the
  pre-change live definitions (0bdff1fc… / afd2b6bf…).
- Live: exactly one overload of each function (8 args), SECURITY DEFINER, `search_path = public, pg_temp`, grants unchanged.
- Regression vs the old body (rebuilt as a pg_temp function): 5,544 combinations (every active venue × package incl. none × guests 0–10
  × nights 0–2 × slot/none × add-ons/none) → 264 differ, **0 unexpected** (all are venue 27 packages or picnic_stay via venue 22).
- 54/54 assertions: all 40 table rows; picnic_stay v22 1n Setting 18,800 (still the old 9,900 stay tier until Phase 4); Prelude food 5,
  v27 food 3, food 7+ and Sunroom-without-date → PRICE_NOT_AVAILABLE; no-food 8 guests keeps +2×2,000; Sun = weekend, Fri = weekday;
  6-arg positional advance call still works (3,870).
- Real path: `submit_booking_intent` (unchanged, calls compute positionally) in a rolled-back txn → v27 Moment total 12,900 / advance 3,870.
  Residue 0.
- `get_advisors` security: 48 before and after.
- ⚠ Until Phase 4: Countryside picnic+stay prices = 9,900/night (venue 22 tier) + Beige picnic price. Quote by hand if one comes in.

## 12. Phase 3 result — SHIPPED-verified 2026-10-21

- Applied by Aksheev in the SQL editor from `supabase/migrations/20261021_bookings_with_food.sql` (not in migration history; repo file is the record).
- `bookings.with_food boolean`, `bookings.food_credit numeric` — 0 existing rows non-null (no backfill).
- `submit_booking_intent`: exactly one overload (21 args, `p_with_food boolean default false`), SECURITY DEFINER, ACL unchanged.
  Generated from the md5-verified live body by 7 exact one-occurrence replacements; rollback `_rollback/20261021_submit_booking_intent_before.sql` (md5 bc352562…).
- `admin_set_booking_food(bigint, boolean, numeric)`: INVOKER, admin-email guard, EXECUTE revoked from public/anon.
- Live tests (rolled back, residue 0): website's current named-arg call (no food) → 12,900 / 3,870 / with_food=false;
  Story with food 3 → 27,400 / true; admin helper: non-admin "Admin login required", admin sets true/3,000 without touching the total,
  negative credit refused. Pre-apply tests also covered: update path keeps the same id, children not billed, food 7 → PRICE_NOT_AVAILABLE,
  Sunroom Sat 3 guests → 16,900 with credit 4,000 (using a temporary venue_packages row).
- 🔴 Sunroom is still NOT bookable: `submit_booking_intent` requires a `venue_packages` row (offering + max_guests). Phase 4 adds
  `venue_packages(18, setting, max_guests 6)` and `packages_enabled = true`.
- `get_advisors` security: 48 findings, same set (two pricing fns + submit appear under their new signatures, as before).
