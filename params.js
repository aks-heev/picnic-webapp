// params.js — the search fields a guest fills on the homepage hero
// (occasion, city, date, guests), carried across
//   /  →  /brochure  →  /packages?tier=…  →  /venues/<slug>
// One parser shared by app.js and brochure.js so no two pages can disagree on
// what a valid value is. Every field is optional; a bad value is DROPPED
// silently (never an error shown to the guest) and the page behaves as if the
// field was not sent. Added 2026-10-29 (homepage hero search, plan P0).

// Canonical occasion list — single source for the /packages page chips, the
// venue guest-step select, the admin edit modal, the homepage hero search and
// /brochure. Occasion matching is string-equality everywhere: do NOT fork it.
// (Moved here from app.js on 2026-10-29 so brochure.js can share it.)
export const OCCASIONS = ['Birthday', 'Anniversary', 'Proposal', 'Date Night', 'Movie Night', 'Bridal Shower', 'Baby Shower', 'Graduation', 'Just Because']

// Which package tier an occasion opens on (/packages, the venue guest step,
// and the "Best for <occasion>" badge on /brochure). Unknown → 'setting'.
export const OCCASION_DEFAULT_TIER = {
  'Proposal': 'story', 'Anniversary': 'story',
  'Birthday': 'moment', 'Bridal Shower': 'moment', 'Baby Shower': 'moment',
  'Date Night': 'setting', 'Movie Night': 'setting',
  'Just Because': 'setting',
}
export function defaultTierForOccasion(occasion) {
  return OCCASION_DEFAULT_TIER[occasion] || 'setting'
}

export const GUESTS_MIN = 1
export const GUESTS_MAX = 30
const DATE_MAX_DAYS_AHEAD = 365

// Today's date in India (YYYY-MM-DD), independent of the device timezone.
export function istToday(now = Date.now()) {
  return new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}

function validDate(s, now) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  const d = new Date(s + 'T00:00:00Z')
  // Reject impossible dates like 2026-02-30 (Date rolls them over).
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return ''
  const today = istToday(now)
  if (s < today) return ''
  const max = new Date(Date.parse(today + 'T00:00:00Z') + DATE_MAX_DAYS_AHEAD * 86400000).toISOString().slice(0, 10)
  return s > max ? '' : s
}

// City is checked for shape only here; each page checks it against the cities
// its live venues actually have (and falls back to "all cities" otherwise).
function validCity(s) {
  if (typeof s !== 'string') return ''
  const t = s.trim()
  return /^[A-Za-z][A-Za-z .'-]{1,39}$/.test(t) ? t : ''
}

function validGuests(s) {
  if (s == null || s === '') return null
  if (!/^\d{1,3}$/.test(String(s).trim())) return null
  const n = Number(s)
  return n >= GUESTS_MIN && n <= GUESTS_MAX ? n : null
}

// Parse and validate. Accepts a query string ("?a=b"), a URLSearchParams, or
// a plain object. Returns { occasion, city, date, guests } with '' / null for
// anything missing or invalid.
export function readSearchParams(input = (typeof location !== 'undefined' ? location.search : ''), now = Date.now()) {
  const get = input instanceof URLSearchParams
    ? (k) => input.get(k)
    : typeof input === 'string'
      ? ((p) => (k) => p.get(k))(new URLSearchParams(input))
      : (k) => (input && input[k] != null ? String(input[k]) : null)
  const occ = get('occasion')
  return {
    occasion: OCCASIONS.includes(occ) ? occ : '',
    city: validCity(get('city')),
    date: validDate(get('date'), now),
    guests: validGuests(get('guests')),
  }
}

// Write the non-empty fields onto a URLSearchParams (mutates and returns it).
export function appendSearchParams(qs, p) {
  if (!p) return qs
  if (p.occasion) qs.set('occasion', p.occasion)
  if (p.city) qs.set('city', p.city)
  if (p.date) qs.set('date', p.date)
  if (p.guests) qs.set('guests', String(p.guests))
  return qs
}

// ── Session memory (2026-10-29) ──────────────────────────────────────────────
// The URL is the primary carrier, but several routes into /packages and the
// venue pages do not carry the fields (homepage package cards, homepage venue
// cards, "Change package", a package picked on the venue page). The last search
// is therefore also kept in sessionStorage for the tab's lifetime, and every
// page fills any field the URL did not supply from it. URL always wins.
const SEARCH_KEY = 'ps_search'

export function saveSearch(p) {
  try {
    const clean = readSearchParams(p || {})
    if (!clean.occasion && !clean.city && !clean.date && !clean.guests) return
    sessionStorage.setItem(SEARCH_KEY, JSON.stringify(clean))
  } catch (err) { /* private mode / storage blocked: URL carrying still works */ }
}

export function loadSearch(now = Date.now()) {
  try {
    const raw = sessionStorage.getItem(SEARCH_KEY)
    // Re-validate on read: a stored date can go stale overnight.
    return raw ? readSearchParams(JSON.parse(raw), now) : readSearchParams({}, now)
  } catch (err) {
    return readSearchParams({}, now)
  }
}

// URL fields first, then the session's last search for anything missing.
// A URL that carries ANY search field is a fresh search and is saved.
export function currentSearch(input = (typeof location !== 'undefined' ? location.search : '')) {
  const fromUrl = readSearchParams(input)
  const hasUrl = !!(fromUrl.occasion || fromUrl.city || fromUrl.date || fromUrl.guests)
  const stored = loadSearch()
  const merged = {
    occasion: fromUrl.occasion || stored.occasion,
    city: fromUrl.city || stored.city,
    date: fromUrl.date || stored.date,
    guests: fromUrl.guests || stored.guests,
  }
  if (hasUrl) saveSearch(merged)
  return merged
}
