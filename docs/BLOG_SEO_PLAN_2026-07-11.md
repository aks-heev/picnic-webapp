# Blog SEO Plan — picnicstories.com (v2, optimized)

**Date:** July 11, 2026 · **Status:** posts NOT yet written · **Executors:** Adhiraj + Claude (drafts/edits/infra help) + dev (prerender)
**Supersedes:** the 2026-07-11 draft plan (wrong premises: assumed posts existed, treated rendering as unknown, GBP as uncreated, GA4 as the measurement stack).

## Goal & definition of done

Publish 4 blog posts by **July 20** so 8–12 weeks of SEO lead time lands compounding organic traffic in the Oct–Dec peak season.

**Done means:** 4 posts live at their slugs inside the existing prerender pipeline, indexed within 3 weeks, ≥1,000 combined monthly GSC impressions by Sept 30, and organic→enquiry attribution visible in PostHog by October.

## Ground truth this plan is built on (verified 2026-07-11)

- **Rendering is solved.** `scripts/prerender-venues.mjs` already writes static HTML for venue/city/packages pages + `sitemap.xml` + `robots.txt` at build. Blog = one more `buildBlogPages()` function + URLs pushed into the existing sitemap array. No SSR investigation needed.
- **No posts exist.** Content production is the critical path, not infrastructure.
- **GBP Gurugram is live + verified** (thin: 1 category, no service area, ~1 photo, 1 review). Task = enrich per `docs/Google Business Profile Playbook.docx`, not create. Jaipur GBP doesn't exist (create when Jaipur resumes ~Sept).
- **PostHog is the analytics stack** (live, dashboards, `intent_lead_captured`, DB `lead_status` funnel). No GA4. Intent-screen lead capture is confirmed live in prod — leads land in the DB on form render. Remaining measurement gap: Meta Pixel events unverified in Events Manager (owed anyway, not an SEO blocker).
- **Image-resize decision still open** (Supabase Image Transform Pro-plan unconfirmed). Fallback: manually pre-resize blog images before upload — don't block on it.

## The 4 posts (re-picked around booking data — birthday is the top occasion at 51 bookings, anniversary 25)

| # | Post | Primary keyword (winnable mid/long-tail) | Secondary (head) | Slug |
|---|---|---|---|---|
| 1 | Birthday picnic ideas | private birthday picnic Gurugram | birthday celebration ideas Gurugram | /blog/birthday-picnic-ideas-gurugram |
| 2 | Romantic date picnic | private candlelight picnic date Gurugram | best date ideas Gurugram | /blog/romantic-picnic-date-gurugram |
| 3 | Proposal planning | picnic proposal setup Delhi NCR | proposal ideas Gurugram | /blog/picnic-proposal-ideas-gurugram-delhi-ncr |
| 4 | Anniversary celebration | outdoor anniversary celebration Delhi NCR | anniversary celebration ideas Delhi NCR | /blog/anniversary-celebration-ideas-delhi-ncr |

Bachelorette + family-gathering move to the Phase 5 queue (no booking-data support for the initial slots). Family-gathering post must NOT target birthday keywords — post 1 owns that cluster. One post = one cluster; never add these keywords to other pages' titles/H1s.

**Why these can rank where "best date ideas Gurugram" listicles can't be beaten:** head-term SERPs are owned by LBB/So Delhi/Curly Tales (high-DA publishers we're pitching for backlinks, not displacing). Mid-tail commercial queries describe exactly what we sell — searcher intent is "book this," we're the product, and no listicle has our first-party photos or venue specifics.

## Per-post spec (applies to all 4)

- 1,200–1,800 words; H1 = primary keyword phrased naturally; title ≤60 chars, meta description ≤155.
- **First-party differentiation:** real venue photos (Supabase storage, pre-resized ≤1200px, WebP where possible, `loading="lazy"` below fold), real setup details, real occasion logistics. No stock imagery.
- 3–4 FAQ questions targeting People-Also-Ask ("What is the best place for a proposal in Gurugram?"). Write the FAQ content; skip FAQPage schema as a success gate — Google restricted FAQ rich results to gov/health sites in 2023. BlogPosting JSON-LD per post (headline, image, datePublished, publisher).
- **CTA deep-links to the occasion-filtered packages page** (`/packages?occasion=Birthday` etc.) — not the generic homepage.
- Internal links: 1–2 sibling posts + relevant venue page(s) + /packages. **No package prices anywhere** (evergreen content never quotes prices). **No TerraCottage Sienna references** until its placeholder copy is replaced.

## Phases — content and infra run in PARALLEL (this is how Jul 20 survives)

### Track A — Content (Claude drafts, Adhiraj approves) · Jul 11–18
| Step | Action | Exit |
|---|---|---|
| A1 | Claude drafts post 1 (birthday) first — sets voice + template | Adhiraj signs off on voice by Jul 13 |
| A2 | Claude drafts posts 2–4 using approved template | Drafts done Jul 15 |
| A3 | Adhiraj review pass: accuracy, venue facts, photos chosen | All 4 approved Jul 18 |
| A4 | Claude compliance check: no prices, no Sienna, titles/metas in limits, keyword clusters don't overlap | Checked |

### Track B — Infrastructure (dev) · Jul 11–17
| Step | Action | Exit |
|---|---|---|
| B1 | Extend `prerender-venues.mjs`: `buildBlogPages()` (title/meta/canonical/OG/Twitter/BlogPosting JSON-LD per post), `/blog` index page, URLs pushed into the sitemap array (it's a hand-maintained array — explicit step, nothing is "auto") | dist/ contains blog HTML with article text visible without JS |
| B2 | "From the blog" section on homepage + /packages so posts aren't orphans (links in the REAL homepage, not the slim-shell venue-page stub) | Links live both directions |
| B3 | LocalBusiness schema sitewide if absent (verify — venue pages already carry JSON-LD) | Rich Results Test passes |

### Track C — Search plumbing (Adhiraj) · Jul 11–14, parallel
- Verify picnicstories.com in GSC (domain property, DNS) if not already; submit sitemap.xml. Add Bing Webmaster Tools (5 min).
- PostHog: create an "organic → enquiry" insight — sessions with referrer google.* and no ad click IDs/UTMs → `intent_lead_captured` → DB `lead_status`. This is the SEO ROI view; GA4 is not needed.
- (Owed independently: verify Meta Pixel events in Events Manager — not an SEO gate.)

**Publish gate (Jul 20):** all 4 posts live at final slugs, schema valid, PageSpeed mobile ≥70 on one post URL, internal links live both directions.

### Phase 3 — Indexing & measurement (Adhiraj, weekly 15 min from Jul 21)
- Request indexing per URL via GSC URL Inspection.
- Weekly: GSC impressions/clicks/queries per URL + the PostHog organic insight.
- **Decision rules:**
  - Not indexed after 3 weeks / "Crawled – currently not indexed" → inspect rendered HTML in GSC; escalate to dev.
  - Indexed, 0 impressions after 8 weeks → retarget title/H1 to an even lower-competition variant.
  - Impressions but CTR <1% → rewrite meta description first, title second.

### Phase 4 — Authority & distribution (Adhiraj, from week 2)
- **Enrich the existing Gurugram GBP** per the playbook doc: service area, secondary categories, services list, real hours, 10+ photos, review-request flow. Post each blog as a GBP update. Highest-leverage local action available.
- Pitch listicle inclusions/backlinks: LBB Delhi, So Delhi, WhatsUpLife, Curly Tales, DforDelhi.
- Venue partners (Beige Cafe etc.) link back where they have web presence.
- Blog links into the WhatsApp reply flow ("just browsing" leads) + Instagram link-in-bio.
- Create Jaipur GBP when Jaipur season resumes (~Sept).

### Phase 5 — Expansion (2 posts/month Aug–Nov; Claude drafts, Adhiraj approves)
1. Bachelorette party ideas Delhi NCR (moved from initial set)
2. Family gathering / get-together ideas (NO birthday keywords — post 1 owns them)
3. Winter picnic spots Gurugram (publish by early Oct — seasonal)
4. Outdoor movie night ideas Delhi NCR (has a dedicated package)
5. Corporate team outing ideas Gurugram
6. Jaipur proposal/picnic posts (~Sept)

**Structural option to revisit after Sept data:** dedicated occasion landing pages (e.g. /birthday-picnic-gurugram as a conversion page: packages + gallery + FAQ) may outrank AND outconvert blog posts for commercial queries. Decide once GSC shows which queries actually pull impressions. Refresh the original 4 posts quarterly.

## Success metrics
| Checkpoint | Target |
|---|---|
| Jul 20 | 4 posts live, schema valid, in sitemap |
| ~Aug 10 | All 4 indexed |
| Sept 30 | ≥1,000 GSC impressions/mo, ≥20 clicks/mo combined |
| Oct–Dec | Organic-attributed enquiries visible in the PostHog insight |

## Risks (re-ranked)
1. **Low domain authority (now the top risk — rendering was never one).** New blog section on a small domain. Mitigation: mid/long-tail primaries, GBP posts, homepage internal links, partner backlinks.
2. **Content quality/thinness** — generic AI-flavored listicles won't rank or convert. Mitigation: first-party photos, real venue/logistics detail, Adhiraj's voice pass on post 1 before templating.
3. **Timeline slip on review** — Adhiraj's sign-off is the critical path (A1/A3). If voice approval slips past Jul 13, publish slips day-for-day.
4. **Measurement blind spots** — PostHog organic insight must exist before publish or early wins are invisible. Meta Pixel verification still owed separately.
5. **Pricing drift / Sienna placeholder** — enforced by compliance check A4.

## First actions (today, parallel)
- **Claude:** draft post 1 (birthday picnic Gurugram) for voice sign-off.
- **Dev:** add `buildBlogPages()` to `prerender-venues.mjs`.
- **Adhiraj:** confirm GSC domain-property status; approve/adjust the re-picked 4-post set (the swap of bachelorette/family-gathering for birthday/anniversary is a recommendation grounded in booking counts — override if there's a strategic reason).
