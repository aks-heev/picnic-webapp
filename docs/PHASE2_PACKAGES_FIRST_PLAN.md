# Phase 2 — Packages-First Entry Point (/packages route + homepage section)

> Plan-optimizer score 90/100 (trajectory 82 → 88 → 90 → plateau). 2026-07-02.
> Decisions locked with Aksheev: real `/packages` route + homepage section; venue
> picker shows whatever venues have `packages_enabled` (works with 1, richer as
> more flip on); plan doc + implementation same session.

## Goal

Give packages their own front door so occasion-led buyers (the AOV segment —
₹180k+ of extras sold offline last year) can enter occasion → tier → venue,
instead of only discovering tiers after picking a venue. Done means: a booking
created via the packages-first path is **byte-identical** in shape to one
created venue-first (same `selectedPackage`, same locked bundle, same lead
payload), and the funnel is measurable in PostHog end to end.

## Keystone (unchanged from 06-30 design lock)

`appState.selectedPackage = {occasion, tierKey, addonIds}` — the booking form
reads ONLY this. The packages-first path must not re-implement tier→addon
resolution. Mechanism:

- New `appState.pendingPackage = {occasion, tierKey}` — set ONLY by the
  packages-first path, before navigating to the venue page.
- `showVenuePage()` resets `selectedPackage` (~app.js L685) — it must NOT
  reset `pendingPackage`. Organic venue visits never set it, so no leakage.
- Consumption point: the Book-Now click handler (~L8038). Where it currently
  does `else if (packageFlowActive(venue)) showPackageStep(venue)`, insert:
  if `pendingPackage?.tierKey` → prefill `bookingOccasion ||= pendingPackage.occasion`,
  call **the existing `selectPackageTier(pendingPackage.tierKey)`**, clear
  `pendingPackage`. That reuses the exact venue-first code path (catalog
  filtering at L2286, analytics, changeMode handling) — one code path, zero drift.
- Tier step is skipped, not hidden: user already chose. The intent screen's
  existing "Change package" (`changePackageFromIntent`) remains the escape hatch.
- Occasion select in the guest step pre-fills from `pendingPackage.occasion`,
  stays editable; changing it does NOT re-bias the already-chosen tier.
- Hard-refresh hardening: mirror `pendingPackage` to
  `sessionStorage['ps_pending_pkg']` on set, restore at bootstrap, clear on
  consumption or flow exit.

## The /packages page (SPA route)

Three in-page steps, no sub-routes:

1. **Occasion** — chips using the SAME canonical occasion keys as the
   guest-step select (one shared constant — 'Date night' vs 'date_night'
   drift between surfaces and future `packages.occasion` values would be a
   silent bug). Selecting biases the default tier via existing
   `defaultTierForOccasion()`. Skippable.
2. **Tier** — cards mirroring `showPackageStep()` markup/CSS (`pkg-card*`),
   priced as **"From ₹X"** = min across enabled venues of
   `packageTierPrice(venue, tier, catalog)` at 2 adults. **List-driven, never
   assumes 3 cards**: rendered from a shared `visiblePackagesFor(occasion)`
   helper (today: everything, since all packages are universal). The
   "Everything in <prev>, plus:" ladder copy applies only between consecutive
   packages of the universal chain — standalone (future occasion-specific)
   packages get plain inclusion lists.
3. **Venue** — cards for venues where `packageFlowActive(venue)` is true, each
   showing the FIRM price for the chosen tier at that venue (2 adults,
   "for 2 adults" note). Click → set `pendingPackage` (+sessionStorage) →
   `showVenuePage(id)` (client-side nav) → calendar → slot → guests → form.

Data needs:
- Tiers: `PACKAGE_TIERS` already DB-loaded at bootstrap (`loadPackages()`),
  hardcoded fallback already exists — page must render fine on fallback.
- Venues: `appState.venues` via `loadVenues()` — page render awaits it.
- Catalogs: new `loadCatalogsForVenues(ids)` — ONE batched
  `venue_add_ons.select(...).in('venue_id', ids)` for all enabled venues,
  cached in `appState.venueCatalogCache` (also reusable by the venue page).
  Never per-venue N+1.
- Zero enabled venues → page shows a graceful "browse venues" fallback CTA;
  homepage section hides (see below).

Routing wiring (mirrors the /venues/<slug> pattern):
- Bootstrap (~L7920): recognize `location.pathname === '/packages'` →
  `showPackagesPage(false)`.
- `popstate` handler (~L7741): add a `/packages` branch; home reset keeps
  working.
- `showPackagesPage(push=true)`: renders `#packages-page` section via the
  `showPage()` pattern; `history.pushState({}, '', '/packages')`.
- Deep-links: `?tier=story` (homepage cards) jumps to step 3 with that tier
  chosen; `?occasion=date_night` preselects the occasion chip. Unknown values
  ignored gracefully.
- All inline onclick handlers exposed as `window.*` (ES module — established
  pattern).

## Homepage section

New `<section id="packages-section">` in index.html between the offer strip
and `#venues-section` (~L219). Static skeleton, populated by JS: 3 tier cards
with From-prices + occasion line, CTA per card → `/packages?tier=<key>`.
`display:none` until packages + venues are loaded AND ≥1 venue has packages
enabled — no CLS, no dead section if everything is off.

## Prerender / SEO

Extend `scripts/prerender-venues.mjs` (postbuild, fetches live Supabase data —
same as city pages):
- `buildPackagesPage()` → `dist/packages.html`: per-page title/description/
  canonical `https://www.picnicstories.com/packages` + OG/Twitter, crawlable
  content block (tier names, taglines, inclusions, From-prices), JSON-LD
  `OfferCatalog`, and the existing `#pr-loader` overlay pattern.
- Sitemap: 15 → 16 URLs.
- Staleness mitigation: build-time From-prices are placeholders; the client
  re-renders live prices on load (admin price edits don't trigger rebuilds).

## Analytics

`track()` events: `packages_page_viewed`, `packages_occasion_selected`,
`packages_tier_selected {tier}`, `packages_venue_selected {venue_id, tier}`.
Existing `package_step_*`/`package_tier_selected` events continue to fire at
consumption (via `selectPackageTier` reuse) — funnels join there. Meta Pixel
`ViewContent` on /packages.

## Phases (each independently shippable)

- **A — Core flow.** Route + page + 3 steps + `pendingPackage` handoff +
  skip-consumption + `loadCatalogsForVenues` + the shared
  `visiblePackagesFor(occasion)` helper, called by BOTH the /packages tier
  step and the venue-first `showPackageStep()`/`changePackageFromIntent()`
  (one filter, two surfaces — prevents the venue-first flow drifting when
  occasion-specific packages land). Fallback `PACKAGE_TIERS` rows have no
  occasion field → treat missing/`null` occasion as universal. Exit: parity
  check — same venue/tier/guests via both paths produces identical
  `selectedPackage` and intent-screen totals (verify live via Chrome MCP on
  localhost).
- **B — Homepage section.** Cards, From-prices, auto-hide. Exit: section
  renders after data load, CTA deep-links with tier preselected.
- **C — Prerender/SEO.** packages.html + sitemap + meta + loader. Exit:
  `npm run build && npm run preview` serves /packages with crawlable content
  pre-JS (dev server won't serve it — known caveat, dist-only).
- **D — Hardening + measurement.** sessionStorage restore, zero-venue
  fallback, Meta Pixel, mobile pass. Exit: events visible in PostHog; mobile
  walkthrough clean.

## Risks & mitigations

1. **Only Beige enabled** → thin step 3. Ships fine (design decision);
   "More venues joining soon" copy; flipping venues on is one admin checkbox
   each, after Phase 0 pricing entry.
2. **Phase 0 flat pricing not yet entered** → From-prices are the current
   food-inflated bases, not the ₹9,900/₹13,500/₹26,000 anchors. Acceptable:
   all prices derive live, so entering Phase 0 pricing in admin self-corrects
   every surface at once. Do NOT hardcode anchor prices anywhere.
3. **Path drift** → structurally prevented: consumption calls
   `selectPackageTier()`; no second tier-resolution implementation exists.
4. **Hard refresh mid-flow** → sessionStorage mirror (Phase D).
5. **Packages fetch failure** → existing hardcoded `PACKAGE_TIERS` fallback;
   page renders from it.
6. **Prerendered price staleness** → client rehydration on load.
7. **Venue catalog gaps** (e.g. venue 21 missing Skyshots) → already handled:
   catalog filter in `selectPackageTier` keeps price and bundle self-consistent;
   admin Packages tab flags gaps loudly.

## Success metrics (PostHog)

Packages-first funnel conversion (page → tier → venue → booking); AOV of
packages-first vs venue-first bookings; Photographer attach rate on
proposal-occasion bookings; per-step drop-off.

## Phase 2.5 — Occasion-specific packages (schema-ready, build later)

Planned: dedicated packages for date night and movie night. Phase 2 is built
so this is additive, not a rework. When the packages are actually defined:

1. **Migration**: `packages.occasion text NULL` — `NULL` = universal (all
   current rows), else a canonical occasion key. Keep `packages.key` unique
   across ALL rows (occasion packages get keys like `date_night_classic`).
   `loadPackages()` already `select('*')`s — no client fetch change.
2. **Filter semantics**: `visiblePackagesFor(occasion)` (built in Phase A)
   starts returning universal + that occasion's packages. Decision needed
   then, not now: occasion packages AUGMENT the universal three (risk: choice
   overload at 5+ cards) or REPLACE them for that occasion (risk: loses the
   cheap Setting anchor). Schema supports both.
3. **Required-addon rule** — the real design hole occasion packages expose:
   `selectPackageTier` silently drops add-ons missing from a venue's catalog
   (~L2286). Tolerable for the universal ladder; fatal for themed packages (a
   "Movie Night" without Movie Screening isn't the product). Add
   `package_add_ons.is_required boolean` (or `packages.required_addon_ids`);
   a package is HIDDEN at venues whose catalog can't serve its required
   add-ons. This must also constrain: the /packages venue-picker list, the
   "From ₹X" min (only over serviceable venues), and the admin per-venue
   price table's gap flags (upgrade gap → "not offerable here").
4. **Admin UI**: the deferred add/delete/reorder work becomes required — plus
   an occasion select and required-addon checkboxes on the package card.
5. **Data-driven defaults**: `OCCASION_DEFAULT_TIER` (hardcoded JS map feeding
   `defaultTierForOccasion()`) should move to data (e.g. per-occasion featured
   flag) once occasions have their own packages.
6. **Occasion key canon**: guest-step select, /packages chips, and
   `packages.occasion` values must all draw from one shared constant.

## Out of scope

City filtering on /packages, packages for partner_bnb/stays.
