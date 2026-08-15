# Packages MVP — Spec (planned from scratch, 2026-06-30)

> Status: PLAN ONLY. Nothing built. Supersedes the earlier `docs/SPEC_occasion_packages.md`
> (which leaned on offline historical numbers not present in the live DB and on
> fictional flat pricing). This spec is grounded in live Supabase data pulled 2026-06-30.

## Decisions locked (with the user, this session)

- **Occasion model = themed tiers.** Occasion is a label + default-nudge, NOT a 6×3 matrix.
  One set of 3 universal tiers underneath every occasion.
- **Scope = cafe (picnic) venues only.** Stays excluded. This removes the cross-venue-type
  pricing problem and the cafe-only-add-on breakage (Skyshots 27, Cold Pyros 23, BBQ 25,
  Bonfire 26 are cafe-only).
- **Locked bundles.** Add-ons included in a tier are NOT removable on the booking form;
  the form shows only the *remaining* add-ons.
- **All add-ons allowed in packages, no approval gate** (user's call). The gated add-ons
  (29 Movie Screening, 30 Live Music, 32 Extra Hour) may appear/auto-confirm — but admin
  gets a loud flag on any confirmed booking containing one.
- **Both flows in Phase 1** (updated 2026-06-30). Venue-first AND packages-first/homepage
  ship together. The reorder below removes the price-jump that previously justified deferring
  packages-first.
- **Booking form, post-selection:** no occasion field (captured upstream); show the chosen
  package summary; included add-ons hidden; only the remaining addable add-ons shown.

## Why this, not the old plan

Live DB reality (pulled 2026-06-30): **12 leads over 7 days, 1 confirmed sale.** The AOV
premise cannot be proven from live data yet — it is an explicit faith bet. 5 of 12 leads
already attach add-ons in the *existing* à-la-carte flow, so the add-on mechanism is not
broken. The cheapest honest test of the faith bet is one curated step that defaults
high-value add-ons in (esp. Photographer id 19, ₹6,000 — the only add-on the one confirmed
sale bought), measured against a clean baseline.

## Goal & definition of done

Test whether curated tiers raise average booking value without materially hurting
conversion. **Done =** packages live on cafe venues behind a flag; every booking records
its chosen tier (via PostHog at minimum); 2–3 weeks of data comparing AOV and booking-form
completion against the pre-launch baseline.

## The three tiers (JS config — no DB table, no migration)

```js
const PACKAGE_TIERS = {
  setting: { name: 'The Setting', addons: [] },                         // setup only — escape hatch
  moment:  { name: 'The Moment', addons: [22, 24, 17], featured: true },// +Bouquet+Cake+Prints  ≈ +₹3,100
  story:   { name: 'The Story',  addons: [19, 27, 23, 22, 24, 17] },    // +Photographer+Skyshots+Cold Pyros ≈ +₹16,100
};

// Occasion -> default tier (the AOV lever). Customer can switch.
const OCCASION_DEFAULT_TIER = {
  'Proposal': 'story', 'Anniversary': 'story',
  'Birthday': 'moment', 'Date Night': 'moment', 'Bridal Shower': 'moment', 'Baby Shower': 'moment',
  'Just Because': 'setting', 'Simple Picnic': 'setting',
  _default: 'setting',
};
```

Add-on reference (active, cafe gets all): 17 Prints ₹500 · 19 Photographer ₹6000 · 20 Extra
Flowers ₹1100 · 21 Extra Candles ₹1100 · 22 Bouquet ₹1500 · 23 Cold Pyros ₹3000 (cafe) ·
24 Cake ₹1100 · 25 BBQ ₹4000 (cafe) · 26 Bonfire ₹500 (cafe) · 27 Skyshots ₹4000 (cafe) ·
28 Sip & Paint ₹4000 · 29 Movie Screening ₹4500 (gated) · 30 Live Music ₹6000 (cafe, gated) ·
32 Extra Hour ₹1100 (gated).

Active cafe venues + base @2 guests: Beige(14) 9900 · Sunroom(18) 13900 · Castle Valley(19)
9900 · Om Niwas(20) 12900 · Once Upon A Time(21) 15900 · House of Amer(24) 9900.
Cafe floor = **from ₹9,900**.

## Flows (Phase 1 — both ship)

Both converge to: **venue + occasion + guests known → tier (priced) → form.**

- **Venue-first:** venue → occasion + guest count → 3 themed tier cards (this venue's exact
  prices) → tier → form.
- **Packages-first (homepage "Our Packages"):** occasion → venue → guest count → 3 tier cards
  (exact prices) → tier → form. (Reordered so venue+guests precede tier — this is what makes
  tier prices real instead of "from".)
- **Deep-link / SEO fallback:** `/venues/<slug>` and legacy `?venue=ID` entries default to
  The Setting, no occasion; the form works standalone and is never forced through the package
  step. The venue detail page ALSO surfaces the 3 tiers so deep-link visitors still see
  packages without an extra screen.

Booking form (all paths): occasion NOT shown (captured upstream); chosen package summary
shown; tier's included add-ons rendered read-only / hidden from the editable list; add-on
checklist shows only NOT-included add-ons; total via `compute_booking_total`.

## Pricing

⚠️ **Pricing is NOT flat up to 6 guests** (verified live 2026-06-30). `compute_booking_total`
returns, for Beige(14) and Castle Valley(19): 2g ₹9,900 · 4g ₹12,900 · 6g ₹15,900. It steps
every 2 guests; per-person overage applies only beyond the top bracket. So a tier card cannot
show one honest price without knowing guest count.

Resolution: **capture guest count at the venue step (before tiers) in both flows.** Tier cards
then show exact prices via `compute_booking_total(venue, billing_guests, 0, addon_ids, slot)`
— always the source of truth. If pricing is later made genuinely flat to 6, the same RPC call
returns the same number for 1–6 and nothing in this design changes. (User's "flat to 6,
per-person after" pricing change is deferred — "discuss later" — but does NOT block the build,
because the RPC governs either way.)

Locked bundle: `addon_ids = tier.addons ∪ extra_checked`, tier set rendered read-only.
(`compute_booking_total` is EXECUTE-granted to authenticated.)

## Risks & mitigations

1. **Conversion tax** (added screen on a 1/12 funnel) — ship behind a feature flag; hard
   guardrail: roll back if form completion drops >~15% relative; one screen not two; The
   Setting = one-tap basic picnic.
2. **Locked-bundle frustration** — monitor step abandonment; The Setting is the pressure valve.
3. **Gated add-on over-promise** — admin booking view shows a loud amber flag when a
   confirmed booking contains 29/30/32.
4. **app.js parse crash (recurring)** — file tools only; grep U+2018/U+2019 used as string
   delimiters; `node --check`; build on Windows (sandbox esbuild crashes / torn mounts).

## Measurement

PostHog: `package_step_viewed`, `package_tier_selected{tier,occasion}`, `addon_attached`,
`booking_submitted`. AOV from `total_amount` (already stored). Baseline = bookings before
launch. Optional durable tier attribution: nullable `bookings.selected_package text` —
but that touches `submit_booking_intent`, so it's a deliberate add, not free. PostHog-first.

## Sequencing (each phase has an exit condition)

1. **Verify anchors** in app.js — occasion `<select>`, `.bv-addon-check[data-addon-id]`,
   `updateBookingSummaryPrice()`, `showVenuePage`, `venueCardHtml`, guest-count input, the
   home/venues view + routing (`/venues/<slug>`, `?venue=ID`, popstate). Exit: confirmed
   against live file (CLAUDE.md line numbers are stale by nature). **← first concrete action.**
2. **Tier config + occasion default map + guest-count moved to venue step.** Exit: tier prices
   match `compute_booking_total` for ≥2 venues at 2/4/6 guests.
3. **Tier step (priced cards)** shared by both flows. Exit: venue-first and packages-first both
   reach the tier step with venue+occasion+guests set; prices exact.
4. **Homepage "Our Packages" section + packages-first routing** (occasion → venue → guests →
   tier). Exit: homepage entry reaches the same shared tier step.
5. **Booking form changes** — drop occasion field, show package summary, hide included add-ons,
   show only remaining. Locked-bundle total correct. Exit: form renders from the chosen package;
   total = `compute_booking_total(... tier.addons ∪ extras)`.
6. **Deep-link fallback** — venue detail page surfaces tiers; direct entries default to The
   Setting/no occasion without breaking. Exit: `/venues/<slug>` loads, books, and shows tiers.
7. **Feature flag + PostHog events + admin gated-flag.** Exit: flag toggles packages; events fire.
8. **Verify.** Exit: `node --check` clean, no smart-quote delimiters, localhost Chrome test of
   BOTH flows + a deep-link entry passes.

## Phase 0 — pricing rework (PARTIALLY DONE — status corrected 2026-07-06)

> **Live-DB reality (verified 2026-07-06):** all 6 cafes have `free_guests_upto=6` (flat-to-6 is
> live everywhere via the promoted pricing columns, not metadata.tiers). BUT the −₹1,000 base cut
> was applied only to Beige (8,900); the other 5 keep their original bases, and `overage_per_person`
> is 2000/2500 — not this plan's 1000. **Open decision:** confirm current bases/overage as
> intentional, or enter the reduced bases below. The table's "pending" column is otherwise stale.

Decision: go with ₹8,900 setup-only "The Setting" base, flat for 1–6 guests, now. Food removed
from base (food add-on still parked).

**Key finding (verified from `compute_booking_total` source):** price is driven ENTIRELY by
`venues.metadata.tiers`. `food_multiplier` does NOT affect price (display-only). So this is a
DATA-ONLY change — rewrite each cafe venue's `tiers`; no function migration, no code deploy,
instantly reversible.

**Model → tiers mapping** (BASE per venue; +₹3,000 per 3 guests beyond 6, flat across venues):
```
tiers = [ {up_to:6, price:BASE}, {up_to:9, BASE+3000}, {up_to:12, BASE+6000},
          {up_to:15, BASE+9000}, {up_to:18, BASE+12000} ]
overage_per_person = 1000   // linear backstop beyond top bracket
```
Function picks smallest `up_to >= guests`, so 1–6 → BASE (flat), 7–9 → +3000, etc. The Setting
package price = `compute_booking_total(venue, ≤6, slot, [])` = BASE automatically.

**BLOCKING INPUT — per-venue BASE (only Beige confirmed):**
| Venue | Current 2g | Proposed BASE | Confirmed? |
|---|---|---|---|
| Beige Cafe (14) | 9,900 | 8,900 | YES |
| Castle Valley (19) | 9,900 | 8,900? | pending |
| House of Amer (24) | 9,900 | 8,900? | pending |
| Om Niwas (20) | 12,900 | 11,900? | pending |
| The Sunroom (18) | 13,900 | 12,900? | pending |
| Once Upon A Time (21) | 15,900 | 14,900? | pending |
(Proposed = current 2g − ₹1,000 food component; CONFIRM or override before applying.)

**Implementation = MANUAL admin entry (chosen). No code, no SQL, no function change.**
Verified: admin save rebuilds `metadata = {tiers, overage_per_person, includes}` (app.js ~5623),
so entering new tiers and saving auto-strips `food_multiplier`/`drink_multiplier` → the "Included
in your price" banner disappears (`getInclusions` returns null when both are gone, app.js 172).
Food + drinks now handled OFFLINE. JS `getVenuePrice` and SQL `compute_booking_total` both read
`metadata.tiers`, so manual entry keeps them in sync (no drift risk).

**Per-venue admin runbook (user does this for each active cafe venue):**
1. Open venue in admin → Edit.
2. Set Base price = BASE (drives the "From ₹X" card/detail label — keep = the up_to:6 price).
3. Tier rows (edit the existing 3 rows + add as needed), `up_to → price`:
   `6 → BASE`, `9 → BASE+3000`, `12 → BASE+6000`, `15 → BASE+9000`, `18 → BASE+12000`
   (extend to the venue's real max capacity).
4. Overage = **1000** (form defaults to 2000 — must change it; it's the per-person backstop beyond the top bracket).
5. Save. (Save auto-removes food/drink inclusions — intended.)

Active cafe venues to update: Beige(14, BASE 8900 confirmed), Castle Valley(19), House of
Amer(24), Om Niwas(20), The Sunroom(18), Once Upon A Time(21). BASE per venue set by user.

**Verify after entry** (run per venue): `compute_booking_total(id, 2/6/7/9/12, 0, '{}', '<slot>')`
should return BASE / BASE / BASE+3000 / BASE+3000 / BASE+6000. Spot-check a venue page shows the
food/drink banner gone and "From ₹BASE".

**Risk:** re-prices every cafe booking the instant a venue is saved (4g Beige 12,900 → 8,900).
It's per-venue and reversible (re-enter old tiers). Do during low traffic; verify each venue
right after saving.

### Phase 0.5 — keep multipliers, hide banner (reversible)

User wants `food_multiplier`/`drink_multiplier` RETAINED in metadata (to re-enable food/drinks
online later) but the "Included in your price" banner GONE now. Deleting the multipliers is
therefore off the table → this needs code. Three small app.js changes:

1. **`getInclusions` (app.js ~168)** — add at top: `if (venue?.metadata?.food_offline) return null`.
   Hides the banner per-venue, reversibly; multipliers untouched; re-enable = clear the flag.
2. **Fix destructive admin save (merge, not replace)** — capture original metadata in
   `populateVenueForm` (~5181) into a module var `venueEditOriginalMeta`; reset it to `{}` on
   the add-new path; change `handleVenueFormSubmit` line 5623 to:
   `let metadata = { ...venueEditOriginalMeta, tiers, overage_per_person: overage, includes: splitCsv('vf-includes') }`.
   Preserves food/drink multipliers + `food_offline` + any unmanaged key across admin saves.
   Also fixes the latent destructive-metadata-replace bug. (self_managed branch already spreads
   local `metadata`, so it flows through.)
3. **Set `food_offline: true`** on the 6 active cafe venues (SQL once; merge fix keeps it).
   Optional follow-on: admin form checkbox to toggle it without SQL.

⚠️ These edit app.js (recurring smart-quote crash file): file tools only, grep U+2018/U+2019,
`node --check`, Windows build, no commit without go-ahead. This is the only code in Phase 0;
tier/base pricing remains manual admin data entry per the runbook above.

Packages (Phase 1+) build on top; tier cards read `compute_booking_total` so they pick up the
new prices for free.
- Durable per-booking tier attribution (`bookings.selected_package` column) — PostHog-first
  for MVP; add column only if event-based attribution proves insufficient.

## Leaner alternative (tested, rejected — kept as rollback fallback)

Skip the package screen; default add-ons into the existing form by occasion. Purest AOV
test, zero new screens — but no visible "packages" concept and nothing to anchor the higher
price to. Use as instant fallback if the package screen measurably hurts conversion.

## Standing rules

Never `git add -A`. No commit without explicit user go-ahead (run from Windows terminal).
Supabase project `evmftrogyzoudiccqkya`. Edit app.js via file tools only.
