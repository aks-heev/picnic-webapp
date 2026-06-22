# Prerender Spec — `/venues/<slug>` static generation

Concrete spec for Phase 2 (prerender) plus the Phase 1 client contract it depends on.
Grounded in the real repo: Vite multi-page build, `@supabase/supabase-js` already a dependency,
client reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (`app.js:6-7`), venues carry
`images jsonb` (objects `{url, alt}`), body markup uses `#home-page.page.active` (`index.html:92`),
`#venue-detail-page` (`313`), `#venue-detail-content` (`314`).

**Mechanism:** after `vite build`, a Node script fetches active venues from Supabase and clones the
built `dist/index.html` into one static `dist/venues/<slug>.html` per venue, swapping the `<head>`
meta/OG/JSON-LD and injecting crawlable body content. Same `app.js` bundle loads and hydrates.

**Hard dependency:** ship Phase 1 (client path routing + slug column + anchor cards) in the **same
release**. A prerendered `/venues/<slug>.html` whose JS still only understands `?venue=ID` renders as
a static brochure — no calendar, no booking. The two phases are one deploy.

---

## 0. Prerequisite — `slug` column (Phase 1 DB)

```sql
alter table venues add column slug text;

update venues
set slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
where slug is null;

-- enforce uniqueness for active venues; inactive can stay null
create unique index venues_slug_key on venues (slug) where slug is not null;
```

Add `slug` to the admin venue form and to every `select` that feeds the storefront/venue cards.
**Slug is permanent** — do not regenerate on rename. On a deliberate rename, either keep the old
slug or add a redirect (Section 6).

---

## 1. `scripts/prerender-venues.mjs` (new file)

```js
// scripts/prerender-venues.mjs
// Runs AFTER `vite build`. Generates dist/venues/<slug>.html + sitemap.xml + robots.txt.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'

const SITE = (process.env.SITE_URL || 'https://picnicstories.com').replace(/\/$/, '')
const DIST = resolve(process.cwd(), 'dist')

// Reuse the same VITE_ vars Vercel/.env.local already provide to the client build.
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env }
const SUPABASE_URL = env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[prerender] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'); process.exit(1)
}

const HERO_FALLBACK =
  'https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/site-images/hero/main.jpg'

const esc = (s = '') => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

const slugify = (s = '') =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const clamp = (s = '', n = 155) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)).concat('…')
}

// Replace the single, Vite-untouched tag in <head>. Each pattern occurs exactly once.
function swapHead(html, replacements) {
  for (const [pattern, value] of replacements) html = html.replace(pattern, value)
  return html
}

function venueJsonLd(v, url, image) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: v.name,
    description: clamp(v.description || '', 300),
    image,
    url,
    brand: { '@type': 'Brand', name: 'The Picnic Stories' },
    areaServed: { '@type': 'City', name: v.city },
  }
  if (Number(v.base_price) > 0) {
    ld.offers = {
      '@type': 'Offer', price: String(Math.round(Number(v.base_price))),
      priceCurrency: 'INR', availability: 'https://schema.org/InStock', url,
    }
  }
  // Escape "<" so the JSON can never break out of the <script> element.
  return JSON.stringify(ld, null, 2).replaceAll('<', '\\u003c')
}

function buildPage(template, v) {
  const slug = v.slug || slugify(v.name)
  const url = `${SITE}/venues/${slug}`
  const img = v.images?.[0]?.url || HERO_FALLBACK
  const title = `${v.name} — Luxury Picnic in ${v.city} | The Picnic Stories`
  const desc = clamp(v.description) ||
    `Book ${v.name}, a curated luxury picnic experience in ${v.city} by The Picnic Stories.`
  const priceText = Number(v.base_price) > 0
    ? `From ₹${Math.round(Number(v.base_price)).toLocaleString('en-IN')}` : 'Get a quote'
  const capText = v.capacity_max
    ? `${v.capacity_min}–${v.capacity_max} guests` : `${v.capacity_min}+ guests`

  let html = swapHead(template, [
    [/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`],
    [/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(desc)}">`],
    [/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}">`],
    [/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`],
    [/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(desc)}">`],
    [/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${url}">`],
    [/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${esc(img)}">`],
    [/<meta property="og:image:alt"[^>]*>/, `<meta property="og:image:alt" content="${esc(v.name)}">`],
    [/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${esc(title)}">`],
    [/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${esc(desc)}">`],
    [/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${esc(img)}">`],
    [/<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      `<script type="application/ld+json">\n${venueJsonLd(v, url, img)}\n</script>`],
  ])

  // Body: make the venue page the active/visible one and inject crawlable content + internal links.
  const seo = `
      <nav class="prerender-crumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <span>${esc(v.city)}</span></nav>
      <h1>${esc(v.name)} — Luxury Picnic in ${esc(v.city)}</h1>
      <p>${esc(v.description || '')}</p>
      <p><strong>${esc(v.area ? `${v.area}, ${v.city}` : v.city)}</strong> · ${esc(capText)} · ${esc(priceText)}</p>
      <p><a href="/#venues">Browse all picnic venues in ${esc(v.city)} &rarr;</a></p>`

  html = html
    .replace('<div id="home-page" class="page active">', '<div id="home-page" class="page">')
    .replace('<div id="venue-detail-page" class="page">', '<div id="venue-detail-page" class="page active">')
    .replace('<div id="venue-detail-content">', `<div id="venue-detail-content">${seo}`)

  return { slug, url, html }
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  // Only public, browseable venues. `custom` has no detail page (goes straight to the form).
  const { data: venues, error } = await supabase
    .from('venues')
    .select('id,name,slug,type,city,area,description,capacity_min,capacity_max,base_price,images')
    .eq('is_active', true).neq('type', 'custom').order('sort_order', { ascending: true })
  if (error) { console.error('[prerender]', error.message); process.exit(1) }

  const template = readFileSync(resolve(DIST, 'index.html'), 'utf8')
  mkdirSync(resolve(DIST, 'venues'), { recursive: true })

  const urls = [`${SITE}/`]
  const seen = new Set()
  for (const v of venues) {
    const { slug, url, html } = buildPage(template, v)
    if (!slug) { console.warn(`[prerender] venue ${v.id} has no slug — skipped`); continue }
    if (seen.has(slug)) { console.warn(`[prerender] duplicate slug "${slug}" (venue ${v.id}) — skipped`); continue }
    seen.add(slug)
    writeFileSync(resolve(DIST, 'venues', `${slug}.html`), html)
    urls.push(url)
  }

  const lastmod = new Date().toISOString().slice(0, 10)
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`
  writeFileSync(resolve(DIST, 'sitemap.xml'), sitemap)
  writeFileSync(resolve(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${SITE}/sitemap.xml\n`)

  console.log(`[prerender] ${urls.length - 1} venue pages + sitemap (${urls.length} urls)`)
}
main()
```

**Why regex-on-head is safe here:** Vite passes `<title>`, `<meta>`, `<link rel=canonical>`, and the
`application/ld+json` block through untouched (it only rewrites module/asset references). Each tag
occurs once in the built file, so a single `.replace` per tag is deterministic. Asset URLs in the
built head are root-absolute (`/assets/…`), so cloning into `dist/venues/` keeps CSS/JS resolving.

---

## 2. `package.json` — chain the script into build

```diff
   "scripts": {
     "dev": "node ./node_modules/vite/bin/vite.js",
-    "build": "node ./node_modules/vite/bin/vite.js build",
+    "build": "node ./node_modules/vite/bin/vite.js build && node scripts/prerender-venues.mjs",
     "preview": "node ./node_modules/vite/bin/vite.js preview"
   }
```

Explicit `&&` chain rather than a `postbuild` hook — deploy-proof regardless of how Vercel invokes
the build. Vercel's default Build Command (`npm run build`) then runs both steps.

---

## 3. `vite.config.mjs` — no change required (and why)

Leave it as-is. Venue pages are **dynamic** (sourced from Supabase, change without code), so they
cannot be static `rollupOptions.input` entries the way `admin.html` / the legal pages are — there is
no source file per venue. They are generated *after* Vite runs, by the script in Section 1, writing
straight into `dist/`. Adding rollup inputs would be wrong here.

The existing `input` map (`main`, `admin`, `privacy`, `terms`, `cancellation`, `disclaimer`) stays.
The prerender only **adds** files under `dist/venues/` plus `sitemap.xml` / `robots.txt`; it never
touches Vite's outputs.

---

## 4. `vercel.json` (new file)

```json
{
  "cleanUrls": true,
  "trailingSlash": false
}
```

`cleanUrls` serves `dist/venues/castle-valley.html` at `/venues/castle-valley` (and 301s the
`.html` form to it). `trailingSlash:false` keeps one canonical shape. No rewrites needed: legacy
`?venue=ID`, `?menu=`, `?view=` are query strings on `/` (still served by `index.html`), and every
real venue path is a real file.

**Optional safety net** — if you want a brand-new venue to resolve for humans *before* the next
redeploy, add a catch-all that falls through to the SPA (static files still win over rewrites, so
known venue/admin/legal files are unaffected):

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [{ "source": "/venues/:slug", "destination": "/index.html" }]
}
```

Tradeoff: an unknown slug then returns `index.html` with HTTP 200 (soft 404) instead of a true 404.
Given venues change rarely and redeploys are automatic, I'd **omit** this and just redeploy when a
venue is added. Listed for completeness.

> If you already keep a `public/robots.txt`, the script overwrites `dist/robots.txt` — fold its
> rules into the script's output string instead of keeping both.

---

## 5. Client contract (Phase 1, must ship together) — `app.js`

The prerendered HTML only becomes a working page if the client understands the new path. Minimum
edits (line numbers approximate; locate by symbol):

1. **Load `slug`** in every storefront venue `select` (so cards and lookup have it).

2. **Venue cards → real anchors** (`renderVenueCard`, ~`app.js:505`). Change the wrapper from
   `<div class="venue-card" role="button" tabindex="0" data-venue-id="…">` to:
   ```html
   <a class="venue-card" href="/venues/${esc(venue.slug)}" data-venue-id="${venue.id}">
   ```
   Keep the existing click delegation but guard it so anchors still work for crawlers / new-tab /
   copy-link:
   ```js
   venuesGrid.addEventListener('click', (e) => {
     const card = e.target.closest('[data-venue-id]'); if (!card) return
     if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return // let browser handle
     e.preventDefault()
     showVenuePage(parseInt(card.dataset.venueId, 10))
   })
   ```

3. **`showVenuePage` pushState** (`app.js:595`): swap the URL to the path form.
   ```js
   if (pushState) history.pushState({ venueId }, document.title, `/venues/${venue.slug}`)
   ```

4. **Bootstrap reads the path** (`app.js:6480` block) instead of `?venue=`:
   ```js
   const m = window.location.pathname.match(/^\/venues\/([^/]+)\/?$/)
   if (m) {
     loadVenues().then(() => {
       const v = appState.venues.find(x => x.slug === decodeURIComponent(m[1]))
       if (v) showVenuePage(v.id, false); else showPage('home-page')
     })
   }
   // Legacy: ?venue=ID still arrives → resolve, then replace URL with the slug form
   else if (venueId) {
     loadVenues().then(() => {
       const v = appState.venues.find(x => x.id === parseInt(venueId, 10))
       if (v) { showVenuePage(v.id, false); history.replaceState({ venueId: v.id }, '', `/venues/${v.slug}`) }
     })
   }
   ```

5. **`popstate`** (`app.js:6431`): on back/forward, re-resolve from the path the same way (handle
   `/venues/<slug>` → find venue → `showVenuePage(id, false)`; otherwise show home).

6. **`navigateHome`** (`app.js:624`) already pushes `/` — fine.

Because bootstrap calls `showVenuePage`, which calls `renderVenueDetail`, the prerendered SEO block
in `#venue-detail-content` is overwritten with the live interactive view on hydrate. Crawlers/no-JS
visitors keep the static block; users get the app.

---

## 6. Environment & rollout

- **Vercel env vars:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` must be present at **build**
  time (they already are, for the client bundle — the script reuses them). Optionally set
  `SITE_URL`; it defaults to `https://picnicstories.com`.
- **Local test:** `npm run build && npm run preview`, then open `/venues/<slug>` and
  `view-source:` to confirm the venue `<title>`, `og:image`, and JSON-LD are in the **raw** HTML
  (not just after JS). Check `/sitemap.xml` and `/robots.txt`.
- **Validate:** Google Rich Results Test + Facebook Sharing Debugger on a couple of venue URLs
  (WhatsApp caches hard — Debugger forces a refresh). Submit `sitemap.xml` in Search Console.
- **Slug-rename hygiene:** if you rename a venue and choose a new slug, add a permanent redirect so
  old shared/indexed links don't 404:
  ```json
  { "redirects": [{ "source": "/venues/old-slug", "destination": "/venues/new-slug", "permanent": true }] }
  ```

## 7. Release checklist (one deploy)

1. `alter table venues add slug` + backfill + unique index (Section 0).
2. Add `slug` to admin form + storefront selects.
3. `scripts/prerender-venues.mjs` (Section 1).
4. `package.json` build chain (Section 2).
5. `vercel.json` (Section 4).
6. `app.js` client contract (Section 5).
7. `npm run build && npm run preview` → verify raw-HTML meta on 2–3 venues + sitemap.
8. Deploy → Search Console sitemap submit → Sharing Debugger refresh.
```
