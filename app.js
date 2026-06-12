import { createClient } from '@supabase/supabase-js'

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
  selectedDate: null,        // cafe: selected date
  selectedTimeSlot: null,    // cafe: selected time slot
  checkinDate: null,         // bnb: check-in date
  checkoutDate: null,        // bnb: checkout date
  adults: 2,                 // guest selector: adult count
  children: 0,               // guest selector: child count (under 10, free — no price/inclusion impact)
  bookingStep: 'calendar',   // 'calendar' | 'guests'
}

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

// Fetch add-ons available for a given venue type, filtered server-side by available_for
async function loadVenueAddOns(venueType) {
  try {
    const { data, error } = await supabase
      .from('add_ons')
      .select('*')
      .eq('is_active', true)
      .contains('available_for', [venueType])
      .order('sort_order')
    if (error) throw error
    return data || []
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

// Tiered price for a venue given billing guest count.
// Tiers are stored in venue.metadata.tiers as [{up_to, price}, ...] sorted ascending.
// Guests beyond the last tier: lastTier.price + overage_per_person × (guests − lastTier.up_to)
// Falls back to venue.base_price if no tiers defined.
function getVenuePrice(venue, billingGuests) {
  const m = venue?.metadata
  if (!m || !Array.isArray(m.tiers) || m.tiers.length === 0) {
    return venue?.base_price ?? 0
  }
  const tiers = m.tiers
  const match = tiers.find(t => billingGuests <= t.up_to)
  if (match) return match.price
  // Beyond last tier — overage
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
  } catch (error) {
    console.error('Failed to load venues:', error)
    const grid = document.getElementById('venues-grid')
    if (grid) grid.innerHTML = '<p class="venues-error">Unable to load venues. Please refresh the page.</p>'
  }
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
function venueCardHtml(venue) {
  const primaryImage = venue.images?.[0]
  const hasImage = primaryImage?.url
  const capacityText = venue.capacity_max
    ? `${venue.capacity_min}–${venue.capacity_max} guests`
    : `${venue.capacity_min}+ guests`
  const priceText = venue.base_price ? `From ${formatPrice(venue.base_price)}` : 'Get a quote'

  return `
    <div class="venue-card" role="button" tabindex="0"
         data-venue-id="${venue.id}" aria-label="View ${escapeHtml(venue.name)}">
      <div class="venue-card-image">
        ${hasImage
          ? `<img src="${escapeHtml(primaryImage.url)}" alt="${escapeHtml(primaryImage.alt || venue.name)}" loading="lazy">`
          : `<div class="venue-card-placeholder"><span>${escapeHtml(venue.name)}</span></div>`}
        <span class="venue-type-badge ${venueTypeBadgeClass(venue.type)}">${escapeHtml(formatVenueType(venue.type))}</span>
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
    </div>
  `
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
    <section class="venue-section">
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

  // Custom type: skip detail page, go straight to booking form
  if (venue.type === 'custom') {
    const addOns = await loadVenueAddOns(venue.type)
    appState.currentVenueAddOns = addOns
    showBookingForm(venue)
    return
  }

  document.title = `${venue.name} — The Picnic Stories`
  if (pushState) {
    history.pushState({ venueId }, document.title, `/?venue=${venueId}`)
  }

  // Reset all calendar + guest state when navigating to a new venue
  appState.selectedDate     = null
  appState.selectedTimeSlot = null
  appState.checkinDate      = null
  appState.checkoutDate     = null
  appState.adults           = 2
  appState.children         = 0
  appState.bookingStep      = 'calendar'

  const needsCalendar = venue.type !== 'partner_bnb'
  const [addOns, bookedData] = await Promise.all([
    loadVenueAddOns(venue.type),
    needsCalendar ? fetchBookedData(venue.id, venue.type, venue.max_concurrent_setups || 1) : Promise.resolve(null),
  ])
  appState.currentVenueAddOns = addOns
  renderVenueDetail(venue, addOns)
  showPage('venue-detail-page')

  if (needsCalendar && bookedData) {
    renderAvailabilityCalendar('avail-calendar-widget', bookedData)
  }
}

// Go back to home — restore URL too
function navigateHome() {
  history.pushState({}, 'The Picnic Stories', '/')
  document.title = 'The Picnic Stories'
  showPage('home-page')
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
    ? `<div class="vd-cta-stack">
         <a href="${venue.external_url?.startsWith('https://') ? escapeHtml(venue.external_url) : '#'}" target="_blank" rel="noopener noreferrer"
            class="btn btn--venue-primary" ${!venue.external_url ? 'aria-disabled="true"' : ''}>
           Book on Airbnb
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
         </a>
         <button class="btn btn--venue-secondary" data-book-venue-id="${venue.id}">
           Already booked? Add picnic setup
         </button>
       </div>
       <p class="vd-hint">Book the property on Airbnb first, then add our picnic setup.</p>`
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
             <img class="vd-hero-img vd-hero-img--a is-visible" src="${heroImgUrl}" alt="${escapeHtml(venue.name)}">
             <img class="vd-hero-img vd-hero-img--b" alt="" aria-hidden="true">`
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

          <!-- Main content -->
          <div class="vd-main">

            <!-- Quick facts -->
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

            <div class="vd-mobile-select-dates">
              <button class="btn btn--venue-primary vd-mobile-select-dates-btn"
                      onclick="document.getElementById('avail-calendar-widget')?.scrollIntoView({ behavior: 'smooth', block: 'center' })">
                Select Dates
              </button>
            </div>

            ${venue.description ? `
            <div class="vd-section">
              <h2 class="vd-section-title">About this venue</h2>
              <p class="vd-description">${escapeHtml(venue.description)}</p>
            </div>
            <hr class="vd-divider">` : ''}

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

            <!-- What's included -->
            ${(() => {
              const meta = venue.metadata || {}
              const svgWrap = paths => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
              const hardcoded = [
                ...(venue.id === 15 ? [{ label: 'Whole 2BHK Apartment', icon: svgWrap('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>') }] : []),
                { label: 'Full picnic setup',       icon: '<span style="font-size:18px;line-height:1" aria-hidden="true">⛺</span>' },
                { label: 'Boho decor & lighting',   icon: svgWrap('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>') },
                { label: 'Setup & cleanup',          icon: svgWrap('<polyline points="20 6 9 17 4 12"/>') },
                { label: 'Dedicated host support',   icon: svgWrap('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6 19.79 19.79 0 0 1 1.61 5 2 2 0 0 1 3.6 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.6a16 16 0 0 0 6 6l.94-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 18z"/>') },
              ]
              const checkSvg = svgWrap('<polyline points="20 6 9 17 4 12"/>')
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
              </div>`
            })()}

          </div><!-- /vd-main -->

          <!-- Sticky booking sidebar -->
          <aside class="vd-sidebar">
            <div class="vd-booking-card">
              ${venue.base_price ? `
              <div class="vd-price-row">
                <span class="vd-price-amount" id="sidebar-price-amount">${escapeHtml(formatPrice(venue.base_price))}</span>
                <span class="vd-price-label" id="sidebar-price-label">starting price</span>
              </div>` : `
              <div class="vd-price-row">
                <span class="vd-price-amount" id="sidebar-price-amount">Custom</span>
                <span class="vd-price-label" id="sidebar-price-label">pricing on request</span>
              </div>`}
              <p class="vd-price-note">Final price confirmed after we review your requirements.</p>
              <div class="vd-card-divider"></div>
              ${ctaBlock}
              <ul class="vd-reassure">
                <li>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                  Instant confirmation on advance payment
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
               <span class="vd-mobile-book-label">${venue.base_price ? 'starting price' : 'price on request'}</span>
             </div>
             <a href="${venue.external_url?.startsWith('https://') ? escapeHtml(venue.external_url) : '#'}" target="_blank" rel="noopener noreferrer" class="btn btn--venue-primary">Book on Airbnb</a>`
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
      sliderTimer = setInterval(() => sliderGoTo(sliderIndex + 1), 4000)
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
}


// ----------------------------------------------------------------
// AVAILABILITY CALENDAR
// ----------------------------------------------------------------

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
    if (venueType === 'cafe') {
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
      <div class="vd-inclusion" id="vd-inclusion-line">${inclusionBannerHtml(venue, appState.adults)}</div>
    </div>
  `

  const sidebarBtn = document.getElementById('sidebar-book-btn')
  const mobileBtn  = document.getElementById('mobile-bar-book-btn')
  if (sidebarBtn) { sidebarBtn.disabled = false; sidebarBtn.textContent = 'Book Now' }
  if (mobileBtn)  { mobileBtn.disabled  = false; mobileBtn.textContent  = 'Book Now' }

  updateGuestPrice(venue)
}

// Restore the availability calendar (undo showGuestSelector)
function showCalendarStep() {
  appState.bookingStep = 'calendar'
  const venue  = appState.currentVenue
  const widget = document.getElementById('avail-calendar-widget')
  if (!widget || !venue) return

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

async function showBookingForm(venue) {
  appState.bookingStep  = 'booking'
  appState.currentVenue = venue
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
    addOns = await loadVenueAddOns(venue.type)
    appState.currentVenueAddOns = addOns
  }
  const picnicPrice = getPicnicPrice(venue, appState.adults)

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
  priceRows += `<div class="vd-bv-price-row"><span>${hasStay ? 'Stay + Picnic setup' : 'Picnic setup'}</span><span>₹${baseTotal.toLocaleString('en-IN')}</span></div>`
  priceRows += `<div id="bv-addon-price-rows"></div>`

  // Add-ons — grouped by category, each in a collapsible accordion
  const addonsByCategory = ADDON_CATEGORIES
    .map(cat => ({ cat, label: ADDON_CATEGORY_LABELS[cat], items: addOns.filter(a => a.category === cat) }))
    .filter(g => g.items.length)

  const addOnsHtml = addonsByCategory.length ? `
    <div class="vd-bf-section">
      <h3 class="vd-bf-section-title">Add to your experience</h3>
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
            <span class="venue-type-badge ${venueTypeBadgeClass(venue.type)}">${escapeHtml(formatVenueType(venue.type))}</span>
          </div>
          <div class="vd-bv-chips">${dateChips}${guestChips}</div>
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
                  <input class="vd-bf-input" type="tel" name="mobile-number" placeholder="+91 98765 43210" required>
                </div>
              </div>
              <div class="vd-bf-field">
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
              </div>
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

// Recompute price total when add-ons are toggled in the booking view
window.toggleAddonCat = function(btn) {
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

  // Update add-on rows in the price breakdown
  const addonRowsEl = document.getElementById('bv-addon-price-rows')
  if (addonRowsEl) {
    addonRowsEl.innerHTML = Array.from(document.querySelectorAll('.bv-addon-check:checked')).map(cb => {
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
    if (setupBase) {
      rows += `<div class="vd-bv-price-row"><span>${hasStay ? 'Stay + Picnic setup' : 'Picnic setup'}</span><span>₹${setupBase.toLocaleString('en-IN')}</span></div>`
    }
    for (const ao of addOns) {
      const name = appState.currentVenueAddOns?.find(a => a.id === ao.addon_id)?.name || 'Add-on'
      rows += `<div class="vd-bv-price-row"><span>${escapeHtml(name)}</span><span>+₹${Number(ao.price_at_booking).toLocaleString('en-IN')}</span></div>`
    }
    const fullTotal = lead.advance_amount * 2
    priceSection = `
      <div class="vd-bv-price-table">
        ${rows}
        <div class="vd-bv-price-divider"></div>
        <div class="vd-bv-price-row vd-bv-price-row--total">
          <span>Total</span>
          <span>₹${fullTotal.toLocaleString('en-IN')}</span>
        </div>
        <div class="vd-bv-price-row vd-bv-price-row--advance">
          <span>Advance due now <span class="vd-bv-price-tag">50%</span></span>
          <span>₹${lead.advance_amount.toLocaleString('en-IN')}</span>
        </div>
        <div class="vd-bv-price-row vd-bv-price-row--remaining">
          <span>Remaining due on the day</span>
          <span>₹${lead.advance_amount.toLocaleString('en-IN')}</span>
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
      <div class="vd-bv-chips">${chips.join('')}</div>
      ${priceSection}
    </div>`
}

// Step 1: collect form data → show intent screen (no DB write yet)
// Shared intent screen HTML builder — used by both inline and modal booking paths
function buildIntentScreenHTML(lead, { containerClass = 'vd-intent-wrap container' } = {}) {
  const totalFmt = lead.advance_amount.toLocaleString('en-IN')
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
            ${queryOnly ? '' : `
            <button class="vd-intent-btn vd-intent-btn--lock" onclick="submitBookingIntent(true)">
              <span class="vd-intent-btn-icon">🔒</span>
              <span class="vd-intent-btn-text">
                <span class="vd-intent-btn-title">${lead.advance_amount > 0 ? `Pay advance &amp; lock my date — ₹${totalFmt}` : 'Lock my date'}</span>
                <span class="vd-intent-btn-desc">${lead.advance_amount > 0 ? `Remaining ₹${totalFmt} due on the day · spot is reserved once payment clears` : 'Your spot is reserved the moment payment goes through'}</span>
              </span>
            </button>
            <div class="vd-intent-divider">or</div>`}
            <button class="vd-intent-btn vd-intent-btn--query" onclick="submitBookingIntent(false)">
              <span class="vd-intent-btn-icon">📞</span>
              <span class="vd-intent-btn-text">
                <span class="vd-intent-btn-title">${isCombo ? 'Request the whole floor' : requiresConfirmation ? 'Send a request' : 'I have questions — call me'}</span>
                <span class="vd-intent-btn-desc">${isCombo ? 'We\'ll check the floor is free and reach out to confirm' : requiresConfirmation ? 'We\'ll confirm availability and reach out to finalise' : 'We\'ll call you back within a few hours'}</span>
              </span>
            </button>
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
  if (venue.type === 'cafe' && appState.selectedTimeSlot) {
    lead.time_slot      = appState.selectedTimeSlot
    lead.advance_amount = Math.round((picnicPrice + addonSum) * 0.5)
  }
  if (venue.type === 'self_managed' && appState.checkinDate && appState.checkoutDate) {
    lead.checkout_date  = appState.checkoutDate
    lead.preferred_date = appState.checkinDate
    const nights        = calcNights(appState.checkinDate, appState.checkoutDate)
    lead.advance_amount = Math.round((nights * (Number(venue.metadata?.stay_price_per_night) || 0) + picnicPrice + addonSum) * 0.5)
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

  // Replace booking form with intent screen
  const bookView = document.getElementById('vd-booking-view')
  if (!bookView) return

  bookView.innerHTML = buildIntentScreenHTML(lead, { containerClass: 'vd-intent-wrap container' })
}

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
      p_confirmed:            wantsToLock,
      p_customer_intent:      wantsToLock ? 'lock' : 'query',
      p_venue_id:             lead.venue_id             ?? null,
      p_venue_address:        lead.venue_address        ?? null,
      p_checkout_date:        lead.checkout_date        ?? null,
      p_time_slot:            lead.time_slot            ?? null,
      p_external_booking_ref: lead.external_booking_ref ?? null,
      p_occasion:             lead.occasion ?? null,
      p_board:                lead.board    ?? null,
      p_children_count:       lead.children_count ?? 0,
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

    // Add-ons are now persisted inside the submit_booking_intent RPC (same
    // transaction as the booking) so they're committed before the insert-trigger
    // notification fires — the admin alert and confirmation email can include them.

    appState.currentBooking      = null
    appState.currentVenue        = null
    appState.currentVenueAddOns  = []
    appState.pendingLead         = null
    appState.pendingAddOns       = null

    const venueName = venue?.name || null

    const bv = document.getElementById('vd-booking-view')
    if (bv) bv.style.display = 'none'

    // Pass wantsToLock for display purposes only — not stored as confirmed
    renderSuccessPage({ booking: bookingRow, venueName, confirmed: wantsToLock })
    showPage('query-success-page')

  } catch (err) {
    console.error(err)
    showToast(err.message || 'Error submitting. Please try again.', 'error')
    document.querySelectorAll('.vd-intent-btn').forEach(b => { b.disabled = false })
    if (activeBtn) activeBtn.querySelector('.vd-intent-btn-title').textContent =
      wantsToLock ? `Lock my date — ₹${lead.advance_amount.toLocaleString('en-IN')}` : 'Just checking — call me'
  }
}

// ----------------------------------------------------------------
// BOOKING SUCCESS PAGE
// ----------------------------------------------------------------

function renderSuccessPage({ booking, venueName, confirmed = false }) {
  const container = document.getElementById('booking-success-content')
  if (!container) return

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

        <!-- Contact nudge -->
        <p class="bsc-contact-nudge">
          Questions? Call or WhatsApp us at
          <a href="tel:+919999999999">+91 99999-99999</a>
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
            <span>💰 ₹${Number(b.advance_amount || 0).toLocaleString('en-IN')} advance paid</span>
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
      .select('*, venues(name, type, area)')
      .eq('confirmed', false)
      .order('created_at', { ascending: false })

    if (error) throw error
    renderQueries(data)
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
      .select('*, venues(name, type, area)')
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

    const bookingsWithOrders = bookings.map(b => ({ ...b, orders: ordersByBooking[b.id] || [] }))

    renderBookings(bookingsWithOrders)
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
function renderQueries(queries) {
  const container = document.getElementById('queries-container')
  if (!container) return

  if (!queries || queries.length === 0) {
    container.innerHTML = `
      <div class="adm-empty">
        <div class="adm-empty-icon">📭</div>
        <h3>No queries yet</h3>
        <p>New customer queries will appear here.</p>
      </div>`
    return
  }

  container.innerHTML = queries.map(query => {
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
        <div class="adm-card-header-left">
          <span class="adm-status-dot adm-status-dot--new"></span>
          <span class="adm-name">${escapeHtml(query.full_name)}</span>
          <span class="adm-badge adm-badge--new">New</span>
        </div>
        <span class="adm-timestamp" title="${new Date(query.created_at).toLocaleString()}">${timeAgo}</span>
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
      ${airbnbHtml}

      ${isCombo ? `<div class="adm-floor-note">🏠 Whole floor = The Nook + The Gathering</div>` : ''}

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

// Occasion + celebration-board detail rows shared by query/booking cards
function occasionBoardHtml(b) {
  let html = ''
  if (b.occasion) {
    html += `<div class="adm-detail-row" style="margin-top:8px; font-size:13px;">🎉 <strong>Occasion:</strong> ${escapeHtml(b.occasion)}</div>`
  }
  if (b.board && (b.board.type || b.board.message)) {
    const type  = b.board.type ? b.board.type.charAt(0).toUpperCase() + b.board.type.slice(1) + ' board' : 'Board'
    const msg   = b.board.message ? ` — “${escapeHtml(b.board.message)}”` : ''
    html += `<div class="adm-detail-row" style="margin-top:8px; font-size:13px;">🪧 <strong>${escapeHtml(type)}:</strong>${msg}</div>`
  }
  return html
}

// Render bookings (confirmed bookings)
function renderBookings(bookings) {
  const container = document.getElementById('bookings-container')
  if (!container) return

  if (!bookings || bookings.length === 0) {
    container.innerHTML = `
      <div class="adm-empty">
        <div class="adm-empty-icon">🗓️</div>
        <h3>No confirmed bookings yet</h3>
        <p>Bookings confirmed with advance payment will appear here.</p>
      </div>`
    return
  }

  container.innerHTML = bookings.map(booking => {
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
        <div class="adm-card-header-left">
          <span class="adm-status-dot adm-status-dot--confirmed"></span>
          <span class="adm-name">${escapeHtml(booking.full_name)}</span>
          <span class="adm-badge adm-badge--confirmed">Confirmed</span>
        </div>
        <div class="adm-card-header-right">
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
  } else if (tabName === 'hero-image') {
    loadHeroImageAdminPreview()
  }
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
      .select('id, name, type, area, city, capacity_min, capacity_max, base_price, is_active, images, external_url, metadata, description, max_concurrent_setups, airbnb_ical_url, last_ical_sync_at, last_ical_sync_status, sort_order')
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

function openVenueForm(venueId) {
  const panel = document.getElementById('venue-form-panel')
  const title = document.getElementById('vfp-title')
  if (!panel) return

  if (venueId) {
    const venue = venueManagerState.venues.find(v => v.id === venueId)
    if (!venue) return
    venueManagerState.editingId = venueId
    title.textContent = 'Edit Venue'
    populateVenueForm(venue)
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
  document.getElementById('vf-rooms').value = 2
  document.getElementById('vf-bathrooms').value = 2
  document.getElementById('vf-stay-price').value = 0
  document.getElementById('vf-includes').value = ''
  document.getElementById('vf-amenities').value = ''
  document.getElementById('vf-highlights').value = ''
  document.getElementById('vf-ideal-for').value = ''
  document.getElementById('vf-active').checked = true
  document.getElementById('vf-requires-confirmation').checked = false
  renderVfImages([])
  renderVfTiers([{ up_to: 2, price: 9900 }, { up_to: 4, price: 12900 }, { up_to: 6, price: 15900 }, { up_to: 8, price: 18900 }])
  updateVfTypeVisibility('cafe')
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

  const meta = venue.metadata || {}
  renderVfImages(Array.isArray(venue.images) ? venue.images : (venue.images ? JSON.parse(venue.images) : []))
  renderVfTiers(meta.tiers || [])
  document.getElementById('vf-overage').value = meta.overage_per_person || 2000

  // BnB fields
  document.getElementById('vf-rooms').value = meta.rooms || 2
  document.getElementById('vf-bathrooms').value = meta.bathrooms || 2
  document.getElementById('vf-stay-price').value = meta.stay_price_per_night || 0
  document.getElementById('vf-includes').value = (meta.includes || []).join(', ')
  document.getElementById('vf-amenities').value = (meta.amenities || []).join(', ')
  document.getElementById('vf-highlights').value = (meta.highlights || []).join(', ')
  document.getElementById('vf-ideal-for').value = (meta.ideal_for || []).join(', ')
  document.getElementById('vf-airbnb-ical-url').value = venue.airbnb_ical_url || ''

  updateVfTypeVisibility(venue.type)
}

function updateVfTypeVisibility(type) {
  const partnerOnly = document.querySelectorAll('.vf-partner-only')
  const bnbSection = document.getElementById('vf-bnb-section')
  partnerOnly.forEach(el => { el.style.display = type === 'partner_bnb' ? '' : 'none' })
  if (bnbSection) bnbSection.style.display = type === 'self_managed' ? '' : 'none'
}

function renderVfImages(images) {
  const list = document.getElementById('vf-images-list')
  if (!list) return
  list.innerHTML = images.map((img, i) => `
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
      </div>
      <div class="vf-img-fields">
        <label class="vf-img-upload-btn">
          ${img.url ? '↺ Replace photo' : '↑ Upload photo'}
          <input type="file" class="vf-img-file" accept="image/jpeg,image/png,image/webp"
                 onchange="handleVfImageUpload(this, ${i})" style="display:none" />
        </label>
        <input type="hidden" class="vf-img-url" value="${escapeHtml(img.url || '')}" />
        <input type="text" class="vf-input vf-img-alt" placeholder="Alt text / caption" value="${escapeHtml(img.alt || '')}" />
      </div>
      <button type="button" class="vf-remove-btn" onclick="removeVfImage(${i})">✕</button>
    </div>
  `).join('')

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
    const wrap = row.querySelector('.vf-img-preview-wrap')
    wrap.innerHTML = `<img class="vf-img-thumb" src="${publicUrl}" alt="" />`
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
    alt: row.querySelector('.vf-img-alt').value.trim()
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

  const images = readVfImages().filter(img => img.url)
  const tiers = readVfTiers().sort((a, b) => a.up_to - b.up_to) // ensure ascending order for getVenuePrice()
  const overage = parseInt(document.getElementById('vf-overage').value, 10) || 2000

  const splitCsv = id => document.getElementById(id).value.split(',').map(s => s.trim()).filter(Boolean)
  let metadata = { tiers, overage_per_person: overage, includes: splitCsv('vf-includes') }

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
    external_url: document.getElementById('vf-external-url').value.trim() || null,
    maps_url: document.getElementById('vf-maps-url').value.trim() || null,
    airbnb_ical_url: document.getElementById('vf-airbnb-ical-url').value.trim() || null,
    is_active: document.getElementById('vf-active').checked,
    requires_confirmation: document.getElementById('vf-requires-confirmation').checked,
    max_concurrent_setups: parseInt(document.getElementById('vf-max-setups').value, 10) || 1,
    images: images,
    metadata
  }

  try {
    let error
    if (id) {
      ;({ error } = await supabase.from('venues').update(payload).eq('id', parseInt(id, 10)))
    } else {
      ;({ error } = await supabase.from('venues').insert([payload]))
    }
    if (error) throw error
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

// Render the Airbnb iCal sync panel (self_managed venues only): a copyable
// export URL to paste into Airbnb, last-sync status, and a manual "Sync now".
function renderAvailIcalPanel(venue) {
  const panel = document.getElementById('avail-ical-panel')
  if (!panel) return
  if (!venue || venue.type !== 'self_managed') { panel.hidden = true; panel.innerHTML = ''; return }

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

// ── Hero image: load from site_settings on startup ───────────
async function loadHeroImage() {
  try {
    const { data } = await supabase
      .from('site_settings')
      .select('key, value')
      .in('key', ['hero_image_url', 'hero_image_mobile_url', 'hero_image_mobile_position'])

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
      .in('key', ['hero_image_url', 'hero_image_mobile_url', 'hero_image_mobile_position'])

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


// ── Global function exports (required for inline onclick handlers) ────
window.navigateHome               = navigateHome
window.handleNavigation           = handleNavigation
window.showPage                   = showPage
window.showMyBookingsPage         = showMyBookingsPage
window.showVenuePage              = showVenuePage
window.selectTimeSlot             = selectTimeSlot
window.showCalendarStep           = showCalendarStep
window.updateGuestCount           = updateGuestCount
window.showVenueBodyStep          = showVenueBodyStep
window.updateBookingSummaryPrice  = updateBookingSummaryPrice
window.handleInlineBookingSubmit  = handleInlineBookingSubmit
window.submitBookingIntent        = submitBookingIntent
window.showModal                  = showModal
window.hideModal                  = hideModal
window.sendOtpResend              = sendOtpResend
window.copyMenuLink               = copyMenuLink
window.customerSignOut            = customerSignOut

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
  if (event.state?.venueId) {
    showVenuePage(event.state.venueId, false)
  } else {
    showPage('home-page')
  }
})


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

  // ---- Public homepage only ----
  // admin.html has no #home-page, so skip all the storefront initialisers
  // (and their Supabase calls) below to avoid needless work and console noise.
  if (!document.getElementById('home-page')) return

  initializeMenuPreview()
  handleMenuPreviewTabs()
  renderAddonsStrip()
  initMenuSelectionPage()

  // URL parameter routing
  const urlParams = new URLSearchParams(window.location.search)
  const menuToken = urlParams.get('menu')
  const bookingId = urlParams.get('booking')
  const venueId   = urlParams.get('venue')
  const view      = urlParams.get('view')

  if (menuToken) {
    showPage('menu-selection-page')
    loadMenuSelection(menuToken)
    if (bookingId) appState.currentBooking = { id: parseInt(bookingId, 10) }
  } else if (venueId) {
    loadVenues().then(() => showVenuePage(parseInt(venueId, 10), false))
  } else if (view === 'mybookings') {
    showMyBookingsPage()
  }

  // Venue card click delegation
  const venuesGrid = document.getElementById('venues-grid')
  if (venuesGrid) {
    venuesGrid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-venue-id]')
      if (!card) return
      const id = parseInt(card.dataset.venueId, 10)
      if (!isNaN(id)) showVenuePage(id)
    })
    venuesGrid.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const card = e.target.closest('[data-venue-id]')
      if (!card) return
      const id = parseInt(card.dataset.venueId, 10)
      if (!isNaN(id)) showVenuePage(id)
    })
  }

  // Sidebar / mobile "Select guests →" and "Book Now" button
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#sidebar-book-btn, #mobile-bar-book-btn')
    if (!btn || btn.disabled) return
    const venueId = parseInt(btn.dataset.bookVenueId, 10)
    if (isNaN(venueId)) return
    const venue = appState.venues.find(v => v.id === venueId)
    if (venue) {
      if (appState.bookingStep === 'guests') showBookingForm(venue)
      else showGuestSelector(venue)
    }
  })

  loadVenues()
  loadHeroImage()
  loadTestimonials()
})
