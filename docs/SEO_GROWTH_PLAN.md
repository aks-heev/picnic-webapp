# picnicstories.com — Organic Traffic & Conversion Plan
_Produced 2026-07-02 via plan-optimizer loop (final score 86/100; trajectory 64 → 78 → 84 → 86)._

## Ground truth this plan is built on (verified 2026-07-02)

- **Only 15 indexable URLs** (home + 12 venue + 2 city pages). Prerender pipeline works; meta/OG/canonical are correct (www).
- **Duplicate-content defect:** every prerendered venue page contains the FULL homepage content with a small unique venue block appended (~90% shared content across all 13 pages). Confirmed by fetching `/venues/beige-cafe`.
- **Analytics reality:** GA4 (`G-KNZCTW1KVH`) live · Vercel Web Analytics live (dashboard-only, no API) · ~~PostHog dead in prod~~ **PostHog LIVE since 2026-07-02** (web vitals + packages funnel events landing in project 482400; replay sampled ~20% since 07-06) · Meta pixel live.
- **Local SEO gap:** Google Business Profiles (Jaipur + Gurugram) still not created (open since 2026-06-23). LocalBusiness JSON-LD is live for both cities.
- **Performance:** 525KB app.js bundle (split deferred "Month 2"); hero image is an external Unsplash URL (likely LCP element, no preload, not self-hosted); prerendered pages hide content behind a loader overlay for 1–2s.
- **Known conversion bugs:** venue-page sticky "Check Availability" sidebar taller than viewport (Book Now below fold); Story-tier package price inflated until Phase-0 flat pricing entered in admin.
- **SERP opening:** Jaipur picnic queries return listicles/resorts/farmhouses — no direct "luxury picnic setup/experience" competitor ranks. Exact-intent space is winnable.

---

## Phase 0 — Measurement + free wins (Week 1, ~1 day of work)

1. **Set `VITE_POSTHOG_KEY` (+ `VITE_POSTHOG_HOST=https://us.posthog.com`) in Vercel env** and redeploy. Without this, every later step is unmeasurable. Verify events arrive in project 482400.
2. **Google Search Console:** verify `www.picnicstories.com` (domain property), submit `sitemap.xml`, record baseline: impressions, clicks, and index coverage of the 15 URLs. Check Google isn't serving the non-www or `.vercel.app` domains.
3. **Create both Google Business Profiles** (Jaipur + Gurugram, numbers already in JSON-LD). This is the single highest-leverage local action and costs ₹0. Categories: Event planner / Picnic ground. Add booking link to the matching city page, not the homepage.
4. **Define conversions in GA4 + PostHog:** WhatsApp CTA click, Send Enquiry submit, Book Now click, booking-intent submitted, payment success. Baseline GA4 *engagement rate* (bounce inverse) per landing page.
5. Run PageSpeed Insights on `/`, one venue page, one city page; record LCP/INP/CLS baselines.

**Exit condition:** PostHog receiving events; GSC verified with baseline exported; 2 GBPs pending/verified; conversion events firing.

## Phase 1 — Technical SEO fixes (Weeks 2–4)

1. **Kill the duplicate-content defect (highest technical priority).** Change `scripts/prerender-venues.mjs` so venue pages ship a slim shell: strip the homepage sections (offer cards, testimonials, menu) from the prerendered HTML body, keep the unique venue block + nav + footer + internal links. Every venue page should be >60% unique text, not <10%.
2. **LCP fix:** self-host the hero image (Supabase storage or `/public`), serve responsive AVIF/WebP with explicit `width/height`, `fetchpriority="high"`, `<link rel=preload>`. Remove Unsplash dependency.
3. **Loader overlay:** ensure the prerendered venue text is visible to the crawler AND the overlay doesn't suppress paint — check rendered HTML in GSC URL-inspection; if LCP is the overlay logo, cap it or fade earlier.
4. **Bundle split (already planned Month 2):** route-level dynamic imports; target <200KB initial JS. Admin code must not ship to the storefront bundle.
5. **Schema upgrades:** add `FAQPage` to venue pages (needs Phase-2 FAQ content); add `aggregateRating` to venue Product/TouristAttraction JSON-LD **only after** real GBP reviews exist (Phase 3) — fake ratings risk manual action.

**Exit condition:** venue pages majority-unique in rendered HTML; PSI mobile LCP <2.5s on home + venue template; initial JS <200KB.

## Phase 2 — Content engine: pages that can rank (Weeks 3–8)

The site cannot grow past ~15 URLs' worth of demand. Build pages against the keyword map, reusing the existing prerender + `CITY_CONFIG` pattern (no new framework).

**Keyword → page map (build in this order):**

| Intent | Target page | Notes |
|---|---|---|
| proposal setup jaipur / romantic proposal ideas jaipur | `/proposal-picnic-jaipur` | Proposals = 28% of bookings, photographer upsell page |
| birthday picnic celebration jaipur | `/birthday-picnic-jaipur` | Links to Moment tier |
| anniversary / date night picnic jaipur | `/date-night-picnic-jaipur` | |
| candlelight dinner gurugram (high volume, adjacent intent) | `/candlelight-dinner-gurugram` | Positions picnic as the differentiated answer |
| corporate offsite / team outing gurugram | `/corporate-picnic-gurugram` | Weekday inventory filler |
| best picnic spots in jaipur | blog listicle | SERP is 100% listicles — match format, link every venue |

Rules: one primary keyword per page; occasion pages link to 3–4 relevant venue pages and the city page (hub-and-spoke); city pages link back to occasion pages. Each page needs ≥500 words of genuinely specific content (real venue details, real prices, real photos with descriptive alt text) — not AI filler; thin doorway pages get filtered.

**Venue-page enrichment:** add per-venue FAQ (4–6 real questions from WhatsApp threads), "what's included", best time to visit, occasion suitability. This is also the `FAQPage` schema source.

**Cadence:** 2 pages/week max. Add each to sitemap + prerender automatically.

**Exit condition:** 25–35 indexed URLs; every occasion page indexed and receiving impressions in GSC.

## Phase 3 — Reviews & local flywheel (ongoing from Week 2)

1. **Review engine:** day-after-event WhatsApp message with the GBP review link (per city). Target 10 reviews/city in 60 days. This feeds: GBP ranking → "picnic near me" map pack → `aggregateRating` schema → CTR.
2. Citations: JustDial, Sulekha, WedMeGood/local wedding directories, Instagram bio → city pages.
3. Embed 3–4 real GBP reviews on venue pages (text, not widget).

## Phase 4 — Conversion & bounce (Weeks 2–6, parallel)

1. **Fix the sticky-sidebar overflow bug** — Book Now below the fold on desktop is a direct booking-flow leak (already diagnosed 2026-07-01).
2. **Enter Phase-0 flat tier pricing in admin** — Story tier currently shows food-inflated pricing (~₹26k+); mispriced anchor suppresses package take-rate.
3. **Bounce levers on landing pages:** occasion pages get a single above-the-fold CTA (WhatsApp or Book Now, test which), price anchor ("From ₹9,900"), and 3 venue cards immediately visible. Measure with GA4 engagement rate per landing page, not sitewide "bounce".
4. **Funnel instrumentation (needs Phase-0 PostHog):** venue view → slot picked → guest step → package picked → form submit → payment. Fix the biggest measured drop-off, not the guessed one.

## Metrics & cadence

| Metric | Baseline (record Week 1) | 90-day target |
|---|---|---|
| Indexed URLs | ~15 | 30–35 |
| GSC non-brand clicks/mo | record | 3–5× baseline |
| GA4 engagement rate (organic landings) | record | +15pts |
| Enquiries (WhatsApp + form) from organic | record | 2× baseline |
| GBP reviews | 0 | 10+/city |
| Mobile LCP (home, venue) | record | <2.5s |

Weekly 20-min review: GSC queries/coverage + PostHog funnel + GBP insights. Kill or rewrite any page with impressions but CTR <1% after 4 weeks (title/meta rewrite first).

## Risks

- **Prerender fragility:** every template change must be verified with GSC URL inspection / Rich Results test — the SPA shell means a broken prerender silently de-indexes everything.
- **Doorway-page filter:** occasion pages must be substantively different (unique venues, photos, FAQs), or Google collapses them. 2/week cap enforces quality.
- **GBP verification delays** (video/postcard verification in India can take weeks) — start Week 1, don't block other phases on it.
- **Cannibalization:** city page vs occasion page for "picnic jaipur" head term — city page owns the head term; occasion pages target modifier queries only.
- **Vercel/GA4 data lives outside this workspace** — export baselines manually in Week 1 or the 90-day targets are unanchored.
