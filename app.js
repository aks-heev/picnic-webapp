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
  children: 0,               // guest selector: child count (under 10, 0.5× rate)
  bookingStep: 'calendar',   // 'calendar' | 'guests'
  intentFromModal: false,    // true when intent screen was triggered from the booking modal
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

// Billing guest count — children (under 10) count at 0.5×
function calcBillingGuests(adults, children) {
  return adults + Math.ceil((children || 0) * 0.5)
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

function updateNavbarState(pageId) {
  const navbar = document.querySelector('.navbar')
  if (!navbar) return
  const isHome = !pageId || pageId === 'home-page'
  if (isHome) {
    // Transparent when at top of home, solid when scrolled
    const scrolled = window.scrollY > 40
    navbar.classList.toggle('navbar--solid', scrolled)
  } else {
    navbar.classList.add('navbar--solid')
  }
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
      .order('id', { ascending: true })

    if (error) throw error
    appState.venues = data || []
    renderVenueGallery(data || [])
  } catch (error) {
    console.error('Failed to load venues:', error)
    const grid = document.getElementById('venues-grid')
    if (grid) grid.innerHTML = '<p class="venues-error">Unable to load venues. Please refresh the page.</p>'
  }
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

    // One featured add-on per category (first by sort_order)
    const seen = new Set()
    const featured = (data || []).filter(a => {
      if (seen.has(a.category)) return false
      seen.add(a.category)
      return true
    })

    if (!featured.length) return

    strip.innerHTML = featured.map(a => `
      <div class="addon-strip-card">
        <div class="addon-strip-visual">
          ${a.image_url
            ? `<img src="${escapeHtml(a.image_url)}" alt="${escapeHtml(a.name)}" class="addon-strip-img">`
            : `<span class="addon-strip-emoji">${ADDON_CAT_EMOJI[a.category] || '✨'}</span>`}
        </div>
        <div class="addon-strip-info">
          <span class="addon-strip-name">${escapeHtml(a.name)}</span>
          ${a.description ? `<span class="addon-strip-desc">${escapeHtml(a.description)}</span>` : ''}
        </div>
      </div>
    `).join('')
  } catch (err) {
    console.error('Failed to load add-ons strip:', err)
  }
}

// Render venue cards into the gallery grid
function renderVenueGallery(venues) {
  const grid = document.getElementById('venues-grid')
  if (!grid) return

  if (venues.length === 0) {
    grid.innerHTML = '<p class="venues-empty">No venues available at the moment. Check back soon!</p>'
    return
  }

  grid.innerHTML = venues.map(venue => {
    const primaryImage = venue.images?.[0]
    const hasImage = primaryImage?.url
    const capacityText = venue.capacity_max
      ? `${venue.capacity_min}–${venue.capacity_max} guests`
      : `${venue.capacity_min}+ guests`
    const priceText = venue.base_price ? `From ${formatPrice(venue.base_price)}` : 'Get a quote'

    if (venue.type === 'custom') {
      return `
        <div class="venue-card venue-card--custom" role="button" tabindex="0"
             data-venue-id="${venue.id}" aria-label="Book your own venue">
          <div class="venue-card-image venue-card-image--custom">
            <div class="venue-custom-pattern" aria-hidden="true">
              <span class="venue-custom-icon">✦</span>
            </div>
            <span class="venue-type-badge ${venueTypeBadgeClass(venue.type)}">${escapeHtml(formatVenueType(venue.type))}</span>
          </div>
          <div class="venue-card-body">
            <h3 class="venue-card-name">${escapeHtml(venue.name)}</h3>
            <p class="venue-card-area">Anywhere in Jaipur</p>
            <div class="venue-card-footer">
              <span class="venue-card-capacity">${capacityText}</span>
              <span class="venue-card-price">${priceText}</span>
            </div>
          </div>
        </div>
      `
    }

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
          <p class="venue-card-area">${escapeHtml(venue.area || venue.city)}</p>
          <div class="venue-card-footer">
            <span class="venue-card-capacity">${capacityText}</span>
            <span class="venue-card-price">${priceText}</span>
          </div>
        </div>
      </div>
    `
  }).join('')
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
    openBookingForVenue(venue)
    return
  }

  document.title = `${venue.name} — The Picnic Story`
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
    needsCalendar ? fetchBookedData(venue.id, venue.type) : Promise.resolve(null),
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
  history.pushState({}, 'The Picnic Story', '/')
  document.title = 'The Picnic Story'
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
  const galleryImgs = allImages.slice(0, 5)

  const heroBg = hasImage
    ? `background-image: url('${escapeHtml(primaryImage.url)}')`
    : `background: linear-gradient(150deg, #f0d8e0 0%, #e2c9d4 100%)`

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
      <div class="vd-hero" style="${heroBg}">
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
              <div class="vd-property-amenities">
                ${amenities.map(a => `<span class="vd-amenity-pill">${escapeHtml(a)}</span>`).join('')}
              </div>` : ''}
              ${idealFor.length ? `
              <div class="vd-property-ideal">
                <span class="vd-property-ideal-label">Ideal for</span>
                ${idealFor.map(t => `<span class="vd-ideal-tag">${escapeHtml(t)}</span>`).join('')}
              </div>` : ''}
            </div>
            <hr class="vd-divider">`
            })()}

            <!-- What's included -->
            <div class="vd-section">
              <h2 class="vd-section-title">What's included</h2>
              <div class="vd-includes">
                <div class="vd-include-item">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                  <span>Full picnic setup</span>
                </div>
                <div class="vd-include-item">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
                  <span>Curated menu</span>
                </div>
                <div class="vd-include-item">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  <span>Boho decor &amp; lighting</span>
                </div>
                <div class="vd-include-item">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>Setup &amp; cleanup</span>
                </div>
                <div class="vd-include-item">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span>2–3 hour experience</span>
                </div>
                <div class="vd-include-item">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6 19.79 19.79 0 0 1 1.61 5 2 2 0 0 1 3.6 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.6a16 16 0 0 0 6 6l.94-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 18z"/></svg>
                  <span>Dedicated host support</span>
                </div>
              </div>
            </div>

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
                  Free cancellation up to 48h before
                </li>
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

  // Wire gallery thumbnail clicks — swap hero background
  container.querySelectorAll('.vd-gallery-thumb').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.imgUrl
      if (!url) return
      const hero = container.querySelector('.vd-hero')
      if (hero) hero.style.backgroundImage = `url('${url}')`
      container.querySelectorAll('.vd-gallery-thumb').forEach(b => b.classList.remove('vd-gallery-thumb--active'))
      btn.classList.add('vd-gallery-thumb--active')
    })
  })
}

// Open the booking modal pre-configured for a venue
function openBookingForVenue(venue) {
  appState.currentVenue = venue
  resetBookingModalForVenue(venue)
  // Pre-fill dates from calendar selection
  const dateInput = document.getElementById('preferred-date')
  if (dateInput) {
    if (venue.type === 'self_managed' && appState.checkinDate) {
      dateInput.value = appState.checkinDate
    } else if (appState.selectedDate) {
      dateInput.value = appState.selectedDate
    }
  }
  updateAdvanceButton()
  showModal('booking-modal')
}

// Show/hide booking modal fields based on venue type
function resetBookingModalForVenue(venue) {
  const venueDisplayGroup  = document.getElementById('venue-display-group')
  const venueAddressGroup  = document.getElementById('venue-address-group')
  const airbnbRefGroup     = document.getElementById('airbnb-ref-group')
  const venueDisplay       = document.getElementById('venue-selected-display')
  const venueAddressField  = document.getElementById('venue-address')
  const venueAddressLabel  = document.getElementById('venue-address-label')
  const dateGroup          = document.getElementById('preferred-date-group')
  const bnbDatesGroup      = document.getElementById('bnb-dates-group')
  const bnbDatesDisplay    = document.getElementById('bnb-dates-display')
  const dateInput          = document.getElementById('preferred-date')

  // BnB: hide date picker, show stay summary instead
  const isBnB = venue?.type === 'self_managed' || venue?.type === 'partner_bnb'
  if (dateGroup)     dateGroup.style.display     = isBnB ? 'none' : ''
  if (bnbDatesGroup) bnbDatesGroup.style.display  = isBnB ? ''     : 'none'
  if (dateInput)     dateInput.required           = !isBnB

  if (isBnB && bnbDatesDisplay && appState.checkinDate && appState.checkoutDate) {
    const nights = calcNights(appState.checkinDate, appState.checkoutDate)
    bnbDatesDisplay.innerHTML = `
      <span class="bnb-date-chip">🛬 Check-in &nbsp;<strong>${formatSelectedDate(appState.checkinDate)}</strong></span>
      <span class="bnb-date-chip">🛫 Checkout &nbsp;<strong>${formatSelectedDate(appState.checkoutDate)}</strong></span>
      <span class="bnb-nights-chip">${nights} night${nights > 1 ? 's' : ''}</span>
    `
  }

  if (!venue) {
    // No venue — free-text address, no Airbnb ref
    if (venueDisplayGroup) venueDisplayGroup.style.display = 'none'
    if (venueAddressGroup) venueAddressGroup.style.display = 'block'
    if (airbnbRefGroup)    airbnbRefGroup.style.display    = 'none'
    if (venueAddressField) venueAddressField.required = true
    if (venueAddressLabel) venueAddressLabel.textContent = 'Venue / Location *'
    return
  }

  // Populate the selected-venue display card
  if (venueDisplay) {
    venueDisplay.innerHTML = `
      <div class="venue-selected-info">
        <strong>${escapeHtml(venue.name)}</strong>
        <span class="venue-type-tag ${venueTypeBadgeClass(venue.type)}">${escapeHtml(formatVenueType(venue.type))}</span>
        ${venue.area ? `<span class="venue-selected-area">${escapeHtml(venue.area)}</span>` : ''}
      </div>
    `
  }

  if (venue.type === 'custom') {
    if (venueDisplayGroup) venueDisplayGroup.style.display = 'none'
    if (venueAddressGroup) venueAddressGroup.style.display = 'block'
    if (airbnbRefGroup)    airbnbRefGroup.style.display    = 'none'
    if (venueAddressField) venueAddressField.required = true
    if (venueAddressLabel) venueAddressLabel.textContent = 'Your venue address / description *'
  } else if (venue.type === 'partner_bnb') {
    if (venueDisplayGroup) venueDisplayGroup.style.display = 'block'
    if (venueAddressGroup) venueAddressGroup.style.display = 'none'
    if (airbnbRefGroup)    airbnbRefGroup.style.display    = 'block'
    if (venueAddressField) venueAddressField.required = false
  } else {
    // self_managed or cafe — show venue card, no address, no airbnb ref
    if (venueDisplayGroup) venueDisplayGroup.style.display = 'block'
    if (venueAddressGroup) venueAddressGroup.style.display = 'none'
    if (airbnbRefGroup)    airbnbRefGroup.style.display    = 'none'
    if (venueAddressField) venueAddressField.required = false
  }

  // Inject extra add-ons for this venue
  const extraAddOns = (appState.currentVenueAddOns || []).filter(a => a.category === 'extra')
  injectBookingAddOns(extraAddOns, venue?.base_price)
}

// Inject extra add-ons into the booking modal
function injectBookingAddOns(extraAddOns, basePrice) {
  const section  = document.getElementById('booking-addons-section')
  const list     = document.getElementById('booking-addons-list')
  const totalRow = document.getElementById('bk-total-row')

  if (!section || !list) return

  if (!extraAddOns.length) {
    section.style.display = 'none'
    return
  }

  section.style.display = 'block'
  list.innerHTML = extraAddOns.map(a => {
    const venueType = appState.currentVenue?.type || ''
    const needsConfirm = a.requires_confirmation_for?.includes(venueType)
    return `
      <label class="bk-addon-toggle">
        <input type="checkbox" class="bk-addon-checkbox"
               data-addon-id="${a.id}"
               data-addon-name="${escapeHtml(a.name)}"
               data-addon-price="${a.price}"
               data-addon-confirm="${needsConfirm}"
               onchange="updateAddOnTotal()">
        <span class="bk-addon-info">
          <span class="bk-addon-name">${escapeHtml(a.name)}</span>
          ${needsConfirm ? `<span class="bk-addon-note">Subject to availability</span>` : ''}
        </span>
        <span class="bk-addon-price">+₹${Number(a.price).toLocaleString('en-IN')}</span>
      </label>`
  }).join('')

  if (totalRow) {
    totalRow.style.display = basePrice ? 'flex' : 'none'
    if (basePrice) updateAddOnTotal()
  }
}

// Recalculate and display the running total
function updateAddOnTotal() {
  const venue      = appState.currentVenue
  const basePrice  = venue?.base_price || 0
  const totalEl    = document.getElementById('bk-total-amount')
  const totalRow   = document.getElementById('bk-total-row')

  const addonSum = Array.from(document.querySelectorAll('.bk-addon-checkbox:checked'))
    .reduce((sum, cb) => sum + Number(cb.dataset.addonPrice), 0)

  if (totalEl && basePrice) {
    totalEl.textContent = '₹' + (basePrice + addonSum).toLocaleString('en-IN')
    if (totalRow) totalRow.style.display = 'flex'
  }

  updateAdvanceButton()
}

// ----------------------------------------------------------------
// AVAILABILITY CALENDAR
// ----------------------------------------------------------------

const CAFE_SLOTS = [
  { key: 'morning',   label: 'Morning',   time: '9 AM – 12 PM',  icon: '🌅' },
  { key: 'afternoon', label: 'Afternoon', time: '1 PM – 4 PM',   icon: '☀️' },
  { key: 'evening',   label: 'Evening',   time: '5 PM – 8 PM',   icon: '🌙' },
]

// Fetch booked data — type-aware (cafe returns slotMap, BnB returns blocked date set)
async function fetchBookedData(venueId, venueType) {
  try {
    if (venueType === 'cafe') {
      // Café: slot-level bookings from SECURITY DEFINER RPC (no anon RLS issue)
      //       + admin-blocked full days from venue_availability
      const [slotsResult, adminResult] = await Promise.all([
        supabase.rpc('get_cafe_booked_slots', { p_venue_id: venueId }),
        supabase.from('venue_availability').select('date').eq('venue_id', venueId).eq('source', 'admin'),
      ])
      if (slotsResult.error) throw slotsResult.error

      const slotMap = new Map()
      // Confirmed slot bookings
      for (const b of slotsResult.data || []) {
        const d = typeof b.preferred_date === 'string' ? b.preferred_date : localDateStr(new Date(b.preferred_date))
        if (!slotMap.has(d)) slotMap.set(d, new Set())
        if (b.time_slot) slotMap.get(d).add(b.time_slot)
      }
      // Admin-blocked days → mark all slots as taken so the date shows fully booked
      for (const r of adminResult.data || []) {
        slotMap.set(r.date, new Set(CAFE_SLOTS.map(s => s.key)))
      }

      return { venueType: 'cafe', slotMap }
    } else {
      // BnB: single query on venue_availability — both admin blocks and confirmed bookings live here
      const { data, error } = await supabase
        .from('venue_availability')
        .select('date')
        .eq('venue_id', venueId)
      if (error) throw error

      const blockedDates = new Set((data || []).map(r => r.date))
      return { venueType: 'self_managed', blockedDates }
    }
  } catch (err) {
    console.error('Failed to fetch booked data:', err)
    return { venueType, slotMap: new Map(), blockedDates: new Set() }
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

  let html = DOW.map(d => `<span class="avail-cal-dow">${d}</span>`).join('')
  for (let i = 0; i < firstDow; i++) html += `<span class="avail-cal-empty"></span>`

  for (let d = 1; d <= totalDays; d++) {
    const date    = new Date(year, month, d); date.setHours(0, 0, 0, 0)
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isPast  = date < today
    const isToday = date.getTime() === today.getTime()

    let isFullyBooked = false
    if (isCafe) {
      const booked = bookedData.slotMap?.get(dateStr)
      isFullyBooked = booked ? booked.size >= CAFE_SLOTS.length : false
    } else {
      isFullyBooked = bookedData.blockedDates?.has(dateStr) ?? false
    }

    const isDisabled = isPast || isFullyBooked
    const isSelected  = isCafe && appState.selectedDate === dateStr
    const isCheckin   = !isCafe && appState.checkinDate === dateStr
    const isCheckout  = !isCafe && appState.checkoutDate === dateStr
    const isInRange   = !isCafe && appState.checkinDate && appState.checkoutDate &&
      dateStr > appState.checkinDate && dateStr < appState.checkoutDate

    const cls = [
      'avail-cal-day',
      isPast        ? 'avail-cal-day--past'     : '',
      isFullyBooked ? 'avail-cal-day--booked'   : '',
      isToday       ? 'avail-cal-day--today'    : '',
      isSelected    ? 'avail-cal-day--selected' : '',
      isCheckin     ? 'avail-cal-day--checkin'  : '',
      isCheckout    ? 'avail-cal-day--checkout' : '',
      isInRange     ? 'avail-cal-day--in-range' : '',
      !isDisabled   ? 'avail-cal-day--available': '',
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
    const btn = e.target.closest('.avail-cal-day--available')
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
    updateBnbCalendarHighlight()
    updateBnbBarState()
    return
  }
  if (dateStr <= appState.checkinDate) {
    appState.checkinDate  = dateStr
    appState.checkoutDate = null
    updateBnbCalendarHighlight()
    updateBnbBarState()
    return
  }

  // Check that no date in the selected range (checkin inclusive → checkout exclusive) is blocked/booked
  const calWidget  = document.getElementById('avail-calendar-widget')
  const bookedData = calWidget?._bookedData
  if (bookedData?.blockedDates) {
    const start = new Date(appState.checkinDate + 'T00:00:00')
    const end   = new Date(dateStr + 'T00:00:00')
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      if (bookedData.blockedDates.has(localDateStr(d))) {
        showToast('Your selected range includes a booked or blocked date. Please pick different dates.', 'error')
        // Reset to re-pick checkin
        appState.checkinDate  = null
        appState.checkoutDate = null
        updateBnbCalendarHighlight()
        updateBnbBarState()
        return
      }
    }
  }

  appState.checkoutDate = dateStr
  updateBnbCalendarHighlight()
  const checkinInput = document.getElementById('preferred-date')
  if (checkinInput) checkinInput.value = appState.checkinDate
  updateBnbBarState()
  updateAdvanceButton()
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
  const bookedData = calWidget?._bookedData || { slotMap: new Map() }
  const bookedForDate = bookedData.slotMap?.get(dateStr) || new Set()
  const formatted  = formatSelectedDate(dateStr)

  container.innerHTML = `
    <div class="avail-slot-picker">
      <p class="avail-slot-label">Pick a time slot for <strong>${formatted}</strong></p>
      <div class="avail-slot-grid">
        ${CAFE_SLOTS.map(slot => {
          const isBooked   = bookedForDate.has(slot.key)
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
  updateAdvanceButton()
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
function updateAdvanceButton() {
  const btn   = document.getElementById('booking-submit-btn')
  const venue = appState.currentVenue
  if (!btn || !venue) return

  const addonSum      = Array.from(document.querySelectorAll('.bk-addon-checkbox:checked'))
    .reduce((sum, cb) => sum + Number(cb.dataset.addonPrice), 0)
  const billingGuests = calcBillingGuests(appState.adults, appState.children)
  const picnicPrice   = getVenuePrice(venue, billingGuests)

  if (venue.type === 'self_managed' && appState.checkinDate && appState.checkoutDate) {
    const nights    = calcNights(appState.checkinDate, appState.checkoutDate)
    const stayTotal = nights * (Number(venue.metadata?.stay_price_per_night) || 0)
    const total     = stayTotal + picnicPrice + addonSum
    btn.textContent = total > 0
      ? `Pay Advance — ₹${total.toLocaleString('en-IN')} · ${nights} night${nights > 1 ? 's' : ''}`
      : 'Pay Advance'
    return
  }

  if (!picnicPrice && !addonSum) { btn.textContent = 'Pay Advance'; return }
  btn.textContent = `Pay Advance — ₹${(picnicPrice + addonSum).toLocaleString('en-IN')}`
}

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
      <button class="vd-guest-back" onclick="showCalendarStep()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        ${dateSummary || 'Change date'}
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
            <span class="vd-guest-sublabel">Under 10 · half rate</span>
          </div>
          <div class="vd-guest-counter">
            <button class="vd-guest-btn" onclick="updateGuestCount('children',-1)" ${appState.children <= 0 ? 'disabled' : ''} aria-label="Remove child">−</button>
            <span class="vd-guest-count" id="children-count">${appState.children}</span>
            <button class="vd-guest-btn" onclick="updateGuestCount('children',1)" ${totalGuests >= maxGuests ? 'disabled' : ''} aria-label="Add child">+</button>
          </div>
        </div>
      </div>
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

  const billingGuests = calcBillingGuests(appState.adults, appState.children)
  const picnicPrice   = getVenuePrice(venue, billingGuests)

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
  updateAdvanceButton()
}

// ----------------------------------------------------------------
// BOOKING VIEW (inline — replaces vd-body, no modal)
// ----------------------------------------------------------------

function showBookingForm(venue) {
  appState.bookingStep  = 'booking'
  appState.currentVenue = venue
  const body      = document.getElementById('vd-body')
  const bookView  = document.getElementById('vd-booking-view')
  const mobileBar = document.querySelector('.vd-mobile-book-bar')
  const backBtn   = document.getElementById('vd-hero-back')
  if (!body || !bookView) return

  const addOns        = appState.currentVenueAddOns
  const billingGuests = calcBillingGuests(appState.adults, appState.children)
  const picnicPrice   = getVenuePrice(venue, billingGuests)

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
  if (venue.type === 'self_managed' && appState.checkinDate && appState.checkoutDate) {
    const nights    = calcNights(appState.checkinDate, appState.checkoutDate)
    const stayTotal = nights * (Number(venue.metadata?.stay_price_per_night) || 0)
    baseTotal += stayTotal
    priceRows += `<div class="vd-bv-price-row"><span>Stay · ${nights} night${nights !== 1 ? 's' : ''}</span><span>₹${stayTotal.toLocaleString('en-IN')}</span></div>`
  }
  priceRows += `<div class="vd-bv-price-row"><span>Picnic · ${guestLabel}</span><span>₹${picnicPrice.toLocaleString('en-IN')}</span></div>`
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
          <div class="vd-bv-price-table">
            ${priceRows}
            <div class="vd-bv-price-divider"></div>
            <div class="vd-bv-price-row vd-bv-price-row--total">
              <span>Advance payment</span>
              <span id="bv-total-price">₹${baseTotal.toLocaleString('en-IN')}</span>
            </div>
          </div>
          <p class="vd-bv-note">Free cancellation up to 48h before. Final total confirmed after we review your requirements.</p>
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
                <label class="vd-bf-label">Special requests</label>
                <textarea class="vd-bf-input vd-bf-textarea" name="special-requirements" placeholder="Occasion, allergies, anything we should know…" rows="3"></textarea>
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

  const billingGuests = calcBillingGuests(appState.adults, appState.children)
  const picnicPrice   = getVenuePrice(venue, billingGuests)
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
    chips.push(`<span class="vd-bv-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>${lead.guest_count} guest${lead.guest_count !== 1 ? 's' : ''}</span>`)
  }

  // Price rows — only if there's a price to show
  let priceSection = ''
  if (lead.advance_amount > 0 && venue) {
    const billingGuests = calcBillingGuests(appState.adults, appState.children)
    const picnicPrice   = getVenuePrice(venue, billingGuests)
    let rows = ''
    if (venue.type === 'self_managed' && lead.checkout_date) {
      const nights    = calcNights(lead.preferred_date, lead.checkout_date)
      const stayPrice = nights * (Number(venue.metadata?.stay_price_per_night) || 0)
      rows += `<div class="vd-bv-price-row"><span>Stay · ${nights} night${nights !== 1 ? 's' : ''}</span><span>₹${stayPrice.toLocaleString('en-IN')}</span></div>`
    }
    if (picnicPrice) {
      const guestLabel = `${billingGuests} guest${billingGuests !== 1 ? 's' : ''}`
      rows += `<div class="vd-bv-price-row"><span>Picnic · ${guestLabel}</span><span>₹${picnicPrice.toLocaleString('en-IN')}</span></div>`
    }
    for (const ao of addOns) {
      const name = appState.currentVenueAddOns?.find(a => a.id === ao.addon_id)?.name || 'Add-on'
      rows += `<div class="vd-bv-price-row"><span>${escapeHtml(name)}</span><span>+₹${Number(ao.price_at_booking).toLocaleString('en-IN')}</span></div>`
    }
    priceSection = `
      <div class="vd-bv-price-table">
        ${rows}
        <div class="vd-bv-price-divider"></div>
        <div class="vd-bv-price-row vd-bv-price-row--total">
          <span>Advance</span>
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
  return `
    <div class="${containerClass}">
      <div class="vd-intent-card">
        <div class="vd-intent-body">
          <div class="vd-intent-icon">🧺</div>
          <h2 class="vd-intent-heading">You're almost in!</h2>
          <p class="vd-intent-sub">How would you like to proceed?</p>

          ${buildIntentSummaryHTML()}

          <div class="vd-intent-options">
            <button class="vd-intent-btn vd-intent-btn--lock" onclick="submitBookingIntent(true)">
              <span class="vd-intent-btn-icon">🔒</span>
              <span class="vd-intent-btn-text">
                <span class="vd-intent-btn-title">${lead.advance_amount > 0 ? `Lock my date — ₹${totalFmt}` : 'Lock my date'}</span>
                <span class="vd-intent-btn-desc">Pay the advance now and your spot is secured</span>
              </span>
            </button>
            <div class="vd-intent-divider">or</div>
            <button class="vd-intent-btn vd-intent-btn--query" onclick="submitBookingIntent(false)">
              <span class="vd-intent-btn-icon">📞</span>
              <span class="vd-intent-btn-text">
                <span class="vd-intent-btn-title">Just checking — call me</span>
                <span class="vd-intent-btn-desc">Drop a query and we'll reach out to confirm</span>
              </span>
            </button>
          </div>

          <p class="vd-intent-note">We'll hold the date for 24 hours while you decide.</p>
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

  const billingGuests = calcBillingGuests(appState.adults, appState.children)
  const picnicPrice   = getVenuePrice(venue, billingGuests)
  const addonSum      = Array.from(document.querySelectorAll('.bv-addon-check:checked'))
    .reduce((s, cb) => s + Number(cb.dataset.addonPrice), 0)

  // Build the pending lead (no confirmed flag yet)
  const lead = {
    full_name:            form['full-name'].value.trim(),
    mobile_number:        form['mobile-number'].value.trim(),
    email_address:        form['email-address'].value.trim(),
    guest_count:          appState.adults + appState.children,
    preferred_date:       appState.selectedDate || appState.checkinDate || '',
    special_requirements: form['special-requirements'].value.trim(),
    advance_amount:       0,
    created_at:           new Date().toISOString(),
  }
  if (venue.type !== 'custom') lead.venue_id = venue.id
  if (venue.type === 'cafe' && appState.selectedTimeSlot) {
    lead.time_slot      = appState.selectedTimeSlot
    lead.advance_amount = picnicPrice + addonSum
  }
  if (venue.type === 'self_managed' && appState.checkinDate && appState.checkoutDate) {
    lead.checkout_date  = appState.checkoutDate
    lead.preferred_date = appState.checkinDate
    const nights        = calcNights(appState.checkinDate, appState.checkoutDate)
    lead.advance_amount = nights * (Number(venue.metadata?.stay_price_per_night) || 0) + picnicPrice + addonSum
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
    // Server-side validation: re-fetch venue_availability right before insert
    // to catch stale client state (e.g. admin blocked dates after customer opened page).
    if (venue?.id && lead.preferred_date) {
      const { data: vaData } = await supabase
        .from('venue_availability')
        .select('date')
        .eq('venue_id', venue.id)
      const blockedDates = new Set((vaData || []).map(r => r.date))

      if (venue.type === 'self_managed' && lead.checkout_date) {
        const start = new Date(lead.preferred_date + 'T00:00:00')
        const end   = new Date(lead.checkout_date   + 'T00:00:00')
        for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
          if (blockedDates.has(localDateStr(d))) {
            throw new Error('One or more dates in your selection are no longer available. Please pick different dates.')
          }
        }
      } else if (venue.type === 'cafe' && blockedDates.has(lead.preferred_date)) {
        throw new Error('This date is no longer available. Please pick a different date.')
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
    })
    if (error) throw error

    const bookingRow = rpcRows?.[0] ?? {
      id:             null,
      preferred_date: lead.preferred_date,
      guest_count:    lead.guest_count,
    }

    // Persist add-on line items — requires booking ID which anon can't read back.
    // Add-ons are stored asynchronously; a server-side function or admin reconciliation
    // can link them by email + date if booking_id is needed later.
    // Now we have the booking ID from the RPC — link add-ons correctly
    if (addOnsToInsert.length > 0) {
      const { error: addOnErr } = await supabase.from('booking_add_ons').insert(
        addOnsToInsert.map(a => ({
          booking_id:            bookingRow.id ?? null,
          addon_id:              a.addon_id,
          name:                  a.name,
          price_at_booking:      a.price_at_booking,
          requires_confirmation: a.requires_confirmation,
        }))
      )
      if (addOnErr) console.error('Failed to save add-ons:', addOnErr)
    }

    const fromModal = appState.intentFromModal

    appState.currentBooking      = null
    appState.currentVenue        = null
    appState.currentVenueAddOns  = []
    appState.pendingLead         = null
    appState.pendingAddOns       = null
    appState.intentFromModal     = false

    const venueName = venue?.name || null

    if (fromModal) {
      hideModal('booking-modal')
      // Reset form and modal for next use
      const bookingForm = document.getElementById('booking-form')
      if (bookingForm) bookingForm.reset()
      resetBookingModalForVenue(null)
    } else {
      const bv = document.getElementById('vd-booking-view')
      if (bv) bv.style.display = 'none'
    }

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
// BOOKING FORM
// ----------------------------------------------------------------

function handleBookingSubmit(event) {
  event.preventDefault()
  const form  = event.target
  const venue = appState.currentVenue

  // Guards — same rules as the inline path
  if (venue?.type === 'cafe' && !appState.selectedTimeSlot) {
    showToast('Please select a time slot to continue', 'error')
    return
  }
  if (venue?.type === 'self_managed' && (!appState.checkinDate || !appState.checkoutDate)) {
    showToast('Please select your check-in and checkout dates', 'error')
    return
  }

  // Core fields (always present)
  const lead = {
    full_name:            form['full-name'].value.trim(),
    mobile_number:        form['mobile-number'].value.trim(),
    email_address:        form['email-address'].value.trim(),
    guest_count:          parseInt(form['guest-count'].value, 10),
    preferred_date:       form['preferred-date'].value,
    special_requirements: form['special-requirements'].value.trim(),
    advance_amount:       0,
    created_at:           new Date().toISOString(),
  }

  // Venue fields — depends on which flow the customer came from
  if (venue) {
    if (venue.type !== 'custom') {
      lead.venue_id = venue.id
    }
    if (venue.type === 'custom') {
      const addr = form['venue-address'].value.trim()
      if (!addr) {
        showToast('Please enter your venue address', 'error')
        return
      }
      lead.venue_address = addr
    }
    if (venue.type === 'partner_bnb') {
      const ref = form['airbnb-ref'].value.trim()
      if (ref) lead.external_booking_ref = ref
    }
    // Cafe: attach time slot + set advance amount
    if (venue.type === 'cafe' && appState.selectedTimeSlot) {
      lead.time_slot = appState.selectedTimeSlot
      const cafeAddonSum = Array.from(document.querySelectorAll('.bk-addon-checkbox:checked'))
        .reduce((s, cb) => s + Number(cb.dataset.addonPrice), 0)
      const cafeBilling  = calcBillingGuests(appState.adults, appState.children)
      lead.advance_amount = getVenuePrice(venue, cafeBilling) + cafeAddonSum
    }
    // BnB: attach checkout date and recalculate advance
    if (venue.type === 'self_managed' && appState.checkoutDate) {
      lead.checkout_date  = appState.checkoutDate
      lead.preferred_date = appState.checkinDate || lead.preferred_date
      const nights        = calcNights(lead.preferred_date, appState.checkoutDate)
      const stayTotal     = nights * (Number(venue.metadata?.stay_price_per_night) || 0)
      const addonSum      = Array.from(document.querySelectorAll('.bk-addon-checkbox:checked'))
        .reduce((s, cb) => s + Number(cb.dataset.addonPrice), 0)
      const billingGuests = calcBillingGuests(appState.adults, appState.children)
      lead.advance_amount = stayTotal + getVenuePrice(venue, billingGuests) + addonSum
    }
  } else {
    // No venue selected — treat as custom (free-text address)
    const addr = form['venue-address'].value.trim()
    if (!addr) {
      showToast('Please enter a venue or location', 'error')
      return
    }
    lead.venue_address = addr
  }

  // Snapshot selected add-ons before the modal content changes
  const pendingAddOns = Array.from(document.querySelectorAll('.bk-addon-checkbox:checked'))
    .map(cb => ({
      addon_id:              parseInt(cb.dataset.addonId, 10),
      name:                  cb.dataset.addonName || '',
      price_at_booking:      parseInt(cb.dataset.addonPrice, 10),
      requires_confirmation: cb.dataset.addonConfirm === 'true',
    }))

  // Store for the intent step
  appState.pendingLead    = lead
  appState.pendingAddOns  = pendingAddOns
  appState.intentFromModal = true   // so submitBookingIntent knows to close the modal

  // Replace modal body with intent screen
  const modalBody = document.querySelector('#booking-modal .modal-body')
  if (!modalBody) return

  modalBody.innerHTML = buildIntentScreenHTML(lead, { containerClass: 'vd-intent-wrap' })
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
//  MY BOOKINGS — magic link customer flow
// ================================================================

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
        <div class="mbk-icon">📬</div>
        <h2 class="mbk-heading">Find your booking</h2>
        <p class="mbk-sub">Enter the email you used when booking. We'll send you a one-time code to view your bookings.</p>
        <form class="mbk-form" id="mbk-email-form">
          <input type="email" id="mbk-email" class="form-control mbk-input"
                 placeholder="your@email.com" required autocomplete="email" />
          <button type="submit" class="btn btn--primary mbk-btn" id="mbk-send-btn">
            Send code
          </button>
        </form>
        <p class="mbk-hint">No account needed — just your email.</p>
      </div>
    </div>
  `
  document.getElementById('mbk-email-form')
    ?.addEventListener('submit', sendOtp)
}

async function sendOtp(e) {
  e.preventDefault()
  const email     = document.getElementById('mbk-email').value.trim()
  const submitBtn = document.getElementById('mbk-send-btn')
  submitBtn.disabled    = true
  submitBtn.textContent = 'Sending…'

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    })
    if (error) throw error
    renderOtpInput(email)
  } catch (err) {
    showToast(err.message || 'Failed to send code', 'error')
    submitBtn.disabled    = false
    submitBtn.textContent = 'Send code'
  }
}

function renderOtpInput(email) {
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
        <p class="mbk-sub">We sent a 6-digit code to <strong>${escapeHtml(email)}</strong>.<br>Enter it below — it expires in 10 minutes.</p>
        <form class="mbk-form" id="mbk-otp-form">
          <input type="text" id="mbk-otp" class="form-control mbk-input mbk-otp-input"
                 placeholder="000000" maxlength="6" inputmode="numeric"
                 pattern="[0-9]{6}" autocomplete="one-time-code" required />
          <button type="submit" class="btn btn--primary mbk-btn" id="mbk-verify-btn">
            View my bookings
          </button>
        </form>
        <p class="mbk-hint">Didn't get it? Check your spam, or <button class="mbk-resend-btn" onclick="sendOtpResend('${escapeHtml(email)}')">resend the code</button>.</p>
      </div>
    </div>
  `
  document.getElementById('mbk-otp-form')
    ?.addEventListener('submit', (e) => verifyOtp(e, email))

  // Auto-format: digits only
  document.getElementById('mbk-otp')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)
  })
}

async function verifyOtp(e, email) {
  e.preventDefault()
  const token     = document.getElementById('mbk-otp').value.trim()
  const submitBtn = document.getElementById('mbk-verify-btn')
  submitBtn.disabled    = true
  submitBtn.textContent = 'Verifying…'

  try {
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (error) throw error
    renderMyBookings(data.user.email)
  } catch (err) {
    showToast(err.message || 'Invalid or expired code', 'error')
    submitBtn.disabled    = false
    submitBtn.textContent = 'View my bookings'
  }
}

async function sendOtpResend(email) {
  try {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
    if (error) throw error
    showToast('New code sent — check your inbox', 'success')
  } catch (err) {
    showToast(err.message || 'Failed to resend', 'error')
  }
}
window.sendOtpResend = sendOtpResend

// Venue manager — called from onclick in rendered HTML (ESM module needs explicit global export)
window.openVenueForm     = openVenueForm
window.toggleVenueActive = toggleVenueActive
window.removeVfImage     = removeVfImage
window.removeVfTier      = removeVfTier
window.toggleBlockedDate = toggleBlockedDate

async function renderMyBookings(email) {
  const el = document.getElementById('my-bookings-content')
  if (!el) return

  el.innerHTML = `<div class="mbk-page"><div class="mbk-body"><p class="mbk-sub">Loading your bookings…</p></div></div>`

  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*, venues(name, type, area)')
      .eq('email_address', email)
      .order('preferred_date', { ascending: false })

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
            <p class="mbk-sub">We couldn't find any bookings for <strong>${escapeHtml(email)}</strong>.</p>
            <button class="btn btn--outline" onclick="showMyBookingsPage()">Try a different email</button>
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
          <p class="mbk-sub">${data.length} booking${data.length !== 1 ? 's' : ''} for ${escapeHtml(email)}</p>
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
      ${airbnbHtml}

      <div class="adm-card-footer">
        <div class="adm-advance-group">
          <span class="adm-advance-label">₹ Advance</span>
          <input class="adm-advance-input" type="number" id="advance-${escapeHtml(query.id)}" placeholder="0" min="0" step="1">
        </div>
        <button class="confirm-booking-btn adm-confirm-btn" data-id="${escapeHtml(query.id)}" data-venue-id="${escapeHtml(String(query.venue_id || ''))}" data-venue-type="${escapeHtml(query.venues?.type || '')}" data-preferred-date="${escapeHtml(query.preferred_date || '')}" data-checkout-date="${escapeHtml(query.checkout_date || '')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Confirm Booking
        </button>
      </div>
    </div>`
  }).join('')
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
async function confirmBooking(queryId, venueId, venueType, preferredDate, checkoutDate) {
  if (!appState.session) return showToast('Admin login required', 'error')
  const advanceInput = document.getElementById(`advance-${queryId}`)
  const advanceAmount = parseFloat(advanceInput.value) || 0

  if (advanceAmount <= 0) {
    showToast('Please enter a valid advance amount', 'error')
    return
  }

  try {
    // 1. Confirm the booking
    const { error: confErr } = await supabase
      .from('bookings')
      .update({ confirmed: true, advance_amount: advanceAmount })
      .eq('id', queryId)
    if (confErr) throw confErr

    // 2. Block dates in venue_availability using data already in hand (no extra SELECT needed)
    if (venueId && preferredDate) {
      const rows = []

      if (venueType === 'self_managed' || venueType === 'partner_bnb') {
        const start = new Date(preferredDate + 'T00:00:00')
        const end   = checkoutDate
          ? new Date(checkoutDate + 'T00:00:00')
          : new Date(start.getTime() + 86400000)
        for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
          rows.push({ venue_id: venueId, date: localDateStr(d), status: 'booked', source: 'booking', booking_id: parseInt(queryId, 10) })
        }
      }
      // Café bookings are slot-level — tracked via get_cafe_booked_slots RPC,
      // not as full-day blocks in venue_availability.

      if (rows.length > 0) {
        const { error: vaErr } = await supabase
          .from('venue_availability')
          .insert(rows)
        if (vaErr) console.error('Failed to block dates in venue_availability:', vaErr)
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
      .select('id, name, type, area, city, capacity_min, capacity_max, base_price, is_active, images, external_url, metadata, description')
      .order('id')
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
  container.innerHTML = `
    <table class="admin-venue-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Area</th>
          <th>Capacity</th>
          <th>Base Price</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${venues.map(v => `
          <tr class="${v.is_active ? '' : 'venue-row-inactive'}">
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
  document.getElementById('vf-description').value = ''
  document.getElementById('vf-area').value = ''
  document.getElementById('vf-city').value = 'Jaipur'
  document.getElementById('vf-cap-min').value = 2
  document.getElementById('vf-cap-max').value = 10
  document.getElementById('vf-base-price').value = 0
  document.getElementById('vf-external-url').value = ''
  document.getElementById('vf-overage').value = 2000
  document.getElementById('vf-rooms').value = 2
  document.getElementById('vf-bathrooms').value = 2
  document.getElementById('vf-stay-price').value = 0
  document.getElementById('vf-amenities').value = ''
  document.getElementById('vf-highlights').value = ''
  document.getElementById('vf-ideal-for').value = ''
  document.getElementById('vf-active').checked = true
  renderVfImages([])
  renderVfTiers([{ up_to: 2, price: 9900 }, { up_to: 4, price: 12900 }, { up_to: 6, price: 15900 }, { up_to: 8, price: 18900 }])
  updateVfTypeVisibility('cafe')
}

function populateVenueForm(venue) {
  document.getElementById('vf-id').value = venue.id
  document.getElementById('vf-name').value = venue.name || ''
  document.getElementById('vf-type').value = venue.type || 'cafe'
  document.getElementById('vf-description').value = venue.description || ''
  document.getElementById('vf-area').value = venue.area || ''
  document.getElementById('vf-city').value = venue.city || 'Jaipur'
  document.getElementById('vf-cap-min').value = venue.capacity_min || 2
  document.getElementById('vf-cap-max').value = venue.capacity_max || 10
  document.getElementById('vf-base-price').value = venue.base_price || 0
  document.getElementById('vf-external-url').value = venue.external_url || ''
  document.getElementById('vf-active').checked = venue.is_active !== false

  const meta = venue.metadata || {}
  renderVfImages(Array.isArray(venue.images) ? venue.images : (venue.images ? JSON.parse(venue.images) : []))
  renderVfTiers(meta.tiers || [])
  document.getElementById('vf-overage').value = meta.overage_per_person || 2000

  // BnB fields
  document.getElementById('vf-rooms').value = meta.rooms || 2
  document.getElementById('vf-bathrooms').value = meta.bathrooms || 2
  document.getElementById('vf-stay-price').value = meta.stay_price_per_night || 0
  document.getElementById('vf-amenities').value = (meta.amenities || []).join(', ')
  document.getElementById('vf-highlights').value = (meta.highlights || []).join(', ')
  document.getElementById('vf-ideal-for').value = (meta.ideal_for || []).join(', ')

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
    <div class="vf-image-row" data-index="${i}">
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

  let metadata = { tiers, overage_per_person: overage }

  if (type === 'self_managed') {
    const splitCsv = id => document.getElementById(id).value.split(',').map(s => s.trim()).filter(Boolean)
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
    description: document.getElementById('vf-description').value.trim(),
    area: document.getElementById('vf-area').value.trim(),
    city: document.getElementById('vf-city').value.trim(),
    capacity_min: parseInt(document.getElementById('vf-cap-min').value, 10),
    capacity_max: parseInt(document.getElementById('vf-cap-max').value, 10),
    base_price: parseFloat(document.getElementById('vf-base-price').value) || 0,
    external_url: document.getElementById('vf-external-url').value.trim() || null,
    is_active: document.getElementById('vf-active').checked,
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
  year: new Date().getFullYear(),
  month: new Date().getMonth(), // 0-indexed
  // Flat array of { date: 'YYYY-MM-DD', status: 'booked'|'blocked' }
  // sourced from venue_availability table — single source of truth
  dates: [],
}

async function initAvailabilityTab() {
  // Ensure venues are loaded before populating the select.
  // loadVenueManager() requires the venues tab DOM, so fetch directly if not yet loaded.
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
    // Single query — venue_availability is the source of truth for all blocking
    const { data, error } = await supabase
      .from('venue_availability')
      .select('date, status')
      .eq('venue_id', venueId)
      .gte('date', firstDay)
      .lte('date', lastDay)

    if (error) throw error

    availState.dates = (data || []).map(r => ({ date: r.date, status: r.status }))
    renderAvailCalendarGrid()
  } catch (err) {
    console.error(err)
    showToast('Failed to load availability data', 'error')
  }
}

function renderAvailCalendarGrid() {
  const grid = document.getElementById('avail-calendar-grid')
  if (!grid) return

  const { year, month, dates } = availState
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDOW   = new Date(year, month, 1).getDay()

  // Build lookup map: date string → highest-priority status
  // 'booked' takes priority over 'blocked' if both somehow exist
  const statusMap = new Map()
  for (const { date, status } of dates) {
    if (!statusMap.has(date) || status === 'booked') statusMap.set(date, status)
  }

  // Count stats for the summary row
  let countBooked = 0, countBlocked = 0, countAvailable = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isPast  = new Date(year, month, d) < today
    if (isPast) continue
    const st = statusMap.get(dateStr)
    if (st === 'booked')       countBooked++
    else if (st === 'blocked') countBlocked++
    else                       countAvailable++
  }

  const statsRow = document.getElementById('avail-stats-row')
  if (statsRow) {
    statsRow.hidden = false
    statsRow.innerHTML = `
      <div class="avail-stat avail-stat--booked">
        <span class="avail-stat-num">${countBooked}</span>
        <span class="avail-stat-label">Booked</span>
      </div>
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
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isPast    = new Date(year, month, d) < today
    const st        = statusMap.get(dateStr)
    const isBooked  = st === 'booked'
    const isBlocked = st === 'blocked'
    const isToday   = new Date(year, month, d).toDateString() === today.toDateString()

    let cls = 'avail-day'
    let badge = ''
    let onclick = ''
    let title = ''

    if (isPast) {
      cls += ' avail-day--past'
    } else if (isBooked) {
      cls += ' avail-day--booked'
      badge = '<span class="avail-day-badge">Booked</span>'
      title = 'title="Customer booking"'
    } else if (isBlocked) {
      cls += ' avail-day--blocked'
      badge = '<span class="avail-day-badge">Blocked</span>'
      // data-action instead of onclick — delegated listener handles it
      onclick = `data-action="unblock" data-date="${dateStr}"`
      title = 'title="Click to unblock"'
    } else {
      cls += ' avail-day--available'
      onclick = `data-action="block" data-date="${dateStr}"`
      title = 'title="Click to block"'
    }
    if (isToday) cls += ' avail-day--today'

    html += `
      <div class="${cls}" ${onclick} ${title}>
        <span class="avail-day-num">${d}</span>
        ${badge}
      </div>`
  }

  html += `</div>`
  grid.innerHTML = html

  // Delegated listener — replaces per-day onclick="toggleBlockedDate(...)" strings
  grid.addEventListener('click', e => {
    const day = e.target.closest('[data-action]')
    if (!day) return
    const dateStr = day.dataset.date
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return
    if (day.dataset.action === 'block')   toggleBlockedDate(dateStr, true)
    if (day.dataset.action === 'unblock') toggleBlockedDate(dateStr, false)
  }, { once: true })  // once:true — grid is fully re-rendered on each call
}

async function toggleBlockedDate(dateStr, shouldBlock) {
  if (!appState.session) return showToast('Admin login required', 'error')
  const venueId = availState.venueId
  if (!venueId) return

  try {
    if (shouldBlock) {
      const { error } = await supabase
        .from('venue_availability')
        .insert([{ venue_id: venueId, date: dateStr, status: 'blocked', source: 'admin' }])
      if (error && error.code !== '23505') throw error // ignore unique-constraint if already blocked
    } else {
      const { error } = await supabase
        .from('venue_availability')
        .delete()
        .eq('venue_id', venueId)
        .eq('date', dateStr)
        .eq('source', 'admin')
      if (error) throw error
    }

    // Update local state and re-render without a full reload
    if (shouldBlock) {
      // Remove any existing entry for this date (prevent duplicates), then add blocked
      availState.dates = [...availState.dates.filter(r => r.date !== dateStr),
                          { date: dateStr, status: 'blocked' }]
    } else {
      // Remove the blocked entry; leave any 'booked' entry intact
      availState.dates = availState.dates.filter(r => !(r.date === dateStr && r.status === 'blocked'))
    }
    renderAvailCalendarGrid()
    showToast(shouldBlock ? `${dateStr} blocked` : `${dateStr} unblocked`, 'success')
  } catch (err) {
    console.error(err)
    showToast('Failed to update blocked dates', 'error')
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
      menu_link_id: appState.currentMenuLink.id,
      booking_id:   appState.currentMenuLink.booking_id || null,
      items:        selectedItems,
      created_at:   new Date().toISOString()
    }
    const { error } = await supabase.from('menu_orders').insert([orderData])
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
    { text: "The Picnic Story created the most magical evening for our anniversary. Every detail was perfect!", author: "Priya & Rahul", rating: "★★★★★" },
    { text: "Professional service and stunning setup. Our corporate team loved the boho picnic experience.", author: "Tech Solutions Inc.", rating: "★★★★★" },
    { text: "Absolutely beautiful picnic setup in Jaipur. The food was delicious and the ambiance was perfect for our date.", author: "Sneha M.", rating: "★★★★★" }
  ]
  testimonialsContainer.innerHTML = testimonials.map(t => `
    <div class="testimonial-card">
      <p class="testimonial-text">"${t.text}"</p>
      <div class="testimonial-footer">
        <span class="testimonial-author">— ${t.author}</span>
        <span class="testimonial-rating">${t.rating}</span>
      </div>
    </div>
  `).join('')
}

// Global window exports (required for onclick handlers in templates/HTML)
window.showModal                  = showModal
window.hideModal                  = hideModal
window.showPage                   = showPage
window.copyMenuLink               = copyMenuLink
window.handleNavigation           = handleNavigation
window.openBookingForVenue        = openBookingForVenue
window.showVenuePage              = showVenuePage
window.navigateHome               = navigateHome
window.updateAddOnTotal           = updateAddOnTotal
window.selectCalendarDate         = selectCalendarDate
window.selectTimeSlot             = selectTimeSlot
window.selectBnbDate              = selectBnbDate
window.customerSignOut            = customerSignOut
window.showVenueBodyStep          = showVenueBodyStep
window.updateBookingSummaryPrice  = updateBookingSummaryPrice
window.handleInlineBookingSubmit  = handleInlineBookingSubmit
window.submitBookingIntent        = submitBookingIntent
window.showMyBookingsPage         = showMyBookingsPage
window.updateGuestCount           = updateGuestCount
window.showCalendarStep           = showCalendarStep
window.filterVenuesByCity         = filterVenuesByCity

// ── Hero image: load from site_settings on startup ───────────
async function loadHeroImage() {
  try {
    const { data } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'hero_image_url')
      .single()
    const url = data?.value
    if (url) {
      const img = document.querySelector('.hero-bg-img')
      if (img) img.src = url
    }
  } catch (err) {
    // silently ignore — placeholder image stays
  }
}

// ── Hero image: admin tab upload ──────────────────────────────
async function loadHeroImageAdminPreview() {
  const preview = document.getElementById('hero-img-admin-preview')
  if (!preview) return
  try {
    const { data } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'hero_image_url')
      .single()
    const url = data?.value
    if (url) {
      preview.innerHTML = `<img src="${url}" alt="Current hero" class="hero-img-admin-thumb" />`
    } else {
      preview.innerHTML = '<span class="hero-img-admin-empty">No image set</span>'
    }
  } catch (err) {
    preview.innerHTML = '<span class="hero-img-admin-empty">Could not load</span>'
  }
}

window.handleHeroImageUpload = async function(input) {
  const file = input.files[0]
  if (!file) return
  if (!appState.session) return showToast('Admin login required', 'error')

  const label  = document.getElementById('hero-upload-label')
  const status = document.getElementById('hero-upload-status')
  label.childNodes[0].textContent = 'Uploading…'
  status.innerHTML = ''

  const ext  = file.name.split('.').pop()
  const path = `hero/main.${ext}`

  try {
    const { error: upErr } = await supabase.storage
      .from('site-images')
      .upload(path, file, { upsert: true })
    if (upErr) throw upErr

    const { data: { publicUrl } } = supabase.storage
      .from('site-images')
      .getPublicUrl(path)

    // Save URL to site_settings
    const { error: dbErr } = await supabase
      .from('site_settings')
      .update({ value: publicUrl, updated_at: new Date().toISOString() })
      .eq('key', 'hero_image_url')
    if (dbErr) throw dbErr

    // Update live hero image without reload
    const heroImg = document.querySelector('.hero-bg-img')
    if (heroImg) heroImg.src = publicUrl + '?t=' + Date.now()

    // Update admin preview
    const preview = document.getElementById('hero-img-admin-preview')
    if (preview) preview.innerHTML = `<img src="${publicUrl}" alt="Current hero" class="hero-img-admin-thumb" />`

    status.innerHTML = '<span class="hero-upload-success">✓ Hero image updated</span>'
    label.childNodes[0].textContent = '↺ Replace photo'
    showToast('Hero image updated', 'success')
  } catch (err) {
    console.error(err)
    status.innerHTML = `<span class="hero-upload-error">Upload failed: ${err.message}</span>`
    label.childNodes[0].textContent = '↑ Choose photo'
    showToast('Upload failed: ' + err.message, 'error')
  }
}

// Restore venue detail page on browser back/forward
window.addEventListener('popstate', (event) => {
  if (event.state?.venueId) {
    showVenuePage(event.state.venueId, false)
  } else {
    showPage('home-page')
  }
})


// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  initializeMenuPreview()
  handleMenuPreviewTabs()
  renderAddonsStrip()

  // Navbar scroll behaviour — transparent over hero, solid when scrolled
  updateNavbarState('home-page')
  window.addEventListener('scroll', () => {
    const activePage = document.querySelector('.page.active')?.id || 'home-page'
    updateNavbarState(activePage)
  }, { passive: true })

  // URL parameter routing
  const urlParams = new URLSearchParams(window.location.search)
  const menuToken = urlParams.get('menu')
  const bookingId = urlParams.get('booking')
  const venueId   = urlParams.get('venue')

  if (menuToken) {
    showPage('menu-selection-page')
    loadMenuSelection(menuToken)
    if (bookingId) appState.currentBooking = { id: parseInt(bookingId, 10) }
  } else if (venueId) {
    loadVenues().then(() => showVenuePage(parseInt(venueId, 10), false))
  }

  const bookPicnicBtn = document.getElementById('book-picnic-btn')
  if (bookPicnicBtn) bookPicnicBtn.addEventListener('click', () => showModal('booking-modal'))

  const closeBookingModalBtn = document.getElementById('close-booking-modal')
  if (closeBookingModalBtn) closeBookingModalBtn.addEventListener('click', () => hideModal('booking-modal'))

  const cancelBookingBtn = document.getElementById('cancel-booking')
  if (cancelBookingBtn) {
    cancelBookingBtn.addEventListener('click', () => hideModal('booking-modal'))
  }

  const bookingForm = document.getElementById('booking-form')
  if (bookingForm) bookingForm.addEventListener('submit', handleBookingSubmit)

  const adminLoginForm = document.getElementById('admin-login-form')
  if (adminLoginForm) adminLoginForm.addEventListener('submit', handleAdminLogin)

  const adminLogoutBtn = document.getElementById('admin-logout')
  if (adminLogoutBtn) adminLogoutBtn.addEventListener('click', handleAdminLogout)

  const bookingModal = document.getElementById('booking-modal')
  if (bookingModal) {
    bookingModal.addEventListener('click', (event) => {
      if (event.target === bookingModal) hideModal('booking-modal')
    })
  }

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      const route = link.getAttribute('data-route')
      handleNavigation(route)
    })
  })

  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      switchTab(button.getAttribute('data-tab'))
    })
  })

  const generateMenuLinkBtn = document.getElementById('generate-menu-link')
  if (generateMenuLinkBtn) {
    generateMenuLinkBtn.addEventListener('click', () => {
      const foodCount = parseInt(document.getElementById('food-count').value, 10)
      const bevCount  = parseInt(document.getElementById('bev-count').value, 10)
      generateMenuLink(foodCount, bevCount)
    })
  }

  const copyLinkBtn = document.getElementById('copy-link')
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
      const linkInput = document.getElementById('generated-link-url')
      if (linkInput) {
        navigator.clipboard.writeText(linkInput.value)
          .then(() => showToast('Link copied to clipboard', 'success'))
          .catch(() => showToast('Failed to copy link', 'error'))
      }
    })
  }

  const preferredDateInput = document.getElementById('preferred-date')
  if (preferredDateInput) {
    preferredDateInput.min = localDateStr(new Date())
  }

  // Venue Manager listeners
  document.getElementById('add-venue-btn')?.addEventListener('click', () => openVenueForm(null))
  document.getElementById('vfp-close')?.addEventListener('click', closeVenueForm)
  document.getElementById('venue-admin-form')?.addEventListener('submit', handleVenueFormSubmit)
  document.getElementById('vf-add-image')?.addEventListener('click', addVfImage)
  document.getElementById('vf-add-tier')?.addEventListener('click', addVfTier)
  document.getElementById('vf-type')?.addEventListener('change', (e) => updateVfTypeVisibility(e.target.value))

  // Availability Calendar listeners
  document.getElementById('avail-venue-select')?.addEventListener('change', (e) => {
    availState.venueId = e.target.value ? parseInt(e.target.value, 10) : null
    loadAvailCalendar()
  })
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

  loadTestimonials()

  document.addEventListener('click', (event) => {
    const venueCard = event.target.closest('.venue-card')
    if (venueCard) {
      const id = parseInt(venueCard.dataset.venueId, 10)
      if (!isNaN(id)) showVenuePage(id)
      return
    }

    const bookVenueBtn = event.target.closest('[data-book-venue-id]')
    if (bookVenueBtn && !bookVenueBtn.disabled) {
      const id    = parseInt(bookVenueBtn.dataset.bookVenueId, 10)
      const venue = appState.venues.find(v => v.id === id)
      if (!venue) return
      // partner_bnb "already booked" button → old modal (picnic-add flow)
      if (venue.type === 'partner_bnb') {
        openBookingForVenue(venue)
      } else if (appState.bookingStep === 'guests') {
        // Guest step complete → show inline contact form
        showBookingForm(venue)
      } else {
        // Date selected → show guest selector in sidebar
        showGuestSelector(venue)
      }
      return
    }

    if (event.target.closest('.modern-qty-btn') && !event.target.closest('.modern-qty-btn').disabled) {
      const btn      = event.target.closest('.modern-qty-btn')
      updateQuantity(btn.getAttribute('data-item'), btn.getAttribute('data-category'), parseInt(btn.getAttribute('data-change'), 10))
      return
    }

    if (event.target.classList.contains('quantity-btn') && !event.target.disabled) {
      updateQuantity(event.target.getAttribute('data-item'), event.target.getAttribute('data-category'), parseInt(event.target.getAttribute('data-change'), 10))
      return
    }

    if (event.target.closest('.modern-tab-btn')) {
      const btn = event.target.closest('.modern-tab-btn')
      const tab = btn.getAttribute('data-tab')
      if (tab) {
        document.querySelectorAll('.modern-tab-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        document.querySelectorAll('.modern-tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none' })
        const target = document.getElementById(tab)
        if (target) { target.classList.add('active'); target.style.display = 'block' }
      }
      return
    }

    if (event.target.id === 'submit-menu-selection') { submitMenuSelection(); return }
    const confirmBtn = event.target.closest('.confirm-booking-btn')
    if (confirmBtn) {
      confirmBooking(
        confirmBtn.getAttribute('data-id'),
        confirmBtn.getAttribute('data-venue-id'),
        confirmBtn.getAttribute('data-venue-type'),
        confirmBtn.getAttribute('data-preferred-date'),
        confirmBtn.getAttribute('data-checkout-date'),
      )
      return
    }
    const generateMenuBtn = event.target.closest('.generate-menu-btn')
    if (generateMenuBtn) { generateBookingMenuLink(generateMenuBtn.getAttribute('data-booking-id')); return }
    const copyMenuBtn = event.target.closest('.copy-menu-btn')
    if (copyMenuBtn) { copyBookingMenuLink(copyMenuBtn.getAttribute('data-booking-id')); return }
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    applyAuthState(session)
    if (session) {
      loadQueries()
      loadBookings()
      loadMenuLinks()
    }
  })

  loadVenues()
  loadHeroImage()
})
