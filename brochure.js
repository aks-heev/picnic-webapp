// brochure.js — unlisted /brochure page (the web version of the packages PDF).
//
// Copy and photos are static in brochure.html (photos ship from /public, so no
// Supabase Storage egress). Prices are filled LIVE so this page can never quote
// something the booking flow doesn't charge:
//   - package "from" price = lowest ACTIVE venue_packages.price for that package
//     (the same rows compute_booking_total prices from)
//   - add-ons menu = active add_ons rows
// If the fetch fails, the static prices already in the HTML stay on screen.
import { createClient } from '@supabase/supabase-js'
import { track } from './analytics.js'

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

function renderCtas() {
  document.querySelectorAll('[data-cta]').forEach(slot => {
    const card = slot.closest('[data-pkg]')
    const name = card?.querySelector('h3')?.textContent.trim() || ''
    slot.innerHTML = `<p class="pk-cta-label">Book on WhatsApp</p>` + Object.keys(WA).map(city =>
      `<a class="pk-btn" href="${waLink(city, name)}" target="_blank" rel="noopener noreferrer" data-city="${city}">${city}</a>`
    ).join('')
    slot.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-city]')
      if (!a) return
      track('brochure_whatsapp_click', { package_key: card?.dataset.pkg || null, city: a.dataset.city })
    })
  })
}

async function fillLivePrices() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return
  const supabase = createClient(url, key)
  const [pkgRes, vpRes, addRes] = await Promise.all([
    supabase.from('packages').select('id, key, is_active').eq('is_active', true),
    supabase.from('venue_packages').select('package_id, price').eq('is_active', true),
    supabase.from('add_ons').select('name, price').eq('is_active', true)
      .order('price', { ascending: true }).order('sort_order', { ascending: true }),
  ])

  if (!pkgRes.error && !vpRes.error) {
    const idByKey = new Map((pkgRes.data || []).map(p => [p.key, p.id]))
    const minById = new Map()
    for (const r of vpRes.data || []) {
      const p = Number(r.price)
      if (!(p > 0)) continue
      if (!minById.has(r.package_id) || p < minById.get(r.package_id)) minById.set(r.package_id, p)
    }
    document.querySelectorAll('[data-pkg]').forEach(card => {
      const id = idByKey.get(card.dataset.pkg)
      // Package switched off in admin → don't advertise it here either. Only
      // trusted when the query returned rows; an empty result keeps the page.
      if (id === undefined) { if (idByKey.size) card.hidden = true; return }
      const min = minById.get(id)
      if (min) card.querySelector('[data-price]').textContent = inr(min)
    })
  }

  if (!addRes.error && (addRes.data || []).length) {
    document.querySelector('[data-addons]').innerHTML = addRes.data
      .map(a => `<li><span>${esc(ADDON_LABEL[a.name] || a.name)}</span><b>${inr(a.price)}</b></li>`)
      .join('')
  }
}

renderCtas()
track('brochure_viewed', { referrer: document.referrer || null })
fillLivePrices().catch(err => console.warn('[brochure] live prices unavailable, showing defaults', err))
