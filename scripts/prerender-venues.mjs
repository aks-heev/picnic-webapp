// scripts/prerender-venues.mjs
// Runs AFTER `vite build`. For each active, non-custom venue it clones the built
// dist/index.html into dist/venues/<slug>.html with per-venue <title>, meta,
// Open Graph / Twitter tags, JSON-LD, and a crawlable content block. Also writes
// sitemap.xml + robots.txt. The same app.js bundle hydrates the page on load.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'

const SITE = (process.env.SITE_URL || 'https://www.picnicstories.com').replace(/\/$/, '')
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
  // Prefer ending on a complete sentence if one falls late enough in the
  // budget (avoids "…" hanging off a half-finished clause) — otherwise fall
  // back to the last word boundary.
  const lastSentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (lastSentenceEnd > n * 0.4) return cut.slice(0, lastSentenceEnd + 1)
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

/** Duplicate-content fix (SEO_GROWTH_PLAN Phase 1): prerendered non-home pages
 * used to ship the FULL homepage markup (~90% shared text across all 13+ pages,
 * hidden via .page CSS but fully indexable). Replace #home-page with an empty
 * stub so each page's crawlable text is its own content. Safe for hydration:
 * every app.js renderer that targets homepage elements is null-guarded
 * (admin.html shares the same bundle and has none of them). SPA navigation
 * back to home becomes a real page load via the window.__PR_SLIM__ guard in
 * app.js showPage(). Fails safe: if the structural markers aren't found
 * (index.html reorganised), the page keeps the old full-markup behaviour. */
function slimHomeShell(html) {
  const open = html.indexOf('<div id="home-page"')
  const endMarker = '<!-- Menu Preview Page -->'
  const end = html.indexOf(endMarker)
  if (open === -1 || end === -1 || end <= open) {
    console.warn('[prerender] slim-shell markers not found — leaving homepage markup in place')
    return html
  }
  const stub = '<div id="home-page" class="page"></div>\n'
    + '    <script>window.__PR_SLIM__=true</script>\n\n    '
  return html.slice(0, open) + stub + html.slice(end)
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

  // Branded loading overlay — covers the raw SEO text until app.js has fully
  // rendered the interactive venue detail. Detected via MutationObserver watching
  // for the first element with a 'vd-' class that app.js injects.
  const loader = `
<div id="pr-loader" aria-hidden="true" style="position:fixed;inset:0;z-index:99999;background:#fdfaf7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.25rem">
  <img src="/logo3.png" alt="" style="height:56px;width:auto" id="pr-logo">
  <div style="width:40px;height:3px;border-radius:2px;background:#e8e0d8;overflow:hidden">
    <div id="pr-bar" style="height:100%;width:0%;background:#a84d66;border-radius:2px;transition:width .1s linear"></div>
  </div>
</div>
<style>
  @keyframes pr-logo-pulse{0%,100%{opacity:.5}50%{opacity:1}}
  #pr-logo{animation:pr-logo-pulse 1.4s ease-in-out infinite}
</style>
<script>
(function(){
  var lo=document.getElementById('pr-loader');
  var bar=document.getElementById('pr-bar');
  if(!lo)return;
  var prog=0;
  var fill=setInterval(function(){prog=Math.min(prog+2,88);if(bar)bar.style.width=prog+'%';},50);
  var gone=false;
  function rm(){
    if(gone)return;gone=true;
    clearInterval(fill);
    if(bar)bar.style.width='100%';
    setTimeout(function(){
      lo.style.transition='opacity .28s';
      lo.style.opacity='0';
      setTimeout(function(){lo.parentNode&&lo.parentNode.removeChild(lo);},300);
    },120);
  }
  // Primary: detect when app.js inserts a vd- element (interactive venue detail ready)
  if(window.MutationObserver){
    var obs=new MutationObserver(function(){
      if(document.querySelector('[class*="vd-"]')){obs.disconnect();rm();}
    });
    obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  }
  // Fallback A: hide 300ms after all resources (including app.js) have loaded
  window.addEventListener('load',function(){setTimeout(rm,300);});
  // Fallback B: hard cap at 6s — never block the user forever
  setTimeout(rm,6000);
})();
</script>`

  html = slimHomeShell(html)
    .replace('<div id="venue-detail-page" class="page">', '<div id="venue-detail-page" class="page active">')
    .replace('<div id="venue-detail-content">', `<div id="venue-detail-content">${seo}`)
    .replace('</head>', `  <link rel="preload" as="image" href="${esc(img)}" fetchpriority="high">\n</head>`)
    .replace('</body>', `${loader}\n</body>`)

  return { slug, url, html }
}

/** Generate /picnic-venues-<city> landing pages, one per city in CITY_CONFIG. */
function buildCityPages(template, allVenues, urls) {
  // Extract Vite-emitted CSS link and app.js URL from the compiled index.html.
  // We prefetch app.js so it's cached before the user clicks through to a venue page,
  // making the hydration overlay nearly invisible.
  const cssTag   = template.match(/<link rel="stylesheet"[^>]+>/)?.[0] || ''
  const appJsSrc = template.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1] || ''
  const prefetch = appJsSrc ? `<link rel="prefetch" href="${appJsSrc}" as="script">` : ''

  const PICNIC_TYPES = new Set(['cafe'])
  const STAY_TYPES   = new Set(['partner_bnb', 'combo', 'self_managed'])

  // Arrow SVG for card CTAs
  const ARROW_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`
  // Chevron SVG for breadcrumb
  const CHEV_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`

  let count = 0

  for (const [city, cfg] of Object.entries(CITY_CONFIG)) {
    const cityVenues = allVenues.filter(v => v.city === city)
    if (!cityVenues.length) continue

    const picnics = cityVenues.filter(v => PICNIC_TYPES.has(v.type))
    const stays   = cityVenues.filter(v => STAY_TYPES.has(v.type))
    if (!picnics.length && !stays.length) continue

    const pageUrl    = `${SITE}/picnic-venues-${cfg.slug}`
    const titlePlain = `Picnic Venues & Overnight Stays in ${city} | The Picnic Stories`
    const desc       = `Discover curated outdoor picnic venues and unique overnight stays in ${city} by The Picnic Stories — boho-chic decor, gourmet food, and unforgettable settings.`

    // --- Venue card ---
    const cardHtml = (v) => {
      const img      = v.images?.[0]?.url || HERO_FALLBACK
      const capacity = v.capacity_max
        ? `${v.capacity_min}–${v.capacity_max} guests`
        : `${v.capacity_min}+ guests`
      const price    = Number(v.base_price) > 0
        ? `From ₹${Math.round(Number(v.base_price)).toLocaleString('en-IN')}`
        : null
      const area    = v.area ? `${v.area}, ${city}` : city
      const excerpt = clamp(v.description || '', 115)
      const isPicnic = PICNIC_TYPES.has(v.type)
      const badgeLabel = isPicnic ? '🌿&nbsp;Picnic Experience' : '🌙&nbsp;Overnight Stay'
      const badgeMod   = isPicnic ? 'card-badge--picnic' : 'card-badge--stay'
      return `
        <a href="/venues/${esc(v.slug)}" class="city-card">
          <figure class="card-media">
            <img src="${esc(img)}" alt="${esc(v.name)}" loading="lazy" width="600" height="375">
            <span class="card-badge ${badgeMod}">${badgeLabel}</span>
            ${price ? `<span class="card-price">${esc(price)}</span>` : ''}
          </figure>
          <div class="card-info">
            <h3 class="card-title">${esc(v.name)}</h3>
            <p class="card-sub">${esc(area)}&ensp;&middot;&ensp;${esc(capacity)}</p>
            ${excerpt ? `<p class="card-desc">${esc(excerpt)}</p>` : ''}
            <span class="card-link">View details ${ARROW_SVG}</span>
          </div>
        </a>`
    }

    // --- Section blocks ---
    const picnicSection = picnics.length ? `
    <section class="city-section" id="picnic-venues">
      <div class="section-inner">
        <div class="section-hd">
          <p class="section-eyebrow"><span class="eyebrow-line"></span>Picnic Experiences&ensp;&middot;&ensp;${picnics.length} venue${picnics.length > 1 ? 's' : ''}</p>
          <h2>${esc(cfg.picnicHeading)}</h2>
          <p class="section-lead">${esc(cfg.picnicIntro)}</p>
        </div>
        <div class="cards-grid">${picnics.map(cardHtml).join('')}</div>
      </div>
    </section>` : ''

    const staySection = stays.length ? `
    <section class="city-section city-section--alt" id="overnight-stays">
      <div class="section-inner">
        <div class="section-hd">
          <p class="section-eyebrow"><span class="eyebrow-line"></span>Overnight Stays&ensp;&middot;&ensp;${stays.length} propert${stays.length > 1 ? 'ies' : 'y'}</p>
          <h2>${esc(cfg.stayHeading)}</h2>
          <p class="section-lead">${esc(cfg.stayIntro)}</p>
        </div>
        <div class="cards-grid">${stays.map(cardHtml).join('')}</div>
      </div>
    </section>` : ''

    // --- JSON-LD ---
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

    // --- Full HTML ---
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
  ${prefetch}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Lato:wght@400;700&display=swap" rel="stylesheet">
  ${cssTag}
  <script type="application/ld+json">${jsonLd}</script>
  <style>
    /* ── Reset ── */
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
    body{font-family:'Lato',system-ui,sans-serif;background:#fdfaf7;color:#2d2420;-webkit-font-smoothing:antialiased;line-height:1.6}
    a{color:inherit;text-decoration:none}
    img{display:block;max-width:100%}

    /* ── Sticky header ── */
    .site-header{position:sticky;top:0;z-index:50;background:rgba(253,250,247,.93);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid rgba(232,224,216,.8)}
    .header-inner{max-width:1140px;margin:0 auto;padding:.85rem 1.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}
    .header-brand{display:flex;align-items:center;gap:.55rem;font-family:'EB Garamond',Georgia,serif;font-size:1.15rem;color:#2d2420;letter-spacing:.01em;flex-shrink:0}
    .header-brand img{height:32px;width:auto}
    .header-sections{display:flex;gap:.45rem;flex-wrap:wrap}
    .sec-pill{padding:.38rem 1rem;border-radius:999px;font-size:.78rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6b5d57;border:1.5px solid #ddd5cb;transition:background .18s,color .18s,border-color .18s;white-space:nowrap}
    .sec-pill:hover,.sec-pill.is-active{background:#a84d66;color:#fff;border-color:#a84d66}

    /* ── Hero ── */
    .city-hero{position:relative;overflow:hidden;padding:5rem 1.5rem 4rem;text-align:center;background:linear-gradient(155deg,#fdf6ef 0%,#f8ede4 45%,#f3e4db 100%);min-height:0;height:auto;display:block}
    .city-hero::before{content:'';position:absolute;inset:0;background:var(--hero-url) center/cover no-repeat;opacity:.08;z-index:0}
    .city-hero-inner{position:relative;z-index:1;max-width:680px;margin:0 auto}
    .city-breadcrumb{display:flex;align-items:center;justify-content:center;gap:.35rem;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:#b09890;margin-bottom:1.5rem}
    .city-breadcrumb a{color:#b09890;transition:color .15s}
    .city-breadcrumb a:hover{color:#a84d66}
    .city-hero h1{font-family:'EB Garamond',Georgia,serif;font-size:clamp(2.4rem,5.5vw,3.8rem);font-weight:400;line-height:1.12;color:#2d2420;margin-bottom:1.1rem}
    .city-hero h1 em{font-style:italic;color:#a84d66;font-weight:400}
    .city-hero-lead{font-size:1.06rem;color:#6b5d57;line-height:1.72;max-width:520px;margin:0 auto 2.25rem}
    .city-hero-jumps{display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap}
    .city-jump-btn{display:inline-flex;align-items:center;gap:.4rem;padding:.65rem 1.5rem;border-radius:999px;font-size:.88rem;font-weight:700;letter-spacing:.03em;transition:all .2s}
    .city-jump-btn--outline{color:#a84d66;border:2px solid #a84d66;background:transparent}
    .city-jump-btn--outline:hover{background:#a84d66;color:#fff}
    .city-jump-btn--solid{background:#2d2420;color:#f5ede8;border:2px solid #2d2420}
    .city-jump-btn--solid:hover{background:#a84d66;border-color:#a84d66}

    /* ── Sections ── */
    .city-section{padding:4.5rem 1.5rem}
    .city-section--alt{background:#faf5f0}
    .section-inner{max-width:1140px;margin:0 auto}
    .section-hd{margin-bottom:2.75rem}
    .section-eyebrow{display:flex;align-items:center;gap:.6rem;font-size:.72rem;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#a84d66;margin-bottom:.8rem}
    .eyebrow-line{display:inline-block;width:28px;height:1.5px;background:#a84d66;flex-shrink:0}
    .section-hd h2{font-family:'EB Garamond',Georgia,serif;font-size:clamp(1.8rem,3.8vw,2.6rem);font-weight:400;color:#2d2420;line-height:1.18;margin-bottom:.65rem}
    .section-lead{font-size:1rem;color:#6b5d57;max-width:540px;line-height:1.7}

    /* ── Cards ── */
    .cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.75rem}
    .city-card{display:flex;flex-direction:column;border-radius:16px;overflow:hidden;border:1px solid #ede6de;background:#fff;transition:transform .26s cubic-bezier(.4,0,.2,1),box-shadow .26s}
    .city-card:hover{transform:translateY(-5px);box-shadow:0 16px 48px rgba(168,77,102,.14)}
    .card-media{position:relative;aspect-ratio:16/10;overflow:hidden;background:#f0ebe5;margin:0}
    .card-media img{width:100%;height:100%;object-fit:cover;transition:transform .45s cubic-bezier(.4,0,.2,1)}
    .city-card:hover .card-media img{transform:scale(1.05)}
    .card-badge{position:absolute;top:.8rem;left:.8rem;padding:.28rem .75rem;border-radius:999px;font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
    .card-badge--picnic{background:rgba(168,77,102,.88);color:#fff}
    .card-badge--stay{background:rgba(45,36,32,.82);color:#f5ede8}
    .card-price{position:absolute;bottom:.8rem;right:.8rem;background:rgba(253,250,247,.93);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-radius:8px;padding:.28rem .65rem;font-size:.76rem;font-weight:700;color:#2d2420;letter-spacing:.01em}
    .card-info{padding:1.25rem 1.4rem 1.5rem;display:flex;flex-direction:column;flex:1}
    .card-title{font-family:'EB Garamond',Georgia,serif;font-size:1.22rem;font-weight:500;color:#2d2420;margin-bottom:.35rem;line-height:1.3}
    .card-sub{font-size:.76rem;color:#9a8b85;margin-bottom:.7rem;letter-spacing:.015em}
    .card-desc{font-size:.875rem;color:#6b5d57;line-height:1.6;flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:1.1rem}
    .card-link{display:inline-flex;align-items:center;gap:.35rem;font-size:.82rem;font-weight:700;color:#a84d66;letter-spacing:.03em;margin-top:auto;transition:gap .2s}
    .city-card:hover .card-link{gap:.55rem}

    /* ── CTA band ── */
    .cta-band{background:linear-gradient(140deg,#1e1410 0%,#2d2420 60%,#352820 100%);color:#f5ede8;padding:5rem 1.5rem;text-align:center}
    .cta-band-inner{max-width:520px;margin:0 auto}
    .cta-band h3{font-family:'EB Garamond',Georgia,serif;font-size:clamp(1.9rem,4vw,2.7rem);font-weight:400;line-height:1.18;margin-bottom:.75rem}
    .cta-band p{font-size:1.02rem;color:rgba(245,237,232,.68);margin-bottom:2.1rem;line-height:1.7}
    .cta-wa{display:inline-flex;align-items:center;gap:.65rem;background:#25D366;color:#fff;padding:.9rem 2.1rem;border-radius:999px;font-size:.97rem;font-weight:700;letter-spacing:.025em;transition:filter .2s,transform .18s}
    .cta-wa:hover{filter:brightness(1.08);transform:translateY(-2px)}
    .cta-wa svg{flex-shrink:0}

    /* ── Footer ── */
    .page-footer{padding:2.75rem 1.5rem;text-align:center;font-size:.82rem;color:#9a8b85;border-top:1px solid #e8e0d8;background:#fdfaf7}
    .page-footer a{color:#9a8b85;transition:color .15s}
    .page-footer a:hover{color:#a84d66}
    .footer-links{display:flex;justify-content:center;gap:1.75rem;flex-wrap:wrap;margin:.6rem 0 1rem}

    /* ── Responsive ── */
    @media(max-width:640px){
      .city-hero{padding:3rem 1.25rem 2.5rem}
      .city-section{padding:3rem 1.25rem}
      .cards-grid{grid-template-columns:1fr}
      .header-sections{display:none}
      .city-hero h1{font-size:2.1rem}
    }
    @media(max-width:480px){
      .city-hero-jumps{flex-direction:column;align-items:center}
      .city-jump-btn{width:100%;max-width:240px;justify-content:center}
    }
  </style>
</head>
<body>

  <!-- Sticky header with section nav -->
  <header class="site-header">
    <div class="header-inner">
      <a href="/" class="header-brand">
        <img src="/logo3.png" alt="The Picnic Stories logo">
        The Picnic Stories
      </a>
      <nav class="header-sections" aria-label="Jump to section">
        ${picnics.length ? `<a href="#picnic-venues" class="sec-pill" id="pill-picnic">🌿 Picnic Venues</a>` : ''}
        ${stays.length ? `<a href="#overnight-stays" class="sec-pill" id="pill-stay">🌙 Overnight Stays</a>` : ''}
      </nav>
    </div>
  </header>

  <!-- Hero -->
  <div class="city-hero" style="--hero-url:url('${HERO_FALLBACK}')">
    <div class="city-hero-inner">
      <nav class="city-breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>${CHEV_SVG}<span>${esc(city)}</span>
      </nav>
      <h1>Picnic Venues &amp; Stays<br>in <em>${esc(city)}</em></h1>
      <p class="city-hero-lead">${esc(cfg.intro)}</p>
      <div class="city-hero-jumps">
        ${picnics.length ? `<a href="#picnic-venues" class="city-jump-btn city-jump-btn--outline">🌿 Picnic Venues</a>` : ''}
        ${stays.length ? `<a href="#overnight-stays" class="city-jump-btn city-jump-btn--solid">🌙 Overnight Stays</a>` : ''}
      </div>
    </div>
  </div>

  <main>
    ${picnicSection}
    ${staySection}

    <!-- WhatsApp CTA -->
    <div class="cta-band">
      <div class="cta-band-inner">
        <h3>Something specific in mind?</h3>
        <p>Tell us your date, occasion, and guest count — we'll find the perfect setting for you.</p>
        <a href="https://wa.me/${cfg.wa}?text=${waMsg}" class="cta-wa" rel="noopener">
          <svg width="22" height="22" viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16 2C8.28 2 2 8.28 2 16c0 2.46.65 4.77 1.78 6.78L2 30l7.42-1.74A13.93 13.93 0 0 0 16 30c7.72 0 14-6.28 14-14S23.72 2 16 2Zm7.78 19.44c-.32.9-1.88 1.72-2.6 1.82-.68.1-1.54.14-2.48-.16-.57-.18-1.3-.42-2.22-.82-3.9-1.68-6.44-5.62-6.64-5.88-.18-.26-1.52-2.02-1.52-3.86 0-1.84.96-2.74 1.3-3.12.34-.38.74-.48 1-.48.24 0 .48 0 .7.02.22 0 .52-.08.82.62.32.72 1.08 2.62 1.18 2.82.1.18.16.4.04.64-.12.24-.18.38-.34.58-.18.2-.38.44-.54.6-.18.16-.36.34-.16.66.22.32 1 1.56 2.14 2.52 1.48 1.28 2.72 1.68 3.1 1.86.38.18.6.16.82-.1.22-.24.94-1.1 1.18-1.48.26-.38.5-.32.84-.18.34.14 2.14 1.02 2.52 1.2.38.18.62.28.72.44.1.14.1.82-.22 1.72Z"/></svg>
          Chat with us on WhatsApp
        </a>
      </div>
    </div>
  </main>

  <footer class="page-footer">
    <p>${esc(city)} &mdash; <a href="tel:${cfg.phone.replace(/\s/g, '')}">${esc(cfg.phone)}</a></p>
    <nav class="footer-links" aria-label="Footer links">
      <a href="/">Home</a>
      <a href="/blog">Blog</a>
      <a href="/privacy.html">Privacy</a>
      <a href="/terms.html">Terms</a>
      <a href="/cancellation.html">Cancellation</a>
    </nav>
    <p>&copy; ${new Date().getFullYear()} The Picnic Stories. All rights reserved.</p>
  </footer>

  <script>
    // Highlight the active section pill in the sticky nav as user scrolls
    (function () {
      var ids = ['picnic-venues', 'overnight-stays'];
      var pillIds = ['pill-picnic', 'pill-stay'];
      var sections = ids.map(function(id){ return document.getElementById(id); });
      var pills    = pillIds.map(function(id){ return document.getElementById(id); });
      if (!('IntersectionObserver' in window)) return;
      var obs = new IntersectionObserver(function(entries) {
        entries.forEach(function(e) {
          var i = sections.indexOf(e.target);
          if (i >= 0 && pills[i]) pills[i].classList.toggle('is-active', e.isIntersecting);
        });
      }, { threshold: 0.25 });
      sections.filter(Boolean).forEach(function(s){ obs.observe(s); });
    })();
  </script>

</body>
</html>`

    writeFileSync(resolve(DIST, `picnic-venues-${cfg.slug}.html`), html)
    urls.push(pageUrl)
    count++
    console.log(`[prerender] city page: /picnic-venues-${cfg.slug} (${picnics.length} picnic, ${stays.length} stay)`)
  }
  return count
}

// Stored per-venue package pricing (SPEC_stored_package_pricing_2026-07-10.md):
// prices come straight from the venue_packages table — the derived math this
// script used to hand-duplicate from app.js is GONE, along with the
// keep-in-sync-by-hand burden. "From ₹X" at the page's baseline guest count
// is simply the row's flat price (included_guests is always ≥ the baseline).
// A package with no active row at a venue is not offered there.
function tierPriceAtVenue(venue, tier, vpByKey) {
  const row = vpByKey.get(`${venue.id}:${tier.key}`)
  return row ? Number(row.price) : null
}

function packagesJsonLd(pageUrl, tiers, fromPriceByTier) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'OfferCatalog',
    name: 'Picnic Packages — The Picnic Stories',
    url: pageUrl,
    itemListElement: tiers.map((t, i) => ({
      '@type': 'Offer',
      position: i + 1,
      itemOffered: { '@type': 'Service', name: t.name, description: clamp(t.tagline, 200) },
      priceCurrency: 'INR',
      price: String(Math.round(fromPriceByTier.get(t.key) ?? 0)),
      availability: 'https://schema.org/InStock',
      url: `${pageUrl}?tier=${encodeURIComponent(t.key)}`,
    })),
  }
  return JSON.stringify(ld, null, 2).replaceAll('<', '\\u003c')
}

/** Generate the /packages landing page: SPA shell (like buildPage) with
 * per-tier crawlable content, OfferCatalog JSON-LD, and the same #pr-loader
 * hydration overlay. Build-time "From ₹X" prices are placeholders — the
 * client's showPackagesPage() overwrites #packages-content with live prices
 * the moment app.js hydrates (same mechanism as the venue pages). */
async function buildPackagesPage(supabase, template, blogPosts = []) {
  const [pkgRes, venueRes, addonRes, vpRes] = await Promise.all([
    supabase.from('packages').select('*, package_add_ons(addon_id, sort_order)')
      .eq('is_active', true).order('sort_order', { ascending: true }),
    supabase.from('venues').select('id, name, slug, base_price, free_guests_upto, overage_per_person, metadata, packages_enabled')
      .eq('type', 'cafe').eq('is_active', true).eq('packages_enabled', true),
    supabase.from('add_ons').select('*, venue_add_ons!inner(venue_id)').eq('is_active', true),
    supabase.from('venue_packages').select('venue_id, package_id, price, included_guests').eq('is_active', true),
  ])
  if (pkgRes.error) { console.warn('[prerender] packages fetch failed, skipping /packages page:', pkgRes.error.message); return null }
  if (venueRes.error) { console.warn('[prerender] venues fetch failed, skipping /packages page:', venueRes.error.message); return null }
  if (addonRes.error) { console.warn('[prerender] add_ons fetch failed, skipping /packages page:', addonRes.error.message); return null }
  if (vpRes.error) { console.warn('[prerender] venue_packages fetch failed, skipping /packages page:', vpRes.error.message); return null }

  const tiers = (pkgRes.data || []).map(pkg => ({
    id: pkg.id,
    key: pkg.key,
    name: pkg.name,
    tagline: pkg.tagline || '',
    featured: !!pkg.is_featured,
    addons: (pkg.package_add_ons || []).slice().sort((a, b) => a.sort_order - b.sort_order).map(pa => pa.addon_id),
    inclusions: pkg.inclusions || [],
  }))
  if (!tiers.length) { console.warn('[prerender] no active packages — skipping /packages page'); return null }

  const venues = venueRes.data || []
  const addonNameById = new Map()
  ;(addonRes.data || []).forEach(row => { addonNameById.set(row.id, row.name) })

  // Stored prices keyed "<venueId>:<packageKey>" (same shape as the client's
  // VENUE_PACKAGES map). Rows for inactive packages resolve to no tier and drop.
  const keyById = new Map(tiers.map(t => [t.id, t.key]))
  const vpByKey = new Map()
  ;(vpRes.data || []).forEach(r => {
    const key = keyById.get(r.package_id)
    if (key) vpByKey.set(`${r.venue_id}:${key}`, r)
  })

  const fromPriceByTier = new Map()
  tiers.forEach(t => {
    const prices = venues.map(v => tierPriceAtVenue(v, t, vpByKey)).filter(p => p != null)
    if (prices.length) fromPriceByTier.set(t.key, Math.min(...prices))
  })
  // Packages priced nowhere (e.g. Prelude pre-enable) are left out of the
  // static seed + JSON-LD entirely — a ₹0 offer is worse than no offer.
  const pricedTiers = tiers.filter(t => fromPriceByTier.has(t.key))
  if (!pricedTiers.length) { console.warn('[prerender] no priced packages — skipping /packages page'); return null }

  const url = `${SITE}/packages`
  const title = 'Picnic Packages — Date Night, Movie Night & More | The Picnic Stories'
  // Hand-written and kept under ~155 chars deliberately — the old version
  // concatenated every tier name into the description, which overflowed the
  // budget and got cut off mid-sentence as tiers were added.
  const desc = 'Curated picnic packages for every occasion — pick The Setting, Date Night, Movie Night and more, then choose your venue. Flat pricing, confirmed upfront.'
  const img = HERO_FALLBACK

  let html = swapHead(template, [
    [/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`],
    [/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(desc)}">`],
    [/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}">`],
    [/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`],
    [/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(desc)}">`],
    [/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${url}">`],
    [/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${esc(img)}">`],
    [/<meta property="og:image:alt"[^>]*>/, `<meta property="og:image:alt" content="Picnic Packages">`],
    [/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${esc(title)}">`],
    [/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${esc(desc)}">`],
    [/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${esc(img)}">`],
    [/<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      `<script type="application/ld+json">\n${packagesJsonLd(url, pricedTiers, fromPriceByTier)}\n</script>`],
  ])

  const cards = pricedTiers.map(t => {
    const from = fromPriceByTier.get(t.key) || 0
    // Free-text inclusions (bundle-less packages like The Prelude) take
    // precedence; otherwise list the bundled add-on names as before.
    const inclNames = (t.inclusions || []).length
      ? t.inclusions
      : (t.addons || []).map(id => addonNameById.get(id)).filter(Boolean)
    return `
      <div class="pr-pkg-card">
        <h2>${esc(t.name)}</h2>
        <p>${esc(t.tagline)}</p>
        <p><strong>${venues.length > 1 ? 'From ' : ''}₹${Math.round(from).toLocaleString('en-IN')}</strong></p>
        ${inclNames.length ? `<ul>${inclNames.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </div>`
  }).join('')

  const venuesLine = venues.length
    ? `<p>Available at: ${venues.map(v => `<a href="/venues/${esc(v.slug)}">${esc(v.name)}</a>`).join(', ')}</p>`
    : `<p>Packages are coming soon — every picnic can still be booked from its venue page. <a href="/#venues-section">Browse venues</a></p>`

  // Same crawlable-content + branded-loader pattern as buildPage(), just
  // targeting #packages-page/#packages-content instead of the venue page.
  // The class names below (pr-pkg-*) are unique to this static seed block —
  // renderPackagesPage()'s real markup uses .pkgp-*/.pkg-card* classes, so
  // the loader's MutationObserver (below) can't mistake this for hydration.
  const seo = `
      <nav class="prerender-crumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <span>Packages</span></nav>
      <h1>Picnic Packages</h1>
      <p>Bouquets at golden hour, bonfires under the stars, a screening just for two — pick the picnic that already feels like you, then choose where it happens.</p>
      <div class="pr-pkg-cards">${cards}</div>
      ${venuesLine}
      ${blogPosts.length ? `<p>Planning an occasion? Read our guides: ${blogPosts.map(p => `<a href="/blog/${esc(p.name)}">${esc(p.h1)}</a>`).join(' · ')}</p>` : ''}`

  const loader = `
<div id="pr-loader" aria-hidden="true" style="position:fixed;inset:0;z-index:99999;background:#fdfaf7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.25rem">
  <img src="/logo3.png" alt="" style="height:56px;width:auto" id="pr-logo">
  <div style="width:40px;height:3px;border-radius:2px;background:#e8e0d8;overflow:hidden">
    <div id="pr-bar" style="height:100%;width:0%;background:#a84d66;border-radius:2px;transition:width .1s linear"></div>
  </div>
</div>
<style>
  @keyframes pr-logo-pulse{0%,100%{opacity:.5}50%{opacity:1}}
  #pr-logo{animation:pr-logo-pulse 1.4s ease-in-out infinite}
</style>
<script>
(function(){
  var lo=document.getElementById('pr-loader');
  var bar=document.getElementById('pr-bar');
  if(!lo)return;
  var prog=0;
  var fill=setInterval(function(){prog=Math.min(prog+2,88);if(bar)bar.style.width=prog+'%';},50);
  var gone=false;
  function rm(){
    if(gone)return;gone=true;
    clearInterval(fill);
    if(bar)bar.style.width='100%';
    setTimeout(function(){
      lo.style.transition='opacity .28s';
      lo.style.opacity='0';
      setTimeout(function(){lo.parentNode&&lo.parentNode.removeChild(lo);},300);
    },120);
  }
  // Primary: detect when app.js inserts the real .pkgp-wrap (interactive packages page ready)
  if(window.MutationObserver){
    var obs=new MutationObserver(function(){
      if(document.querySelector('.pkgp-wrap')){obs.disconnect();rm();}
    });
    obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  }
  // Fallback A: hide 300ms after all resources (including app.js) have loaded
  window.addEventListener('load',function(){setTimeout(rm,300);});
  // Fallback B: hard cap at 6s — never block the user forever
  setTimeout(rm,6000);
})();
</script>`

  html = slimHomeShell(html)
    .replace('<div id="packages-page" class="page">', '<div id="packages-page" class="page active">')
    .replace('<div id="packages-content"></div>', `<div id="packages-content">${seo}</div>`)
    .replace('</body>', `${loader}\n</body>`)

  return { url, html }
}

// ───────────────────────────── Blog (BLOG_SEO_PLAN_2026-07-11.md, Track B1) ─────────────────────────────
// Blog posts are STANDALONE static pages (city-page pattern), NOT SPA-shell
// clones: app.js has no /blog route, so there is nothing to hydrate. Source of
// truth is content/blog/*.md — each file starts with an HTML-comment "SEO SPEC"
// block (title / meta / slug / published / hero), followed by a constrained
// markdown subset (#..#### headings, **bold**, *italic*, [links](url), - and
// 1. lists, --- rules, paragraphs). The parser below covers exactly that
// subset — if you write fancier markdown in a post, extend mdToHtml() first.
const BLOG_DIR = resolve(process.cwd(), 'content', 'blog')

function mdInline(s) {
  s = s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) => `<a href="${h}">${t}</a>`)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return s
}

function mdToHtml(md) {
  const out = []
  let para = []
  let list = null
  const flushPara = () => { if (para.length) { out.push(`<p>${mdInline(para.join(' '))}</p>`); para = [] } }
  const flushList = () => {
    if (list) {
      out.push(`<${list.type}>${list.items.map(i => `<li>${mdInline(i)}</li>`).join('')}</${list.type}>`)
      list = null
    }
  }
  for (const raw of md.split('\n')) {
    const t = raw.trim()
    if (!t) { flushPara(); flushList(); continue }
    let m
    if ((m = t.match(/^(#{1,4})\s+(.*)/))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`); continue }
    if (/^-{3,}$/.test(t)) { flushPara(); flushList(); out.push('<hr>'); continue }
    if ((m = t.match(/^-\s+(.*)/))) { flushPara(); if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] } } list.items.push(m[1]); continue }
    if ((m = t.match(/^\d+\.\s+(.*)/))) { flushPara(); if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] } } list.items.push(m[1]); continue }
    flushList(); para.push(t)
  }
  flushPara(); flushList()
  return out.join('\n')
}

// The spec block annotates title/meta with "(NN chars)" — strip those.
const stripAnno = (s = '') => s.replace(/\s*\(\d+\s*chars?\)\s*$/i, '').trim()

function parseBlogPost(raw, file) {
  const spec = {}
  const specMatch = raw.match(/<!--([\s\S]*?)-->/)
  if (specMatch) {
    for (const line of specMatch[1].split('\n')) {
      const i = line.indexOf(':')
      if (i > 0) spec[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
    }
  }
  const md = raw.replace(/<!--[\s\S]*?-->/, '').trim()
  const h1 = md.match(/^#\s+(.+)$/m)?.[1]?.trim() || stripAnno(spec.title) || file
  // The H1 is already rendered once in the post-hero block (see buildBlogPages)
  // — drop the leading "# Title" line here so raw HTML never carries two <h1>s
  // for the same page (the article-body one used to be CSS-hidden but still
  // crawler-visible).
  const bodyMd = md.replace(/^#\s+.+(?:\r?\n)?/, '')
  const name = (spec.slug || `/blog/${file.replace(/\.md$/, '')}`).split('/').filter(Boolean).pop()
  return {
    name,
    title: stripAnno(spec.title) || h1,
    desc: clamp(stripAnno(spec.meta) || '', 155),
    published: spec.published || new Date().toISOString().slice(0, 10),
    hero: (spec.hero || '').startsWith('http') ? spec.hero : '',
    h1,
    words: md.split(/\s+/).length,
    bodyHtml: mdToHtml(bodyMd),
    url: `${SITE}/blog/${name}`,
  }
}

const BLOG_CSS = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
    body{font-family:'Lato',system-ui,sans-serif;background:#fdfaf7;color:#2d2420;-webkit-font-smoothing:antialiased;line-height:1.7}
    a{color:inherit;text-decoration:none}
    img{display:block;max-width:100%}
    .site-header{position:sticky;top:0;z-index:50;background:rgba(253,250,247,.93);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid rgba(232,224,216,.8)}
    .header-inner{max-width:1140px;margin:0 auto;padding:.85rem 1.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}
    .header-brand{display:flex;align-items:center;gap:.55rem;font-family:'EB Garamond',Georgia,serif;font-size:1.15rem;color:#2d2420;flex-shrink:0}
    .header-brand img{height:32px;width:auto}
    .header-nav{display:flex;gap:.45rem;flex-wrap:wrap}
    .sec-pill{padding:.38rem 1rem;border-radius:999px;font-size:.78rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6b5d57;border:1.5px solid #ddd5cb;transition:background .18s,color .18s,border-color .18s;white-space:nowrap}
    .sec-pill:hover{background:#a84d66;color:#fff;border-color:#a84d66}
    .post-hero{padding:3.5rem 1.5rem 2.25rem;text-align:center;background:linear-gradient(155deg,#fdf6ef 0%,#f8ede4 45%,#f3e4db 100%)}
    .post-hero-inner{max-width:760px;margin:0 auto}
    .crumb{display:flex;align-items:center;justify-content:center;gap:.35rem;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:#b09890;margin-bottom:1.25rem}
    .crumb a:hover{color:#a84d66}
    .post-hero h1{font-family:'EB Garamond',Georgia,serif;font-size:clamp(1.9rem,4.5vw,3rem);font-weight:400;line-height:1.15;margin-bottom:1rem}
    .post-meta{font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:#9a8b85}
    article{max-width:720px;margin:0 auto;padding:2.75rem 1.5rem 3.5rem;font-size:1.04rem;color:#4a3f39}
    article h1{display:none}
    article h2{font-family:'EB Garamond',Georgia,serif;font-size:1.75rem;font-weight:500;color:#2d2420;line-height:1.25;margin:2.4rem 0 .85rem}
    article h3{font-family:'EB Garamond',Georgia,serif;font-size:1.3rem;font-weight:500;color:#2d2420;margin:1.9rem 0 .6rem}
    article p{margin-bottom:1.1rem}
    article ul,article ol{margin:0 0 1.25rem 1.35rem}
    article li{margin-bottom:.55rem}
    article a{color:#a84d66;font-weight:700;border-bottom:1px solid rgba(168,77,102,.35);transition:border-color .15s}
    article a:hover{border-color:#a84d66}
    article strong{color:#2d2420}
    article hr{border:0;height:1px;background:#e8e0d8;margin:2.5rem 0}
    article .lead-img{border-radius:16px;margin-bottom:1.6rem;aspect-ratio:16/9;object-fit:cover;width:100%}
    .cta-band{background:linear-gradient(140deg,#1e1410 0%,#2d2420 60%,#352820 100%);color:#f5ede8;padding:4.5rem 1.5rem;text-align:center}
    .cta-band-inner{max-width:520px;margin:0 auto}
    .cta-band h2{font-family:'EB Garamond',Georgia,serif;font-size:clamp(1.8rem,4vw,2.5rem);font-weight:400;line-height:1.2;margin-bottom:.7rem}
    .cta-band p{color:rgba(245,237,232,.68);margin-bottom:2rem}
    .cta-btn{display:inline-flex;align-items:center;gap:.5rem;background:#a84d66;color:#fff;padding:.9rem 2.1rem;border-radius:999px;font-size:.97rem;font-weight:700;letter-spacing:.025em;transition:filter .2s,transform .18s}
    .cta-btn:hover{filter:brightness(1.1);transform:translateY(-2px)}
    .page-footer{padding:2.75rem 1.5rem;text-align:center;font-size:.82rem;color:#9a8b85;border-top:1px solid #e8e0d8}
    .page-footer a:hover{color:#a84d66}
    .footer-links{display:flex;justify-content:center;gap:1.75rem;flex-wrap:wrap;margin:.6rem 0 1rem}
    .post-list{max-width:760px;margin:0 auto;padding:2.5rem 1.5rem 3.5rem;display:grid;gap:1.5rem}
    .post-card{display:block;background:#fff;border:1px solid #ede6de;border-radius:16px;padding:1.75rem 1.9rem;transition:transform .22s,box-shadow .22s}
    .post-card:hover{transform:translateY(-4px);box-shadow:0 14px 40px rgba(168,77,102,.13)}
    .post-card h2{font-family:'EB Garamond',Georgia,serif;font-size:1.45rem;font-weight:500;color:#2d2420;line-height:1.3;margin-bottom:.5rem}
    .post-card p{font-size:.92rem;color:#6b5d57;margin-bottom:.85rem}
    .post-card .read-more{font-size:.82rem;font-weight:700;color:#a84d66;letter-spacing:.03em}
    @media(max-width:640px){.post-hero{padding:2.5rem 1.25rem 1.75rem}article{padding:2rem 1.25rem 2.75rem}.header-nav{display:none}}`

function blogShell({ title, desc, canonical, jsonLd, heroBlock, mainHtml, ogType = 'article', ogImage }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:site_name" content="The Picnic Stories">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:locale" content="en_IN">
  <meta property="og:image" content="${esc(ogImage || HERO_FALLBACK)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${esc(ogImage || HERO_FALLBACK)}">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Lato:wght@400;700&display=swap" rel="stylesheet">
  <script type="application/ld+json">${jsonLd}</script>
  <style>${BLOG_CSS}
  </style>
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="/" class="header-brand"><img src="/logo3.png" alt="The Picnic Stories logo">The Picnic Stories</a>
      <nav class="header-nav" aria-label="Site">
        <a href="/blog" class="sec-pill">All posts</a>
        <a href="/packages" class="sec-pill">Packages</a>
        <a href="/#venues-section" class="sec-pill">Venues</a>
      </nav>
    </div>
  </header>
  ${heroBlock}
  <main>
${mainHtml}
    <div class="cta-band">
      <div class="cta-band-inner">
        <h2>Make it a story worth telling</h2>
        <p>Pick an occasion, pick a venue — the setup is styled and waiting before you arrive.</p>
        <a href="/packages" class="cta-btn">Browse picnic packages</a>
      </div>
    </div>
  </main>
  <footer class="page-footer">
    <nav class="footer-links" aria-label="Footer links">
      <a href="/">Home</a>
      <a href="/blog">Blog</a>
      <a href="/packages">Packages</a>
      <a href="/privacy.html">Privacy</a>
      <a href="/terms.html">Terms</a>
    </nav>
    <p>&copy; ${new Date().getFullYear()} The Picnic Stories. All rights reserved.</p>
  </footer>
</body>
</html>`
}

/** Build /blog/<slug> pages + the /blog index from content/blog/*.md.
 * Returns the parsed posts (for cross-linking from other prerendered pages);
 * empty array if the content dir is missing — never fails the build. */
function buildBlogPages(urls) {
  if (!existsSync(BLOG_DIR)) {
    console.warn('[prerender] content/blog not found — skipping blog pages')
    return []
  }
  const files = readdirSync(BLOG_DIR).filter(f => f.endsWith('.md')).sort()
  if (!files.length) { console.warn('[prerender] content/blog is empty — skipping blog pages'); return [] }

  const posts = files.map(f => parseBlogPost(readFileSync(resolve(BLOG_DIR, f), 'utf8'), f))
  mkdirSync(resolve(DIST, 'blog'), { recursive: true })

  for (const p of posts) {
    const readMins = Math.max(1, Math.round(p.words / 220))
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: p.h1,
      description: p.desc,
      image: p.hero || HERO_FALLBACK,
      datePublished: p.published,
      dateModified: p.published,
      mainEntityOfPage: p.url,
      author: { '@type': 'Organization', name: 'The Picnic Stories' },
      publisher: {
        '@type': 'Organization', name: 'The Picnic Stories', url: SITE,
        logo: { '@type': 'ImageObject', url: `${SITE}/logo3.png` },
      },
    }, null, 2).replaceAll('<', '\\u003c')

    const heroBlock = `
  <div class="post-hero">
    <div class="post-hero-inner">
      <nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/blog">Blog</a></nav>
      <h1>${esc(p.h1)}</h1>
      <p class="post-meta">${esc(new Date(p.published + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }))} &middot; ${readMins} min read</p>
    </div>
  </div>`

    const mainHtml = `    <article>
${p.hero ? `      <img class="lead-img" src="${esc(p.hero)}" alt="${esc(p.h1)}">\n` : ''}${p.bodyHtml}
    </article>`

    const html = blogShell({
      title: p.title, desc: p.desc, canonical: p.url, jsonLd, heroBlock, mainHtml, ogImage: p.hero,
    })
    writeFileSync(resolve(DIST, 'blog', `${p.name}.html`), html)
    urls.push(p.url)
    console.log(`[prerender] blog post: /blog/${p.name}`)
  }

  // /blog index
  const indexUrl = `${SITE}/blog`
  const indexLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'The Picnic Stories Blog',
    url: indexUrl,
    blogPost: posts.map(p => ({ '@type': 'BlogPosting', headline: p.h1, url: p.url, datePublished: p.published })),
  }, null, 2).replaceAll('<', '\\u003c')

  const cards = posts
    .slice().sort((a, b) => b.published.localeCompare(a.published))
    .map(p => `      <a class="post-card" href="/blog/${esc(p.name)}">
        <h2>${esc(p.h1)}</h2>
        <p>${esc(p.desc)}</p>
        <span class="read-more">Read the guide &rarr;</span>
      </a>`).join('\n')

  const indexHtml = blogShell({
    title: 'Picnic Ideas & Celebration Guides | The Picnic Stories',
    desc: 'Guides to birthdays, dates, proposals, and anniversaries at private picnic setups across Gurugram, Delhi NCR, and Jaipur.',
    canonical: indexUrl,
    jsonLd: indexLd,
    ogType: 'website',
    heroBlock: `
  <div class="post-hero">
    <div class="post-hero-inner">
      <nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <span>Blog</span></nav>
      <h1>Ideas &amp; Guides</h1>
      <p class="post-meta">Celebrations, planned properly</p>
    </div>
  </div>`,
    mainHtml: `    <div class="post-list">
${cards}
    </div>`,
  })
  writeFileSync(resolve(DIST, 'blog.html'), indexHtml)
  urls.push(indexUrl)
  console.log(`[prerender] blog index: /blog (${posts.length} posts)`)
  return posts
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

  const blogPosts = buildBlogPages(urls)

  const packagesPage = await buildPackagesPage(supabase, template, blogPosts)
  if (packagesPage) {
    writeFileSync(resolve(DIST, 'packages.html'), packagesPage.html)
    urls.push(packagesPage.url)
    console.log(`[prerender] packages page: /packages`)
  }

  const lastmod = new Date().toISOString().slice(0, 10)
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`
  writeFileSync(resolve(DIST, 'sitemap.xml'), sitemap)
  writeFileSync(resolve(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${SITE}/sitemap.xml\n`)

  console.log(`[prerender] wrote ${seen.size} venue pages + ${cityPageCount} city pages + ${packagesPage ? 1 : 0} packages page + ${blogPosts.length} blog posts (+ index) + sitemap (${urls.length} urls)`)
}

main().catch((e) => { console.error('[prerender]', e); process.exit(1) })
