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
      <p><a href="/#venues">Browse all picnic venues in ${esc(v.city)} &rarr;</a></p>`

  html = html
    .replace('<div id="home-page" class="page active">', '<div id="home-page" class="page">')
    .replace('<div id="venue-detail-page" class="page">', '<div id="venue-detail-page" class="page active">')
    .replace('<div id="venue-detail-content">', `<div id="venue-detail-content">${seo}`)

  return { slug, url, html }
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

  const lastmod = new Date().toISOString().slice(0, 10)
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`
  writeFileSync(resolve(DIST, 'sitemap.xml'), sitemap)
  writeFileSync(resolve(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${SITE}/sitemap.xml\n`)

  console.log(`[prerender] wrote ${urls.length - 1} venue pages + sitemap (${urls.length} urls)`)
}

main().catch((e) => { console.error('[prerender]', e); process.exit(1) })
