// scripts/prerender-venues.mjs
// Runs AFTER `vite build`. For each active, non-custom venue it clones the built
// dist/index.html into dist/venues/<slug>.html with per-venue <title>, meta,
// Open Graph / Twitter tags, JSON-LD, and a crawlable content block. Also writes
// sitemap.xml + robots.txt. The same app.js bundle hydrates the page on load.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'

const SITE = (process.env.SITE_URL || 'https://picnicstories.com').replace(/\/$/, '')
const DIST = resolve(process.cwd(), 'dist')

// Reuse the same VITE_ vars the client build already relies on (.env.local / Vercel env).
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env }
const SUPABASE_URL = env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[prerender] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const HERO_FALLBACK =
  'https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/site-images/hero/main.jpg'

/** Per-city config for landing pages. */
const CITY_CONFIG = {
  Jaipur: {
    slug: 'jaipur',
    state: 'Rajasthan',
    phone: '+91 92669-64666',
    wa: '919266964666',
    intro: 'Curated outdoor picnic experiences and boutique overnight stays set against Jaipur\'s heritage backdrops. Every detail — decor, lighting, food — handled for you.',
    picnicHeading: 'Outdoor Picnic Venues in Jaipur',
    picnicIntro: 'Each venue comes fully set up with boho-chic decor, ambient lighting, and a gourmet menu. You choose the setting; we take care of everything else.',
    stayHeading: 'Overnight Picnic Stays in Jaipur',
    stayIntro: 'Handpicked boutique properties where the picnic experience continues after sundown. Intimate, styled, and unlike any standard hotel stay.',
    keywords: 'picnic venue Jaipur, outdoor dining Jaipur, romantic picnic Jaipur, luxury picnic experience Jaipur',
  },
  Gurugram: {
    slug: 'gurugram',
    state: 'Haryana',
    phone: '+91 97737-03982',
    wa: '919773703982',
    intro: 'Escape the city at one of Gurugram\'s handpicked outdoor settings — boho-chic picnic cafes and terracotta-themed overnight retreats for couples and small groups.',
    picnicHeading: 'Outdoor Picnic Venues in Gurugram',
    picnicIntro: 'Thoughtfully designed picnic cafes with full decor setup, ambient lighting, and a curated menu — just bring your people.',
    stayHeading: 'Overnight Picnic Stays near Gurugram',
    stayIntro: 'The Terracottage collection and Countryside Offgrid — intimate stays designed for those who want the picnic experience to last the night.',
    keywords: 'picnic venue Gurugram, outdoor dining Gurugram, romantic picnic Delhi NCR, luxury picnic experience Gurugram',
  },
}

const esc = (s = '') => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

const slugify = (s = '') =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const clamp = (s = '', n = 155) => {
  const t = String(s).replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  const cut = t.slice(0, n)
  return cut.slice(0, cut.lastIndexOf(' ')).concat('…')
}

// Each targeted tag occurs exactly once in the Vite-built head (Vite leaves
// title/meta/canonical/ld+json untouched), so one replace per tag is safe.
function swapHead(html, replacements) {
  for (const [pattern, value] of replacements) html = html.replace(pattern, value)
  return html
}

function venueJsonLd(v, url, image) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: `${v.name} — Picnic Venue in ${v.city}`,
    description: clamp(v.description || '', 300),
    image,
    url,
    touristType: ['Couples', 'Families', 'Corporate'],
    isAccessibleForFree: false,
    address: {
      '@type': 'PostalAddress',
      addressLocality: v.area || v.city,
      addressRegion: v.city === 'Jaipur' ? 'Rajasthan' : 'Haryana',
      addressCountry: 'IN',
    },
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
  // Escape "<" so the JSON can never terminate the <script> element early.
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
    ? `From ₹${Math.round(Number(v.base_price)).toLocaleString('en-IN')}`
    : 'Get a quote'
  const capText = v.capacity_max
    ? `${v.capacity_min}–${v.capacity_max} guests`
    : `${v.capacity_min}+ guests`

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

  // Make the venue page the active/visible one for no-JS crawlers and first paint,
  // and inject real, crawlable content + internal links into #venue-detail-content.
  // app.js overwrites this with the live interactive view once it hydrates.
  const seo = `
      <nav class="prerender-crumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <span>${esc(v.city)}</span></nav>
      <h1>${esc(v.name)} — Luxury Picnic in ${esc(v.city)}</h1>
      <p>${esc(v.description || '')}</p>
      <p><strong>${esc(v.area ? `${v.area}, ${v.city}` : v.city)}</strong> · ${esc(capText)} · ${esc(priceText)}</p>
      <p><a href="/picnic-venues-${esc(slugify(v.city))}">Browse all picnic venues &amp; stays in ${esc(v.city)} &rarr;</a></p>`

  html = html
    .replace('<div id="home-page" class="page active">', '<div id="home-page" class="page">')
    .replace('<div id="venue-detail-page" class="page">', '<div id="venue-detail-page" class="page active">')
    .replace('<div id="venue-detail-content">', `<div id="venue-detail-content">${seo}`)

  return { slug, url, html }
}

/** Generate /picnic-venues-<city> landing pages, one per city in CITY_CONFIG. */
function buildCityPages(template, allVenues, urls) {
  // Extract the hashed CSS link Vite emitted so city pages share the same sheet.
  const cssTag = template.match(/<link rel="stylesheet"[^>]+>/)?.[0] || ''

  const PICNIC_TYPES = new Set(['cafe'])
  const STAY_TYPES   = new Set(['partner_bnb', 'combo', 'self_managed'])

  let count = 0

  for (const [city, cfg] of Object.entries(CITY_CONFIG)) {
    const cityVenues = allVenues.filter(v => v.city === city)
    if (!cityVenues.length) continue

    const picnics = cityVenues.filter(v => PICNIC_TYPES.has(v.type))
    const stays   = cityVenues.filter(v => STAY_TYPES.has(v.type))
    if (!picnics.length && !stays.length) continue

    const pageUrl = `${SITE}/picnic-venues-${cfg.slug}`
    const title   = `Picnic Venues &amp; Overnight Stays in ${city} | The Picnic Stories`
    const titlePlain = `Picnic Venues & Overnight Stays in ${city} | The Picnic Stories`
    const desc    = `Discover curated outdoor picnic venues and unique overnight stays in ${city} by The Picnic Stories — boho-chic decor, gourmet food, and unforgettable settings.`

    const cardHtml = (v) => {
      const img      = v.images?.[0]?.url || HERO_FALLBACK
      const capacity = v.capacity_max
        ? `${v.capacity_min}–${v.capacity_max} guests`
        : `${v.capacity_min}+ guests`
      const price    = Number(v.base_price) > 0
        ? `From ₹${Math.round(Number(v.base_price)).toLocaleString('en-IN')}`
        : 'On request'
      const area     = v.area ? `${v.area}, ${city}` : city
      const excerpt  = clamp(v.description || '', 110)
      return `
        <a href="/venues/${esc(v.slug)}" class="cpl-card">
          <div class="cpl-card-img" style="background-image:url('${esc(img)}')"></div>
          <div class="cpl-card-body">
            <h3 class="cpl-card-name">${esc(v.name)}</h3>
            <p class="cpl-card-meta">${esc(area)} &middot; ${esc(capacity)} &middot; ${esc(price)}</p>
            ${excerpt ? `<p class="cpl-card-desc">${esc(excerpt)}</p>` : ''}
            <span class="cpl-card-cta">View details &rarr;</span>
          </div>
        </a>`
    }

    const picnicSection = picnics.length ? `
      <section class="cpl-section" id="picnic-venues">
        <h2>${esc(cfg.picnicHeading)}</h2>
        <p class="cpl-section-intro">${esc(cfg.picnicIntro)}</p>
        <div class="cpl-grid">${picnics.map(cardHtml).join('')}</div>
      </section>` : ''

    const staySection = stays.length ? `
      <section class="cpl-section" id="overnight-stays">
        <h2>${esc(cfg.stayHeading)}</h2>
        <p class="cpl-section-intro">${esc(cfg.stayIntro)}</p>
        <div class="cpl-grid">${stays.map(cardHtml).join('')}</div>
      </section>` : ''

    // ItemList + LocalBusiness JSON-LD
    const allVenuesList = [...picnics, ...stays]
    const jsonLd = JSON.stringify([
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `Picnic Venues & Overnight Stays in ${city}`,
        description: desc,
        url: pageUrl,
        numberOfItems: allVenuesList.length,
        itemListElement: allVenuesList.map((v, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `${SITE}/venues/${v.slug}`,
          name: v.name,
        })),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: `The Picnic Stories — ${city}`,
        url: 'https://www.picnicstories.com',
        telephone: cfg.phone,
        address: {
          '@type': 'PostalAddress',
          addressLocality: city,
          addressRegion: cfg.state,
          addressCountry: 'IN',
        },
        areaServed: { '@type': 'City', name: city },
        serviceType: 'Picnic Experience & Overnight Stays',
      },
    ], null, 2).replaceAll('<', '\\u003c')

    const waMsg = encodeURIComponent(`Hi! I found you on the ${city} page and want to book a picnic.`)

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titlePlain}</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="keywords" content="${esc(cfg.keywords)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${pageUrl}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="The Picnic Stories">
  <meta property="og:title" content="${esc(titlePlain)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:locale" content="en_IN">
  <meta property="og:image" content="${HERO_FALLBACK}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(titlePlain)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${HERO_FALLBACK}">
  <link rel="icon" href="/favicon.ico" sizes="any">
  ${cssTag}
  <script type="application/ld+json">${jsonLd}</script>
  <style>
    /* City landing page — standalone layout using site CSS variables */
    *,*::before,*::after{box-sizing:border-box}
    body{margin:0;font-family:'Lato',system-ui,sans-serif;background:#fff;color:#2d2420}
    a{color:inherit}
    /* Nav */
    .cpl-nav{display:flex;align-items:center;padding:.9rem 1.5rem;border-bottom:1px solid #e8e0d8;max-width:1100px;margin:0 auto}
    .cpl-nav-inner{border-bottom:1px solid #e8e0d8}
    .cpl-nav-brand{display:flex;align-items:center;gap:.6rem;text-decoration:none;color:#2d2420;font-family:'EB Garamond',Georgia,serif;font-size:1.2rem}
    .cpl-nav-brand img{height:34px;width:auto}
    /* Layout */
    .cpl-wrap{max-width:1100px;margin:0 auto;padding:0 1.25rem}
    /* Hero */
    .cpl-hero{padding:2.5rem 0 1.5rem}
    .cpl-crumb{font-size:.8rem;color:#9a8b85;margin-bottom:.9rem}
    .cpl-crumb a{color:#9a8b85;text-decoration:none}
    .cpl-crumb a:hover{color:#a84d66}
    .cpl-hero h1{font-family:'EB Garamond',Georgia,serif;font-size:clamp(1.9rem,4vw,2.8rem);font-weight:400;line-height:1.2;margin:0 0 .75rem;color:#2d2420}
    .cpl-hero-intro{font-size:1.05rem;color:#6b5d57;max-width:600px;margin:0;line-height:1.65}
    .cpl-divider{border:none;border-top:1px solid #e8e0d8;margin:1.5rem 0 0}
    /* Sections */
    .cpl-section{padding:2.5rem 0 .5rem}
    .cpl-section h2{font-family:'EB Garamond',Georgia,serif;font-size:clamp(1.4rem,3vw,2rem);font-weight:400;color:#2d2420;margin:0 0 .5rem}
    .cpl-section-intro{color:#6b5d57;font-size:.95rem;max-width:580px;margin:0 0 1.5rem;line-height:1.6}
    /* Cards grid */
    .cpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:1.5rem;margin-bottom:.5rem}
    .cpl-card{display:block;text-decoration:none;color:inherit;border-radius:12px;overflow:hidden;border:1px solid #e8e0d8;background:#fff;transition:box-shadow .2s,transform .2s}
    .cpl-card:hover{box-shadow:0 6px 24px rgba(0,0,0,.1);transform:translateY(-2px)}
    .cpl-card-img{height:210px;background-size:cover;background-position:center;background-color:#f0ebe5}
    .cpl-card-body{padding:1rem 1.25rem 1.25rem}
    .cpl-card-name{font-family:'EB Garamond',Georgia,serif;font-size:1.15rem;font-weight:500;margin:0 0 .35rem;color:#2d2420}
    .cpl-card-meta{font-size:.78rem;color:#9a8b85;margin:0 0 .6rem;letter-spacing:.01em}
    .cpl-card-desc{font-size:.875rem;color:#6b5d57;margin:0 0 .9rem;line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .cpl-card-cta{font-size:.85rem;color:#a84d66;font-weight:500}
    /* CTA band */
    .cpl-cta-band{background:#f9f5f0;border-radius:12px;padding:2.25rem 2rem;margin:2.5rem 0 1rem;text-align:center}
    .cpl-cta-band h3{font-family:'EB Garamond',Georgia,serif;font-size:1.6rem;font-weight:400;margin:0 0 .5rem;color:#2d2420}
    .cpl-cta-band p{color:#6b5d57;margin:0 0 1.4rem;font-size:.97rem}
    .cpl-cta-btn{display:inline-block;background:#a84d66;color:#fff;text-decoration:none;padding:.75rem 2.25rem;border-radius:999px;font-size:.95rem;font-weight:500;transition:background .18s}
    .cpl-cta-btn:hover{background:#8f3e55}
    /* Footer */
    .cpl-footer{padding:2.5rem 1.25rem;text-align:center;color:#9a8b85;font-size:.85rem;border-top:1px solid #e8e0d8;margin-top:2rem}
    .cpl-footer a{color:#9a8b85;text-decoration:none}
    .cpl-footer a:hover{color:#a84d66}
  </style>
</head>
<body>
  <div class="cpl-nav-inner">
    <nav class="cpl-nav" aria-label="Site navigation">
      <a href="/" class="cpl-nav-brand">
        <img src="/logo3.png" alt="The Picnic Stories logo">
        The Picnic Stories
      </a>
    </nav>
  </div>

  <main>
    <div class="cpl-wrap">
      <div class="cpl-hero">
        <nav class="cpl-crumb" aria-label="Breadcrumb">
          <a href="/">Home</a> &rsaquo; <span>${esc(city)}</span>
        </nav>
        <h1>Picnic Venues &amp; Overnight Stays in ${esc(city)}</h1>
        <p class="cpl-hero-intro">${esc(cfg.intro)}</p>
      </div>

      <hr class="cpl-divider">

      ${picnicSection}
      ${stays.length && picnics.length ? '<hr class="cpl-divider">' : ''}
      ${staySection}

      <div class="cpl-cta-band">
        <h3>Something specific in mind?</h3>
        <p>Tell us your date, occasion, and guest count — we'll find the right spot for you.</p>
        <a href="https://wa.me/${cfg.wa}?text=${waMsg}" class="cpl-cta-btn" rel="noopener">Chat with us on WhatsApp</a>
      </div>
    </div>
  </main>

  <footer class="cpl-footer">
    <p>Serving <strong>${esc(city)}</strong> &mdash; <a href="tel:${cfg.phone.replace(/\s/g, '')}">${esc(cfg.phone)}</a></p>
    <p style="margin-top:.5rem">
      <a href="/">Home</a> &middot;
      <a href="/privacy.html">Privacy</a> &middot;
      <a href="/terms.html">Terms</a> &middot;
      <a href="/cancellation.html">Cancellation</a>
    </p>
    <p style="margin-top:.75rem">&copy; ${new Date().getFullYear()} The Picnic Stories. All rights reserved.</p>
  </footer>
</body>
</html>`

    writeFileSync(resolve(DIST, `picnic-venues-${cfg.slug}.html`), html)
    urls.push(pageUrl)
    count++
    console.log(`[prerender] city page: /picnic-venues-${cfg.slug} (${picnics.length} picnic, ${stays.length} stay)`)
  }
  return count
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  // Only public, browseable venues. `custom` (Your Own Space) has no detail page.
  const { data: venues, error } = await supabase
    .from('venues')
    .select('id,name,slug,type,city,area,description,capacity_min,capacity_max,base_price,images')
    .eq('is_active', true)
    .neq('type', 'custom')
    .order('sort_order', { ascending: true, nullsFirst: false })
  if (error) { console.error('[prerender]', error.message); process.exit(1) }

  let template
  try {
    template = readFileSync(resolve(DIST, 'index.html'), 'utf8')
  } catch {
    console.error('[prerender] dist/index.html not found — run vite build first'); process.exit(1)
  }
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

  const cityPageCount = buildCityPages(template, venues, urls)

  const lastmod = new Date().toISOString().slice(0, 10)
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`
  writeFileSync(resolve(DIST, 'sitemap.xml'), sitemap)
  writeFileSync(resolve(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${SITE}/sitemap.xml\n`)

  console.log(`[prerender] wrote ${seen.size} venue pages + ${cityPageCount} city pages + sitemap (${urls.length} urls)`)
}

main().catch((e) => { console.error('[prerender]', e); process.exit(1) })
