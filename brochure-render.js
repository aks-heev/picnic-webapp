// brochure-render.js — pure helpers shared by brochure.js (browser, live data)
// and scripts/prerender-venues.mjs (build: bakes the same HTML into
// dist/brochure/ncr.html and dist/brochure/jaipur.html). No DOM, no imports,
// so both sides render prices from ONE function and can never disagree.
//
// Prices come only from public.brochure_city_prices (migration
// 20261103_brochure_city_prices_view.sql), which mirrors compute_booking_total:
// package_prices when a venue has rows there, else venue_packages.price.
// Plan: docs/PLAN_city_brochures_redesign_2026-11-03.md.

export const REGIONS = {
  ncr: {
    key: 'ncr', slug: 'ncr', name: 'Gurugram & Delhi NCR', team: 'Gurugram',
    wa: '919773703982', waDisplay: '+91 97737 03982',
    hero: '/brochure/hero.webp', tile: '/brochure/ncr-tile.webp',
  },
  jaipur: {
    key: 'jaipur', slug: 'jaipur', name: 'Jaipur', team: 'Jaipur',
    wa: '919266964666', waDisplay: '+91 92669 64666',
    hero: '/brochure/jaipur-hero.webp', tile: '/brochure/jaipur-tile.webp',
  },
}

// Ladder order on the page. A key missing from a region's rows is hidden there.
export const PACKAGE_ORDER = ['the_prelude', 'the_note', 'setting', 'moment', 'story']

// Homepage hero search city → brochure region. Unknown → null (chooser).
export function regionForCity(city) {
  const c = String(city || '').trim().toLowerCase()
  if (!c) return null
  if (c === 'jaipur') return 'jaipur'
  if (['gurugram', 'gurgaon', 'delhi', 'new delhi', 'noida', 'delhi ncr', 'ncr', 'faridabad'].includes(c)) return 'ncr'
  return null
}

export const inr = (n) => '₹' + Math.round(Number(n)).toLocaleString('en-IN')
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const num = (v) => (v == null || v === '' || !(Number(v) > 0) ? null : Number(v))

// "Countryside Offgrid — Picnic only" → "Countryside Offgrid";
// "Padao Restaurant (Nahargarh)" → "Padao Restaurant"; "Om Niwas … — Stay" → "Om Niwas …".
export function venueLabel(name) {
  return String(name || '').replace(/\s+[—–-]\s+.*$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim()
}

// "A" / "A and B" / "A, B and C" / "4 venues"
function joinNames(names) {
  const u = [...new Set(names)]
  if (u.length <= 1) return u[0] || ''
  if (u.length > 3) return `${u.length} venues`
  return u.slice(0, -1).join(', ') + ' and ' + u[u.length - 1]
}

// One line per venue for the brochure. Written from each venue's own
// description (venues.description); a venue not listed here falls back to the
// first sentence of that description, trimmed.
// Todoist: move these into venues.metadata.brochure_blurb so admin can edit them.
const BLURBS = {
  'beige-cafe': 'White Mediterranean-style courtyards and a pool, with the Aravalli hills behind.',
  'countryside-offgrid-picnic': 'Thatched A-frame cottages and open lawns in the Aravalli foothills.',
  'the-sunroom': 'A glasshouse cafe inside Palam Farms, with cabanas and palm-lined paths.',
  'castle-valley': 'Right opposite Amer Fort, with rooftop seating that looks straight at it.',
  'house-of-amer': 'A heritage house in old Amer, near Jagat Shiromani Temple, with courtyards and fort views.',
  'garh-the-rooftop-cafe': 'An open rooftop opposite Amer Palace, looking out over the Aravalli ridges.',
  'satoria-villa': 'A boutique villa in the Amer hills, with an infinity pool and views of Amer and Jaigarh forts.',
  'padao-restaurant-nahargarh': 'On the clifftop at Nahargarh Fort, with the Pink City spread out below.',
}

export function venueBlurb(v) {
  if (BLURBS[v.slug]) return BLURBS[v.slug]
  const d = String(v.description || '').replace(/\s+/g, ' ').trim()
  if (!d) return ''
  const first = d.split(/(?<=[.!?])\s/)[0]
  if (first.length <= 140) return first
  return first.slice(0, 138).replace(/\s+\S*$/, '') + '…'
}

// rows: brochure_city_prices rows (any region). Returns { [package_key]: summary }
// for one region. A package with no row there is absent (its card is hidden).
export function summarizeRegion(rows, region) {
  const byPkg = new Map()
  for (const r of rows || []) {
    if (r.region !== region) continue
    // Only venues whose packages can be booked online (venues.packages_enabled);
    // the /packages venue step hides the rest, so the brochure must too.
    if (r.packages_enabled === false) continue
    const item = {
      venueId: r.venue_id, venue: venueLabel(r.venue_name), slug: r.venue_slug, area: r.venue_area || '',
      nf: num(r.from_no_food), wf: num(r.from_with_food),
      included: r.included_guests ?? null, max: r.max_guests ?? null, name: r.package_name,
    }
    if (item.nf == null && item.wf == null) continue
    if (!byPkg.has(r.package_key)) byPkg.set(r.package_key, [])
    byPkg.get(r.package_key).push(item)
  }
  const out = {}
  for (const [key, list] of byPkg) {
    const headOf = (x) => x.nf ?? x.wf
    list.sort((a, b) => headOf(a) - headOf(b) || a.venue.localeCompare(b.venue))
    const nfs = list.map(x => x.nf).filter(v => v != null)
    const wfs = list.map(x => x.wf).filter(v => v != null)
    const from = nfs.length ? Math.min(...nfs) : null
    const fromFood = wfs.length ? Math.min(...wfs) : null
    const head = from ?? fromFood
    const headIsFood = from == null
    const atVenues = list.filter(x => (headIsFood ? x.wf === head : x.nf === head)).map(x => x.venue)
    const top = list[list.length - 1]
    const included = list.map(x => x.included).filter(v => v != null)
    out[key] = {
      key, name: list[0].name, rows: list, from, fromFood, head, headIsFood, atVenues,
      top: headOf(top), topVenue: top.venue,
      included: included.length ? Math.min(...included) : null,
    }
  }
  return out
}

// Lowest headline price in a region (cover, chooser tile, meta description).
export function regionFrom(summaries) {
  const heads = Object.values(summaries || {}).map(s => s.head).filter(v => v != null)
  return heads.length ? Math.min(...heads) : null
}

const CHEVRON = '<svg class="pr-chev" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"></path></svg>'

// The price block inside a package card. regionName goes in the table caption.
export function priceBlockHtml(s, regionName) {
  if (!s) return '<p class="pr-from">Price on WhatsApp</p>'
  const id = `pr-t-${s.key}`
  let h = `<p class="pr-from">from <b>${inr(s.head)}</b>${s.headIsFood ? ' <span class="pr-tag">food included</span>' : ''}</p>`
  h += `<p class="pr-at">at ${esc(joinNames(s.atVenues))}</p>`
  if (!s.headIsFood && s.fromFood != null) h += `<p class="pr-food">With food from ${inr(s.fromFood)}</p>`
  if (s.rows.length > 1 && s.top > s.head * 1.25) h += `<p class="pr-range">Up to ${inr(s.top)} at ${esc(s.topVenue)}</p>`
  if (s.rows.length > 1) {
    h += `<button type="button" class="pr-toggle" aria-expanded="false" aria-controls="${id}" data-toggle data-pkg-key="${esc(s.key)}">` +
      `<span data-open-label>Compare all ${s.rows.length} venues</span><span data-close-label hidden>Hide venue prices</span>${CHEVRON}</button>`
    h += `<div class="pr-table-wrap" id="${id}" hidden><table class="pr-table">` +
      `<caption class="vh">${esc(s.name)} prices at each venue in ${esc(regionName)}</caption>` +
      `<thead><tr><th scope="col">Venue</th><th scope="col">Without food</th><th scope="col">With food</th></tr></thead><tbody>` +
      s.rows.map(r => `<tr><th scope="row">${esc(r.venue)}${r.area ? `<span>${esc(r.area)}</span>` : ''}</th>` +
        `<td>${r.nf != null ? inr(r.nf) : '<span aria-label="Not offered">—</span>'}</td>` +
        `<td>${r.wf != null ? inr(r.wf) : '<span aria-label="Not offered">—</span>'}</td></tr>`).join('') +
      `</tbody></table></div>`
  }
  return h
}

// "Price covers 4 guests" — the package's included guests (lowest across venues).
export function guestsLine(s) {
  return s && s.included ? `Price covers ${s.included} guests` : ''
}

// "Prices at a glance" rows. names: { key: display name } from the cards.
export function glanceRowsHtml(summaries, names) {
  return PACKAGE_ORDER.filter(k => summaries[k]).map(k => {
    const s = summaries[k]
    const food = s.headIsFood ? inr(s.head) : (s.fromFood != null ? inr(s.fromFood) : '—')
    return `<a class="gl-row" href="#pkg-${esc(k)}">` +
      `<span class="gl-name"><b>${esc(names[k] || s.name)}</b><small>${esc(guestsLine(s))}</small></span>` +
      `<span class="gl-p">${s.headIsFood ? '—' : inr(s.head)}</span><span class="gl-p gl-food">${food}</span></a>`
  }).join('')
}

// Picnic venue cards. venues: rows from public.venues (any region; filtered by
// the summaries, so only venues with a priced package in this region show).
export function venueCardsHtml(venues, summaries) {
  const offered = new Map() // venueId → [{key, nf, wf}]
  for (const s of Object.values(summaries)) {
    for (const r of s.rows) {
      if (!offered.has(r.venueId)) offered.set(r.venueId, [])
      offered.get(r.venueId).push({ key: s.key, name: s.name, nf: r.nf, wf: r.wf })
    }
  }
  const total = Object.keys(summaries).length
  return (venues || []).filter(v => offered.has(v.id)).map(v => {
    const list = offered.get(v.id)
    const nfs = list.map(x => x.nf).filter(x => x != null)
    const wfs = list.map(x => x.wf).filter(x => x != null)
    const price = nfs.length ? `from ${inr(Math.min(...nfs))}` : `${inr(Math.min(...wfs))} · food included`
    const offers = list.length === 1 ? `${list[0].name} only`
      : list.length === total ? `All ${total} packages` : `${list.length} of ${total} packages`
    const where = [v.area, v.city].filter(Boolean).join(', ')
    return `<article class="vn">` +
      `<p class="vn-where">${esc(where)}</p>` +
      `<h3>${esc(venueLabel(v.name))}</h3>` +
      `<p class="vn-desc">${esc(venueBlurb(v))}</p>` +
      `<div class="vn-foot"><span>${esc(offers)}</span><b>${price}</b></div>` +
      (v.slug ? `<a class="vn-link" href="/venues/${esc(v.slug)}">See ${esc(venueLabel(v.name))} <span aria-hidden="true">→</span></a>` : '') +
      `</article>`
  }).join('')
}

const STAY_TYPES = { self_managed: 'Our home', combo: 'Our home, whole floor', partner_bnb: 'Partner stay' }

// Picnic + stay rows (no package prices: stays are quoted on WhatsApp).
export function stayRowsHtml(venues, region) {
  // Keep suffixes that tell stays apart ("— Big Cottage"); drop only "— Stay".
  const stayName = (n) => String(n || '').replace(/\s+[—–-]\s+Stay$/i, '').trim()
  return (venues || []).filter(v => v.region === region && STAY_TYPES[v.type]).map(v =>
    `<li><span><b>${esc(stayName(v.name))}</b><small>${esc([STAY_TYPES[v.type], v.area].filter(Boolean).join(' · '))}</small></span>` +
    (v.slug ? `<a href="/venues/${esc(v.slug)}">See stay</a>` : '') + `</li>`).join('')
}

// WhatsApp deep link to a region's team. pkgName optional.
export function waHref(region, pkgName) {
  const R = REGIONS[region]
  const text = pkgName
    ? `Hi! I'd like to book ${pkgName} in ${R.name}.`
    : `Hi! I'd like to plan a picnic in ${R.name}.`
  return `https://wa.me/${R.wa}?text=${encodeURIComponent(text)}`
}

// Website booking link: /packages?tier=<key>&region=<r> opens the venue step
// for that package, showing only this region's venues (app.js venue step).
// extra: a URLSearchParams of hero-search fields to carry (occasion/date/guests/city).
export function bookHref(region, key, extra) {
  const p = new URLSearchParams()
  p.set('tier', key)
  p.set('region', region)
  if (extra) for (const [k, v] of extra) if (k !== 'tier' && k !== 'region') p.set(k, v)
  p.set('utm_source', 'brochure')
  p.set('utm_medium', 'link')
  return `/packages?${p}`
}

// The two buttons under each package card.
export function packageCtaHtml(region, key, name, extra) {
  return `<a class="btn btn-solid" href="${esc(bookHref(region, key, extra))}" data-site>Book ${esc(name)}</a>` +
    `<a class="btn btn-line" href="${esc(waHref(region, name))}" target="_blank" rel="noopener noreferrer" data-wa>Ask on WhatsApp</a>`
}

// Display names for add-ons whose DB name is admin shorthand. Keyed by name,
// not id (ids are traps here — see CLAUDE.md §6). Unknown names show as-is.
export const ADDON_LABEL = {
  'Photo Printouts(10 Colored Photos)': 'Photo printouts (10 pics)',
  'Bonfire': 'Bonfire (charcoal pit)',
  'Skyshots': 'Skyshots (fireworks)',
}

// Add-ons menu for one region. addOns: active add_ons rows (setup category
// excluded by the caller). venues: rows with venue_add_ons(addon_id).
// An add-on no picnic venue in the region offers is left out; one only some
// offer says so.
export function addonRowsHtml(addOns, venues, summaries) {
  const venueIds = new Set()
  for (const s of Object.values(summaries)) for (const r of s.rows) venueIds.add(r.venueId)
  const here = (venues || []).filter(v => venueIds.has(v.id))
  const known = here.length && here.some(v => Array.isArray(v.venue_add_ons))
  return (addOns || []).map(a => {
    const n = known ? here.filter(v => (v.venue_add_ons || []).some(x => x.addon_id === a.id)).length : here.length
    if (known && n === 0) return ''
    const partial = known && n < here.length
    return `<li><span>${esc(ADDON_LABEL[a.name] || a.name)}${partial ? '<small>Not at every venue</small>' : ''}</span><b>${inr(a.price)}</b></li>`
  }).join('')
}

// Head tags for a city page (build time).
export function cityMeta(region, summaries, venues, site) {
  const R = REGIONS[region]
  const from = regionFrom(summaries)
  const ids = new Set()
  for (const s of Object.values(summaries)) for (const r of s.rows) ids.add(r.venueId)
  const names = (venues || []).filter(v => ids.has(v.id)).map(v => venueLabel(v.name))
  const venueText = names.length > 3 ? `${names.slice(0, 3).join(', ')} and more` : joinNames(names)
  const fromText = from != null ? ` Packages from ${inr(from)}.` : ''
  const url = `${site}/brochure/${R.slug}`
  return {
    url,
    title: `Picnic Packages in ${R.name} | The Picnic Stories`,
    description: `Fully set-up picnics for proposals, birthdays and anniversaries at ${venueText}.${fromText}`.slice(0, 160),
    ogTitle: from != null ? `Picnic packages in ${R.name} — from ${inr(from)}` : `Picnic packages in ${R.name}`,
    ogDescription: `Proposals, birthdays and anniversaries, fully set up at ${venueText}.`,
    ogImage: `${site}${R.hero}`,
  }
}

// OfferCatalog JSON-LD for a city page (moved here from the noindex /packages shell).
export function offerCatalogJsonLd(region, summaries, site) {
  const R = REGIONS[region]
  const url = `${site}/brochure/${R.slug}`
  const items = PACKAGE_ORDER.filter(k => summaries[k]).map((k, i) => ({
    '@type': 'Offer', position: i + 1,
    itemOffered: { '@type': 'Service', name: summaries[k].name, areaServed: R.name },
    priceCurrency: 'INR', price: String(Math.round(summaries[k].head)),
    availability: 'https://schema.org/InStock',
    url: `${site}/packages?tier=${encodeURIComponent(k)}&region=${R.key}`,
  }))
  const ld = [
    { '@context': 'https://schema.org', '@type': 'OfferCatalog', name: `Picnic packages in ${R.name} — The Picnic Stories`, url, itemListElement: items },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: site },
      { '@type': 'ListItem', position: 2, name: `Packages in ${R.name}`, item: url },
    ] },
  ]
  return JSON.stringify(ld).replaceAll('<', '\\u003c')
}
