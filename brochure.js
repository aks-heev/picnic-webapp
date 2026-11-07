// brochure.js — the city brochures (2026-11-03):
//   /brochure         city chooser (fills each city's live "from" price)
//   /brochure/ncr     Gurugram & Delhi NCR   } same template; <html data-city> says which.
//   /brochure/jaipur  Jaipur                 } Built by scripts/prerender-venues.mjs.
// Plan: docs/PLAN_city_brochures_redesign_2026-11-03.md.
//
// Copy and photos are static in brochure.html (photos ship from /public, so no
// Supabase Storage egress). Everything that can go stale is filled from the DB:
//   - prices: public.brochure_city_prices, which mirrors compute_booking_total
//     (package_prices when a venue has rows, else venue_packages). Rendered by
//     brochure-render.js — the SAME functions the build uses to bake them — so
//     the baked page and the live refresh can never disagree. Only this city's
//     rows are shown; a package no venue here offers is hidden.
//   - venues, stays, add-ons (with per-city availability): live rows.
//   - inclusions: the same rules as app.js's package cards (fillInclusions).
// If the fetch fails, the prices baked in at build time stay on screen.
import { createClient } from '@supabase/supabase-js'
import { track } from './analytics.js'
import { SHARED_SETUP_LABELS } from './setup-labels.js'
import { currentSearch, saveSearch, appendSearchParams, defaultTierForOccasion } from './params.js'
import {
  REGIONS, regionForCity, summarizeRegion, regionFrom, priceBlockHtml, glanceRowsHtml,
  venueCardsHtml, stayRowsHtml, addonRowsHtml, packageCtaHtml, bookHref, waHref, ADDON_LABEL, inr, esc,
} from './brochure-render.js'

// Homepage hero search fields (occasion / city / date / guests), validated by
// params.js. URL first, then this tab's last hero search.
const SEARCH = currentSearch()

// Which city page this is: set on <html> by the build (or, on the bare
// template, by the inline script in brochure.html). null = the chooser.
const REGION = (() => { const c = document.documentElement.dataset.city; return REGIONS[c] ? c : null })()
const R = REGION ? REGIONS[REGION] : null

// Hero-search fields carried into /packages. A searched city in the OTHER
// region is dropped, so the venue step never opens on the wrong city.
function carry() {
  const p = new URLSearchParams()
  const city = SEARCH.city && regionForCity(SEARCH.city) === REGION ? SEARCH.city : ''
  appendSearchParams(p, { ...SEARCH, city })
  return p
}
const siteLink = (key) => bookHref(REGION, key, carry())

function setSlot(name, html) {
  document.querySelectorAll(`[data-slot="${name}"]`).forEach(el => { el.innerHTML = html })
}

// This tab's remembered search city must not point at the other city, or the
// chooser would forward the guest back there next time.
function syncSearchCity() {
  if (SEARCH.city && regionForCity(SEARCH.city) !== REGION) {
    saveSearch({ ...SEARCH, city: REGION === 'jaipur' ? 'Jaipur' : '' })
  }
}

function markCurrentCity() {
  document.querySelectorAll('[data-switch]').forEach(a => {
    const to = a.dataset.switch
    if (to === REGION) { a.setAttribute('aria-current', 'page'); return }
    // Keep occasion / date / guests when switching city (not the city itself).
    const p = new URLSearchParams()
    appendSearchParams(p, { ...SEARCH, city: '' })
    const q = p.toString()
    if (q) a.href = `/brochure/${to}?${q}`
    a.addEventListener('click', () => track('brochure_city_switch', { from: REGION, to }))
  })
}

function renderCtas() {
  document.querySelectorAll('[data-pkg]').forEach(card => {
    const slot = card.querySelector('[data-cta]')
    if (!slot) return
    const name = card.querySelector('h3')?.textContent.trim() || ''
    slot.innerHTML = packageCtaHtml(REGION, card.dataset.pkg, name, carry())
  })
  // Cover, final band and sticky bar: this city's team, with a greeting.
  document.querySelectorAll('[data-wa]').forEach(a => {
    if (!a.closest('[data-cta]')) a.href = waHref(REGION)
  })
}

// One listener for every tracked link on the page (cards re-render live).
function onPageClick(e) {
  const toggle = e.target.closest('[data-toggle]')
  if (toggle) return onToggle(toggle)
  const a = e.target.closest('a')
  if (!a) return
  const card = a.closest('[data-pkg]')
  const key = card?.dataset.pkg || null
  if (a.hasAttribute('data-site')) {
    track('brochure_book_online_click', { package_key: key, region: REGION })
  } else if (a.hasAttribute('data-wa')) {
    const placement = card ? 'package' : a.closest('.sticky') ? 'sticky' : a.closest('.final') ? 'final' : 'cover'
    track('brochure_whatsapp_click', { package_key: key, city: R?.team || null, region: REGION, placement })
    // Meta "Contact" — same event app.js fires on its WhatsApp buttons.
    if (typeof window.fbq === 'function') window.fbq('track', 'Contact')
  } else if (a.dataset.choose) {
    track('brochure_city_chosen', { region: a.dataset.choose })
  }
}

// "Compare all N venues" (brochure-render.js priceBlockHtml).
function onToggle(b) {
  const open = b.getAttribute('aria-expanded') !== 'true'
  b.setAttribute('aria-expanded', String(open))
  document.getElementById(b.getAttribute('aria-controls'))?.toggleAttribute('hidden', !open)
  b.querySelector('[data-open-label]')?.toggleAttribute('hidden', open)
  b.querySelector('[data-close-label]')?.toggleAttribute('hidden', !open)
  if (open) track('brochure_compare_venues', { package_key: b.dataset.pkgKey || null, region: REGION })
}

// Phone sticky bar: shown once the cover's buttons have scrolled away.
function setupSticky() {
  const bar = document.querySelector('[data-sticky]')
  const anchor = document.getElementById('cv-ctas')
  if (!bar || !anchor || !('IntersectionObserver' in window)) return
  bar.hidden = false
  bar.inert = true
  document.body.classList.add('has-sticky')
  new IntersectionObserver(([en]) => {
    const on = !en.isIntersecting && en.boundingClientRect.top < 0
    bar.classList.toggle('is-on', on)
    bar.inert = !on
  }).observe(anchor)
}

// Prices, glance table and the cover's "from" — one render, from this city's rows.
function applyPrices(summaries) {
  if (!Object.keys(summaries).length) return // empty result: keep the baked prices
  const names = {}
  document.querySelectorAll('[data-pkg]').forEach(card => {
    const key = card.dataset.pkg
    const s = summaries[key]
    names[key] = card.querySelector('h3')?.textContent.trim() || key
    card.hidden = !s
    if (!s) return
    setSlot(`price:${key}`, priceBlockHtml(s, R.name))
  })
  setSlot('glance', glanceRowsHtml(summaries, names))
  const from = regionFrom(summaries)
  if (from != null) setSlot('from', inr(from))
}

function viewContent(summaries) {
  const keys = Object.keys(summaries)
  if (typeof window.fbq !== 'function' || !keys.length) return
  // Same shape as showPackagesPage in app.js (comparable in Events Manager),
  // plus the city.
  window.fbq('track', 'ViewContent', {
    content_ids: keys,
    content_name: 'Picnic Packages',
    content_type: 'product_group',
    content_category: R.name,
    currency: 'INR',
    value: regionFrom(summaries),
  })
}

async function fillLive() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return
  const supabase = createClient(url, key)
  const PRICE_COLS = 'region, venue_id, venue_name, venue_slug, venue_area, package_key, package_name, included_guests, max_guests, from_no_food, from_with_food, packages_enabled'

  if (!REGION) {
    const { data, error } = await supabase.from('brochure_city_prices').select(PRICE_COLS)
    if (error) throw error
    for (const r of Object.keys(REGIONS)) {
      const from = regionFrom(summarizeRegion(data || [], r))
      if (from != null) setSlot(`chooser-from:${r}`, inr(from))
    }
    return
  }

  const [pkgRes, priceRes, addRes, venueRes, reelRes] = await Promise.all([
    supabase.from('packages').select('id, key, is_active, inclusions, package_add_ons(addon_id, sort_order)').eq('is_active', true),
    supabase.from('brochure_city_prices').select(PRICE_COLS).eq('region', REGION),
    // category 'setup' = stay-only celebration setups (named like packages,
    // e.g. "The Prelude ₹4,300") — not layerable add-ons, so never on this menu.
    supabase.from('add_ons').select('id, name, price, category').eq('is_active', true).neq('category', 'setup')
      .order('price', { ascending: true }).order('sort_order', { ascending: true }),
    supabase.from('venues').select('id, name, slug, type, city, region, area, description, sort_order, venue_add_ons(addon_id)')
      .eq('is_active', true).order('sort_order', { ascending: true, nullsFirst: false }).order('id', { ascending: true }),
    supabase.from('reels').select('id, package_id, venue_id, ig_kind, ig_code, theme, sort_order').eq('is_active', true)
      .order('sort_order', { ascending: true }).order('id', { ascending: true }),
  ])

  if (!pkgRes.error && !reelRes.error) fillReels(pkgRes.data || [], reelsForThisCity(reelRes.data || [], venueRes.error ? [] : venueRes.data || []))
  if (!pkgRes.error && !addRes.error) fillInclusions(pkgRes.data || [], addRes.data || [])
  if (priceRes.error) throw priceRes.error
  const summaries = summarizeRegion(priceRes.data || [], REGION)
  applyPrices(summaries)
  if (!venueRes.error) {
    const cards = venueCardsHtml(venueRes.data || [], summaries)
    if (cards) setSlot('venues', cards)
    setSlot('stays', stayRowsHtml(venueRes.data || [], REGION))
  }
  if (!addRes.error) {
    const rows = addonRowsHtml(addRes.data || [], venueRes.error ? null : venueRes.data, summaries)
    if (rows) setSlot('addons', rows)
  }
  markGuestCaps(summaries)
  viewContent(summaries)
}

// ── Hero search: occasion badge + party-size caps ──
// Occasion → the package it opens on everywhere else (params.js), badged
// "Best for <occasion>" and scrolled into view. Every package stays visible.
function applySearchOccasion() {
  if (SEARCH.occasion || SEARCH.guests || SEARCH.date) {
    track('brochure_search_landed', { occasion: SEARCH.occasion || null, city: SEARCH.city || null, region: REGION, has_date: !!SEARCH.date, guests: SEARCH.guests })
  }
  if (!SEARCH.occasion) return
  const card = document.querySelector(`[data-pkg="${defaultTierForOccasion(SEARCH.occasion)}"]`)
  if (!card || card.hidden) return
  card.classList.add('pk--suggested')
  const badge = document.createElement('p')
  badge.className = 'pk-badge pk-badge--fit'
  badge.textContent = `Best for ${SEARCH.occasion}`
  card.prepend(badge)
  requestAnimationFrame(() => card.scrollIntoView({ block: 'start' }))
}

// A package "can't host" the party only when EVERY venue in this city
// offering it caps it below the searched size (max_guests; null = no cap).
// The card stays; it just says so, so nobody books a 4-guest setup for 7.
function markGuestCaps(summaries) {
  if (!SEARCH.guests) return
  document.querySelectorAll('[data-pkg]').forEach(card => {
    const s = summaries[card.dataset.pkg]
    if (!s || card.querySelector('.pk-cap-note')) return
    const cap = Math.max(...s.rows.map(r => (r.max == null ? Infinity : Number(r.max))))
    if (cap === Infinity || SEARCH.guests <= cap) return
    card.classList.add('pk--too-small')
    const note = document.createElement('p')
    note.className = 'pk-cap-note'
    note.textContent = `Hosts up to ${cap} guests — you searched for ${SEARCH.guests}.`
    card.querySelector('.pk-tagline')?.after(note)
  })
}

// ── Reels (public.reels, managed in admin › Packages › Brochure reels) ──
// A package's card shows ONE branded tile for its first active reel, in place
// of the gallery's right column; each theme row swaps its narrow third photo
// for a tile when a reel carries that theme. No images: the tap opens the reel
// player below. With no reels (or a failed fetch) the photos stay as they are.
// Play icon takes the tile's text colour (CSS sets it per city / per theme).
const PLAY_SVG = () => '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"></path></svg>'
const ARROW_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"></path></svg>'
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
        <a class="btn btn-solid pk-player-book" href="#"></a>
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

// reels.venue_id (2026-11-07): a reel shot at a venue in the OTHER city is
// dropped here. Reels with no venue, or whose venue isn't in the active list
// (inactive, or the venues fetch failed), stay — never hide on missing data.
function reelsForThisCity(reels, venues) {
  const regionOf = new Map(venues.map(v => [v.id, v.region]))
  return reels.filter(r => {
    if (r.venue_id == null) return true
    const region = regionOf.get(r.venue_id)
    return region == null || region === REGION
  })
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
      `<span class="pk-reel-play">${PLAY_SVG()}</span>` +
      `<span class="pk-reel-title">Watch a real ${esc(short)}</span>`
    a.addEventListener('click', (e) => {
      track('brochure_reel_click', { placement: 'package', package_key: key, ig_code: list[0].ig_code })
      playerClick(e, {
        kind: 'package', key, title: name,
        price: card.querySelector('.pr-from b')?.textContent.trim() || '',
        note: `A real ${short} setup. Everything in ${list.length > 1 ? 'these reels' : 'this reel'} is part of the package.`,
        bookText: `Book ${name}`, bookHref: siteLink(key),
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
    a.innerHTML = `<span class="pk-reel-play">${PLAY_SVG()}</span><span>Watch</span>`
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

// The Setting's list needs no fetch — it's the shared module /packages uses.
function fillSettingInclusions() {
  const card = document.querySelector('[data-pkg="setting"]')
  if (card) setIncl(card, SHARED_SETUP_LABELS)
}

document.addEventListener('click', onPageClick)
if (REGION) {
  markCurrentCity()
  syncSearchCity()
  renderCtas()
  applySearchOccasion()
  fillSettingInclusions()
  trackInspiredLinks()
  setupSticky()
}
track('brochure_viewed', { region: REGION || 'chooser', referrer: document.referrer || null })
fillLive().catch(err => console.warn('[brochure] live prices unavailable, showing build-time prices', err))
