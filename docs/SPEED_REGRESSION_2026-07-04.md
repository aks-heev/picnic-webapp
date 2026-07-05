# Site Speed Regression — Diagnosis & Remediation Plan (2026-07-04)

**Symptom:** Vercel Speed Insights score dropped 99 → 75 on Jul 4; site "feels slow."
**Verdict:** Real regression, caused by the Jul 3 `/packages` redesign deploy (commit `4f40d3f`, live ~21:41 IST). Speed Insights is a rolling real-user p75, so it surfaced Jul 4.

## Evidence (PostHog `$web_vitals`, p75)

Site-wide daily:

| Day | LCP | INP | CLS | vitals events / sessions |
|---|---|---|---|---|
| Jul 2 (before) | 1615ms | 100ms | 0.00 | 45 / 17 |
| Jul 3 (deploy PM) | 1701ms | 142ms | 0.001 | 183 / 42 |
| Jul 4 (after) | 3600ms | 700ms | **1.192** | 46 / 17 |

Per-page (the smoking gun):

| Page | Jul 2 CLS | Jul 3 CLS | Jul 4 CLS | Notes |
|---|---|---|---|---|
| Home | 0.00 | **1.371** | **1.382** | Flips on deploy. INP 24→760ms. Highest traffic → dominates score. |
| Packages | 0.00 | 0.00 | 0.04 | Fine. The redesigned page itself is not the problem. |
| Venue | 0.617 | 0.00 | — | Mobile LCP spiked to ~5.5s on Jul 4 (14 samples — real but noisier). |

## Root causes (confirmed in code)

1. **Homepage CLS (primary, high confidence).** `#packages-section` ships `display:none` in `index.html`; the section + venue-card carousels render only after an async Supabase load (`renderHomePackagesSection` / `revealPackagesEntryPoints`, `app.js` ~L2375–2400). Revealing it post-paint pushes venues/testimonials/footer down.
2. **INP (homepage 760ms, one venue 1344ms).** Three simultaneous `setInterval` auto-advance carousels (`app.js` L699, L1328, L1982) + a 410KB monolithic `app.js` that bundles all **admin** code into the public site. Third-party scripts (GA4, Meta Pixel, PostHog, Razorpay) also compete for the main thread at bootstrap.
3. **LCP (mobile venue pages ~5.5s).** Hero `<img>` (`app.js` L936) and card images have no `width`/`height`/`fetchpriority` and load full-resolution from Supabase Storage (no server-side resize). Repo also has 6–8MB add-on PNGs alongside a `webp/` folder — confirm which is served.

Note: Vite minifies `app.js`/`style.css` in the production build, so the raw source size is not shipped as-is. Bundle still matters (admin split), but images + the reveal pattern are the regressors.

---

# Remediation Plan (optimized: 69 → 84 → 89)

Phases are gated: each has an exit metric. Target = restore homepage CLS < 0.1, INP < 200ms, mobile LCP < 2.5s → Speed score back to 90+.

## Phase 0 — Decide: fix-forward vs. instant rollback (5 min)
- **Fix-forward (recommended).** The redesign is desired product work and the top fix (Phase 1) is small. Keep the redesign, fix the CLS.
- **Fallback:** Vercel Instant Rollback to the last pre-redesign production deploy (`f60c88e`, Jul 2) recovers the score immediately but reverts the entire packages redesign. Only use if the score must be green *today* and Phase 1 can't ship within hours.
- Exit: choice made. Do not do both.

## Phase 1 — Kill the homepage layout shift (biggest lever, ~1–2 hrs)
Fixes homepage CLS 1.38 → ~0. This one change recovers most of the score.
- Stop revealing `#packages-section` via `display:none`→visible. Instead **reserve its space from first paint**. Preferred: extend the existing prerender (`scripts/prerender-venues.mjs`, which already prerenders `/packages`) to emit the homepage packages teaser + venue grid as static skeleton cards at their final dimensions, then hydrate in place.
  - Quick interim if prerender is too much now: render the section always-present with a `min-height` reservation sized to its rendered height, and toggle `opacity`/`visibility` (not `display`) so height never changes. Same for the "Choose Your Venue" grid container (reserve min-height / skeleton cards).
- Ensure the `#hero-packages-cta` "View Packages" button also doesn't shift the hero when revealed (reserve its slot).
- First action: in `index.html` remove `style="display:none"` from `#packages-section` and give the container a reserved-height skeleton; adjust `renderHomePackagesSection` (app.js ~L2390) to replace skeleton content rather than toggling display.
- Exit: PostHog home-bucket p75 CLS < 0.1 over the next day (or local Lighthouse mobile CLS < 0.1).

## Phase 2 — Cut interaction latency (INP) (code-grounded, revised 2026-07-04)
STATUS 2026-07-04: A + B + D′ IMPLEMENTED (analytics.js lazy-loads+samples PostHog; app.js gates
carousels), verified on dev server (no console errors; posthog-js + rrweb recorder load AFTER the
load event; carousels pause when tab hidden). UNCOMMITTED. C (Meta Pixel defer) NOT done — left
until it can be watched in Meta Events Manager. Real `npm run build` not run in-session (sandbox
mount staleness) — run it on Windows before deploy as the final gate.

Target: homepage p75 INP < 200ms. NOTE: Phase 1 already moved homepage INP 760 → 340ms
in the post-fix sample (removing the reflow helped), so the remaining gap is smaller than
the original diagnosis implied. Ordered by ROI (impact ÷ risk).

**A. Sample PostHog session replay — biggest lever, config-only, ~20 min.** `analytics.js`
`posthog.init` runs `session_recording` (rrweb) — confirmed active via the `$snapshot`/rrweb
properties in event data. rrweb serializes DOM mutations on the main thread continuously =
the dominant hidden INP cost. `autocapture` is already `false` (not a factor). Decision:
sample at ~20% (keeps a representative slice of replays; cuts the cost for 80% of sessions).
Cleanest mechanism = PostHog project settings → Session Replay → sampling; confirm at build
time. Reversible. Exit: homepage p75 INP < 200ms.

**B. Gate the carousels — easy, low risk, ~30 min.** Three single global tickers (NOT per-card):
venue-card `setInterval` (app.js L699, 4500ms), pkg-card (L1982, 4500ms), venue-hero slider
(L1328, 4000ms). All run unconditionally, even when the tab is hidden or the carousel is
off-screen. Pause on `document.hidden` (visibilitychange) + `IntersectionObserver`; skip
auto-advance entirely under `prefers-reduced-motion`. Exit: no ticker work while
backgrounded/off-screen.

**C. Defer GA + Meta Pixel — moderate benefit, low-moderate risk, ~30 min.** In `index.html`,
GA is already `async` but Meta Pixel injects `fbevents.js` and fires `init`+`PageView`
synchronously in `<head>` (L86–97). Move both to `requestIdleCallback`/first-interaction; keep
the Pixel `PageView` firing (a few seconds later is fine for attribution) and keep the noscript
fallback. RISK: these events feed the Meta ad account — verify in Meta Events Manager after that
PageView/ViewContent/Lead/InitiateCheckout still land. Exit: lower main-thread contention in the
critical window, Pixel events confirmed intact.

**D. Admin bundle split — MEASURED 2026-07-04 → SKIP for now.** Public bundle (esbuild, minified) =
540KB min / 157KB gzip. Composition: posthog-js 211KB (39%), app code 211KB (39%), supabase-js
115KB (21%), rest <1%. Admin-only code ≈ 99KB of 408KB app.js source (~24%) = ~50KB min / ~14KB
gzip of the bundle. So the split saves only ~9% of the bundle (~14KB gzip), does NOT touch
posthog/supabase (both surfaces need them), and is the highest-risk item (admin functions scattered
across app.js: renderQueries, openQueryEdit, availability/iCal panels, handleVenueFormSubmit,
*Manager, loadHeroImageAdminPreview, renderBookings, + `window`-attached handlers). VERDICT: not
worth the risk now.

**D′ (replaces D) — Lazy-load posthog-js: bigger + safer win.** posthog-js is 39% of the bundle
(~55KB gzip), the single largest piece, fat because it bundles session replay/rrweb. Dynamic-import
PostHog after first paint (analytics can wait a beat) and load replay only for sampled sessions
(ties into Item A). Optionally dynamic-import supabase-js (21%) so it's a parallel chunk rather than
blocking app-code parse. ~4× the payoff of the admin split at lower risk. Revisit the admin split
only if app-code parse stays a bottleneck after A/B/C/D′.

Sequence: A → B → C → D′, re-measure INP. A+B+C ≈ 1.5–2 hrs; D′ ≈ 1–2 hrs. Admin split shelved.

## Phase 3 — Fix image LCP (~half day)
Fixes mobile venue LCP ~5.5s → <2.5s.
- Add `fetchpriority="high"` + explicit `width`/`height` to the LCP hero image (venue `vd-hero-img` L936; homepage hero), and `<link rel="preload">` it.
- Serve **resized** images, not full-res: use Supabase Storage's image transformation endpoint (`/storage/v1/render/image/public/...?width=&quality=`) sized to viewport; add `srcset`/`w=` for Unsplash. Homepage hero is currently a flat `w=1600` served to phones.
- Confirm the site references the `webp/` versions, not the 6–8MB source PNGs in `add_ons images/`. Convert/point any that still use PNG.
- Keep non-first carousel images `loading="lazy"` (already set); ensure the LCP image is NOT lazy.
- Exit: venue-bucket p75 LCP < 2.5s on mobile (confirm on a real throttled mobile run — Jul-4 sample was small).

## Phase 4 — Guardrails so this can't silently recur (~2 hrs)
- Add a pre-deploy **Lighthouse mobile check** (throttled) on `/`, `/packages`, one venue page — fail the check on CLS > 0.1 or perf < 85. (Lighthouse CI action or a manual checklist gate.)
- Stand up a small **PostHog web-vitals view/artifact** (daily p75 LCP/INP/CLS by page) so a regression is visible within a day instead of via the Vercel score.
- Exit: check runs on next deploy; vitals view bookmarked.

## Verification (whole plan)
- Primary signal: PostHog home-bucket p75 CLS returns to <0.1 and INP <200ms within 24h of Phase 1–2 deploy.
- Secondary: Vercel Speed score returns to 90+ over its rolling window.
- Cross-check: local Lighthouse mobile (throttled) on `/`, one venue page, `/packages`.

## Caveats / honest gaps
- Jul-4 samples are small (17 sessions); the exact "75" is volatile at this traffic. The *magnitude* of the homepage CLS change (0→1.37) is far too large to be noise — that's the real, high-confidence finding. Venue mobile LCP is real but should be reconfirmed on a throttled mobile run before assuming 5.5s is typical.
- Order matters: Phase 1 alone likely recovers the bulk of the score because the homepage dominates traffic. Don't spread effort evenly.

## Optimizer trajectory
69 → 84 → 89 (plateau). Biggest hardening from draft to final: (1) phase-gating each fix to a specific metric exit condition; (2) splitting the vague "improve INP" into shared-ticker + defer-3P + admin-code-split with the admin bundle called out; (3) adding the anti-regression guardrail and the honest small-sample caveat.
