# SPEC — Stored Per-Venue Package Pricing (kills derived pricing)

**Date:** 2026-07-10 · **Status:** v3 READY TO BUILD (plan-optimizer hardened 65→88; all §10 blockers resolved) — migration not yet applied
**Decision owner:** Aksheev · **Decisions locked:** all packages move to stored prices (no hybrid) · per-package guest rules · bundled add-ons kept as display-only inclusions

---

## 1. Why

- **The Prelude** (₹5,900, smaller physical setup) cannot be expressed in the current model. Today a package price is always *derived*: `venue base picnic + Σ bundled add-on catalog prices`. Prelude is not "base + add-ons" — it's a different, cheaper setup. Same applies to the planned non-derived Date Night / Movie Night packages.
- 🔴 **Prelude is already live and mispriced.** Row exists (`key=the_prelude`, active, empty bundle, sort_order 8), so /packages currently renders it at venue base — **₹8,900 at Beige, identical to The Setting** — sorted *after* The Story. Until this ships, consider `is_active=false` on the row (one UPDATE).
- Derived pricing is hand-duplicated in **three places** (`packageTierPriceAt` in app.js, `compute_booking_total` RPC, `tierPriceAtVenue` in prerender-venues.mjs) and a client/server total mismatch has already been observed in prod (₹12,000 vs ₹13,000, logged 2026-07-07). Stored prices make one DB row the single source of truth.

**Trade-off accepted:** add-on price changes no longer auto-reprice packages. The price matrix (venues × packages) is maintained by hand in admin.

## 2. Current live state (queried 2026-07-10)

- Packages-enabled venues: **Beige Cafe (14)** — base 8,900 flat to 6, +2,000/head; **Castle Valley (19)** — base 9,900 flat to 6, +2,000/head. Both serve every add-on used by any bundle, so all 8 packages are serviceable at both.
- Packages (8 rows): `setting`, `moment`, `story` (universal), `date_night_classic/deluxe`, `movie_night_classic/deluxe` (occasion), `the_prelude` (universal, empty bundle).
- `bookings.package_key` + name/tagline snapshot exist (2026-07-08 migration). `submit_booking_intent` = 20-arg version with `p_package_key`. `create-order` v10 validates payment amounts against server-side compute; `verify-payment` v9 / `razorpay-webhook` v5 write `lead_status`.

## 3. Schema

New table **`venue_packages`** — presence of an active row = "this package is offered at this venue, at this price":

| Column | Type | Notes |
|---|---|---|
| `venue_id` | int8 FK → venues | PK part |
| `package_id` | int8 FK → packages | PK part |
| `price` | numeric NOT NULL CHECK (price > 0) | flat price up to `included_guests` adults |
| `included_guests` | int4 NOT NULL CHECK (included_guests >= 1) | flat through this many billing guests |
| `overage_per_person` | numeric NOT NULL DEFAULT 0 CHECK (>= 0) | per adult beyond `included_guests` |
| `max_guests` | int4 nullable CHECK (max_guests >= included_guests) | hard cap for this package at this venue; NULL = venue `capacity_max` applies. Enforced in the form stepper AND re-checked in `submit_booking_intent` (raise on violation). |
| `is_active` | bool NOT NULL DEFAULT true | soft toggle without deleting the row |
| `created_at` / `updated_at` | timestamptz | |

Semantics:

- **Pricing:** `price` if `billing_guests ≤ included_guests`, else `price + overage_per_person × (billing_guests − included_guests)`. Children stay free/excluded (unchanged).
- **"From ₹X" card price = stored `price` directly** (min across enabled venues). `PKG_PAGE_BASE_ADULTS` becomes unnecessary for pricing — delete the adults arg from the card-price path; guest count only matters once the form computes overage.
- **Visibility:** package shown at a venue iff `venue.packages_enabled` AND active `venue_packages` row. **No fallback to derived math — a missing/inactive row hides the package.** Replaces `packageServiceableAt` as the customer gate; keep that function only as an admin warning ("bundle contains add-ons this venue doesn't serve").
- **Bundled add-ons (`package_add_ons`)** become display-only: card inclusion lists, email "Your Package" bullets, admin warnings. Their catalog prices never enter the package price.
- **Extras** (customer-added add-ons not in the bundle) stay additive at catalog price — unchanged.
- **Mid-flow race:** if `p_package_key` is given but no active `venue_packages` row exists at submit time, the RPC **raises** (client shows retry). Never silently reprice or fall back — a wrong charge is worse than a failed submit.
- Venue `base_price`/`free_guests_upto`/`overage_per_person` remain for **non-package** bookings and non-cafe venues — untouched.

### Seed migration (today's derived values — nothing customer-visible moves except Prelude)

| package | Beige (14) | Castle Valley (19) |
|---|---|---|
| the_prelude | **no seed row** — user enables per venue in admin (₹5,900 · incl. 4 · overage 0 · max_guests 4 are the intended values when he does) | **no seed row** — same |
| setting | 8,900 | 9,900 |
| moment | 12,000 | 13,000 |
| story | 25,000 | 26,000 |
| date_night_classic | 10,900 | 11,900 |
| date_night_deluxe | 13,900 | 14,900 |
| movie_night_classic | 13,900 | 14,900 |
| movie_night_deluxe | 17,900 | 18,900 |

`included_guests = 6`, `overage_per_person = 2,000` for all seeded rows **except Prelude (blocking Q2)**. Also move `the_prelude` `sort_order` → 0 (renders before The Setting).

## 4. Server changes

1. **Migration**: create `venue_packages` + seed + RLS (public read, authenticated write — same pattern as `venue_add_ons`). `get_advisors` after.
2. **`compute_booking_total`** gains `p_package_key text DEFAULT NULL`. When set: total = venue_packages price (+ guest overage) + **non-bundled** add-on prices; bundled add-on ids in the input contribute ₹0. When NULL: existing venue-base math (non-package and legacy bookings unchanged). Same for **`compute_booking_advance`** (still 50% — advance policy unchanged).
3. **Signature strategy / deploy window:** adding a trailing param **with a DEFAULT** keeps ONE function — PostgREST named-arg calls from the *old* deployed frontend (which don't pass `p_package_key`) still resolve. No overload is created, so the 07-07 DROP-the-old-overload lesson doesn't bite here; **do NOT create a second signature.** This makes the window between DB migration and Vercel deploy safe: old frontend keeps deriving old totals for non-package bookings (identical math), and package bookings made in the window price as before (seeds equal today's derived values, so amounts match). Deploy order stays DB → edge fns → frontend.
4. **`submit_booking_intent`**: internal total/advance calls pass the booking's `package_key`. Bundled add-ons are still inserted into `booking_add_ons` **with `price_at_booking = 0`** (ops/menu-link visibility preserved; `Σ price_at_booking + package price = total` holds by construction — pending Q5 confirmation). Extras keep real prices. Raises on missing venue_packages row (see §3).
5. 🔴 **`create-order`** (v10) validates the Razorpay amount against server compute before creating the order. It must resolve the booking's `package_key` (already on the bookings row) and pass it to the new compute — otherwise **every package booking's payment either fails validation or validates against the wrong (derived) amount**. Read the live source via `get_edge_function` at build time (drift rule) and patch. Check `verify-payment`/`razorpay-webhook` for any amount re-computation while in there (believed to only write status — verify, don't assume).

## 5. Frontend (app.js)

- `packageTierPriceAt` → lookup of a `venue_packages` map (loaded with `loadPackages()`), applying per-package guest rules. Delete the add-on summing. Callers to touch: /packages cards, homepage teaser, venue-first `showPackageStep`, venue picker price line, Meta Pixel `ViewContent.value` (follows automatically), `packageTierPrice` wrapper.
- **Booking form:** bundled add-ons stay pre-checked for display but contribute ₹0 to the total; form total = stored price(+overage) + extras. Preserves the invariant *card price = form total with no extras*. Any "flat to N guests" copy in the form/guest step must read the **package's** `included_guests`, not the venue's `free_guests_upto`.
- **Resume paths:** `selectPackageTier`'s `changeMode==='intent-package'` branch and the change-date resume both rebuild the lead — they must reprice via the new lookup, and `buildIntentSummaryHTML`'s package-line collapsing must show stored price + extras (mirror of the email math).
- Visibility: `visiblePackagesFor()` / venue picker filter by `venue_packages` presence instead of `packageServiceableAt`.
- **Ladder copy:** "everything in X, plus…" chaining stays for Moment/Story and classic→deluxe (their bundles still express the upgrade). **Prelude must NOT chain** — sibling setup, not a downgrade rung; needs its own inclusions copy (Q3). Future non-derived occasion packages get the same free-text treatment.

## 6. Prerender (`scripts/prerender-venues.mjs`)

`tierPriceAtVenue()` — delete the ported math, read `venue_packages` directly. Removes the standing keep-in-sync-by-hand burden. JSON-LD From-prices update automatically. Fix the stale `/packages` meta title while in the file.

## 7. Admin UI

**The admin panel is the primary management surface — enabling a package at a venue is a first-class admin action, not a migration.** In `renderPackagesManager`, each package card gains a per-venue section listing every `packages_enabled` venue:

- **Not offered** (no row): shows "＋ Enable at ‹venue›" → inline form for price / included guests / overage / max guests → insert row.
- **Offered**: editable price / included guests / overage / max guests + active toggle (soft-disable keeps the row) + "Remove" (delete row, confirm dialog stating the package disappears from that venue immediately).
- Client-side validation mirrors the CHECKs (price > 0, included_guests ≥ 1, max_guests ≥ included_guests); keep the bundle-gap warning.
- Consequence to surface in the UI: a package with zero active rows is invisible on the site everywhere.

**Post-ship state:** Prelude has no seed rows, so it disappears from /packages the moment the frontend switches to `venue_packages` visibility — intentional (it's mispriced today) — until the user enables it per venue with the intended values (₹5,900 / 4 / 0 / cap 4). The 7 existing packages ARE seeded (else the whole /packages page goes blank at cutover).

## 8. Emails (`notify-booking-received` v29 → v30)

- `splitAddons()` (bundled vs extras) — unchanged.
- Admin cost block back-computes package line as `total − Σ extras`; with §4.4's zero-priced bundled rows this stays correct **by construction** — still assert it to the rupee in the harness.
- Drift rule: reconstruct from live `get_edge_function`, never deploy from local files.

## 9. Rollout, rollback, verification

**Order:** migration+seed → `compute_booking_total`/`advance` → `submit_booking_intent` → `create-order` (+ verify-payment check) → app.js → prerender → admin UI → email v30. Each step live-verified before the next.

**Rollback:** the table is purely additive and seeds equal today's derived values, so at any point before the frontend deploy, rollback = re-applying the previous RPC bodies (kept in the migration file as comments). After frontend deploy, rollback = revert Vercel deployment + previous RPC bodies. No data migration to unwind.

**Verification invariants (assert each explicitly):**
1. Card "From" price = booking-form total with no extras, per venue × package.
2. Client form total = `compute_booking_total` output for the same inputs (closes the 07-07 mismatch — test at guests ≤ and > `included_guests`).
3. `Σ booking_add_ons.price_at_booking + package price = total` on a real package booking.
4. Legacy path: booking with `package_key IS NULL` prices identically to today (regression).
5. Prelude renders first on /packages at ₹5,900, does not chain ladder copy.
6. A package booking completes Razorpay order creation (create-order validation passes).
7. Email v30: package line + extras arithmetic to the rupee (Node harness, then one live smoke booking — delete after).

**Method per phase:** SQL branch tests (package w/ extras, w/o extras, overage guests, no package, raise-on-missing-row) → localhost E2E via Chrome MCP → prerender Node harness + real `npm run build` on the user's machine → admin save round-trip (SQL-confirm `updated_at`) → esbuild + harness + live smoke for emails.

**Standing rules:** no commits from sandbox for app.js/style.css/edge fns (torn-mount rule); no commit at all without explicit go-ahead; edge-fn source of truth = deployed version.

## 10. Open questions

**All blockers resolved — build can start.**

**Answered 2026-07-10:**
1. ~~Prelude at Castle Valley~~ — no Prelude seed rows anywhere; user enables it per venue from the admin panel (§7 is built as the primary enable/price surface). Existing 7 packages still seeded so /packages never goes blank.
2. ~~Prelude guest rules~~ — flat ₹5,900 to 4 guests, overage 0, **hard cap 4** (→ new `max_guests` column, §3).
3. ~~Prelude inclusions & copy~~ — bundle stays empty; free-text inclusions rendered on the card: *Cozy macramé tent setup · Ambient fairy lighting · Curated lamps & floor seating · Perfect for 2–4 guests.* Tagline: *"An intimate little world for up to four."* Price line: "From ₹5,900 · up to 4 guests". Images: user will upload via the package carousel admin. Needs a `packages.inclusions jsonb` (or text[]) column for free-text inclusion bullets, since bundle-less packages otherwise render no list — add to the migration.

**Non-blocking (defaults proposed, proceed unless overridden):**
4. New Date Night / Movie Night — *default: keep existing 4 rows seeded at derived values; reprice/replace later via admin once real numbers exist.*
5. `booking_add_ons.price_at_booking = 0` for bundled add-ons — *default: yes (§4.4).*
6. Seeded prices = today's derived values — *default: keep; reprice any cell later in admin.*
