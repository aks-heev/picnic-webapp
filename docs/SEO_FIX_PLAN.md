# SEO Fix Plan — The Picnic Stories
_Generated 2026-06-23. Ordered by impact × effort._

---

## Status snapshot

| What | Status |
|---|---|
| Route-based `/venues/<slug>` pages | ✅ Live (12 pages) |
| Sitemap at `/sitemap.xml` | ✅ Live (15 URLs after next deploy) |
| `robots.txt` | ✅ Live |
| Title/meta/OG per venue page | ✅ Correct format |
| City landing pages (`/picnic-venues-jaipur` etc.) | ✅ Code done — deploy pending (`git push`) |
| Venue page loading overlay (FOUC fix) | ✅ Code done — deploy pending (`git push`) |
| Canonical URL consistency (www vs non-www) | ✅ Done (code) — set `SITE_URL` in Vercel env to activate |
| Google Search Console sitemap submission | ✅ Done — submitted `https://www.picnicstories.com/sitemap.xml` |
| Google Business Profile | ❌ Not created (user task) |
| Schema type (`Product` → `TouristAttraction`) | ✅ Done (was already correct in code) |
| `LocalBusiness` schema on home page | ✅ Done — dual-city @graph with www url + real hero image |
| JS bundle size | ⚠️ 525KB (too large — Month 2) |

---

## Remaining fixes

---

### Fix 1 — Canonical www mismatch (10 min)

**Problem:** `index.html` and prerender both output canonical `https://picnicstories.com/...` (no-www). But Vercel redirects all traffic to `https://www.picnicstories.com/...`. Google sees the canonical pointing to a different URL than the one it actually lands on — this splits link equity.

**Fix A — update `index.html` canonical:**
```html
<!-- line 18 — change from: -->
<link rel="canonical" href="https://picnicstories.com/">
<!-- to: -->
<link rel="canonical" href="https://www.picnicstories.com/">
```
Also update `og:url` on line 25 to match.

**Fix B — add `SITE_URL` env var in Vercel:**
Vercel Dashboard → picnic-webapp → Settings → Environment Variables → add:
```
SITE_URL = https://www.picnicstories.com
```
The prerender script will pick this up via `loadEnv` — all 14 prerendered page canonicals fix on next deploy.

**Then redeploy** (push any trivial commit, or trigger manually in Vercel).

---

### Fix 3 — Google Business Profile (30–45 min per city, your task)

**Why:** Local searches like "picnic venue Jaipur" or "outdoor dining near me" surface the Google Maps local pack ABOVE organic results. A verified GBP listing = instant local visibility that no amount of on-page SEO replicates.

**Listing 1 — Jaipur:**
- Go to [business.google.com](https://business.google.com) → Add business
- Name: `The Picnic Stories — Jaipur`
- Category: `Event Venue` (primary) + `Picnic Ground` (secondary)
- Address: your Jaipur operating address (or service-area business if no fixed address)
- Phone: +91 92669-64666
- Website: `https://www.picnicstories.com`
- Add 10+ photos of actual setups
- Description keywords: "luxury picnic venue", "outdoor dining Jaipur", "boho picnic experience"

**Listing 2 — Gurugram:**
- Same process, Name: `The Picnic Stories — Gurugram`, Phone: +91 97737-03982

After verification, ask existing customers to leave Google reviews — 10+ reviews at 4.5+ average puts you in the local pack.

---

### Fix 4 — Upgrade venue schema from `Product` to `TouristAttraction` (30 min)

**Why:** `Product` schema is for e-commerce items. Google treats picnic venues as local experiences. `TouristAttraction` schema triggers rich results in local search.

**File:** `scripts/prerender-venues.mjs` — replace the `venueJsonLd()` function:

```js
function venueJsonLd(v, url, image) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',               // was: Product
    name: `${v.name} — Picnic Venue in ${v.city}`,
    description: clamp(v.description || '', 300),
    image,
    url,
    touristType: 'Couple, Family, Corporate',
    isAccessibleForFree: false,
    address: {
      '@type': 'PostalAddress',
      addressLocality: v.area || v.city,
      addressRegion: v.city === 'Jaipur' ? 'Rajasthan' : 'Haryana',
      addressCountry: 'IN',
    },
    geo: undefined,                              // add lat/lng per venue if available
    provider: {
      '@type': 'Organization',
      name: 'The Picnic Stories',
      url: 'https://www.picnicstories.com',
    },
  }
  if (Number(v.base_price) > 0) {
    ld.offers = {
      '@type': 'Offer',
      price: String(Math.round(Number(v.base_price))),
      priceCurrency: 'INR',
      availability: 'https://schema.org/InStock',
      url,
    }
  }
  return JSON.stringify(ld, null, 2).replaceAll('<', '\\u003c')
}
```

---

### Fix 6 — Add `LocalBusiness` schema to home page (15 min)

**Why:** The home page has no structured data. Adding an `Organization` + `LocalBusiness` schema signals to Google what the business does and where.

**File:** `index.html` — add before `</head>`:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "The Picnic Stories",
  "url": "https://www.picnicstories.com",
  "logo": "https://www.picnicstories.com/logo3.png",
  "description": "Luxury boho-chic picnic experiences in Jaipur and Gurugram — curated decor, ambient lighting, and gourmet food.",
  "areaServed": ["Jaipur", "Gurugram"],
  "serviceType": "Picnic Experience",
  "telephone": ["+91-92669-64666", "+91-97737-03982"],
  "sameAs": [
    "https://www.instagram.com/thepicnicstories/"
  ]
}
</script>
```

---

### Fix 7 — Page speed / bundle size (Month 2)

**Problem:** `app.js` bundle is 525KB (gzipped: 152KB). Affects Core Web Vitals → affects ranking on mobile.

**Target:** < 250KB raw, < 80KB gzipped.

**Options:**
- Code-split admin vs storefront into separate entry points in `vite.config.mjs` — admin code (~30% of bundle) doesn't need to load on the public site
- Lazy-load the booking form and lightbox components
- Remove any unused PostHog / Razorpay SDK weight from the main bundle

---

## Completed fixes

### Fix 2 — Google Search Console sitemap submission ✅

Submitted `https://www.picnicstories.com/sitemap.xml` to Search Console. Note: the non-www URL (`picnicstories.com/sitemap.xml`) returns "Couldn't fetch" because GSC doesn't follow redirects — always use the www version. Check the Index Coverage report in 3–5 days to confirm crawl is progressing.

---

### Fix 5 — City landing pages ✅ (code done, deploy pending)

`/picnic-venues-jaipur` and `/picnic-venues-gurugram` implemented via `buildCityPages()` in `scripts/prerender-venues.mjs`. Pages are generated dynamically from live Supabase data at build time — not static files, not Vite rollup inputs. Each page has:
- City-specific `<title>`, `<meta name="description">`, canonical, OG tags
- `ItemList` + `LocalBusiness` JSON-LD
- Picnic venues vs overnight stays split into separate sections
- Venue cards linking to `/venues/<slug>`
- App.js prefetch so hydration is near-instant on click-through
- Loading overlay on venue detail pages (FOUC fix) — MutationObserver watches for `[class*="vd-"]` elements, fades out in 280ms

Commit to deploy: `git add scripts/prerender-venues.mjs docs/SEO_FIX_PLAN.md && git commit -m "feat: city landing pages (Jaipur/Gurugram) + venue page loading overlay" && git push`

**Note:** Test city pages only via `npm run build && npm run preview` — `npm run dev` 404s on them (SPA history fallback).

---

## Execution order

| # | Fix | Owner | Effort | Status |
|---|---|---|---|---|
| 1 | Canonical www fix (code + Vercel env var) | Dev/You | 10 min | ✅ Code done — set `SITE_URL` in Vercel |
| 2 | Submit sitemap to Google Search Console | You | 15 min | ✅ Done |
| 3 | Create Google Business Profile × 2 | You | 1 hr | ❌ To do |
| 4 | Schema type upgrade (`TouristAttraction`) | Dev | 30 min | ✅ Done |
| 5 | City landing pages (Jaipur + Gurugram) | Dev | 2 hr | ✅ Done (deploy pending) |
| 6 | LocalBusiness schema on home page | Dev | 15 min | ✅ Done |
| 7 | Bundle size / code splitting | Dev | 1–2 days | ⚠️ Month 2 |

**Expected timeline to first measurable impact:** 2–4 weeks after GSC submission + GBP verification. Local pack listings (Fix 3) can appear within days of verification.
