// brochure.js — unlisted /brochure page (the web version of the packages PDF).
//
// Copy and photos are static in brochure.html (photos ship from /public, so no
// Supabase Storage egress). Prices and inclusions are filled LIVE so this page
// can never quote something the booking flow doesn't charge or /packages
// doesn't say:
//   - package "from" price = lowest ACTIVE venue_packages.price for that package
//     (the same rows compute_booking_total prices from)
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

// Website booking link. With a package: /packages?tier=<key>&step=venue opens
// the site's packages-first flow with that package chosen, scrolled to the
// venue picker (app.js showPackagesPage). Without one: the packages page.
function siteLink(pkgKey) {
  const p = new URLSearchParams()
  if (pkgKey) { p.set('tier', pkgKey); p.set('step', 'venue') }
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
      else if (a.dataset.city) track('brochure_whatsapp_click', { package_key: key, city: a.dataset.city })
    })
  })
}

async function fillLivePrices() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return
  const supabase = createClient(url, key)
  const [pkgRes, vpRes, addRes] = await Promise.all([
    supabase.from('packages').select('id, key, is_active, inclusions, package_add_ons(addon_id, sort_order)').eq('is_active', true),
    supabase.from('venue_packages').select('package_id, price').eq('is_active', true),
    // category 'setup' = stay-only celebration setups (named like packages,
    // e.g. "The Prelude ₹4,300") — not layerable add-ons, so never on this menu.
    supabase.from('add_ons').select('id, name, price, category').eq('is_active', true).neq('category', 'setup')
      .order('price', { ascending: true }).order('sort_order', { ascending: true }),
  ])

  if (!pkgRes.error && !addRes.error) fillInclusions(pkgRes.data || [], addRes.data || [])

  if (!pkgRes.error && !vpRes.error) {
    const idByKey = new Map((pkgRes.data || []).map(p => [p.key, p.id]))
    const minById = new Map()
    for (const r of vpRes.data || []) {
      const p = Number(r.price)
      if (!(p > 0)) continue
      if (!minById.has(r.package_id) || p < minById.get(r.package_id)) minById.set(r.package_id, p)
    }
    const shown = []
    document.querySelectorAll('[data-pkg]').forEach(card => {
      const id = idByKey.get(card.dataset.pkg)
      // Package switched off in admin → don't advertise it here either. Only
      // trusted when the query returned rows; an empty result keeps the page.
      if (id === undefined) { if (idByKey.size) card.hidden = true; return }
      const min = minById.get(id)
      if (min) card.querySelector('[data-price]').textContent = inr(min)
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
track('brochure_viewed', { referrer: document.referrer || null })
fillLivePrices().catch(err => console.warn('[brochure] live prices unavailable, showing defaults', err))
