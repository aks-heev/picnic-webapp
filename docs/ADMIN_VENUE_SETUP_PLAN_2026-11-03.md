# Admin venue setup — simplification plan (2026-11-03)

Produced via plan-optimizer (rubric → score → critique → rewrite). Trajectory **49 → 74 → 86 → 88 (plateau)**.
All facts below were probed live on 2026-11-03; re-verify before building (CLAUDE.md §2).

## Goal

An admin can take a new picnic venue from nothing to bookable **entirely in the admin UI, with no SQL**,
and every price field they can edit is a price a customer is actually charged.

**Done when:** the next real venue launch (a) needs zero SQL from Claude, and (b) at every step of the launch,
the price shown in admin = `compute_booking_total` for weekday and weekend, with and without food.

## What the live system actually looks like (why it feels overwhelming)

| Concern | Where it lives today | Admin UI writes it? |
|---|---|---|
| Package price, no food | `venue_packages.price` (+ included_guests, overage, max_guests) | Yes, Packages tab, per-row Save |
| Package price, with food / weekend / per guest count | `package_prices` (98 rows) | **No — SQL only** |
| Stay nightly rate; custom-setup fallback | `venues.base_price`, `free_guests_upto`, `overage_per_person` | Yes, Venues form |
| Brochure "from" prices | `brochure_city_prices` / `package_price_grid` (views, derived) | n/a |
| Package photos | `packages.images` | Yes, Packages tab card |
| Venue photos | `venues.images` | Yes, Venues form |
| Reels | `reels` (22, keyed by `package_id` only, no venue) | Yes, Packages tab section |
| Occasion reels | `occasion_reels` (9 rows) | No, and **nothing in the frontend reads it** |

🔴 **The trap:** `compute_booking_total` says "price table wins". For **21 of 33** active venue×package pairs a
`package_prices` row exists, so editing the price in the Packages tab changes **nothing** a customer pays.
Today 0 of the 21 disagree, so it's dormant, not live. The first price edit in admin makes it live.

🔴 **Correction to the 2026-11-03 brainstorm:** "hide `base_price`/`free_guests_upto` on package venues" is
wrong. `compute_booking_total` reads them (stay side of picnic_stay, nightly stays, no-package fallback), and
2 confirmed no-package bookings sat on package venues in the last 60 days (#167, #260, both admin-entered).
**Relabel, don't hide.**

Launching a package venue today means editing: Venues form (≈25 fields) → each of 5 package cards (Enable row,
4 numbers, row Save) → SQL for food/weekend prices → Reels section → (menu tab). No screen says "done".

## Plan

Phases 0–2 are **frontend-only** (no migration, no RPC change), so each one rolls back with a git revert.

### Phase 0: Make the Packages tab truthful (removes the trap). ~½ day
- In the Packages tab's "Venue pricing" rows (`app.js` ~L2740–2930, `savePkgVenueRow`): when `package_prices`
  rows exist for that venue×package, render the price **read-only** as
  "Charged: ₹X weekday · ₹Y weekend · food from ₹Z (price table)" and disable the price input.
  Included guests, overage and max guests stay editable (the RPC still uses `venue_packages` overage on no-food rows).
- Data source: one extra `package_prices` select inside `loadPackagesManager()` (anon-readable, already read at L2286).
- **Exit:** for all 33 pairs, the shown price matches `compute_booking_total(venue, included_guests, 0, '{}', <slot>, key, false, <a Saturday / a Tuesday>)`.
  Check this with SQL over every pair, not by eye.
- **First action:** run the 33-pair SQL check *before* touching code, to get the baseline.

### Phase 1: Venue form labels by type. ~½ day
- `base_price` label/hint switches on `type`: stays → "Nightly rate"; cafe with packages → "Custom-setup price
  (only used when no package is chosen)", collapsed under "Advanced"; partner_bnb → "Picnic setup price".
- Hide fields that a type never reads (e.g. Rooms/Amenities/iCal on `cafe`), but only after grepping each field's
  readers. No field is hidden on a hunch.
- **Exit:** for each of the 5 types, the visible fields have at least one reader in app.js, the prerender script, or an RPC body (list attached to the PR).

### Phase 2: Readiness checklist + single venue view. ~1–1.5 days
- Each venue row in the Venues list gets a status pill: **Live** / **Draft: n missing**.
- The checks are computed client-side from data that's already loaded, and they differ by type. Cafe with packages:
  ≥3 photos (all with a `thumb`), maps link, ≥1 active package priced *with a charged price*
  (from Phase 0 logic), team set, description. Stays: nightly rate, photos, iCal if Airbnb-listed.
  Reels are **advisory only** (reels key on package, not venue).
- Clicking the pill opens the venue with the missing items linked straight to the right editor.
- "Packages at this venue" panel on the venue view, listing the venue's rows from every package card
  (reuses `savePkgVenueRow`), so pricing for one venue happens in one place, not across 5 cards.
- **Exit:** Countryside Offgrid (27, no maps link, 2 photos) shows Draft with exactly those gaps. Beige Cafe (14) shows Live.

### Phase 3: Price-grid editor for `package_prices`. ~2–3 days. The step that removes SQL
- On the venue view: a grid of packages × {no food / with food per guest count} × {any / weekday / weekend}, writing
  `package_prices` through a new admin-gated RPC (`admin_upsert_package_price`, SECURITY INVOKER, admin-email check,
  per CLAUDE.md §4). It accepts **paste from the Ledger sheet's Packages tab** (tab-separated rows), because that sheet is
  where the numbers come from (PACKAGE_PRICING_PLAN_2026-10-21.md).
- Every save previews the result through `compute_booking_total`, not local arithmetic (§7).
- Run `picnic-backend-ship` + rolled-back DO-block tests (admin writes, non-admin rejected, residue 0).
- **Exit:** a Jaipur venue's full food price table is entered in the UI and matches the ledger row for row.

### Phase 4, gated: "Launch a venue" wizard
Build only if **someone other than Aksheev launches ≥1 venue a month**. Otherwise Phases 0–3 plus the
checklist already cover it, and the wizard is just a second way to do the same thing.

## Explicitly not doing
- Merging `venue_packages` and `package_prices` into one table: correct long-term, but it rewrites `compute_booking_total`
  with no staging (§1). Revisit after Phase 3 shows which columns the UI really needs.
- Spreadsheet-import as the primary flow: it adds a sheet↔DB copy that can drift. Paste-into-grid gets the speed without a sync.
- `occasion_reels`: 9 rows and no readers. Confirm, then drop it as cleanup (separate task).

## Risks
| Risk | Mitigation |
|---|---|
| Phase 0 read-only display drifts from RPC logic | Exit check compares against the RPC itself for all 33 pairs |
| Hiding a field that something reads (Phase 1) | Reader grep across app.js, prerender, RPC bodies before hiding |
| Price-grid RPC writes production prices with no staging | DO-block tests; preview-before-save; `package_prices` changes are the money (§7) |
| app.js parse breaks (sandbox tears large files, §3) | Trusted-copy `node --check` in /tmp every phase |

## Success metric
Today: ~5 screens, ~7+ separate Saves, plus SQL by Claude, with no "done" signal. Target after Phase 3:
1 venue view, 0 SQL, and a Live pill as the done signal. Measure it on the next real launch, not a demo.

## Decision needed from Aksheev
Who besides you adds or edits venues, and how often? This gates Phase 4 only. Phases 0–3 are worth doing either way.

## Status — 2026-11-03

| Phase | State | Evidence |
|---|---|---|
| 0 Truthful Packages tab | built, not yet seen in a browser | 33/33 pairs: shown price = `compute_booking_total` (Tue + Sat) |
| 1 Labels by type + Type-change fix | built, not yet seen in a browser | every label claim checked against the live function; 6 type cases + dropdown listener tested in jsdom |
| 2 Readiness pill + packages-at-venue panel | built, not yet seen in a browser | JS result = independent SQL result for all 19 active venues (Draft: 23, 27, 31, 32) |
| 3 Price-table editor | **function LIVE** (`admin_set_package_prices`, migration `20261103_admin_set_package_prices.sql`); UI built, not yet seen in a browser | 13 rolled-back branch tests as admin through RLS; all 21 live pairs round-trip byte-identical; zero residue (fingerprint unchanged); advisors unchanged |
| 4 Wizard | built, not yet seen in a browser. Aksheev confirmed others will add venues | guided mode of the SAME venue form (data-wz-step on every block); each Next saves an inactive draft; Publish gated by venueReadiness on the saved row; refactored save proven payload-identical (22 fields, edit + new); 33 jsdom flow checks |
| 4b In-panel package on/edit/pause | built, not yet seen in a browser | needed because the Packages tab lists ACTIVE cafes only, so a draft venue can't be set up there |
| Layout pass (desktop + mobile) | built, checked with Playwright on mocked data | 12 admin tabs + venue form + wizard at 1440px and 390px: zero sideways overflow (was: Packages table 1,624px wide and clipped). Packages tab folds to summary lines (~7,700px → 1 screen); pricing rows stack on phones; venue list cards ~8,300px → ~3,600px; list hides while a venue is open |

Deviations from the plan as written:
- Phase 2 panel is read-only with jump links (editing in two places would collide on DOM ids in `savePkgVenueRow`).
- Missing 800px thumbs are a note, not a Draft blocker (39 photos; uploader fix in Todoist, `egress`).
- Phase 3 paste accepts the grid's own columns (food, guests, day, price, voucher, items), not the Ledger layout. The Ledger's Packages tab is a free-form block per venue, so no single format fits it. The Ledger also disagrees with live with-food prices for Beige (Todoist, Picnic Stories p2).
- A real save rewrites a pair's rows, so their `id`s change. Nothing references `package_prices.id`.

- Layout checks used a mocked database with made-up data. Tabs that render real bookings/queries were only checked for overflow with empty data.
- Packages tab intro copy corrected: it claimed prices are "derived live from base price + add-ons, never typed in", false since stored pricing.
