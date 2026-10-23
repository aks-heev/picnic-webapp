# PLAN — Phase 5: website, admin and emails for the package price table

Status: PLAN ONLY — nothing built. Written 2026-10-21 via plan-optimizer (score 89/100, trajectory 72 → 83 → 89 → 89).
Parent plan: `docs/PACKAGE_PRICING_PLAN_2026-10-21.md` (Phases 1–4 SHIPPED-verified). Live facts below were probed 2026-10-21.

## 0. Done means

1. **Price parity, proven:** for every row of the §6 test matrix, the price the page shows = `compute_booking_total` RPC = the
   `total_amount` stored by the real submit, and the advance shown = `compute_booking_advance` = stored `advance_amount`.
2. A guest can pick "with food" on Beige and Countryside, the Sunroom is bookable (always with food, credit shown), and anything
   with no price row says "custom quote — WhatsApp us" instead of showing a number.
3. `/brochure` shows "from ₹X · with food from ₹Y" read from the database, never typed into HTML.
4. Received + confirmed emails show a Food line for new bookings; old bookings (with_food NULL) render exactly as today.
5. Admin Add/Edit Booking records food, and editing a packaged booking no longer resets its total.
6. Aksheev has eyeballed it on a real phone, inside WhatsApp's in-app browser. That item is his; Claude can't do it.

## 1. Live facts this plan rests on

- Prices on the site today come from client arithmetic over `venue_packages` (`packageTierPriceAt`, app.js ~3700; brochure via
  `packages.js`). There is no food dimension there.
- `bookings` has **no anon SELECT policy** (by design, PII). The browser can NOT read back the stored total after submit.
  → The only server-side number the page can show is a call to `compute_booking_total` / `compute_booking_advance` (anon-executable).
- `submit_booking_intent` is called at app.js ~4688 and ~4895 (named args); it now accepts `p_with_food`.
- `package_prices` and `package_price_grid` are anon-readable. The grid covers picnic venues only (cottage = nightly rate + venue 27 price).
- Emails: `notify-booking-received` v46, `notify-booking-confirmed` v44, both `verify_jwt=false` (MUST stay false).
- Admin: `abkComputeTotal` (app.js ~11573) re-derives prices locally; `app.js:6489` recompute omits `p_package_key` and hardcodes `* 0.3`.
- Venue 27 "Countryside Offgrid" (picnic-only) shares its exact name with the retired venue 22; next to the two new cottages it reads
  as a duplicate. The prerendered `/countryside-offgrid` page for venue 22 drops off on the next build (prerender filters `is_active`).

## 2. Decisions needed before building

| # | Question | Default |
|---|---|---|
| G6 | Venue 27's card next to the cottages: rename it, or hide it from the gallery? | Rename to "Countryside Offgrid — Picnic only" (slug unchanged, so links keep working) |
| G7 | Food toggle default | Off; label "Add food & drinks" with the price difference shown, e.g. "+ ₹1,000" |
| G8 | Sunroom credit copy | "Includes ₹3,000 food & drinks credit — anything above is paid at the café. Unused credit lapses." |

## 3. Design

**One quote path.** A single helper `quotePackage(venue, tierKey, adults, withFood, date)`:
- *Card / "from" prices* (no date yet): read from `package_prices` rows loaded once at boot (same fetch as `venue_packages`),
  showing the lowest matching price. No arithmetic beyond today's no-food extra-guest rule, which already exists.
- *The number on the booking step and the advance to pay*: always an RPC call to `compute_booking_total` + `compute_booking_advance`
  with `p_with_food` and `p_date`. That's the same function `submit_booking_intent` uses, so parity holds by construction.
- Venues without table rows fall back to today's `packageTierPriceAt` (no behaviour change).
- `PRICE_NOT_AVAILABLE` from the RPC → hide the number, show the custom-quote line plus the WhatsApp button.

**Food toggle states:**
- Venue has with-food rows *and* no-food rows (Beige, Countryside) → toggle shown, default off (G7).
- Venue has only with-food rows (Sunroom) → no toggle; food always on, credit line shown (G8).
- Chosen guest count has no with-food row (Prelude 5+, Countryside 3+, anything 7+) → toggle disabled, custom-quote hint.
- Sunroom before a date is picked → "₹13,900 weekdays · ₹15,900 weekends" (from the rows); the exact price appears once a date is chosen.

## 4. Build steps, in shipping order (each one safe on its own)

**5a — Emails first** (harmless while every new booking still has `with_food = false`).
Fetch live v46/v44 via `get_edge_function`; add one line from the booking row only: `with_food true` → "Food & drinks: included"
(+ "₹X credit — anything above is paid at the café" when `food_credit` is set); `false` → "Food & drinks: not included";
NULL → no line. esbuild bundle check on a `/tmp` copy; deploy with `verify_jwt=false`; byte-sync the local files.
Smoke test: one rolled-forward test booking to `aksheevs+food@gmail.com`, `get_logs` 200, then delete the booking + children, `count(*)=0`.
Rollback: redeploy v46/v44 source (saved before editing).

**5b — app.js: quote helper, booking-flow toggle, both submit calls pass `p_with_food`.**
Edit method (app.js is 12.9k lines): Python on the device doing exact one-occurrence replacements with asserts, from the file as it is
on disk; never retype the file. `node --check` on the result. Aksheev runs `npm run build && npm run preview` and checks :4173.

**5c — app.js admin.** Food checkbox + credit field on Add/Edit Booking, saved via `admin_set_booking_food` after the booking saves
(same pattern and failure message as `abkSaveSplit`: "booking saved, food didn't"). Replace `abkComputeTotal`'s arithmetic with an RPC
call, which deletes the mirror. Fix 6489: pass `p_package_key`, `p_with_food`, `p_date`; take the advance from `compute_booking_advance`.
Closes Todoist "Admin edit recompute drops the package price".

**5d — Brochure.** `packages.js` / `brochure.js` read `package_price_grid`; show "from ₹X · with food from ₹Y" (G4 decision: both).
Countryside: picnic-only prices plus "with a cottage: + ₹5,000 / ₹7,000 per night". Update the build-time fallback numbers in
`brochure.html` to the same values.

**5e — Venue 27 name (G6).** One `UPDATE venues SET name = …` on venue 27 only. `package_name` snapshots on bookings are unaffected.

**Ship 5b–5e together in one push.** Verify on prod with `?cb=<ts>` (cache-busted).

**5f — Sunroom go-live, LAST.** Only after 5b is live on prod: `UPDATE venues SET packages_enabled = true WHERE slug = 'the-sunroom'`.
Rollback: set it back to false (instant, nothing else depends on it).

## 5. Risks

| Risk | Mitigation |
|---|---|
| Page shows one price, server charges another | The price on the booking step and the advance ARE the RPC result; §6 parity matrix |
| Sunroom live before the site can price it | 5f is gated on 5b being verified on prod |
| app.js edit tears or misplaces code | One-occurrence asserted replacements, `node --check`, preview build on Aksheev's machine |
| Old no-food bookings change | `p_with_food` defaults to false; the regression set from Phase 2 already proved no-food prices unchanged |
| Emails break for old rows | NULL `with_food` → no line; deploy keeps `verify_jwt=false`; smoke test through the real trigger |
| WhatsApp in-app browser quirks | Real-phone check by Aksheev is a named done-item |
| A real charge during testing | Razorpay testing stops at opening + dismissing the checkout modal, then the row is deleted |

## 6. Parity test matrix (each row: shown = RPC = stored)

| Venue | Package | Guests | Food | Date | Expected total / advance |
|---|---|---|---|---|---|
| Beige | Setting | 2 | no | any | 8,900 / 2,670 |
| Beige | Setting | 3 | yes | any | 11,400 / 3,420 |
| Beige | Prelude | 5 | yes | any | custom quote |
| Countryside picnic | Moment | 2 | yes | any | 13,900 / 4,170 |
| Small cottage, 1 night | Prelude | 2 | no | any | 10,900 / 3,270 |
| Big cottage, 1 night | Story | 2 | yes | any | 32,900 / 9,870 |
| Sunroom | Setting | 4 | (always) | Sat 2026-10-24 | 17,900 / 5,370, credit 5,000 |
| Sunroom | Setting | 4 | (always) | Wed 2026-10-28 | 15,900 / 4,770, credit 5,000 |
| Sunroom | Setting | 8 | (always) | any | custom quote |

Cottages are request-only, so their rows are checked via the quote RPC + an admin-entered booking, not the self-serve lock path.
