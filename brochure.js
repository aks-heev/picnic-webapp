// brochure.js — unlisted /brochure page (the web version of the packages PDF).
//
// Copy and photos are static in brochure.html (photos ship from /public, so no
// Supabase Storage egress). Prices and inclusions are filled LIVE so this page
// can never quote something the booking flow doesn't charge or /packages
// doesn't say:
//   - package "from" price = lowest no-food price in package_price_grid (the
//     view over package_prices — the same rows compute_booking_total prices
//     from), plus "with food from" the lowest with-food price (2026-10-23, G4).
//     Falls back to the lowest venue_packages.price if the view is unavailable.
//   - add-ons menu = active add_ons rows
//   - inclusions = the same rules as app.js's /packages cards:
//       standalone package (non-empty packages.inclusions, e.g. The Prelude)
//         -> that free-text list
//       first tier of the ladder (The Setting) -> SHARED_SETUP_LABELS
//       later tiers (Moment, Story) -> the package_add_ons each adds on top
//         of the previous tier ("Everything in <prev>, plus")
// If the fetch fails, the static copy already in the HTML stays on screen.
import { createClient } from '@supabase/supabase-js'
import { track } from './analytics.js'
import { SHARED_SETUP_LABELS } from './setup-labels.js'

const WA = {
  Gurugram: '919773703982',
  Jaipur: '919266964666',
}

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Display names for add-ons whose DB name is admin shorthand. Keyed by name,
// not id (ids are traps here — see CLAUDE.md §6). Unknown names show as-is.
const ADDON_LABEL = {
  'Photo Printouts(10 Colored Photos)': 'Photo Printouts (10 pics)',
  'Bonfire': 'Bonfire (charcoal pit)',
  'Skyshots': 'Skyshots (fireworks)',
}

function waLink(city, pkgName) {
  const text = pkgName
    ? `Hi! I'd like to book ${pkgName} with The Picnic Stories.`
    : `Hi! I'd like to book a picnic with The Picnic Stories.`
  return `https://wa.me/${WA[city]}?text=${encodeURIComponent(text)}`
}

// Website booking link. With a package: /packages?tier=<key> opens the venue
// step for that package (app.js showPackagesPage — /packages is only the venue
// step since merge plan Phase 2). Without one: /packages, which redirects back
// here, so a CTA without a package is never rendered in practice.
function siteLink(pkgKey) {
  const p = new URLSearchParams()
  if (pkgKey) p.set('tier', pkgKey)
  p.set('utm_source', 'brochure')
  p.set('utm_medium', 'link')
  return `/packages?${p}`
}

function renderCtas() {
  document.querySelectorAll('[data-cta]').forEach(slot => {
    const card = slot.closest('[data-pkg]')
    const key = card?.dataset.pkg || null
    const name = card?.querySelector('h3')?.textContent.trim() || ''
    slot.innerHTML =
      `<a class="pk-btn pk-btn--site" href="${siteLink(key)}" data-site>${name ? `Book ${esc(name)} online` : 'Book online'}</a>` +
      `<p class="pk-cta-label">Or book on WhatsApp</p>` +
      Object.keys(WA).map(city =>
        `<a class="pk-btn pk-btn--wa" href="${waLink(city, name)}" target="_blank" rel="noopener noreferrer" data-city="${city}">${city}</a>`
      ).join('')
    slot.addEventListener('click', (e) => {
      const a = e.target.closest('a')
      if (!a) return
      if (a.hasAttribute('data-site')) track('brochure_book_online_click', { package_key: key })
      else if (a.dataset.city) {
        track('brochure_whatsapp_click', { package_key: key, city: a.dataset.city })
        // Meta "Contact" — same event app.js fires on its WhatsApp buttons.
        if (typeof window.fbq === 'function') window.fbq('track', 'Contact')
      }
    })
  })
}

async function fillLivePrices() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return
  const supabase = createClient(url, key)
  const [pkgRes, vpRes, addRes, gridRes, reelRes] = await Promise.all([
    supabase.from('packages').select('id, key, is_active, inclusions, package_add_ons(addon_id, sort_order)').eq('is_active', true),
    supabase.from('venue_packages').select('package_id, price').eq('is_active', true),
    // category 'setup' = stay-only celebration setups (named like packages,
    // e.g. "The Prelude ₹4,300") — not layerable add-ons, so never on this menu.
    supabase.from('add_ons').select('id, name, price, category').eq('is_active', true).neq('category', 'setup')
      .order('price', { ascending: true }).order('sort_order', { ascending: true }),
    supabase.from('package_price_grid').select('package_key, from_price_no_food, from_price_with_food'),
    supabase.from('reels').select('id, package_id, ig_kind, ig_code, theme, sort_order').eq('is_active', true)
      .order('sort_order', { ascending: true }).order('id', { ascending: true }),
  ])

  if (!pkgRes.error && !reelRes.error) fillReels(pkgRes.data || [], reelRes.data || [])

  if (!pkgRes.error && !addRes.error) fillInclusions(pkgRes.data || [], addRes.data || [])

  if (!pkgRes.error && !vpRes.error) {
    const idByKey = new Map((pkgRes.data || []).map(p => [p.key, p.id]))
    const minById = new Map()
    for (const r of vpRes.data || []) {
      const p = Number(r.price)
      if (!(p > 0)) continue
      if (!minById.has(r.package_id) || p < minById.get(r.package_id)) minById.set(r.package_id, p)
    }
    // Price table (preferred): lowest no-food and lowest with-food price per package.
    const gridNoFood = new Map()
    const gridFood = new Map()
    if (!gridRes.error) {
      for (const r of gridRes.data || []) {
        const nf = Number(r.from_price_no_food), wf = Number(r.from_price_with_food)
        if (nf > 0 && (!gridNoFood.has(r.package_key) || nf < gridNoFood.get(r.package_key))) gridNoFood.set(r.package_key, nf)
        if (wf > 0 && (!gridFood.has(r.package_key) || wf < gridFood.get(r.package_key))) gridFood.set(r.package_key, wf)
      }
    }
    const shown = []
    document.querySelectorAll('[data-pkg]').forEach(card => {
      const id = idByKey.get(card.dataset.pkg)
      // Package switched off in admin → don't advertise it here either. Only
      // trusted when the query returned rows; an empty result keeps the page.
      if (id === undefined) { if (idByKey.size) card.hidden = true; return }
      const min = gridNoFood.get(card.dataset.pkg) || minById.get(id)
      if (min) card.querySelector('[data-price]').textContent = inr(min)
      const foodEl = card.querySelector('[data-price-food]')
      const food = gridFood.get(card.dataset.pkg)
      if (foodEl) {
        if (food) foodEl.textContent = `with food from ${inr(food)}`
        else if (!gridRes.error) foodEl.hidden = true
      }
      shown.push({ key: card.dataset.pkg, min })
    })
    // Meta Pixel ViewContent — same shape as showPackagesPage in app.js, so
    // Events Manager numbers stay comparable across the two pages.
    if (typeof window.fbq === 'function' && shown.length) {
      const prices = shown.map(s => s.min).filter(p => p > 0)
      const params = {
        content_ids:  shown.map(s => s.key),
        content_name: 'Picnic Packages',
        content_type: 'product_group',
        currency:     'INR',
      }
      if (prices.length) params.value = Math.min(...prices)
      window.fbq('track', 'ViewContent', params)
    }
  }

  if (!addRes.error && (addRes.data || []).length) {
    document.querySelector('[data-addons]').innerHTML = addRes.data
      .map(a => `<li><span>${esc(ADDON_LABEL[a.name] || a.name)}</span><b>${inr(a.price)}</b></li>`)
      .join('')
  }
}

// ── Reels (public.reels, managed in admin › Packages › Brochure reels) ──
// A package's card shows ONE branded tile for its first active reel, in place
// of the gallery's right column; each theme row swaps its narrow third photo
// for a tile when a reel carries that theme. No images: the tap opens the reel
// player below. With no reels (or a failed fetch) the photos stay as they are.
const PLAY_SVG = (color) => `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="${color}"></path></svg>`
const ARROW_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"></path></svg>'
const THEME_COLOR = { blush_pink: '#b0476b', ivory_beige: '#8a5a14', sage_green: '#4f6b45' }
const THEME_LABEL = { blush_pink: 'blush pink', ivory_beige: 'ivory beige', sage_green: 'sage green' }
// The tile covers photos the gallery then hides; reuse the first hidden one
// as the tile's background (no extra download, no photo shown twice).
function tilePhoto(tile, img) {
  const src = img && (img.currentSrc || img.getAttribute('src'))
  if (!src) return
  tile.style.setProperty('--tile-img', `url("${src.replace(/"/g, '%22')}")`)
  tile.classList.add('has-photo')
}

const igUrl = (r) => `https://www.instagram.com/${r.ig_kind === 'p' ? 'p' : 'reel'}/${encodeURIComponent(r.ig_code)}/`

// ── Reel player (2026-10-24) ──
// Tapping a reel tile opens this overlay with Instagram's own player for that
// reel (instagram.com/<kind>/<code>/embed/ — undocumented but what Instagram's
// embed script loads). Nothing from Instagram loads until the tap. Previous /
// next step through every active reel of that package (or theme). "Not
// playing? Open on Instagram" is always there in case the embed fails, and a
// tile still has the Instagram link as its href (no-JS, middle-click).
const player = { el: null, list: [], i: 0, ctx: null, trigger: null, open: false }

function embedUrl(r) {
  return `https://www.instagram.com/${r.ig_kind === 'p' ? 'p' : 'reel'}/${encodeURIComponent(r.ig_code)}/embed/`
}

function buildPlayer() {
  const el = document.createElement('div')
  el.className = 'pk-player'
  el.hidden = true
  el.innerHTML = `
    <div class="pk-player-backdrop" data-close></div>
    <div class="pk-player-dialog" role="dialog" aria-modal="true" aria-labelledby="pk-player-title">
      <button type="button" class="pk-player-close" aria-label="Close reel" data-close>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
      <div class="pk-player-stage">
        <button type="button" class="pk-player-nav" data-nav="-1" aria-label="Previous reel">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"></path></svg>
        </button>
        <div class="pk-player-frame">
          <p class="pk-player-loading">Loading reel…</p>
        </div>
        <button type="button" class="pk-player-nav" data-nav="1" aria-label="Next reel">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>
        </button>
      </div>
      <div class="pk-player-panel">
        <div class="pk-player-head">
          <h2 id="pk-player-title"></h2>
          <p class="pk-player-price"></p>
        </div>
        <p class="pk-player-count" aria-live="polite"></p>
        <p class="pk-player-note"></p>
        <a class="pk-btn pk-player-book" href="#"></a>
        <a class="pk-player-ig" href="#" target="_blank" rel="noopener noreferrer">Not playing? Open on Instagram ${ARROW_SVG}</a>
      </div>
    </div>`
  document.body.appendChild(el)
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closePlayer()
    const nav = e.target.closest('[data-nav]')
    if (nav) return stepPlayer(Number(nav.dataset.nav))
    if (e.target.closest('.pk-player-book')) {
      const c = player.ctx
      track('brochure_reel_book_click', { package_key: c.key || null, theme: c.theme || null, ig_code: player.list[player.i]?.ig_code })
      if (c.kind === 'theme') { e.preventDefault(); closePlayer(); document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' }) }
      return
    }
    if (e.target.closest('.pk-player-ig')) track('brochure_reel_instagram_click', { ig_code: player.list[player.i]?.ig_code })
  })
  window.addEventListener('resize', () => { if (player.open) sizePlayerFrame() })
  window.addEventListener('popstate', () => { if (player.open) closePlayer(true) })
  return el
}

// Instagram's embed is a header + a 4:5 video box + a footer, so its height
// follows its width (~1.25w + 240px; +20 headroom for OS font differences). Size the frame to that, as large as the
// stage allows, so there's no blank strip under the embed.
function sizePlayerFrame() {
  const stage = player.el.querySelector('.pk-player-stage')
  const frame = player.el.querySelector('.pk-player-frame')
  const wide = window.innerWidth >= 900
  // Desktop: arrows sit beside the frame and the stage sizes to it, so measure
  // from the window minus the side panel (320) and gaps. Phone: arrows overlay
  // the frame's edges (the video's black bars), so the frame gets the width.
  const navW = wide && player.list.length > 1 ? 2 * 52 : 0
  const availW = Math.max(220, (wide ? window.innerWidth - 320 - 16 - 96 : stage.clientWidth - 8) - navW)
  const availH = stage.clientHeight
  const w = Math.round(Math.max(200, Math.min(availW, 420, (availH - 260) / 1.25)))
  frame.style.width = `${w}px`
  frame.style.height = `${Math.round(w * 1.25 + 260)}px`
}

function showReel(i) {
  const el = player.el
  player.i = i
  const r = player.list[i]
  const n = player.list.length
  // A fresh iframe per reel: changing an existing iframe's src adds entries
  // to the page's history, which would make Back step through reels instead
  // of closing the player.
  el.querySelector('.pk-player-frame iframe')?.remove()
  el.classList.remove('is-loaded')
  const iframe = document.createElement('iframe')
  iframe.title = 'Instagram reel'
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
  iframe.allowFullscreen = true
  iframe.referrerPolicy = 'strict-origin-when-cross-origin'
  // No inner scrollbar: Windows draws a classic one when Instagram's footer
  // runs a few px taller than our estimate (font metrics differ by OS).
  iframe.setAttribute('scrolling', 'no')
  iframe.addEventListener('load', () => el.classList.add('is-loaded'))
  iframe.src = embedUrl(r)
  el.querySelector('.pk-player-frame').appendChild(iframe)
  el.querySelector('.pk-player-ig').href = igUrl(r)
  el.querySelector('.pk-player-count').textContent = n > 1 ? `Reel ${i + 1} of ${n}` : ''
  el.querySelectorAll('[data-nav]').forEach(b => {
    b.hidden = n < 2
    b.disabled = (Number(b.dataset.nav) < 0 && i === 0) || (Number(b.dataset.nav) > 0 && i === n - 1)
  })
}

function openPlayer(ctx, list, trigger) {
  if (!list.length) return
  if (!player.el) player.el = buildPlayer()
  const el = player.el
  Object.assign(player, { ctx, list, trigger, open: true })
  el.querySelector('#pk-player-title').textContent = ctx.title
  el.querySelector('.pk-player-price').innerHTML = ctx.price ? `from <strong>${esc(ctx.price)}</strong>` : ''
  el.querySelector('.pk-player-note').textContent = ctx.note || ''
  const book = el.querySelector('.pk-player-book')
  book.textContent = ctx.bookText
  book.href = ctx.bookHref
  el.classList.toggle('is-theme', ctx.kind === 'theme')
  el.hidden = false
  document.documentElement.classList.add('pk-player-open')
  sizePlayerFrame()
  showReel(0)
  // Back button / Android back closes the player instead of leaving the page.
  try { history.pushState({ pkPlayer: true }, '') } catch (_) { /* ignore */ }
  document.addEventListener('keydown', onPlayerKey)
  el.querySelector('.pk-player-close').focus()
  track('brochure_reel_open', { placement: ctx.kind, package_key: ctx.key || null, theme: ctx.theme || null, ig_code: list[0].ig_code, reels: list.length })
}

function stepPlayer(dir) {
  const j = player.i + dir
  if (j < 0 || j >= player.list.length) return
  showReel(j)
  track('brochure_reel_nav', { dir, index: j, ig_code: player.list[j].ig_code })
}

function closePlayer(fromPopstate = false) {
  if (!player.open) return
  const el = player.el
  player.open = false
  el.hidden = true
  el.querySelector('.pk-player-frame iframe')?.remove() // stops playback
  document.documentElement.classList.remove('pk-player-open')
  document.removeEventListener('keydown', onPlayerKey)
  if (!fromPopstate && history.state && history.state.pkPlayer) history.back()
  player.trigger?.focus()
}

function onPlayerKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closePlayer() }
  else if (e.key === 'ArrowLeft') stepPlayer(-1)
  else if (e.key === 'ArrowRight') stepPlayer(1)
  else if (e.key === 'Tab') {
    // Keep focus inside the dialog while it's open.
    const f = [...player.el.querySelectorAll('button:not([hidden]):not([disabled]), a[href], iframe')]
    if (!f.length) return
    const first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
}

// Plain click opens the player; modifier / middle clicks keep the Instagram href.
function playerClick(e, ctx, list) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  e.preventDefault()
  openPlayer(ctx, list, e.currentTarget)
  return true
}

function fillReels(pkgs, reels) {
  if (!reels.length) return
  const keyById = new Map(pkgs.map(p => [p.id, p.key]))
  const byKey = new Map() // package key -> its active reels, in admin order
  for (const r of reels) {
    const key = keyById.get(r.package_id)
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(r)
  }
  document.querySelectorAll('[data-pkg]').forEach(card => {
    const list = byKey.get(card.dataset.pkg)
    const gallery = card.querySelector('[data-gallery]')
    if (!list || !gallery) return
    const key = card.dataset.pkg
    const name = card.querySelector('h3')?.textContent.trim() || ''
    const short = name.replace(/^The\s+/i, '')
    const a = document.createElement('a')
    a.className = 'pk-reel-tile'
    a.href = igUrl(list[0])
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.setAttribute('aria-label', list.length > 1 ? `Watch reels of real ${short} setups` : `Watch a reel of a real ${short} setup`)
    a.innerHTML =
      `<span class="pk-reel-pill">Reel</span>` +
      `<span class="pk-reel-play">${PLAY_SVG('#126a5d')}</span>` +
      `<span class="pk-reel-title">Watch a real ${esc(short)}</span>`
    a.addEventListener('click', (e) => {
      track('brochure_reel_click', { placement: 'package', package_key: key, ig_code: list[0].ig_code })
      playerClick(e, {
        kind: 'package', key, title: name,
        price: card.querySelector('[data-price]')?.textContent.trim() || '',
        note: `A real ${short} setup. Everything in ${list.length > 1 ? 'these reels' : 'this reel'} is part of the package.`,
        bookText: `Book ${name} online`, bookHref: siteLink(key),
      }, list)
    })
    tilePhoto(a, gallery.querySelector(gallery.classList.contains('pk-gallery--prelude') ? 'img:nth-child(2)' : 'img:nth-child(3)'))
    gallery.appendChild(a)
    gallery.classList.add('has-reel')
  })
  document.querySelectorAll('[data-theme]').forEach(block => {
    const theme = block.dataset.theme
    const list = reels.filter(r => r.theme === theme)
    const row = block.querySelector('.pk-theme-row')
    if (!list.length || !row) return
    const a = document.createElement('a')
    a.className = `pk-theme-reel pk-theme-reel--${theme}`
    a.href = igUrl(list[0])
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.setAttribute('aria-label', `Watch ${THEME_LABEL[theme] || ''} setup reels`)
    a.innerHTML = `<span class="pk-reel-play">${PLAY_SVG(THEME_COLOR[theme] || '#126a5d')}</span><span>Watch</span>`
    a.addEventListener('click', (e) => {
      track('brochure_reel_click', { placement: 'theme', theme, ig_code: list[0].ig_code })
      const label = THEME_LABEL[theme] || ''
      playerClick(e, {
        kind: 'theme', theme,
        title: label.charAt(0).toUpperCase() + label.slice(1),
        note: 'Real setups in this theme.',
        bookText: 'See packages', bookHref: '#packages',
      }, list)
    })
    tilePhoto(a, row.querySelector('img:nth-child(3)'))
    row.appendChild(a)
    row.classList.add('has-reel')
  })
}

// "Get inspired" links are static HTML; count their taps so we know whether
// reels earn their space on the page.
function trackInspiredLinks() {
  const dl = document.querySelector('.pk-reels')
  if (!dl) return
  dl.addEventListener('click', (e) => {
    const a = e.target.closest('a')
    if (!a) return
    const dd = a.closest('dd')
    const dt = dd?.previousElementSibling
    track('brochure_reel_click', { placement: 'inspired', occasion: dt?.textContent.trim() || null, url: a.href })
  })
}

function setIncl(card, items) {
  const ul = card.querySelector('.pk-incl')
  if (!ul || !items.length) return
  ul.innerHTML = items.map(n => `<li>${esc(n)}</li>`).join('')
}

// The Setting's list needs no fetch — it's the shared module /packages uses.
function fillSettingInclusions() {
  const card = document.querySelector('[data-pkg="setting"]')
  if (card) setIncl(card, SHARED_SETUP_LABELS)
}

function fillInclusions(pkgs, addOns) {
  const byKey = new Map(pkgs.map(p => [p.key, p]))
  const nameById = new Map(addOns.map(a => [a.id, ADDON_LABEL[a.name] || a.name]))
  const addonIds = p => (p.package_add_ons || []).slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(r => r.addon_id)
  let prev = null // previous non-standalone package on the ladder
  document.querySelectorAll('[data-pkg]').forEach(card => {
    const pkg = byKey.get(card.dataset.pkg)
    if (!pkg) return
    const own = Array.isArray(pkg.inclusions) ? pkg.inclusions.filter(Boolean) : []
    if (own.length) { setIncl(card, own); return } // standalone: not a rung
    if (prev) {
      const had = new Set(addonIds(prev))
      setIncl(card, addonIds(pkg).filter(id => !had.has(id)).map(id => nameById.get(id)).filter(Boolean))
      const lead = card.querySelector('.pk-plus span')
      const prevName = document.querySelector(`[data-pkg="${prev.key}"] h3`)?.textContent.trim()
      if (lead && prevName) lead.textContent = `Everything in ${prevName}, plus`
    } else {
      setIncl(card, SHARED_SETUP_LABELS)
    }
    prev = pkg
  })
}

renderCtas()
fillSettingInclusions()
trackInspiredLinks()
track('brochure_viewed', { referrer: document.referrer || null })
fillLivePrices().catch(err => console.warn('[brochure] live prices unavailable, showing defaults', err))
