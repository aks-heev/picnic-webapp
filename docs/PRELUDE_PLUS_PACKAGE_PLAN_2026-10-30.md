# The Note package (Prelude + Cake + Board) — plan (2026-10-30)

Status (2026-10-30 21:00 IST): LIVE. Pushed as 70c47ef; the_note activated. Verified: brochure card + live prices, venue-step prices at all 4 venues, submit_booking_intent rolled-back test (7,400 / advance 2,220 / board saved / Cake+Board ₹0), 0 residue. NOT eyeballed: booking-form board field (Todoist, Aksheev). Read-out due 2026-12-26 (§6).
Name (decided 2026-10-30): **The Note** — key `the_note`. Tagline: "The Prelude setup, with a cake and your message on a board."

## 0. Goal & definition of done
Sell a package between The Prelude and The Setting: **The Prelude setup + Cake + White Board Message**, max 4 guests.
Done = (a) bookable self-serve on /brochure → venue pick → booking form at every venue that offers The Prelude, with `compute_booking_total` returning the agreed price for every venue × food × guest-count cell; (b) a pre-registered 8-week read-out (§6) is scheduled.

## 1. Facts this plan rests on (probed live 2026-10-30 — re-probe before building, CLAUDE.md §2)
- Confirmed picnics since 2026-07-10: Prelude 25 bookings, avg ₹9,486 (11 of 25 took add-ons: Photographer 7, Cake 4, Skyshots 4, Board 2); Setting 18, avg ₹14,326.
- Pricing: `package_prices` WINS when it has rows for venue×package (with/without food, guests, day_type); otherwise `venue_packages.price` + overage. Prelude has `package_prices` rows only at Beige (14) and Countryside (27); Castle Valley (19) and House of Amer (24) are `venue_packages`-only (no with-food option). Sunroom (18) has no Prelude.
- Prelude is **standalone** in app.js: free-text `inclusions`, no `package_add_ons`, excluded from the "Everything in X, plus" ladder (`pkgStandalone`).
- Prelude is in `BOARD_PAID_TIERS` (app.js ~2153): board field hidden until White Board add-on (id 37 — resolve live) is ticked. The new package BUNDLES the board, so it must NOT be in that list.
- Food items rule (app.js ~2226): Prelude 1× guests, others 1.5×.
- /brochure cards are hand-written in `brochure.html` (`data-pkg=` per package); prices/caps come from `package_price_grid` / `venue_packages`. A card whose package is inactive is auto-hidden (brochure.js ~131) → card can ship before activation.
- `add_ons` category `setup` rows ("The Prelude ₹4,300" etc.) are the stay-venue celebration setups, pick-one.
- Bookings snapshot `package_key` → measurement needs no new tracking.

## 2. Pricing (proposal — decision D2)
Rule: Prelude price + list value of Cake (₹1,100) + Board (₹1,000) − ₹600 bundle saving, then checked against the Setting gap.

| Venue | Prelude | **The Note** | Setting | Gap to Setting |
|---|---|---|---|---|
| Beige Cafe (14) | 5,900 | **7,400** | 8,900 | 1,500 |
| Countryside — picnic (27) | 5,900 | **7,400** | 8,900 | 1,500 |
| House of Amer (24) | 6,900 | **8,400** | 9,900 | 1,500 |
| Castle Valley (19) | 7,400 | **8,400** (formula gives 8,900 → only 1,000 gap) | 9,900 | 1,500 |

- Castle Valley takes ₹1,000 off a bundle that would otherwise be only ₹400 below Setting. Keep the gap at a consistent ₹1,500 everywhere so the step reads the same on every venue.
- With-food rows (Beige, Countryside only — mirror Prelude): The Note no-food + the Prelude's food delta for the same guest count, `food_items` = Prelude's (1× guests). Beige: 2g 8,900 / 3g 9,700 / 4g 10,400.
- Known collisions (accepted, flag only): Prelude-with-food-for-2 at Beige is also ₹7,400; The Note-with-food-for-2 = Setting no-food ₹8,900.
- `venue_packages`: included_guests 4, max_guests 4, overage 0 (copy Prelude).
- Stay setups (`add_ons` category `setup`): **out of v1.** Revisit only if a stay guest asks.

## 3. Build — in order (no staging: every step is production)
**Phase A — data, inactive (Claude)**
1. Resolve ids live: venues 14/19/24/27, add-ons Cake + White Board Message (active rows only — duplicates exist).
2. Migration `supabase/migrations/2026MMDD_the_note_package.sql` (apply_migration + repo file, same session): `packages` row (`is_active=false`, `inclusions` = Prelude's list + "Cake" + "White board message"), `package_add_ons` (Cake, Board), `venue_packages` ×4, `package_prices` (no-food ×2 venues + with-food 2–4g ×2 venues), and `sort_order` renumber so it sits between Prelude and Setting (check every consumer of `packages.sort_order` first).
3. Rolled-back DO-block: `compute_booking_total` for every venue × {no food, food 2/3/4g} — must equal §2 table; also assert that ticking Cake/Board as add-ons on The Note adds ₹0 (bundled exclusion) and that 5 guests raises/blocks. `get_advisors` after. Residue = 0.

**Phase B — app.js / brochure (Claude writes, Aksheev pushes)**
4. app.js: decide how a package with BOTH inclusions and add-ons renders — keep it standalone (own list, no ladder copy) and make sure the add-on bundle still excludes Cake/Board from extras. Do NOT add it to `BOARD_PAID_TIERS`; board field must show by default and only offer the white arch board. Food items rule: add the key to the 1× branch.
5. Admin manual-booking form: confirm the package appears and prices the same as the RPC.
6. `brochure.html`: new `pk-card data-pkg="the_note"` between Prelude and Setting, photos in `public/brochure/` (D3). brochure.js: confirm `defaultTierForOccasion` and the reels mapping don't assume four cards.
7. Emails: check `notify-booking-received` / `-confirmed` render the package name and what's included for a key they've never seen (they read the snapshot; confirm, don't assume).
8. Trusted-copy `node --check` on app.js + brochure.js (§3.4); `npm run build && npm run preview` on Aksheev's machine, eyeball `:4173/brochure` — card is hidden while the package is inactive.

**Phase C — go live (Aksheev pushes; then Claude flips)**
9. Aksheev pushes → Vercel deploy confirmed.
10. `UPDATE packages SET is_active=true WHERE key='the_note'` → cache-busted check of /brochure + booking flow at Beige; open Razorpay modal and DISMISS (never charge); delete the test booking + children, prove count 0.
11. Ops readiness BEFORE step 10: cake supplier + flavour default, and board printing via the board-cutouts flow, both confirmed for a booking with the usual lead time (D4).

**Rollback:** `is_active=false` → card hides, booking flow drops it; existing bookings keep their snapshot. No code revert needed.

## 4. Decisions owed by Aksheev
- ~~D1 name~~ — decided: The Note.
- **D2** Approve §2 prices, esp. Castle Valley 8,400 and HoA 8,400.
- **D3** Photos: a real Prelude setup with cake + board in frame. Without them the card reuses Prelude photos and undersells the difference.
- **D4** Cake: flavour default / choice, supplier lead time; which board design is standard.

## 5. Risks
| Risk | Mitigation |
|---|---|
| Pulls Setting buyers down (the main business risk) | §6 kill rule; 1,500 gap keeps Setting the "bigger setup for >4" choice |
| Board gating wrong → board message never collected | Step 4 + test booking in step 10 shows the board field |
| Cake/Board charged twice when ticked as extras | DO-block assertion in step 3 |
| Price shown ≠ price charged | Every price from `compute_booking_total` / `package_price_grid`, never computed in JS (CLAUDE.md §7) |
| A venue missing a price row → `PACKAGE_NOT_AVAILABLE` at checkout | Step 3 tests all four venues |

## 6. Measurement (pre-registered — set before launch, don't move the goalposts)
Window: 8 weeks from activation. Universe: confirmed picnics with `package_key` in (the_prelude, the_note, setting), CLAUDE.md §8 exclusions applied.
Baseline (2026-07-10 → launch): Prelude 25 / Setting 18 → Setting share 42%, blended avg ≈ ₹11,450 per booking across the two.
- **Keep** if blended avg per booking across the three ≥ baseline AND Setting share ≥ 30%.
- **Kill** (set inactive) if Setting share < 30% AND blended avg falls.
- Anything else → extend 4 weeks.
Honesty: at ~5 bookings/week this is n≈40 — directional, not significant. One big Story booking can swing the average; report medians too.

## 7. First action
Claude: Phase A step 1–3 once D2 is answered. Aksheev: D3, D4 in parallel.
