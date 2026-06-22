# Route-Based Conversion — Plan & Analysis

**Goal:** Convert picnicstories.com from client-only `?venue=ID` routing to clean, server-visible
`/venues/<slug>` routes so that (a) ad/share clicks deep-link to the right venue with the right
preview image, and (b) each venue page can rank in Google.

**Stack (unchanged by this plan):** Vite vanilla-JS multi-page (`index.html` + `admin.html`),
Supabase (project `evmftrogyzoudiccqkya`, `venues` table), Vercel auto-deploy on push.

---

## 1. Current state — what exists and why it doesn't serve the goal

There *is* routing today. `showVenuePage()` (`app.js:578`) pushes `/?venue=15` via the History
API, sets `document.title`, and the back button works (`popstate`, `app.js:6431`). For humans
clicking around the site, it's fine. For SEO and deep links it's close to worthless:

| Problem | Detail | Consequence |
|---|---|---|
| Query-param numeric URL | `/?venue=15` — no slug, no keywords | Google sees the homepage with a param, not a distinct page |
| Identical HTML per venue | Server returns the same `index.html` shell for every `?venue=N` | Venue content only appears *after* JS runs |
| Meta never updates per venue | `showVenuePage` sets `document.title` only — not description or `og:image` | Every venue share shows the one static hero card (the WhatsApp-preview problem) |
| Social scrapers don't run JS | WhatsApp / Facebook / Instagram / Twitter scrapers never execute JS | Shared/ad links show the generic homepage card, not the venue |
| Venue cards are not links | `<div class="venue-card" role="button" data-venue-id>` (`app.js:505`) | **Googlebot cannot follow a JS click — venue pages are unreachable via internal links** |

**Headline:** the work is not to *add* routing. It's to (1) make the HTML for each venue URL
**server-visible** (correct title/description/OG/content present before any JS runs), and (2) make
venue pages **reachable** via real `<a>` links.

Note: no live Meta ad creatives currently point at `?venue=ID`, so the URL scheme can change freely.
Only obligation is a soft redirect for any `?venue=ID` links sitting in old WhatsApp threads.

---

## 2. Approach — and the two alternatives I'm rejecting

**Rejected — framework rewrite (Next.js / Astro).** Re-implementing 6,378 lines of working
Razorpay + booking RPC + admin + email-trigger logic to gain meta tags is enormous risk for tiny
marginal benefit. Out.

**Rejected — prettier client URLs only** (`/venues/<slug>` still rendered by JS). Feels like
progress, fixes nothing — scrapers still get an empty shell.

**Chosen — build-time prerender via Vite multi-page** (the same mechanism already used for
`admin.html`). A prebuild Node script pulls venues from Supabase and emits one static
`dist/venues/<slug>/index.html` per venue, each with:

- correct `<title>` + `<meta name="description">`
- `<link rel="canonical">` + `og:url` for that venue
- `og:image` / `twitter:image` = that venue's hero photo
- a JSON-LD structured-data block
- an inlined content block (name, location, price-from, description, amenities) so crawlers and the
  first paint have real text — the existing `app.js` then hydrates/enhances the interactive parts.

Each page loads the same `app.js` bundle, so the booking flow, calendar, Razorpay, etc. are
untouched. Crawlers and scrapers get real HTML; humans get the full app.

**The one real tradeoff:** venues live in Supabase, so **adding a venue requires a redeploy** to
generate its page. For ~12 rarely-changing venues on a stack that already auto-deploys on push,
this is a non-issue. If it ever becomes painful, the upgrade path is a Vercel serverless rewrite on
`/venues/:slug` that injects meta at request time — **not** in scope now.

---

## 3. URL scheme

- **Pattern:** `/venues/<slug>` (e.g. `/venues/castle-valley`, `/venues/terracottage-ochre`).
- **Slug is permanent and independent of `name`.** Venues get renamed (e.g. the Terracottage
  rename); the slug must not drift, or every rename silently breaks SEO and shared links. Decide the
  slug once; on a future rename, keep the slug or add an explicit redirect.
- **City for local SEO:** "romantic picnic in jaipur"–style queries are the target. Put the city in
  the page `<title>`, `<h1>`, and body content. Optionally encode it in the path
  (`/jaipur/<slug>`) for a stronger local signal — decide before backfilling slugs, since the path
  shape is hard to change later. Default recommendation: keep `/venues/<slug>` flat, carry city in
  title/H1/JSON-LD `address`.

---

## 4. Phased plan

### Phase 0 — Decisions (before any code)
- Confirm flat `/venues/<slug>` vs. city-scoped path.
- Confirm slug source (slugified current name) and the rename policy (keep slug vs. redirect).

### Phase 1 — Slugs + reachable links (the unlock)
1. **DB:** add `slug text` to `venues`, unique, not null; backfill from current names; add to the
   admin venue form (and guard uniqueness).
2. **Internal links:** change venue cards from `<div role="button" data-venue-id>` to
   `<a href="/venues/<slug>">` (`app.js` ~line 505). Keep the JS click handler for SPA-style
   in-app navigation, but `preventDefault` only on left-click without modifiers so the anchor still
   works for crawlers, new-tab, and right-click-copy-link.
3. **Client routing:** `showVenuePage` pushes `/venues/<slug>` (not `?venue=ID`); bootstrap
   (`app.js:6480`) reads the path instead of the query param; `popstate` updated.
4. **Redirect legacy links:** on load, if `?venue=ID` present, `history.replaceState` to the slug
   URL (covers old WhatsApp links; no ad dependency to worry about).

### Phase 2 — Prerendered HTML per venue (the SEO/deep-link win)
1. **Prebuild script** (Node, runs in `vite build`): fetch venues from Supabase → for each, clone
   the built `index.html` into `dist/venues/<slug>/index.html` and inject into `<head>`:
   per-venue `<title>`, description, canonical, `og:*` / `twitter:*` (image = venue hero), and a
   JSON-LD block. Inject a real content block into `<body>` for crawler-visible text.
2. **Vite config:** ensure the multi-page build emits these (mirror the `rollupOptions.input`
   pattern used for `admin.html`; the legal-pages 404 issue from earlier handoffs is the same trap —
   pages not in the build don't ship).
3. **Vercel:** `vercel.json` with `cleanUrls` so `/venues/<slug>` serves the file; verify no rewrite
   swallows the new paths.
4. **JSON-LD:** per venue — `Product`/`LocalBusiness`/`TouristAttraction` with `offers` (price),
   `address`, `geo`, `aggregateRating` if available.

### Phase 3 — Discoverability hygiene
1. **`sitemap.xml`** generated by the same prebuild script (homepage + every venue slug).
2. **`robots.txt`** pointing at the sitemap.
3. **Google Search Console:** verify the domain, submit the sitemap, monitor coverage.
4. **Canonical + unique meta** audit: every page has a unique title/description; no two venues share
   copy; `og:url` matches canonical.

### Phase 4 — Content depth (the ranking work)
Routes are necessary but **not sufficient** to rank. Each venue page needs unique, indexable text:
location/neighbourhood description, amenities, capacity, a short FAQ, and internal links between
related venues. Thin or duplicated pages won't rank no matter how clean the URL. This phase is
ongoing content work, not a one-off engineering task.

---

## 5. Risks & traps

- **Internal-link blindness (highest):** if venue cards stay JS-click divs, the whole SEO effort
  leaks — pages reachable only via sitemap, no link equity. Phase 1 step 2 is mandatory, not
  optional.
- **Slug drift on rename:** slugs tied to mutable names break links silently. Lock the policy in
  Phase 0.
- **Build doesn't emit the pages:** same class of bug as the earlier legal-pages 404 — anything not
  in `rollupOptions.input` / not generated by the prebuild script simply won't exist in `dist`.
- **WhatsApp OG caching:** WhatsApp caches previews aggressively (known issue). After deploy, force a
  refresh via the Facebook Sharing Debugger; expect a lag before correct cards appear.
- **Thin content:** prerendered pages with little text can be treated as low-value/duplicate. Phase 4
  is what makes Phase 1–3 pay off in organic search.
- **Stale pages until redeploy:** a new venue has no page until the next build. Acceptable given
  deploy cadence; document it so a new venue triggers a redeploy.

---

## 6. Effort & sequencing

- **Phase 1–2** deliver the deep-link + share-preview win (ads, WhatsApp, direct links) and get
  pages crawlable — roughly a few focused days.
- **Phase 3** is small and mostly config + GSC setup.
- **Phase 4** is the organic-ranking lever and runs continuously.

**Riskiest assumption to validate first:** that prerendered static HTML (vs. a serverless render)
is "fresh enough" given how often venues change. It almost certainly is — but confirm the venue-add
cadence before committing, because it's the one thing that would push you toward the more complex
serverless approach.
