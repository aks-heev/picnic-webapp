import { createClient } from '@supabase/supabase-js'
import { track, identifyUser } from './analytics.js'
import { injectSpeedInsights } from '@vercel/speed-insights'

// --- perf helpers (2026-07-04): gate auto-advancing carousels so they don't
// burn the main thread / battery when nobody is looking. Function declarations
// (hoisted) so the carousel tickers further down can call them. ---
function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
function elInViewport(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return true
  const r = el.getBoundingClientRect()
  const vh = window.innerHeight || document.documentElement.clientHeight
  const vw = window.innerWidth || document.documentElement.clientWidth
  return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
}
injectSpeedInsights()

// Initialize Supabase client
// Vite exposes VITE_* variables from .env.local via import.meta.env
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    'Supabase environment variables are missing! ' +
    'Create .env.local with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Admin identity — loaded from env so it never touches the client bundle as a literal
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL

// Razorpay publishable key id — safe for the client. The KEY SECRET lives only
// in the create-order / verify-payment edge functions, never in this bundle.
const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID

// WhatsApp fallback for the success-page "Talk to us" CTA — the venue team's
// own number (teams.whatsapp) takes priority when the team is known.
const WHATSAPP_FALLBACK_NUMBER = '919266964666'

// Menu Data with detailed Indian menu items
const foodList = [
  "Plain Omelette","Cheese Burst Omelette","Chicken Omelette","Bread Omelette",
  "Egg Bhurji with Toast","Aloo Paratha","Aloo Pyaz Paratha","Gobi Paratha",
  "Paneer Paratha","Egg Paratha","Chicken Paratha","Garden Fresh Sandwich",
  "Cheese Corn Sandwich","Paneer Tikka Sandwich","Chicken Tikka Sandwich",
  "Plain Maggi","Veg Maggi","Egg & Cheese Maggi","Cheese Maggi","Chicken Maggi",
  "Salted Fries","Peri Peri Fries","Mix Fries","Paneer Pakoda","Bun Maska",
  "Masala Bun","Malai Bun","Anda Bun","Aloo Bun","Keema Bun","Cheesy Crazy",
  "Chicken Chakna","Peanut Masala","Crispy Corn","Loaded Nachos","Chicken Nuggets",
  "Chicken Strips","Chicken Popcorn","Veg Hakka Noodles","Chilli Garlic Noodles",
  "Egg Noodles","Chicken Noodles","Veg Fried Rice","Egg Fried Rice",
  "Chicken Fried Rice","Honey Chilli Potato","Chilli Mushroom","Chilli Paneer",
  "Veg Manchurian","Chilli Chicken","Crispy Chicken","Chicken Manchurian",
  "Paneer Tikka","Paneer Malai Tikka","Mushroom Tikka","Dahi Kebab",
  "Hara Bhara Kebab","Tandoori Chicken","Chicken Tikka","Chicken Malai Tikka",
  "Chicken Seekh Kebab","Paneer Butter Masala","Kadhai Paneer","Dal Makhni",
  "Dal Tadka","Mix Veg","Butter Chicken","Kadhai Chicken","Chicken Curry",
  "Roti","Naan","Garlic Naan","Steamed Rice","Jeera Rice"
]

const bevList = [
  "Ginger Tea","Black Tea","Masala Tea","Elaichi Tea","Green Tea","Lemon Ginger Tea",
  "Hot Coffee","Americano","Cold Coffee","Ice Tea","Virgin Mojito","Fresh Lime",
  "Lemonade","Blue Lagoon","Watermelon Mojito","Watermelon Lemonade",
  "Oreo Shake","KitKat Shake","Chocolate Shake","Sweet Lassi","Salty Lassi",
  "Mineral Water","Soda","Mixers"
]

// App state and helpers
const appState = {
  // isAdminLoggedIn is now derived from the Supabase session, not a mutable flag.
  // Use appState.session !== null to check auth status.
  session: null,
  currentBooking: null,
  currentMenuLink: null,
  currentOrder: null,
  selectedItems: {},
  currentVenue: null,        // set when customer picks a venue before booking
  currentVenueAddOns: [],    // add-ons loaded for the current venue
  venues: [],                // cached venue list
  teams: [],                 // cached teams list (Jaipur, Gurugram, …)
  selectedDate: null,        // cafe: selected date
  selectedTimeSlot: null,    // cafe: selected time slot
  checkinDate: null,         // bnb: check-in date
  checkoutDate: null,        // bnb: checkout date
  adults: 2,                 // guest selector: adult count
  children: 0,               // guest selector: child count (under 10, free — no price/inclusion impact)
  bookingStep: 'calendar',   // 'calendar' | 'guests' | 'package' | 'booking'
  bookingOccasion: '',       // packages: occasion captured at the guest step
  selectedPackage: null,     // packages: { occasion, tierKey, addonIds } once a tier is chosen
  pendingPackage: null,      // packages-first (/packages page): { occasion, tierKey, venueId } handoff,
                             // consumed after the guest step via selectPackageTier() — see docs/PHASE2_PACKAGES_FIRST_PLAN.md
  venueCatalogCache: null,   // Map<venueId, addon[]> — batched catalogs loaded by loadCatalogsForVenues()
}

// Packages (Phase 1). Real production toggle is per-venue: venues.packages_enabled
// (admin-editable, cafe venues only — see the "Packages" field in the venue
// admin form). ?packages=1|0 is a per-session QA override on top of that —
// lets you preview a venue's tiers before flipping it live, or force-hide it
// on a live venue to compare. Returns null when no override is active, so the
// venue's real DB field decides.
function packagesOverride() {
  try {
    const u = new URLSearchParams(location.search).get('packages')
    if (u === '1') { localStorage.setItem('ps_packages', '1'); return true }
    if (u === '0') { localStorage.setItem('ps_packages', '0'); return false }
    const s = localStorage.getItem('ps_packages')
    if (s === '1') return true
    if (s === '0') return false
  } catch (e) { /* localStorage blocked — no override */ }
  return null
}

// True for the whole cafe + packages flow (calendar → guests → tiers). The
// sidebar's running "starting price" is hidden across all of it — the real
// price only settles once a tier is chosen, and the booking form has its own
// price breakdown, so nothing needs it restored downstream.
function packageFlowActive(venue) {
  if (venue?.type !== 'cafe') return false
  const override = packagesOverride()
  if (override !== null) return override
  return !!venue.packages_enabled
}

// Admin team filter state — persists across loadQueries/loadBookings calls
let loadedQueries  = []
let loadedBookings = []
let adminTeamFilter = null   // null = all | 'jaipur' | 'gurugram'

// Helper: format a Date object as a local YYYY-MM-DD string (avoids UTC offset shift from toISOString)
function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Helper: escape HTML entities to prevent XSS when injecting into innerHTML
function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Helper: human-readable venue type label
function formatVenueType(type) {
  const labels = {
    self_managed: 'Our Venue',
    cafe:         'Café',
    partner_bnb:  'Partner Airbnb',
    custom:       'Your Own Space',
    combo:        'Whole Floor',
  }
  return labels[type] || type
}

// Helper: relative time string ("2h ago", "just now", etc.)
function formatTimeAgo(date) {
  const secs = Math.floor((Date.now() - date) / 1000)
  if (secs < 60)  return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// Helper: get CSS class for venue type badge
function venueTypeBadgeClass(type) {
  const classes = {
    self_managed: 'badge--self',
    cafe:         'badge--cafe',
    partner_bnb:  'badge--partner',
    custom:       'badge--custom',
    combo:        'badge--combo',
  }
  return classes[type] || ''
}

// Fetch add-ons mapped to a specific venue via the venue_add_ons junction.
// Availability is per-venue (not per-type); presence of a junction row = shown.
async function loadVenueAddOns(venueId) {
  try {
    const { data, error } = await supabase
      .from('add_ons')
      .select('*, venue_add_ons!inner(venue_id)')
      .eq('is_active', true)
      .eq('venue_add_ons.venue_id', venueId)
      .order('sort_order')
    if (error) throw error
    // Strip the embedded junction key so add-on objects stay clean downstream.
    return (data || []).map(({ venue_add_ons, ...addon }) => addon)
  } catch (err) {
    console.error('Failed to load add-ons:', err)
    return []
  }
}

// Helper: format currency in INR
function formatPrice(amount) {
  if (amount == null) return null
  return '₹' + Number(amount).toLocaleString('en-IN')
}

// Picnic price keys off adults only. Children (under 10) are free — they do
// not affect price, inclusions, or capacity.
function getPicnicPrice(venue, adults) {
  return getVenuePrice(venue, adults)
}

// Included food & drink counts for a booking, scaled to adults only.
// food   = ceil(adults × food_multiplier)
// drinks = ceil(adults × drink_multiplier)
// Returns null when the venue has no multipliers (non-cafe venues show nothing).
function getInclusions(venue, adults) {
  const m = venue?.metadata
  if (m?.food_offline) return null
  const foodMult  = Number(m?.food_multiplier)
  const drinkMult = Number(m?.drink_multiplier)
  if (!foodMult && !drinkMult) return null
  const a = Math.max(0, Number(adults) || 0)
  return {
    food:   Math.ceil(a * (foodMult  || 0)),
    drinks: Math.ceil(a * (drinkMult || 0)),
  }
}

// HTML for the "what's included" banner shown in the guest selector & booking
// view. Empty string for venues with no inclusions. Counts scale with adults;
// children are free and order à la carte, so the note makes that explicit.
function inclusionBannerHtml(venue, adults) {
  const inc = getInclusions(venue, adults)
  if (!inc) return ''
  const foodTxt  = `${inc.food} food item${inc.food !== 1 ? 's' : ''}`
  const drinkTxt = `${inc.drinks} beverage${inc.drinks !== 1 ? 's' : ''}`
  return `
    <span class="vd-inclusion-title">✨ Included in your price</span>
    <span class="vd-inclusion-items">${foodTxt} &nbsp;·&nbsp; ${drinkTxt}</span>
    <span class="vd-inclusion-note">Based on the number of adults. Children are welcome — order anything extra à la carte.</span>`
}

// Price for a venue given billing guest count.
//
// Two models, in priority order:
//  1. venue.free_guests_upto set → flat base_price through that many guests,
//     then base_price + overage_per_person × (guests − free_guests_upto).
//     This is the admin-editable model (venue form: base price, free guests
//     up to, overage per person). Populated only for venues whose legacy
//     tiers array already reduced to this losslessly — verified against
//     every active venue's historical price grid before migrating (see
//     migration add_pricing_columns_and_packages_tables).
//  2. Legacy fallback: venue.metadata.tiers as [{up_to, price}, ...] sorted
//     ascending, overage beyond the last tier. Still authoritative for
//     venues with genuine multi-step guest pricing (partner_bnb stays —
//     Countryside Offgrid, House of Amer, Om Niwas Stay) that a single
//     flat+linear model can't represent without changing their real prices.
//     Falls back to plain base_price if no tiers defined either.
function getVenuePrice(venue, billingGuests) {
  const base = Number(venue?.base_price) || 0

  if (venue?.free_guests_upto != null) {
    const overage = Number(venue.overage_per_person) || 0
    return billingGuests <= venue.free_guests_upto
      ? base
      : base + overage * (billingGuests - venue.free_guests_upto)
  }

  const m = venue?.metadata
  if (!m || !Array.isArray(m.tiers) || m.tiers.length === 0) {
    return base
  }
  const tiers = m.tiers
  const match = tiers.find(t => billingGuests <= t.up_to)
  if (match) return match.price
  const last = tiers[tiers.length - 1]
  const overage = billingGuests - last.up_to
  return last.price + overage * (Number(m.overage_per_person) || 0)
}

// Helper: show toast notification
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container')
  if (!container) return
  
  const toast = document.createElement('div')
  toast.className = `toast show ${type === 'success' ? 'success' : 'error'}`
  toast.textContent = message
  container.appendChild(toast)
  
  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => container.removeChild(toast), 300)
  }, 3000)
}

// Helper: show/hide modal
function showModal(modalId) {
  const modal = document.getElementById(modalId)
  if (modal) {
    modal.classList.remove('hidden')
  }
}

function hideModal(modalId) {
  const modal = document.getElementById(modalId)
  if (modal) {
    modal.classList.add('hidden')
  }
}

// Helper: show/hide pages
function showPage(pageId) {
  // Prerendered slim-shell pages (/venues/<slug>, /packages) ship an EMPTY
  // #home-page (duplicate-content SEO fix in scripts/prerender-venues.mjs) —
  // "going home" there must be a real navigation, not a class flip to an
  // empty div. Flag is only ever set by the prerender output, so the live
  // homepage and dev server are unaffected.
  if (pageId === 'home-page' && window.__PR_SLIM__) {
    window.location.href = '/'
    return
  }
  // Hide all pages
  const allPages = document.querySelectorAll('.page')
  allPages.forEach(page => page.classList.remove('active'))

  // Show target page
  const targetPage = document.getElementById(pageId)
  if (targetPage) {
    targetPage.classList.add('active')
  }

  // Update navigation active state
  const allNavLinks = document.querySelectorAll('.nav-link')
  allNavLinks.forEach(link => link.classList.remove('active'))

  const activeNavLink = document.querySelector(`[data-route="${pageId.replace('-page', '')}"]`)
  if (activeNavLink) {
    activeNavLink.classList.add('active')
  }

  // Navbar: solid on non-home pages, transparent on home (scroll handler manages it there)
  updateNavbarState(pageId)
  window.scrollTo(0, 0)
}


// Initialize menu preview with tabs functionality
function initializeMenuPreview() {
  const foodsGrid = document.getElementById('food-preview-grid')
  const beveragesGrid = document.getElementById('beverage-preview-grid')
  
  if (foodsGrid) {
    foodsGrid.innerHTML = foodList.map(item => `
      <div class="menu-item-preview">
        <h4>${item}</h4>
        <p>Deliciously prepared</p>
      </div>
    `).join('')
  }
  
  if (beveragesGrid) {
    beveragesGrid.innerHTML = bevList.map(item => `
      <div class="menu-item-preview">
        <h4>${item}</h4>
        <p>Refreshing drink</p>
      </div>
    `).join('')
  }
}

// Handle menu preview tabs
function handleMenuPreviewTabs() {
  document.querySelectorAll('.menu-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      
      // Update button states
      document.querySelectorAll('.menu-tab-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      
      // Show/hide content
      document.querySelectorAll('.menu-tab-content').forEach(content => {
        content.style.display = 'none'
      })
      document.getElementById(`${tab}-preview`).style.display = 'block'
    })
  })
}

// Handle menu selection tabs
function handleMenuSelectionTabs() {
  document.querySelectorAll('.selection-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      
      // Update button states
      document.querySelectorAll('.selection-tab-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      
      // Show/hide content
      document.querySelectorAll('#menu-selection-page .menu-tab-content').forEach(content => {
        content.style.display = 'none'
      })
      document.getElementById(tab).style.display = 'block'
    })
  })
}

// Update tab counters
function updateTabCounters() {
  const foodCount = Object.values(appState.selectedItems).filter(item => item.category === 'food').reduce((sum, item) => sum + item.quantity, 0)
  const bevCount = Object.values(appState.selectedItems).filter(item => item.category === 'bev').reduce((sum, item) => sum + item.quantity, 0)
  
  const foodCountEl = document.getElementById('selection-food-count')
  const bevCountEl = document.getElementById('selection-bev-count')
  
  if (foodCountEl) foodCountEl.textContent = foodCount
  if (bevCountEl) bevCountEl.textContent = bevCount
}

// ----------------------------------------------------------------
// VENUE GALLERY + DETAIL
// ----------------------------------------------------------------

// Meta Pixel — ViewContent: observe venue cards entering viewport (fires once per card)
function setupVenueCardViewContentObserver() {
  if (typeof fbq !== 'function' || typeof IntersectionObserver === 'undefined') return
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return
      const el = entry.target
      fbq('track', 'ViewContent', {
        content_ids:  [el.dataset.venueId],
        content_name: el.dataset.venueName || '',
        content_type: 'venue',
      })
      observer.unobserve(el)
    })
  }, { threshold: 0.5 })
  document.querySelectorAll('.venue-card').forEach(card => observer.observe(card))
}

// Load all active venues from Supabase and render the gallery
async function loadVenues() {
  try {
    const { data, error } = await supabase
      .from('venues')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })

    if (error) throw error
    appState.venues = data || []
    renderVenueGallery(data || [])
    renderCityPills(data || [])
    setupVenueCardViewContentObserver()
    revealPackagesEntryPoints()
  } catch (error) {
    console.error('Failed to load venues:', error)
    const grid = document.getElementById('venues-grid')
    if (grid) grid.innerHTML = '<p class="venues-error">Unable to load venues. Please refresh the page.</p>'
  }
}

// ── Teams ─────────────────────────────────────────────────────
async function loadTeams() {
  try {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .order('id', { ascending: true })
    if (error) throw error
    appState.teams = data || []
    renderFooterTeams(data || [])
  } catch (err) {
    console.error('Failed to load teams:', err)
  }
}

function renderFooterTeams(teams) {
  const container = document.getElementById('footer-teams')
  if (!container) return
  if (!teams.length) return
  container.innerHTML = teams.map(t => `
    <div class="footer-team-card">
      <span class="footer-team-name">${escapeHtml(t.name)}</span>
      <div class="footer-team-contacts">
        <a href="tel:${escapeHtml(t.phone || '')}" class="footer-link footer-team-phone">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.5a19.79 19.79 0 01-3.04-8.84A2 2 0 012.18 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.09a16 16 0 006 6l.94-.94a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/></svg>
          ${escapeHtml(t.phone || '')}
        </a>
        <a href="https://wa.me/${escapeHtml(t.whatsapp || '')}" target="_blank" rel="noopener noreferrer" class="footer-link footer-team-wa">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          WhatsApp
        </a>
      </div>
    </div>
  `).join('')
}

function renderCityPills(venues) {
  const filter = document.querySelector('.city-filter')
  if (!filter) return
  const cities = [...new Set(venues.map(v => v.city).filter(Boolean))].sort()
  // Remove any previously rendered city pills (keep only All)
  filter.querySelectorAll('.city-pill:not([data-city="all"])').forEach(p => p.remove())
  cities.forEach(city => {
    const btn = document.createElement('button')
    btn.className = 'city-pill'
    btn.dataset.city = city
    btn.textContent = '📍 ' + city
    btn.setAttribute('onclick', `filterVenuesByCity('${city}', this)`)
    filter.appendChild(btn)
  })
}

window.filterVenuesByCity = function(city, btn) {
  // Update active pill
  document.querySelectorAll('.city-pill').forEach(p => p.classList.remove('active'))
  btn.classList.add('active')
  // Filter and re-render
  const venues = city === 'all'
    ? appState.venues
    : appState.venues.filter(v => v.city === city)
  renderVenueGallery(venues)
}

// Category fallback emojis for when no image_url is set
const ADDON_CAT_EMOJI = {
  photography:   '📷',
  decor:         '🌸',
  food:          '🍰',
  entertainment: '🎉',
  extension:     '⏱',
}

async function renderAddonsStrip() {
  const strip = document.getElementById('addons-strip')
  if (!strip) return

  try {
    const { data, error } = await supabase
      .from('add_ons')
      .select('id, name, description, category, image_url, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error) throw error

    const addons = data || []
    if (!addons.length) return

    const cardHtml = (a) => `
      <div class="addon-strip-card">
        <div class="addon-strip-visual">
          ${a.image_url
            ? `<img src="${escapeHtml(a.image_url)}" alt="${escapeHtml(a.name)}" class="addon-strip-img" loading="lazy">`
            : `<span class="addon-strip-emoji">${ADDON_CAT_EMOJI[a.category] || '✨'}</span>`}
        </div>
        <div class="addon-strip-info">
          <span class="addon-strip-name">${escapeHtml(a.name)}</span>
          ${a.description ? `<span class="addon-strip-desc">${escapeHtml(a.description)}</span>` : ''}
        </div>
      </div>`

    // Duplicate cards so the seamless -50% marquee loop works
    const row1 = addons.map(cardHtml).join('')
    const row2 = [...addons].reverse().map(cardHtml).join('')

    strip.innerHTML = `
      <div class="addons-marquee-row">
        <div class="addons-marquee-track">${row1}${row1}</div>
      </div>
      <div class="addons-marquee-row addons-marquee-row--reverse">
        <div class="addons-marquee-track addons-marquee-track--rtl">${row2}${row2}</div>
      </div>`
  } catch (err) {
    console.error('Failed to load add-ons strip:', err)
  }
}

// Map a venue to its physical setting for home-gallery grouping.
// Prefers the explicit `setting` column; falls back to `type` so the grid
// still groups correctly if a row hasn't been classified yet. This is the
// ONE place the type→setting assumption lives — if it ever stops holding,
// fix it here (or rely on the `setting` column) rather than in render code.
function venueSetting(venue) {
  if (venue.setting === 'indoor' || venue.setting === 'outdoor') return venue.setting
  if (venue.type === 'cafe')   return 'outdoor'
  if (venue.type === 'custom') return null
  return 'indoor'
}

// Build a single venue card (non-custom)
// opts.priceHtml (trusted, pre-escaped) overrides the default base-price line —
// the /packages venue picker uses it to show the chosen tier's firm price.
function venueCardHtml(venue, opts = {}) {
  const capacityText = venue.capacity_max
    ? `${venue.capacity_min}–${venue.capacity_max} guests`
    : `${venue.capacity_min}+ guests`
  const priceText = opts.priceHtml || (venue.base_price ? `From ${formatPrice(venue.base_price)}` : 'Get a quote')
  // Only cafe venues get the tier-card packages flow, and only while the
  // flag is on — showing this badge for anything else would point people at
  // a flow they'll never reach. See packageFlowActive().
  const showPkgBadge = packageFlowActive(venue)

  return `
    <a class="venue-card" href="/venues/${escapeHtml(venue.slug || '')}"
       data-venue-id="${venue.id}" data-venue-name="${escapeHtml(venue.name)}"
       aria-label="View ${escapeHtml(venue.name)}">
      <div class="venue-card-image">
        ${venueCardMediaHtml(venue.images, venue.name)}
        <span class="venue-type-badge ${venueTypeBadgeClass(venue.type)}">${escapeHtml(formatVenueType(venue.type))}</span>
        ${showPkgBadge ? '<span class="venue-card-pkg-badge">🧺 Packages available</span>' : ''}
      </div>
      <div class="venue-card-body">
        <h3 class="venue-card-name">${escapeHtml(venue.name)}</h3>
        <p class="venue-card-area">${escapeHtml(venue.area ? `${venue.area} · ${venue.city}` : venue.city)}</p>
        <div class="venue-card-footer">
          <span class="venue-card-capacity">${capacityText}</span>
          <div class="venue-card-price-group">
            <span class="venue-card-price">${priceText}</span>
            ${venue.requires_confirmation ? '<span class="venue-card-on-request">On Request</span>' : ''}
          </div>
        </div>
      </div>
    </a>
  `
}

// Image carousel for the top of a .venue-card (venues.images, same
// [{url,alt,name}] shape as packages.images). Zero images → the existing
// text placeholder, unchanged. A single image renders as a static photo, no
// controls. Multiple images get dots + arrows AND auto-advance — deliberately
// different from the .pkg-card-media carousel's manual-only nav (that was
// the user's explicit call for package tiers; venue cards are photo-forward
// browsing, not a decision list, so auto-scroll reads better here). Shared
// across every venueCardHtml call site (home gallery, /packages venue
// picker, venue-first tier step) so none of them can drift from the others —
// same reasoning as pkgCardMediaHtml.
function venueCardMediaHtml(images, name) {
  const imgs = (images || []).filter(img => img?.url)
  if (!imgs.length) return `<div class="venue-card-placeholder"><span>${escapeHtml(name)}</span></div>`
  const slides = imgs.map(img =>
    `<img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || name || '')}" loading="lazy">`
  ).join('')
  const controls = imgs.length > 1 ? `
      <button type="button" class="venue-card-media-arrow venue-card-media-arrow--prev" aria-label="Previous photo">&lsaquo;</button>
      <button type="button" class="venue-card-media-arrow venue-card-media-arrow--next" aria-label="Next photo">&rsaquo;</button>
      <div class="venue-card-media-dots">
        ${imgs.map((_, i) => `<button type="button" class="venue-card-media-dot${i === 0 ? ' venue-card-media-dot--active' : ''}" data-index="${i}" aria-label="Photo ${i + 1}"></button>`).join('')}
      </div>` : ''
  return `
    <div class="venue-card-media" data-index="0">
      <div class="venue-card-media-track">${slides}</div>
      ${controls}
    </div>`
}

function venueCarouselGoTo(mediaEl, index) {
  const track = mediaEl.querySelector('.venue-card-media-track')
  const total = track?.children.length || 0
  if (!track || !total) return
  const clamped = Math.max(0, Math.min(index, total - 1))
  mediaEl.dataset.index = String(clamped)
  track.style.transform = `translateX(-${clamped * 100}%)`
  mediaEl.querySelectorAll('.venue-card-media-dot').forEach((dot, i) => {
    dot.classList.toggle('venue-card-media-dot--active', i === clamped)
  })
}

function venueCarouselNav(mediaEl, delta) {
  const current = parseInt(mediaEl.dataset.index || '0', 10)
  const total = mediaEl.querySelector('.venue-card-media-track')?.children.length || 1
  venueCarouselGoTo(mediaEl, (current + delta + total) % total)
}

// Registered once at bootstrap. The whole card is an <a> (unlike .pkg-card,
// which isn't a link), so every control click MUST stopPropagation/preventDefault
// or a tap on a dot/arrow would navigate to the venue page instead of just
// changing the photo.
function setupVenueCarouselDelegation() {
  document.addEventListener('click', e => {
    const control = e.target.closest('.venue-card-media-arrow, .venue-card-media-dot')
    if (!control) return
    const mediaEl = control.closest('.venue-card-media')
    if (!mediaEl) return
    e.preventDefault()
    e.stopPropagation()
    if (control.classList.contains('venue-card-media-dot')) {
      venueCarouselGoTo(mediaEl, parseInt(control.dataset.index, 10))
    } else {
      venueCarouselNav(mediaEl, control.classList.contains('venue-card-media-arrow--prev') ? -1 : 1)
    }
  })

  let touchStartX = null
  let touchMediaEl = null
  document.addEventListener('touchstart', e => {
    touchMediaEl = e.target.closest('.venue-card-media')
    touchStartX = touchMediaEl ? e.touches[0].clientX : null
  }, { passive: true })
  document.addEventListener('touchend', e => {
    if (!touchMediaEl || touchStartX === null) return
    const dx = e.changedTouches[0].clientX - touchStartX
    if (Math.abs(dx) > 40) {
      // A real swipe was a deliberate photo-browse gesture, not a tap-through
      // to the venue page — stop it from also firing the <a>'s navigation.
      e.preventDefault()
      venueCarouselNav(touchMediaEl, dx < 0 ? 1 : -1)
    }
    touchMediaEl = null
    touchStartX = null
  })

  // Auto-advance every multi-photo venue card currently in the DOM. Re-queries
  // each tick (no per-card timers) so it survives cards being torn down/rebuilt
  // on re-render (city filter, occasion gate, etc.). Skips single-photo cards
  // and anything currently hovered, so a deliberate look isn't yanked forward.
  setInterval(() => {
    if (document.hidden || prefersReducedMotion()) return
    document.querySelectorAll('.venue-card-media').forEach(mediaEl => {
      const total = mediaEl.querySelector('.venue-card-media-track')?.children.length || 0
      if (total < 2) return
      if (typeof mediaEl.matches === 'function' && mediaEl.matches(':hover')) return
      if (!elInViewport(mediaEl)) return
      const current = parseInt(mediaEl.dataset.index || '0', 10)
      venueCarouselGoTo(mediaEl, (current + 1) % total)
    })
  }, 4500)
}

// Render the venue gallery, grouped into Outdoor / Indoor sections, with a
// standalone CTA for the location-flexible "custom" venue. Works on any
// subset of venues (e.g. the city filter passes a filtered list); empty
// sections are suppressed so a header never sits above a blank row.
function renderVenueGallery(venues) {
  const grid = document.getElementById('venues-grid')
  if (!grid) return

  const emptyMsg = '<p class="venues-empty">No spaces open just now. We add venues often — check back soon.</p>'

  if (!venues || venues.length === 0) {
    grid.innerHTML = emptyMsg
    return
  }

  const outdoor     = venues.filter(v => v.type !== 'custom' && venueSetting(v) === 'outdoor')
  const indoor      = venues.filter(v => v.type !== 'custom' && venueSetting(v) === 'indoor')
  const customVenue = venues.find(v => v.type === 'custom')

  const section = (title, sub, modifier, list) => list.length === 0 ? '' : `
    <section class="venue-section" id="${modifier}-venues">
      <div class="venue-section-head">
        <span class="venue-section-dot venue-section-dot--${modifier}" aria-hidden="true"></span>
        <h3 class="venue-section-title">${title}</h3>
      </div>
      <p class="venue-section-sub">${sub}</p>
      <div class="venue-grid">${list.map(venueCardHtml).join('')}</div>
    </section>
  `

  const customCta = !customVenue ? '' : `
    <div class="venue-custom-cta" role="button" tabindex="0"
         data-venue-id="${customVenue.id}" aria-label="Plan a custom picnic at a location of your choice">
      <div class="venue-custom-cta-text">
        <p class="venue-custom-cta-title">Have your own spot in mind?</p>
        <p class="venue-custom-cta-sub">A backyard, rooftop, or a place that means something — we'll bring the picnic to you.</p>
      </div>
      <span class="venue-custom-cta-btn">Plan a custom picnic</span>
    </div>
  `

  const html =
    section('Outdoor', 'Open-air settings, under the sky', 'outdoor', outdoor) +
    section('Indoor', 'Cosy, weatherproof spaces for any season', 'indoor', indoor) +
    customCta

  grid.innerHTML = html || emptyMsg
}

// Navigate to venue detail page and render it
async function showVenuePage(venueId, pushState = true) {
  const venue = appState.venues.find(v => v.id === venueId)
  if (!venue) {
    showToast('Venue not found', 'error')
    return
  }

  // Custom type: open the custom picnic enquiry modal instead of the booking form
  if (venue.type === 'custom') {
    openCustomPicnicModal()
    return
  }

  document.title = `${venue.name} — The Picnic Stories`
  if (pushState) {
    history.pushState({ venueId }, document.title, `/venues/${venue.slug || venueId}`)
  }

  // Reset all calendar + guest state when navigating to a new venue
  appState.selectedDate     = null
  appState.selectedTimeSlot = null
  appState.checkinDate      = null
  appState.checkoutDate     = null
  appState.adults           = 2
  appState.children         = 0
  appState.bookingStep      = 'calendar'
  // Packages-first handoff: a pending tier survives navigation to ITS venue
  // only — an organic visit to any other venue clears it (+ its session mirror).
  if (appState.pendingPackage && appState.pendingPackage.venueId !== venueId) {
    appState.pendingPackage = null
    try { sessionStorage.removeItem('ps_pending_pkg') } catch (err) { /* ignore */ }
  }
  appState.bookingOccasion  = appState.pendingPackage?.occasion || ''
  appState.selectedPackage  = null

  const needsCalendar = true
  const [addOns, bookedData] = await Promise.all([
    loadVenueAddOns(venue.id),
    needsCalendar ? fetchBookedData(venue.id, venue.type, venue.max_concurrent_setups || 1) : Promise.resolve(null),
  ])
  appState.currentVenueAddOns = addOns
  appState.lastViewedVenue = venue
  renderVenueDetail(venue, addOns)
  showPage('venue-detail-page')
  track('venue_viewed', { venue_id: venue.id, venue_name: venue.name, venue_type: venue.type, venue_city: venue.city })

  if (needsCalendar && bookedData) {
    renderAvailabilityCalendar('avail-calendar-widget', bookedData)
  }

}

// Go back to home — restore URL and scroll to the right venue section
function navigateHome() {
  history.pushState({}, 'The Picnic Stories', '/')
  document.title = 'The Picnic Stories'
  showPage('home-page')
  const setting = appState.lastViewedVenue?.setting
  const targetId = (setting === 'indoor' || setting === 'outdoor')
    ? `${setting}-venues`
    : 'venues-section'
  setTimeout(() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
}

// ── Venue testimonials (placeholder quotes — swap for real ones as they come in) ─
const VENUE_TESTIMONIALS = {
  14: [ // Beige Cafe, Gurugram
    { text: "The setup at Beige Cafe was straight out of Pinterest. We booked it for my wife's birthday and she cried happy tears. 10/10.", author: "Rohit K.", occasion: "Birthday" },
    { text: "Came for a date night and the picnic setup was so intimate and thoughtful. The food was delicious. Perfect evening.", author: "Naina S.", occasion: "Date night" }
  ],
  15: [ // Terracottage Umber, Gurugram
    { text: "Woke up to terracotta walls and golden light. It's the kind of place that slows you down. Absolutely loved every moment.", author: "Deepika & Rahul", occasion: "Anniversary stay" },
    { text: "We did the overnight + picnic combo and it was magical. Felt like a proper escape without leaving NCR.", author: "Aisha M.", occasion: "Weekend getaway" }
  ],
  16: [ // Terracottage Ochre, Gurugram
    { text: "The warm tones and cozy rooms made us never want to leave. Perfect for a slow weekend reset.", author: "Sanya & Rohit", occasion: "Weekend stay" },
    { text: "Such a beautiful space. The terracotta aesthetic is stunning in person — even better than the photos.", author: "Komal T.", occasion: "Girls trip" }
  ],
  17: [ // Terracottage Sienna, Gurugram
    { text: "Booked the whole-floor combo for our anniversary. Private, beautiful, with a picnic at sunset. Couldn't have asked for more.", author: "Ishaan & Meera", occasion: "Anniversary" },
    { text: "The team was incredibly attentive and the space was immaculate. We're already planning a return trip.", author: "Siddharth P.", occasion: "Birthday celebration" }
  ],
  18: [ // The Sunroom, Gurugram
    { text: "That skylight! The natural light in The Sunroom is unlike anything else. Our anniversary brunch photos were stunning.", author: "Priya V.", occasion: "Anniversary" },
    { text: "Hidden gem of Gurugram — you'd never guess it's right in the city. So peaceful, so beautiful.", author: "Ishaan T.", occasion: "Date night" }
  ],
  19: [ // Castle Valley, Jaipur
    { text: "The old stone walls and that view made us feel like we'd stepped into a fairytale. Perfect setting for our anniversary.", author: "Neha & Vikas", occasion: "Anniversary" },
    { text: "Castle Valley lives up to its name. Regal, quiet, breathtaking — and the team made us feel like royalty.", author: "Pooja M.", occasion: "Birthday" }
  ],
  20: [ // Om Niwas Suite Hotel, Jaipur
    { text: "A heritage property with a picnic in the garden — everything about this was perfect for our anniversary dinner.", author: "Siddharth P.", occasion: "Anniversary" },
    { text: "We've done picnics at a few places and Om Niwas is in a league of its own. The Rajasthani vibe hits differently.", author: "Mansi & Karan", occasion: "Date night" }
  ],
  21: [ // Once Upon A Time At The Bagh, Jaipur
    { text: "The garden is so lush and private. Our daughter's birthday was a storybook picnic — exactly as the name suggests.", author: "Seema T.", occasion: "Birthday" },
    { text: "One of those experiences that makes you put down your phone and just be present. Truly magical.", author: "Arjun & Kavya", occasion: "Date night" }
  ],
  22: [ // Countryside Offgrid
    { text: "Drove out of the city and felt like we'd gone to another world. The quiet here is rare — and so needed.", author: "Prateek N.", occasion: "Weekend trip" },
    { text: "Booked it as an anniversary surprise. My husband still talks about it. The picnic under the open sky was surreal.", author: "Divya S.", occasion: "Anniversary" }
  ],
  23: [ // House of Amer Stay, Jaipur
    { text: "Woke up to birdsong with the Aravalli hills in the distance. The Airbnb + picnic combo is something truly special.", author: "Ritu & Abhishek", occasion: "Anniversary stay" },
    { text: "For anyone wanting to experience old Jaipur in comfort — this is it. The host was warm and the setup was beautiful.", author: "Shreya K.", occasion: "Weekend getaway" }
  ],
  24: [ // House of Amer (Cafe), Jaipur
    { text: "The setting at House of Amer feels like a period film set. We had our anniversary picnic here and it exceeded every expectation.", author: "Shweta & Dev", occasion: "Anniversary" },
    { text: "Stunning property, thoughtful setup, great food. Genuinely one of the best experiences we've had in Jaipur.", author: "Tarun M.", occasion: "Date night" }
  ]
}

// Render full venue detail into venue-detail-page
function renderVenueDetail(venue, addOns = []) {
  const container = document.getElementById('venue-detail-content')
  if (!container) return

  const primaryImage = venue.images?.[0]
  const hasImage = primaryImage?.url
  const capacityText = venue.capacity_max
    ? `${venue.capacity_min}–${venue.capacity_max} guests`
    : `${venue.capacity_min}+ guests`

  // Gallery images (all images or just primary)
  const allImages = venue.images || []
  const galleryImgs = allImages

  const heroImgUrl = hasImage ? escapeHtml(primaryImage.url) : ''

  const galleryStrip = galleryImgs.length > 1
    ? `<div class="vd-gallery-strip">
        ${galleryImgs.map((img, i) => `
          <button class="vd-gallery-thumb ${i === 0 ? 'vd-gallery-thumb--active' : ''}"
                  data-img-url="${escapeHtml(img.url)}"
                  aria-label="View photo ${i + 1}">
            <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || venue.name)}" loading="lazy">
          </button>`).join('')}
       </div>`
    : ''

  const ctaBlock = venue.type === 'partner_bnb'
    ? `<p class="vd-steps-intro">Two steps to book</p>
       <div id="bnb-step-ui">
         <div class="vd-cta-stack">
           <a href="${venue.external_url?.startsWith('https://') ? escapeHtml(venue.external_url) : '#'}" target="_blank" rel="noopener noreferrer"
              class="btn btn--venue-primary" ${!venue.external_url ? 'aria-disabled="true"' : ''}>
             <span class="vd-step-badge" aria-hidden="true">1</span>
             Book on Airbnb
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
           </a>
           <button class="btn btn--venue-secondary" data-action="reveal-bnb-calendar" data-book-venue-id="${venue.id}">
             <span class="vd-step-badge vd-step-badge--ghost" aria-hidden="true">2</span>
             Add picnic setup
           </button>
         </div>
         <p class="vd-hint">Reserve your dates on Airbnb first. Already booked? Start at step 2.</p>
       </div>
       <!-- Revealed after clicking Add picnic setup -->
       <div id="avail-calendar-widget" class="avail-calendar-widget" style="display:none"></div>
       <button class="btn btn--venue-secondary" id="sidebar-book-btn"
               data-book-venue-id="${venue.id}" disabled style="display:none">
         Select a date to book
       </button>`
    : `<div id="avail-calendar-widget" class="avail-calendar-widget"></div>
       <button class="btn btn--venue-primary" id="sidebar-book-btn"
               data-book-venue-id="${venue.id}" disabled>
         Select a date to book
       </button>`

  container.innerHTML = `
    <div class="vd-wrap">

      <!-- Full-bleed hero -->
      <div class="vd-hero" id="vd-hero-slider">
        ${heroImgUrl
          ? `<div class="vd-hero-blur-bg" style="background-image:url('${heroImgUrl}')"></div>
             <img class="vd-hero-img vd-hero-img--a is-visible" src="${heroImgUrl}" alt="${escapeHtml(venue.name)}" fetchpriority="high" decoding="async">
             <img class="vd-hero-img vd-hero-img--b" alt="" aria-hidden="true" decoding="async">`
          : `<div class="vd-hero-blur-bg vd-hero-blur-bg--fallback"></div>`}
        <div class="vd-hero-gradient"></div>
        <div class="vd-hero-top">
          <button class="vd-back-btn" id="vd-hero-back" onclick="navigateHome()" aria-label="Back to venues">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            Venues
          </button>
          <span class="venue-type-badge ${venueTypeBadgeClass(venue.type)}">${escapeHtml(formatVenueType(venue.type))}</span>
        </div>
        <div class="vd-hero-bottom">
          <h1 class="vd-title">${escapeHtml(venue.name)}</h1>
          ${venue.area ? `<p class="vd-subtitle">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${escapeHtml(venue.area)}, ${escapeHtml(venue.city)}
          </p>` : ''}
        </div>
        ${galleryImgs.length > 1 ? `
        <div class="vd-hero-dots" aria-label="Image navigation">
          ${galleryImgs.map((_, i) => `<button class="vd-hero-dot${i === 0 ? ' vd-hero-dot--active' : ''}" data-dot="${i}" aria-label="Photo ${i + 1}"></button>`).join('')}
        </div>` : ''}
      </div>

      ${galleryStrip}

      <!-- Body -->
      <div class="vd-body container" id="vd-body">
        <div class="vd-layout">

          <!-- Quick facts — own grid area (shares "main" with .vd-main, so
               desktop is unaffected) purely so it can be reordered ahead of
               the booking card on mobile, independent of the long-form
               content below it. -->
          <div class="vd-facts-outer">
            <div class="vd-facts">
              <div class="vd-fact">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <div>
                  <span class="vd-fact-label">Capacity</span>
                  <span class="vd-fact-value">${escapeHtml(capacityText)}</span>
                </div>
              </div>
              ${venue.base_price ? `
              <div class="vd-fact">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <div>
                  <span class="vd-fact-label">Starting price</span>
                  <span class="vd-fact-value">${escapeHtml(formatPrice(venue.base_price))}</span>
                </div>
              </div>` : ''}
              <div class="vd-fact">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <div>
                  <span class="vd-fact-label">Availability</span>
                  <span class="vd-fact-value">7 days a week</span>
                </div>
              </div>
            </div>
            <hr class="vd-divider">
          </div>

          <!-- Main content -->
          <div class="vd-main">

            ${venue.description ? `
            <div class="vd-section vd-about">
              <button type="button" class="vd-about-header" onclick="toggleVdAccordion(this)" aria-expanded="false">
                <h2 class="vd-section-title">About this venue</h2>
                <svg class="vd-about-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="vd-about-body" hidden>
                <p class="vd-description">${escapeHtml(venue.description)}</p>
              </div>
            </div>
            <hr class="vd-divider">` : ''}

            <!-- What's included — in the packages flow this moves into The
                 Setting package card instead (see showPackageStep). -->
            ${packageFlowActive(venue) ? '' : (() => {
              const meta = venue.metadata || {}
              const svgWrap = paths => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
              const checkSvg   = svgWrap('<polyline points="20 6 9 17 4 12"/>')
              const isCafe     = venue.type === 'cafe' || venue.type === 'self_managed'
              const isStay     = venue.type === 'partner_bnb' || venue.type === 'combo'

              // Items shared by both cafes and stays (all except Food & Beverages)
              const sharedSetup = [
                { label: 'Fresh Fruits',       icon: svgWrap('<path d="M12 22c4.97 0 9-2.69 9-6s-4.03-6-9-6-9 2.69-9 6 4.03 6 9 6z"/><path d="M12 10V3"/><path d="M8 6l4-3 4 3"/>') },
                { label: 'Fresh Flowers',      icon: svgWrap('<circle cx="12" cy="12" r="3"/><path d="M12 2a4 4 0 0 1 4 4c0 2.5-4 6-4 6s-4-3.5-4-6a4 4 0 0 1 4-4z"/><path d="M12 22a4 4 0 0 1-4-4c0-2.5 4-6 4-6s4 3.5 4 6a4 4 0 0 1-4 4z"/><path d="M2 12a4 4 0 0 1 4-4c2.5 0 6 4 6 4s-3.5 4-6 4a4 4 0 0 1-4-4z"/><path d="M22 12a4 4 0 0 1-4 4c-2.5 0-6-4-6-4s3.5-4 6-4a4 4 0 0 1 4 4z"/>') },
                { label: 'Wax Candles',        icon: svgWrap('<line x1="12" y1="2" x2="12" y2="6"/><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>') },
                { label: 'Electric Candles',   icon: svgWrap('<line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>') },
                { label: 'Macrame Tent',       icon: svgWrap('<path d="M2 20 L12 3 L22 20"/><line x1="2" y1="20" x2="22" y2="20"/><path d="M9.5 20 L12 14 L14.5 20"/>') },
                { label: 'Macrame Umbrella',   icon: svgWrap('<path d="M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7"/>') },
                { label: 'Portable Speaker',   icon: svgWrap('<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><line x1="12" y1="6" x2="12.01" y2="6"/>') },
                { label: 'Board with Message', icon: svgWrap('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>') },
                { label: 'Cutlery & Essentials', icon: svgWrap('<line x1="8" y1="6" x2="8" y2="12"/><path d="M6.5 12 8 15.5 9.5 12"/><path d="M16 6v4a2 2 0 0 1-2 2h-.5l1 7.5"/><line x1="16" y1="6" x2="16" y2="12"/>') },
              ]

              const hardcoded = [
                ...(venue.id === 15 ? [{ label: 'Whole 2BHK Apartment', icon: svgWrap('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>') }] : []),
                ...(isCafe ? [
                  { label: 'Food & Beverages', icon: svgWrap('<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>') },
                  ...sharedSetup,
                ] : isStay ? [
                  ...sharedSetup,
                ] : [
                  { label: 'Full picnic setup',     icon: '<span style="font-size:18px;line-height:1" aria-hidden="true">⛺</span>' },
                  { label: 'Boho decor & lighting', icon: svgWrap('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>') },
                ]),
                { label: 'Setup & cleanup',        icon: checkSvg },
                { label: 'Dedicated host support', icon: svgWrap('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6 19.79 19.79 0 0 1 1.61 5 2 2 0 0 1 3.6 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.6a16 16 0 0 0 6 6l.94-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 18z"/>') },
              ]
              const custom = (meta.includes || []).map(item => ({ label: item, icon: checkSvg }))
              const allItems = [...hardcoded, ...custom]
              return `<div class="vd-section">
                <h2 class="vd-section-title">What's included</h2>
                <div class="vd-includes">
                  ${allItems.map(({ label, icon }) => `
                    <div class="vd-include-item">
                      ${icon}
                      <span>${escapeHtml(label)}</span>
                    </div>`).join('')}
                </div>
              </div>
            <hr class="vd-divider">`
            })()}

            ${(function() {
              const pages = Array.isArray(venue.menu_pages) ? venue.menu_pages.filter(p => p && p.url) : []
              if (!pages.length) return ''
              const preview = pages.slice(0, 3)
              return `
            <div class="vd-section vd-menu-section">
              <h2 class="vd-section-title">Our menu</h2>
              <p class="vd-menu-sub">Browse before you book · ${pages.length} page${pages.length === 1 ? '' : 's'}</p>
              <div class="vd-menu-strip">
                ${preview.map((p, i) => `
                  <button type="button" class="vd-menu-thumb" onclick="openMenuViewer(${venue.id}, ${i})"
                          aria-label="View menu page ${i + 1} of ${pages.length}">
                    <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.alt || `Menu page ${i + 1}`)}" loading="lazy">
                    <span class="vd-menu-thumb-num">${i + 1}</span>
                  </button>`).join('')}
                ${pages.length > 3 ? `
                  <button type="button" class="vd-menu-thumb vd-menu-thumb-more" onclick="openMenuViewer(${venue.id}, 3)"
                          aria-label="View all ${pages.length} menu pages">
                    <span class="vd-menu-more-count">+${pages.length - 3}</span>
                    <span class="vd-menu-more-label">more</span>
                  </button>` : ''}
              </div>
              <button type="button" class="vd-menu-view-all" onclick="openMenuViewer(${venue.id}, 0)">
                View full menu · ${pages.length} pages →
              </button>
            </div>
            <hr class="vd-divider">`
            })()}

            ${(function() {
              const quotes = VENUE_TESTIMONIALS[venue.id]
              if (!quotes?.length) return ''
              return `
            <div class="vd-section vd-testimonials">
              <h2 class="vd-section-title">What guests say</h2>
              <div class="vd-testimonial-grid">
                ${quotes.map(q => `
                  <div class="vd-testimonial-card">
                    <div class="vd-testimonial-stars">★★★★★</div>
                    <p class="vd-testimonial-text">"${escapeHtml(q.text)}"</p>
                    <div class="vd-testimonial-meta">
                      <span class="vd-testimonial-author">— ${escapeHtml(q.author)}</span>
                      ${q.occasion ? `<span class="vd-testimonial-occasion">${escapeHtml(q.occasion)}</span>` : ''}
                    </div>
                  </div>`).join('')}
              </div>
            </div>
            <hr class="vd-divider">`
            })()}

            ${(function() {
              if (venue.type !== 'self_managed' || !venue.metadata) return ''
              const m = venue.metadata
              const amenities = Array.isArray(m.amenities) ? m.amenities : []
              const highlights = Array.isArray(m.highlights) ? m.highlights : []
              const idealFor   = Array.isArray(m.ideal_for)  ? m.ideal_for  : []
              return `
            <div class="vd-section vd-section--property">
              <h2 class="vd-section-title">The Property</h2>
              <div class="vd-property-stats">
                ${m.rooms ? `<div class="vd-property-stat">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>
                  <div class="vd-property-stat-text">
                    <span class="vd-property-stat-value">${m.rooms}</span>
                    <span class="vd-property-stat-label">${m.rooms === 1 ? 'Room' : 'Rooms'}</span>
                  </div>
                </div>` : ''}
                ${m.bathrooms ? `<div class="vd-property-stat">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6 6.5 3.5a1.5 1.5 0 0 0-1-.5C4.683 3 4 3.683 4 4.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><line x1="10" y1="5" x2="8" y2="7"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                  <div class="vd-property-stat-text">
                    <span class="vd-property-stat-value">${m.bathrooms}</span>
                    <span class="vd-property-stat-label">${m.bathrooms === 1 ? 'Bathroom' : 'Bathrooms'}</span>
                  </div>
                </div>` : ''}
                ${m.stay_price_per_night ? `<div class="vd-property-stat">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  <div class="vd-property-stat-text">
                    <span class="vd-property-stat-value">₹${Number(m.stay_price_per_night).toLocaleString('en-IN')}</span>
                    <span class="vd-property-stat-label">per night</span>
                  </div>
                </div>` : ''}
              </div>
              ${highlights.length ? `
              <div class="vd-property-highlights">
                ${highlights.map(h => `<div class="vd-property-highlight">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>${escapeHtml(h)}</span>
                </div>`).join('')}
              </div>` : ''}
              ${amenities.length ? `
              <div class="vd-property-amenities-section">
                <h3 class="vd-property-subsection-title">Amenities</h3>
                <div class="vd-amenity-grid">
                  ${amenities.map(a => `
                    <div class="vd-amenity-row">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>${escapeHtml(a)}</span>
                    </div>`).join('')}
                </div>
              </div>` : ''}
              ${idealFor.length ? `
              <div class="vd-property-ideal">
                <span class="vd-property-ideal-label">Ideal for</span>
                <div class="vd-ideal-tags">
                  ${idealFor.map(t => `<span class="vd-ideal-tag">${escapeHtml(t)}</span>`).join('')}
                </div>
              </div>` : ''}
            </div>
            <hr class="vd-divider">`
            })()}


          </div><!-- /vd-main -->

          <!-- Sticky booking sidebar -->
          <aside class="vd-sidebar">
            <div class="vd-booking-card">
              <div id="vd-price-block"${packageFlowActive(venue) ? ' style="display:none"' : ''}>
              ${venue.base_price ? `
              <div class="vd-price-row">
                <span class="vd-price-amount" id="sidebar-price-amount">${escapeHtml(formatPrice(venue.base_price))}</span>
                <span class="vd-price-label" id="sidebar-price-label">${venue.type === 'partner_bnb' ? 'starting price · picnic setup only' : 'starting price'}</span>
              </div>` : `
              <div class="vd-price-row">
                <span class="vd-price-amount" id="sidebar-price-amount">Custom</span>
                <span class="vd-price-label" id="sidebar-price-label">pricing on request</span>
              </div>`}
              <p class="vd-price-note">Final price confirmed after we review your requirements.</p>
              </div>
              ${packageFlowActive(venue) ? '' : '<div class="vd-card-divider"></div>'}
              ${ctaBlock}
              <ul class="vd-reassure">
                <li>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                  Your date is locked the moment your advance is paid
                </li>
                <li>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                  Personal host assigned
                </li>
              </ul>
            </div>
          </aside>

          <!-- Add-ons — own grid area so it sits below main on desktop, below calendar on mobile -->
          <div class="vd-addons-outer">
            ${(function() {
              if (!addOns.length) return ''
              const CATEGORY_LABELS = {
                photography:   '📷 Photography',
                decor:         '🌸 Decor',
                food:          '🍰 Food',
                entertainment: '🎉 Entertainment',
                extension:     '⏱ Extension',
              }
              const CATEGORY_ORDER = ['photography', 'decor', 'food', 'entertainment', 'extension']
              const grouped = CATEGORY_ORDER.reduce((acc, cat) => {
                const items = addOns.filter(a => a.category === cat)
                if (items.length) acc.push({ cat, items })
                return acc
              }, [])
              if (!grouped.length) return ''
              return `
            <hr class="vd-divider">
            <div class="vd-section">
              <h2 class="vd-section-title">Elevate your experience</h2>
              <p class="vd-addons-tagline">Optional add-ons to make your picnic exactly how you imagined it.</p>
              ${grouped.map(({ cat, items }) => `
              <div class="vd-addons-category">
                <h3 class="vd-addons-cat-label">${CATEGORY_LABELS[cat]}</h3>
                <div class="vd-addons-scroll">
                  ${items.map(a => `
                  <div class="vd-addon-card">
                    <div class="vd-addon-img">
                      ${a.image_url
                        ? `<img src="${escapeHtml(a.image_url)}" alt="${escapeHtml(a.name)}" loading="lazy">`
                        : `<div class="vd-addon-img-placeholder"></div>`}
                    </div>
                    <div class="vd-addon-body">
                      <div class="vd-addon-name">${escapeHtml(a.name)}</div>
                      ${a.description ? `<div class="vd-addon-desc">${escapeHtml(a.description)}</div>` : ''}
                      <div class="vd-addon-footer">
                        <span class="vd-addon-price">+₹${Number(a.price).toLocaleString('en-IN')}</span>
                        ${a.requires_confirmation ? `<span class="vd-addon-confirm-tag">On request</span>` : ''}
                      </div>
                    </div>
                  </div>`).join('')}
                </div>
              </div>`).join('')}
            </div>`
            })()}
          </div><!-- /vd-addons-outer -->

        </div><!-- /vd-layout -->
      </div><!-- /vd-body -->

      <!-- Inline booking view (shown when user clicks Book Now) -->
      <div id="vd-booking-view" style="display:none"></div>

      <!-- Mobile-only sticky booking bar -->
      <div class="vd-mobile-book-bar">
        ${venue.type === 'partner_bnb'
          ? `<div class="vd-mobile-book-price">
               <span class="vd-mobile-book-amount">${venue.base_price ? escapeHtml(formatPrice(venue.base_price)) : 'Custom'}</span>
               <span class="vd-mobile-book-label">picnic setup · from</span>
             </div>
             <button class="btn btn--venue-primary" data-action="reveal-bnb-calendar" data-book-venue-id="${venue.id}">Add picnic setup</button>`
          : `<div class="vd-mobile-book-price">
               <span class="vd-mobile-book-amount" id="mobile-bar-date-text">Pick a date ↑</span>
               <span class="vd-mobile-book-label">${venue.base_price ? escapeHtml(formatPrice(venue.base_price)) : 'Custom pricing'}</span>
             </div>
             <button class="btn btn--venue-primary" id="mobile-bar-book-btn"
                     data-book-venue-id="${venue.id}" disabled>Book Now</button>`
        }
      </div>

    </div><!-- /vd-wrap -->
  `

  // ---- Image slider (touch swipe + auto-advance + dot indicators) ----
  if (galleryImgs.length > 1) {
    const sliderImages = galleryImgs.map(img => img.url)
    let sliderIndex = 0
    let sliderTimer = null
    let touchStartX = 0
    let touchStartY = 0

    const heroEl  = container.querySelector('#vd-hero-slider')
    const blurBg  = container.querySelector('.vd-hero-blur-bg')
    const layerA  = container.querySelector('.vd-hero-img--a')
    const layerB  = container.querySelector('.vd-hero-img--b')
    let visibleLayer = layerA

    function sliderGoTo(index) {
      sliderIndex = ((index % sliderImages.length) + sliderImages.length) % sliderImages.length
      const url = sliderImages[sliderIndex]
      // Crossfade between two stacked layers so the blurred background
      // is never exposed mid-transition.
      if (layerA && layerB) {
        const incoming = visibleLayer === layerA ? layerB : layerA
        const pre = new Image()
        pre.onload = () => {
          incoming.src = url
          if (blurBg) blurBg.style.backgroundImage = `url('${url}')`
          requestAnimationFrame(() => {
            incoming.classList.add('is-visible')
            visibleLayer.classList.remove('is-visible')
            visibleLayer = incoming
          })
        }
        pre.src = url
      } else if (blurBg) {
        blurBg.style.backgroundImage = `url('${url}')`
      }
      // Sync dots
      container.querySelectorAll('.vd-hero-dot').forEach((d, i) =>
        d.classList.toggle('vd-hero-dot--active', i === sliderIndex))
      // Sync thumbs
      container.querySelectorAll('.vd-gallery-thumb').forEach((b, i) =>
        b.classList.toggle('vd-gallery-thumb--active', i === sliderIndex))
    }

    function sliderStartAuto() {
      sliderStopAuto()
      if (prefersReducedMotion()) return
      sliderTimer = setInterval(() => { if (!document.hidden) sliderGoTo(sliderIndex + 1) }, 4000)
    }
    function sliderStopAuto() {
      if (sliderTimer) { clearInterval(sliderTimer); sliderTimer = null }
    }
    function sliderResumeAfterDelay() {
      sliderStopAuto()
      setTimeout(sliderStartAuto, 3000)
    }

    // Touch swipe
    if (heroEl) {
      heroEl.addEventListener('touchstart', e => {
        touchStartX = e.touches[0].clientX
        touchStartY = e.touches[0].clientY
        sliderStopAuto()
      }, { passive: true })
      heroEl.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - touchStartX
        const dy = e.changedTouches[0].clientY - touchStartY
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 36) {
          sliderGoTo(sliderIndex + (dx < 0 ? 1 : -1))
        }
        sliderResumeAfterDelay()
      }, { passive: true })
      // Pause on hover (desktop)
      heroEl.addEventListener('mouseenter', sliderStopAuto)
      heroEl.addEventListener('mouseleave', sliderStartAuto)
    }

    // Dot clicks
    container.querySelectorAll('.vd-hero-dot').forEach((dot, i) => {
      dot.addEventListener('click', () => { sliderGoTo(i); sliderResumeAfterDelay() })
    })

    // Thumb clicks
    container.querySelectorAll('.vd-gallery-thumb').forEach((btn, i) => {
      btn.addEventListener('click', () => { sliderGoTo(i); sliderResumeAfterDelay() })
    })

    sliderStartAuto()
  } else {
    // Single image — just wire thumb click (no-op if no strip)
    container.querySelectorAll('.vd-gallery-thumb').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.imgUrl
        if (!url) return
        const blurBg = container.querySelector('.vd-hero-blur-bg')
        const heroImg = container.querySelector('.vd-hero-img')
        if (blurBg) blurBg.style.backgroundImage = `url('${url}')`
        if (heroImg) heroImg.src = url
        container.querySelectorAll('.vd-gallery-thumb').forEach(b => b.classList.remove('vd-gallery-thumb--active'))
        btn.classList.add('vd-gallery-thumb--active')
      })
    })
  }

  // ── Floating WhatsApp button (team-specific) ──────────────────
  const detailPage = document.getElementById('venue-detail-page')
  if (detailPage) {
    detailPage.querySelector('.vd-wa-float')?.remove()
    const team = appState.teams.find(t => t.id === venue.team_id)
    if (team?.whatsapp) {
      const msgText = encodeURIComponent(`Hi! I'm interested in booking ${venue.name}`)
      const waBtn = document.createElement('a')
      waBtn.className = 'vd-wa-float'
      waBtn.href = `https://wa.me/${team.whatsapp}?text=${msgText}`
      waBtn.target = '_blank'
      waBtn.rel = 'noopener noreferrer'
      waBtn.setAttribute('aria-label', `WhatsApp the ${team.name} team`)
      waBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        <span>Chat with us</span>`
      detailPage.appendChild(waBtn)
    }
  }
}


// ----------------------------------------------------------------
// AVAILABILITY CALENDAR
// ----------------------------------------------------------------

// ── Packages (Phase 1) ────────────────────────────────────────────────────
// Curated add-on tiers layered on top of the existing booking engine. A tier is
// just a preset of add-on IDs; the per-combo price always comes from the
// compute_booking_total RPC (the source of truth) — never hardcoded here.
// Cafe (picnic) venues only. See docs/SPEC_packages_mvp.md.
//
// Tier definitions (name/tagline/add-ons/featured) live in the `packages` /
// `package_add_ons` tables — admin-editable via the Packages panel.
// loadPackages() overwrites the literals below at bootstrap; they're only a
// fail-safe fallback if that fetch fails, and must stay in sync with the DB
// seed in migration add_pricing_columns_and_packages_tables.
let PACKAGE_TIERS = {
  setting: { key: 'setting', name: 'The Setting', addons: [],                          tagline: 'The signature setup, beautifully done.' },
  moment:  { key: 'moment',  name: 'The Moment',  addons: [22, 24, 17], featured: true, tagline: 'Bouquet, cake and printed memories.' },
  story:   { key: 'story',   name: 'The Story',   addons: [19, 27, 23, 22, 24, 17],     tagline: 'The full production — photographer and more.' },
}
let PACKAGE_TIER_ORDER = ['setting', 'moment', 'story']
let packagesLoaded = false // set once loadPackages() has real DB rows

// Loads package tier definitions from the DB, replacing the hardcoded
// fallback above. Falls back silently to the hardcoded defaults on error so a
// DB hiccup never breaks the booking flow. Called once at bootstrap
// (DOMContentLoaded) alongside loadTeams(), on both admin.html and the
// public site.
async function loadPackages() {
  try {
    const { data, error } = await supabase
      .from('packages')
      .select('*, package_add_ons(addon_id, sort_order)')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    if (error) throw error
    if (!data || data.length === 0) return
    const tiers = {}
    const order = []
    data.forEach(pkg => {
      const addons = (pkg.package_add_ons || [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(pa => pa.addon_id)
      // occasion: NULL/absent = universal (shown for every occasion). The
      // column lands in Phase 2.5 (occasion-specific packages) — carrying it
      // through now means the visiblePackagesFor() filter needs no change then.
      tiers[pkg.key] = { key: pkg.key, name: pkg.name, tagline: pkg.tagline || '', addons, featured: !!pkg.is_featured, occasion: pkg.occasion || null, images: pkg.images || [] }
      order.push(pkg.key)
    })
    PACKAGE_TIERS = tiers
    PACKAGE_TIER_ORDER = order
    packagesLoaded = true
  } catch (err) {
    console.error('Failed to load packages, using fallback tier definitions:', err)
  }
}

// ── Packages admin panel ───────────────────────────────────────────────────
// Package composition (which add-ons belong to each tier) is admin-editable
// here. Tier price is always DERIVED (base_price + sum of the tier's add-on
// catalog prices) and shown read-only — never a typed-in number — so it
// can't drift from the add-on catalog the way base_price and the old tiers
// array once did (see the base_price/metadata.tiers desync found and fixed
// this session). Food-included is shown read-only from each venue's own
// food_offline setting, not editable per-package, for the same reason.
let packagesManagerState = { packages: [], addons: [], venues: [] }

async function loadPackagesManager() {
  const container = document.getElementById('packages-manager-container')
  if (!container) return
  container.innerHTML = '<p class="admin-loading">Loading packages…</p>'
  try {
    const [pkgRes, addonRes, venueRes] = await Promise.all([
      supabase.from('packages').select('*, package_add_ons(addon_id, sort_order)').order('sort_order', { ascending: true }),
      supabase.from('add_ons').select('id, name, price').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('venues').select('id, name, type, packages_enabled, base_price, metadata, venue_add_ons(addon_id)')
        .eq('type', 'cafe').eq('is_active', true).order('id', { ascending: true }),
    ])
    if (pkgRes.error) throw pkgRes.error
    if (addonRes.error) throw addonRes.error
    if (venueRes.error) throw venueRes.error
    packagesManagerState = {
      packages: pkgRes.data || [],
      addons: addonRes.data || [],
      venues: venueRes.data || [],
    }
    renderPackagesManager()
  } catch (err) {
    console.error('Failed to load packages manager:', err)
    container.innerHTML = '<p class="venues-error">Unable to load packages.</p>'
  }
}

// Shared between the per-card occasion <select> and the "add new package"
// form below, so the option list (and the universal/occasion semantics)
// can't drift between the two.
function pkgAdmOccasionOptions(selected) {
  return ['<option value="">Universal (all occasions)</option>']
    .concat(OCCASIONS.map(o => `<option value="${escapeHtml(o)}" ${selected === o ? 'selected' : ''}>${escapeHtml(o)}</option>`))
    .join('')
}

// New-package form markup. Key is collected up front (not editable later,
// same as every other package's key) since it's the stable identifier used
// in ?tier= deep links, booking snapshots (bookings.package_key), and the
// email edge function's add-on lookup — renaming it after the fact would
// silently orphan any of those. Auto-filled from Name via pkgNewKeyAutofill()
// but left free-text so the admin can override before creating.
function pkgAdmNewFormHtml() {
  return `
    <div class="pkg-adm-new">
      <div class="vf-section-title">Add a new package</div>
      <div class="vf-row">
        <div class="vf-field">
          <label class="vf-label">Name</label>
          <input type="text" class="vf-input" id="pkg-new-name" placeholder="e.g. The Celebration" oninput="pkgNewKeyAutofill()" />
        </div>
        <div class="vf-field">
          <label class="vf-label">Key <span class="vf-hint">(unique, lowercase — used in URLs, can't be changed later)</span></label>
          <input type="text" class="vf-input" id="pkg-new-key" placeholder="e.g. celebration" oninput="this.dataset.touched='1'" />
        </div>
        <div class="vf-field">
          <label class="vf-label">Occasion</label>
          <select class="vf-input" id="pkg-new-occasion">${pkgAdmOccasionOptions(null)}</select>
        </div>
      </div>
      <button type="button" class="btn btn--primary" onclick="createNewPackage()">+ Add Package</button>
      <p class="vf-hint" style="margin-top:8px">Creates the package with no add-ons and no images — configure those in its card below, then Save.</p>
    </div>`
}

function pkgNewKeyAutofill() {
  const keyEl = document.getElementById('pkg-new-key')
  const nameEl = document.getElementById('pkg-new-name')
  if (!keyEl || !nameEl || keyEl.dataset.touched) return
  keyEl.value = nameEl.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
window.pkgNewKeyAutofill = pkgNewKeyAutofill

async function createNewPackage() {
  if (!appState.session) return showToast('Admin login required', 'error')
  const nameEl = document.getElementById('pkg-new-name')
  const keyEl = document.getElementById('pkg-new-key')
  const occEl = document.getElementById('pkg-new-occasion')
  if (!nameEl || !keyEl || !occEl) return

  const name = nameEl.value.trim()
  const key = keyEl.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const occasion = occEl.value || null

  if (!name) return showToast('Package name is required', 'error')
  if (!key) return showToast('Package key is required', 'error')
  if (packagesManagerState.packages.some(p => p.key === key)) {
    return showToast(`Key "${key}" is already in use — pick another`, 'error')
  }

  const sortOrder = packagesManagerState.packages.reduce((max, p) => Math.max(max, p.sort_order || 0), 0) + 1

  try {
    const { error } = await supabase.from('packages').insert([{
      key, name, tagline: '', occasion, is_featured: false, is_active: true, sort_order: sortOrder, images: [],
    }])
    if (error) throw error
    showToast('Package created — configure it below, then Save', 'success')
    await loadPackages()        // refresh PACKAGE_TIERS used by the live storefront
    await loadPackagesManager() // refresh this admin view (new card + form reset)
  } catch (err) {
    console.error(err)
    showToast('Failed to create package: ' + err.message, 'error')
  }
}
window.createNewPackage = createNewPackage

function renderPackagesManager() {
  const container = document.getElementById('packages-manager-container')
  if (!container) return
  const { packages, addons, venues } = packagesManagerState

  if (!packages.length) {
    container.innerHTML = pkgAdmNewFormHtml() + '<p class="venues-error">No packages found.</p>'
    return
  }

  container.innerHTML = pkgAdmNewFormHtml() + packages.map(pkg => {
    const addonIds = (pkg.package_add_ons || []).slice().sort((a, b) => a.sort_order - b.sort_order).map(pa => pa.addon_id)

    const checklist = addons.map(a => `
      <label class="pkg-adm-addon">
        <input type="checkbox" class="pkg-adm-addon-cb" value="${a.id}" ${addonIds.includes(a.id) ? 'checked' : ''} />
        ${escapeHtml(a.name)} <span class="vf-hint">₹${Number(a.price).toLocaleString('en-IN')}</span>
      </label>`).join('')

    // Occasion packages (Phase 2.5) can't tolerate a missing add-on the way
    // universal tiers do — the theme IS the add-on (Movie Night without
    // Movie Screening isn't Movie Night). The live storefront already hides
    // the package/venue combo in that case (packageServiceableAt) — this
    // just labels it accurately instead of showing the generic "gap" warning.
    const rows = venues.map(v => {
      const venueAddonIds = (v.venue_add_ons || []).map(x => x.addon_id)
      const missingIds = addonIds.filter(id => !venueAddonIds.includes(id))
      const addonSum = addonIds
        .filter(id => venueAddonIds.includes(id))
        .reduce((sum, id) => sum + (addons.find(a => a.id === id)?.price || 0), 0)
      const price = (Number(v.base_price) || 0) + addonSum
      const foodIncluded = !v.metadata?.food_offline
      const missingNames = missingIds.map(id => addons.find(a => a.id === id)?.name || `#${id}`).join(', ')
      const gapHtml = !missingIds.length ? '—'
        : pkg.occasion
          ? `🚫 Not offerable here — missing ${escapeHtml(missingNames)} (package hidden at this venue)`
          : `⚠ Missing ${missingIds.length} of ${addonIds.length}: ${escapeHtml(missingNames)}`
      return `
        <tr class="${missingIds.length ? 'pkg-adm-row--warn' : ''}">
          <td>${escapeHtml(v.name)}${v.packages_enabled ? '' : ' <span class="vf-hint">(packages off)</span>'}</td>
          <td>₹${price.toLocaleString('en-IN')}</td>
          <td>${foodIncluded ? 'Yes' : 'No — self-sourced'}</td>
          <td>${gapHtml}</td>
        </tr>`
    }).join('')

    const occasionOptions = pkgAdmOccasionOptions(pkg.occasion)

    return `
      <div class="pkg-adm-card" data-pkg-id="${pkg.id}">
        <div class="vf-row">
          <div class="vf-field">
            <label class="vf-label">Name</label>
            <input type="text" class="vf-input pkg-adm-name" value="${escapeHtml(pkg.name)}" />
          </div>
          <div class="vf-field">
            <label class="vf-label">Tagline</label>
            <input type="text" class="vf-input pkg-adm-tagline" value="${escapeHtml(pkg.tagline || '')}" />
          </div>
          <div class="vf-field vf-field--checkbox">
            <label class="vf-toggle-label"><input type="checkbox" class="pkg-adm-featured" ${pkg.is_featured ? 'checked' : ''} /> Featured ("Most picked")</label>
          </div>
        </div>
        <div class="vf-row">
          <div class="vf-field">
            <label class="vf-label">Occasion <span class="vf-hint">(Universal shows on /packages by default; an occasion REPLACES the universal tiers when that occasion is picked)</span></label>
            <select class="vf-input pkg-adm-occasion">${occasionOptions}</select>
          </div>
        </div>
        <div class="vf-section-title">Add-ons in this package</div>
        <div class="pkg-adm-addons">${checklist}</div>
        <div class="vf-section-title" style="margin-top:16px">Carousel images <span class="vf-hint">(shown at the top of the tier card on /packages, the homepage, and the venue-first flow)</span></div>
        <div id="pkg-adm-images-${pkg.id}" class="vf-images-list"></div>
        <label class="vf-img-upload-btn">
          + Add Images
          <input type="file" multiple accept="image/jpeg,image/png,image/webp"
                 onchange="addPkgAdmImagesMulti(this, ${pkg.id})" style="display:none" />
        </label>
        <button type="button" class="btn btn--primary" style="margin-top:16px" onclick="savePackageCard(${pkg.id})">Save ${escapeHtml(pkg.name)}</button>
        ${addonIds.length === 0 ? '<p class="vf-hint" style="margin-top:8px">No add-ons selected — price is just the venue base price.</p>' : ''}
        <div class="vf-section-title" style="margin-top:16px">Price by venue (cafe, 2 guests, live)</div>
        <table class="pkg-adm-table">
          <thead><tr><th>Venue</th><th>Price</th><th>Food included</th><th>Add-on gaps</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  }).join('')

  // Image rows need real DOM to attach drag-reorder listeners to, so they're
  // rendered as a second pass after the card markup above is in the document
  // (same reason the venue form calls renderVfImages() after populating).
  packages.forEach(pkg => renderPkgAdmImages(pkg.id, pkg.images || []))
}

// Persists name/tagline/featured + the add-on checklist for one package card.
// Price is never written here — it's always recomputed live from base_price
// + the catalog prices of whatever add-ons end up checked.
async function savePackageCard(pkgId) {
  if (!appState.session) return showToast('Admin login required', 'error')
  const card = document.querySelector(`.pkg-adm-card[data-pkg-id="${pkgId}"]`)
  if (!card) return
  const name = card.querySelector('.pkg-adm-name').value.trim()
  const tagline = card.querySelector('.pkg-adm-tagline').value.trim()
  const isFeatured = card.querySelector('.pkg-adm-featured').checked
  const occasion = card.querySelector('.pkg-adm-occasion').value || null
  const addonIds = Array.from(card.querySelectorAll('.pkg-adm-addon-cb:checked')).map(cb => parseInt(cb.value, 10))

  const images = readPkgAdmImages(pkgId).filter(img => img.url) // drop empty rows (upload never finished)

  try {
    const { error: updErr } = await supabase
      .from('packages')
      .update({ name, tagline, is_featured: isFeatured, occasion, images, updated_at: new Date().toISOString() })
      .eq('id', pkgId)
    if (updErr) throw updErr

    const { error: delErr } = await supabase.from('package_add_ons').delete().eq('package_id', pkgId)
    if (delErr) throw delErr
    if (addonIds.length) {
      const rows = addonIds.map((addon_id, i) => ({ package_id: pkgId, addon_id, sort_order: i }))
      const { error: insErr } = await supabase.from('package_add_ons').insert(rows)
      if (insErr) throw insErr
    }
    showToast('Package saved!', 'success')
    await loadPackages()        // refresh PACKAGE_TIERS used by the live storefront
    await loadPackagesManager() // refresh this admin view (recomputed prices/gaps)
  } catch (err) {
    console.error(err)
    showToast('Failed to save package: ' + err.message, 'error')
  }
}
window.savePackageCard = savePackageCard

// ── Package carousel images (admin) ─────────────────────────────────────────
// Mirrors the venue-images editor 1:1 (same .vf-image-row/.vf-img-* markup,
// CSS, and drag-reorder logic — see renderVfImages/addVfImagesMulti) but
// parameterized by pkgId: unlike the venue form (one modal open at a time,
// so a single #vf-images-list works), the Packages tab renders all package
// cards inline simultaneously, so each needs its own keyed list/read/render.
// Images live in packages.images (jsonb array), same shape as venues.images:
// [{url, alt, name}, ...], order = carousel order. Bucket: package-images.
function renderPkgAdmImages(pkgId, images) {
  const list = document.getElementById(`pkg-adm-images-${pkgId}`)
  if (!list) return
  list.innerHTML = images.map((img, i) => {
    const filename = img.name || ''
    return `
    <div class="vf-image-row" data-index="${i}" draggable="true">
      <div class="vf-img-drag-handle" title="Drag to reorder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
        </svg>
      </div>
      <div class="vf-img-preview-wrap">
        ${img.url
          ? `<img class="vf-img-thumb" src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" />`
          : `<div class="vf-img-thumb-placeholder">🖼</div>`}
        ${filename ? `<span class="vf-img-filename" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>` : ''}
      </div>
      <div class="vf-img-fields">
        <label class="vf-img-upload-btn">
          ${img.url ? '↺ Replace photo' : '↑ Upload photo'}
          <input type="file" class="vf-img-file" accept="image/jpeg,image/png,image/webp"
                 onchange="handlePkgAdmImageUpload(this, ${pkgId}, ${i})" style="display:none" />
        </label>
        <input type="hidden" class="vf-img-url" value="${escapeHtml(img.url || '')}" />
        <input type="hidden" class="vf-img-name" value="${escapeHtml(filename)}" />
        <input type="text" class="vf-input vf-img-alt" placeholder="Alt text / caption" value="${escapeHtml(img.alt || '')}" />
      </div>
      <button type="button" class="vf-remove-btn" onclick="removePkgAdmImage(${pkgId}, ${i})">✕</button>
    </div>`
  }).join('')

  // Wire drag-to-reorder — identical logic to renderVfImages, scoped to this list.
  let dragIndex = null
  list.querySelectorAll('.vf-image-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragIndex = parseInt(row.dataset.index)
      e.dataTransfer.effectAllowed = 'move'
      setTimeout(() => row.classList.add('vf-img-dragging'), 0)
    })
    row.addEventListener('dragend', () => {
      dragIndex = null
      list.querySelectorAll('.vf-image-row').forEach(r => r.classList.remove('vf-img-dragging', 'vf-img-drag-over'))
    })
    row.addEventListener('dragover', e => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      list.querySelectorAll('.vf-image-row').forEach(r => r.classList.remove('vf-img-drag-over'))
      if (parseInt(row.dataset.index) !== dragIndex) row.classList.add('vf-img-drag-over')
    })
    row.addEventListener('dragleave', () => row.classList.remove('vf-img-drag-over'))
    row.addEventListener('drop', e => {
      e.preventDefault()
      const dropIndex = parseInt(row.dataset.index)
      if (dragIndex === null || dragIndex === dropIndex) return
      const imgs = readPkgAdmImages(pkgId)
      const [moved] = imgs.splice(dragIndex, 1)
      imgs.splice(dropIndex, 0, moved)
      renderPkgAdmImages(pkgId, imgs)
    })
  })
}

function readPkgAdmImages(pkgId) {
  const rows = document.querySelectorAll(`#pkg-adm-images-${pkgId} .vf-image-row`)
  return Array.from(rows).map(row => ({
    url: row.querySelector('.vf-img-url').value.trim(),
    alt: row.querySelector('.vf-img-alt').value.trim(),
    name: row.querySelector('.vf-img-name')?.value.trim() || '',
  }))
}

window.handlePkgAdmImageUpload = async function(input, pkgId, index) {
  const file = input.files[0]
  if (!file) return
  if (!appState.session) return showToast('Admin login required', 'error')

  const ext  = file.name.split('.').pop()
  const path = `pkg-${pkgId}-${Date.now()}-${index}.${ext}`

  const row = input.closest('.vf-image-row')
  const label = row.querySelector('.vf-img-upload-btn')
  label.textContent = 'Uploading…'

  try {
    const { error: upErr } = await supabase.storage.from('package-images').upload(path, file, { upsert: true })
    if (upErr) throw upErr
    const { data: { publicUrl } } = supabase.storage.from('package-images').getPublicUrl(path)

    row.querySelector('.vf-img-url').value = publicUrl
    row.querySelector('.vf-img-name').value = file.name
    row.querySelector('.vf-img-preview-wrap').innerHTML =
      `<img class="vf-img-thumb" src="${publicUrl}" alt="" /><span class="vf-img-filename" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>`
    label.textContent = '↺ Replace photo'
    showToast('Photo uploaded', 'success')
  } catch (err) {
    console.error(err)
    showToast('Upload failed: ' + err.message, 'error')
    label.textContent = '↑ Upload photo'
  }
}

// Multi-file upload — mirrors addVfImagesMulti's parallel-upload pattern.
window.addPkgAdmImagesMulti = async function(input, pkgId) {
  const files = Array.from(input.files)
  input.value = '' // reset so the same files can be re-selected later
  if (!files.length) return
  if (!appState.session) return showToast('Admin login required', 'error')

  const existing   = readPkgAdmImages(pkgId)
  const startIndex = existing.length
  const newEntries = files.map(f => ({ url: '', alt: '', name: f.name }))
  renderPkgAdmImages(pkgId, [...existing, ...newEntries])

  const list = document.getElementById(`pkg-adm-images-${pkgId}`)

  await Promise.all(files.map(async (file, i) => {
    const rowIndex = startIndex + i
    const row   = list.querySelector(`.vf-image-row[data-index="${rowIndex}"]`)
    const label = row?.querySelector('.vf-img-upload-btn')
    if (label) label.textContent = 'Uploading…'

    try {
      const ext  = file.name.split('.').pop()
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `pkg-${pkgId}-${Date.now()}-${i}-${safe}`

      const { error: upErr } = await supabase.storage.from('package-images').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('package-images').getPublicUrl(path)

      if (row) {
        row.querySelector('.vf-img-url').value  = publicUrl
        row.querySelector('.vf-img-name').value = file.name
        row.querySelector('.vf-img-preview-wrap').innerHTML =
          `<img class="vf-img-thumb" src="${publicUrl}" alt="" /><span class="vf-img-filename" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>`
        if (label) label.textContent = '↺ Replace photo'
      }
    } catch (err) {
      console.error(err)
      showToast(`Failed: ${file.name} — ${err.message}`, 'error')
      if (label) label.textContent = '↑ Upload photo'
    }
  }))
}

function removePkgAdmImage(pkgId, index) {
  const imgs = readPkgAdmImages(pkgId)
  imgs.splice(index, 1)
  renderPkgAdmImages(pkgId, imgs)
}
window.removePkgAdmImage = removePkgAdmImage

// Setup/decor items included in every cafe booking (Food & Beverages left out
// — food is arranged separately, not part of the online package price).
// Feeds The Setting package card's checklist, replacing the venue page's
// "What's included" section for the packages flow (see renderVenueDetail).
// Mirrors the "sharedSetup" list there — keep both in sync if it changes.
// The setup every venue gets — also shown venue-independently on the
// /packages page's Setting card. Venue-specific extras (metadata.includes)
// are appended by venueSetupLabels() once a venue is in play.
const SHARED_SETUP_LABELS = [
  'Fresh Fruits', 'Fresh Flowers', 'Wax Candles', 'Electric Candles',
  'Macrame Tent', 'Macrame Umbrella', 'Portable Speaker',
  'Board with Message', 'Cutlery & Essentials',
  'Setup & cleanup', 'Dedicated host support',
]
function venueSetupLabels(venue) {
  const meta = venue?.metadata || {}
  return [...SHARED_SETUP_LABELS, ...(meta.includes || [])]
}

// Canonical occasion list — single source for the /packages page chips, the
// venue guest-step select, and the admin edit modal (and later for
// packages.occasion values — Phase 2.5). Do NOT fork copies of this list:
// occasion matching is string-equality across all three surfaces.
const OCCASIONS = ['Birthday', 'Anniversary', 'Proposal', 'Date Night', 'Movie Night', 'Bridal Shower', 'Baby Shower', 'Graduation', 'Just Because']

// Purely decorative — one emoji per occasion chip (/packages page). Missing
// keys just render no emoji, never a crash.
const OCCASION_EMOJI = {
  'Birthday': '🎂', 'Anniversary': '💍', 'Proposal': '💐', 'Date Night': '🌙', 'Movie Night': '🎬',
  'Bridal Shower': '👰', 'Baby Shower': '🍼', 'Graduation': '🎓', 'Just Because': '✨',
}

// Occasion chip redesign (2026-07-03): circular doodle icons replacing the
// plain-emoji pills. Same stroke-based line-art language as PKG_TIER_ICON_SVG
// below, just per-occasion instead of per-tier, so the whole page draws from
// one consistent icon style rather than emoji + line-art mixed together.
const OCCASION_ICON_FALLBACK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2Z"/></svg>'
const OCCASION_ICON_SVG = {
  'Birthday': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="9" rx="1.5"/><path d="M4 15.5h16"/><path d="M12 11V6.5"/><path d="M12 6.5c-.9 0-1.6-.7-1.6-1.6 0-.9 1.6-2.4 1.6-2.4s1.6 1.5 1.6 2.4c0 .9-.7 1.6-1.6 1.6Z"/></svg>',
  'Anniversary': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="15" r="4.3"/><circle cx="15" cy="15" r="4.3"/></svg>',
  'Proposal': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15.5" r="5"/><path d="M12 10.5 9.7 6.8 12 4l2.3 2.8Z"/></svg>',
  'Date Night': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.8 4.6a8 8 0 1 0 0 15.4 6.6 6.6 0 0 1 0-15.4Z"/><path d="M19 4.2l.55 1.5L21 6.3l-1.45.6L19 8.4l-.55-1.5L17 6.3l1.45-.6Z"/></svg>',
  'Movie Night': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Z"/><path d="M4 10l1.4-4h13.2l1.4 4"/><path d="M7.3 6l1.4 4M11.3 6l1.4 4M15.3 6l1.4 4"/></svg>',
  'Bridal Shower': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 13.5v7"/><circle cx="12" cy="9.2" r="1.9"/><circle cx="8.8" cy="11" r="1.9"/><circle cx="15.2" cy="11" r="1.9"/><circle cx="10" cy="6.6" r="1.5"/><circle cx="14" cy="6.6" r="1.5"/></svg>',
  'Baby Shower': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5h4v3.2h1a1 1 0 0 1 1 1v11.3a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V7.7a1 1 0 0 1 1-1h1V3.5Z"/><path d="M8 12h8"/></svg>',
  'Graduation': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6 2 10l10 4 10-4-10-4Z"/><path d="M6 12v4c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8v-4"/><path d="M20 10.4V16"/></svg>',
  'Just Because': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3l1.2 3.8L16 8l-3.8 1.2L11 13l-1.2-3.8L6 8l3.8-1.2Z"/><path d="M18 13.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z"/></svg>',
}
function occasionIconHtml(o) {
  return OCCASION_ICON_SVG[o] || OCCASION_ICON_FALLBACK
}

// Rotating tint pairs (background + icon color) for the chip circles — drawn
// from the site's existing boho palette rather than new one-off colors, so
// the chip row doesn't introduce a fifth accent scheme. Cycles by index
// rather than a hand-picked color per occasion — simpler to maintain, and
// Airbnb-style category rows don't rely on "meaningful" color either.
const OCCASION_CHIP_TINTS = [
  { bg: 'var(--boho-pink)', fg: 'var(--boho-accent-pink)' },
  { bg: 'var(--boho-sage)', fg: 'var(--boho-accent-sage)' },
  { bg: 'var(--boho-lavender)', fg: 'var(--boho-accent-lavender)' },
  { bg: 'var(--boho-peach)', fg: 'var(--boho-accent-rose)' },
]

// Small line icons for package tier cards (/packages, the homepage section,
// and the venue-first tier step all share this) — matches the site's
// .service-icon-wrap line-icon style. Keyed by tier.key; unknown/future keys
// (Phase 2.5 occasion packages, or an admin-added tier) fall back to the
// sparkle so a new tier never renders with a missing icon.
const PKG_TIER_ICON_FALLBACK =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>'
const PKG_TIER_ICON_SVG = {
  setting: PKG_TIER_ICON_FALLBACK,
  moment: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="1.5"/><path d="M3 12h18M12 8v13"/><path d="M12 8c-1.4-4-6.2-3.6-6-1 .1 1.6 2.3 1.3 6 1Z"/><path d="M12 8c1.4-4 6.2-3.6 6-1-.1 1.6-2.3 1.3-6 1Z"/></svg>',
  story: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5l1.8-2.4A1 1 0 0 1 9.1 3h5.8a1 1 0 0 1 .8.6L17.5 6H21a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="3.6"/></svg>',
}
function pkgTierIconHtml(key) {
  return `<div class="pkg-card-icon" aria-hidden="true">${PKG_TIER_ICON_SVG[key] || PKG_TIER_ICON_FALLBACK}</div>`
}

// Image carousel at the top of a .pkg-card, admin-managed via the Packages
// panel (packages.images, same [{url,alt,name}] shape as venues.images).
// Empty/missing images → '' so the caller falls back to pkgTierIconHtml —
// every tier still renders fine before any photos are uploaded. A single
// image renders as a static (non-interactive) photo; dots/arrows only appear
// once there's something to navigate between. Nav is event-delegated (see
// setupPkgCarouselDelegation, wired once at bootstrap) rather than
// per-instance listeners, since cards on all three surfaces get torn down
// and rebuilt on every re-render (occasion/tier selection, page nav).
function pkgCardMediaHtml(images, name) {
  const imgs = (images || []).filter(img => img?.url)
  if (!imgs.length) return ''
  const slides = imgs.map(img =>
    `<img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || name || '')}" loading="lazy" />`
  ).join('')
  const controls = imgs.length > 1 ? `
      <button type="button" class="pkg-card-media-arrow pkg-card-media-arrow--prev" aria-label="Previous photo">&lsaquo;</button>
      <button type="button" class="pkg-card-media-arrow pkg-card-media-arrow--next" aria-label="Next photo">&rsaquo;</button>
      <div class="pkg-card-media-dots">
        ${imgs.map((_, i) => `<button type="button" class="pkg-card-media-dot${i === 0 ? ' pkg-card-media-dot--active' : ''}" data-index="${i}" aria-label="Photo ${i + 1}"></button>`).join('')}
      </div>` : ''
  return `
    <div class="pkg-card-media" data-index="0">
      <div class="pkg-card-media-track">${slides}</div>
      ${controls}
    </div>`
}

// Media if there are photos, otherwise a full-bleed tinted placeholder band
// with the tier's doodle icon centered large — never both, never neither.
// The placeholder deliberately shares .pkg-card-media's geometry (same
// negative-margin bleed, same aspect ratio) so photo-less cards — notably the
// occasion packages (Date Night/Movie Night), which launched without images —
// keep the same silhouette as photo cards instead of collapsing to a bare
// 44px corner icon over a white void (2026-07-03 design-critique fix). Use
// this (not pkgTierIconHtml directly) at the top of every .pkg-card so all
// three render sites degrade the same way.
function pkgCardTopHtml(tier, key) {
  const media = pkgCardMediaHtml(tier.images, tier.name)
  if (media) return media
  return `
    <div class="pkg-card-media pkg-card-media--placeholder" aria-hidden="true">
      <div class="pkg-card-media-ph-icon">${PKG_TIER_ICON_SVG[key] || PKG_TIER_ICON_FALLBACK}</div>
    </div>`
}

function pkgCarouselGoTo(mediaEl, index) {
  const track = mediaEl.querySelector('.pkg-card-media-track')
  const total = track?.children.length || 0
  if (!track || !total) return
  const clamped = Math.max(0, Math.min(index, total - 1))
  mediaEl.dataset.index = String(clamped)
  track.style.transform = `translateX(-${clamped * 100}%)`
  mediaEl.querySelectorAll('.pkg-card-media-dot').forEach((dot, i) => {
    dot.classList.toggle('pkg-card-media-dot--active', i === clamped)
  })
}

function pkgCarouselNav(mediaEl, delta) {
  const current = parseInt(mediaEl.dataset.index || '0', 10)
  const total = mediaEl.querySelector('.pkg-card-media-track')?.children.length || 1
  // Wrap around rather than stopping dead at the ends — nicer for a small
  // 2-4 photo set browsed with repeated arrow taps.
  pkgCarouselGoTo(mediaEl, (current + delta + total) % total)
}

// Registered once at bootstrap (not per-card): click delegation for
// arrows/dots, plus a lightweight touch-swipe listener. Both scoped to
// .pkg-card-media so they never interfere with the card's own CTA/link.
function setupPkgCarouselDelegation() {
  document.addEventListener('click', e => {
    const control = e.target.closest('.pkg-card-media-arrow, .pkg-card-media-dot')
    if (!control) return
    const mediaEl = control.closest('.pkg-card-media')
    if (!mediaEl) return
    e.preventDefault()
    e.stopPropagation() // don't let the click fall through to the card's own link/CTA
    if (control.classList.contains('pkg-card-media-dot')) {
      pkgCarouselGoTo(mediaEl, parseInt(control.dataset.index, 10))
    } else {
      pkgCarouselNav(mediaEl, control.classList.contains('pkg-card-media-arrow--prev') ? -1 : 1)
    }
  })

  let touchStartX = null
  let touchMediaEl = null
  document.addEventListener('touchstart', e => {
    touchMediaEl = e.target.closest('.pkg-card-media')
    touchStartX = touchMediaEl ? e.touches[0].clientX : null
  }, { passive: true })
  document.addEventListener('touchend', e => {
    if (!touchMediaEl || touchStartX === null) return
    const dx = e.changedTouches[0].clientX - touchStartX
    if (Math.abs(dx) > 40) pkgCarouselNav(touchMediaEl, dx < 0 ? 1 : -1)
    touchMediaEl = null
    touchStartX = null
  }, { passive: true })

  // Auto-advance every multi-photo carousel currently in the DOM. Re-queries
  // each tick rather than holding per-card timers, so it survives the frequent
  // teardown/rebuild of these cards (occasion/tier selection, page nav) with no
  // lifecycle bookkeeping. Skips single-photo cards and any card the user is
  // hovering, so a deliberate browse isn't yanked forward mid-look.
  setInterval(() => {
    if (document.hidden || prefersReducedMotion()) return
    document.querySelectorAll('.pkg-card-media').forEach(mediaEl => {
      const total = mediaEl.querySelector('.pkg-card-media-track')?.children.length || 0
      if (total < 2) return
      if (typeof mediaEl.matches === 'function' && mediaEl.matches(':hover')) return
      if (!elInViewport(mediaEl)) return
      const current = parseInt(mediaEl.dataset.index || '0', 10)
      pkgCarouselGoTo(mediaEl, (current + 1) % total)
    })
  }, 4500)
}

// Packages visible for an occasion. If the occasion has its own dedicated
// package(s) (Phase 2.5 — Date Night, Movie Night), those REPLACE the
// universal Setting/Moment/Story ladder entirely, rather than augmenting it —
// deliberate choice (docs/PHASE2_PACKAGES_FIRST_PLAN.md Phase 2.5 #2).
// Occasions with no dedicated package (Birthday, Proposal, Anniversary, etc.)
// keep seeing the universal three, unchanged. Called by BOTH the /packages
// page and the venue-first tier step (showPackageStep) so the two surfaces
// can never drift.
function visiblePackagesFor(occasion) {
  if (occasion) {
    const specific = PACKAGE_TIER_ORDER.filter(key => PACKAGE_TIERS[key]?.occasion === occasion)
    if (specific.length) return specific
  }
  return PACKAGE_TIER_ORDER.filter(key => !PACKAGE_TIERS[key]?.occasion)
}

// A package is "serviceable" at a venue if every add-on it needs is actually
// in that venue's catalog. Universal tiers tolerate gaps (existing behavior —
// selectPackageTier silently drops what's missing; fine for a nice-to-have
// like Skyshots). Occasion-specific tiers cannot tolerate this: the whole
// premise is the themed add-on (a Movie Night without Movie Screening isn't
// Movie Night) — docs/PHASE2_PACKAGES_FIRST_PLAN.md Phase 2.5 #3. A package
// that can't be served must be hidden, not silently downgraded.
function packageServiceableAt(tier, catalog) {
  if (!tier?.occasion) return true
  return (tier.addons || []).every(id => catalog.some(a => a.id === id))
}

// Occasion -> default tier. This is the AOV lever; the customer can still switch.
// Date Night / Movie Night point at their own occasion-specific "classic"
// package (Phase 2.5) — visiblePackagesFor() replaces the universal ladder
// with just that occasion's packages, so the default must live inside it.
const OCCASION_DEFAULT_TIER = {
  'Proposal': 'story', 'Anniversary': 'story',
  'Birthday': 'moment', 'Bridal Shower': 'moment', 'Baby Shower': 'moment',
  'Date Night': 'date_night_classic', 'Movie Night': 'movie_night_classic',
  'Just Because': 'setting',
}
function defaultTierForOccasion(occasion) {
  return OCCASION_DEFAULT_TIER[occasion] || 'setting'
}

// ── Packages-first entry: the /packages page (Phase 2) ─────────────────────
// docs/PHASE2_PACKAGES_FIRST_PLAN.md. Occasion → tier → venue, then hands off
// to the regular venue page via appState.pendingPackage. The pending tier is
// consumed AFTER the guest step through the exact same selectPackageTier()
// call the venue-first flow uses — one code path, so the two entry points
// can't drift.
const PKG_PAGE_BASE_ADULTS = 2 // "From ₹X" baseline; real price re-firms at the guest step
let pkgPageState = { occasion: '', tierKey: null, city: '' }

// Venues that can actually serve the packages flow right now (cafe +
// packages_enabled, or QA override — packageFlowActive decides).
function pkgEnabledVenues() {
  return (appState.venues || []).filter(v => packageFlowActive(v))
}

function venueCatalog(venueId) {
  return (appState.venueCatalogCache && appState.venueCatalogCache.get(venueId)) || []
}

// Batched add-on catalogs for many venues in ONE query (never per-venue N+1).
// Same row shape as loadVenueAddOns(); cached in appState.venueCatalogCache.
async function loadCatalogsForVenues(venueIds) {
  if (!appState.venueCatalogCache) appState.venueCatalogCache = new Map()
  const missing = venueIds.filter(id => !appState.venueCatalogCache.has(id))
  if (!missing.length) return appState.venueCatalogCache
  try {
    const { data, error } = await supabase
      .from('add_ons')
      .select('*, venue_add_ons!inner(venue_id)')
      .eq('is_active', true)
      .in('venue_add_ons.venue_id', missing)
      .order('sort_order')
    if (error) throw error
    missing.forEach(id => appState.venueCatalogCache.set(id, []))
    const rows = data || []
    rows.forEach(row => {
      const { venue_add_ons, ...addon } = row
      const junctions = venue_add_ons || []
      junctions.forEach(j => {
        const list = appState.venueCatalogCache.get(j.venue_id)
        if (list) list.push(addon)
      })
    })
  } catch (err) {
    console.error('loadCatalogsForVenues:', err)
  }
  return appState.venueCatalogCache
}

async function showPackagesPage(push = true, opts = {}) {
  showPage('packages-page')
  document.title = 'Picnic Packages — The Picnic Stories'
  if (push) history.pushState({ page: 'packages' }, document.title, '/packages')
  pkgPageState = { occasion: opts.occasion || '', tierKey: opts.tierKey || null, city: '' }
  const el = document.getElementById('packages-content')
  if (!el) return
  el.innerHTML = '<div class="pkgp-loading">Loading packages…</div>'
  if (!packagesLoaded) await loadPackages()
  if (!(appState.venues || []).length) await loadVenues()
  const venues = pkgEnabledVenues()
  await loadCatalogsForVenues(venues.map(v => v.id))
  renderPackagesPage()
  track('packages_page_viewed', {
    occasion: pkgPageState.occasion || null,
    tier: pkgPageState.tierKey || null,
    venues_available: venues.length,
  })

  // Meta Pixel — ViewContent (Phase 2D). Fires once per page view — this
  // function only runs on initial load/SPA-nav into /packages, not on the
  // occasion/tier re-renders that call renderPackagesPage() directly.
  // Mirrors setupVenueCardViewContentObserver's event shape.
  if (typeof fbq === 'function' && venues.length) {
    const visible = visiblePackagesFor(null)
    const prices = visible.flatMap(key => {
      const tier = PACKAGE_TIERS[key]
      return venues.map(v => packageTierPriceAt(v, tier, venueCatalog(v.id), PKG_PAGE_BASE_ADULTS))
    })
    const params = {
      content_ids:  visible,
      content_name: 'Picnic Packages',
      content_type: 'product_group',
      currency:     'INR',
    }
    if (prices.length) params.value = Math.min(...prices)
    fbq('track', 'ViewContent', params)
  }
}

function renderPackagesPage() {
  const el = document.getElementById('packages-content')
  if (!el) return
  const venues = pkgEnabledVenues()

  if (!venues.length) {
    el.innerHTML = `
      <div class="pkgp-wrap">
        <h1 class="pkgp-title">Picnic Packages</h1>
        <p class="pkgp-sub">Packages are coming soon — every picnic can still be booked from its venue page.</p>
        <a class="btn btn--venue-primary pkgp-fallback-btn" href="/#venues-section">Browse venues</a>
      </div>`
    return
  }

  const occasion  = pkgPageState.occasion || null
  const visible   = visiblePackagesFor(occasion)
  const suggested = occasion ? defaultTierForOccasion(occasion) : null
  // Occasion-first (2026-07-03, per Aksheev): the tier ladder stays hidden
  // until an occasion is picked. Exception: an explicit tier (deep link
  // ?tier=..., or the homepage teaser CTAs) skips the gate — the visitor
  // already chose a package, don't make them re-answer a question just to
  // see it. Chips toggle off on re-click, which returns to the hint state.
  const showTiers = !!(occasion || pkgPageState.tierKey)

  // Circular doodle-icon chips (2026-07-03 redesign), labeled "<Occasion>
  // Packages" per Aksheev's direction. "Just Because" is excluded from the
  // chip row (per Aksheev, 2026-07-03): "Just Because Packages" read oddly,
  // and the no-occasion state already shows the universal ladder — the chip
  // was redundant. It stays in OCCASIONS (booking dropdowns, admin, emails).
  const chips = OCCASIONS.filter(o => o !== 'Just Because').map((o, i) => {
    const tint = OCCASION_CHIP_TINTS[i % OCCASION_CHIP_TINTS.length]
    const active = pkgPageState.occasion === o
    return `
      <button type="button" class="pkgp-chip${active ? ' pkgp-chip--active' : ''}" onclick="pkgPageSelectOccasion('${escapeHtml(o)}')">
        <span class="pkgp-chip-circle" style="background:${tint.bg};color:${tint.fg}" aria-hidden="true">${occasionIconHtml(o)}</span>
        <span class="pkgp-chip-label">${escapeHtml(o)} Packages</span>
      </button>`
  }).join('')

  // Merged add-on lookup — names are global (add_ons table), catalogs per-venue.
  const addonById = new Map()
  venues.forEach(v => venueCatalog(v.id).forEach(a => addonById.set(a.id, a)))

  const cards = visible.map((key, idx) => {
    const tier = PACKAGE_TIERS[key]
    const isUniversal = !tier.occasion
    // Ladder copy chains within the tier's own group (universal, or one
    // occasion's own tiers) — never across groups. See showPackageStep for
    // the same logic on the venue-first surface.
    const prevKey  = visible.slice(0, idx).reverse().find(k => (PACKAGE_TIERS[k]?.occasion || null) === (tier.occasion || null))
    const prevTier = prevKey ? PACKAGE_TIERS[prevKey] : null
    // "From ₹X" only counts venues that can actually serve this package —
    // required-addon rule (packageServiceableAt). Universal tiers are always
    // serviceable, so this is a no-op for them.
    const serviceableVenues = venues.filter(v => packageServiceableAt(tier, venueCatalog(v.id)))
    const prices = serviceableVenues.map(v => packageTierPriceAt(v, tier, venueCatalog(v.id), PKG_PAGE_BASE_ADULTS))
    const from = prices.length ? Math.min(...prices) : null
    let incl
    if (!prevTier) {
      // Venue-independent: the shared setup only (venue-specific extras show
      // once a venue is picked — mirrors the venue-first tier step's list).
      const lead = isUniversal ? '' : '<p class="pkg-card-incl-lead">The signature setup, plus:</p>'
      const items = isUniversal
        ? `<ul class="pkg-card-incl">${SHARED_SETUP_LABELS.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
        : `<ul class="pkg-card-incl">${(tier.addons || []).map(id => addonById.get(id)?.name).filter(Boolean).map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
      incl = lead + items
    } else {
      const newIds = (tier.addons || []).filter(id => !(prevTier.addons || []).includes(id))
      const names = newIds.map(id => addonById.get(id)?.name).filter(Boolean)
      incl = `
        <p class="pkg-card-incl-lead">Everything in <strong class="pkg-card-incl-lead-name">${escapeHtml(prevTier.name)}</strong>, plus:</p>
        <ul class="pkg-card-incl">${names.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
    }
    const badge = tier.featured
      ? '<span class="pkg-card-badge">Most picked</span>'
      : (key === suggested ? '<span class="pkg-card-badge pkg-card-badge--suggested">Suggested</span>' : '')
    const active = pkgPageState.tierKey === key
    const priceHtml = from === null
      ? '<div class="pkg-card-price pkg-card-price--unavailable">Not available right now</div>'
      : `<div class="pkg-card-price">${serviceableVenues.length > 1 ? 'From ' : ''}₹${from.toLocaleString('en-IN')}</div><div class="pkg-card-price-note">for upto 6 guests</div>`
    return `
      <div class="pkg-card${tier.featured ? ' pkg-card--featured' : ''}${active ? ' pkg-card--active' : ''}">
        ${badge}
        ${pkgCardTopHtml(tier, key)}
        <h4 class="pkg-card-name">${escapeHtml(tier.name)}</h4>
        <p class="pkg-card-tagline">${escapeHtml(tier.tagline)}</p>
        ${priceHtml}
        ${incl}
        <button type="button" class="btn ${tier.featured ? 'btn--venue-primary' : 'btn--venue-secondary'} pkg-card-cta" ${from === null ? 'disabled' : ''} onclick="pkgPageSelectTier('${escapeHtml(key)}')">${active ? '✓ Selected' : (from === null ? 'Not available' : `Choose ${escapeHtml(tier.name)}`)}</button>
      </div>`
  }).join('')

  // Arch hero (2026-07-03 redesign, brainstorm direction A — replaces the
  // reverted blur-backdrop idea): SHARP photos in tall boho arch masks beside
  // the hero copy. Blur was the wrong treatment — it hid the brand's best
  // asset (the photos themselves) and fell apart on bokeh shots; a sharp
  // arch crop sidesteps that failure mode entirely. Photo priority:
  // 1. Admin's explicit pick (site_settings.packages_hero_image_url, Hero
  //    Image admin tab — mechanism from the backdrop attempt, reused as-is).
  // 2. Universal tiers' own carousel photos (featured tier first) — stable
  //    across occasion-chip clicks since it ignores which tiers are visible.
  // 3. Fewer than 1 photo → plain centered hero (the pre-arch look); the
  //    side arch renders only when a 2nd distinct photo exists.
  const tierHeroPhotos = PACKAGE_TIER_ORDER
    .filter(k => !PACKAGE_TIERS[k]?.occasion)
    .sort((a, b) => (PACKAGE_TIERS[b].featured ? 1 : 0) - (PACKAGE_TIERS[a].featured ? 1 : 0))
    .flatMap(k => (PACKAGE_TIERS[k].images || []).map(img => img?.url).filter(Boolean))
  const heroPhotos = [...new Set([packagesHeroImageUrl, ...tierHeroPhotos].filter(Boolean))].slice(0, 2)
  const heroArches = heroPhotos.length ? `
        <div class="pkgp-hero-arches" aria-hidden="true">
          <div class="pkgp-arch pkgp-arch--main"><img src="${escapeHtml(heroPhotos[0])}" alt="" /></div>
          ${heroPhotos[1] ? `<div class="pkgp-arch pkgp-arch--side"><img src="${escapeHtml(heroPhotos[1])}" alt="" loading="lazy" /></div>` : ''}
        </div>` : ''
  // Hand-drawn line doodles (same stroke language as the occasion chips /
  // tier icons) — garnish only, deliberately capped at two.
  const heroDoodles = `
        <svg class="pkgp-doodle pkgp-doodle--sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.6"/><path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6 6l1.3 1.3M16.7 16.7 18 18M18 6l-1.3 1.3M7.3 16.7 6 18"/></svg>
        <svg class="pkgp-doodle pkgp-doodle--sprig" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21c0-6 .2-10 .6-14"/><path d="M12.4 9C10.6 8.2 9 6.6 8.6 4.2c2.6.2 4.2 1.8 3.8 4.8Z"/><path d="M12.2 12.5c1.8-.8 3.4-2.4 3.8-4.8-2.6.2-4.2 1.8-3.8 4.8Z"/><path d="M12 16.5c-1.8-.8-3.6-1.5-4.6-3.8 2.4-.4 4.2.9 4.6 3.8Z"/></svg>`

  el.innerHTML = `
    <div class="pkgp-wrap">
      <div class="pkgp-hero${heroPhotos.length ? ' pkgp-hero--split' : ''}">
        ${heroDoodles}
        <div class="pkgp-hero-copy">
          <p class="pkgp-eyebrow">Curated Picnic Experiences</p>
          <h1 class="pkgp-title">Picnic Packages</h1>
          <p class="pkgp-sub">Bouquets at golden hour, bonfires under the stars, a screening just for two — pick the picnic that already feels like you, then choose where it happens.</p>
        </div>
        ${heroArches}
      </div>
      <div class="pkgp-occasions">
        <p class="pkgp-step-label">What's the occasion?</p>
        <div class="pkgp-chips">${chips}</div>
      </div>
      ${showTiers ? `
      <div class="pkgp-divider" aria-hidden="true"><span>✦</span></div>
      <div class="pkgp-tiers">
        <p class="pkgp-step-label">Choose your package</p>
        <div class="pkg-cards pkg-cards--page">${cards}</div>
      </div>` : `
      <p class="pkgp-pick-hint">Pick an occasion above — we'll show you the packages made for it.</p>`}
      ${pkgPageState.tierKey ? renderPkgVenuePicker(venues) : ''}
    </div>`

  const grid = document.getElementById('pkgp-venue-grid')
  if (grid) grid.addEventListener('click', onPkgVenueGridClick)
}

function renderPkgVenuePicker(venues) {
  const tier = PACKAGE_TIERS[pkgPageState.tierKey]
  if (!tier) return ''
  // Required-addon rule: only venues that can actually serve this tier's
  // add-ons are offered here (packageServiceableAt — no-op for universal
  // tiers, which tolerate gaps).
  const serviceable = venues.filter(v => packageServiceableAt(tier, venueCatalog(v.id)))
  if (!serviceable.length) {
    return `
      <div class="pkgp-venues" id="pkgp-venues">
        <p class="pkgp-step-label">Where should ${escapeHtml(tier.name)} happen?</p>
        <p class="venues-error">Not currently available at any venue — check back soon, or choose a different package.</p>
      </div>`
  }
  // City filter (2026-07-03, per Aksheev): the venue step is the natural home
  // for it — occasion and package are city-agnostic decisions, the venue is
  // the first city-bound one. Pills reuse the homepage .city-pill styling.
  // Cities are derived from the SERVICEABLE list (not all venues), so a city
  // whose venues can't serve this tier never appears as a dead filter. An
  // invalid remembered city (e.g. tier changed underneath it) falls back to
  // all — never an empty grid.
  const cities = [...new Set(serviceable.map(v => v.city).filter(Boolean))].sort()
  const activeCity = cities.includes(pkgPageState.city) ? pkgPageState.city : ''
  const shown = activeCity ? serviceable.filter(v => v.city === activeCity) : serviceable
  const cityPills = cities.length > 1 ? `
      <div class="pkgp-city-filter" role="group" aria-label="Filter venues by city">
        <button type="button" class="city-pill${!activeCity ? ' active' : ''}" onclick="pkgPageSelectCity('')">All cities</button>
        ${cities.map(c => `<button type="button" class="city-pill${activeCity === c ? ' active' : ''}" onclick="pkgPageSelectCity('${escapeHtml(c)}')">📍 ${escapeHtml(c)}</button>`).join('')}
      </div>` : ''
  // Same cards as the homepage grid (venueCardHtml) — only the price line
  // differs: it shows THIS tier's firm price at the venue.
  const cards = shown.map(v => {
    const price = packageTierPriceAt(v, tier, venueCatalog(v.id), PKG_PAGE_BASE_ADULTS)
    const priceHtml = `₹${price.toLocaleString('en-IN')} <span class="venue-card-price-sub">for ${PKG_PAGE_BASE_ADULTS} adults</span>`
    return venueCardHtml(v, { priceHtml })
  }).join('')
  return `
    <div class="pkgp-venues" id="pkgp-venues">
      <p class="pkgp-step-label">Where should ${escapeHtml(tier.name)} happen?</p>
      ${cityPills}
      <div class="venue-grid pkgp-venue-grid" id="pkgp-venue-grid">${cards}</div>
      <p class="pkgp-venues-note">Prices shown for ${PKG_PAGE_BASE_ADULTS} adults — you'll pick date, time and guests next.</p>
    </div>`
}

// Card clicks continue the packages flow in-app (mirrors the venues-grid
// delegation): plain left-click → pkgPageSelectVenue; modifier/middle clicks
// fall through to the browser (new tab opens the venue page organically,
// without the package preselected — by design, state doesn't cross tabs).
function onPkgVenueGridClick(e) {
  // Same ordering issue as the venuesGrid handler above: this listener is on
  // a closer ancestor than the document-level carousel delegation, so it
  // fires first and must ignore carousel-control clicks itself.
  if (e.target.closest('.venue-card-media-arrow, .venue-card-media-dot')) return
  const card = e.target.closest('[data-venue-id]')
  if (!card) return
  if (e.defaultPrevented || e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  pkgPageSelectVenue(parseInt(card.dataset.venueId, 10))
}

function pkgPageSelectOccasion(occ) {
  pkgPageState.occasion = pkgPageState.occasion === occ ? '' : occ
  // Keep the chosen tier only if it's still visible under the new occasion.
  if (pkgPageState.tierKey && !visiblePackagesFor(pkgPageState.occasion || null).includes(pkgPageState.tierKey)) {
    pkgPageState.tierKey = null
  }
  renderPackagesPage()
  track('packages_occasion_selected', { occasion: pkgPageState.occasion || null })
}

function pkgPageSelectCity(city) {
  pkgPageState.city = city || ''
  renderPackagesPage()
  // Full re-render resets scroll context — bring the venue step back into
  // view so the filter click doesn't appear to do nothing.
  const target = document.getElementById('pkgp-venues')
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  track('packages_city_selected', { city: city || null, tier: pkgPageState.tierKey })
}

function pkgPageSelectTier(key) {
  if (!PACKAGE_TIERS[key]) return
  pkgPageState.tierKey = key
  renderPackagesPage()
  const target = document.getElementById('pkgp-venues')
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  track('packages_tier_selected', { tier: key, occasion: pkgPageState.occasion || null })
}

// Reveal homepage packages entry points (hero CTA + "Our Packages" section)
// only when at least one venue can actually serve the flow — no dead links,
// no CLS from a section that immediately hides. Called from loadVenues()
// once appState.venues is populated.
function revealPackagesEntryPoints() {
  const show = pkgEnabledVenues().length > 0
  const heroCta = document.getElementById('hero-packages-cta')
  if (heroCta) heroCta.style.display = show ? '' : 'none'
  if (show) {
    renderHomePackagesSection()
  } else {
    const section = document.getElementById('packages-section')
    if (section) section.style.display = 'none'
  }
}

// Homepage "Our Packages" section (Phase 2B, docs/PHASE2_PACKAGES_FIRST_PLAN.md).
// A matched-height skeleton lives in index.html (#packages-section, visible from
// first paint so it reserves the final height and never causes CLS — see the
// Jul-4 perf fix in docs/SPEED_REGRESSION_2026-07-04.md). This REPLACES the
// skeleton cards with the universal tiers' "From ₹X" prices (min across enabled
// venues, 2 adults — same PKG_PAGE_BASE_ADULTS baseline as the /packages page, so
// the two surfaces never show different numbers), same height so nothing shifts.
// Only hides the section outright if no venue serves packages (never in prod). Awaits
// its own data (packages + venue catalogs) rather than trusting call order
// against the concurrent bootstrap loadPackages()/loadVenues() calls.
async function renderHomePackagesSection() {
  const section = document.getElementById('packages-section')
  const grid = document.getElementById('packages-home-grid')
  if (!section || !grid) return

  const venues = pkgEnabledVenues()
  if (!venues.length) { section.style.display = 'none'; return }

  if (!packagesLoaded) await loadPackages()
  await loadCatalogsForVenues(venues.map(v => v.id))

  // Homepage teaser only shows universal tiers (no occasion context here —
  // occasion-specific packages, once they exist, surface on /packages itself).
  const visible = visiblePackagesFor(null)
  if (!visible.length) { section.style.display = 'none'; return }

  grid.innerHTML = visible.map(key => {
    const tier = PACKAGE_TIERS[key]
    const prices = venues.map(v => packageTierPriceAt(v, tier, venueCatalog(v.id), PKG_PAGE_BASE_ADULTS))
    const from = Math.min(...prices)
    const occasions = OCCASIONS.filter(o => defaultTierForOccasion(o) === key).slice(0, 3)
    const occasionLine = occasions.length
      ? `<p class="pkg-card-occasions">Perfect for ${occasions.map(o => escapeHtml(o)).join(', ')}</p>`
      : ''
    const badge = tier.featured ? '<span class="pkg-card-badge">Most picked</span>' : ''
    return `
      <div class="pkg-card${tier.featured ? ' pkg-card--featured' : ''}">
        ${badge}
        ${pkgCardTopHtml(tier, key)}
        <h4 class="pkg-card-name">${escapeHtml(tier.name)}</h4>
        <p class="pkg-card-tagline">${escapeHtml(tier.tagline)}</p>
        <div class="pkg-card-price">From ₹${from.toLocaleString('en-IN')}</div>
        <div class="pkg-card-price-note">for upto 6 guests</div>
        ${occasionLine}
        <a class="btn ${tier.featured ? 'btn--venue-primary' : 'btn--venue-secondary'} pkg-card-cta" href="/packages?tier=${encodeURIComponent(key)}" onclick="event.preventDefault(); showPackagesPage(true, {tierKey:'${escapeHtml(key)}'})">Explore ${escapeHtml(tier.name)}</a>
      </div>`
  }).join('')

  section.style.display = ''
}

function pkgPageSelectVenue(venueId) {
  if (!pkgPageState.tierKey) return
  const pending = { occasion: pkgPageState.occasion || null, tierKey: pkgPageState.tierKey, venueId }
  appState.pendingPackage = pending
  try { sessionStorage.setItem('ps_pending_pkg', JSON.stringify(pending)) } catch (err) { /* private mode */ }
  track('packages_venue_selected', { venue_id: venueId, tier: pending.tierKey, occasion: pending.occasion })
  showVenuePage(venueId)
}

const CAFE_SLOTS = [
  { key: 'morning',   label: 'Morning',   time: '9 AM – 12 PM',  icon: '🌅' },
  { key: 'afternoon', label: 'Afternoon', time: '1 PM – 4 PM',   icon: '☀️' },
  { key: 'evening',   label: 'Evening',   time: '5 PM – 8 PM',   icon: '🌙' },
]

// Fetch booked data — type-aware.
// maxConcurrentSetups: from venue.max_concurrent_setups (default 1).
//
// Café returns:   { venueType, slotMap: Map<date, Map<slot_key, count>>, maxConcurrentSetups }
// BnB returns:    { venueType, adminBlockedDates: Set<date>, bookingCountMap: Map<date, count>, maxConcurrentSetups }
//
// slotMap uses a counter (not a Set) so concurrent-capable venues work correctly.
// BnB queries bookings directly for per-date occupancy counts instead of relying on
// venue_availability booking-source rows (which are no longer written after this migration).
async function fetchBookedData(venueId, venueType, maxConcurrentSetups = 1) {
  try {
    if (venueType === 'cafe' || venueType === 'partner_bnb') {
      // Three parallel fetches:
      // 1. Confirmed slot bookings (via SECURITY DEFINER RPC)
      // 2. Admin full-day blocks (time_slot IS NULL)
      // 3. Admin slot-specific blocks (time_slot IS NOT NULL)
      const [slotsResult, adminFullDayResult, adminSlotResult] = await Promise.all([
        supabase.rpc('get_cafe_booked_slots', { p_venue_id: venueId }),
        supabase.from('venue_availability').select('date')
          .eq('venue_id', venueId).eq('source', 'admin').is('time_slot', null),
        supabase.from('venue_availability').select('date, time_slot')
          .eq('venue_id', venueId).eq('source', 'admin').not('time_slot', 'is', null),
      ])
      if (slotsResult.error) throw slotsResult.error

      // Map<date, Map<slot_key, count>> — one count per confirmed booking per slot
      const slotMap = new Map()
      for (const b of slotsResult.data || []) {
        const d = typeof b.preferred_date === 'string' ? b.preferred_date : localDateStr(new Date(b.preferred_date))
        if (!slotMap.has(d)) slotMap.set(d, new Map())
        if (b.time_slot) {
          const counts = slotMap.get(d)
          counts.set(b.time_slot, (counts.get(b.time_slot) || 0) + 1)
        }
      }
      // Full-day admin blocks → every slot at capacity (shows day as fully blocked)
      for (const r of adminFullDayResult.data || []) {
        const counts = new Map()
        CAFE_SLOTS.forEach(s => counts.set(s.key, maxConcurrentSetups))
        slotMap.set(r.date, counts)
      }
      // Slot-specific admin blocks → that slot at capacity (other slots unaffected)
      for (const r of adminSlotResult.data || []) {
        if (!slotMap.has(r.date)) slotMap.set(r.date, new Map())
        slotMap.get(r.date).set(r.time_slot, maxConcurrentSetups)
      }

      return { venueType: 'cafe', slotMap, maxConcurrentSetups }
    } else if (venueType === 'combo') {
      // Combo (whole floor): unavailable on any night ANY child is occupied,
      // plus the combo's own admin blocks. A child is occupied if it has an
      // admin/ical/parent block OR a confirmed direct booking. (Confirmed
      // combo bookings already wrote source='parent' rows onto the children,
      // so they're counted here too — the Reunion has no rows of its own.)
      const { data: kids, error: kErr } = await supabase
        .from('venues').select('id').eq('parent_venue_id', venueId)
      if (kErr) throw kErr
      const childIds = (kids || []).map(k => k.id)

      const [ownBlocks, childBlocks, childBookings] = await Promise.all([
        supabase.from('venue_availability').select('date')
          .eq('venue_id', venueId).in('source', ['admin', 'ical', 'parent']),
        childIds.length
          ? supabase.from('venue_availability').select('date')
              .in('venue_id', childIds).in('source', ['admin', 'ical', 'parent'])
          : Promise.resolve({ data: [] }),
        childIds.length
          ? supabase.rpc('get_booked_dates', { p_venue_ids: childIds })
          : Promise.resolve({ data: [] }),
      ])

      const blocked = new Set()
      for (const r of ownBlocks.data || [])   blocked.add(r.date)
      for (const r of childBlocks.data || []) blocked.add(r.date)
      // Any confirmed child stay night blocks the whole floor, regardless of
      // that child's own capacity — the floor needs every single free.
      for (const b of childBookings.data || []) {
        const s = new Date(b.preferred_date + 'T00:00:00')
        const e = b.checkout_date
          ? new Date(b.checkout_date + 'T00:00:00')
          : new Date(s.getTime() + 86400000)
        for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) blocked.add(localDateStr(d))
      }

      // Reuse the self_managed return shape: binary-blocked, capacity 1.
      return { venueType: 'combo', adminBlockedDates: blocked, bookingCountMap: new Map(), maxConcurrentSetups: 1 }
    } else {
      // BnB: admin blocks from venue_availability (admin/ical/parent).
      //      Booking occupancy computed directly from confirmed bookings.
      //      'parent' = this single is blocked because the whole floor is booked.
      const [adminResult, bookingsResult] = await Promise.all([
        supabase.from('venue_availability').select('date').eq('venue_id', venueId).in('source', ['admin', 'ical', 'parent']),
        supabase.rpc('get_booked_dates', { p_venue_ids: [venueId] }),
      ])
      if (adminResult.error) throw adminResult.error
      if (bookingsResult.error) throw bookingsResult.error

      const adminBlockedDates = new Set((adminResult.data || []).map(r => r.date))

      // Expand each confirmed stay into individual nights and count overlaps per date
      const bookingCountMap = new Map()
      for (const b of bookingsResult.data || []) {
        const start = new Date(b.preferred_date + 'T00:00:00')
        const end   = b.checkout_date
          ? new Date(b.checkout_date + 'T00:00:00')
          : new Date(start.getTime() + 86400000)
        for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
          const ds = localDateStr(d)
          bookingCountMap.set(ds, (bookingCountMap.get(ds) || 0) + 1)
        }
      }

      return { venueType: 'self_managed', adminBlockedDates, bookingCountMap, maxConcurrentSetups }
    }
  } catch (err) {
    console.error('Failed to fetch booked data:', err)
    return { venueType, slotMap: new Map(), adminBlockedDates: new Set(), bookingCountMap: new Map(), maxConcurrentSetups }
  }
}

function formatSelectedDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function calcNights(checkin, checkout) {
  return Math.round((new Date(checkout + 'T00:00:00') - new Date(checkin + 'T00:00:00')) / 86400000)
}

// Build calendar grid HTML — handles both cafe and BnB modes
function buildCalendarHTML(year, month, bookedData) {
  const today     = new Date(); today.setHours(0, 0, 0, 0)
  const isCafe    = bookedData.venueType === 'cafe'
  const DOW       = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  const firstDow  = new Date(year, month, 1).getDay()
  const totalDays = new Date(year, month + 1, 0).getDate()

  // BnB: when a check-in is selected, find the first blocked night after it.
  // That date is a valid checkout target (same-day turnover: guest leaves morning,
  // next guest arrives afternoon). Dates *beyond* that blocker are not selectable.
  let checkoutCutoffDate = null
  if (!isCafe && appState.checkinDate && !appState.checkoutDate) {
    const maxSetups = bookedData.maxConcurrentSetups || 1
    const scan = new Date(appState.checkinDate + 'T00:00:00')
    scan.setDate(scan.getDate() + 1)
    for (let i = 0; i < 366; i++) {
      const ds = localDateStr(scan)
      const isAdminBlocked = bookedData.adminBlockedDates?.has(ds) ?? false
      const bookingCount   = bookedData.bookingCountMap?.get(ds) || 0
      if (isAdminBlocked || bookingCount >= maxSetups) { checkoutCutoffDate = ds; break }
      scan.setDate(scan.getDate() + 1)
    }
  }

  let html = DOW.map(d => `<span class="avail-cal-dow">${d}</span>`).join('')
  for (let i = 0; i < firstDow; i++) html += `<span class="avail-cal-empty"></span>`

  for (let d = 1; d <= totalDays; d++) {
    const date    = new Date(year, month, d); date.setHours(0, 0, 0, 0)
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isPast  = date < today
    const isToday = date.getTime() === today.getTime()

    const maxSetups = bookedData.maxConcurrentSetups || 1
    let isFullyBooked = false
    if (isCafe) {
      const slotCounts = bookedData.slotMap?.get(dateStr)
      // fully booked only when every slot has hit capacity
      isFullyBooked = slotCounts
        ? CAFE_SLOTS.every(s => (slotCounts.get(s.key) || 0) >= maxSetups)
        : false
    } else {
      const isAdminBlocked  = bookedData.adminBlockedDates?.has(dateStr) ?? false
      const bookingCount    = bookedData.bookingCountMap?.get(dateStr) || 0
      isFullyBooked = isAdminBlocked || bookingCount >= maxSetups
    }

    // A booked date is checkout-eligible if it's the first blocker after the selected checkin
    // (all nights in the range are clear; this date is just the boundary/departure day).
    const isCheckoutEligible = !isCafe && !!checkoutCutoffDate && dateStr === checkoutCutoffDate

    const isDisabled = isPast || (isFullyBooked && !isCheckoutEligible)
    const isSelected  = isCafe && appState.selectedDate === dateStr
    const isCheckin   = !isCafe && appState.checkinDate === dateStr
    const isCheckout  = !isCafe && appState.checkoutDate === dateStr
    const isInRange   = !isCafe && appState.checkinDate && appState.checkoutDate &&
      dateStr > appState.checkinDate && dateStr < appState.checkoutDate

    const cls = [
      'avail-cal-day',
      isPast             ? 'avail-cal-day--past'             : '',
      isFullyBooked      ? 'avail-cal-day--booked'           : '',
      isCheckoutEligible ? 'avail-cal-day--checkout-eligible': '',
      isToday            ? 'avail-cal-day--today'            : '',
      isSelected         ? 'avail-cal-day--selected'         : '',
      isCheckin          ? 'avail-cal-day--checkin'          : '',
      isCheckout         ? 'avail-cal-day--checkout'         : '',
      isInRange          ? 'avail-cal-day--in-range'         : '',
      !isDisabled        ? 'avail-cal-day--available'        : '',
    ].filter(Boolean).join(' ')

    // Use data-attributes + delegated listener — never interpolate dateStr into onclick
    const action = isCafe ? 'select-cafe-date' : 'select-bnb-date'
    if (isDisabled) {
      const innerContent = (isFullyBooked && !isCafe)
        ? `${d}<span class="avail-cal-day-booked-dot" aria-hidden="true"></span>`
        : `${d}`
      html += `<span class="${cls}" aria-disabled="true" title="${isFullyBooked ? 'Booked' : ''}">${innerContent}</span>`
    } else {
      html += `<button class="${cls}" data-date="${dateStr}" data-action="${action}" aria-label="${dateStr}">${d}</button>`
    }
  }
  return html
}

// Render the availability calendar widget
function renderAvailabilityCalendar(containerId, bookedData) {
  const container = document.getElementById(containerId)
  if (!container) return

  // Store bookedData so slot picker can reference it
  container._bookedData = bookedData

  const MONTHS  = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December']
  const isCafe  = bookedData.venueType === 'cafe'
  const now     = new Date()
  let year      = now.getFullYear()
  let month     = now.getMonth()

  function draw() {
    const isMinMonth = year === now.getFullYear() && month <= now.getMonth()
    container.innerHTML = `
      <div class="avail-calendar">
        <h3 class="avail-cal-title">Check Availability</h3>
        <div class="avail-cal-header">
          <button class="avail-cal-nav" id="avail-cal-prev" aria-label="Previous month" ${isMinMonth ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="avail-cal-month-label">${MONTHS[month]} ${year}</span>
          <button class="avail-cal-nav" id="avail-cal-next" aria-label="Next month">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <p class="avail-cal-hint">${isCafe ? 'Select a date, then pick a time slot' : 'Click check-in date, then checkout date'}</p>
        <div class="avail-cal-grid" id="avail-cal-grid">
          ${buildCalendarHTML(year, month, bookedData)}
        </div>
        <div class="avail-cal-legend">
          <span class="avail-cal-legend-item"><span class="avail-cal-swatch avail-cal-swatch--booked"></span>${isCafe ? 'All slots taken' : 'Booked'}</span>
          <span class="avail-cal-legend-item"><span class="avail-cal-swatch avail-cal-swatch--available"></span>Available</span>
          ${!isCafe ? '<span class="avail-cal-legend-item"><span class="avail-cal-swatch avail-cal-swatch--checkin"></span>Your stay</span>' : ''}
        </div>
        <div id="avail-slot-picker"></div>
      </div>
    `
    document.getElementById('avail-cal-prev')?.addEventListener('click', () => {
      if (isMinMonth) return
      month--; if (month < 0) { month = 11; year-- }; draw()
    })
    document.getElementById('avail-cal-next')?.addEventListener('click', () => {
      month++; if (month > 11) { month = 0; year++ }; draw()
    })

    // Delegated click handler for calendar days — avoids dateStr in onclick strings
    document.getElementById('avail-cal-grid')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]')
      if (!btn || btn.disabled) return
      const dateStr = btn.dataset.date
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return  // validate format
      if (btn.dataset.action === 'select-cafe-date') selectCalendarDate(dateStr)
      if (btn.dataset.action === 'select-bnb-date')  selectBnbDate(dateStr)
    })

    if (!isCafe) attachBnbHover()
  }

  container._calDraw = draw
  draw()
}

// BnB: hover to preview range before second click
function attachBnbHover() {
  const grid = document.getElementById('avail-cal-grid')
  if (!grid) return
  grid.addEventListener('mouseover', (e) => {
    const btn = e.target.closest('.avail-cal-day--available, .avail-cal-day--checkout-eligible')
    if (!btn || !appState.checkinDate || appState.checkoutDate) return
    const hoverDate = btn.dataset.date
    if (!hoverDate || hoverDate <= appState.checkinDate) return
    grid.querySelectorAll('.avail-cal-day[data-date]').forEach(el => {
      const d = el.dataset.date
      el.classList.toggle('avail-cal-day--hover-range', d > appState.checkinDate && d < hoverDate)
    })
  })
  grid.addEventListener('mouseleave', () => {
    grid.querySelectorAll('.avail-cal-day--hover-range').forEach(el => el.classList.remove('avail-cal-day--hover-range'))
  })
}

// BnB: first click = checkin, second click = checkout
function selectBnbDate(dateStr) {
  if (!appState.checkinDate || appState.checkoutDate) {
    appState.checkinDate  = dateStr
    appState.checkoutDate = null
    // Full re-draw so the first-blocker date renders as a checkout-eligible button
    document.getElementById('avail-calendar-widget')?._calDraw?.() ?? updateBnbCalendarHighlight()
    updateBnbBarState()
    return
  }
  if (dateStr <= appState.checkinDate) {
    appState.checkinDate  = dateStr
    appState.checkoutDate = null
    // Full re-draw so the first-blocker date renders as a checkout-eligible button
    document.getElementById('avail-calendar-widget')?._calDraw?.() ?? updateBnbCalendarHighlight()
    updateBnbBarState()
    return
  }

  // Check that no date in the selected range (checkin inclusive → checkout exclusive) is at capacity
  const calWidget  = document.getElementById('avail-calendar-widget')
  const bookedData = calWidget?._bookedData
  if (bookedData) {
    const maxSetups = bookedData.maxConcurrentSetups || 1
    const start = new Date(appState.checkinDate + 'T00:00:00')
    const end   = new Date(dateStr + 'T00:00:00')
    let conflict = false
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const ds = localDateStr(d)
      const isAdminBlocked = bookedData.adminBlockedDates?.has(ds)
      const bookingCount   = bookedData.bookingCountMap?.get(ds) || 0
      if (isAdminBlocked || bookingCount >= maxSetups) { conflict = true; break }
    }
    if (conflict) {
      showToast('Your selected range includes a fully booked or blocked date. Please pick different dates.', 'error')
      appState.checkinDate  = null
      appState.checkoutDate = null
      updateBnbCalendarHighlight()
      updateBnbBarState()
      return
    }
  }

  appState.checkoutDate = dateStr
  updateBnbCalendarHighlight()
  const checkinInput = document.getElementById('preferred-date')
  if (checkinInput) checkinInput.value = appState.checkinDate
  updateBnbBarState()
}

// Update range classes on calendar grid without full re-render
function updateBnbCalendarHighlight() {
  const grid = document.getElementById('avail-cal-grid')
  if (!grid) return
  grid.querySelectorAll('.avail-cal-day[data-date]').forEach(el => {
    const d = el.dataset.date
    el.classList.remove('avail-cal-day--checkin', 'avail-cal-day--checkout', 'avail-cal-day--in-range')
    if (d === appState.checkinDate)  el.classList.add('avail-cal-day--checkin')
    if (d === appState.checkoutDate) el.classList.add('avail-cal-day--checkout')
    if (appState.checkinDate && appState.checkoutDate && d > appState.checkinDate && d < appState.checkoutDate)
      el.classList.add('avail-cal-day--in-range')
  })
}

// Update sidebar + mobile bar for BnB
function updateBnbBarState() {
  const sidebarBtn     = document.getElementById('sidebar-book-btn')
  const mobileDateText = document.getElementById('mobile-bar-date-text')
  const mobileBookBtn  = document.getElementById('mobile-bar-book-btn')

  if (!appState.checkinDate) {
    if (sidebarBtn)     { sidebarBtn.disabled = true; sidebarBtn.textContent = 'Select check-in date' }
    if (mobileDateText) mobileDateText.textContent = 'Pick dates ↑'
    if (mobileBookBtn)  mobileBookBtn.disabled = true
    return
  }
  if (!appState.checkoutDate) {
    if (sidebarBtn)     { sidebarBtn.disabled = true; sidebarBtn.textContent = 'Now pick checkout date →' }
    if (mobileDateText) mobileDateText.textContent = `Check-in ${formatSelectedDate(appState.checkinDate)} · pick checkout ↑`
    if (mobileBookBtn)  mobileBookBtn.disabled = true
    return
  }
  const nights = calcNights(appState.checkinDate, appState.checkoutDate)
  const label  = `${formatSelectedDate(appState.checkinDate)} → ${formatSelectedDate(appState.checkoutDate)} · ${nights} night${nights > 1 ? 's' : ''}`
  if (sidebarBtn)     { sidebarBtn.disabled = false; sidebarBtn.textContent = 'Select guests →' }
  if (mobileDateText) mobileDateText.textContent = label
  if (mobileBookBtn)  { mobileBookBtn.disabled = false; mobileBookBtn.textContent = 'Select guests →' }
}

// Cafe: date click → show slot picker below calendar
function selectCalendarDate(dateStr) {
  appState.selectedDate     = dateStr
  appState.selectedTimeSlot = null

  document.querySelectorAll('.avail-cal-day--selected').forEach(el => el.classList.remove('avail-cal-day--selected'))
  document.querySelectorAll(`.avail-cal-day[data-date="${dateStr}"]`).forEach(el => el.classList.add('avail-cal-day--selected'))

  const dateInput = document.getElementById('preferred-date')
  if (dateInput) dateInput.value = dateStr

  renderSlotPicker(dateStr)
  updateCafeBarState()
}

// Render time slot buttons below the calendar
function renderSlotPicker(dateStr) {
  const container = document.getElementById('avail-slot-picker')
  if (!container) return
  const calWidget  = document.getElementById('avail-calendar-widget')
  const bookedData = calWidget?._bookedData || { slotMap: new Map(), maxConcurrentSetups: 1 }
  const slotCounts  = bookedData.slotMap?.get(dateStr) || new Map()
  const maxSetups   = bookedData.maxConcurrentSetups || 1
  const formatted  = formatSelectedDate(dateStr)

  container.innerHTML = `
    <div class="avail-slot-picker">
      <p class="avail-slot-label">Pick a time slot for <strong>${formatted}</strong></p>
      <div class="avail-slot-grid">
        ${CAFE_SLOTS.map(slot => {
          const slotCount  = slotCounts.get(slot.key) || 0
          const isBooked   = slotCount >= maxSetups
          const isSelected = appState.selectedTimeSlot === slot.key
          return `<button class="avail-slot-btn ${isBooked ? 'avail-slot-btn--booked' : ''} ${isSelected ? 'avail-slot-btn--selected' : ''}"
                          onclick="selectTimeSlot('${slot.key}')" ${isBooked ? 'disabled' : ''}>
                    <span class="slot-icon">${slot.icon}</span>
                    <span class="slot-name">${slot.label}</span>
                    <span class="slot-time">${slot.time}</span>
                  </button>`
        }).join('')}
      </div>
    </div>
  `
}

// Cafe: time slot selected
function selectTimeSlot(slotKey) {
  appState.selectedTimeSlot = slotKey
  document.querySelectorAll('.avail-slot-btn').forEach(btn => btn.classList.remove('avail-slot-btn--selected'))
  document.querySelectorAll(`.avail-slot-btn[onclick="selectTimeSlot('${slotKey}')"]`).forEach(btn => btn.classList.add('avail-slot-btn--selected'))
  updateCafeBarState()
}

// Cafe: update sidebar + mobile bar
function updateCafeBarState() {
  const sidebarBtn     = document.getElementById('sidebar-book-btn')
  const mobileDateText = document.getElementById('mobile-bar-date-text')
  const mobileBookBtn  = document.getElementById('mobile-bar-book-btn')
  const slot           = CAFE_SLOTS.find(s => s.key === appState.selectedTimeSlot)

  if (!appState.selectedDate) {
    if (sidebarBtn)     { sidebarBtn.disabled = true;  sidebarBtn.textContent = 'Select a date to book' }
    if (mobileDateText) mobileDateText.textContent = 'Pick a date ↑'
    if (mobileBookBtn)  mobileBookBtn.disabled = true
    return
  }
  if (!appState.selectedTimeSlot) {
    if (sidebarBtn)     { sidebarBtn.disabled = true; sidebarBtn.textContent = 'Pick a time slot ↑' }
    if (mobileDateText) mobileDateText.textContent = `${formatSelectedDate(appState.selectedDate)} · pick a slot ↑`
    if (mobileBookBtn)  mobileBookBtn.disabled = true
    return
  }
  const label = `${formatSelectedDate(appState.selectedDate)} · ${slot?.label}`
  if (sidebarBtn)     { sidebarBtn.disabled = false; sidebarBtn.textContent = 'Select guests →' }
  if (mobileDateText) mobileDateText.textContent = label
  if (mobileBookBtn)  { mobileBookBtn.disabled = false; mobileBookBtn.textContent = 'Select guests →' }
}

// Update the advance payment button with live pricing

// ----------------------------------------------------------------
// GUEST SELECTOR
// ----------------------------------------------------------------

// Show the guest count selector inside #avail-calendar-widget (replaces calendar)
function showGuestSelector(venue) {
  appState.bookingStep  = 'guests'
  appState.currentVenue = venue          // needed by updateGuestCount + showCalendarStep
  const widget = document.getElementById('avail-calendar-widget')
  if (!widget) return

  // Defensive: guest selector always renders in the normal narrow sidebar.
  const layout = document.querySelector('.vd-layout')
  if (layout) layout.classList.remove('vd-layout--pkg-active')

  // Date summary for the back button label
  let dateSummary = ''
  if (venue.type === 'self_managed' && appState.checkinDate && appState.checkoutDate) {
    const nights = calcNights(appState.checkinDate, appState.checkoutDate)
    dateSummary = `${formatSelectedDate(appState.checkinDate)} – ${formatSelectedDate(appState.checkoutDate)} · ${nights} night${nights !== 1 ? 's' : ''}`
  } else if (appState.selectedDate && appState.selectedTimeSlot) {
    const slot = CAFE_SLOTS.find(s => s.key === appState.selectedTimeSlot)
    dateSummary = `${formatSelectedDate(appState.selectedDate)} · ${slot?.label || ''}`
  }

  const totalGuests = appState.adults + appState.children
  const maxGuests   = venue.capacity_max || 20

  // Packages: capture occasion here so the tier step can pre-select a default tier.
  const pkgFlow = packageFlowActive(venue)

  // Packages-first (/packages) arrival: if the occasion was already chosen
  // there, don't re-ask at the guest step — it's prefilled into
  // appState.bookingOccasion and the tier is already locked. If it was
  // SKIPPED there (the chips are optional), still ask: occasion matters to
  // ops (setup prep, board message), not just package suggestion — but with
  // copy that doesn't promise a suggestion for an already-chosen package.
  const pendingPkg = (appState.pendingPackage && appState.pendingPackage.venueId === venue.id) ? appState.pendingPackage : null
  const showOccasionSelect = pkgFlow && !(pendingPkg && pendingPkg.occasion)
  const occSublabel = pendingPkg ? 'Optional — helps us prep your setup' : 'Optional — helps us suggest a package'

  // Package flow hides the running "starting price" across every step (each
  // tier card on the next step shows its own price instead).
  const priceBlock = document.getElementById('vd-price-block')
  if (priceBlock) priceBlock.style.display = pkgFlow ? 'none' : ''

  const occPresets = OCCASIONS // shared canonical list — see its definition
  const occHtml = showOccasionSelect ? `
      <div class="vd-guest-row vd-guest-row--occasion">
        <div class="vd-guest-label">
          <span class="vd-guest-type">Occasion</span>
          <span class="vd-guest-sublabel">${occSublabel}</span>
        </div>
        <select class="vd-occasion-select" onchange="setBookingOccasion(this.value)">
          <option value="">Select…</option>
          ${occPresets.map(o => `<option value="${escapeHtml(o)}"${appState.bookingOccasion === o ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}
        </select>
      </div>` : ''

  widget.innerHTML = `
    <div class="vd-guest-selector">
      <button class="vd-guest-back" onclick="showCalendarStep()" aria-label="Change your date or time">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        <span class="vd-guest-back-label">Change date</span>
        ${dateSummary ? `<span class="vd-guest-back-date">${dateSummary}</span>` : ''}
      </button>
      <div class="vd-guest-rows">
        <div class="vd-guest-row">
          <div class="vd-guest-label">
            <span class="vd-guest-type">Adults</span>
          </div>
          <div class="vd-guest-counter">
            <button class="vd-guest-btn" onclick="updateGuestCount('adults',-1)" ${appState.adults <= 1 ? 'disabled' : ''} aria-label="Remove adult">−</button>
            <span class="vd-guest-count" id="adults-count">${appState.adults}</span>
            <button class="vd-guest-btn" onclick="updateGuestCount('adults',1)" ${totalGuests >= maxGuests ? 'disabled' : ''} aria-label="Add adult">+</button>
          </div>
        </div>
        <div class="vd-guest-row">
          <div class="vd-guest-label">
            <span class="vd-guest-type">Children</span>
            <span class="vd-guest-sublabel">Under 10 · free</span>
          </div>
          <div class="vd-guest-counter">
            <button class="vd-guest-btn" onclick="updateGuestCount('children',-1)" ${appState.children <= 0 ? 'disabled' : ''} aria-label="Remove child">−</button>
            <span class="vd-guest-count" id="children-count">${appState.children}</span>
            <button class="vd-guest-btn" onclick="updateGuestCount('children',1)" ${totalGuests >= maxGuests ? 'disabled' : ''} aria-label="Add child">+</button>
          </div>
        </div>
      </div>
      ${occHtml}
      <div class="vd-inclusion" id="vd-inclusion-line">${inclusionBannerHtml(venue, appState.adults)}</div>
    </div>
  `

  const sidebarBtn = document.getElementById('sidebar-book-btn')
  const mobileBtn  = document.getElementById('mobile-bar-book-btn')
  if (sidebarBtn) { sidebarBtn.disabled = false; sidebarBtn.textContent = 'Book Now'; sidebarBtn.style.display = '' }
  if (mobileBtn)  { mobileBtn.disabled  = false; mobileBtn.textContent  = 'Book Now'; mobileBtn.style.display  = '' }

  updateGuestPrice(venue)
}

// Restore the availability calendar (undo showGuestSelector)
function showCalendarStep() {
  appState.bookingStep = 'calendar'
  const venue  = appState.currentVenue
  const widget = document.getElementById('avail-calendar-widget')
  if (!widget || !venue) return

  // Package flow hides the running "starting price" across every step.
  const priceBlock = document.getElementById('vd-price-block')
  if (priceBlock) priceBlock.style.display = packageFlowActive(venue) ? 'none' : ''

  // _calDraw is stored by renderAvailabilityCalendar — just call it
  if (typeof widget._calDraw === 'function') {
    widget._calDraw()
    if (venue.type === 'self_managed') {
      attachBnbHover()
      updateBnbCalendarHighlight()
    }
    // Re-render slot picker if a cafe date was already selected
    if (venue.type === 'cafe' && appState.selectedDate) {
      renderSlotPicker(appState.selectedDate)
    }
  }

  if (venue.type === 'self_managed') updateBnbBarState()
  else updateCafeBarState()

  updateGuestPrice(venue)
}

// Update sidebar price display based on current adults/children
function updateGuestPrice(venue) {
  const priceEl = document.getElementById('sidebar-price-amount')
  const labelEl = document.getElementById('sidebar-price-label')
  if (!priceEl || !venue) return
  // Partner BnBs show a fixed "picnic setup only" label — don't overwrite it
  if (venue.type === 'partner_bnb') return

  const picnicPrice = getPicnicPrice(venue, appState.adults)

  // Refresh the live inclusion banner (cafe venues only)
  const inclusionEl = document.getElementById('vd-inclusion-line')
  if (inclusionEl) inclusionEl.innerHTML = inclusionBannerHtml(venue, appState.adults)

  const guestLine = `${appState.adults} adult${appState.adults !== 1 ? 's' : ''}` +
    (appState.children ? ` · ${appState.children} child${appState.children !== 1 ? 'ren' : ''}` : '')

  if (venue.type === 'self_managed' && appState.checkinDate && appState.checkoutDate) {
    const nights    = calcNights(appState.checkinDate, appState.checkoutDate)
    const stayTotal = nights * (Number(venue.metadata?.stay_price_per_night) || 0)
    priceEl.textContent = formatPrice(stayTotal + picnicPrice) || 'Custom'
    if (labelEl) labelEl.textContent = `${nights} night${nights !== 1 ? 's' : ''} · ${guestLine}`
    return
  }

  priceEl.textContent = formatPrice(picnicPrice) || 'Custom'
  if (labelEl) labelEl.textContent = guestLine
}

// Increment/decrement adult or child count and refresh price
function updateGuestCount(type, delta) {
  const venue = appState.currentVenue
  if (!venue) return

  if (type === 'adults')   appState.adults   = Math.max(1, appState.adults + delta)
  if (type === 'children') appState.children = Math.max(0, appState.children + delta)

  // Update count display in-place
  const countEl = document.getElementById(`${type}-count`)
  if (countEl) countEl.textContent = appState[type]

  // Refresh ± button disabled states
  const totalGuests = appState.adults + appState.children
  const maxGuests   = venue.capacity_max || 20
  const adultRow    = document.getElementById('adults-count')?.closest('.vd-guest-row')
  const childRow    = document.getElementById('children-count')?.closest('.vd-guest-row')

  if (adultRow) {
    adultRow.querySelector('.vd-guest-btn:first-child').disabled = appState.adults <= 1
    adultRow.querySelector('.vd-guest-btn:last-child').disabled  = totalGuests >= maxGuests
  }
  if (childRow) {
    childRow.querySelector('.vd-guest-btn:first-child').disabled = appState.children <= 0
    childRow.querySelector('.vd-guest-btn:last-child').disabled  = totalGuests >= maxGuests
  }

  updateGuestPrice(venue)
}

// ----------------------------------------------------------------
// BOOKING VIEW (inline — replaces vd-body, no modal)
// ----------------------------------------------------------------

// ── Packages: occasion setter (called from the guest-step select) ──────────
function setBookingOccasion(value) {
  appState.bookingOccasion = value || ''
}

// Price a tier for this venue = base picnic price (current adults) + the tier's
// add-on prices from this venue's catalog. Matches the booking-form total exactly
// (the form sums the same base + the same add-on checkboxes), so the card price
// equals the form total when the customer adds no extras.
function packageTierPriceAt(venue, tier, catalog, adults) {
  const base = getPicnicPrice(venue, adults)
  const addonSum = (tier.addons || []).reduce((s, id) => {
    const a = catalog.find(x => x.id === id)
    return s + (a ? Number(a.price) : 0)
  }, 0)
  return base + addonSum
}
// Current-booking flavour: prices at whatever guest count the flow has.
// The /packages page uses packageTierPriceAt directly with a fixed baseline
// (PKG_PAGE_BASE_ADULTS) so a leftover appState.adults never skews "From" prices.
function packageTierPrice(venue, tier, catalog) {
  return packageTierPriceAt(venue, tier, catalog, appState.adults)
}

// ── Packages: tier selection step (cafe + flag only) ──────────────────────
function showPackageStep(venue) {
  appState.bookingStep  = 'package'
  appState.currentVenue = venue
  const widget = document.getElementById('avail-calendar-widget')
  if (!widget) return

  // Each tier card shows its own price — keep the generic starting price hidden
  // here too (already hidden by showGuestSelector, this covers direct entries).
  const priceBlock = document.getElementById('vd-price-block')
  if (priceBlock) priceBlock.style.display = 'none'

  // Desktop only: break the booking card out of the narrow 360px sidebar so
  // the 3 tier cards can sit side-by-side instead of stacking in a cramped
  // column. Reverted in showPackageBack() / showBookingForm().
  const layout = document.querySelector('.vd-layout')
  if (layout) layout.classList.add('vd-layout--pkg-active')

  const catalog    = appState.currentVenueAddOns || []
  const defaultKey = defaultTierForOccasion(appState.bookingOccasion)

  // Occasion-specific packages must actually be servable at THIS venue's
  // catalog (required-addon rule — see packageServiceableAt). If the chosen
  // occasion isn't servable here at all, fall back to the universal ladder
  // rather than showing an empty tier step.
  let visibleKeys = visiblePackagesFor(appState.bookingOccasion || null)
    .filter(k => packageServiceableAt(PACKAGE_TIERS[k], catalog))
  if (!visibleKeys.length) visibleKeys = PACKAGE_TIER_ORDER.filter(k => !PACKAGE_TIERS[k]?.occasion)

  const cards = visibleKeys.map((key, idx) => {
    const tier     = PACKAGE_TIERS[key]
    const price    = packageTierPrice(venue, tier, catalog)
    // Ladder copy ("Everything in <prev>, plus:") chains within whatever
    // group this tier belongs to — the universal three, or one occasion's
    // own tiers (e.g. Movie Night Deluxe chains off Movie Night, not off
    // The Story) — never across groups.
    const prevKey  = visibleKeys.slice(0, idx).reverse().find(k => (PACKAGE_TIERS[k]?.occasion || null) === (tier.occasion || null))
    const prevTier = prevKey ? PACKAGE_TIERS[prevKey] : null

    // The Setting IS the base setup — its checklist is what the venue page's
    // "What's included" section used to show (now hidden in this flow, see
    // renderVenueDetail). Every other first-of-group tier (Moment/Story, or
    // an occasion's own first tier) is additive: "Everything in <prev>,
    // plus:" the add-ons that tier introduces on top of the one before it.
    let inclLead  = ''
    let inclItems = []
    if (!prevTier) {
      if (tier.occasion) {
        inclLead  = 'The signature setup, plus:'
        inclItems = (tier.addons || []).map(id => catalog.find(a => a.id === id)).filter(Boolean).map(a => a.name)
      } else {
        inclItems = venueSetupLabels(venue)
      }
    } else {
      inclLead = `Everything in <strong class="pkg-card-incl-lead-name">${escapeHtml(prevTier.name)}</strong>, plus:`
      const newAddonIds = (tier.addons || []).filter(id => !(prevTier.addons || []).includes(id))
      inclItems = newAddonIds.map(id => catalog.find(a => a.id === id)).filter(Boolean).map(a => a.name)
    }
    const inclList = inclItems.length
      ? `${inclLead ? `<p class="pkg-card-incl-lead">${inclLead}</p>` : ''}<ul class="pkg-card-incl">${inclItems.map(label => `<li>${escapeHtml(label)}</li>`).join('')}</ul>`
      : `<p class="pkg-card-incl pkg-card-incl--bare">Just the signature picnic setup.</p>`
    const badge = tier.featured
      ? '<span class="pkg-card-badge">Most picked</span>'
      : (key === defaultKey ? '<span class="pkg-card-badge pkg-card-badge--suggested">Suggested</span>' : '')
    return `
        <div class="pkg-card${tier.featured ? ' pkg-card--featured' : ''}${key === defaultKey ? ' pkg-card--suggested' : ''}">
          ${badge}
          ${pkgCardTopHtml(tier, key)}
          <h4 class="pkg-card-name">${escapeHtml(tier.name)}</h4>
          <p class="pkg-card-tagline">${escapeHtml(tier.tagline)}</p>
          <div class="pkg-card-price">₹${price.toLocaleString('en-IN')}</div>
          <div class="pkg-card-price-note">for ${appState.adults} adult${appState.adults !== 1 ? 's' : ''}</div>
          ${inclList}
          <button type="button" class="btn ${tier.featured ? 'btn--venue-primary' : 'btn--venue-secondary'} pkg-card-cta" onclick="selectPackageTier('${key}')">Choose ${escapeHtml(tier.name)}</button>
        </div>`
  }).join('')

  widget.innerHTML = `
    <div class="pkg-step">
      <button class="vd-guest-back" onclick="showPackageBack()" aria-label="Back to guest count">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        <span class="vd-guest-back-label">Back to guests</span>
      </button>
      <h3 class="pkg-step-title">Choose your package</h3>
      <p class="pkg-step-sub">Curated for the occasion — you can add more on the next step.</p>
      <div class="pkg-cards">${cards}</div>
    </div>
  `

  // Cards are the only CTA here — hide the sidebar/mobile "Book Now" buttons.
  const sidebarBtn = document.getElementById('sidebar-book-btn')
  const mobileBtn  = document.getElementById('mobile-bar-book-btn')
  if (sidebarBtn) sidebarBtn.style.display = 'none'
  if (mobileBtn)  mobileBtn.style.display  = 'none'

  track('package_step_viewed', {
    venue_id: venue.id, venue_name: venue.name,
    occasion: appState.bookingOccasion || null, guests: appState.adults + appState.children,
  })
}

// Back from the tier step to the guest selector.
function showPackageBack() {
  const layout = document.querySelector('.vd-layout')
  if (layout) layout.classList.remove('vd-layout--pkg-active')
  if (appState.currentVenue) showGuestSelector(appState.currentVenue)
}

// Choose a tier → lock its (available) add-ons and go to the booking form.
function selectPackageTier(key) {
  const tier  = PACKAGE_TIERS[key]
  const venue = appState.currentVenue
  if (!tier || !venue) return
  const catalog  = appState.currentVenueAddOns || []
  const addonIds = (tier.addons || []).filter(id => catalog.some(a => a.id === id))
  appState.selectedPackage = { occasion: appState.bookingOccasion || null, tierKey: key, addonIds }
  track('package_tier_selected', {
    venue_id: venue.id, venue_name: venue.name, tier: key,
    occasion: appState.bookingOccasion || null, guests: appState.adults + appState.children,
  })

  // Changing package from the intent/confirmation screen ("Change package" →
  // changePackageFromIntent) fast-resumes straight back there with the new
  // tier's price, instead of re-showing the full contact-details form —
  // name/email/mobile/etc. are already saved in changeModeData.
  if (appState.changeMode === 'intent-package' && appState.changeModeData) {
    const picnicPrice = getPicnicPrice(venue, appState.adults)
    const addonObjs = addonIds.map(id => catalog.find(a => a.id === id)).filter(Boolean)
    const addonSum  = addonObjs.reduce((s, a) => s + Number(a.price), 0)
    const lead = {
      ...appState.changeModeData,
      advance_amount: Math.round((picnicPrice + addonSum) * 0.3),
      package_key:    key, // "Change package" from the intent screen — this IS the new tier
    }
    appState.pendingLead   = lead
    appState.pendingAddOns = addonObjs.map(a => ({
      addon_id: a.id, name: a.name, price_at_booking: a.price, requires_confirmation: a.requires_confirmation || false,
    }))
    appState.changeMode     = null
    appState.changeModeData = null

    const body     = document.getElementById('vd-body')
    const bookView = document.getElementById('vd-booking-view')
    if (body)     body.style.display = 'none'
    if (bookView) {
      bookView.style.display = ''
      bookView.innerHTML = buildIntentScreenHTML(lead, { containerClass: 'vd-intent-wrap container' })
      // Sync the already-captured lead row (carried via booking_id) with the
      // new package's add-ons/amounts so create-order validation stays fresh.
      captureLeadOnIntent()
    }
    return
  }

  showBookingForm(venue)
}

// "Change package" from the intent/confirmation screen ("You're almost
// there!"). Saves the pending lead the same way goBackToVenueDetail('intent')
// does for date changes, then jumps straight to the tier step (date/guests/
// occasion are unchanged, so no need to go through the calendar again).
window.changePackageFromIntent = function() {
  const venue = appState.currentVenue
  if (!venue || !appState.pendingLead) return
  appState.changeMode     = 'intent-package'
  appState.changeModeData = { ...appState.pendingLead }
  appState.pendingLead    = null
  appState.pendingAddOns  = null
  showVenueBodyStep()
  showPackageStep(venue)
}

async function showBookingForm(venue) {
  appState.bookingStep  = 'booking'
  appState.currentVenue = venue
  // Undo the package step's full-width takeover, if it was engaged.
  const pkgLayout = document.querySelector('.vd-layout')
  if (pkgLayout) pkgLayout.classList.remove('vd-layout--pkg-active')
  const body      = document.getElementById('vd-body')
  const bookView  = document.getElementById('vd-booking-view')
  const mobileBar = document.querySelector('.vd-mobile-book-bar')
  const backBtn   = document.getElementById('vd-hero-back')
  if (!body || !bookView) return

  // Self-heal: the add-on accordion depends on currentVenueAddOns being
  // populated by showVenuePage. Some entry paths reach the form without it
  // (direct deep-link, an interrupted parallel load, etc.), which silently
  // drops the whole "Add to your experience" section. Load on demand if empty.
  let addOns = appState.currentVenueAddOns
  if (!addOns || !addOns.length) {
    addOns = await loadVenueAddOns(venue.id)
    appState.currentVenueAddOns = addOns
  }
  const picnicPrice = getPicnicPrice(venue, appState.adults)

  // Packages: when a tier was chosen, its add-ons are locked (included) — shown
  // read-only in their own section and excluded from the editable accordion.
  const pkg          = (appState.selectedPackage && venue.type === 'cafe') ? appState.selectedPackage : null
  const pkgTier      = pkg ? PACKAGE_TIERS[pkg.tierKey] : null
  const lockedIds    = pkg ? (pkg.addonIds || []) : []
  const lockedAddons = lockedIds.map(id => addOns.find(a => a.id === id)).filter(Boolean)

  // Date chips
  let dateChips = ''
  if (venue.type === 'self_managed' && appState.checkinDate && appState.checkoutDate) {
    const nights = calcNights(appState.checkinDate, appState.checkoutDate)
    dateChips = `
      <span class="vd-bv-chip">🛬 Check-in &nbsp;<strong>${formatSelectedDate(appState.checkinDate)}</strong></span>
      <span class="vd-bv-chip">🛫 Checkout &nbsp;<strong>${formatSelectedDate(appState.checkoutDate)}</strong></span>
      <span class="vd-bv-chip">🌙 ${nights} night${nights !== 1 ? 's' : ''}</span>`
  } else if (appState.selectedDate && appState.selectedTimeSlot) {
    const slot = CAFE_SLOTS.find(s => s.key === appState.selectedTimeSlot)
    dateChips = `
      <span class="vd-bv-chip">📅 <strong>${formatSelectedDate(appState.selectedDate)}</strong></span>
      <span class="vd-bv-chip">${slot?.icon || ''} ${slot?.label || ''} · ${slot?.time || ''}</span>`
  }
  const guestLabel = `${appState.adults} adult${appState.adults !== 1 ? 's' : ''}${appState.children ? ` · ${appState.children} child${appState.children !== 1 ? 'ren' : ''}` : ''}`
  const guestChips = `<span class="vd-bv-chip">👤 ${guestLabel}</span>`

  // Price breakdown rows
  let priceRows = ''
  let baseTotal = picnicPrice
  let hasStay = false
  if (venue.type === 'self_managed' && appState.checkinDate && appState.checkoutDate) {
    const nights = calcNights(appState.checkinDate, appState.checkoutDate)
    baseTotal += nights * (Number(venue.metadata?.stay_price_per_night) || 0)
    hasStay = true
  }
  // Packages: fold the setup + its locked add-ons into a single line (their
  // individual prices are already shown per-tier on the previous step) —
  // only add-ons chosen beyond the package get itemized below.
  if (pkg && pkgTier) {
    const lockedSum = lockedAddons.reduce((s, a) => s + Number(a.price || 0), 0)
    priceRows += `<div class="vd-bv-price-row vd-bv-price-row--package"><span>${escapeHtml(pkgTier.name)} package</span><span>₹${(baseTotal + lockedSum).toLocaleString('en-IN')}</span></div>`
  } else {
    priceRows += `<div class="vd-bv-price-row"><span>${hasStay ? 'Stay + Picnic setup' : 'Picnic setup'}</span><span>₹${baseTotal.toLocaleString('en-IN')}</span></div>`
  }
  priceRows += `<div id="bv-addon-price-rows"></div>`

  // Add-ons — grouped by category, each in a collapsible accordion
  const addonsByCategory = ADDON_CATEGORIES
    .map(cat => ({ cat, label: ADDON_CATEGORY_LABELS[cat], items: addOns.filter(a => a.category === cat && !lockedIds.includes(a.id)) }))
    .filter(g => g.items.length)

  // Locked "included in your package" section — real checked .bv-addon-check inputs
  // (hidden via CSS) so the existing price + submit logic counts them automatically;
  // the visible row carries the name for the price-breakdown lookup.
  const lockedHtml = lockedAddons.length ? `
    <div class="vd-bf-section pkg-included-section">
      <h3 class="vd-bf-section-title">Included in ${escapeHtml(pkgTier?.name || 'your package')}</h3>
      <div class="pkg-included-list">
        ${lockedAddons.map(a => `
        <label class="vd-bf-addon-row pkg-included-row">
          <div class="vd-bf-addon-info">
            <span class="vd-bf-addon-name">${escapeHtml(a.name)}</span>
            ${a.description ? `<span class="vd-bf-addon-desc">${escapeHtml(a.description)}</span>` : ''}
          </div>
          <div class="vd-bf-addon-right">
            <span class="pkg-included-tick" aria-hidden="true">✓</span>
            <input type="checkbox" class="bv-addon-check pkg-locked-check" checked
                   data-addon-id="${a.id}"
                   data-addon-name="${escapeHtml(a.name)}"
                   data-addon-price="${a.price}"
                   data-addon-confirm="${a.requires_confirmation || false}"
                   onclick="return false" tabindex="-1" aria-label="Included add-on (locked)">
          </div>
        </label>`).join('')}
      </div>
    </div>` : ''

  const addOnsHtml = addonsByCategory.length ? `
    <div class="vd-bf-section">
      <h3 class="vd-bf-section-title">${pkg ? 'Add more to your experience' : 'Add to your experience'}</h3>
      <div class="vd-bf-addon-cats">
        ${addonsByCategory.map(({ cat, label, items }) => `
        <div class="vd-bf-cat" data-cat="${cat}">
          <button type="button" class="vd-bf-cat-header" onclick="toggleAddonCat(this)" aria-expanded="false">
            <span class="vd-bf-cat-label">${label}</span>
            <span class="vd-bf-cat-meta">
              <span class="vd-bf-cat-count hidden">${items.length}</span>
              <span class="vd-bf-cat-selected"></span>
              <span class="vd-bf-cat-chevron">›</span>
            </span>
          </button>
          <div class="vd-bf-cat-body" hidden>
            ${items.map(a => `
            <label class="vd-bf-addon-row">
              <div class="vd-bf-addon-info">
                <span class="vd-bf-addon-name">${escapeHtml(a.name)}</span>
                ${a.description ? `<span class="vd-bf-addon-desc">${escapeHtml(a.description)}</span>` : ''}
              </div>
              <div class="vd-bf-addon-right">
                <span class="vd-bf-addon-price">+₹${Number(a.price).toLocaleString('en-IN')}</span>
                <input type="checkbox" class="bv-addon-check"
                       data-addon-id="${a.id}"
                       data-addon-name="${escapeHtml(a.name)}"
                       data-addon-price="${a.price}"
                       data-addon-confirm="${a.requires_confirmation || false}"
                       onchange="updateBookingSummaryPrice(); updateAddonCatBadge(this.closest('.vd-bf-cat'))">
              </div>
            </label>`).join('')}
          </div>
        </div>`).join('')}
      </div>
    </div>` : ''

  bookView.innerHTML = `
    <div class="vd-bv-wrap container">
      <div class="vd-bv-layout">

        <!-- Left: booking summary -->
        <div class="vd-bv-summary">
          <div class="vd-bv-venue-row">
            <span class="vd-bv-venue-name">${escapeHtml(venue.name)}</span>
          </div>
          <div class="vd-bv-chips-wrap">
            <div class="vd-bv-chips">${dateChips}${guestChips}</div>
            <button class="vd-bv-change-btn" onclick="goBackToVenueDetail('form')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Change date &amp; time
            </button>
          </div>
          ${pkgTier ? `
          <div class="vd-bv-pkg-row">
            <div class="pkg-summary-badge">${escapeHtml(pkgTier.name)} package</div>
            <button class="vd-bv-change-btn" onclick="changePackage()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Change package
            </button>
          </div>` : ''}
          ${inclusionBannerHtml(venue, appState.adults) ? `<div class="vd-inclusion vd-inclusion--summary">${inclusionBannerHtml(venue, appState.adults)}</div>` : ''}
          <div class="vd-bv-price-table">
            ${priceRows}
            <div class="vd-bv-price-divider"></div>
            <div class="vd-bv-price-row vd-bv-price-row--total">
              <span>Total</span>
              <span id="bv-total-price">₹${baseTotal.toLocaleString('en-IN')}</span>
            </div>
          </div>
          <p class="vd-bv-note">Final total confirmed after we review your requirements.</p>
        </div>

        <!-- Right: add-ons + contact form -->
        <div class="vd-bv-form-col">
          ${lockedHtml}
          ${addOnsHtml}
          <div class="vd-bf-section">
            <h3 class="vd-bf-section-title">Your details</h3>
            <form id="inline-booking-form" class="vd-bf-form" onsubmit="handleInlineBookingSubmit(event)">
              <div class="vd-bf-field">
                <label class="vd-bf-label">Full name *</label>
                <input class="vd-bf-input" type="text" name="full-name" placeholder="Your name" required>
              </div>
              <div class="vd-bf-row">
                <div class="vd-bf-field">
                  <label class="vd-bf-label">Email *</label>
                  <input class="vd-bf-input" type="email" name="email-address" placeholder="your@email.com" required>
                </div>
                <div class="vd-bf-field">
                  <label class="vd-bf-label">Phone *</label>
                  <input class="vd-bf-input" type="tel" name="mobile-number" placeholder="10-digit mobile number" required inputmode="numeric" maxlength="10" pattern="[0-9]{10}" onkeydown="if(!/[0-9]/.test(event.key)&&!['Backspace','Delete','ArrowLeft','ArrowRight','Tab'].includes(event.key))event.preventDefault()" onpaste="setTimeout(()=>{this.value=this.value.replace(/\D/g,'').slice(0,10)},0)" oninput="this.value=this.value.replace(/\D/g,'').slice(0,10)">
                </div>
              </div>
              ${pkg
                ? (pkg.occasion
                    ? `<div class="vd-bf-field">
                <label class="vd-bf-label">Occasion</label>
                <div class="pkg-occasion-chip">${escapeHtml(pkg.occasion)}</div>
                <input type="hidden" name="occasion" value="${escapeHtml(pkg.occasion)}">
              </div>`
                    : `<input type="hidden" name="occasion" value="">`)
                : `<div class="vd-bf-field">
                <label class="vd-bf-label">Occasion</label>
                <select class="vd-bf-input vd-bf-select" name="occasion"
                        onchange="document.getElementById('occasion-other-wrap').style.display = this.value === 'Other' ? '' : 'none'">
                  <option value="">Select an occasion (optional)</option>
                  <option value="Birthday">Birthday</option>
                  <option value="Anniversary">Anniversary</option>
                  <option value="Proposal">Proposal</option>
                  <option value="Baby Shower">Baby Shower</option>
                  <option value="Bridal Shower">Bridal Shower</option>
                  <option value="Date Night">Date Night</option>
                  <option value="Graduation">Graduation</option>
                  <option value="Just Because">Just Because</option>
                  <option value="Other">Other…</option>
                </select>
                <div id="occasion-other-wrap" style="display:none; margin-top:8px;">
                  <input class="vd-bf-input" type="text" name="occasion-other" placeholder="Tell us the occasion">
                </div>
              </div>`}
              <div class="vd-bf-field">
                <label class="vd-bf-label">Celebration board <span style="font-weight:400; opacity:0.6;">(optional)</span></label>
                <select class="vd-bf-input vd-bf-select" name="board-type"
                        onchange="document.getElementById('board-message-wrap').style.display = this.value ? '' : 'none'">
                  <option value="">No board</option>
                  <option value="black">Black chalkboard</option>
                  <option value="white">White wooden arch board</option>
                </select>
                <div id="board-message-wrap" style="display:none; margin-top:8px;">
                  <input class="vd-bf-input" type="text" name="board-message" maxlength="60"
                         placeholder="Short one-liner only — e.g. Happy Birthday Aanya!">
                </div>
              </div>
              <div class="vd-bf-field">
                <label class="vd-bf-label">Special requests</label>
                <textarea class="vd-bf-input vd-bf-textarea" name="special-requirements" placeholder="Allergies, dietary needs, anything else we should know…" rows="3"></textarea>
              </div>
              <button type="submit" class="btn btn--venue-primary vd-bf-submit" id="inline-submit-btn">
                Continue →
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  `

  body.style.display = 'none'
  if (mobileBar) mobileBar.style.display = 'none'
  bookView.style.display = 'block'
  bookView.scrollIntoView({ behavior: 'smooth', block: 'start' })

  if (backBtn) {
    backBtn.setAttribute('onclick', 'showVenueBodyStep()')
    backBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg> Back to venue`
  }

  // If user came back to change date from the booking form, restore their saved values
  if (appState.changeMode === 'form' && appState.changeModeData) {
    const saved = appState.changeModeData
    ;['name','email','mobile-number','special-requirements','occasion','occasion-other','board-type','board-message']
      .forEach(f => { const el = bookView.querySelector(`[name="${f}"]`); if (el && saved[f] !== undefined) el.value = saved[f] })
    if (saved.addons) {
      saved.addons.forEach(val => {
        const cb = bookView.querySelector(`.vd-bf-addon[value="${val}"]`)
        if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')) }
      })
    }
    if (saved['occasion'] === 'Other') {
      const w = bookView.querySelector('#occasion-other-wrap'); if (w) w.style.display = ''
    }
    if (saved['board-type']) {
      const w = bookView.querySelector('#board-message-wrap'); if (w) w.style.display = ''
    }
    appState.changeMode     = null
    appState.changeModeData = null
  }

  // Packages: the locked add-ons are pre-checked — recompute so the total and
  // price breakdown include them on first render.
  if (pkg) updateBookingSummaryPrice()
}

// Restore venue body — undo showBookingForm
function showVenueBodyStep() {
  appState.bookingStep = 'guests'
  const body      = document.getElementById('vd-body')
  const bookView  = document.getElementById('vd-booking-view')
  const mobileBar = document.querySelector('.vd-mobile-book-bar')
  const backBtn   = document.getElementById('vd-hero-back')

  if (body)      { body.style.display = '' }
  if (bookView)  { bookView.style.display = 'none' }
  if (mobileBar) { mobileBar.style.display = '' }

  if (backBtn) {
    backBtn.setAttribute('onclick', 'navigateHome()')
    backBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg> Venues`
  }
}

// "Change package" from the booking form — lighter than "Change date & time"
// (goBackToVenueDetail), which rebuilds the whole venue page from scratch and
// wipes date/guests/package. This just reveals the venue body and re-opens
// the tier step; date, slot, guest count, and occasion are all untouched in
// appState, so the tier cards re-render with the same context.
window.changePackage = function() {
  const venue = appState.currentVenue
  if (!venue) return
  showVenueBodyStep()
  showPackageStep(venue)
}

// Recompute price total when add-ons are toggled in the booking view
window.toggleAddonCat = function(btn) {
  const body = btn.nextElementSibling
  const open = btn.getAttribute('aria-expanded') === 'true'
  btn.setAttribute('aria-expanded', !open)
  body.hidden = open
}

// Generic collapse/expand for section-level accordions (e.g. "About this
// venue") — same mechanic as toggleAddonCat, kept separate since it's a
// different visual scale/context.
window.toggleVdAccordion = function(btn) {
  const body = btn.nextElementSibling
  const open = btn.getAttribute('aria-expanded') === 'true'
  btn.setAttribute('aria-expanded', !open)
  body.hidden = open
}

window.updateAddonCatBadge = function(catEl) {
  if (!catEl) return
  const checked = catEl.querySelectorAll('.bv-addon-check:checked')
  const badge = catEl.querySelector('.vd-bf-cat-selected')
  if (!badge) return
  if (checked.length) {
    const total = Array.from(checked).reduce((s, cb) => s + Number(cb.dataset.addonPrice), 0)
    badge.textContent = `${checked.length} · +₹${total.toLocaleString('en-IN')}`
    badge.classList.add('vd-bf-cat-selected--active')
  } else {
    badge.textContent = ''
    badge.classList.remove('vd-bf-cat-selected--active')
  }
}

function updateBookingSummaryPrice() {
  const venue = appState.currentVenue
  if (!venue) return

  const picnicPrice = getPicnicPrice(venue, appState.adults)
  const addonSum      = Array.from(document.querySelectorAll('.bv-addon-check:checked'))
    .reduce((sum, cb) => sum + Number(cb.dataset.addonPrice), 0)

  let total = picnicPrice
  if (venue.type === 'self_managed' && appState.checkinDate && appState.checkoutDate) {
    total += calcNights(appState.checkinDate, appState.checkoutDate) * (Number(venue.metadata?.stay_price_per_night) || 0)
  }
  total += addonSum

  const totalEl   = document.getElementById('bv-total-price')
  const submitBtn = document.getElementById('inline-submit-btn')
  if (totalEl)   totalEl.textContent   = `₹${total.toLocaleString('en-IN')}`
  if (submitBtn) submitBtn.textContent = `Continue →`

  // Update add-on rows in the price breakdown. Package add-ons
  // (.pkg-locked-check) are already folded into the package price row built
  // in showBookingForm — only itemize add-ons chosen beyond the package,
  // otherwise this re-lists Bouquet/Cake/etc. as if they were separate.
  const addonRowsEl = document.getElementById('bv-addon-price-rows')
  if (addonRowsEl) {
    addonRowsEl.innerHTML = Array.from(document.querySelectorAll('.bv-addon-check:checked:not(.pkg-locked-check)')).map(cb => {
      const name  = cb.closest('.vd-bf-addon-row')?.querySelector('.vd-bf-addon-name')?.textContent || 'Add-on'
      return `<div class="vd-bv-price-row"><span>${escapeHtml(name)}</span><span>+₹${Number(cb.dataset.addonPrice).toLocaleString('en-IN')}</span></div>`
    }).join('')
  }
}

// Build the booking summary card shown on the intent screen
function buildIntentSummaryHTML() {
  const lead  = appState.pendingLead
  const venue = appState.currentVenue
  const addOns = appState.pendingAddOns || []
  if (!lead) return ''

  // Packages: appState.selectedPackage survives from the form submit through
  // to this intent screen (only showVenuePage clears it), so this mirrors
  // what the customer actually picked. Computed up top since it's needed both
  // for the price collapsing below and the "Change package" link.
  const pkg       = (appState.selectedPackage && venue?.type === 'cafe') ? appState.selectedPackage : null
  const pkgTier   = pkg ? PACKAGE_TIERS[pkg.tierKey] : null
  const lockedIds = pkg ? (pkg.addonIds || []) : []

  // Date / slot chips
  const chips = []
  if (lead.preferred_date) {
    const dateLabel = new Date(lead.preferred_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
    if (lead.checkout_date) {
      const checkoutLabel = new Date(lead.checkout_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      chips.push(`<span class="vd-bv-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${dateLabel} → ${checkoutLabel}</span>`)
    } else {
      chips.push(`<span class="vd-bv-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${dateLabel}</span>`)
    }
  }
  if (lead.time_slot) {
    const slotInfo = CAFE_SLOTS.find(s => s.key === lead.time_slot)
    chips.push(`<span class="vd-bv-chip">${slotInfo ? slotInfo.icon : '⏰'} ${slotInfo ? slotInfo.label + ' · ' + slotInfo.time : lead.time_slot}</span>`)
  }
  if (lead.guest_count) {
    const adults   = lead.guest_count - (lead.children_count || 0)
    const kids     = lead.children_count || 0
    const guestStr = `${adults} adult${adults !== 1 ? 's' : ''}` +
      (kids ? ` · ${kids} child${kids !== 1 ? 'ren' : ''} (free)` : '')
    chips.push(`<span class="vd-bv-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>${guestStr}</span>`)
  }

  // Price rows — only if there's a price to show
  let priceSection = ''
  if (lead.advance_amount > 0 && venue) {
    const picnicPrice = getPicnicPrice(venue, appState.adults)
    let rows = ''
    let setupBase = picnicPrice
    let hasStay = false
    if (venue.type === 'self_managed' && lead.checkout_date) {
      const nights = calcNights(lead.preferred_date, lead.checkout_date)
      setupBase += nights * (Number(venue.metadata?.stay_price_per_night) || 0)
      hasStay = true
    }

    // Packages: same collapsing as the booking form (showBookingForm) — fold
    // the setup + its locked add-ons into one line, only itemize add-ons
    // chosen beyond the package.
    const lockedAddOns = lockedIds.length ? addOns.filter(ao => lockedIds.includes(ao.addon_id)) : []
    const extraAddOns  = lockedIds.length ? addOns.filter(ao => !lockedIds.includes(ao.addon_id)) : addOns

    if (pkgTier) {
      const lockedSum = lockedAddOns.reduce((s, ao) => s + Number(ao.price_at_booking || 0), 0)
      rows += `<div class="vd-bv-price-row vd-bv-price-row--package"><span>${escapeHtml(pkgTier.name)} package</span><span>₹${(setupBase + lockedSum).toLocaleString('en-IN')}</span></div>`
    } else if (setupBase) {
      rows += `<div class="vd-bv-price-row"><span>${hasStay ? 'Stay + Picnic setup' : 'Picnic setup'}</span><span>₹${setupBase.toLocaleString('en-IN')}</span></div>`
    }
    for (const ao of extraAddOns) {
      const name = appState.currentVenueAddOns?.find(a => a.id === ao.addon_id)?.name || 'Add-on'
      rows += `<div class="vd-bv-price-row"><span>${escapeHtml(name)}</span><span>+₹${Number(ao.price_at_booking).toLocaleString('en-IN')}</span></div>`
    }
    const fullTotal = Math.round(lead.advance_amount / 0.3)
    priceSection = `
      <div class="vd-bv-price-table">
        ${rows}
        <div class="vd-bv-price-divider"></div>
        <div class="vd-bv-price-row vd-bv-price-row--total">
          <span>Total</span>
          <span>₹${fullTotal.toLocaleString('en-IN')}</span>
        </div>
        <div class="vd-bv-price-row vd-bv-price-row--advance">
          <span>Advance due now <span class="vd-bv-price-tag">30%</span></span>
          <span>₹${lead.advance_amount.toLocaleString('en-IN')}</span>
        </div>
        <div class="vd-bv-price-row vd-bv-price-row--remaining">
          <span>Remaining due on the day</span>
          <span>₹${(fullTotal - lead.advance_amount).toLocaleString('en-IN')}</span>
        </div>
      </div>`
  }

  const venueBlock = venue
    ? `<div class="vd-bv-venue-row">
         <span class="vd-bv-venue-name">${escapeHtml(venue.name)}</span>
         <span class="venue-type-badge ${venueTypeBadgeClass(venue.type)}">${escapeHtml(formatVenueType(venue.type))}</span>
       </div>`
    : lead.venue_address
      ? `<div class="vd-bv-venue-row"><span class="vd-bv-venue-name">📍 ${escapeHtml(lead.venue_address)}</span></div>`
      : ''

  return `
    <div class="vd-intent-summary">
      ${venueBlock}
      <div class="vd-bv-chips-wrap">
        <div class="vd-bv-chips">${chips.join('')}</div>
        <button class="vd-bv-change-btn" onclick="goBackToVenueDetail('intent')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Change date &amp; time
        </button>
      </div>
      ${pkgTier ? `
      <div class="vd-bv-pkg-row">
        <div class="pkg-summary-badge">${escapeHtml(pkgTier.name)} package</div>
        <button class="vd-bv-change-btn" onclick="changePackageFromIntent()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Change package
        </button>
      </div>` : ''}
      ${priceSection}
    </div>`
}

// Step 1: collect form data → show intent screen (no DB write yet)
// Shared intent screen HTML builder — used by both inline and modal booking paths
function buildIntentScreenHTML(lead, { containerClass = 'vd-intent-wrap container' } = {}) {
  const totalFmt = lead.advance_amount.toLocaleString('en-IN')
  const remainingFmt = lead.advance_amount > 0
    ? (Math.round(lead.advance_amount / 0.3) - lead.advance_amount).toLocaleString('en-IN')
    : '0'
  // Whole-floor (combo) is request-only: it can't be instant-locked by the
  // customer. A combo booking must route through admin Hold → Confirm, where
  // the child-blocking fanout and the Airbnb sync buffer run. So we hide the
  // Lock button and offer only the request action for combos.
  // requires_confirmation venues work the same way — query-only, no lock.
  const isCombo = appState.currentVenue?.type === 'combo'
  const requiresConfirmation = !!appState.currentVenue?.requires_confirmation
  const queryOnly = isCombo || requiresConfirmation
  const venueName = appState.currentVenue?.name || ''
  return `
    <div class="${containerClass}">
      <div class="vd-intent-card">
        <div class="vd-intent-body">
          <div class="vd-intent-icon">🧺</div>
          <h2 class="vd-intent-heading">You're almost there!</h2>
          <p class="vd-intent-sub">${queryOnly
            ? (isCombo ? 'Request the whole floor and we\'ll confirm availability with you.' : `We'll check availability at <strong>${escapeHtml(venueName)}</strong> and get back to you shortly.`)
            : `${venueName ? `Your spot at <strong>${escapeHtml(venueName)}</strong> is one step away.` : 'One step away from your perfect picnic.'}`}</p>

          ${buildIntentSummaryHTML()}

          <div class="vd-intent-options">
            ${queryOnly ? `
            <button class="vd-intent-btn vd-intent-btn--query" onclick="submitBookingIntent(false)">
              <span class="vd-intent-btn-icon">📞</span>
              <span class="vd-intent-btn-text">
                <span class="vd-intent-btn-title">${isCombo ? 'Request the whole floor' : 'Send a request'}</span>
                <span class="vd-intent-btn-desc">${isCombo ? 'We\'ll check the floor is free and reach out to confirm' : 'We\'ll confirm availability and reach out to finalise'}</span>
              </span>
            </button>` : `
            <button class="vd-intent-btn vd-intent-btn--lock" onclick="submitBookingIntent(true)">
              <span class="vd-intent-btn-icon">🔒</span>
              <span class="vd-intent-btn-text">
                <span class="vd-intent-btn-title">${lead.advance_amount > 0 ? `Pay advance &amp; lock my date — ₹${totalFmt}` : 'Lock my date'}</span>
                <span class="vd-intent-btn-desc">${lead.advance_amount > 0 ? `Remaining ₹${remainingFmt} due on the day · spot is reserved once payment clears` : 'Your spot is reserved the moment payment goes through'}</span>
              </span>
            </button>
            <div class="vd-intent-divider">or</div>
            <a id="vd-intent-wa" class="vd-intent-btn vd-intent-btn--wa" href="${intentWaHref(lead)}"
               target="_blank" rel="noopener noreferrer" onclick="intentWhatsAppClick()">
              <span class="vd-intent-btn-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              </span>
              <span class="vd-intent-btn-text">
                <span class="vd-intent-btn-title">Questions? Chat with us on WhatsApp</span>
                <span class="vd-intent-btn-desc">Instant replies from the ${escapeHtml(venueName) || 'venue'} team — we'll help you lock it in</span>
              </span>
            </a>`}
          </div>

          <p class="vd-intent-note">⏱ We'll hold this date for 24 hours.</p>
        </div>
      </div>
    </div>`
}

function handleInlineBookingSubmit(event) {
  event.preventDefault()
  const form  = event.target
  const venue = appState.currentVenue
  if (!venue) return

  // Guard: café must have a time slot selected
  if (venue.type === 'cafe' && !appState.selectedTimeSlot) {
    showToast('Please select a time slot to continue', 'error')
    return
  }
  // Guard: BnB must have both check-in and checkout
  if (venue.type === 'self_managed' && (!appState.checkinDate || !appState.checkoutDate)) {
    showToast('Please select your check-in and checkout dates', 'error')
    return
  }

  const picnicPrice = getPicnicPrice(venue, appState.adults)
  const addonSum      = Array.from(document.querySelectorAll('.bv-addon-check:checked'))
    .reduce((s, cb) => s + Number(cb.dataset.addonPrice), 0)

  // Build the pending lead (no confirmed flag yet)
  const lead = {
    full_name:            form['full-name'].value.trim(),
    mobile_number:        form['mobile-number'].value.trim(),
    email_address:        form['email-address'].value.trim(),
    guest_count:          appState.adults + appState.children,
    children_count:       appState.children,
    preferred_date:       appState.selectedDate || appState.checkinDate || '',
    special_requirements: form['special-requirements'].value.trim(),
    advance_amount:       0,
    created_at:           new Date().toISOString(),
  }

  // Occasion: dropdown value, or the free-text "Other" entry when selected
  const occasionSel   = form['occasion']?.value || ''
  const occasionOther = form['occasion-other']?.value.trim() || ''
  lead.occasion = (occasionSel === 'Other' ? occasionOther : occasionSel) || null

  // Celebration board: only stored when a type is chosen (optional)
  const boardType    = form['board-type']?.value || ''
  const boardMessage = form['board-message']?.value.trim() || ''
  lead.board = boardType ? { type: boardType, message: boardMessage } : null
  if (venue.type !== 'custom') lead.venue_id = venue.id
  // Packages: appState.selectedPackage is set by selectPackageTier() when the
  // package-tier flow was taken for this venue — snapshot the tier key onto
  // the lead so captureLeadOnIntent/submitBookingIntent pass it to the RPC,
  // which resolves it to a name/tagline snapshot on the booking row.
  if (venue.type === 'cafe' && appState.selectedPackage) {
    lead.package_key = appState.selectedPackage.tierKey
  }
  if (venue.type === 'cafe' && appState.selectedTimeSlot) {
    lead.time_slot      = appState.selectedTimeSlot
    lead.advance_amount = Math.round((picnicPrice + addonSum) * 0.3)
  }
  if (venue.type === 'self_managed' && appState.checkinDate && appState.checkoutDate) {
    lead.checkout_date  = appState.checkoutDate
    lead.preferred_date = appState.checkinDate
    const nights        = calcNights(appState.checkinDate, appState.checkoutDate)
    lead.advance_amount = Math.round((nights * (Number(venue.metadata?.stay_price_per_night) || 0) + picnicPrice + addonSum) * 0.3)
  }

  // Snapshot selected add-ons (checkboxes disappear when we replace the view)
  const pendingAddOns = Array.from(document.querySelectorAll('.bv-addon-check:checked'))
    .map(cb => ({
      addon_id:              parseInt(cb.dataset.addonId, 10),
      name:                  cb.dataset.addonName || '',
      price_at_booking:      parseInt(cb.dataset.addonPrice, 10),
      requires_confirmation: cb.dataset.addonConfirm === 'true',
    }))

  // Store for the intent step
  appState.pendingLead   = lead
  appState.pendingAddOns = pendingAddOns

  // Identify the user once they've filled in their details
  if (lead.mobile_number) {
    identifyUser(lead.mobile_number, { name: lead.full_name, email: lead.email_address })
  }
  track('booking_form_submitted', {
    venue_id:     venue.id,
    venue_name:   venue.name,
    venue_type:   venue.type,
    guests:       lead.guest_count,
    has_occasion: !!lead.occasion,
    has_board:    !!lead.board,
    addon_count:  (pendingAddOns || []).length,
  })

  // Replace booking form with intent screen
  const bookView = document.getElementById('vd-booking-view')
  if (!bookView) return

  bookView.innerHTML = buildIntentScreenHTML(lead, { containerClass: 'vd-intent-wrap container' })

  // Capture the lead NOW — contact details are in hand, and anyone who
  // abandons at this screen should still be reachable for follow-up.
  captureLeadOnIntent()
}

// ── Intent-screen lead capture ─────────────────────────────────────────────
// The lead row is created the moment the intent screen renders — the customer
// has already given name/phone/email on the form, so someone who closes the
// tab without clicking either button still exists as a follow-up-able row
// (lead_status 'pending'; the nightly cron sweeps untouched ones to
// 'abandoned'). First render INSERTs; re-renders (change date / change
// package) and the later pay-click UPDATE the same row via p_booking_id —
// the RPC guards that update server-side by matching phone+email on an
// unconfirmed row, so a guessed id can't tamper with someone else's lead.
function captureLeadOnIntent() {
  const lead  = appState.pendingLead
  const venue = appState.currentVenue
  if (!lead || !lead.mobile_number) return
  const addOns = appState.pendingAddOns || []
  appState.pendingLeadCapture = supabase.rpc('submit_booking_intent', {
    p_full_name:            lead.full_name,
    p_mobile_number:        lead.mobile_number,
    p_email_address:        lead.email_address,
    p_guest_count:          lead.guest_count,
    p_preferred_date:       lead.preferred_date,
    p_special_requirements: lead.special_requirements || '',
    p_advance_amount:       lead.advance_amount,
    p_confirmed:            false,
    p_customer_intent:      'query',
    p_venue_id:             lead.venue_id             ?? null,
    p_venue_address:        lead.venue_address        ?? null,
    p_checkout_date:        lead.checkout_date        ?? null,
    p_time_slot:            lead.time_slot            ?? null,
    p_external_booking_ref: lead.external_booking_ref ?? null,
    p_occasion:             lead.occasion ?? null,
    p_board:                lead.board    ?? null,
    p_children_count:       lead.children_count ?? 0,
    p_booking_id:           lead.booking_id ?? null,
    p_package_key:          lead.package_key ?? null,
    p_add_ons:              addOns.map(a => ({
      addon_id:              a.addon_id,
      name:                  a.name,
      price_at_booking:      a.price_at_booking,
      requires_confirmation: a.requires_confirmation,
    })),
  }).then(({ data, error }) => {
    if (error) throw error
    const row = data?.[0]
    if (row?.id) {
      lead.booking_id = row.id
      // Refresh the WhatsApp CTA href so the pre-filled message carries the ref
      const wa = document.getElementById('vd-intent-wa')
      if (wa && appState.pendingLead === lead) wa.href = intentWaHref(lead)
      if (!lead._captureTracked) {
        lead._captureTracked = true
        track('intent_lead_captured', {
          booking_id: row.id, venue_id: lead.venue_id, venue_name: venue?.name,
        })
      }
    }
    return row
  }).catch(err => {
    console.warn('[lead-capture] not recorded:', err?.message || err)
    return null
  })
}

// wa.me href for the intent-screen CTA — venue team's number when known,
// message pre-filled from the pending lead (booking ref included once the
// capture RPC has returned an id).
function intentWaHref(lead) {
  const venue = appState.currentVenue
  const team  = venue?.team_id ? (appState.teams || []).find(t => t.id === venue.team_id) : null
  const num   = (team?.whatsapp || WHATSAPP_FALLBACK_NUMBER).replace(/\D/g, '')
  const booking = {
    id:             lead.booking_id ?? null,
    preferred_date: lead.preferred_date,
    time_slot:      lead.time_slot,
    guest_count:    lead.guest_count,
    advance_amount: lead.advance_amount,
    total_amount:   lead.advance_amount > 0 ? Math.round(lead.advance_amount / 0.3) : null,
  }
  return `https://wa.me/${num}?text=${encodeURIComponent(buildWhatsAppMessage(booking, venue?.name || '', false))}`
}

// Intent-screen WhatsApp CTA click. The anchor opens wa.me natively (default
// navigation → the global wa.me listener fires the Meta Pixel Contact event);
// we record the funnel touch once the captured row id is known, then land the
// main tab on the success page as a saved query lead.
function intentWhatsAppClick() {
  const lead  = appState.pendingLead
  const venue = appState.currentVenue
  if (!lead) return true
  track('intent_whatsapp_clicked', {
    booking_id: lead.booking_id ?? null, venue_id: lead.venue_id, venue_name: venue?.name,
  })
  // Wait for the capture RPC (usually already resolved) so the row exists,
  // then mark it — recordLeadStatus no-ops safely if capture failed.
  Promise.resolve(appState.pendingLeadCapture).then(() => {
    if (lead.booking_id) recordLeadStatus(lead.booking_id, 'whatsapp_clicked')
  })
  const sub = document.querySelector('#vd-intent-wa .vd-intent-btn-desc')
  if (sub) sub.textContent = 'Opening WhatsApp…'
  setTimeout(() => {
    const bookingRow = {
      id: lead.booking_id ?? null,
      preferred_date: lead.preferred_date,
      guest_count:    lead.guest_count,
    }
    finishBookingFlow(bookingRow, venue, false)
  }, 400)
  return true
}
window.intentWhatsAppClick = intentWhatsAppClick

// Step 2: user picks their intent → insert booking (always unconfirmed)
// SECURITY: confirmed is never trusted from the client. Admin confirms manually
// after verifying payment. customer_intent records what the customer wanted.
async function submitBookingIntent(wantsToLock) {
  const lead  = appState.pendingLead
  const venue = appState.currentVenue
  if (!lead) return

  // Safety net: whole-floor (combo) can never be instant-locked by a customer.
  // It must go through admin Hold → Confirm (where the child fanout runs), so
  // force any combo submission to a query regardless of which button fired.
  if (venue?.type === 'combo') wantsToLock = false

  // Guard: advance_amount must not be negative (0 is valid for query bookings)
  if ((lead.advance_amount ?? 0) < 0) {
    showToast('Invalid booking amount', 'error')
    return
  }

  // Disable both buttons
  document.querySelectorAll('.vd-intent-btn').forEach(b => { b.disabled = true })
  const activeBtn = wantsToLock
    ? document.querySelector('.vd-intent-btn--lock')
    : document.querySelector('.vd-intent-btn--query')
  if (activeBtn) activeBtn.querySelector('.vd-intent-btn-title').textContent = 'Submitting…'

  // confirmed:true = customer locked (payment done), confirmed:false = query only
  // customer_intent mirrors this for audit purposes
  const insertData = {
    ...lead,
    confirmed:       wantsToLock,
    customer_intent: wantsToLock ? 'lock' : 'query',
  }
  const addOnsToInsert = appState.pendingAddOns || []

  // The intent-screen capture may still be in flight — wait for it so
  // lead.booking_id is known and this click UPDATEs that row instead of
  // inserting a duplicate. A failed capture resolves null (booking_id stays
  // unset) and we fall through to a fresh insert, exactly the old behaviour.
  if (appState.pendingLeadCapture) {
    try { await appState.pendingLeadCapture } catch (_) { /* insert fresh below */ }
  }

  try {
    // Server-side freshness check — catches stale client state (admin blocked/booked after page opened).
    if (venue?.id && lead.preferred_date) {
      const maxSetups = venue.max_concurrent_setups || 1

      if (venue.type === 'cafe') {
        // Check 1: admin has blocked this full day
        const { data: adminBlocks } = await supabase
          .from('venue_availability')
          .select('date')
          .eq('venue_id', venue.id)
          .eq('source', 'admin')
          .eq('date', lead.preferred_date)
        if (adminBlocks?.length) throw new Error('This date is no longer available. Please pick a different date.')

        // Check 2: this specific slot is now at capacity
        if (lead.time_slot) {
          const { count } = await supabase
            .from('bookings')
            .select('*', { count: 'exact', head: true })
            .eq('venue_id', venue.id)
            .eq('preferred_date', lead.preferred_date)
            .eq('time_slot', lead.time_slot)
            .eq('confirmed', true)
          if (count >= maxSetups) throw new Error('This time slot is no longer available. Please pick a different slot.')
        }
      } else if (venue.type === 'self_managed' && lead.checkout_date) {
        // Check admin blocks across the range
        const { data: adminBlocks } = await supabase
          .from('venue_availability')
          .select('date')
          .eq('venue_id', venue.id)
          .in('source', ['admin', 'ical'])
          .gte('date', lead.preferred_date)
          .lt('date', lead.checkout_date)
        if (adminBlocks?.length) throw new Error('One or more dates in your selection are no longer available. Please pick different dates.')

        // Check confirmed-booking occupancy per night
        const { data: existing } = await supabase
          .from('bookings')
          .select('preferred_date, checkout_date')
          .eq('venue_id', venue.id)
          .eq('confirmed', true)
        const countMap = new Map()
        for (const b of existing || []) {
          const s = new Date(b.preferred_date + 'T00:00:00')
          const e = b.checkout_date ? new Date(b.checkout_date + 'T00:00:00') : new Date(s.getTime() + 86400000)
          for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
            const ds = localDateStr(d)
            countMap.set(ds, (countMap.get(ds) || 0) + 1)
          }
        }
        const reqStart = new Date(lead.preferred_date + 'T00:00:00')
        const reqEnd   = new Date(lead.checkout_date   + 'T00:00:00')
        for (let d = new Date(reqStart); d < reqEnd; d.setDate(d.getDate() + 1)) {
          if ((countMap.get(localDateStr(d)) || 0) >= maxSetups) {
            throw new Error('One or more dates in your selection are no longer available. Please pick different dates.')
          }
        }
      }
    }

    // Use SECURITY DEFINER RPC so confirmed:true can be set regardless of caller's role
    const { data: rpcRows, error } = await supabase.rpc('submit_booking_intent', {
      p_full_name:            lead.full_name,
      p_mobile_number:        lead.mobile_number,
      p_email_address:        lead.email_address,
      p_guest_count:          lead.guest_count,
      p_preferred_date:       lead.preferred_date,
      p_special_requirements: lead.special_requirements || '',
      p_advance_amount:       lead.advance_amount,
      // Always insert UNCONFIRMED. A lock booking is confirmed only after the
      // verify-payment edge function validates the Razorpay signature server-side.
      p_confirmed:            false,
      p_customer_intent:      wantsToLock ? 'lock' : 'query',
      p_venue_id:             lead.venue_id             ?? null,
      p_venue_address:        lead.venue_address        ?? null,
      p_checkout_date:        lead.checkout_date        ?? null,
      p_time_slot:            lead.time_slot            ?? null,
      p_external_booking_ref: lead.external_booking_ref ?? null,
      p_occasion:             lead.occasion ?? null,
      p_board:                lead.board    ?? null,
      p_children_count:       lead.children_count ?? 0,
      // Reuse the row captured when the intent screen rendered (see
      // captureLeadOnIntent) — the RPC updates it in place when phone+email
      // match; otherwise it inserts fresh.
      p_booking_id:           lead.booking_id ?? null,
      p_package_key:          lead.package_key ?? null,
      p_add_ons:              addOnsToInsert.map(a => ({
        addon_id:              a.addon_id,
        name:                  a.name,
        price_at_booking:      a.price_at_booking,
        requires_confirmation: a.requires_confirmation,
      })),
    })
    if (error) throw error

    const bookingRow = rpcRows?.[0] ?? {
      id:             null,
      preferred_date: lead.preferred_date,
      guest_count:    lead.guest_count,
    }

    // Add-ons are persisted inside the submit_booking_intent RPC (same
    // transaction as the booking) so they're committed before the insert-trigger
    // notification fires — the admin alert email can include them.
    track('booking_intent_submitted', {
      intent:          wantsToLock ? 'lock' : 'query',
      booking_id:      bookingRow.id,
      venue_id:        lead.venue_id,
      venue_name:      venue?.name,
      guests:          lead.guest_count,
      advance_amount:  lead.advance_amount,
    })

    // Lock path with a real advance → collect payment via Razorpay, then let
    // the server confirm. The booking was just inserted as an unconfirmed lead;
    // verify-payment flips it to confirmed only on a valid signature (which
    // fires the confirmation email), so an abandoned payment leaves a clean
    // "call me" lead the team can follow up on.
    if (wantsToLock && (lead.advance_amount ?? 0) > 0 && bookingRow.id) {
      await startRazorpayCheckout(bookingRow, lead, venue)
      return
    }

    // Query path (or zero-advance) → finish immediately as an unconfirmed lead.
    finishBookingFlow(bookingRow, venue, false)

  } catch (err) {
    console.error(err)
    showToast(err.message || 'Error submitting. Please try again.', 'error')
    document.querySelectorAll('.vd-intent-btn').forEach(b => { b.disabled = false })
    if (activeBtn) activeBtn.querySelector('.vd-intent-btn-title').textContent =
      wantsToLock ? `Lock my date — ₹${lead.advance_amount.toLocaleString('en-IN')}` : 'Just checking — call me'
  }
}

// ----------------------------------------------------------------
// RAZORPAY PAYMENT (Standard Checkout)
// ----------------------------------------------------------------
// The booking row already exists (unconfirmed). Flow:
//   create-order (server) → Razorpay modal → verify-payment (server) → confirmed.
// The KEY SECRET never reaches the client; signature verification is server-side.

async function startRazorpayCheckout(bookingRow, lead, venue) {
  const bookingId  = bookingRow?.id
  const amountPaise = Math.round((lead.advance_amount || 0) * 100)

  // Razorpay's checkout.js must have loaded. If it didn't (blocked/offline),
  // don't lose the lead — keep it as an unconfirmed request.
  if (typeof window.Razorpay === 'undefined') {
    showToast('Payment couldn’t load — we’ve saved your request and will reach out.', 'success')
    finishBookingFlow(bookingRow, venue, false)
    return
  }
  if (!bookingId || amountPaise < 100) {
    finishBookingFlow(bookingRow, venue, false)
    return
  }

  try {
    // 1) Create the order server-side
    const { data: order, error: orderErr } = await supabase.functions.invoke('create-order', {
      body: {
        amount:     amountPaise,
        currency:   'INR',
        receipt:    `booking_${bookingId}`,
        booking_id: bookingId,
      },
    })
    if (orderErr || !order?.order_id) {
      throw new Error(order?.error || orderErr?.message || 'Could not start the payment.')
    }

    // 2) Open Razorpay Standard Checkout
    const rzp = new window.Razorpay({
      key:         order.key_id || RAZORPAY_KEY_ID,
      order_id:    order.order_id,
      amount:      order.amount,
      currency:    order.currency || 'INR',
      name:        'The Picnic Stories',
      description: venue?.name ? `Advance — ${venue.name}` : 'Picnic advance payment',
      prefill: {
        name:    lead.full_name || '',
        email:   lead.email_address || '',
        contact: lead.mobile_number || '',
      },
      notes:  { booking_id: String(bookingId) },
      theme:  { color: '#c4607a' },
      handler: (resp) => { verifyAndFinish(resp, bookingRow, venue) },
      modal: {
        ondismiss: () => {
          showToast('Payment cancelled — we’ve saved your request and will reach out.', 'success')
          finishBookingFlow(bookingRow, venue, false)
        },
      },
    })
    rzp.on('payment.failed', (resp) => {
      track('payment_failed', {
        booking_id: bookingId,
        venue_name: venue?.name,
        reason:     resp?.error?.description || 'unknown',
        error_code: resp?.error?.code,
      })
      showToast(resp?.error?.description || 'Payment failed. We’ve saved your request.', 'error')
      finishBookingFlow(bookingRow, venue, false)
    })
    track('payment_initiated', {
      booking_id:  bookingId,
      venue_name:  venue?.name,
      amount_inr:  Math.round(amountPaise / 100),
      order_id:    order.order_id,
    })
    recordLeadStatus(bookingId, 'payment_initiated')
    rzp.open()
  } catch (err) {
    console.error('startRazorpayCheckout:', err)
    showToast(err.message || 'Could not start the payment. We’ve saved your request.', 'error')
    finishBookingFlow(bookingRow, venue, false)
  }
}

// Send the three Razorpay tokens to the server for signature verification.
// Only a verified signature flips the booking to confirmed (done server-side).
async function verifyAndFinish(resp, bookingRow, venue) {
  try {
    const { data: result, error } = await supabase.functions.invoke('verify-payment', {
      body: {
        booking_id:          bookingRow.id,
        razorpay_order_id:   resp.razorpay_order_id,
        razorpay_payment_id: resp.razorpay_payment_id,
        razorpay_signature:  resp.razorpay_signature,
      },
    })
    if (error || !result?.ok) {
      throw new Error(result?.error || error?.message || 'Payment verification failed.')
    }
    track('payment_succeeded', {
      booking_id:  bookingRow.id,
      payment_id:  resp.razorpay_payment_id,
      venue_name:  venue?.name,
    })
    finishBookingFlow(bookingRow, venue, true)
  } catch (err) {
    console.error('verifyAndFinish:', err)
    track('payment_verification_failed', {
      booking_id: bookingRow.id,
      reason:     err.message,
    })
    showToast(
      err.message ||
        'We couldn’t verify your payment. If money was deducted it will be refunded — please contact us.',
      'error',
    )
    finishBookingFlow(bookingRow, venue, false)
  }
}

// ── Email pay-link flow: ?pay=<bookingId> ──────────────────────────────────────
// Customer lands here by clicking "Pay Advance" in the booking query email.
// We open Razorpay directly — no booking form needed.
async function handleEmailPayLink(bookingId) {
  if (!bookingId || isNaN(bookingId)) return

  const logoUrl = 'https://cdn-reach.hostinger.com/settings/0a27628d960484a8a3d2b3e50518a32b/307542/logo_1780982818.png'

  const overlay = document.createElement('div')
  overlay.id = 'ep-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#FFF8F5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:32px;text-align:center;'

  function showMsg(title, body, cta = null) {
    overlay.innerHTML = `
      <img src="${logoUrl}" width="64" height="64" alt="The Picnic Stories" style="border-radius:50%;margin-bottom:8px;">
      <p style="margin:0;font-family:Garamond,'Times New Roman',serif;font-size:22px;color:#2D1F14;font-weight:normal;">${title}</p>
      <p style="margin:0;font-family:Garamond,'Times New Roman',serif;font-size:16px;color:#5c4a3a;max-width:360px;line-height:1.6;">${body}</p>
      ${cta ? `<a href="${cta.href}" style="margin-top:8px;display:inline-block;padding:14px 28px;border:1px solid #c4607a;color:#c4607a;font-family:Garamond,'Times New Roman',serif;font-size:14px;text-decoration:none;border-radius:8px;text-transform:uppercase;letter-spacing:2px;">${cta.label}</a>` : ''}
    `
  }

  showMsg('Opening payment…', 'The Picnic Stories')
  document.body.appendChild(overlay)

  try {
    if (typeof window.Razorpay === 'undefined') {
      showMsg(
        'Payment couldn’t load',
        'Your booking request is still saved — please contact us to pay the advance.',
        { href: 'mailto:team@picnicstories.com', label: 'Contact Us' }
      )
      return
    }

    const { data: order, error: orderErr } = await supabase.functions.invoke('create-order', {
      body: { booking_id: bookingId },
    })

    if (orderErr || !order?.order_id) {
      const msg = (order?.error || orderErr?.message || '').toLowerCase()
      if (msg.includes('already paid') || msg.includes('already')) {
        showMsg(
          'Already confirmed!',
          'This booking has already been paid. Check your email for your confirmation.',
          { href: 'mailto:team@picnicstories.com', label: 'Contact Us' }
        )
      } else if (msg.includes('no payable')) {
        showMsg(
          'Nothing to pay yet',
          'This booking doesn’t have a payment amount set — we’ll reach out shortly.',
          { href: 'mailto:team@picnicstories.com', label: 'Contact Us' }
        )
      } else {
        showMsg(
          'Something went wrong',
          'We couldn’t start the payment. Please try again or contact us.',
          { href: 'mailto:team@picnicstories.com', label: 'Contact Us' }
        )
      }
      return
    }

    overlay.style.display = 'none'

    const rzp = new window.Razorpay({
      key:         order.key_id || RAZORPAY_KEY_ID,
      order_id:    order.order_id,
      amount:      order.amount,
      currency:    order.currency || 'INR',
      name:        'The Picnic Stories',
      description: 'Advance payment — lock your date',
      theme:       { color: '#c4607a' },
      handler: async (resp) => {
        overlay.style.display = 'flex'
        showMsg('Confirming your booking…', 'Just a moment while we verify your payment.')
        try {
          await supabase.functions.invoke('verify-payment', {
            body: {
              booking_id:          bookingId,
              razorpay_order_id:   resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature:  resp.razorpay_signature,
            },
          })
          showMsg(
            'Your date is locked! 🎉',
            'Payment received — you’ll get a confirmation email shortly. See you soon!',
            { href: '/', label: 'Back to The Picnic Stories' }
          )
          history.replaceState({}, 'The Picnic Stories', '/')
          track('email_payment_confirmed', { booking_id: bookingId })
        } catch (err) {
          console.error('handleEmailPayLink verify:', err)
          showMsg(
            'Payment received — verifying…',
            'We’ve received your payment and will confirm your booking shortly. Check your email.',
            { href: '/', label: 'Back to Home' }
          )
        }
      },
      modal: {
        ondismiss: () => {
          overlay.remove()
          history.replaceState({}, 'The Picnic Stories', '/')
        },
      },
    })
    rzp.on('payment.failed', (resp) => {
      overlay.style.display = 'flex'
      showMsg(
        'Payment didn’t go through',
        resp?.error?.description || 'Please try again or contact us.',
        { href: 'mailto:team@picnicstories.com', label: 'Contact Us' }
      )
      track('email_payment_failed', { booking_id: bookingId, reason: resp?.error?.description })
    })
    track('email_payment_initiated', { booking_id: bookingId })
    recordLeadStatus(bookingId, 'payment_initiated')
    rzp.open()
  } catch (err) {
    console.error('handleEmailPayLink:', err)
    showMsg(
      'Something went wrong',
      'Please try again or contact us at team@picnicstories.com.',
      { href: 'mailto:team@picnicstories.com', label: 'Contact Us' }
    )
  }
}

// Clear booking state and show the success page.
function finishBookingFlow(bookingRow, venue, confirmed) {
  const venueName = venue?.name || null
  const venueTeamId = venue?.team_id || null

  track(confirmed ? 'booking_confirmed' : 'booking_query_submitted', {
    booking_id:  bookingRow?.id,
    venue_name:  venueName,
    venue_type:  venue?.type,
    guests:      bookingRow?.guest_count,
    advance_amount: bookingRow?.advance_amount,
  })

  // Meta Pixel — Lead event (every completed enquiry or confirmed booking)
  if (typeof fbq === 'function') {
    fbq('track', 'Lead', {
      content_category: bookingRow?.occasion || '',
      content_name:     venue?.city || '',
      num_items:        bookingRow?.guest_count || 0,
      currency:         'INR',
    })
  }

  appState.currentBooking      = null
  appState.currentVenue        = null
  appState.currentVenueAddOns  = []
  appState.pendingLead         = null
  appState.pendingAddOns       = null
  appState.pendingLeadCapture  = null

  const bv = document.getElementById('vd-booking-view')
  if (bv) bv.style.display = 'none'

  renderSuccessPage({ booking: bookingRow, venueName, venueTeamId, confirmed })
  history.pushState({}, 'Booking Confirmed — The Picnic Stories', '/booking-confirmed')
  showPage('query-success-page')
}

// ----------------------------------------------------------------
// BOOKING SUCCESS PAGE
// ----------------------------------------------------------------

// Fire-and-forget lead-funnel status update. The RPC is SECURITY DEFINER,
// only touches unconfirmed rows, and only accepts the customer-action
// statuses — so a stray call can never overwrite a confirmed booking.
function recordLeadStatus(bookingId, status) {
  if (!bookingId) return
  supabase
    .rpc('update_lead_status', { p_booking_id: bookingId, p_status: status })
    .then(({ error }) => { if (error) console.warn('[lead-status] not recorded:', error.message) })
    .catch(err => console.warn('[lead-status] not recorded:', err))
}

// Pre-filled WhatsApp message for the success-page CTA. Only includes lines
// we actually have data for — the RPC-returned booking row carries the full
// bookings columns, but the local fallback row has just id/date/guests.
function buildWhatsAppMessage(booking, venueName, confirmed) {
  let dateStr = 'TBC'
  if (booking?.preferred_date) {
    const d = new Date(booking.preferred_date + 'T00:00:00')
    dateStr = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }
  const slot = CAFE_SLOTS.find(s => s.key === booking?.time_slot)

  const lines = [
    confirmed
      ? 'Hi! I\'ve just paid the advance for my picnic booking and wanted to connect.'
      : 'Hi! I\'d like to confirm my picnic booking.',
    '',
  ]
  if (venueName) lines.push(`📍 Venue: ${venueName}`)
  lines.push(`📅 Date: ${dateStr}`)
  if (slot) lines.push(`⏰ Slot: ${slot.label} (${slot.time})`)
  if (booking?.guest_count) lines.push(`👥 Guests: ${booking.guest_count}`)
  if (booking?.total_amount) lines.push(`💰 Total: ₹${Number(booking.total_amount).toLocaleString('en-IN')}`)
  if (booking?.advance_amount > 0) lines.push(`💳 Advance: ₹${Number(booking.advance_amount).toLocaleString('en-IN')}${confirmed ? ' (paid)' : ''}`)
  if (booking?.id) lines.push('', `Booking ref: #PS-${booking.id}`)
  lines.push('', confirmed ? 'Looking forward to it!' : 'Please help me lock this in!')
  return lines.join('\n')
}

// Success-page WhatsApp CTA click. Record the lead touch (unconfirmed leads
// only), show brief feedback, then let the anchor open wa.me natively —
// keeping the default navigation avoids popup blockers, and the global
// wa.me click listener fires the Meta Pixel Contact event as usual.
function onSuccessWhatsAppClick(bookingId, confirmed) {
  if (!confirmed) recordLeadStatus(bookingId, 'whatsapp_clicked')
  track('success_whatsapp_clicked', { booking_id: bookingId, confirmed })
  const sub = document.querySelector('#bsc-wa-cta .bsc-wa-sub')
  if (sub) sub.textContent = 'Opening WhatsApp…'
  return true
}

function renderSuccessPage({ booking, venueName, venueTeamId, confirmed = false }) {
  const container = document.getElementById('booking-success-content')
  if (!container) return

  // Resolve team phone for contact nudge
  const team = venueTeamId ? (appState.teams || []).find(t => t.id === venueTeamId) : null
  const teamPhone     = team?.phone    || '+91 92669-64666'
  const teamPhoneE164 = teamPhone.replace(/[\s\-]/g, '')

  // WhatsApp CTA — route to the venue team's number when known
  const waNumber = (team?.whatsapp || WHATSAPP_FALLBACK_NUMBER).replace(/\D/g, '')
  const waHref   = `https://wa.me/${waNumber}?text=${encodeURIComponent(buildWhatsAppMessage(booking, venueName, confirmed))}`

  // Format date nicely: "Saturday, 14 June 2026"
  let dateFormatted = ''
  if (booking?.preferred_date) {
    const d = new Date(booking.preferred_date + 'T00:00:00')
    dateFormatted = d.toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    })
  }

  const guestText = booking?.guest_count
    ? `${booking.guest_count} guest${booking.guest_count > 1 ? 's' : ''}`
    : null

  container.innerHTML = `
    <div class="bsc-page">

      <!-- Decorative top band -->
      <div class="bsc-band"></div>

      <div class="bsc-body">

        <!-- Icon -->
        <div class="bsc-icon-wrap" aria-hidden="true">
          <svg class="bsc-icon" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Basket base -->
            <ellipse cx="40" cy="54" rx="26" ry="10" fill="#c4607a" opacity="0.15"/>
            <rect x="16" y="38" width="48" height="20" rx="8" fill="#c4607a" opacity="0.85"/>
            <path d="M16 46 Q40 56 64 46" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 3" fill="none"/>
            <!-- Basket weave lines -->
            <line x1="28" y1="38" x2="28" y2="58" stroke="#fff" stroke-width="1.2" opacity="0.5"/>
            <line x1="40" y1="38" x2="40" y2="58" stroke="#fff" stroke-width="1.2" opacity="0.5"/>
            <line x1="52" y1="38" x2="52" y2="58" stroke="#fff" stroke-width="1.2" opacity="0.5"/>
            <!-- Handle -->
            <path d="M24 38 Q24 22 40 22 Q56 22 56 38" stroke="#c4607a" stroke-width="3.5" fill="none" stroke-linecap="round"/>
            <!-- Blanket/cloth peek -->
            <path d="M18 38 Q22 34 26 38 Q30 42 34 38 Q38 34 42 38 Q46 42 50 38 Q54 34 58 38 Q62 42 62 38" stroke="#556343" stroke-width="2" fill="none" stroke-linecap="round"/>
            <!-- Check mark circle -->
            <circle cx="58" cy="22" r="12" fill="#556343"/>
            <polyline points="53,22 57,26 64,17" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </div>

        <!-- Heading -->
        <h1 class="bsc-heading">${confirmed ? 'Your date is locked in! 🎉' : 'Your picnic is being arranged!'}</h1>
        <p class="bsc-sub">${confirmed
          ? 'Advance received — your spot is secured. We\'ll be in touch shortly.'
          : 'We\'ve received your query and will reach out within 24 hours to confirm.'}</p>

        <!-- Booking summary card -->
        <div class="bsc-card">
          <div class="bsc-card-label">${confirmed ? 'Booking Confirmed' : 'Query'}${booking?.id ? ` #${booking.id}` : ''}</div>
          <div class="bsc-card-details">
            ${venueName ? `
            <div class="bsc-detail">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>${escapeHtml(venueName)}</span>
            </div>` : ''}
            ${dateFormatted ? `
            <div class="bsc-detail">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>${dateFormatted}</span>
            </div>` : ''}
            ${guestText ? `
            <div class="bsc-detail">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>${guestText}</span>
            </div>` : ''}
          </div>
        </div>

        <!-- What happens next -->
        <div class="bsc-steps">
          <p class="bsc-steps-label">What happens next</p>
          <div class="bsc-step-list">
            ${confirmed ? `
            <div class="bsc-step bsc-step--done">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">Advance paid</span>
                <span class="bsc-step-desc">Your date is secured and setup is locked in</span>
              </div>
            </div>
            <div class="bsc-step bsc-step--done">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">Booking received</span>
                <span class="bsc-step-desc">We have your details and preferences</span>
              </div>
            </div>
            <div class="bsc-step">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">We'll be in touch shortly</span>
                <span class="bsc-step-desc">Our team will WhatsApp to share setup details</span>
              </div>
            </div>
            <div class="bsc-step">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">Enjoy your picnic</span>
                <span class="bsc-step-desc">We handle everything, you just show up</span>
              </div>
            </div>
            ` : `
            <div class="bsc-step bsc-step--done">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">Query received</span>
                <span class="bsc-step-desc">We have your details and preferences</span>
              </div>
            </div>
            <div class="bsc-step">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">We'll call within 24h</span>
                <span class="bsc-step-desc">Our team will reach out to confirm availability</span>
              </div>
            </div>
            <div class="bsc-step">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">Pay advance to lock your date</span>
                <span class="bsc-step-desc">Once confirmed, secure your spot with a payment</span>
              </div>
            </div>
            <div class="bsc-step">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">Enjoy your picnic</span>
                <span class="bsc-step-desc">We handle everything, you just show up</span>
              </div>
            </div>
            `}
          </div>
        </div>

        <!-- Actions -->
        <div class="bsc-actions">
          <button class="btn btn--primary btn--lg" onclick="showPage('menu-preview-page')">
            Explore the Menu
          </button>
          <button class="btn btn--outline btn--lg" onclick="navigateHome()">
            Back to Venues
          </button>
        </div>
        <p class="bsc-mybookings-link">
          Want to check on this booking later?
          <button class="bsc-link-btn" onclick="showMyBookingsPage()">Find my booking →</button>
        </p>

        <!-- WhatsApp CTA -->
        <a id="bsc-wa-cta" class="bsc-wa-card" href="${waHref}" target="_blank" rel="noopener noreferrer"
           onclick="onSuccessWhatsAppClick(${booking?.id ?? 'null'}, ${confirmed})">
          <span class="bsc-wa-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
          </span>
          <span class="bsc-wa-text">
            <span class="bsc-wa-title">Talk to us</span>
            <span class="bsc-wa-sub">We'll get back to you within a few hours</span>
          </span>
          <svg class="bsc-wa-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </a>

        <!-- Contact nudge -->
        <p class="bsc-contact-nudge">
          Prefer a call? Reach us at
          <a href="tel:${teamPhoneE164}">${teamPhone}</a>
        </p>

      </div><!-- /bsc-body -->
    </div><!-- /bsc-page -->
  `
}

// ================================================================
//  MY BOOKINGS — phone OTP customer flow (Supabase Auth + Twilio SMS)
// ================================================================

// Normalise free-text Indian mobile input to E.164 (+91XXXXXXXXXX).
// Bookings store numbers inconsistently, but Supabase Auth requires E.164 to
// send the SMS. The server-side lookup (get_my_bookings) re-normalises both
// sides to the last 10 digits, so format drift never hides a booking.
function toE164India(raw) {
  let d = String(raw || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)   // 0XXXXXXXXXX
  if (d.length === 10) d = '91' + d                          // bare 10-digit
  return '+' + d
}

function isValidIndiaMobile(e164) {
  return /^\+91[6-9]\d{9}$/.test(e164)
}

function showMyBookingsPage() {
  showPage('my-bookings-page')
  renderMyBookingsShell()
}

function renderMyBookingsShell() {
  const el = document.getElementById('my-bookings-content')
  if (!el) return
  el.innerHTML = `
    <div class="mbk-page">
      <button class="mbk-back" onclick="navigateHome()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <div class="mbk-body">
        <div class="mbk-icon">📱</div>
        <h2 class="mbk-heading">Find your booking</h2>
        <p class="mbk-sub">Enter the mobile number you used when booking. We'll text you a one-time code to view your bookings.</p>
        <form class="mbk-form" id="mbk-phone-form">
          <input type="tel" id="mbk-phone" class="form-control mbk-input"
                 placeholder="98765 43210" required autocomplete="tel"
                 inputmode="numeric" />
          <button type="submit" class="btn btn--primary mbk-btn" id="mbk-send-btn">
            Send code
          </button>
        </form>
        <p class="mbk-hint">No account needed — just your phone number.</p>
      </div>
    </div>
  `
  document.getElementById('mbk-phone-form')
    ?.addEventListener('submit', sendOtp)
}

async function sendOtp(e) {
  e.preventDefault()
  const phone     = toE164India(document.getElementById('mbk-phone').value)
  const submitBtn = document.getElementById('mbk-send-btn')

  if (!isValidIndiaMobile(phone)) {
    showToast('Enter a valid 10-digit Indian mobile number', 'error')
    return
  }

  submitBtn.disabled    = true
  submitBtn.textContent = 'Sending…'

  try {
    const { error } = await supabase.auth.signInWithOtp({ phone })
    if (error) throw error
    renderOtpInput(phone)
  } catch (err) {
    showToast(err.message || 'Failed to send code', 'error')
    submitBtn.disabled    = false
    submitBtn.textContent = 'Send code'
  }
}

function renderOtpInput(phone) {
  const el = document.getElementById('my-bookings-content')
  if (!el) return
  el.innerHTML = `
    <div class="mbk-page">
      <button class="mbk-back" onclick="showMyBookingsPage()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <div class="mbk-body">
        <div class="mbk-icon">✉️</div>
        <h2 class="mbk-heading">Enter the code</h2>
        <p class="mbk-sub">We sent a 6-digit code to <strong>${escapeHtml(phone)}</strong>.<br>Enter it below — it expires shortly.</p>
        <form class="mbk-form" id="mbk-otp-form">
          <input type="text" id="mbk-otp" class="form-control mbk-input mbk-otp-input"
                 placeholder="000000" maxlength="6" inputmode="numeric"
                 pattern="[0-9]{6}" autocomplete="one-time-code" required />
          <button type="submit" class="btn btn--primary mbk-btn" id="mbk-verify-btn">
            View my bookings
          </button>
        </form>
        <p class="mbk-hint">Didn't get it? Check your messages, or <button class="mbk-resend-btn" onclick="sendOtpResend('${escapeHtml(phone)}')">resend the code</button>.</p>
      </div>
    </div>
  `
  document.getElementById('mbk-otp-form')
    ?.addEventListener('submit', (e) => verifyOtp(e, phone))

  // Auto-format: digits only
  document.getElementById('mbk-otp')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)
  })
}

async function verifyOtp(e, phone) {
  e.preventDefault()
  const token     = document.getElementById('mbk-otp').value.trim()
  const submitBtn = document.getElementById('mbk-verify-btn')
  submitBtn.disabled    = true
  submitBtn.textContent = 'Verifying…'

  try {
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' })
    if (error) throw error
    renderMyBookings()
  } catch (err) {
    showToast(err.message || 'Invalid or expired code', 'error')
    submitBtn.disabled    = false
    submitBtn.textContent = 'View my bookings'
  }
}

async function sendOtpResend(phone) {
  try {
    const { error } = await supabase.auth.signInWithOtp({ phone })
    if (error) throw error
    showToast('New code sent — check your messages', 'success')
  } catch (err) {
    showToast(err.message || 'Failed to resend', 'error')
  }
}
window.sendOtpResend = sendOtpResend

// Venue manager — called from onclick in rendered HTML (ESM module needs explicit global export)
window.openVenueForm     = openVenueForm
window.toggleVenueActive = toggleVenueActive
window.addVfImage        = addVfImage
window.removeVfImage     = removeVfImage
window.addVfMenuPage     = addVfMenuPage
window.removeVfMenuPage  = removeVfMenuPage
window.addVfTier         = addVfTier
window.removeVfTier      = removeVfTier
window.toggleBlockedDate = toggleBlockedDate

async function renderMyBookings() {
  const el = document.getElementById('my-bookings-content')
  if (!el) return

  el.innerHTML = `<div class="mbk-page"><div class="mbk-body"><p class="mbk-sub">Loading your bookings…</p></div></div>`

  try {
    // Server-side RPC: derives the verified phone from the session JWT and
    // matches on the last 10 digits, so messy stored formats still resolve.
    const { data, error } = await supabase.rpc('get_my_bookings')

    if (error) throw error

    if (!data || data.length === 0) {
      el.innerHTML = `
        <div class="mbk-page">
          <button class="mbk-back" onclick="navigateHome()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <div class="mbk-body">
            <div class="mbk-icon">🔍</div>
            <h2 class="mbk-heading">No bookings found</h2>
            <p class="mbk-sub">We couldn't find any bookings under this mobile number.</p>
            <button class="btn btn--outline" onclick="showMyBookingsPage()">Try a different number</button>
          </div>
        </div>
      `
      return
    }

    const cards = data.map(b => {
      const venue     = b.venues
      const statusCls = b.confirmed ? 'mbk-status--confirmed' : 'mbk-status--pending'
      const statusTxt = b.confirmed ? '✓ Confirmed' : '⏳ Pending confirmation'
      const dateStr   = b.preferred_date
        ? new Date(b.preferred_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : '—'
      const checkoutStr = b.checkout_date
        ? ' → ' + new Date(b.checkout_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
        : ''
      const slot = b.time_slot ? ` · ${b.time_slot.charAt(0).toUpperCase() + b.time_slot.slice(1)}` : ''
      return `
        <div class="mbk-card">
          <div class="mbk-card-top">
            <div>
              <p class="mbk-card-venue">${escapeHtml(venue?.name || 'Venue')}</p>
              <p class="mbk-card-meta">${escapeHtml(venue?.area || '')}</p>
            </div>
            <span class="mbk-status ${statusCls}">${statusTxt}</span>
          </div>
          <div class="mbk-card-details">
            <span>📅 ${dateStr}${checkoutStr}${slot}</span>
            <span>👥 ${b.guest_count} guest${b.guest_count !== 1 ? 's' : ''}</span>
            ${b.confirmed && b.advance_amount > 0 ? `<span>💰 ₹${Number(b.advance_amount).toLocaleString('en-IN')} advance paid</span>` : ''}
          </div>
          ${b.special_requirements ? `<p class="mbk-card-note">"${escapeHtml(b.special_requirements)}"</p>` : ''}
        </div>
      `
    }).join('')

    el.innerHTML = `
      <div class="mbk-page">
        <button class="mbk-back" onclick="navigateHome()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <div class="mbk-list-header">
          <h2 class="mbk-heading">Your bookings</h2>
          <p class="mbk-sub">${data.length} booking${data.length !== 1 ? 's' : ''} found</p>
        </div>
        <div class="mbk-cards">${cards}</div>
        <div class="mbk-signout">
          <button class="btn btn--ghost mbk-signout-btn" onclick="customerSignOut()">Sign out</button>
        </div>
      </div>
    `
  } catch (err) {
    showToast('Failed to load bookings', 'error')
    console.error(err)
  }
}

async function customerSignOut() {
  await supabase.auth.signOut()
  navigateHome()
}

// Admin login — uses Supabase Auth; session is validated server-side
async function handleAdminLogin(event) {
  event.preventDefault()
  const email = event.target['admin-email'].value.trim()
  const password = event.target['admin-password'].value

  const submitBtn = event.target.querySelector('[type="submit"]')
  submitBtn.disabled = true
  submitBtn.textContent = 'Logging in…'

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    // onAuthStateChange handles the rest (show dashboard, load data)
  } catch (error) {
    showToast(error.message || 'Invalid credentials', 'error')
  } finally {
    submitBtn.disabled = false
    submitBtn.textContent = 'Login'
  }
}

// Admin logout
async function handleAdminLogout() {
  await supabase.auth.signOut()
  // onAuthStateChange handles UI reset
  showToast('Logged out', 'success')
}

// Toggle admin UI based on auth state.
// SECURITY: only set appState.session and show the dashboard if the session
// belongs to the admin email. OTP-verified customers trigger the same
// onAuthStateChange listener — this check keeps them out of the admin panel.
function applyAuthState(session) {
  const adminLogin     = document.getElementById('admin-login')
  const adminDashboard = document.getElementById('admin-dashboard')

  const isAdmin = !!(session && session.user?.email === ADMIN_EMAIL)

  if (isAdmin) {
    appState.session = session
    if (adminLogin)     adminLogin.classList.add('hidden')
    if (adminDashboard) adminDashboard.classList.remove('hidden')
    loadQueries()
    loadMenuLinks()
  } else {
    appState.session = null   // never let a customer session bleed into admin state
    if (adminLogin)     adminLogin.classList.remove('hidden')
    if (adminDashboard) adminDashboard.classList.add('hidden')
    const adminForm = document.getElementById('admin-login-form')
    if (adminForm) adminForm.reset()
  }
}

// Generate menu link with limits
async function generateMenuLink(foodCount, bevCount) {
  if (!appState.session) return showToast('Admin login required', 'error')
  if (foodCount < 1 || foodCount > 15 || bevCount < 1 || bevCount > 10) {
    return showToast('Food items must be 1-15, beverages 1-10', 'error')
  }

  try {
    const menuLink = {
      max_food_items: foodCount,
      max_bev_items: bevCount,
      created_at: new Date().toISOString(),
    }

    const { data, error } = await supabase.from('menu_links').insert([menuLink]).select()
    if (error) throw error
    
    // Show generated link in UI
    const generatedLinkDiv = document.querySelector('.generated-link')
    const linkInput = document.getElementById('generated-link-url')
    
    if (generatedLinkDiv && linkInput) {
      const fullUrl = `${window.location.origin}?menu=${data[0].token}`
      linkInput.value = fullUrl
      generatedLinkDiv.style.display = 'block'
    }
    
    showToast('Menu link generated', 'success')
    loadMenuLinks()
    return data[0]
  } catch (error) {
    console.error(error)
    showToast('Failed to generate menu link', 'error')
  }
}

// Load queries (unconfirmed bookings)
async function loadQueries() {
  if (!appState.session) return

  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*, venues(name, type, area, team_id)')
      .eq('confirmed', false)
      .order('created_at', { ascending: false })

    if (error) throw error

    // Batch add-ons fetch
    const qIds = (data || []).map(q => q.id)
    const { data: qAddons } = qIds.length
      ? await supabase.from('booking_add_ons').select('booking_id, name, price_at_booking, requires_confirmation').in('booking_id', qIds)
      : { data: [] }
    const addonsByQuery = (qAddons || []).reduce((acc, a) => { ;(acc[a.booking_id] ||= []).push(a); return acc }, {})
    loadedQueries = (data || []).map(q => ({ ...q, booking_add_ons: addonsByQuery[q.id] || [] }))
    renderQueries(loadedQueries)
  } catch (error) {
    console.error(error)
    showToast('Failed to load queries', 'error')
  }
}

// Load bookings (confirmed bookings)
async function loadBookings() {
  if (!appState.session) return

  try {
    // Fetch confirmed bookings, including venue info via FK join
    const { data: bookings, error: bErr } = await supabase
      .from('bookings')
      .select('*, venues(name, type, area, team_id)')
      .eq('confirmed', true)
      .order('created_at', { ascending: false })
    
    if (bErr) throw bErr

    // Batch orders fetch — single query instead of N+1
    const bookingIds = bookings.map(b => b.id)
    const { data: allOrders, error: oErr } = await supabase
      .from('orders')
      .select('id, booking_id, selected_items, created_at')
      .in('booking_id', bookingIds)
    if (oErr) throw oErr

    const ordersByBooking = (allOrders || []).reduce((acc, o) => {
      ;(acc[o.booking_id] ||= []).push(o)
      return acc
    }, {})

    // Batch add-ons fetch
    const { data: allAddons } = bookingIds.length
      ? await supabase.from('booking_add_ons').select('booking_id, name, price_at_booking, requires_confirmation').in('booking_id', bookingIds)
      : { data: [] }
    const addonsByBooking = (allAddons || []).reduce((acc, a) => { ;(acc[a.booking_id] ||= []).push(a); return acc }, {})

    const bookingsWithOrders = bookings.map(b => ({ ...b, orders: ordersByBooking[b.id] || [], booking_add_ons: addonsByBooking[b.id] || [] }))

    loadedBookings = bookingsWithOrders
    renderBookings(loadedBookings)
  } catch (error) {
    console.error(error)
    showToast('Failed to load bookings', 'error')
  }
}

// Load menu links for admin
async function loadMenuLinks() {
  if (!appState.session) return
  
  try {
    const { data, error } = await supabase.from('menu_links').select().order('created_at', { ascending: false })
    if (error) throw error
    renderMenuLinks(data)
  } catch (error) {
    console.error(error)
    showToast('Failed to load menu links', 'error')
  }
}

// Render queries (unconfirmed bookings) with confirm functionality
// ── Query lead-pipeline status ───────────────────────────────
// Ordered top→bottom: actionable leads float up, lost sinks to the bottom.
const QUERY_STATUSES = ['new', 'in_talk', 'quoted', 'no_reply', 'lost']
const QUERY_STATUS_META = {
  new:      { label: 'New',      cls: 'adm-qs--new' },
  in_talk:  { label: 'In talk',  cls: 'adm-qs--in_talk' },
  quoted:   { label: 'Quoted',   cls: 'adm-qs--quoted' },
  no_reply: { label: 'No reply', cls: 'adm-qs--no_reply' },
  lost:     { label: 'Lost',     cls: 'adm-qs--lost' },
}
const QUERY_STATUS_ORDER = QUERY_STATUSES.reduce((m, s, i) => { m[s] = i; return m }, {})
let adminQueryStatusFilter = null   // null = all | one of QUERY_STATUSES

function normalizedQueryStatus(q) {
  return QUERY_STATUS_META[q && q.query_status] ? q.query_status : 'new'
}

function setQueryStatusFilter(status, btn) {
  adminQueryStatusFilter = status || null
  document.querySelectorAll('.adm-status-filter-pill').forEach(p => p.classList.remove('active'))
  if (btn) btn.classList.add('active')
  renderQueries(loadedQueries)
}
window.setQueryStatusFilter = setQueryStatusFilter

function queryStatusSelectHtml(query) {
  const cur  = normalizedQueryStatus(query)
  const opts = QUERY_STATUSES
    .map(s => `<option value="${s}"${s === cur ? ' selected' : ''}>${QUERY_STATUS_META[s].label}</option>`)
    .join('')
  return `<select class="adm-status-select ${QUERY_STATUS_META[cur].cls}" data-id="${escapeHtml(String(query.id))}" onchange="updateQueryStatus('${escapeHtml(String(query.id))}', this.value)" aria-label="Query status">${opts}</select>`
}

async function updateQueryStatus(id, status) {
  if (!QUERY_STATUS_META[status]) return
  try {
    const { error } = await supabase.from('bookings').update({ query_status: status }).eq('id', id)
    if (error) throw error
    const q = (loadedQueries || []).find(x => String(x.id) === String(id))
    if (q) q.query_status = status
    showToast(`Status → ${QUERY_STATUS_META[status].label}`, 'success')
    renderQueries(loadedQueries)
  } catch (err) {
    console.error(err)
    showToast('Failed to update status', 'error')
  }
}
window.updateQueryStatus = updateQueryStatus

// ── Admin: edit a query ──────────────────────────────────────
// Holds the add-on catalog + currently-attached set between open and save,
// so saveQueryEdit can diff without a second round-trip.
let queryEditState = null

async function openQueryEdit(id) {
  const query = (loadedQueries || []).find(x => String(x.id) === String(id))
  if (!query) return showToast('Query not found — reloading', 'error')

  const vtype   = query.venues?.type || ''
  const isCafe  = vtype === 'cafe'
  const isStay  = vtype === 'self_managed' || vtype === 'partner_bnb' || vtype === 'combo' || !!query.checkout_date

  // Pull the venue add-on catalog + this booking's attached add-ons in parallel.
  let catalog = []
  let attached = []
  try {
    const [cat, att] = await Promise.all([
      query.venue_id ? loadVenueAddOns(query.venue_id) : Promise.resolve([]),
      supabase.from('booking_add_ons').select('id, addon_id, price_at_booking, name').eq('booking_id', id),
    ])
    catalog  = cat || []
    attached = (att && att.data) || []
  } catch (err) {
    console.error('edit: add-on load failed', err)
  }

  // Union: catalog add-ons + any attached add-on not in the catalog (so it can be unchecked).
  const byAddonId = new Map()
  catalog.forEach(a => byAddonId.set(a.id, { id: a.id, name: a.name, price: a.price, requires_confirmation: a.requires_confirmation }))
  attached.forEach(a => {
    if (a.addon_id != null && !byAddonId.has(a.addon_id)) {
      byAddonId.set(a.addon_id, { id: a.addon_id, name: a.name || 'Add-on', price: Number(a.price_at_booking || 0), requires_confirmation: false })
    }
  })
  const attachedIds = new Set(attached.map(a => a.addon_id).filter(v => v != null))
  const addonOptions = [...byAddonId.values()]

  queryEditState = {
    id,
    attached,                          // [{ id, addon_id, price_at_booking, name }]
    catalogById: byAddonId,            // addon_id → { id, name, price, requires_confirmation }
  }

  const slotOptions = ['', ...CAFE_SLOTS.map(s => s.key)]
    .map(k => {
      if (!k) return `<option value=""${query.time_slot ? '' : ' selected'}>— none —</option>`
      const s = CAFE_SLOTS.find(sl => sl.key === k)
      return `<option value="${escapeHtml(k)}"${query.time_slot === k ? ' selected' : ''}>${escapeHtml(s ? s.label + ' · ' + s.time : k)}</option>`
    }).join('')

  const addonsHtml = query.venue_id
    ? `<div class="qedit-field qedit-field--full">
         <span>Add-ons</span>
         <div class="qe-addon-list">
           ${addonOptions.length
             ? addonOptions.map(a => `
               <label class="qe-addon">
                 <input type="checkbox" class="qe-addon-cb" value="${escapeHtml(String(a.id))}"${attachedIds.has(a.id) ? ' checked' : ''}>
                 <span>${escapeHtml(a.name)} <em class="qe-addon-price">+₹${Number(a.price || 0).toLocaleString('en-IN')}</em></span>
               </label>`).join('')
             : '<p class="qe-addon-empty">No add-ons available for this venue.</p>'}
         </div>
       </div>`
    : ''

  // Occasion: preset dropdown + free-text "Other" fallback (mirrors the storefront form)
  // Uses the shared module-level OCCASIONS constant (single canonical list).
  const curOcc      = query.occasion || ''
  const occIsPreset = OCCASIONS.includes(curOcc)
  const occOptions  = ['<option value="">Select an occasion (optional)</option>']
    .concat(OCCASIONS.map(o => `<option value="${escapeHtml(o)}"${o === curOcc ? ' selected' : ''}>${escapeHtml(o)}</option>`))
    .concat([`<option value="Other"${(!occIsPreset && curOcc) ? ' selected' : ''}>Other…</option>`])
    .join('')
  const occOtherVal   = (!occIsPreset && curOcc) ? curOcc : ''
  const occOtherStyle = (!occIsPreset && curOcc) ? '' : 'display:none;'

  // Celebration board: type + message (stored as jsonb { type, message })
  const board       = query.board || {}
  const boardType   = board.type || ''
  const boardMsg    = board.message || ''
  const boardOptions = [['', 'No board'], ['black', 'Black chalkboard'], ['white', 'White wooden arch board']]
    .map(([v, l]) => `<option value="${v}"${v === boardType ? ' selected' : ''}>${l}</option>`).join('')
  const boardMsgStyle = boardType ? '' : 'display:none;'

  const overlay = document.createElement('div')
  overlay.className = 'qedit-overlay'
  overlay.id = 'qedit-overlay'
  overlay.innerHTML = `
    <div class="qedit-modal" role="dialog" aria-modal="true" aria-label="Edit query">
      <div class="qedit-head">
        <h3>Edit query · ${escapeHtml(query.full_name || '')}</h3>
        <button class="qedit-close" type="button" onclick="closeQueryEdit()" aria-label="Close">×</button>
      </div>
      <div class="qedit-body">
        <label class="qedit-field qedit-field--full"><span>Full name</span>
          <input id="qe-name" type="text" value="${escapeHtml(query.full_name || '')}"></label>
        <div class="qedit-row">
          <label class="qedit-field"><span>Mobile</span>
            <input id="qe-mobile" type="tel" inputmode="numeric" maxlength="10" value="${escapeHtml(query.mobile_number || '')}"></label>
          <label class="qedit-field"><span>Email</span>
            <input id="qe-email" type="email" value="${escapeHtml(query.email_address || '')}"></label>
        </div>
        <div class="qedit-row">
          <label class="qedit-field"><span>Guests</span>
            <input id="qe-guests" type="number" min="1" value="${escapeHtml(String(query.guest_count ?? ''))}"></label>
          <label class="qedit-field"><span>Children</span>
            <input id="qe-children" type="number" min="0" value="${escapeHtml(String(query.children_count ?? 0))}"></label>
        </div>
        <div class="qedit-row">
          <label class="qedit-field"><span>${isStay ? 'Check-in date' : 'Date'}</span>
            <input id="qe-date" type="date" value="${escapeHtml(query.preferred_date || '')}"></label>
          ${isStay ? `<label class="qedit-field"><span>Check-out date</span>
            <input id="qe-checkout" type="date" value="${escapeHtml(query.checkout_date || '')}"></label>` : ''}
          ${isCafe ? `<label class="qedit-field"><span>Time slot</span>
            <select id="qe-slot">${slotOptions}</select></label>` : ''}
        </div>
        <div class="qedit-field qedit-field--full">
          <span>Occasion</span>
          <select id="qe-occasion" onchange="document.getElementById('qe-occasion-other-wrap').style.display = this.value === 'Other' ? '' : 'none'">${occOptions}</select>
          <div id="qe-occasion-other-wrap" style="${occOtherStyle} margin-top:6px;">
            <input id="qe-occasion-other" type="text" placeholder="Tell us the occasion" value="${escapeHtml(occOtherVal)}">
          </div>
        </div>
        <div class="qedit-field qedit-field--full">
          <span>Celebration board</span>
          <select id="qe-board-type" onchange="document.getElementById('qe-board-msg-wrap').style.display = this.value ? '' : 'none'">${boardOptions}</select>
          <div id="qe-board-msg-wrap" style="${boardMsgStyle} margin-top:6px;">
            <input id="qe-board-msg" type="text" maxlength="60" placeholder="Short one-liner — e.g. Happy Birthday Aanya!" value="${escapeHtml(boardMsg)}">
          </div>
        </div>
        <label class="qedit-field qedit-field--full"><span>Special requirements</span>
          <textarea id="qe-notes" rows="2">${escapeHtml(query.special_requirements || '')}</textarea></label>
        ${addonsHtml}
      </div>
      <div class="qedit-foot">
        <button class="qedit-cancel" type="button" onclick="closeQueryEdit()">Cancel</button>
        <button class="qedit-save" type="button" onclick="saveQueryEdit('${escapeHtml(String(id))}')">Save changes</button>
      </div>
    </div>`
  overlay.addEventListener('click', e => { if (e.target === overlay) closeQueryEdit() })
  document.body.appendChild(overlay)
  // Numeric-only guard on mobile
  const mob = document.getElementById('qe-mobile')
  if (mob) mob.addEventListener('input', () => { mob.value = mob.value.replace(/\D/g, '').slice(0, 10) })
}
window.openQueryEdit = openQueryEdit

function closeQueryEdit() {
  document.getElementById('qedit-overlay')?.remove()
  queryEditState = null
}
window.closeQueryEdit = closeQueryEdit

async function saveQueryEdit(id) {
  if (!queryEditState || String(queryEditState.id) !== String(id)) return
  const val = sel => document.getElementById(sel)?.value?.trim() ?? ''

  const name   = val('qe-name')
  const mobile = val('qe-mobile')
  const email  = val('qe-email')
  const guests = parseInt(val('qe-guests'), 10)
  const children = parseInt(val('qe-children') || '0', 10)
  const date   = val('qe-date')
  const checkoutEl = document.getElementById('qe-checkout')
  const slotEl = document.getElementById('qe-slot')

  // Validation
  if (!name) return showToast('Name is required', 'error')
  if (!/^\d{10}$/.test(mobile)) return showToast('Mobile must be 10 digits', 'error')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('Enter a valid email', 'error')
  if (!Number.isFinite(guests) || guests < 1) return showToast('Guests must be at least 1', 'error')
  if (!date) return showToast('Date is required', 'error')
  if (checkoutEl && checkoutEl.value && checkoutEl.value <= date)
    return showToast('Check-out must be after check-in', 'error')

  const patch = {
    full_name:     name,
    mobile_number: mobile,
    email_address: email,
    guest_count:   guests,
    children_count: Number.isFinite(children) && children >= 0 ? children : 0,
    preferred_date: date,
    special_requirements: val('qe-notes') || null,
  }

  // Occasion: dropdown value, or the free-text "Other" entry when selected
  const occSel   = document.getElementById('qe-occasion')?.value || ''
  const occOther = document.getElementById('qe-occasion-other')?.value?.trim() || ''
  patch.occasion = (occSel === 'Other' ? occOther : occSel) || null

  // Celebration board: only stored when a type is chosen
  const bType = document.getElementById('qe-board-type')?.value || ''
  const bMsg  = document.getElementById('qe-board-msg')?.value?.trim() || ''
  patch.board = bType ? { type: bType, message: bMsg } : null
  if (checkoutEl) patch.checkout_date = checkoutEl.value || null
  if (slotEl)     patch.time_slot     = slotEl.value || null

  // Final add-on set after this edit (checked boxes; falls back to current set when no catalog is rendered)
  const addonListEl   = document.querySelector('.qe-addon-list')
  const finalAddonIds = addonListEl
    ? [...document.querySelectorAll('.qe-addon-cb:checked')].map(cb => parseInt(cb.value, 10))
    : queryEditState.attached.map(a => a.addon_id).filter(v => v != null)

  // Inputs for server-authoritative pricing (mirrors submit_booking_intent: billing guests exclude children)
  const qRow          = (loadedQueries || []).find(x => String(x.id) === String(id))
  const venueId       = qRow?.venue_id ?? null
  const billingGuests = Math.max(guests - (Number.isFinite(children) && children > 0 ? children : 0), 0)
  const nights        = (checkoutEl && checkoutEl.value && date)
    ? Math.max(Math.round((new Date(checkoutEl.value) - new Date(date)) / 86400000), 0)
    : 0
  const slotForCalc   = slotEl ? (slotEl.value || null) : (qRow?.time_slot || null)

  const saveBtn = document.querySelector('.qedit-save')
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…' }

  try {
    // 1. Diff add-ons (only when the venue has a catalog rendered)
    if (addonListEl) {
      const checkedIds = new Set(finalAddonIds)
      const current    = queryEditState.attached      // [{ id (row id), addon_id }]
      const currentIds = new Set(current.map(a => a.addon_id).filter(v => v != null))

      const removeRowIds = current.filter(a => a.addon_id != null && !checkedIds.has(a.addon_id)).map(a => a.id)
      const addAddonIds  = [...checkedIds].filter(aid => !currentIds.has(aid))

      if (removeRowIds.length) {
        const { error: dErr } = await supabase.from('booking_add_ons').delete().in('id', removeRowIds)
        if (dErr) throw dErr
      }
      if (addAddonIds.length) {
        const rows = addAddonIds.map(aid => {
          const meta = queryEditState.catalogById.get(aid) || {}
          return {
            booking_id: id,
            addon_id: aid,
            price_at_booking: Number(meta.price || 0),
            name: meta.name || 'Add-on',
            requires_confirmation: !!meta.requires_confirmation,
          }
        })
        const { error: iErr } = await supabase.from('booking_add_ons').insert(rows)
        if (iErr) throw iErr
      }
    }

    // 2. Recompute server-authoritative total + 30% advance so the card stays in sync with the
    //    edited guests / dates / slot / add-ons. compute_booking_total returns 0 for combo/partner/custom.
    try {
      const { data: t, error: tErr } = await supabase.rpc('compute_booking_total', {
        p_venue_id:       venueId,
        p_billing_guests: billingGuests,
        p_nights:         nights,
        p_addon_ids:      finalAddonIds.length ? finalAddonIds : null,
        p_time_slot:      slotForCalc,
      })
      if (!tErr) {
        const total = Number(t) || 0
        patch.total_amount   = total
        patch.advance_amount = Math.round(total * 0.3)
      } else {
        console.warn('price recompute failed', tErr)
      }
    } catch (priceErr) {
      console.warn('price recompute skipped', priceErr)
    }

    // 3. Single UPDATE on the booking (scalar fields + recomputed pricing)
    const { error: uErr } = await supabase.from('bookings').update(patch).eq('id', id)
    if (uErr) throw uErr

    showToast('Query updated', 'success')
    closeQueryEdit()
    loadQueries()
  } catch (err) {
    console.error('saveQueryEdit failed', err)
    showToast('Failed to save changes', 'error')
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes' }
  }
}
window.saveQueryEdit = saveQueryEdit

function renderQueries(queries) {
  const container = document.getElementById('queries-container')
  if (!container) return

  // Apply team filter
  const teamIdForFilter = adminTeamFilter
    ? (appState.teams.find(t => t.city === adminTeamFilter)?.id ?? null)
    : null
  const teamFiltered = teamIdForFilter !== null
    ? (queries || []).filter(q => q.venues?.team_id === teamIdForFilter)
    : (queries || [])

  // Status filter (null = all)
  const filtered = adminQueryStatusFilter
    ? teamFiltered.filter(q => normalizedQueryStatus(q) === adminQueryStatusFilter)
    : teamFiltered

  // Sort: status priority (actionable on top, lost at bottom), then newest-first.
  const sorted = [...filtered].sort((a, b) => {
    const oa = QUERY_STATUS_ORDER[normalizedQueryStatus(a)]
    const ob = QUERY_STATUS_ORDER[normalizedQueryStatus(b)]
    if (oa !== ob) return oa - ob
    return new Date(b.created_at) - new Date(a.created_at)
  })

  if (!sorted.length) {
    container.innerHTML = `
      <div class="adm-empty">
        <div class="adm-empty-icon">📭</div>
        <h3>${adminQueryStatusFilter ? 'No queries with this status' : 'No queries yet'}</h3>
        <p>${adminQueryStatusFilter ? 'Try a different status filter.' : 'New customer queries will appear here.'}</p>
      </div>`
    return
  }

  container.innerHTML = sorted.map(query => {
    // Venue chip
    let venueChip = ''
    if (query.venues) {
      venueChip = `
        <span class="adm-chip adm-chip--venue">
          <span class="admin-venue-badge ${venueTypeBadgeClass(query.venues.type)}">${escapeHtml(formatVenueType(query.venues.type))}</span>
          ${escapeHtml(query.venues.name)}${query.venues.area ? ` · <span class="adm-chip-area">${escapeHtml(query.venues.area)}</span>` : ''}
        </span>`
    } else if (query.venue_address) {
      venueChip = `<span class="adm-chip adm-chip--venue">📍 ${escapeHtml(query.venue_address)}</span>`
    }

    const airbnbHtml = query.external_booking_ref
      ? `<div class="adm-airbnb-ref">🔗 Airbnb ref: <code>${escapeHtml(query.external_booking_ref)}</code></div>`
      : ''

    const reqHtml = query.special_requirements
      ? `<div class="adm-requirements">"${escapeHtml(query.special_requirements)}"</div>`
      : ''

    const timeAgo = formatTimeAgo(new Date(query.created_at))

    // Auto-computed pricing (set at submit). Shown as a guide; admin still
    // types the final advance at confirm. Custom/query-only leads are 0 → hidden.
    const qTotal = Number(query.total_amount || 0)
    const qAdv   = Number(query.advance_amount || 0)
    const priceBadges = qTotal > 0
      ? `<span class="adm-price-badge adm-price-badge--total" title="Auto-calculated total">Total ₹${qTotal.toLocaleString('en-IN')}</span>
         <span class="adm-price-badge adm-price-badge--adv" title="Suggested 30% advance">Advance ₹${qAdv.toLocaleString('en-IN')}</span>`
      : ''

    // Hold state (combo / whole-floor only)
    const isCombo = query.venues?.type === 'combo'
    const isHeld  = !!query.held_at
    const heldAgo = isHeld ? formatTimeAgo(new Date(query.held_at)) : ''
    // Hourly-cron verdict (set by sync-ical's reconcileHolds)
    const holdStatus    = query.hold_status || ''
    const conflictDates = Array.isArray(query.hold_conflict_dates) ? query.hold_conflict_dates : []
    const checkedAgo    = query.hold_checked_at ? formatTimeAgo(new Date(query.hold_checked_at)) : ''

    return `
    <div class="adm-card adm-card--query" data-id="${escapeHtml(query.id)}">
      <div class="adm-card-header">
        <div class="adm-card-header-name">
          ${queryStatusSelectHtml(query)}
          <span class="adm-name">${escapeHtml(query.full_name)}</span>
        </div>
        <div class="adm-card-header-meta">
          ${paymentBadgeHtml(query)}
          ${priceBadges}
          <span class="adm-timestamp" title="${new Date(query.created_at).toLocaleString()}">${timeAgo}</span>
        </div>
      </div>

      <div class="adm-chips">
        ${venueChip}
        <span class="adm-chip">📅 ${new Date(query.preferred_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        ${query.time_slot ? (() => { const s = CAFE_SLOTS.find(sl => sl.key === query.time_slot); return `<span class="adm-chip">${s ? s.icon : '⏰'} ${s ? s.label + ' · ' + s.time : escapeHtml(query.time_slot)}</span>` })() : ''}
        <span class="adm-chip">👥 ${escapeHtml(query.guest_count)} guest${query.guest_count !== 1 ? 's' : ''}</span>
      </div>

      <div class="adm-contact-row">
        <a class="adm-contact-link" href="tel:${escapeHtml(query.mobile_number)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.5 19.79 19.79 0 01.21 .88 2 2 0 012.18 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.91 7.09a16 16 0 006 6l1.45-1.45a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 13.92z"/></svg>
          ${escapeHtml(query.mobile_number)}
        </a>
        <a class="adm-contact-link" href="mailto:${escapeHtml(query.email_address)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          ${escapeHtml(query.email_address)}
        </a>
      </div>

      ${reqHtml}
      ${occasionBoardHtml(query)}
      ${query.booking_add_ons?.length ? `<div class="adm-booking-addons">${query.booking_add_ons.map(a => `<span class="adm-addon-pill">${escapeHtml(a.name || 'Add-on')} <span class="adm-addon-pill-price">+₹${Number(a.price_at_booking || 0).toLocaleString('en-IN')}</span>${a.requires_confirmation ? ' <span class="adm-addon-pill-tag">on req.</span>' : ''}</span>`).join('')}</div>` : ''}
      ${airbnbHtml}

      ${isCombo ? `<div class="adm-floor-note">🏠 Whole floor = Terracottage Ochre + Terracottage Umber</div>` : ''}

      ${isCombo && isHeld ? `
        <div class="adm-hold-banner">
          <span class="adm-hold-dot"></span>
          On hold · singles blocked ${escapeHtml(heldAgo)} — confirm once Airbnb has synced
        </div>
        <div class="adm-hold-recheck-row">
          <button class="recheck-hold-btn adm-recheck-btn"
            data-id="${escapeHtml(query.id)}"
            data-venue-id="${escapeHtml(String(query.venue_id || ''))}"
            data-preferred-date="${escapeHtml(query.preferred_date || '')}"
            data-checkout-date="${escapeHtml(query.checkout_date || '')}">↻ Re-check availability</button>
          <span class="adm-hold-recheck" id="hold-recheck-${escapeHtml(query.id)}">Verify against Airbnb before you confirm.</span>
        </div>
        ${holdStatus === 'conflict' ? `
          <div class="adm-hold-verdict adm-hold-verdict--bad">
            ⚠ Auto-check ${escapeHtml(checkedAgo)}: now taken on a single${conflictDates.length ? ` — ${escapeHtml(conflictDates.join(', '))}` : ''}. Release recommended — don't confirm.
          </div>` : ''}
        ${holdStatus === 'ripe' ? `
          <div class="adm-hold-verdict adm-hold-verdict--good">
            ✓ Auto-check ${escapeHtml(checkedAgo)}: clear past the buffer — ready to confirm once the guest pays.
          </div>` : ''}` : ''}

      <div class="adm-card-footer">
        <button class="adm-edit-btn" type="button" onclick="openQueryEdit('${escapeHtml(String(query.id))}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
        ${isCombo && !isHeld ? `
          <button class="hold-booking-btn adm-hold-btn"
            data-id="${escapeHtml(query.id)}"
            data-venue-id="${escapeHtml(String(query.venue_id || ''))}"
            data-preferred-date="${escapeHtml(query.preferred_date || '')}"
            data-checkout-date="${escapeHtml(query.checkout_date || '')}">
            🔒 Hold Floor
          </button>` : ''}

        <div class="adm-advance-group">
          <span class="adm-advance-label">₹ Advance</span>
          <input class="adm-advance-input" type="number" id="advance-${escapeHtml(query.id)}" placeholder="0" min="0" step="1">
        </div>

        ${(!isCombo || isHeld) ? `
          <button class="confirm-booking-btn adm-confirm-btn" data-id="${escapeHtml(query.id)}" data-venue-id="${escapeHtml(String(query.venue_id || ''))}" data-venue-type="${escapeHtml(query.venues?.type || '')}" data-preferred-date="${escapeHtml(query.preferred_date || '')}" data-checkout-date="${escapeHtml(query.checkout_date || '')}" data-time-slot="${escapeHtml(query.time_slot || '')}" data-held-at="${escapeHtml(query.held_at || '')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Confirm Booking
          </button>` : ''}

        ${isCombo && isHeld ? `
          <button class="release-hold-btn adm-release-btn" data-id="${escapeHtml(query.id)}">Release</button>` : ''}
      </div>
    </div>`
  }).join('')
}

// Payment-status pill shared by query/booking card headers.
// Renders from booking.payment_status; null/legacy rows render nothing.
function paymentBadgeHtml(b) {
  const map = {
    paid:    { label: 'Paid',            cls: 'adm-pay--paid' },
    pending: { label: 'Payment pending', cls: 'adm-pay--pending' },
    failed:  { label: 'Payment failed',  cls: 'adm-pay--failed' },
  }
  const m = map[b.payment_status]
  if (!m) return ''
  const pid = b.razorpay_payment_id
    ? `<code class="adm-pay-id" title="Razorpay payment id">${escapeHtml(b.razorpay_payment_id)}</code>`
    : ''
  return `<span class="adm-pay-badge ${m.cls}">${m.label}</span>${pid}`
}

// Occasion + celebration-board detail rows shared by query/booking cards
function occasionBoardHtml(b) {
  let html = ''
  if (b.occasion) {
    html += `<div class=”adm-detail-row”>🎉 <strong>Occasion:</strong> ${escapeHtml(b.occasion)}</div>`
  }
  if (b.board && (b.board.type || b.board.message)) {
    const type  = b.board.type ? b.board.type.charAt(0).toUpperCase() + b.board.type.slice(1) + ' board' : 'Board'
    const msg   = b.board.message ? ` — “${escapeHtml(b.board.message)}”` : ''
    html += `<div class=”adm-detail-row”>🪧 <strong>${escapeHtml(type)}:</strong>${msg}</div>`
  }
  if (html) html = `<div class=”adm-detail-section”>${html}</div>`
  return html
}

// Render bookings (confirmed bookings)
function renderBookings(bookings) {
  const container = document.getElementById('bookings-container')
  if (!container) return

  // Apply team filter
  const teamIdForFilter = adminTeamFilter
    ? (appState.teams.find(t => t.city === adminTeamFilter)?.id ?? null)
    : null
  const filtered = teamIdForFilter !== null
    ? (bookings || []).filter(b => b.venues?.team_id === teamIdForFilter)
    : (bookings || [])

  if (!filtered.length) {
    container.innerHTML = `
      <div class="adm-empty">
        <div class="adm-empty-icon">🗓️</div>
        <h3>No confirmed bookings yet</h3>
        <p>Bookings confirmed with advance payment will appear here.</p>
      </div>`
    return
  }

  container.innerHTML = filtered.map(booking => {
    // Venue chip
    let venueChip = ''
    if (booking.venues) {
      venueChip = `
        <span class="adm-chip adm-chip--venue">
          <span class="admin-venue-badge ${venueTypeBadgeClass(booking.venues.type)}">${escapeHtml(formatVenueType(booking.venues.type))}</span>
          ${escapeHtml(booking.venues.name)}${booking.venues.area ? ` · <span class="adm-chip-area">${escapeHtml(booking.venues.area)}</span>` : ''}
        </span>`
    } else if (booking.venue_address) {
      venueChip = `<span class="adm-chip adm-chip--venue">📍 ${escapeHtml(booking.venue_address)}</span>`
    }

    const airbnbHtml = booking.external_booking_ref
      ? `<div class="adm-airbnb-ref">🔗 Airbnb ref: <code>${escapeHtml(booking.external_booking_ref)}</code></div>`
      : ''

    const reqHtml = booking.special_requirements
      ? `<div class="adm-requirements">"${escapeHtml(booking.special_requirements)}"</div>`
      : ''

    const ordersHtml = booking.orders?.length
      ? `<div class="adm-orders-section">
          <span class="adm-orders-label">Previous orders</span>
          <div class="adm-orders-list">
            ${booking.orders.map(o => `
              <div class="adm-order-row">
                <span class="adm-order-id">#${escapeHtml(o.id)}</span>
                <span class="adm-order-items">${o.selected_items.map(i => `${escapeHtml(i.name)} ×${escapeHtml(i.quantity)}`).join(', ')}</span>
              </div>`).join('')}
          </div>
        </div>`
      : ''

    const timeAgo = formatTimeAgo(new Date(booking.created_at))
    const advanceFormatted = Number(booking.advance_amount || 0).toLocaleString('en-IN')

    return `
    <div class="adm-card adm-card--booking" data-id="${escapeHtml(booking.id)}">
      <div class="adm-card-header">
        <div class="adm-card-header-name">
          <span class="adm-status-dot adm-status-dot--confirmed"></span>
          <span class="adm-name">${escapeHtml(booking.full_name)}</span>
        </div>
        <div class="adm-card-header-meta">
          <span class="adm-badge adm-badge--confirmed">Confirmed</span>
          ${paymentBadgeHtml(booking)}
          <span class="adm-amount-badge">₹${advanceFormatted} paid</span>
          <span class="adm-timestamp" title="${new Date(booking.created_at).toLocaleString()}">${timeAgo}</span>
        </div>
      </div>

      <div class="adm-chips">
        ${venueChip}
        <span class="adm-chip">📅 ${new Date(booking.preferred_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        ${booking.time_slot ? (() => { const s = CAFE_SLOTS.find(sl => sl.key === booking.time_slot); return `<span class="adm-chip">${s ? s.icon : '⏰'} ${s ? s.label + ' · ' + s.time : escapeHtml(booking.time_slot)}</span>` })() : ''}
        <span class="adm-chip">👥 ${escapeHtml(booking.guest_count)} guest${booking.guest_count !== 1 ? 's' : ''}</span>
      </div>

      <div class="adm-contact-row">
        <a class="adm-contact-link" href="tel:${escapeHtml(booking.mobile_number)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.5 19.79 19.79 0 01.21 .88 2 2 0 012.18 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.91 7.09a16 16 0 006 6l1.45-1.45a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 13.92z"/></svg>
          ${escapeHtml(booking.mobile_number)}
        </a>
        <a class="adm-contact-link" href="mailto:${escapeHtml(booking.email_address)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          ${escapeHtml(booking.email_address)}
        </a>
      </div>

      ${reqHtml}
      ${occasionBoardHtml(booking)}
      ${booking.booking_add_ons?.length ? `<div class="adm-booking-addons">${booking.booking_add_ons.map(a => `<span class="adm-addon-pill">${escapeHtml(a.name || 'Add-on')} <span class="adm-addon-pill-price">+₹${Number(a.price_at_booking || 0).toLocaleString('en-IN')}</span>${a.requires_confirmation ? ' <span class="adm-addon-pill-tag">on req.</span>' : ''}</span>`).join('')}</div>` : ''}
      ${airbnbHtml}
      ${ordersHtml}

      <div class="adm-menu-section">
        <div class="adm-menu-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          Menu Link
        </div>
        <div class="adm-menu-controls">
          <label class="adm-menu-field">
            <span>Food</span>
            <input class="adm-menu-input" type="number" id="food-count-${escapeHtml(booking.id)}" value="3" min="1" max="15">
          </label>
          <label class="adm-menu-field">
            <span>Drinks</span>
            <input class="adm-menu-input" type="number" id="bev-count-${escapeHtml(booking.id)}" value="2" min="1" max="10">
          </label>
          <button class="generate-menu-btn adm-generate-btn" data-booking-id="${escapeHtml(booking.id)}">
            Generate Link
          </button>
        </div>
        <div class="adm-generated-link" id="generated-link-${escapeHtml(booking.id)}" style="display:none">
          <input class="adm-link-input" type="text" id="menu-url-${escapeHtml(booking.id)}" readonly>
          <button class="copy-menu-btn adm-copy-btn" data-booking-id="${escapeHtml(booking.id)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Copy
          </button>
        </div>
      </div>
    </div>`
  }).join('')
}

// Render menu links
function renderMenuLinks(links) {
  const container = document.getElementById('menu-links-list')
  if (!container) return
  
  if (!links || links.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No menu links yet</h3><p>Generated menu links will appear here.</p></div>'
    return
  }
  
  container.innerHTML = links.map(link => `
    <div class="menu-link-item">
      <div class="menu-link-info">
        <div class="menu-link-id">Menu Link #${link.id}</div>
        <div class="menu-link-details">
          Food Items: ${link.max_food_items} | Beverages: ${link.max_bev_items} | 
          Created: ${new Date(link.created_at).toLocaleDateString()}
        </div>
      </div>
      <div class="menu-link-actions">
        <button class="btn btn--sm btn--outline" onclick="copyMenuLink('${link.token}')">Copy Link</button>
      </div>
    </div>
  `).join('')
}

// Copy menu link
function copyMenuLink(linkToken) {
  const url = `${window.location.origin}?menu=${linkToken}`
  navigator.clipboard.writeText(url).then(() => {
    showToast('Menu link copied to clipboard', 'success')
  }).catch(() => {
    showToast('Failed to copy link', 'error')
  })
}

// Confirm booking
// timeSlot: only relevant for café venues — used for the capacity conflict check.
async function confirmBooking(queryId, venueId, venueType, preferredDate, checkoutDate, timeSlot) {
  if (!appState.session) return showToast('Admin login required', 'error')
  const advanceInput = document.getElementById(`advance-${queryId}`)
  const advanceAmount = parseFloat(advanceInput?.value) || 0

  if (advanceAmount <= 0) {
    showToast('Please enter a valid advance amount', 'error')
    return
  }

  try {
    // 1. Fetch venue capacity
    const { data: venueRow, error: vErr } = await supabase
      .from('venues')
      .select('max_concurrent_setups')
      .eq('id', venueId)
      .single()
    if (vErr) throw vErr
    const maxSetups = venueRow?.max_concurrent_setups || 1

    // 2. Conflict check — count confirmed bookings that already occupy the same slot/dates
    if (venueType === 'cafe' && preferredDate && timeSlot) {
      const { count, error: cErr } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('venue_id', venueId)
        .eq('preferred_date', preferredDate)
        .eq('time_slot', timeSlot)
        .eq('confirmed', true)
        .neq('id', queryId)
      if (cErr) throw cErr
      if (count >= maxSetups) {
        showToast(
          `Cannot confirm: this slot already has ${count}/${maxSetups} confirmed setup${maxSetups > 1 ? 's' : ''}.`,
          'error'
        )
        return
      }
    } else if ((venueType === 'self_managed' || venueType === 'partner_bnb') && preferredDate) {
      // Fetch all confirmed bookings for this venue (excluding current query)
      const { data: existing, error: eErr } = await supabase
        .from('bookings')
        .select('preferred_date, checkout_date')
        .eq('venue_id', venueId)
        .eq('confirmed', true)
        .neq('id', queryId)
      if (eErr) throw eErr

      // Hardening: also respect venue_availability blocks (admin/ical/parent),
      // not just the bookings table. Without this, a child single could be
      // confirmed on a night the whole floor is parent-blocked. The public
      // calendar already hides these dates via fetchBookedData.
      const { data: vaBlocks } = await supabase.from('venue_availability')
        .select('date').eq('venue_id', venueId).in('source', ['admin', 'ical', 'parent'])
      const blockedSet = new Set((vaBlocks || []).map(r => r.date))

      // Build date→occupancy count from existing confirmed stays
      const countMap = new Map()
      for (const b of existing || []) {
        const s = new Date(b.preferred_date + 'T00:00:00')
        const e = b.checkout_date
          ? new Date(b.checkout_date + 'T00:00:00')
          : new Date(s.getTime() + 86400000)
        for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
          const ds = localDateStr(d)
          countMap.set(ds, (countMap.get(ds) || 0) + 1)
        }
      }

      // Check every night of the new booking's range
      const reqStart = new Date(preferredDate + 'T00:00:00')
      const reqEnd   = checkoutDate
        ? new Date(checkoutDate + 'T00:00:00')
        : new Date(reqStart.getTime() + 86400000)
      for (let d = new Date(reqStart); d < reqEnd; d.setDate(d.getDate() + 1)) {
        const ds = localDateStr(d)
        if (blockedSet.has(ds)) {
          showToast(`Cannot confirm: ${ds} is blocked (admin block or whole-floor booking).`, 'error')
          return
        }
        if ((countMap.get(ds) || 0) >= maxSetups) {
          showToast(
            `Cannot confirm: ${ds} already has ${maxSetups} confirmed setup${maxSetups > 1 ? 's' : ''}.`,
            'error'
          )
          return
        }
      }
    } else if (venueType === 'combo' && preferredDate) {
      // Whole-floor: every child must be free for every requested night.
      const { data: kids, error: kErr } = await supabase
        .from('venues').select('id').eq('parent_venue_id', venueId)
      if (kErr) throw kErr
      const childIds = (kids || []).map(k => k.id)

      const [blk, bk] = await Promise.all([
        childIds.length
          ? supabase.from('venue_availability').select('date, source, booking_id')
              .in('venue_id', childIds).in('source', ['admin', 'ical', 'parent'])
          : Promise.resolve({ data: [] }),
        childIds.length
          ? supabase.from('bookings').select('preferred_date, checkout_date')
              .in('venue_id', childIds).eq('confirmed', true)
          : Promise.resolve({ data: [] }),
      ])

      // Exclude THIS booking's own parent blocks (written when it was held) —
      // otherwise a held combo would always collide with itself and never
      // confirm. Other holds' parent rows DO still count as occupied.
      const occupied = new Set(
        (blk.data || [])
          .filter(r => !(r.source === 'parent' && String(r.booking_id) === String(queryId)))
          .map(r => r.date)
      )
      for (const b of bk.data || []) {
        const s = new Date(b.preferred_date + 'T00:00:00')
        const e = b.checkout_date ? new Date(b.checkout_date + 'T00:00:00') : new Date(s.getTime() + 86400000)
        for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) occupied.add(localDateStr(d))
      }

      const reqStart = new Date(preferredDate + 'T00:00:00')
      const reqEnd   = checkoutDate ? new Date(checkoutDate + 'T00:00:00') : new Date(reqStart.getTime() + 86400000)
      for (let d = new Date(reqStart); d < reqEnd; d.setDate(d.getDate() + 1)) {
        const ds = localDateStr(d)
        if (occupied.has(ds)) {
          showToast(`Cannot confirm: ${ds} is already taken on a single unit inside the floor.`, 'error')
          return
        }
      }
    }

    // 3. Confirm the booking
    const { error: confErr } = await supabase
      .from('bookings')
      .update({ confirmed: true, advance_amount: advanceAmount })
      .eq('id', queryId)
    if (confErr) throw confErr

    // Note: venue_availability is no longer written for booking-source rows.
    // Occupancy is computed live from the bookings table everywhere it is needed.

    // Combo fanout: write source='parent' blocks onto every child × every
    // night, so the whole-floor booking rides export-ical out to Airbnb.
    // Idempotent — a held booking already has these rows; don't double-insert
    // (va_parent_unique would reject them anyway).
    if (venueType === 'combo') {
      const { data: existing } = await supabase.from('venue_availability')
        .select('id').eq('source', 'parent').eq('booking_id', queryId).limit(1)
      if (!existing || existing.length === 0) {
        const { data: kids } = await supabase
          .from('venues').select('id').eq('parent_venue_id', venueId)
        const rows = []
        const s = new Date(preferredDate + 'T00:00:00')
        const e = checkoutDate ? new Date(checkoutDate + 'T00:00:00') : new Date(s.getTime() + 86400000)
        for (const k of kids || []) {
          for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
            rows.push({
              venue_id: k.id, date: localDateStr(d),
              status: 'blocked', source: 'parent', booking_id: queryId, time_slot: null,
            })
          }
        }
        if (rows.length) {
          const { error: pErr } = await supabase.from('venue_availability').insert(rows)
          if (pErr) throw pErr
        }
      }
    }

    showToast('Booking confirmed!', 'success')
    loadQueries()
    loadBookings()

  } catch (err) {
    console.error(err)
    showToast('Failed to confirm booking', 'error')
  }
}

// ── Hold a combo (whole-floor) booking: block the singles and start Airbnb's
//    sync clock BEFORE committing to the guest. Combo-only. Mirrors the combo
//    conflict-check + fanout in confirmBooking, but does not set confirmed.
async function holdComboBooking(queryId, venueId, preferredDate, checkoutDate) {
  if (!appState.session) return showToast('Admin login required', 'error')
  if (!preferredDate) return showToast('No date on this query', 'error')
  try {
    const { data: kids, error: kErr } = await supabase
      .from('venues').select('id').eq('parent_venue_id', venueId)
    if (kErr) throw kErr
    const childIds = (kids || []).map(k => k.id)

    // Conflict check: every child must be free for every requested night.
    const [blk, bk] = await Promise.all([
      childIds.length
        ? supabase.from('venue_availability').select('date')
            .in('venue_id', childIds).in('source', ['admin', 'ical', 'parent'])
        : Promise.resolve({ data: [] }),
      childIds.length
        ? supabase.from('bookings').select('preferred_date, checkout_date')
            .in('venue_id', childIds).eq('confirmed', true)
        : Promise.resolve({ data: [] }),
    ])
    const occupied = new Set((blk.data || []).map(r => r.date))
    for (const b of bk.data || []) {
      const s = new Date(b.preferred_date + 'T00:00:00')
      const e = b.checkout_date ? new Date(b.checkout_date + 'T00:00:00') : new Date(s.getTime() + 86400000)
      for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) occupied.add(localDateStr(d))
    }

    const s = new Date(preferredDate + 'T00:00:00')
    const e = checkoutDate ? new Date(checkoutDate + 'T00:00:00') : new Date(s.getTime() + 86400000)
    for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
      if (occupied.has(localDateStr(d))) {
        showToast(`Can't hold: ${localDateStr(d)} is already taken on a single inside the floor.`, 'error')
        return
      }
    }

    // Fanout: write parent blocks for every child × every night.
    const rows = []
    for (const k of kids || []) {
      for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
        rows.push({ venue_id: k.id, date: localDateStr(d), status: 'blocked', source: 'parent', booking_id: queryId, time_slot: null })
      }
    }
    if (rows.length) {
      const { error: pErr } = await supabase.from('venue_availability').insert(rows)
      if (pErr) throw pErr
    }

    // Mark held (NOT confirmed).
    const { error: hErr } = await supabase.from('bookings').update({ held_at: new Date().toISOString() }).eq('id', queryId)
    if (hErr) throw hErr

    showToast('Floor held — singles blocked. Wait for Airbnb to sync before confirming.', 'success')
    loadQueries()
  } catch (err) {
    console.error(err)
    showToast('Failed to hold floor', 'error')
  }
}

// ── Release a hold (decline / let go): delete the parent blocks and clear
//    held_at so the singles re-open. Also the cancellation cleanup for a
//    confirmed combo that gets un-confirmed.
async function releaseHold(queryId) {
  if (!appState.session) return showToast('Admin login required', 'error')
  try {
    const { error: dErr } = await supabase.from('venue_availability')
      .delete().eq('source', 'parent').eq('booking_id', queryId)
    if (dErr) throw dErr
    const { error: uErr } = await supabase.from('bookings')
      .update({ held_at: null, hold_status: null, hold_checked_at: null, hold_conflict_dates: null })
      .eq('id', queryId)
    if (uErr) throw uErr
    showToast('Hold released — singles re-opened.', 'success')
    loadQueries()
  } catch (err) {
    console.error(err)
    showToast('Failed to release hold', 'error')
  }
}

// ── Re-check a held floor against the latest Airbnb data: trigger an on-demand
//    import, then test whether any requested night is now taken on a child
//    (excluding this hold's own parent blocks). Renders the verdict inline so
//    the admin knows BEFORE confirming, instead of finding out at Confirm time.
async function recheckHold(queryId, venueId, preferredDate, checkoutDate, btn) {
  if (!appState.session) return showToast('Admin login required', 'error')
  const card     = btn?.closest('.adm-card')
  const resultEl = card?.querySelector(`#hold-recheck-${queryId}`)
  const setResult = (cls, html) => {
    if (!resultEl) return
    resultEl.className = `adm-hold-recheck ${cls}`
    resultEl.innerHTML = html
  }
  if (btn) btn.disabled = true
  setResult('adm-hold-recheck--checking', '⟳ Syncing Airbnb and re-checking…')
  try {
    // 1. On-demand import from Airbnb. No-op while the singles have no feed.
    const { error: fnErr } = await supabase.functions.invoke('sync-ical', { body: {} })
    if (fnErr) console.warn('sync-ical invoke failed; re-checking against current data:', fnErr)

    // 2. Children + their occupancy, excluding this hold's own parent rows.
    const { data: kids } = await supabase.from('venues')
      .select('id, last_ical_sync_at').eq('parent_venue_id', venueId)
    const childIds = (kids || []).map(k => k.id)

    const [blk, bk] = await Promise.all([
      childIds.length
        ? supabase.from('venue_availability').select('date, source, booking_id')
            .in('venue_id', childIds).in('source', ['admin', 'ical', 'parent'])
        : Promise.resolve({ data: [] }),
      childIds.length
        ? supabase.from('bookings').select('preferred_date, checkout_date')
            .in('venue_id', childIds).eq('confirmed', true)
        : Promise.resolve({ data: [] }),
    ])
    const occupied = new Set(
      (blk.data || [])
        .filter(r => !(r.source === 'parent' && String(r.booking_id) === String(queryId)))
        .map(r => r.date)
    )
    for (const b of bk.data || []) {
      const s = new Date(b.preferred_date + 'T00:00:00')
      const e = b.checkout_date ? new Date(b.checkout_date + 'T00:00:00') : new Date(s.getTime() + 86400000)
      for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) occupied.add(localDateStr(d))
    }

    // 3. Test the requested nights.
    const clashes = []
    const s = new Date(preferredDate + 'T00:00:00')
    const e = checkoutDate ? new Date(checkoutDate + 'T00:00:00') : new Date(s.getTime() + 86400000)
    for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
      const ds = localDateStr(d)
      if (occupied.has(ds)) clashes.push(ds)
    }

    // 4. Freshness = oldest child sync time (all children must be current).
    const syncs = (kids || []).map(k => k.last_ical_sync_at).filter(Boolean).sort()
    const fresh = syncs.length
      ? `Airbnb synced ${formatTimeAgo(new Date(syncs[0]))}`
      : 'No Airbnb feed on the singles yet — nothing to import'

    if (clashes.length) {
      setResult('adm-hold-recheck--bad',
        `⚠ Now taken on a single: <strong>${escapeHtml(clashes.join(', '))}</strong>. Release this hold — don't confirm.<span class="adm-hold-fresh">${escapeHtml(fresh)}</span>`)
    } else {
      setResult('adm-hold-recheck--good',
        `✓ Floor still free — safe to confirm.<span class="adm-hold-fresh">${escapeHtml(fresh)}</span>`)
    }
  } catch (err) {
    console.error(err)
    setResult('adm-hold-recheck--bad', '⚠ Re-check failed — try again.')
  } finally {
    if (btn) btn.disabled = false
  }
}

// Generate menu link for booking
async function generateBookingMenuLink(bookingId) {
  if (!appState.session) return showToast('Admin login required', 'error')
  const foodCountInput = document.getElementById(`food-count-${bookingId}`)
  const bevCountInput = document.getElementById(`bev-count-${bookingId}`)
  
  const foodCount = parseInt(foodCountInput.value, 10)
  const bevCount = parseInt(bevCountInput.value, 10)
  
  if (foodCount < 1 || foodCount > 15 || bevCount < 1 || bevCount > 10) {
    showToast('Food items must be 1-15, beverages 1-10', 'error')
    return
  }
  
  try {
    const menuLink = {
      booking_id: parseInt(bookingId, 10),  // persist FK — fixes orphaned-order gap
      max_food_items: foodCount,
      max_bev_items: bevCount,
      created_at: new Date().toISOString(),
    }

    const { data, error } = await supabase.from('menu_links').insert([menuLink]).select()
    if (error) throw error

    const generatedLinkDiv = document.getElementById(`generated-link-${bookingId}`)
    const linkInput = document.getElementById(`menu-url-${bookingId}`)
    
    if (generatedLinkDiv && linkInput) {
      const fullUrl = `${window.location.origin}?menu=${data[0].token}&booking=${bookingId}`
      linkInput.value = fullUrl
      generatedLinkDiv.style.display = 'block'
    }
    
    showToast('Menu link generated for booking!', 'success')
    loadMenuLinks()
    
  } catch (error) {
    console.error(error)
    showToast('Failed to generate menu link', 'error')
  }
}

// Copy booking menu link
function copyBookingMenuLink(bookingId) {
  const linkInput = document.getElementById(`menu-url-${bookingId}`)
  if (linkInput && linkInput.value) {
    navigator.clipboard.writeText(linkInput.value).then(() => {
      showToast('Menu link copied to clipboard', 'success')
    }).catch(() => {
      showToast('Failed to copy link', 'error')
    })
  }
}

// Tab switching
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active')
    content.hidden = true
  })
  
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.classList.remove('active')
    button.setAttribute('aria-selected', 'false')
  })
  
  const targetContent = document.getElementById(`${tabName}-tab`)
  if (targetContent) {
    targetContent.classList.add('active')
    targetContent.hidden = false
  }
  
  const targetButton = document.querySelector(`[data-tab="${tabName}"]`)
  if (targetButton) {
    targetButton.classList.add('active')
    targetButton.setAttribute('aria-selected', 'true')
  }
  
  if (tabName === 'queries') {
    loadQueries()
  } else if (tabName === 'bookings') {
    loadBookings()
  } else if (tabName === 'menu-link') {
    loadMenuLinks()
  } else if (tabName === 'venues') {
    loadVenueManager()
  } else if (tabName === 'availability') {
    initAvailabilityTab()
  } else if (tabName === 'add-ons') {
    loadAddOnsManager()
  } else if (tabName === 'packages') {
    loadPackagesManager()
  } else if (tabName === 'hero-image') {
    loadHeroImageAdminPreview()
  } else if (tabName === 'teams') {
    loadTeamsManager()
  }
}

// ================================================================
// TEAMS MANAGER
// ================================================================

async function loadTeamsManager() {
  if (!appState.session) return
  const container = document.getElementById('teams-manager-container')
  if (!container) return
  container.innerHTML = '<p class="loading-text">Loading teams…</p>'
  try {
    const { data, error } = await supabase.from('teams').select('*').order('id')
    if (error) throw error
    renderTeamsManager(data || [])
  } catch (err) {
    console.error(err)
    showToast('Failed to load teams', 'error')
  }
}

function renderTeamsManager(teams) {
  const container = document.getElementById('teams-manager-container')
  if (!container) return
  container.innerHTML = teams.map(t => `
    <div class="tm-card" data-team-id="${t.id}">
      <div class="tm-card-header">
        <h4 class="tm-city">${escapeHtml(t.name)}</h4>
        <span class="tm-city-slug">${escapeHtml(t.city)}</span>
      </div>
      <div class="tm-fields">
        <label class="tm-label">Display name
          <input class="tm-input" data-field="name" value="${escapeHtml(t.name || '')}" placeholder="e.g. Gurugram / Delhi-NCR">
        </label>
        <label class="tm-label">Phone (display)
          <input class="tm-input" data-field="phone" value="${escapeHtml(t.phone || '')}" placeholder="+91 99999-99999">
        </label>
        <label class="tm-label">WhatsApp number (digits only, with country code)
          <input class="tm-input" data-field="whatsapp" value="${escapeHtml(t.whatsapp || '')}" placeholder="919999999999">
        </label>
        <label class="tm-label">Team contact email
          <input class="tm-input" data-field="contact_email" value="${escapeHtml(t.contact_email || '')}" placeholder="team@example.com">
        </label>
        <label class="tm-label">Display address (optional)
          <input class="tm-input" data-field="display_address" value="${escapeHtml(t.display_address || '')}" placeholder="City, State">
        </label>
      </div>
      <div class="tm-actions">
        <button class="btn btn--primary btn--sm" onclick="saveTeam(${t.id})">Save</button>
      </div>
    </div>
  `).join('')
}

async function saveTeam(id) {
  if (!appState.session) return
  const card = document.querySelector(`.tm-card[data-team-id="${id}"]`)
  if (!card) return
  const payload = {}
  card.querySelectorAll('.tm-input[data-field]').forEach(input => {
    payload[input.dataset.field] = input.value.trim() || null
  })
  try {
    const { error } = await supabase.from('teams').update(payload).eq('id', id)
    if (error) throw error
    // Refresh appState.teams so footer + venue WA button pick up new values
    appState.teams = appState.teams.map(t => t.id === id ? { ...t, ...payload } : t)
    renderFooterTeams(appState.teams)
    showToast('Team saved', 'success')
  } catch (err) {
    console.error(err)
    showToast('Failed to save team: ' + err.message, 'error')
  }
}

// Team filter pill handler (called from admin.html inline onclick)
function setAdminTeamFilter(city, btn) {
  adminTeamFilter = city || null
  document.querySelectorAll('.adm-team-pill').forEach(p => p.classList.remove('active'))
  if (btn) btn.classList.add('active')
  renderQueries(loadedQueries)
  renderBookings(loadedBookings)
}

// ================================================================
// ADD-ONS MANAGER
// ================================================================

const ADDON_CATEGORIES = ['photography', 'decor', 'food', 'entertainment', 'extension']
const ADDON_CATEGORY_LABELS = {
  photography:   '📷 Photography',
  decor:         '🌸 Decor',
  food:          '🍰 Food',
  entertainment: '🎉 Entertainment',
  extension:     '⏱ Extension',
}
const ADDON_VENUE_TYPES = ['cafe', 'self_managed', 'partner_bnb']

let addOnManagerState = {
  addOns: [],
  editingId: null,
}

async function loadAddOnsManager() {
  if (!appState.session) return
  const container = document.getElementById('addons-manager-container')
  if (!container) return
  container.innerHTML = '<p class="loading-text">Loading add-ons…</p>'
  try {
    const { data, error } = await supabase
      .from('add_ons')
      .select('*')
      .order('sort_order')
    if (error) throw error
    addOnManagerState.addOns = data || []
    renderAddOnsList()
  } catch (err) {
    console.error(err)
    showToast('Failed to load add-ons', 'error')
  }
}

function renderAddOnsList() {
  const container = document.getElementById('addons-manager-container')
  if (!container) return

  if (!addOnManagerState.addOns.length) {
    container.innerHTML = `
      <div class="adm-empty">
        <div class="adm-empty-icon">🧩</div>
        <h3>No add-ons yet</h3>
        <p>Click "+ New Add-on" to create the first one.</p>
      </div>`
    return
  }

  // Group by category
  const grouped = ADDON_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = addOnManagerState.addOns.filter(a => a.category === cat)
    return acc
  }, {})

  container.innerHTML = `
    <div class="adm-addons-list">
      ${ADDON_CATEGORIES.map(cat => {
        const items = grouped[cat]
        if (!items.length) return ''
        return `
        <div class="adm-addons-group">
          <h4 class="adm-addons-group-title">${ADDON_CATEGORY_LABELS[cat]}</h4>
          <table class="adm-addons-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Price</th>
                <th>Confirm required</th>
                <th>Available for</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(a => `
              <tr class="${a.is_active ? '' : 'adm-addon-row--inactive'}">
                <td data-label="Name">${escapeHtml(a.name)}</td>
                <td data-label="Price">₹${Number(a.price).toLocaleString('en-IN')}</td>
                <td data-label="Confirm">${a.requires_confirmation ? '✅ Yes' : '—'}</td>
                <td data-label="For">${(a.available_for || []).join(', ')}</td>
                <td data-label="Status">
                  <span class="adm-chip ${a.is_active ? 'adm-chip--confirmed' : 'adm-chip--pending'}">
                    ${a.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td class="adm-addons-actions">
                  <button class="btn btn--outline btn--sm" onclick="openAddOnForm(${a.id})">Edit</button>
                  <button class="btn btn--outline btn--sm" onclick="toggleAddOnActive(${a.id}, ${!a.is_active})">${a.is_active ? 'Deactivate' : 'Activate'}</button>
                  <button class="btn btn--danger btn--sm" onclick="deleteAddOn(${a.id})">Delete</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`
      }).join('')}
    </div>

    <!-- Add-on form (inline, shown/hidden) -->
    <div id="addon-form-wrap" class="adm-addon-form-wrap" style="display:none;">
      <h4 id="addon-form-title">New Add-on</h4>
      <form id="addon-form" class="adm-addon-form" onsubmit="saveAddOn(event)">
        <input type="hidden" id="af-id">
        <div class="adm-addon-form-row">
          <label>Name
            <input type="text" id="af-name" required maxlength="80">
          </label>
          <label>Category
            <select id="af-category" required>
              ${ADDON_CATEGORIES.map(c => `<option value="${c}">${ADDON_CATEGORY_LABELS[c]}</option>`).join('')}
            </select>
          </label>
          <label>Price (₹)
            <input type="number" id="af-price" min="0" step="1" required>
          </label>
          <label>Sort order
            <input type="number" id="af-sort" value="0" min="0" step="10">
          </label>
        </div>
        <div class="adm-addon-form-row">
          <label style="flex:2">Description (optional)
            <input type="text" id="af-description" maxlength="200">
          </label>
          <label>Requires confirmation
            <select id="af-confirm">
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </label>
        </div>
        <div class="adm-addon-form-row">
          <fieldset class="adm-addon-venues">
            <legend>Available for</legend>
            ${ADDON_VENUE_TYPES.map(vt => `
            <label class="adm-addon-venue-check">
              <input type="checkbox" name="available_for" value="${vt}" checked>
              ${escapeHtml(formatVenueType(vt))}
            </label>`).join('')}
          </fieldset>
        </div>
        <div class="adm-addon-form-row">
          <label style="flex:1">Photo
            <div class="af-img-wrap">
              <div id="af-img-preview" class="af-img-preview"></div>
              <label class="vf-img-upload-btn" id="af-img-label">
                ↑ Upload photo
                <input type="file" id="af-img-file" accept="image/jpeg,image/png,image/webp"
                       onchange="handleAfImageUpload(this)" style="display:none" />
              </label>
              <input type="hidden" id="af-image-url" />
            </div>
          </label>
        </div>
        <div class="adm-addon-form-actions">
          <button type="submit" class="btn btn--primary">Save</button>
          <button type="button" class="btn btn--outline" onclick="closeAddOnForm()">Cancel</button>
        </div>
      </form>
    </div>`
}

window.handleAfImageUpload = async function(input) {
  const file = input.files[0]
  if (!file) return
  if (!appState.session) return showToast('Admin login required', 'error')

  const ext  = file.name.split('.').pop()
  const path = `addon-${Date.now()}.${ext}`
  const label = document.getElementById('af-img-label')
  label.textContent = 'Uploading…'

  try {
    const { error: upErr } = await supabase.storage.from('addon-images').upload(path, file, { upsert: true })
    if (upErr) throw upErr

    const { data: { publicUrl } } = supabase.storage.from('addon-images').getPublicUrl(path)
    document.getElementById('af-image-url').value = publicUrl

    const preview = document.getElementById('af-img-preview')
    preview.innerHTML = `<img src="${publicUrl}" alt="" class="vf-img-thumb" />`
    label.textContent = '↺ Replace photo'
    showToast('Photo uploaded', 'success')
  } catch (err) {
    console.error(err)
    showToast('Upload failed: ' + err.message, 'error')
    label.textContent = '↑ Upload photo'
  }
}

function openAddOnForm(id = null) {
  // Re-render list first to ensure form markup exists
  if (!document.getElementById('addon-form-wrap')) renderAddOnsList()

  const wrap = document.getElementById('addon-form-wrap')
  if (!wrap) return
  wrap.style.display = 'block'
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' })

  document.getElementById('addon-form-title').textContent = id ? 'Edit Add-on' : 'New Add-on'
  document.getElementById('af-id').value = id || ''

  // Reset
  document.getElementById('addon-form').reset()
  document.querySelectorAll('[name="available_for"]').forEach(cb => { cb.checked = true })

  if (id) {
    const a = addOnManagerState.addOns.find(x => x.id === id)
    if (!a) return
    addOnManagerState.editingId = id
    document.getElementById('af-name').value         = a.name
    document.getElementById('af-category').value     = a.category
    document.getElementById('af-price').value        = a.price
    document.getElementById('af-sort').value         = a.sort_order
    document.getElementById('af-description').value  = a.description || ''
    document.getElementById('af-confirm').value      = String(a.requires_confirmation)
    document.querySelectorAll('[name="available_for"]').forEach(cb => {
      cb.checked = (a.available_for || []).includes(cb.value)
    })
    // Image
    const imgUrl = a.image_url || ''
    document.getElementById('af-image-url').value = imgUrl
    const preview = document.getElementById('af-img-preview')
    const label   = document.getElementById('af-img-label')
    if (imgUrl) {
      preview.innerHTML = `<img src="${imgUrl}" alt="" class="vf-img-thumb" />`
      label.childNodes[0].textContent = '↺ Replace photo'
    } else {
      preview.innerHTML = ''
      label.childNodes[0].textContent = '↑ Upload photo'
    }
  } else {
    addOnManagerState.editingId = null
    document.getElementById('af-image-url').value = ''
    document.getElementById('af-img-preview').innerHTML = ''
    const label = document.getElementById('af-img-label')
    if (label) label.childNodes[0].textContent = '↑ Upload photo'
  }
}

function closeAddOnForm() {
  const wrap = document.getElementById('addon-form-wrap')
  if (wrap) wrap.style.display = 'none'
  addOnManagerState.editingId = null
}

async function saveAddOn(event) {
  event.preventDefault()
  if (!appState.session) return showToast('Admin login required', 'error')

  const id       = document.getElementById('af-id').value
  const available_for = Array.from(document.querySelectorAll('[name="available_for"]:checked')).map(cb => cb.value)

  if (!available_for.length) {
    showToast('Select at least one venue type', 'error')
    return
  }

  const payload = {
    name:                  document.getElementById('af-name').value.trim(),
    category:              document.getElementById('af-category').value,
    price:                 parseFloat(document.getElementById('af-price').value) || 0,
    sort_order:            parseInt(document.getElementById('af-sort').value, 10) || 0,
    description:           document.getElementById('af-description').value.trim() || null,
    requires_confirmation: document.getElementById('af-confirm').value === 'true',
    image_url:             document.getElementById('af-image-url').value.trim() || null,
    available_for,
  }

  try {
    let error
    if (id) {
      ;({ error } = await supabase.from('add_ons').update(payload).eq('id', parseInt(id, 10)))
    } else {
      ;({ error } = await supabase.from('add_ons').insert([payload]))
    }
    if (error) throw error
    showToast(id ? 'Add-on updated' : 'Add-on created', 'success')
    closeAddOnForm()
    loadAddOnsManager()
  } catch (err) {
    console.error(err)
    showToast('Failed to save add-on: ' + err.message, 'error')
  }
}

async function toggleAddOnActive(id, newState) {
  if (!appState.session) return showToast('Admin login required', 'error')
  try {
    const { error } = await supabase.from('add_ons').update({ is_active: newState }).eq('id', id)
    if (error) throw error
    showToast(newState ? 'Add-on activated' : 'Add-on deactivated', 'success')
    loadAddOnsManager()
  } catch (err) {
    console.error(err)
    showToast('Failed to update add-on', 'error')
  }
}

async function deleteAddOn(id) {
  if (!appState.session) return showToast('Admin login required', 'error')
  if (!confirm('Delete this add-on? Existing booking records will be preserved.')) return
  try {
    const { error } = await supabase.from('add_ons').delete().eq('id', id)
    if (error) throw error
    showToast('Add-on deleted', 'success')
    loadAddOnsManager()
  } catch (err) {
    console.error(err)
    showToast('Failed to delete add-on', 'error')
  }
}

window.openAddOnForm    = openAddOnForm
window.closeAddOnForm   = closeAddOnForm
window.saveAddOn        = saveAddOn
window.toggleAddOnActive = toggleAddOnActive
window.deleteAddOn      = deleteAddOn

// ================================================================
// VENUE MANAGER
// ================================================================

let venueManagerState = {
  venues: [],
  editingId: null
}

async function loadVenueManager() {
  if (!appState.session) return
  const container = document.getElementById('venues-list-container')
  if (!container) return
  container.innerHTML = '<p class="loading-text">Loading venues…</p>'
  try {
    const { data, error } = await supabase
      .from('venues')
      .select('id, name, type, setting, area, city, capacity_min, capacity_max, base_price, is_active, requires_confirmation, packages_enabled, free_guests_upto, overage_per_person, images, menu_pages, external_url, maps_url, metadata, description, max_concurrent_setups, airbnb_ical_url, last_ical_sync_at, last_ical_sync_status, sort_order, team_id')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
    if (error) throw error
    venueManagerState.venues = data || []
    renderVenueList()
  } catch (err) {
    console.error(err)
    container.innerHTML = '<p class="error-text">Failed to load venues.</p>'
  }
}

function renderVenueList() {
  const container = document.getElementById('venues-list-container')
  if (!container) return
  const venues = venueManagerState.venues
  if (!venues.length) {
    container.innerHTML = '<p class="empty-text">No venues yet. Click "+ Add Venue" to create one.</p>'
    return
  }

  const dragHandleSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
    <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
    <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
  </svg>`

  container.innerHTML = `
    <table class="admin-venue-table">
      <thead>
        <tr>
          <th class="venue-th-drag"></th>
          <th>Name</th>
          <th>Type</th>
          <th>Area</th>
          <th>Capacity</th>
          <th>Base Price</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="venue-sort-tbody">
        ${venues.map((v, i) => `
          <tr class="${v.is_active ? '' : 'venue-row-inactive'}" data-venue-id="${v.id}" data-index="${i}">
            <td class="venue-drag-cell"><div class="venue-drag-handle" title="Drag to reorder">${dragHandleSvg}</div></td>
            <td class="venue-row-name" data-label="Name">${escapeHtml(v.name)}</td>
            <td data-label="Type"><span class="admin-venue-badge ${venueTypeBadgeClass(v.type)}">${escapeHtml(formatVenueType(v.type))}</span></td>
            <td data-label="Area">${escapeHtml(v.area || '—')}</td>
            <td data-label="Capacity">${v.capacity_min}–${v.capacity_max}</td>
            <td data-label="Price">₹${Number(v.base_price).toLocaleString('en-IN')}</td>
            <td data-label="Status"><span class="venue-status-pill ${v.is_active ? 'venue-status-active' : 'venue-status-inactive'}">${v.is_active ? 'Active' : 'Inactive'}</span></td>
            <td class="venue-row-actions">
              <button class="vf-action-btn" onclick="openVenueForm(${v.id})">Edit</button>
              <button class="vf-action-btn vf-action-btn--${v.is_active ? 'deactivate' : 'activate'}" onclick="toggleVenueActive(${v.id}, ${!v.is_active})">${v.is_active ? 'Deactivate' : 'Activate'}</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `

  // Wire drag-to-reorder
  const tbody = document.getElementById('venue-sort-tbody')
  let dragIdx = null
  tbody.querySelectorAll('tr[data-index]').forEach(row => {
    row.draggable = true
    row.addEventListener('dragstart', e => {
      dragIdx = parseInt(row.dataset.index)
      e.dataTransfer.effectAllowed = 'move'
      setTimeout(() => row.classList.add('venue-row--dragging'), 0)
    })
    row.addEventListener('dragend', () => {
      dragIdx = null
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('venue-row--dragging', 'venue-row--drag-over'))
    })
    row.addEventListener('dragover', e => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('venue-row--drag-over'))
      if (parseInt(row.dataset.index) !== dragIdx) row.classList.add('venue-row--drag-over')
    })
    row.addEventListener('dragleave', () => row.classList.remove('venue-row--drag-over'))
    row.addEventListener('drop', async e => {
      e.preventDefault()
      const dropIdx = parseInt(row.dataset.index)
      if (dragIdx === null || dragIdx === dropIdx) return
      const vs = [...venueManagerState.venues]
      const [moved] = vs.splice(dragIdx, 1)
      vs.splice(dropIdx, 0, moved)
      venueManagerState.venues = vs
      renderVenueList()
      await saveVenueOrder(vs)
    })
  })
}

async function saveVenueOrder(venues) {
  try {
    await Promise.all(venues.map((v, idx) =>
      supabase.from('venues').update({ sort_order: idx + 1 }).eq('id', v.id)
    ))
  } catch (err) {
    console.error('Failed to save venue order', err)
    showToast('Could not save order — try again', 'error')
  }
}

async function openVenueForm(venueId) {
  const panel = document.getElementById('venue-form-panel')
  const title = document.getElementById('vfp-title')
  if (!panel) return

  // Load the add-on catalogue before rendering the checklist.
  await loadVfAddOns()

  // Populate team select from loaded teams BEFORE populateVenueForm/clearVenueForm
  // try to set its value below — rebuilding <option> innerHTML resets the
  // select to its first option, so this must run first or whatever value
  // gets set next is immediately wiped out (this was the cause of the team
  // field always reverting to the first team in the list on reopen).
  const teamSel = document.getElementById('vf-team')
  if (teamSel && appState.teams.length) {
    teamSel.innerHTML = appState.teams.map(t =>
      `<option value="${t.id}">${escapeHtml(t.name)}</option>`
    ).join('')
  }

  if (venueId) {
    const venue = venueManagerState.venues.find(v => v.id === venueId)
    if (!venue) return
    venueManagerState.editingId = venueId
    title.textContent = 'Edit Venue'
    populateVenueForm(venue)
    const selected = await loadVfAddonSelection(venueId)
    renderVfAddons(selected)
  } else {
    venueManagerState.editingId = null
    title.textContent = 'Add Venue'
    clearVenueForm()
  }

  panel.classList.remove('hidden')
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function closeVenueForm() {
  const panel = document.getElementById('venue-form-panel')
  if (panel) panel.classList.add('hidden')
  venueManagerState.editingId = null
}

function clearVenueForm() {
  document.getElementById('vf-id').value = ''
  document.getElementById('vf-name').value = ''
  document.getElementById('vf-type').value = 'cafe'
  document.getElementById('vf-setting').value = ''
  document.getElementById('vf-description').value = ''
  document.getElementById('vf-area').value = ''
  document.getElementById('vf-city').value = 'Jaipur'
  document.getElementById('vf-cap-min').value = 2
  document.getElementById('vf-cap-max').value = 10
  document.getElementById('vf-base-price').value = 0
  document.getElementById('vf-external-url').value = ''
  document.getElementById('vf-maps-url').value = ''
  document.getElementById('vf-max-setups').value = 1
  document.getElementById('vf-overage').value = 2000
  document.getElementById('vf-free-guests-upto').value = 6
  document.getElementById('vf-rooms').value = 2
  document.getElementById('vf-bathrooms').value = 2
  document.getElementById('vf-stay-price').value = 0
  document.getElementById('vf-includes').value = ''
  document.getElementById('vf-amenities').value = ''
  document.getElementById('vf-highlights').value = ''
  document.getElementById('vf-ideal-for').value = ''
  document.getElementById('vf-active').checked = true
  document.getElementById('vf-requires-confirmation').checked = false
  document.getElementById('vf-packages-enabled').checked = false
  document.getElementById('vf-food-offline').checked = false
  const teamSelClear = document.getElementById('vf-team')
  if (teamSelClear && appState.teams.length) teamSelClear.value = appState.teams[0].id
  renderVfImages([])
  renderVfMenuPages([])
  renderVfTiers([{ up_to: 2, price: 9900 }, { up_to: 4, price: 12900 }, { up_to: 6, price: 15900 }, { up_to: 8, price: 18900 }])
  updateVfTypeVisibility('cafe')
  renderVfAddons([])
}

function populateVenueForm(venue) {
  document.getElementById('vf-id').value = venue.id
  document.getElementById('vf-name').value = venue.name || ''
  document.getElementById('vf-type').value = venue.type || 'cafe'
  document.getElementById('vf-setting').value = venue.setting || ''
  document.getElementById('vf-description').value = venue.description || ''
  document.getElementById('vf-area').value = venue.area || ''
  document.getElementById('vf-city').value = venue.city || 'Jaipur'
  document.getElementById('vf-cap-min').value = venue.capacity_min || 2
  document.getElementById('vf-cap-max').value = venue.capacity_max || 10
  document.getElementById('vf-base-price').value = venue.base_price || 0
  document.getElementById('vf-external-url').value = venue.external_url || ''
  document.getElementById('vf-maps-url').value = venue.maps_url || ''
  document.getElementById('vf-max-setups').value = venue.max_concurrent_setups ?? 1
  document.getElementById('vf-active').checked = venue.is_active !== false
  document.getElementById('vf-requires-confirmation').checked = !!venue.requires_confirmation
  document.getElementById('vf-packages-enabled').checked = !!venue.packages_enabled
  document.getElementById('vf-food-offline').checked = !!venue.metadata?.food_offline

  const meta = venue.metadata || {}
  renderVfImages(Array.isArray(venue.images) ? venue.images : (venue.images ? JSON.parse(venue.images) : []))
  renderVfMenuPages(Array.isArray(venue.menu_pages) ? venue.menu_pages : (venue.menu_pages ? JSON.parse(venue.menu_pages) : []))
  renderVfTiers(meta.tiers || [])
  document.getElementById('vf-overage').value = venue.overage_per_person ?? meta.overage_per_person ?? 2000
  document.getElementById('vf-free-guests-upto').value = venue.free_guests_upto ?? 6

  // BnB fields
  document.getElementById('vf-rooms').value = meta.rooms || 2
  document.getElementById('vf-bathrooms').value = meta.bathrooms || 2
  document.getElementById('vf-stay-price').value = meta.stay_price_per_night || 0
  document.getElementById('vf-includes').value = (meta.includes || []).join(', ')
  document.getElementById('vf-amenities').value = (meta.amenities || []).join(', ')
  document.getElementById('vf-highlights').value = (meta.highlights || []).join(', ')
  document.getElementById('vf-ideal-for').value = (meta.ideal_for || []).join(', ')
  document.getElementById('vf-airbnb-ical-url').value = venue.airbnb_ical_url || ''
  const teamSelPop = document.getElementById('vf-team')
  if (teamSelPop && venue.team_id) teamSelPop.value = venue.team_id

  updateVfTypeVisibility(venue.type)
}

function updateVfTypeVisibility(type) {
  const partnerOnly = document.querySelectorAll('.vf-partner-only')
  const notPartnerOnly = document.querySelectorAll('.vf-not-partner-only')
  const cafeOnly = document.querySelectorAll('.vf-cafe-only')
  const bnbSection = document.getElementById('vf-bnb-section')
  const icalSection = document.getElementById('vf-ical-section')
  const icalComboHint = document.getElementById('vf-ical-combo-hint')
  partnerOnly.forEach(el => { el.style.display = type === 'partner_bnb' ? '' : 'none' })
  // partner_bnb (BnB stays) keeps the legacy stepped-tiers pricing model;
  // every other type uses the simpler free_guests_upto + overage model.
  notPartnerOnly.forEach(el => { el.style.display = type === 'partner_bnb' ? 'none' : '' })
  cafeOnly.forEach(el => { el.style.display = type === 'cafe' ? '' : 'none' })
  if (bnbSection) bnbSection.style.display = type === 'self_managed' ? '' : 'none'
  // iCal sync applies to self_managed (each floor has its own Airbnb listing)
  // AND combo (the whole-property listing is a separate listing on Airbnb).
  if (icalSection) icalSection.style.display = (type === 'self_managed' || type === 'combo') ? '' : 'none'
  if (icalComboHint) icalComboHint.style.display = type === 'combo' ? '' : 'none'
}

// ── Per-venue add-on mapping (venue_add_ons) ───────────────────────────
// Holds the active add-on catalogue for the venue form checklist.
let vfAllAddOns = []

// Fetch the active add-on catalogue (id, name, available_for) for the form.
async function loadVfAddOns() {
  try {
    const { data, error } = await supabase
      .from('add_ons')
      .select('id, name, available_for, sort_order')
      .eq('is_active', true)
      .order('sort_order')
    if (error) throw error
    vfAllAddOns = data || []
  } catch (err) {
    console.error('Failed to load add-on catalogue:', err)
    vfAllAddOns = []
  }
  return vfAllAddOns
}

// Render the checklist; selectedIds = add-on ids currently mapped to the venue.
function renderVfAddons(selectedIds) {
  const list = document.getElementById('vf-addons-list')
  if (!list) return
  const sel = new Set((selectedIds || []).map(Number))
  if (!vfAllAddOns.length) {
    list.innerHTML = '<p class="vf-hint">No active add-ons to map.</p>'
    return
  }
  list.innerHTML = vfAllAddOns.map(a => `
    <label class="vf-addon-check">
      <input type="checkbox" name="vf-addon" value="${a.id}" ${sel.has(a.id) ? 'checked' : ''} />
      ${escapeHtml(a.name)}
    </label>`).join('')
}

// Fetch the add-on ids currently mapped to a venue.
async function loadVfAddonSelection(venueId) {
  try {
    const { data, error } = await supabase
      .from('venue_add_ons')
      .select('addon_id')
      .eq('venue_id', venueId)
    if (error) throw error
    return (data || []).map(r => r.addon_id)
  } catch (err) {
    console.error('Failed to load venue add-on mapping:', err)
    return []
  }
}

// Check the add-ons whose available_for includes the selected venue type.
// This is the only place type-inheritance survives — as a seeding convenience.
function prefillVfAddons() {
  const type = document.getElementById('vf-type')?.value
  const ids = vfAllAddOns.filter(a => (a.available_for || []).includes(type)).map(a => a.id)
  renderVfAddons(ids)
}
window.prefillVfAddons = prefillVfAddons

// Persist the checklist to venue_add_ons (delete-all + insert checked set).
async function saveVenueAddOns(venueId) {
  const checked = Array.from(document.querySelectorAll('input[name="vf-addon"]:checked'))
    .map(cb => parseInt(cb.value, 10))
  const { error: delErr } = await supabase.from('venue_add_ons').delete().eq('venue_id', venueId)
  if (delErr) throw delErr
  if (checked.length) {
    const rows = checked.map(addon_id => ({ venue_id: venueId, addon_id }))
    const { error: insErr } = await supabase.from('venue_add_ons').insert(rows)
    if (insErr) throw insErr
  }
}

function renderVfImages(images) {
  const list = document.getElementById('vf-images-list')
  if (!list) return
  list.innerHTML = images.map((img, i) => {
    const filename = img.name || ''
    return `
    <div class="vf-image-row" data-index="${i}" draggable="true">
      <div class="vf-img-drag-handle" title="Drag to reorder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
        </svg>
      </div>
      <div class="vf-img-preview-wrap">
        ${img.url
          ? `<img class="vf-img-thumb" src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" />`
          : `<div class="vf-img-thumb-placeholder">🖼</div>`}
        ${filename ? `<span class="vf-img-filename" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>` : ''}
      </div>
      <div class="vf-img-fields">
        <label class="vf-img-upload-btn">
          ${img.url ? '↺ Replace photo' : '↑ Upload photo'}
          <input type="file" class="vf-img-file" accept="image/jpeg,image/png,image/webp"
                 onchange="handleVfImageUpload(this, ${i})" style="display:none" />
        </label>
        <input type="hidden" class="vf-img-url" value="${escapeHtml(img.url || '')}" />
        <input type="hidden" class="vf-img-name" value="${escapeHtml(filename)}" />
        <input type="text" class="vf-input vf-img-alt" placeholder="Alt text / caption" value="${escapeHtml(img.alt || '')}" />
      </div>
      <button type="button" class="vf-remove-btn" onclick="removeVfImage(${i})">✕</button>
    </div>
  `}).join('')

  // Wire drag-to-reorder
  let dragIndex = null
  list.querySelectorAll('.vf-image-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragIndex = parseInt(row.dataset.index)
      e.dataTransfer.effectAllowed = 'move'
      setTimeout(() => row.classList.add('vf-img-dragging'), 0)
    })
    row.addEventListener('dragend', () => {
      dragIndex = null
      list.querySelectorAll('.vf-image-row').forEach(r => {
        r.classList.remove('vf-img-dragging', 'vf-img-drag-over')
      })
    })
    row.addEventListener('dragover', e => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      list.querySelectorAll('.vf-image-row').forEach(r => r.classList.remove('vf-img-drag-over'))
      if (parseInt(row.dataset.index) !== dragIndex) row.classList.add('vf-img-drag-over')
    })
    row.addEventListener('dragleave', () => row.classList.remove('vf-img-drag-over'))
    row.addEventListener('drop', e => {
      e.preventDefault()
      const dropIndex = parseInt(row.dataset.index)
      if (dragIndex === null || dragIndex === dropIndex) return
      const imgs = readVfImages()
      const [moved] = imgs.splice(dragIndex, 1)
      imgs.splice(dropIndex, 0, moved)
      renderVfImages(imgs)
    })
  })
}

window.handleVfImageUpload = async function(input, index) {
  const file = input.files[0]
  if (!file) return
  if (!appState.session) return showToast('Admin login required', 'error')

  const ext  = file.name.split('.').pop()
  const path = `venue-${Date.now()}-${index}.${ext}`

  const row = input.closest('.vf-image-row')
  const label = row.querySelector('.vf-img-upload-btn')
  label.textContent = 'Uploading…'

  try {
    const { error: upErr } = await supabase.storage.from('venue-images').upload(path, file, { upsert: true })
    if (upErr) throw upErr

    const { data: { publicUrl } } = supabase.storage.from('venue-images').getPublicUrl(path)

    row.querySelector('.vf-img-url').value = publicUrl
    row.querySelector('.vf-img-name').value = file.name
    const wrap = row.querySelector('.vf-img-preview-wrap')
    wrap.innerHTML = `<img class="vf-img-thumb" src="${publicUrl}" alt="" /><span class="vf-img-filename" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>`
    label.textContent = '↺ Replace photo'
    showToast('Photo uploaded', 'success')
  } catch (err) {
    console.error(err)
    showToast('Upload failed: ' + err.message, 'error')
    label.textContent = '↑ Upload photo'
  }
}

function addVfImage() {
  const imgs = readVfImages()
  imgs.push({ url: '', alt: '' })
  renderVfImages(imgs)
}

function removeVfImage(index) {
  const imgs = readVfImages()
  imgs.splice(index, 1)
  renderVfImages(imgs)
}

function readVfImages() {
  const rows = document.querySelectorAll('#vf-images-list .vf-image-row')
  return Array.from(rows).map(row => ({
    url: row.querySelector('.vf-img-url').value.trim(),
    alt: row.querySelector('.vf-img-alt').value.trim(),
    name: row.querySelector('.vf-img-name')?.value.trim() || ''
  }))
}

// ── Menu pages (mirrors the venue-images editor; reuses .vf-image-* styles
// and the public `venue-images` storage bucket with a `menu-` path prefix) ──
function renderVfMenuPages(pages) {
  const list = document.getElementById('vf-menu-list')
  if (!list) return
  list.innerHTML = pages.map((img, i) => {
    const filename = img.name || ''
    return `
    <div class="vf-image-row" data-index="${i}" draggable="true">
      <div class="vf-img-drag-handle" title="Drag to reorder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
        </svg>
      </div>
      <div class="vf-img-preview-wrap">
        ${img.url
          ? `<img class="vf-img-thumb" src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" />`
          : `<div class="vf-img-thumb-placeholder">📄</div>`}
        ${filename ? `<span class="vf-img-filename" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>` : ''}
      </div>
      <div class="vf-img-fields">
        <label class="vf-img-upload-btn">
          ${img.url ? '↺ Replace page' : '↑ Upload page'}
          <input type="file" class="vf-img-file" accept="image/jpeg,image/png,image/webp"
                 onchange="handleVfMenuUpload(this, ${i})" style="display:none" />
        </label>
        <input type="hidden" class="vf-img-url" value="${escapeHtml(img.url || '')}" />
        <input type="hidden" class="vf-img-name" value="${escapeHtml(filename)}" />
        <input type="text" class="vf-input vf-img-alt" placeholder="Alt text (e.g. Menu page 1)" value="${escapeHtml(img.alt || '')}" />
      </div>
      <button type="button" class="vf-remove-btn" onclick="removeVfMenuPage(${i})">✕</button>
    </div>
  `}).join('')

  // Wire drag-to-reorder
  let dragIndex = null
  list.querySelectorAll('.vf-image-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragIndex = parseInt(row.dataset.index)
      e.dataTransfer.effectAllowed = 'move'
      setTimeout(() => row.classList.add('vf-img-dragging'), 0)
    })
    row.addEventListener('dragend', () => {
      dragIndex = null
      list.querySelectorAll('.vf-image-row').forEach(r => {
        r.classList.remove('vf-img-dragging', 'vf-img-drag-over')
      })
    })
    row.addEventListener('dragover', e => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      list.querySelectorAll('.vf-image-row').forEach(r => r.classList.remove('vf-img-drag-over'))
      if (parseInt(row.dataset.index) !== dragIndex) row.classList.add('vf-img-drag-over')
    })
    row.addEventListener('dragleave', () => row.classList.remove('vf-img-drag-over'))
    row.addEventListener('drop', e => {
      e.preventDefault()
      const dropIndex = parseInt(row.dataset.index)
      if (dragIndex === null || dragIndex === dropIndex) return
      const pgs = readVfMenuPages()
      const [moved] = pgs.splice(dragIndex, 1)
      pgs.splice(dropIndex, 0, moved)
      renderVfMenuPages(pgs)
    })
  })
}

window.handleVfMenuUpload = async function(input, index) {
  const file = input.files[0]
  if (!file) return
  if (!appState.session) return showToast('Admin login required', 'error')

  const ext  = file.name.split('.').pop()
  const path = `menu-${Date.now()}-${index}.${ext}`

  const row = input.closest('.vf-image-row')
  const label = row.querySelector('.vf-img-upload-btn')
  label.textContent = 'Uploading…'

  try {
    const { error: upErr } = await supabase.storage.from('venue-images').upload(path, file, { upsert: true })
    if (upErr) throw upErr

    const { data: { publicUrl } } = supabase.storage.from('venue-images').getPublicUrl(path)

    row.querySelector('.vf-img-url').value = publicUrl
    row.querySelector('.vf-img-name').value = file.name
    const wrap = row.querySelector('.vf-img-preview-wrap')
    wrap.innerHTML = `<img class="vf-img-thumb" src="${publicUrl}" alt="" /><span class="vf-img-filename" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>`
    label.textContent = '↺ Replace page'
    showToast('Menu page uploaded', 'success')
  } catch (err) {
    console.error(err)
    showToast('Upload failed: ' + err.message, 'error')
    label.textContent = '↑ Upload page'
  }
}

function addVfMenuPage() {
  const pgs = readVfMenuPages()
  pgs.push({ url: '', alt: '' })
  renderVfMenuPages(pgs)
}

function removeVfMenuPage(index) {
  const pgs = readVfMenuPages()
  pgs.splice(index, 1)
  renderVfMenuPages(pgs)
}

function readVfMenuPages() {
  const rows = document.querySelectorAll('#vf-menu-list .vf-image-row')
  return Array.from(rows).map(row => ({
    url: row.querySelector('.vf-img-url').value.trim(),
    alt: row.querySelector('.vf-img-alt').value.trim(),
    name: row.querySelector('.vf-img-name')?.value.trim() || ''
  }))
}

// Multi-file upload handler shared by venue images and menu pages.
// type = 'venue' | 'menu'
window.addVfImagesMulti = async function(input, type) {
  const files = Array.from(input.files)
  input.value = '' // reset so same files can be re-selected later
  if (!files.length) return
  if (!appState.session) return showToast('Admin login required', 'error')

  const isVenue  = type === 'venue'
  const listId   = isVenue ? 'vf-images-list' : 'vf-menu-list'
  const prefix   = isVenue ? 'venue' : 'menu'
  const readFn   = isVenue ? readVfImages   : readVfMenuPages
  const renderFn = isVenue ? renderVfImages : renderVfMenuPages
  const placeholder = isVenue ? '🖼' : '📄'

  // Add placeholder rows for every file up-front, then upload in parallel
  const existing   = readFn()
  const startIndex = existing.length
  const newEntries = files.map(f => ({ url: '', alt: '', name: f.name }))
  renderFn([...existing, ...newEntries])

  const list = document.getElementById(listId)

  await Promise.all(files.map(async (file, i) => {
    const rowIndex = startIndex + i
    const row   = list.querySelector(`.vf-image-row[data-index="${rowIndex}"]`)
    const label = row?.querySelector('.vf-img-upload-btn')
    if (label) label.textContent = 'Uploading…'

    try {
      const ext  = file.name.split('.').pop()
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${prefix}-${Date.now()}-${i}-${safe}`

      const { error: upErr } = await supabase.storage.from('venue-images').upload(path, file, { upsert: true })
      if (upErr) throw upErr

      const { data: { publicUrl } } = supabase.storage.from('venue-images').getPublicUrl(path)

      if (row) {
        row.querySelector('.vf-img-url').value  = publicUrl
        row.querySelector('.vf-img-name').value = file.name
        row.querySelector('.vf-img-preview-wrap').innerHTML =
          `<img class="vf-img-thumb" src="${publicUrl}" alt="" /><span class="vf-img-filename" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>`
        if (label) label.textContent = isVenue ? '↺ Replace photo' : '↺ Replace page'
      }
    } catch (err) {
      console.error(err)
      showToast(`Failed: ${file.name} — ${err.message}`, 'error')
      if (label) label.textContent = isVenue ? '↑ Upload photo' : '↑ Upload page'
    }
  }))
}

function renderVfTiers(tiers) {
  const list = document.getElementById('vf-tiers-list')
  if (!list) return
  list.innerHTML = tiers.map((tier, i) => `
    <div class="vf-tier-row" data-index="${i}">
      <span class="vf-tier-label">Up to</span>
      <input type="number" class="vf-input vf-tier-upto" min="1" value="${tier.up_to}" placeholder="Guests" />
      <span class="vf-tier-label">guests → ₹</span>
      <input type="number" class="vf-input vf-tier-price" min="0" step="100" value="${tier.price}" placeholder="Price" />
      <button type="button" class="vf-remove-btn" onclick="removeVfTier(${i})">✕</button>
    </div>
  `).join('')
}

function addVfTier() {
  const tiers = readVfTiers()
  tiers.push({ up_to: (tiers.length + 1) * 2, price: 0 })
  renderVfTiers(tiers)
}

function removeVfTier(index) {
  const tiers = readVfTiers()
  tiers.splice(index, 1)
  renderVfTiers(tiers)
}

function readVfTiers() {
  const rows = document.querySelectorAll('#vf-tiers-list .vf-tier-row')
  return Array.from(rows).map(row => ({
    up_to: parseInt(row.querySelector('.vf-tier-upto').value, 10) || 0,
    price: parseInt(row.querySelector('.vf-tier-price').value, 10) || 0
  }))
}

async function handleVenueFormSubmit(event) {
  event.preventDefault()
  if (!appState.session) return showToast('Admin login required', 'error')
  const id = document.getElementById('vf-id').value
  const type = document.getElementById('vf-type').value
  const isPartnerTiered = type === 'partner_bnb'

  const images = readVfImages().filter(img => img.url)
  const menuPages = readVfMenuPages().filter(p => p.url)
  const overage = parseInt(document.getElementById('vf-overage').value, 10) || 2000

  const splitCsv = id => document.getElementById(id).value.split(',').map(s => s.trim()).filter(Boolean)
  // Preserve metadata keys the form doesn't manage (e.g. food_multiplier, drink_multiplier,
  // food_offline) by merging into the existing venue's metadata instead of replacing it.
  const originalMeta = (id ? venueManagerState.venues.find(v => v.id === parseInt(id, 10))?.metadata : null) || {}

  // Pricing model: partner_bnb (BnB stays) keeps the legacy stepped-tiers
  // array (genuine multi-step guest pricing) — read live from the form.
  // Every other type uses the simpler flat + overage model; leave the
  // legacy `tiers` field in metadata untouched (dead but harmless — kept as
  // a rollback source, see migration add_pricing_columns_and_packages_tables)
  // rather than overwriting it with stale hidden-form-row data.
  const tiers = isPartnerTiered
    ? readVfTiers().sort((a, b) => a.up_to - b.up_to) // ascending order for getVenuePrice() legacy path
    : (originalMeta.tiers || [])
  const freeGuestsUpto = isPartnerTiered
    ? null
    : (parseInt(document.getElementById('vf-free-guests-upto').value, 10) || null)

  // food_offline: whether food is arranged offline/self-sourced (true) vs.
  // included in the online price (false/absent). Editable via the venue form
  // now — previously only settable by direct SQL, invisible in admin.
  const foodOffline = document.getElementById('vf-food-offline').checked
  let metadata = { ...originalMeta, tiers, overage_per_person: overage, food_offline: foodOffline, includes: splitCsv('vf-includes') }

  if (type === 'self_managed') {
    metadata = {
      ...metadata,
      rooms: parseInt(document.getElementById('vf-rooms').value, 10) || 2,
      bathrooms: parseInt(document.getElementById('vf-bathrooms').value, 10) || 2,
      stay_price_per_night: parseInt(document.getElementById('vf-stay-price').value, 10) || 0,
      amenities: splitCsv('vf-amenities'),
      highlights: splitCsv('vf-highlights'),
      ideal_for: splitCsv('vf-ideal-for')
    }
  }

  const payload = {
    name: document.getElementById('vf-name').value.trim(),
    type,
    setting: document.getElementById('vf-setting').value || null,
    description: document.getElementById('vf-description').value.trim(),
    area: document.getElementById('vf-area').value.trim(),
    city: document.getElementById('vf-city').value.trim(),
    capacity_min: parseInt(document.getElementById('vf-cap-min').value, 10),
    capacity_max: parseInt(document.getElementById('vf-cap-max').value, 10),
    base_price: parseFloat(document.getElementById('vf-base-price').value) || 0,
    free_guests_upto: freeGuestsUpto,
    overage_per_person: overage,
    external_url: document.getElementById('vf-external-url').value.trim() || null,
    maps_url: document.getElementById('vf-maps-url').value.trim() || null,
    airbnb_ical_url: document.getElementById('vf-airbnb-ical-url').value.trim() || null,
    is_active: document.getElementById('vf-active').checked,
    requires_confirmation: document.getElementById('vf-requires-confirmation').checked,
    packages_enabled: document.getElementById('vf-packages-enabled').checked,
    max_concurrent_setups: parseInt(document.getElementById('vf-max-setups').value, 10) || 1,
    team_id: parseInt(document.getElementById('vf-team')?.value, 10) || null,
    images: images,
    menu_pages: menuPages,
    metadata
  }

  try {
    let error
    let savedVenueId = id ? parseInt(id, 10) : null
    if (id) {
      ;({ error } = await supabase.from('venues').update(payload).eq('id', parseInt(id, 10)))
    } else {
      const res = await supabase.from('venues').insert([payload]).select('id').single()
      error = res.error
      savedVenueId = res.data?.id ?? null
    }
    if (error) throw error
    // Persist the per-venue add-on mapping (venue_add_ons).
    if (savedVenueId) await saveVenueAddOns(savedVenueId)
    showToast(id ? 'Venue updated!' : 'Venue added!', 'success')
    closeVenueForm()
    loadVenueManager()
  } catch (err) {
    console.error(err)
    showToast('Failed to save venue: ' + err.message, 'error')
  }
}

async function toggleVenueActive(venueId, newState) {
  if (!appState.session) return showToast('Admin login required', 'error')
  try {
    const { error } = await supabase.from('venues').update({ is_active: newState }).eq('id', venueId)
    if (error) throw error
    showToast(newState ? 'Venue activated' : 'Venue deactivated', 'success')
    loadVenueManager()
  } catch (err) {
    console.error(err)
    showToast('Failed to update venue', 'error')
  }
}

// ================================================================
// AVAILABILITY CALENDAR
// ================================================================

let availState = {
  venueId: null,
  venueType: null,                    // 'cafe' | 'self_managed' | 'partner_bnb' | 'custom'
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  adminBlockedDates: new Set(),       // full-day admin blocks (time_slot IS NULL)
  icalBlockedDates: new Set(),        // full-day Airbnb-imported blocks (source='ical'), read-only
  adminBlockedSlots: new Map(),       // Map<date, Set<slot_key>> — café slot-specific blocks
  bookingCountMap: new Map(),         // Map<date, count> — confirmed booking occupancy
  maxConcurrentSetups: 1,
  selectedDate: null,                 // date currently shown in the overview panel
}

let _availListenersAdded = false

async function initAvailabilityTab() {
  // Ensure venues are loaded before populating the select.
  if (!venueManagerState.venues.length) {
    try {
      const { data, error } = await supabase
        .from('venues')
        .select('id, name, type, is_active')
        .order('id')
      if (!error) venueManagerState.venues = data || []
    } catch (e) { console.error(e) }
  }
  populateAvailVenueSelect()
  renderAvailMonthLabel()

  // Wire controls once — guard prevents duplicate listeners on repeated tab visits
  if (_availListenersAdded) return
  _availListenersAdded = true

  // Venue select → load calendar for chosen venue
  document.getElementById('avail-venue-select')?.addEventListener('change', (e) => {
    availState.venueId = e.target.value ? parseInt(e.target.value, 10) : null
    loadAvailCalendar()
  })

  // Month navigation
  document.getElementById('avail-prev-month')?.addEventListener('click', () => {
    availState.month--
    if (availState.month < 0) { availState.month = 11; availState.year-- }
    renderAvailMonthLabel()
    loadAvailCalendar()
  })

  document.getElementById('avail-next-month')?.addEventListener('click', () => {
    availState.month++
    if (availState.month > 11) { availState.month = 0; availState.year++ }
    renderAvailMonthLabel()
    loadAvailCalendar()
  })

  // Grid: single persistent delegated listener for date clicks.
  // Added here (once) rather than inside renderAvailCalendarGrid because the
  // #avail-calendar-grid element itself is never replaced — only its innerHTML is.
  // A listener on the element survives innerHTML replacements, so { once: true }
  // inside renderAvailCalendarGrid was the root cause of listener accumulation.
  document.getElementById('avail-calendar-grid')?.addEventListener('click', (e) => {
    const day = e.target.closest('[data-action="detail"]')
    if (!day) return
    const dateStr = day.dataset.date
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return
    availState.selectedDate = dateStr
    document.querySelectorAll('#avail-calendar-grid .avail-day--selected')
      .forEach(el => el.classList.remove('avail-day--selected'))
    day.classList.add('avail-day--selected')
    renderAvailDateDetail(dateStr)
  })
}

function populateAvailVenueSelect() {
  const sel = document.getElementById('avail-venue-select')
  if (!sel) return
  const currentVal = sel.value
  sel.innerHTML = '<option value="">Select a venue…</option>'
  venueManagerState.venues.forEach(v => {
    const opt = document.createElement('option')
    opt.value = v.id
    opt.textContent = `${v.name}${v.is_active ? '' : ' (inactive)'}`
    sel.appendChild(opt)
  })
  if (currentVal) sel.value = currentVal
}

function renderAvailMonthLabel() {
  const label = document.getElementById('avail-month-label')
  if (!label) return
  const d = new Date(availState.year, availState.month, 1)
  label.textContent = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

async function loadAvailCalendar() {
  const venueId = availState.venueId
  if (!venueId) return

  const { year, month } = availState
  const firstDay = localDateStr(new Date(year, month, 1))
  const lastDay  = localDateStr(new Date(year, month + 1, 0))

  try {
    // Admin-blocked dates (source='admin') for this month
    // + all confirmed bookings for this venue (to compute per-date occupancy)
    const [adminFullDayResult, adminSlotResult, icalResult, bookingsResult, venueResult] = await Promise.all([
      // Full-day admin blocks for this month
      supabase.from('venue_availability')
        .select('date')
        .eq('venue_id', venueId).eq('source', 'admin').is('time_slot', null)
        .gte('date', firstDay).lte('date', lastDay),
      // Slot-specific admin blocks for this month (café only, harmless for others)
      supabase.from('venue_availability')
        .select('date, time_slot')
        .eq('venue_id', venueId).eq('source', 'admin').not('time_slot', 'is', null)
        .gte('date', firstDay).lte('date', lastDay),
      // Full-day Airbnb-imported blocks for this month (source='ical', read-only)
      supabase.from('venue_availability')
        .select('date')
        .eq('venue_id', venueId).eq('source', 'ical').is('time_slot', null)
        .gte('date', firstDay).lte('date', lastDay),
      // All confirmed bookings for this venue (for occupancy count)
      supabase.from('bookings')
        .select('preferred_date, checkout_date')
        .eq('venue_id', venueId).eq('confirmed', true),
      // Venue metadata (incl. iCal sync fields for the sync panel)
      supabase.from('venues')
        .select('max_concurrent_setups, type, airbnb_ical_url, last_ical_sync_at, last_ical_sync_status')
        .eq('id', venueId).single(),
    ])
    if (adminFullDayResult.error) throw adminFullDayResult.error

    availState.venueType           = venueResult.data?.type || null
    availState.maxConcurrentSetups = venueResult.data?.max_concurrent_setups || 1
    availState.adminBlockedDates   = new Set((adminFullDayResult.data || []).map(r => r.date))
    availState.icalBlockedDates    = new Set((icalResult.data || []).map(r => r.date))
    availState.selectedDate        = null

    renderAvailIcalPanel(venueResult.data || {})

    // Build slot-block map
    const slotBlocks = new Map()
    for (const r of adminSlotResult.data || []) {
      if (!slotBlocks.has(r.date)) slotBlocks.set(r.date, new Set())
      slotBlocks.get(r.date).add(r.time_slot)
    }
    availState.adminBlockedSlots = slotBlocks

    // Expand confirmed stays into per-night counts (current month only)
    const countMap = new Map()
    for (const b of bookingsResult.data || []) {
      const s = new Date(b.preferred_date + 'T00:00:00')
      const e = b.checkout_date ? new Date(b.checkout_date + 'T00:00:00') : new Date(s.getTime() + 86400000)
      for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
        const ds = localDateStr(d)
        if (ds >= firstDay && ds <= lastDay) countMap.set(ds, (countMap.get(ds) || 0) + 1)
      }
    }
    availState.bookingCountMap = countMap

    renderAvailCalendarGrid()
    renderAvailDateDetail(null) // clear any open panel
  } catch (err) {
    console.error(err)
    showToast('Failed to load availability data', 'error')
  }
}

function renderAvailCalendarGrid() {
  const grid = document.getElementById('avail-calendar-grid')
  if (!grid) return

  const { year, month, adminBlockedDates, icalBlockedDates, bookingCountMap, maxConcurrentSetups } = availState
  const maxSetups   = maxConcurrentSetups || 1
  const today       = new Date(); today.setHours(0, 0, 0, 0)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDOW    = new Date(year, month, 1).getDay()

  // Count stats for the summary row
  let countFullyBooked = 0, countPartial = 0, countBlocked = 0, countAvailable = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (new Date(year, month, d) < today) continue
    if (adminBlockedDates.has(dateStr) || icalBlockedDates.has(dateStr)) { countBlocked++ }
    else {
      const cnt = bookingCountMap.get(dateStr) || 0
      if (cnt >= maxSetups)   countFullyBooked++
      else if (cnt > 0)       countPartial++
      else                    countAvailable++
    }
  }

  const statsRow = document.getElementById('avail-stats-row')
  if (statsRow) {
    statsRow.hidden = false
    statsRow.innerHTML = `
      <div class="avail-stat avail-stat--booked">
        <span class="avail-stat-num">${countFullyBooked}</span>
        <span class="avail-stat-label">Fully Booked</span>
      </div>
      ${maxSetups > 1 ? `
      <div class="avail-stat avail-stat--partial">
        <span class="avail-stat-num">${countPartial}</span>
        <span class="avail-stat-label">Partial</span>
      </div>` : ''}
      <div class="avail-stat avail-stat--blocked">
        <span class="avail-stat-num">${countBlocked}</span>
        <span class="avail-stat-label">Blocked</span>
      </div>
      <div class="avail-stat avail-stat--available">
        <span class="avail-stat-num">${countAvailable}</span>
        <span class="avail-stat-label">Available</span>
      </div>`
  }

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  let html = `<div class="avail-grid-inner">
    ${DOW.map(d => `<div class="avail-day-header">${d}</div>`).join('')}`

  for (let i = 0; i < firstDOW; i++) html += `<div class="avail-day avail-day--empty"></div>`

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr        = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isPast         = new Date(year, month, d) < today
    const isAdminBlocked = adminBlockedDates.has(dateStr)
    const isIcalBlocked  = icalBlockedDates.has(dateStr)
    const bookCount      = bookingCountMap.get(dateStr) || 0
    const isFullBooked   = !isAdminBlocked && !isIcalBlocked && bookCount >= maxSetups
    const isPartial      = !isAdminBlocked && !isIcalBlocked && bookCount > 0 && bookCount < maxSetups
    const isToday        = new Date(year, month, d).toDateString() === today.toDateString()
    const isSelected     = availState.selectedDate === dateStr

    let cls = 'avail-day'
    let badge = ''

    if (isPast) {
      cls += ' avail-day--past'
    } else if (isAdminBlocked) {
      cls += ' avail-day--blocked'
      badge = '<span class="avail-day-badge">Blocked</span>'
    } else if (isIcalBlocked) {
      cls += ' avail-day--blocked avail-day--ical'
      badge = '<span class="avail-day-badge">Airbnb</span>'
    } else if (isFullBooked) {
      cls += ' avail-day--booked'
      badge = `<span class="avail-day-badge">${maxSetups > 1 ? `${bookCount}/${maxSetups}` : 'Full'}</span>`
    } else if (isPartial) {
      cls += ' avail-day--partial'
      badge = `<span class="avail-day-badge">${bookCount}/${maxSetups}</span>`
    } else {
      cls += ' avail-day--available'
    }
    if (isToday)    cls += ' avail-day--today'
    if (isSelected) cls += ' avail-day--selected'

    // All non-past days open the detail panel — no immediate block on click
    if (!isPast) {
      html += `<button class="${cls}" data-action="detail" data-date="${dateStr}" aria-label="View ${dateStr}">${d}${badge}</button>`
    } else {
      html += `<div class="${cls}">${d}</div>`
    }
  }

  html += `</div>`
  grid.innerHTML = html
  // No listener added here — the single persistent listener lives in initAvailabilityTab.
}

// Render the Airbnb iCal sync panel (self_managed + combo venues): a copyable
// export URL to paste into Airbnb, last-sync status, and a manual "Sync now".
// Combo venues (e.g. a whole-cottage listing distinct from each child floor's
// own listing) sync their own feed here too — see sync-ical, which propagates
// combo-imported dates onto the child floors as well.
function renderAvailIcalPanel(venue) {
  const panel = document.getElementById('avail-ical-panel')
  if (!panel) return
  if (!venue || (venue.type !== 'self_managed' && venue.type !== 'combo')) { panel.hidden = true; panel.innerHTML = ''; return }

  const venueId   = availState.venueId
  const exportUrl = `${SUPABASE_URL}/functions/v1/export-ical?venue_id=${venueId}`
  const importing = !!venue.airbnb_ical_url
  const lastAt    = venue.last_ical_sync_at
    ? new Date(venue.last_ical_sync_at).toLocaleString('en-IN')
    : 'never'
  const status    = venue.last_ical_sync_status || '—'

  panel.hidden = false
  panel.innerHTML = `
    <div class="avail-ical-card">
      <div class="avail-ical-title">Airbnb calendar sync</div>
      <label class="avail-ical-label">Export URL — paste into Airbnb → Availability → Import calendar so Airbnb blocks dates this site has booked:</label>
      <div class="avail-ical-url-row">
        <input type="text" id="avail-ical-export-url" class="avail-ical-url" readonly value="${escapeHtml(exportUrl)}" />
        <button type="button" class="btn btn--small" id="avail-ical-copy">Copy</button>
      </div>
      <div class="avail-ical-status">
        <span>Import from Airbnb: <strong>${importing ? 'on' : 'off — set the Airbnb iCal URL in the venue editor'}</strong></span>
        ${importing ? `<span>Last sync: <strong>${escapeHtml(lastAt)}</strong> · ${escapeHtml(status)}</span>` : ''}
      </div>
      ${importing ? `<button type="button" class="btn btn--small btn--primary" id="avail-ical-sync-now">Sync now</button>` : ''}
    </div>`

  document.getElementById('avail-ical-copy')?.addEventListener('click', () => {
    const inp = document.getElementById('avail-ical-export-url')
    inp.select()
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(inp.value).then(
        () => showToast('Export URL copied', 'success'),
        () => showToast('Copy failed — select and copy manually', 'error')
      )
    } else {
      try { document.execCommand('copy'); showToast('Export URL copied', 'success') }
      catch { showToast('Select and copy manually', 'error') }
    }
  })
  document.getElementById('avail-ical-sync-now')?.addEventListener('click', () => syncIcalNow(venueId))
}

// Manually trigger Airbnb -> site import for one venue. The admin is signed in,
// so their JWT satisfies the function's verify_jwt; the function itself does the
// privileged work with the service-role key.
async function syncIcalNow(venueId) {
  if (!appState.session) return showToast('Admin login required', 'error')
  const btn = document.getElementById('avail-ical-sync-now')
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…' }
  try {
    const { data, error } = await supabase.functions.invoke('sync-ical', { body: { venue_id: venueId } })
    if (error) throw error
    const r = (data?.results || [])[0]
    if (r && r.ok === false) throw new Error(r.error || 'sync failed')
    showToast(`Synced from Airbnb${r ? ` — ${r.dates} date(s)` : ''}`, 'success')
    loadAvailCalendar()
  } catch (err) {
    console.error('syncIcalNow error:', err)
    showToast('Sync failed: ' + (err.message || err), 'error')
    if (btn) { btn.disabled = false; btn.textContent = 'Sync now' }
  }
}

// Render the date overview panel below the calendar grid.
// dateStr = null → clear the panel.
function renderAvailDateDetail(dateStr) {
  let panel = document.getElementById('avail-date-detail')
  if (!panel) return
  if (!dateStr) { panel.innerHTML = ''; return }

  const { venueType, adminBlockedDates, icalBlockedDates, adminBlockedSlots, bookingCountMap, maxConcurrentSetups } = availState
  const maxSetups      = maxConcurrentSetups || 1
  const isFullDayBlock = adminBlockedDates.has(dateStr)
  const isIcalBlocked  = (icalBlockedDates || new Set()).has(dateStr)
  const bookCount      = bookingCountMap.get(dateStr) || 0
  const formatted      = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  let bodyHtml = ''

  if (venueType === 'cafe') {
    // Per-slot overview
    const slotBlocks = adminBlockedSlots.get(dateStr) || new Set()
    const slotRows = CAFE_SLOTS.map(slot => {
      const slotCount    = availState.adminBlockedSlots.get(dateStr)?.has(slot.key)
        ? maxSetups  // admin-blocked → treat as full
        : 0          // will be overridden by booking count below if needed
      // Get actual booking count for this slot from slotMap in availState
      // We don't store the customer slotMap in availState — derive status from labels
      const isAdminSlotBlocked = slotBlocks.has(slot.key)
      const action = isAdminSlotBlocked ? 'unblock-slot' : 'block-slot'
      const btnLabel = isAdminSlotBlocked ? 'Unblock' : 'Block'
      const btnCls   = isAdminSlotBlocked
        ? 'avail-detail-btn avail-detail-btn--unblock'
        : 'avail-detail-btn avail-detail-btn--block'

      return `
        <div class="avail-detail-slot ${isAdminSlotBlocked ? 'avail-detail-slot--blocked' : ''}">
          <div class="avail-detail-slot-info">
            <span class="avail-detail-slot-icon">${slot.icon}</span>
            <div>
              <span class="avail-detail-slot-name">${slot.label}</span>
              <span class="avail-detail-slot-time">${slot.time}</span>
            </div>
          </div>
          <div class="avail-detail-slot-status">
            ${isAdminSlotBlocked
              ? `<span class="avail-detail-tag avail-detail-tag--blocked">Admin blocked</span>`
              : `<span class="avail-detail-tag avail-detail-tag--open">Open</span>`}
            <button class="${btnCls}"
                    data-action="${action}"
                    data-date="${dateStr}"
                    data-slot="${slot.key}">
              ${btnLabel}
            </button>
          </div>
        </div>`
    }).join('')

    const fullDayBtnLabel = isFullDayBlock ? 'Unblock whole day' : 'Block whole day'
    const fullDayAction   = isFullDayBlock ? 'unblock' : 'block'

    bodyHtml = `
      <div class="avail-detail-slots">${slotRows}</div>
      <div class="avail-detail-fullday">
        <button class="avail-detail-btn avail-detail-btn--fullday"
                data-action="${fullDayAction}" data-date="${dateStr}">
          ${fullDayBtnLabel}
        </button>
      </div>`
  } else {
    // BnB / self_managed — full-day block only
    const isFullBooked = bookCount >= maxSetups
    const btnLabel = isFullDayBlock ? 'Unblock this date' : 'Block this date'
    const btnAction = isFullDayBlock ? 'unblock' : 'block'

    if (isIcalBlocked && !isFullDayBlock) {
      // Imported from Airbnb — sync owns this row, so it's read-only here.
      // A manual unblock would just be re-added on the next sync.
      bodyHtml = `
        <div class="avail-detail-bnb">
          <div class="avail-detail-bnb-status">
            <span class="avail-detail-tag avail-detail-tag--blocked">Blocked — synced from Airbnb</span>
          </div>
          <p class="avail-detail-note">This date is held by an Airbnb reservation imported from this venue's calendar. It clears automatically when the Airbnb stay ends — manage it in Airbnb, not here.</p>
        </div>`
    } else {
      bodyHtml = `
        <div class="avail-detail-bnb">
          <div class="avail-detail-bnb-status">
            ${isFullDayBlock
              ? `<span class="avail-detail-tag avail-detail-tag--blocked">Admin blocked</span>`
              : isFullBooked
                ? `<span class="avail-detail-tag avail-detail-tag--booked">${bookCount}/${maxSetups} setups confirmed</span>`
                : bookCount > 0
                  ? `<span class="avail-detail-tag avail-detail-tag--partial">${bookCount}/${maxSetups} setups booked</span>`
                  : `<span class="avail-detail-tag avail-detail-tag--open">Available</span>`}
          </div>
          <button class="avail-detail-btn ${isFullDayBlock ? 'avail-detail-btn--unblock' : 'avail-detail-btn--block'}"
                  data-action="${btnAction}" data-date="${dateStr}">
            ${btnLabel}
          </button>
        </div>`
    }
  }

  panel.innerHTML = `
    <div class="avail-detail-panel">
      <div class="avail-detail-header">
        <span class="avail-detail-date">${formatted}</span>
        <button class="avail-detail-close" data-action="close-detail" aria-label="Close">✕</button>
      </div>
      ${bodyHtml}
    </div>`

  // onclick replaces the previous handler — no listener accumulation across re-renders
  panel.onclick = async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const date   = btn.dataset.date
    const slot   = btn.dataset.slot

    if (action === 'close-detail') {
      availState.selectedDate = null
      panel.innerHTML = ''
      panel.onclick = null
      document.querySelectorAll('#avail-calendar-grid .avail-day--selected')
        .forEach(el => el.classList.remove('avail-day--selected'))
    } else if (action === 'block')        { await toggleBlockedDate(date, true) }
    else if (action === 'unblock')        { await toggleBlockedDate(date, false) }
    else if (action === 'block-slot')     { await toggleBlockedSlot(date, slot, true) }
    else if (action === 'unblock-slot')   { await toggleBlockedSlot(date, slot, false) }
  }
}

// Toggle a full-day admin block (BnB, or "block whole day" for café)
async function toggleBlockedDate(dateStr, shouldBlock) {
  if (!appState.session) return showToast('Admin login required', 'error')
  const venueId = availState.venueId
  if (!venueId) return

  try {
    if (shouldBlock) {
      const { error } = await supabase
        .from('venue_availability')
        .insert([{ venue_id: venueId, date: dateStr, status: 'blocked', source: 'admin', time_slot: null }])
      if (error && error.code !== '23505') throw error
    } else {
      const { error } = await supabase
        .from('venue_availability')
        .delete()
        .eq('venue_id', venueId)
        .eq('date', dateStr)
        .eq('source', 'admin')
        .is('time_slot', null)
      if (error) throw error
    }

    if (shouldBlock) {
      availState.adminBlockedDates.add(dateStr)
    } else {
      availState.adminBlockedDates.delete(dateStr)
    }
    renderAvailCalendarGrid()
    renderAvailDateDetail(dateStr)
    showToast(shouldBlock ? `${dateStr} blocked` : `${dateStr} unblocked`, 'success')
  } catch (err) {
    console.error(err)
    showToast('Failed to update blocked date', 'error')
    renderAvailCalendarGrid()
    renderAvailDateDetail(dateStr)
  }
}

// Toggle a slot-specific admin block (café venues only)
async function toggleBlockedSlot(dateStr, slotKey, shouldBlock) {
  if (!appState.session) return showToast('Admin login required', 'error')
  const venueId = availState.venueId
  if (!venueId || !slotKey) return

  try {
    if (shouldBlock) {
      const { error } = await supabase
        .from('venue_availability')
        .insert([{ venue_id: venueId, date: dateStr, status: 'blocked', source: 'admin', time_slot: slotKey }])
      if (error && error.code !== '23505') throw error
    } else {
      const { error } = await supabase
        .from('venue_availability')
        .delete()
        .eq('venue_id', venueId)
        .eq('date', dateStr)
        .eq('source', 'admin')
        .eq('time_slot', slotKey)
      if (error) throw error
    }

    // Update local slot-block map
    if (!availState.adminBlockedSlots.has(dateStr)) availState.adminBlockedSlots.set(dateStr, new Set())
    if (shouldBlock) {
      availState.adminBlockedSlots.get(dateStr).add(slotKey)
    } else {
      availState.adminBlockedSlots.get(dateStr).delete(slotKey)
    }
    renderAvailCalendarGrid()
    renderAvailDateDetail(dateStr)
    showToast(
      shouldBlock ? `${slotKey} slot blocked for ${dateStr}` : `${slotKey} slot unblocked`,
      'success'
    )
  } catch (err) {
    console.error(err)
    showToast('Failed to update slot block', 'error')
    renderAvailCalendarGrid()
    renderAvailDateDetail(dateStr)
  }
}

// Navigation
function handleNavigation(route) {
  switch (route) {
    case 'home':
      showPage('home-page')
      break
    case 'venues':
      showPage('home-page')
      setTimeout(() => document.getElementById('venues-section')?.scrollIntoView({ behavior: 'smooth' }), 100)
      break
    case 'menu-preview':
      showPage('menu-preview-page')
      break
    case 'admin':
      showPage('admin-page')
      break
    default:
      showPage('home-page')
  }
}

// Menu selection functionality
async function loadMenuSelection(menuToken) {
  try {
    const { data, error } = await supabase
      .from('menu_links')
      .select()
      .eq('token', menuToken)
      .single()
    
    if (error) throw error
    
    appState.currentMenuLink = data
    appState.selectedItems = {}
    renderMenuSelection(data)
  } catch (error) {
    console.error(error)
    showToast('Invalid menu link', 'error')
    handleNavigation('home')
  }
}

// Render menu selection page with tabs
// Render menu selection page with modern design
function renderMenuSelection(menuLink) {
  const container = document.getElementById('menu-selection-page')
  if (!container) return
  
  const maxFood = menuLink.max_food_items
  const maxBev = menuLink.max_bev_items
  
  container.innerHTML = `
    <div class="container">
      <div class="modern-page-header">
        <h1>Select Your Menu Items</h1>
        <p>Choose up to <strong>${maxFood} food items</strong> and <strong>${maxBev} beverages</strong></p>
      </div>
      
      <!-- Modern Menu Tabs -->
      <div class="modern-menu-tabs">
        <button class="modern-tab-btn active" data-tab="food-items">
          <span class="tab-icon">🍽️</span>
          <span class="tab-text">Food Items</span>
          <span class="tab-counter" id="selection-food-count">0</span>/<span>${maxFood}</span>
        </button>
        <button class="modern-tab-btn" data-tab="bev-items">
          <span class="tab-icon">🥤</span>
          <span class="tab-text">Beverages</span>
          <span class="tab-counter" id="selection-bev-count">0</span>/<span>${maxBev}</span>
        </button>
      </div>

      <!-- Food Items Tab -->
      <div id="food-items" class="modern-tab-content active">
        <div class="modern-menu-grid">
          ${foodList.map(item => `
            <div class="modern-menu-item">
              <div class="item-info">
                <h4 class="item-name">${item}</h4>
                <p class="item-desc">Freshly prepared</p>
              </div>
              <div class="modern-quantity-controls">
                <button class="modern-qty-btn minus" data-item="${item}" data-category="food" data-change="-1">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
                <span class="modern-qty-display" id="qty-food-${item.replace(/\s+/g, '-').toLowerCase()}">0</span>
                <button class="modern-qty-btn plus" data-item="${item}" data-category="food" data-change="1">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Beverages Tab -->
      <div id="bev-items" class="modern-tab-content">
        <div class="modern-menu-grid">
          ${bevList.map(item => `
            <div class="modern-menu-item">
              <div class="item-info">
                <h4 class="item-name">${item}</h4>
                <p class="item-desc">Refreshing drink</p>
              </div>
              <div class="modern-quantity-controls">
                <button class="modern-qty-btn minus" data-item="${item}" data-category="bev" data-change="-1">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
                <span class="modern-qty-display" id="qty-bev-${item.replace(/\s+/g, '-').toLowerCase()}">0</span>
                <button class="modern-qty-btn plus" data-item="${item}" data-category="bev" data-change="1">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <!-- Modern Selection Summary -->
      <div class="modern-selection-summary">
        <div class="summary-header">
          <h3>Your Selection</h3>
          <div class="summary-items" id="selection-summary-content">
            <p class="empty-state">No items selected yet</p>
          </div>
        </div>
        <button id="submit-menu-selection" class="modern-submit-btn" disabled>
          Continue to Checkout
        </button>
      </div>
    </div>
  `
  
  setTimeout(handleMenuSelectionTabs, 100)
  updateButtonStates()
}

// Update quantity
function updateQuantity(itemName, category, change) {
  if (!appState.currentMenuLink) return
  
  const key = `${category}-${itemName}`
  let currentItem = appState.selectedItems[key]
  
  if (!currentItem) {
    currentItem = { name: itemName, category, quantity: 0 }
    appState.selectedItems[key] = currentItem
  }
  
  const { totalFood, totalBev } = getCurrentTotals()
  const maxFood = appState.currentMenuLink.max_food_items
  const maxBev  = appState.currentMenuLink.max_bev_items
  
  let newQuantity = currentItem.quantity + change
  
  if (change > 0) {
    const categoryTotal = category === 'food' ? totalFood : totalBev
    const categoryMax   = category === 'food' ? maxFood  : maxBev
    if (categoryTotal >= categoryMax) return
    if (newQuantity > 5) return
  }
  
  if (newQuantity < 0) newQuantity = 0
  
  currentItem.quantity = newQuantity
  if (newQuantity === 0) {
    delete appState.selectedItems[key]
  }
  
  const qtyDisplay = document.getElementById(`qty-${category}-${itemName.replace(/\s+/g, '-').toLowerCase()}`)
  if (qtyDisplay) {
    qtyDisplay.textContent = newQuantity
  }
  
  updateTabCounters()
  updateSelectionSummary()
  updateButtonStates()
}

// Get current totals
function getCurrentTotals() {
  const selectedItems = Object.values(appState.selectedItems)
  let totalFood = 0
  let totalBev  = 0
  selectedItems.forEach(item => {
    if (item.category === 'food') totalFood += item.quantity
    else totalBev += item.quantity
  })
  return { totalFood, totalBev }
}

// Update button states
function updateButtonStates() {
  if (!appState.currentMenuLink) return
  const { totalFood, totalBev } = getCurrentTotals()
  const maxFood = appState.currentMenuLink.max_food_items
  const maxBev  = appState.currentMenuLink.max_bev_items
  document.querySelectorAll('.quantity-btn').forEach(btn => {
    const itemName = btn.dataset.item
    const category = btn.dataset.category
    const change   = parseInt(btn.dataset.change, 10)
    const key      = `${category}-${itemName}`
    const currentQuantity = appState.selectedItems[key]?.quantity || 0
    if (change > 0) {
      const categoryTotal = category === 'food' ? totalFood : totalBev
      const categoryMax   = category === 'food' ? maxFood   : maxBev
      btn.disabled = (categoryTotal >= categoryMax) || (currentQuantity >= 5)
    } else {
      btn.disabled = currentQuantity <= 0
    }
  })
  document.querySelectorAll('.modern-qty-btn').forEach(btn => {
    const itemName = btn.dataset.item
    const category = btn.dataset.category
    const change   = parseInt(btn.dataset.change, 10)
    const key      = `${category}-${itemName}`
    const currentQuantity = appState.selectedItems[key]?.quantity || 0
    if (change > 0) {
      const categoryTotal = category === 'food' ? totalFood : totalBev
      const categoryMax   = category === 'food' ? maxFood   : maxBev
      btn.disabled = (categoryTotal >= categoryMax) || (currentQuantity >= 5)
    } else {
      btn.disabled = currentQuantity <= 0
    }
  })
  const submitBtn = document.getElementById('submit-menu-selection')
  if (submitBtn) {
    const hasItems = Object.values(appState.selectedItems).some(item => item.quantity > 0)
    submitBtn.disabled = !hasItems
  }
}

// Update selection summary
function updateSelectionSummary() {
  const summaryContent = document.getElementById('selection-summary-content')
  if (!summaryContent) return
  const selectedItems = Object.values(appState.selectedItems).filter(item => item.quantity > 0)
  if (selectedItems.length === 0) {
    summaryContent.innerHTML = '<p class="empty-state">No items selected yet</p>'
    return
  }
  summaryContent.innerHTML = selectedItems.map(item => `
    <div class="summary-item">
      <span class="summary-item-name">${item.name}</span>
      <span class="summary-item-qty">×${item.quantity}</span>
    </div>
  `).join('')
}

// Submit menu selection
async function submitMenuSelection() {
  if (!appState.currentMenuLink) return
  const selectedItems = Object.values(appState.selectedItems).filter(item => item.quantity > 0)
  if (selectedItems.length === 0) {
    showToast('Please select at least one item', 'error')
    return
  }

  // Server-side limit validation — client controls can be bypassed via DevTools
  const foodCount = selectedItems.filter(i => i.category === 'food').reduce((s, i) => s + i.quantity, 0)
  const bevCount  = selectedItems.filter(i => i.category === 'bev').reduce((s, i) => s + i.quantity, 0)
  if (foodCount > appState.currentMenuLink.max_food_items) {
    showToast(`Maximum ${appState.currentMenuLink.max_food_items} food items allowed`, 'error')
    return
  }
  if (bevCount > appState.currentMenuLink.max_bev_items) {
    showToast(`Maximum ${appState.currentMenuLink.max_bev_items} beverage items allowed`, 'error')
    return
  }

  try {
    const orderData = {
      menu_link_id:   appState.currentMenuLink.id,
      booking_id:     appState.currentMenuLink.booking_id || null,
      selected_items: selectedItems
    }
    const { error } = await supabase.from('orders').insert([orderData])
    if (error) throw error
    showToast('Menu selection submitted successfully!', 'success')
    handleNavigation('home')
  } catch (error) {
    console.error(error)
    showToast('Failed to submit selection', 'error')
  }
}

function showOrderConfirmation(order) {
  const container = document.getElementById('menu-selection-page')
  if (!container) return
  container.innerHTML = `
    <div class="confirmation-ticket">
      <div class="ticket-header">
        <h1>Order Confirmed!</h1>
        <p class="confirmation-number">Order #${order.id}</p>
      </div>
      <div class="ticket-content">
        <div>
          <h3>Your Selected Items</h3>
          <div class="selected-items">
            ${order.selected_items.map(item => `
              <div class="selected-item">
                <span class="selected-item-name">${escapeHtml(item.name)}</span>
                <span class="selected-item-quantity">${escapeHtml(item.quantity)}x</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div style="margin-top:32px;padding:24px;background:rgba(16,185,129,0.1);border-radius:12px;">
          <h3>Next Steps</h3>
          <ul style="list-style:none;padding:0;margin:16px 0;">
            <li style="padding:8px 0;border-bottom:1px solid rgba(16,185,129,0.2);">✅ We will contact you within 24 hours to confirm your booking</li>
            <li style="padding:8px 0;border-bottom:1px solid rgba(16,185,129,0.2);">✅ Final menu confirmation and dietary adjustments can be made during the call</li>
            <li style="padding:8px 0;border-bottom:1px solid rgba(16,185,129,0.2);">✅ Payment details and picnic setup will be discussed</li>
            <li style="padding:8px 0;">✅ We'll send you the exact location and timing details</li>
          </ul>
        </div>
      </div>
      <div class="confirmation-actions">
        <button class="btn btn--primary" onclick="handleNavigation('home')">Back to Home</button>
        <button class="btn btn--outline" onclick="window.print()">Print Confirmation</button>
      </div>
    </div>
  `
}

function loadTestimonials() {
  const testimonialsContainer = document.getElementById('testimonials-container')
  if (!testimonialsContainer) return
  const testimonials = [
    { text: "The Picnic Stories created the most magical evening for our anniversary. Every detail was perfect!", author: "Priya & Rahul", rating: "★★★★★" },
    { text: "Professional service and stunning setup. Our corporate team loved the boho picnic experience.", author: "Tech Solutions Inc.", rating: "★★★★★" },
    
    { text: "Absolutely beautiful picnic setup in Jaipur. The food was delicious and the decor was breathtaking!", author: "Anjali M.", rating: "★★★★★" },
  ]

  testimonialsContainer.innerHTML = testimonials.map(t => `
    <div class="testimonial-card">
      <div class="testimonial-rating">${t.rating}</div>
      <p class="testimonial-text">"${t.text}"</p>
      <p class="testimonial-author">— ${t.author}</p>
    </div>
  `).join('')
}

// ── Navbar state: transparent over hero, solid elsewhere ─────
function updateNavbarState(pageId) {
  const navbar = document.querySelector('.navbar')
  if (!navbar) return
  const isHome = !pageId || pageId === 'home-page'
  if (isHome) {
    const scrolled = window.scrollY > 40
    navbar.classList.toggle('navbar--solid', scrolled)
  } else {
    navbar.classList.add('navbar--solid')
  }
}

// Explicit admin pick for the /packages hero backdrop (site_settings key
// 'packages_hero_image_url'). Populated by loadHeroImage() at bootstrap so
// it's ready before any client-side nav into /packages. Falsy/'' means "not
// set" — renderPackagesPage() then falls back to auto-picking the featured
// tier's own image, and finally to no backdrop at all if neither exists.
let packagesHeroImageUrl = null

// ── Hero image: load from site_settings on startup ───────────
async function loadHeroImage() {
  try {
    const { data } = await supabase
      .from('site_settings')
      .select('key, value')
      .in('key', ['hero_image_url', 'hero_image_mobile_url', 'hero_image_mobile_position', 'packages_hero_image_url'])

    const settings = Object.fromEntries((data || []).map(r => [r.key, r.value]))

    const img        = document.getElementById('hero-bg-img')
    const desktopUrl = settings.hero_image_url
    const mobileUrl  = settings.hero_image_mobile_url
    const mobilePos  = settings.hero_image_mobile_position || '65% 0%'
    const isMobile   = window.innerWidth <= 768

    if (img) {
      if (isMobile && mobileUrl) {
        img.src = mobileUrl
      } else if (desktopUrl) {
        img.src = desktopUrl
      }
    }

    packagesHeroImageUrl = settings.packages_hero_image_url || null

    applyMobilePosition(mobilePos)
  } catch (err) {
    // silently ignore
  }
}

function applyMobilePosition(pos) {
  let styleEl = document.getElementById('hero-mobile-pos-style')
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'hero-mobile-pos-style'
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = `@media (max-width: 768px) { .hero-bg-img { object-position: ${pos} !important; } }`
}

// ── Hero image: admin tab ─────────────────────────────────────
async function loadHeroImageAdminPreview() {
  try {
    const { data } = await supabase
      .from('site_settings')
      .select('key, value')
      .in('key', ['hero_image_url', 'hero_image_mobile_url', 'hero_image_mobile_position', 'packages_hero_image_url'])

    const settings = Object.fromEntries((data || []).map(r => [r.key, r.value]))

    const preview = document.getElementById('hero-img-admin-preview')
    if (preview) {
      const url = settings.hero_image_url
      preview.innerHTML = url
        ? `<img src="${url}" alt="Current hero desktop" class="hero-img-admin-thumb" />`
        : '<span class="hero-img-admin-empty">No image set</span>'
      if (url) {
        const lbl = document.getElementById('hero-upload-label')
        const tn = lbl && Array.from(lbl.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
        if (tn) tn.textContent = ' ↺ Replace photo '
      }
    }

    const mobilePreview = document.getElementById('hero-img-mobile-preview')
    const mobileUrl = settings.hero_image_mobile_url
    if (mobilePreview) {
      mobilePreview.innerHTML = mobileUrl
        ? `<img src="${mobileUrl}" alt="Current hero mobile" class="hero-img-admin-thumb" />`
        : '<span class="hero-img-admin-empty">No image set</span>'
      if (mobileUrl) {
        const lbl = document.getElementById('hero-upload-mobile-label')
        const tn = lbl && Array.from(lbl.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
        if (tn) tn.textContent = ' ↺ Replace photo '
        showMobilePositionAdminUI(mobileUrl, settings.hero_image_mobile_position)
      }
    }

    const pkgPreview = document.getElementById('hero-img-packages-preview')
    const pkgUrl = settings.packages_hero_image_url
    if (pkgPreview) {
      pkgPreview.innerHTML = pkgUrl
        ? `<img src="${pkgUrl}" alt="Current /packages hero" class="hero-img-admin-thumb" />`
        : '<span class="hero-img-admin-empty">No image set — auto-picks the featured package\'s own photo</span>'
      if (pkgUrl) {
        const lbl = document.getElementById('hero-upload-packages-label')
        const tn = lbl && Array.from(lbl.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
        if (tn) tn.textContent = ' ↺ Replace photo '
      }
    }
  } catch (err) {
    console.error(err)
  }
}

function showMobilePositionAdminUI(imgUrl, savedPos) {
  const wrap = document.getElementById('hero-mobile-position-wrap')
  if (!wrap) return
  wrap.style.display = 'block'

  const parts = (savedPos || '65% 0%').split(' ')
  const x = parseInt(parts[0]) || 65
  const y = parseInt(parts[1]) || 0

  const sliderX    = document.getElementById('hero-pos-x')
  const sliderY    = document.getElementById('hero-pos-y')
  const valX       = document.getElementById('hero-pos-x-val')
  const valY       = document.getElementById('hero-pos-y-val')
  const posPreview = document.getElementById('hero-pos-preview')
  const crosshair  = document.getElementById('hero-pos-crosshair')

  if (sliderX) sliderX.value = x
  if (sliderY) sliderY.value = y
  if (valX) valX.textContent = x + '%'
  if (valY) valY.textContent = y + '%'

  if (posPreview) {
    posPreview.style.backgroundImage = `url('${imgUrl}')`
    posPreview.style.backgroundPosition = `${x}% ${y}%`
    posPreview.addEventListener('click', (e) => {
      const rect = posPreview.getBoundingClientRect()
      const nx = Math.round(((e.clientX - rect.left) / rect.width)  * 100)
      const ny = Math.round(((e.clientY - rect.top)  / rect.height) * 100)
      if (sliderX) sliderX.value = nx
      if (sliderY) sliderY.value = ny
      window.updateMobilePosition()
    })
  }
  if (crosshair) { crosshair.style.left = x + '%'; crosshair.style.top = y + '%' }
}

window.updateMobilePosition = function() {
  const x = document.getElementById('hero-pos-x')?.value || 65
  const y = document.getElementById('hero-pos-y')?.value || 0
  const valX = document.getElementById('hero-pos-x-val')
  const valY = document.getElementById('hero-pos-y-val')
  if (valX) valX.textContent = x + '%'
  if (valY) valY.textContent = y + '%'
  const posPreview = document.getElementById('hero-pos-preview')
  const crosshair  = document.getElementById('hero-pos-crosshair')
  if (posPreview) posPreview.style.backgroundPosition = `${x}% ${y}%`
  if (crosshair) { crosshair.style.left = x + '%'; crosshair.style.top = y + '%' }
  applyMobilePosition(`${x}% ${y}%`)
}

window.saveMobilePosition = async function() {
  if (!appState.session) return showToast('Admin login required', 'error')
  const x = document.getElementById('hero-pos-x')?.value || 65
  const y = document.getElementById('hero-pos-y')?.value || 0
  const pos = `${x}% ${y}%`
  const statusEl = document.getElementById('hero-pos-status')
  try {
    const { error } = await supabase
      .from('site_settings')
      .update({ value: pos, updated_at: new Date().toISOString() })
      .eq('key', 'hero_image_mobile_position')
    if (error) throw error
    if (statusEl) statusEl.innerHTML = '<span class="hero-upload-success">✓ Position saved</span>'
    showToast('Mobile position saved', 'success')
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span class="hero-upload-error">Failed: ${err.message}</span>`
  }
}

window.handleHeroImageUpload = async function(input, device = 'desktop') {
  const file = input.files[0]
  if (!file) return
  if (!appState.session) return showToast('Admin login required', 'error')

  const isDesktop  = device === 'desktop'
  const labelId    = isDesktop ? 'hero-upload-label' : 'hero-upload-mobile-label'
  const statusId   = isDesktop ? 'hero-upload-status' : 'hero-upload-mobile-status'
  const settingKey = isDesktop ? 'hero_image_url' : 'hero_image_mobile_url'
  const label      = document.getElementById(labelId)
  const status     = document.getElementById(statusId)
  const storagePath = `hero/${isDesktop ? 'main' : 'mobile'}.${file.name.split('.').pop()}`

  const labelTn = label && Array.from(label.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
  if (labelTn) labelTn.textContent = ' Uploading… '
  if (status) status.innerHTML = ''

  try {
    const { error: upErr } = await supabase.storage
      .from('site-images')
      .upload(storagePath, file, { upsert: true })
    if (upErr) throw upErr

    const { data: { publicUrl } } = supabase.storage
      .from('site-images')
      .getPublicUrl(storagePath)

    // Stable storage path + upsert means the URL is identical on every upload,
    // so the browser/CDN keeps serving the cached old image. Append a version
    // token so the stored URL changes each time and the cache is bypassed.
    const versionedUrl = publicUrl + '?v=' + Date.now()

    const { error: dbErr } = await supabase
      .from('site_settings')
      .update({ value: versionedUrl, updated_at: new Date().toISOString() })
      .eq('key', settingKey)
    if (dbErr) throw dbErr

    if (isDesktop) {
      const heroImg = document.getElementById('hero-bg-img')
      if (heroImg && window.innerWidth > 768) heroImg.src = versionedUrl
      const preview = document.getElementById('hero-img-admin-preview')
      if (preview) preview.innerHTML = `<img src="${versionedUrl}" alt="Current hero desktop" class="hero-img-admin-thumb" />`
    } else {
      const heroImg = document.getElementById('hero-bg-img')
      if (heroImg && window.innerWidth <= 768) heroImg.src = versionedUrl
      const preview = document.getElementById('hero-img-mobile-preview')
      if (preview) preview.innerHTML = `<img src="${versionedUrl}" alt="Current hero mobile" class="hero-img-admin-thumb" />`
      const savedPos = document.getElementById('hero-pos-x')
        ? `${document.getElementById('hero-pos-x').value}% ${document.getElementById('hero-pos-y').value}%`
        : '65% 0%'
      showMobilePositionAdminUI(versionedUrl, savedPos)
    }

    if (status) status.innerHTML = `<span class="hero-upload-success">✓ ${isDesktop ? 'Desktop' : 'Mobile'} image updated</span>`
    if (labelTn) labelTn.textContent = ` ↺ Replace photo `
    showToast(`${isDesktop ? 'Desktop' : 'Mobile'} hero updated`, 'success')
  } catch (err) {
    console.error(err)
    if (status) status.innerHTML = `<span class="hero-upload-error">Upload failed: ${err.message}</span>`
    if (labelTn) labelTn.textContent = ' ↑ Choose photo '
    showToast('Upload failed: ' + err.message, 'error')
  }
}

// Explicit pick for the /packages hero backdrop — same upload pattern as
// handleHeroImageUpload (stable storage path, upsert, cache-busting version
// token) but simpler: one image, no mobile/position variant, since the
// backdrop is heavily blurred (see .pkgp-hero-backdrop) and framing barely
// matters at that blur radius.
window.handlePackagesHeroImageUpload = async function(input) {
  const file = input.files[0]
  if (!file) return
  if (!appState.session) return showToast('Admin login required', 'error')

  const label  = document.getElementById('hero-upload-packages-label')
  const status = document.getElementById('hero-upload-packages-status')
  const storagePath = `hero/packages.${file.name.split('.').pop()}`

  const labelTn = label && Array.from(label.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
  if (labelTn) labelTn.textContent = ' Uploading… '
  if (status) status.innerHTML = ''

  try {
    const { error: upErr } = await supabase.storage
      .from('site-images')
      .upload(storagePath, file, { upsert: true })
    if (upErr) throw upErr

    const { data: { publicUrl } } = supabase.storage
      .from('site-images')
      .getPublicUrl(storagePath)
    const versionedUrl = publicUrl + '?v=' + Date.now()

    const { error: dbErr } = await supabase
      .from('site_settings')
      .update({ value: versionedUrl, updated_at: new Date().toISOString() })
      .eq('key', 'packages_hero_image_url')
    if (dbErr) throw dbErr

    packagesHeroImageUrl = versionedUrl
    const preview = document.getElementById('hero-img-packages-preview')
    if (preview) preview.innerHTML = `<img src="${versionedUrl}" alt="Current /packages hero" class="hero-img-admin-thumb" />`

    if (status) status.innerHTML = '<span class="hero-upload-success">✓ Packages hero updated</span>'
    if (labelTn) labelTn.textContent = ' ↺ Replace photo '
    showToast('Packages hero updated', 'success')
  } catch (err) {
    console.error(err)
    if (status) status.innerHTML = `<span class="hero-upload-error">Upload failed: ${err.message}</span>`
    if (labelTn) labelTn.textContent = ' ↑ Choose photo '
    showToast('Upload failed: ' + err.message, 'error')
  }
}


// ── Menu viewer — full-screen, swipeable lightbox for venue menu pages ──
// Appended to <body> and removed on close, so the venue page underneath
// (and its scroll position / booking CTA) is preserved on dismiss.
let menuViewerState = null

function openMenuViewer(venueId, startIndex = 0) {
  const venue = appState.venues.find(v => v.id === venueId)
  const pages = venue && Array.isArray(venue.menu_pages) ? venue.menu_pages.filter(p => p && p.url) : []
  if (!pages.length) return

  closeMenuViewer() // clear any stray instance
  const idx = Math.min(Math.max(0, startIndex), pages.length - 1)
  menuViewerState = { pages, index: idx, touchStartX: null, zoomed: false }

  const overlay = document.createElement('div')
  overlay.className = 'menu-viewer'
  overlay.id = 'menu-viewer'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', `${venue.name} menu`)
  overlay.innerHTML = `
    <div class="menu-viewer-bar">
      <span class="menu-viewer-title">${escapeHtml(venue.name)} · Menu</span>
      <button type="button" class="menu-viewer-close" onclick="closeMenuViewer()" aria-label="Close menu">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <button type="button" class="menu-viewer-nav menu-viewer-prev" aria-label="Previous page">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div class="menu-viewer-stage" id="menu-viewer-stage"></div>
    <button type="button" class="menu-viewer-nav menu-viewer-next" aria-label="Next page">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="menu-viewer-footer">
      <span class="menu-viewer-counter" id="menu-viewer-counter"></span>
    </div>
  `
  document.body.appendChild(overlay)
  document.body.classList.add('menu-viewer-open')

  overlay.querySelector('.menu-viewer-prev').addEventListener('click', () => menuViewerGo(-1))
  overlay.querySelector('.menu-viewer-next').addEventListener('click', () => menuViewerGo(1))
  overlay.addEventListener('click', e => { if (e.target === overlay) closeMenuViewer() })

  const stage = overlay.querySelector('#menu-viewer-stage')
  stage.addEventListener('click', e => { if (e.target === stage) closeMenuViewer() })
  stage.addEventListener('touchstart', e => { menuViewerState.touchStartX = e.changedTouches[0].clientX }, { passive: true })
  stage.addEventListener('touchend', e => {
    if (!menuViewerState || menuViewerState.touchStartX === null) return
    const dx = e.changedTouches[0].clientX - menuViewerState.touchStartX
    if (Math.abs(dx) > 40) menuViewerGo(dx < 0 ? 1 : -1)
    menuViewerState.touchStartX = null
  }, { passive: true })

  document.addEventListener('keydown', menuViewerKeydown)
  renderMenuViewer()
}

function renderMenuViewer() {
  if (!menuViewerState) return
  const { pages, index, zoomed } = menuViewerState
  const stage = document.getElementById('menu-viewer-stage')
  const counter = document.getElementById('menu-viewer-counter')
  if (!stage) return
  const page = pages[index]
  stage.innerHTML = `<img class="menu-viewer-img${zoomed ? ' is-zoomed' : ''}" src="${escapeHtml(page.url)}" alt="${escapeHtml(page.alt || `Menu page ${index + 1}`)}">`
  stage.querySelector('.menu-viewer-img').addEventListener('click', menuViewerToggleZoom)
  if (counter) counter.textContent = `Page ${index + 1} of ${pages.length}`
  const overlay = document.getElementById('menu-viewer')
  if (overlay) {
    const multi = pages.length > 1
    overlay.querySelector('.menu-viewer-prev').style.display = multi ? '' : 'none'
    overlay.querySelector('.menu-viewer-next').style.display = multi ? '' : 'none'
  }
}

function menuViewerGo(delta) {
  if (!menuViewerState) return
  const n = menuViewerState.pages.length
  menuViewerState.index = (menuViewerState.index + delta + n) % n
  menuViewerState.zoomed = false
  renderMenuViewer()
}

function menuViewerToggleZoom() {
  if (!menuViewerState) return
  menuViewerState.zoomed = !menuViewerState.zoomed
  renderMenuViewer()
}

function menuViewerKeydown(e) {
  if (!menuViewerState) return
  if (e.key === 'Escape') closeMenuViewer()
  else if (e.key === 'ArrowLeft') menuViewerGo(-1)
  else if (e.key === 'ArrowRight') menuViewerGo(1)
}

function closeMenuViewer() {
  const overlay = document.getElementById('menu-viewer')
  if (overlay) overlay.remove()
  document.body.classList.remove('menu-viewer-open')
  document.removeEventListener('keydown', menuViewerKeydown)
  menuViewerState = null
}

// ── Global function exports (required for inline onclick handlers) ────
window.openMenuViewer             = openMenuViewer
window.closeMenuViewer            = closeMenuViewer
window.navigateHome               = navigateHome
window.handleNavigation           = handleNavigation
window.showPage                   = showPage
window.showMyBookingsPage         = showMyBookingsPage
window.showVenuePage              = showVenuePage
window.selectTimeSlot             = selectTimeSlot
window.showCalendarStep           = showCalendarStep
window.updateGuestCount           = updateGuestCount
window.showVenueBodyStep          = showVenueBodyStep
window.setBookingOccasion         = setBookingOccasion
window.showPackagesPage           = showPackagesPage
window.pkgPageSelectOccasion      = pkgPageSelectOccasion
window.pkgPageSelectTier          = pkgPageSelectTier
window.pkgPageSelectVenue         = pkgPageSelectVenue
window.pkgPageSelectCity          = pkgPageSelectCity
window.showPackageBack            = showPackageBack
window.selectPackageTier          = selectPackageTier
window.updateBookingSummaryPrice  = updateBookingSummaryPrice
window.handleInlineBookingSubmit  = handleInlineBookingSubmit
window.submitBookingIntent        = submitBookingIntent
window.onSuccessWhatsAppClick     = onSuccessWhatsAppClick
window.showModal                  = showModal
window.hideModal                  = hideModal
window.sendOtpResend              = sendOtpResend
window.copyMenuLink               = copyMenuLink
window.customerSignOut            = customerSignOut
window.saveTeam                   = saveTeam
window.setAdminTeamFilter         = setAdminTeamFilter

function goToVenueSection(setting) {
  // Navigate home if not already there, then scroll to the outdoor/indoor section
  handleNavigation('home')
  setTimeout(() => {
    const target = document.getElementById(`${setting}-venues`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      // Fallback: scroll to top of venues section
      document.getElementById('venues-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, 80)
}
window.goToVenueSection = goToVenueSection

// mode: 'intent' = coming from the review screen (pendingLead exists)
//       'form'   = coming from the booking form (read values from DOM)
function goBackToVenueDetail(mode) {
  const venue = appState.currentVenue
  if (!venue) return

  if (mode === 'intent' && appState.pendingLead) {
    appState.changeMode     = 'intent'
    appState.changeModeData = { ...appState.pendingLead }
  } else if (mode === 'form') {
    appState.changeMode = 'form'
    const saved = {}
    ;['name','email','mobile-number','special-requirements','occasion','occasion-other','board-type','board-message']
      .forEach(f => { const el = document.querySelector(`[name="${f}"]`); if (el) saved[f] = el.value })
    saved.addons = [...document.querySelectorAll('.vd-bf-addon:checked')].map(cb => cb.value)
    appState.changeModeData = saved
  }

  appState.pendingLead   = null
  appState.pendingAddOns = null
  showVenuePage(venue.id, false)
}
window.goBackToVenueDetail = goBackToVenueDetail

// ── Admin page initialisation ────────────────────────────────
function initAdminPage() {
  const loginForm = document.getElementById('admin-login-form')
  if (loginForm) loginForm.addEventListener('submit', handleAdminLogin)
  const logoutBtn = document.getElementById('admin-logout')
  if (logoutBtn) logoutBtn.addEventListener('click', handleAdminLogout)
  const venueForm = document.getElementById('venue-admin-form')
  if (venueForm) venueForm.addEventListener('submit', handleVenueFormSubmit)
  const vfpClose = document.getElementById('vfp-close')
  if (vfpClose) vfpClose.addEventListener('click', closeVenueForm)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  })
  const generateBtn = document.getElementById('generate-menu-link')
  if (generateBtn) {
    generateBtn.addEventListener('click', () => {
      generateMenuLink(
        parseInt(document.getElementById('food-count')?.value || '3'),
        parseInt(document.getElementById('bev-count')?.value  || '2')
      )
    })
  }
  supabase.auth.onAuthStateChange((_event, session) => applyAuthState(session))
  supabase.auth.getSession().then(({ data: { session } }) => applyAuthState(session))

  // Delegated handler for dynamically-rendered admin action buttons
  document.addEventListener('click', (e) => {
    const holdBtn = e.target.closest('.hold-booking-btn')
    if (holdBtn) {
      holdComboBooking(holdBtn.dataset.id, holdBtn.dataset.venueId, holdBtn.dataset.preferredDate, holdBtn.dataset.checkoutDate)
      return
    }
    const releaseBtn = e.target.closest('.release-hold-btn')
    if (releaseBtn) {
      if (confirm('Release this hold and re-open the singles?')) releaseHold(releaseBtn.dataset.id)
      return
    }
    const recheckBtn = e.target.closest('.recheck-hold-btn')
    if (recheckBtn) {
      recheckHold(recheckBtn.dataset.id, recheckBtn.dataset.venueId, recheckBtn.dataset.preferredDate, recheckBtn.dataset.checkoutDate, recheckBtn)
      return
    }
    const confirmBtn = e.target.closest('.confirm-booking-btn')
    if (confirmBtn) {
      // Soft guard: warn if confirming a combo that was held very recently —
      // Airbnb may not have imported the block yet (sync runs hourly).
      const heldAt = confirmBtn.dataset.heldAt
      if (heldAt) {
        const mins = (Date.now() - new Date(heldAt).getTime()) / 60000
        if (mins < 60 && !confirm(`Held only ${Math.round(mins)} min ago — Airbnb may not have synced the block yet. Confirm anyway?`)) return
      }
      confirmBooking(
        confirmBtn.dataset.id,
        confirmBtn.dataset.venueId,
        confirmBtn.dataset.venueType,
        confirmBtn.dataset.preferredDate,
        confirmBtn.dataset.checkoutDate,
        confirmBtn.dataset.timeSlot
      )
      return
    }
  })
}

// ── Menu selection page initialisation ───────────────────────
function initMenuSelectionPage() {
  // Tab switching — covers both .selection-tab-btn (legacy) and .modern-tab-btn (current UI)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.selection-tab-btn, .modern-tab-btn')
    if (!btn) return
    document.querySelectorAll('.selection-tab-btn, .modern-tab-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.querySelectorAll('#menu-selection-page .menu-tab-content, #menu-selection-page .modern-tab-content').forEach(c => {
      c.classList.remove('active')
      c.style.display = 'none'
    })
    const target = document.getElementById(btn.dataset.tab)
    if (target) { target.classList.add('active'); target.style.display = '' }
    updateTabCounters()
  })

  // Quantity +/- buttons — covers both .quantity-btn (legacy) and .modern-qty-btn (current UI)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.quantity-btn, .modern-qty-btn')
    if (!btn || btn.disabled) return
    const item   = btn.dataset.item
    const cat    = btn.dataset.category
    const change = parseInt(btn.dataset.change, 10)
    if (item && cat && !isNaN(change)) updateQuantity(item, cat, change)
  })

  // Submit button
  document.addEventListener('click', (e) => {
    if (e.target.closest('#submit-menu-selection')) submitMenuSelection()
  })
}

// ── Restore venue detail page on browser back/forward ────────
window.addEventListener('popstate', (event) => {
  const path = window.location.pathname
  if (path === '/booking-confirmed') { document.title = 'The Picnic Stories'; showPage('home-page'); return }
  if (/^\/packages\/?$/.test(path)) { showPackagesPage(false); return }
  const m = path.match(/^\/venues\/([^/]+)\/?$/)
  const v = m ? appState.venues.find(x => x.slug === decodeURIComponent(m[1])) : null
  if (event.state?.venueId) {
    showVenuePage(event.state.venueId, false)
  } else if (v) {
    showVenuePage(v.id, false)
  } else {
    document.title = 'The Picnic Stories'
    showPage('home-page')
  }
})


// ── Custom Picnic Modal ───────────────────────────────────────
function openCustomPicnicModal() {
  const modal = document.getElementById('custom-picnic-modal')
  if (!modal) return
  // Set min date to today so users can't pick the past
  const dateInput = document.getElementById('cpm-date')
  if (dateInput) dateInput.min = new Date().toISOString().split('T')[0]
  modal.style.display = 'flex'
  document.body.style.overflow = 'hidden'
}

function closeCustomPicnicModal() {
  const modal = document.getElementById('custom-picnic-modal')
  if (!modal) return
  modal.style.display = 'none'
  document.body.style.overflow = ''
  document.getElementById('custom-picnic-form')?.reset()
  const formStep    = document.getElementById('cpm-form-step')
  const successStep = document.getElementById('cpm-success-step')
  if (formStep)    formStep.style.display = ''
  if (successStep) successStep.style.display = 'none'
}

async function handleCustomPicnicSubmit(e) {
  e.preventDefault()
  const form = e.target

  const name     = form['cpm-name'].value.trim()
  const phone    = form['cpm-phone'].value.trim()
  const city     = form['cpm-city'].value        // 'jaipur' or 'ncr'
  const date     = form['cpm-date'].value
  const location = form['cpm-location'].value.trim()
  const guests   = parseInt(form['cpm-guests'].value, 10)
  const occasion = form['cpm-occasion'].value || null

  // Validate
  if (!name)                      { showToast('Please enter your name', 'error'); return }
  if (!/^\d{10}$/.test(phone))    { showToast('Please enter a valid 10-digit phone number', 'error'); return }
  if (!city)                      { showToast('Please select a city', 'error'); return }
  if (!date)                      { showToast('Please select a date', 'error'); return }
  if (!location)                  { showToast('Please describe your spot', 'error'); return }
  if (isNaN(guests) || guests < 1){ showToast('Please enter a valid guest count', 'error'); return }

  const customVenue = appState.venues.find(v => v.type === 'custom')
  if (!customVenue) { showToast('Something went wrong', 'error'); return }

  // Route to the right team by city selection
  const teamCity = city === 'jaipur' ? 'jaipur' : 'gurugram'
  const team     = (appState.teams || []).find(t => t.city === teamCity)

  const btn = document.getElementById('cpm-submit-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...' }

  try {
    const { error } = await supabase.rpc('submit_booking_intent', {
      p_full_name:            name,
      p_mobile_number:        phone,
      p_email_address:        '',
      p_guest_count:          guests,
      p_preferred_date:       date,
      p_special_requirements: location,
      p_advance_amount:       0,
      p_confirmed:            false,
      p_customer_intent:      'query',
      p_venue_id:             customVenue.id,
      p_venue_address:        location,
      p_checkout_date:        null,
      p_time_slot:            null,
      p_external_booking_ref: null,
      p_occasion:             occasion,
      p_board:                null,
      p_children_count:       0,
      p_add_ons:              [],
    })
    if (error) throw error

    // Build pre-populated WhatsApp message
    const waNumber = team?.whatsapp || '919266964666'
    const waBody   = [
      'Hi! I would like to plan a custom picnic',
      `📍 Location: ${location}`,
      `📅 Date: ${date}`,
      `👥 Guests: ${guests}`,
      occasion ? `🎉 Occasion: ${occasion}` : null,
      `\nMy name is ${name}.`,
    ].filter(Boolean).join('\n')

    const waLink = document.getElementById('cpm-wa-link')
    if (waLink) waLink.href = `https://wa.me/${waNumber}?text=${encodeURIComponent(waBody)}`

    const formStep    = document.getElementById('cpm-form-step')
    const successStep = document.getElementById('cpm-success-step')
    if (formStep)    formStep.style.display = 'none'
    if (successStep) successStep.style.display = ''

  } catch (err) {
    console.error('Custom picnic submit error:', err)
    showToast('Something went wrong — please try again.', 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Enquiry' }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // ---- Runs on every page that loads app.js (public site + admin.html) ----
  // initAdminPage wires the admin form/tab handlers and the Supabase session
  // check. Its getElementById lookups are all null-guarded, so it is a safe
  // no-op on the public site where the admin elements are absent.
  initAdminPage()

  // Navbar scroll behaviour (the navbar exists on both pages)
  updateNavbarState(document.querySelector('.page.active')?.id || 'home-page')
  window.addEventListener('scroll', () => {
    const activePage = document.querySelector('.page.active')?.id || 'home-page'
    updateNavbarState(activePage)
  }, { passive: true })

  // Nav link routing (data-route links only exist on the public site)
  document.querySelectorAll('.nav-link[data-route]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      handleNavigation(link.dataset.route)
    })
  })

  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', () => overlay.closest('.modal')?.classList.add('hidden'))
  })

  // Teams data is needed on both admin and public (footer + admin filter)
  loadTeams()

  // Package tier definitions (Setting/Moment/Story) — needed on the public
  // site for tier cards and on admin for the Packages panel.
  loadPackages()

  // Custom picnic modal
  const cpmModal   = document.getElementById('custom-picnic-modal')
  const cpmForm    = document.getElementById('custom-picnic-form')
  const cpmClosBtn = document.getElementById('cpm-close-btn')
  const cpmDoneBtn = document.getElementById('cpm-done-btn')
  if (cpmModal) {
    cpmClosBtn?.addEventListener('click', closeCustomPicnicModal)
    cpmDoneBtn?.addEventListener('click', closeCustomPicnicModal)
    cpmModal.addEventListener('click', (e) => { if (e.target === cpmModal) closeCustomPicnicModal() })
    cpmForm?.addEventListener('submit', handleCustomPicnicSubmit)
  }

  // ---- Public homepage only ----
  // admin.html has no #home-page, so skip all the storefront initialisers
  // (and their Supabase calls) below to avoid needless work and console noise.
  if (!document.getElementById('home-page')) return

  initializeMenuPreview()
  handleMenuPreviewTabs()
  renderAddonsStrip()
  initMenuSelectionPage()
  setupPkgCarouselDelegation() // once for all .pkg-card-media instances, across all 3 render sites
  setupVenueCarouselDelegation() // once for all .venue-card-media instances (home gallery, /packages venue picker, venue-first tier step)

  // URL routing — path-based /venues/<slug> plus legacy query params
  const urlParams = new URLSearchParams(window.location.search)
  const menuToken = urlParams.get('menu')
  const bookingId = urlParams.get('booking')
  const venueId   = urlParams.get('venue')
  const view      = urlParams.get('view')
  const payId     = urlParams.get('pay')
  const venuePath = window.location.pathname.match(/^\/venues\/([^/]+)\/?$/)
  const packagesPath = /^\/packages\/?$/.test(window.location.pathname)

  // Packages-first handoff surviving a hard refresh mid-flow (Phase 2).
  try {
    const rawPending = sessionStorage.getItem('ps_pending_pkg')
    if (rawPending && !appState.pendingPackage) appState.pendingPackage = JSON.parse(rawPending)
  } catch (err) { /* ignore */ }

  if (payId) {
    handleEmailPayLink(parseInt(payId, 10))
  } else if (menuToken) {
    showPage('menu-selection-page')
    loadMenuSelection(menuToken)
    if (bookingId) appState.currentBooking = { id: parseInt(bookingId, 10) }
  } else if (venuePath) {
    const slug = decodeURIComponent(venuePath[1])
    loadVenues().then(() => {
      const v = appState.venues.find(x => x.slug === slug)
      if (v) showVenuePage(v.id, false)
      else showPage('home-page')
    })
  } else if (packagesPath) {
    // /packages entry — ?tier= and ?occasion= deep links (homepage cards, ads).
    // Unknown values are ignored gracefully. PACKAGE_TIERS may still be the
    // hardcoded fallback at this instant; showPackagesPage awaits the DB load.
    const qsTier = urlParams.get('tier')
    const qsOcc  = urlParams.get('occasion')
    showPackagesPage(false, {
      tierKey:  qsTier && PACKAGE_TIERS[qsTier] ? qsTier : null,
      occasion: OCCASIONS.includes(qsOcc) ? qsOcc : '',
    })
  } else if (venueId) {
    // Legacy ?venue=ID deep links → resolve, then swap the URL to the slug form
    loadVenues().then(() => {
      const v = appState.venues.find(x => x.id === parseInt(venueId, 10))
      if (!v) { showPage('home-page'); return }
      showVenuePage(v.id, false)
      if (v.slug) history.replaceState({ venueId: v.id }, document.title, `/venues/${v.slug}`)
    })
  } else if (view === 'mybookings') {
    showMyBookingsPage()
  }

  // Venue card click delegation. Cards are real <a href="/venues/slug"> anchors,
  // so let the browser handle modifier/middle clicks (new tab, copy link) natively
  // and intercept only plain left-clicks for in-app SPA navigation.
  const venuesGrid = document.getElementById('venues-grid')
  if (venuesGrid) {
    venuesGrid.addEventListener('click', (e) => {
      // Carousel controls live inside the same [data-venue-id] anchor; this
      // listener sits on a closer ancestor than the document-level carousel
      // delegation (setupVenueCarouselDelegation), so it fires FIRST in the
      // bubble phase — must bail out here or a next/prev/dot click navigates
      // to the venue page before the carousel handler ever gets a chance to
      // stopPropagation/preventDefault.
      if (e.target.closest('.venue-card-media-arrow, .venue-card-media-dot')) return
      const card = e.target.closest('[data-venue-id]')
      if (!card) return
      if (e.defaultPrevented || e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const id = parseInt(card.dataset.venueId, 10)
      if (isNaN(id)) return
      e.preventDefault()
      showVenuePage(id)
    })
    // The custom CTA is a <div role="button"> (no detail page / not an anchor) —
    // keep keyboard activation for it. Anchors handle Enter natively.
    venuesGrid.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const card = e.target.closest('.venue-custom-cta[data-venue-id]')
      if (!card) return
      e.preventDefault()
      const id = parseInt(card.dataset.venueId, 10)
      if (!isNaN(id)) showVenuePage(id)
    })
  }

  // partner_bnb "Add picnic setup" reveal — shows calendar + replaces mobile bar
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="reveal-bnb-calendar"]')
    if (!btn) return
    const venueId = parseInt(btn.dataset.bookVenueId, 10)
    const venue   = appState.venues.find(v => v.id === venueId)

    document.getElementById('bnb-step-ui')?.style.setProperty('display', 'none')

    const widget    = document.getElementById('avail-calendar-widget')
    const sidebarBtn = document.getElementById('sidebar-book-btn')
    if (widget)     widget.style.display    = ''
    if (sidebarBtn) sidebarBtn.style.display = ''

    // Swap mobile bar to standard date-picker bar
    const mobileBar = document.querySelector('.vd-mobile-book-bar')
    if (mobileBar && venue) {
      mobileBar.innerHTML = `
        <div class="vd-mobile-book-price">
          <span class="vd-mobile-book-amount" id="mobile-bar-date-text">Pick a date ↑</span>
          <span class="vd-mobile-book-label">${venue.base_price ? escapeHtml(formatPrice(venue.base_price)) : 'Custom pricing'}</span>
        </div>
        <button class="btn btn--venue-primary" id="mobile-bar-book-btn"
                data-book-venue-id="${venue.id}" disabled>Select a date to book</button>
      `
    }
  })

  // Sidebar / mobile "Select guests →" and "Book Now" button
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#sidebar-book-btn, #mobile-bar-book-btn')
    if (!btn || btn.disabled) return
    const venueId = parseInt(btn.dataset.bookVenueId, 10)
    if (isNaN(venueId)) return
    const venue = appState.venues.find(v => v.id === venueId)
    if (venue) {
      // Meta Pixel — InitiateCheckout event (user taps an enabled Book Now button)
      if (typeof fbq === 'function') {
        fbq('track', 'InitiateCheckout', {
          content_name: venue.name,
          content_ids:  [String(venueId)],
          currency:     'INR',
        })
      }
      if (appState.bookingStep === 'guests') {
        if (appState.changeMode === 'intent' && appState.changeModeData) {
          // Fast-resume: update date/slot on saved lead, skip the form entirely
          const lead = {
            ...appState.changeModeData,
            preferred_date: appState.selectedDate,
            time_slot:      appState.selectedTimeSlot || appState.changeModeData.time_slot,
          }
          appState.pendingLead    = lead
          appState.changeMode     = null
          appState.changeModeData = null
          const body     = document.getElementById('vd-body')
          const bookView = document.getElementById('vd-booking-view')
          if (body)     body.style.display = 'none'
          if (bookView) {
            bookView.style.display = ''
            bookView.innerHTML = buildIntentScreenHTML(lead, { containerClass: 'vd-intent-wrap container' })
            // Sync the captured lead row with the changed date/slot.
            captureLeadOnIntent()
          }
        } else if (packageFlowActive(venue)) {
          const pending = appState.pendingPackage
          if (pending?.tierKey && pending.venueId === venue.id && PACKAGE_TIERS[pending.tierKey]) {
            // Packages-first entry: tier already chosen on /packages. Consume
            // it via the SAME selectPackageTier() path the venue-first tier
            // step uses (one code path — docs/PHASE2_PACKAGES_FIRST_PLAN.md),
            // skipping the tier step. Occasion was pre-filled at venue entry
            // and stays user-editable; "Change package" on the intent screen
            // remains the escape hatch.
            appState.pendingPackage = null
            try { sessionStorage.removeItem('ps_pending_pkg') } catch (err) { /* ignore */ }
            selectPackageTier(pending.tierKey)
          } else {
            // Packages flow: insert the tier step between guests and the form.
            showPackageStep(venue)
          }
        } else {
          showBookingForm(venue)
        }
      } else {
        showGuestSelector(venue)
      }
    }
  })

  // Meta Pixel — Contact event (any WhatsApp link tap, including header, footer, floating btn)
  document.addEventListener('click', (e) => {
    const waLink = e.target.closest('a[href*="wa.me"]')
    if (!waLink) return
    if (typeof fbq === 'function') fbq('track', 'Contact')
  })

  loadVenues()
  loadHeroImage()
  loadTestimonials()
})
