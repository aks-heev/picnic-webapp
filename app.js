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
  selectedDate: null,        // date picked on the availability calendar
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

// Fetch add-ons available for a given venue type (experience + extra categories)
async function loadVenueAddOns(venueType) {
  try {
    const { data, error } = await supabase
      .from('add_ons')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
    if (error) throw error
    // Include add-ons where venueType is in available_for OR requires_confirmation_for
    return (data || []).filter(a =>
      a.available_for?.includes(venueType) ||
      a.requires_confirmation_for?.includes(venueType)
    )
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

  if (pushState) {
    history.pushState({ venueId }, `${venue.name} — The Picnic Story`, `/?venue=${venueId}`)
    document.title = `${venue.name} — The Picnic Story`
  }

  // Reset calendar state when navigating to a new venue
  appState.selectedDate = null

  const [addOns, bookedDates] = await Promise.all([
    loadVenueAddOns(venue.type),
    venue.type !== 'partner_bnb' ? fetchBookedDates(venue.id) : Promise.resolve(new Set()),
  ])
  appState.currentVenueAddOns = addOns
  renderVenueDetail(venue, addOns)
  showPage('venue-detail-page')

  // Init availability calendar for self-managed venues
  if (venue.type !== 'partner_bnb') {
    renderAvailabilityCalendar('avail-calendar-widget', bookedDates)
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
          <button class="vd-gallery-thumb ${i === 0 ? 'vd-gallery-thumb--active' : ''}" aria-label="View photo ${i + 1}">
            <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || venue.name)}" loading="lazy">
          </button>`).join('')}
       </div>`
    : ''

  const ctaBlock = venue.type === 'partner_bnb'
    ? `<div class="vd-cta-stack">
         <a href="${escapeHtml(venue.external_url || '#')}" target="_blank" rel="noopener noreferrer"
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
          <button class="vd-back-btn" onclick="navigateHome()" aria-label="Back to venues">
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
      <div class="vd-body container">
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
              const experiences = addOns.filter(a => a.category === 'experience')
              if (!experiences.length) return ''
              return `
            <hr class="vd-divider">
            <div class="vd-section">
              <h2 class="vd-section-title">Make it yours</h2>
              <p class="vd-addons-tagline">Every picnic can be elevated. These experiences are available to add at this venue.</p>
              <div class="vd-addons-scroll">
                ${experiences.map(a => {
                  const needsConfirm = a.requires_confirmation_for?.includes(venue.type)
                  return `
                <div class="vd-addon-card">
                  <div class="vd-addon-img">
                    <div class="vd-addon-img-placeholder" aria-hidden="true"></div>
                  </div>
                  <div class="vd-addon-body">
                    <div class="vd-addon-name">${escapeHtml(a.name)}</div>
                    ${a.description ? `<div class="vd-addon-desc">${escapeHtml(a.description)}</div>` : ''}
                    <div class="vd-addon-footer">
                      <span class="vd-addon-price">+₹${Number(a.price).toLocaleString('en-IN')}</span>
                      ${needsConfirm ? `<span class="vd-addon-confirm-tag">On request</span>` : ''}
                    </div>
                  </div>
                </div>`
                }).join('')}
              </div>
            </div>`
            })()}

          </div><!-- /vd-main -->

          <!-- Sticky booking sidebar -->
          <aside class="vd-sidebar">
            <div class="vd-booking-card">
              ${venue.base_price ? `
              <div class="vd-price-row">
                <span class="vd-price-amount">${escapeHtml(formatPrice(venue.base_price))}</span>
                <span class="vd-price-label">starting price</span>
              </div>` : `
              <div class="vd-price-row">
                <span class="vd-price-amount">Custom</span>
                <span class="vd-price-label">pricing on request</span>
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

      <!-- Mobile-only sticky booking bar -->
      <div class="vd-mobile-book-bar">
        ${venue.type === 'partner_bnb'
          ? `<div class="vd-mobile-book-price">
               <span class="vd-mobile-book-amount">${venue.base_price ? escapeHtml(formatPrice(venue.base_price)) : 'Custom'}</span>
               <span class="vd-mobile-book-label">${venue.base_price ? 'starting price' : 'price on request'}</span>
             </div>
             <a href="${escapeHtml(venue.external_url || '#')}" target="_blank" rel="noopener noreferrer" class="btn btn--venue-primary">Book on Airbnb</a>`
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
}

// Open the booking modal pre-configured for a venue
function openBookingForVenue(venue) {
  appState.currentVenue = venue
  resetBookingModalForVenue(venue)
  // Pre-fill date from calendar selection if available
  if (appState.selectedDate) {
    const dateInput = document.getElementById('preferred-date')
    if (dateInput) dateInput.value = appState.selectedDate
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

// Fetch all booked dates (confirmed + pending) for a venue
async function fetchBookedDates(venueId) {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('preferred_date')
      .eq('venue_id', venueId)
    if (error) throw error
    return new Set((data || []).map(b => b.preferred_date))
  } catch (err) {
    console.error('Failed to fetch booked dates:', err)
    return new Set()
  }
}

// Format a YYYY-MM-DD date string as "12 Jun"
function formatSelectedDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// Build the inner grid HTML for a calendar month
function buildCalendarHTML(year, month, bookedDates) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  const firstDow   = new Date(year, month, 1).getDay()
  const totalDays  = new Date(year, month + 1, 0).getDate()

  let html = DOW.map(d => `<span class="avail-cal-dow">${d}</span>`).join('')

  for (let i = 0; i < firstDow; i++) {
    html += `<span class="avail-cal-empty"></span>`
  }

  for (let d = 1; d <= totalDays; d++) {
    const date = new Date(year, month, d)
    date.setHours(0, 0, 0, 0)
    const dateStr  = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isPast   = date < today
    const isBooked = bookedDates.has(dateStr)
    const isToday  = date.getTime() === today.getTime()
    const isSelected = appState.selectedDate === dateStr
    const isDisabled = isPast || isBooked

    const cls = [
      'avail-cal-day',
      isPast      ? 'avail-cal-day--past'     : '',
      isBooked    ? 'avail-cal-day--booked'   : '',
      isToday     ? 'avail-cal-day--today'    : '',
      isSelected  ? 'avail-cal-day--selected' : '',
      !isDisabled ? 'avail-cal-day--available': '',
    ].filter(Boolean).join(' ')

    if (isDisabled) {
      html += `<span class="${cls}" aria-disabled="true" title="${isBooked ? 'Already booked' : ''}">${d}</span>`
    } else {
      html += `<button class="${cls}" data-date="${dateStr}"
                       onclick="selectCalendarDate('${dateStr}')"
                       aria-label="${dateStr}">${d}</button>`
    }
  }

  return html
}

// Render the interactive availability calendar into a container
function renderAvailabilityCalendar(containerId, bookedDates) {
  const container = document.getElementById(containerId)
  if (!container) return

  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December']
  const now    = new Date()
  let year     = now.getFullYear()
  let month    = now.getMonth()

  function draw() {
    const isMinMonth = year === now.getFullYear() && month <= now.getMonth()

    container.innerHTML = `
      <div class="avail-calendar">
        <div class="avail-cal-header">
          <button class="avail-cal-nav" id="avail-cal-prev" aria-label="Previous month"
                  ${isMinMonth ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="avail-cal-month-label">${MONTHS[month]} ${year}</span>
          <button class="avail-cal-nav" id="avail-cal-next" aria-label="Next month">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="avail-cal-grid">
          ${buildCalendarHTML(year, month, bookedDates)}
        </div>
        <div class="avail-cal-legend">
          <span class="avail-cal-legend-item">
            <span class="avail-cal-swatch avail-cal-swatch--booked"></span>Booked
          </span>
          <span class="avail-cal-legend-item">
            <span class="avail-cal-swatch avail-cal-swatch--available"></span>Available
          </span>
        </div>
      </div>
    `

    document.getElementById('avail-cal-prev')?.addEventListener('click', () => {
      if (isMinMonth) return
      month--
      if (month < 0) { month = 11; year-- }
      draw()
    })
    document.getElementById('avail-cal-next')?.addEventListener('click', () => {
      month++
      if (month > 11) { month = 0; year++ }
      draw()
    })
  }

  draw()
}

// Handle date selection from the calendar
function selectCalendarDate(dateStr) {
  appState.selectedDate = dateStr

  // Pre-fill date in booking modal
  const dateInput = document.getElementById('preferred-date')
  if (dateInput) dateInput.value = dateStr

  // Update selected highlight without full re-render
  document.querySelectorAll('.avail-cal-day--selected').forEach(el => {
    el.classList.remove('avail-cal-day--selected')
  })
  document.querySelectorAll(`.avail-cal-day[data-date="${dateStr}"]`).forEach(el => {
    el.classList.add('avail-cal-day--selected')
  })

  const formatted = formatSelectedDate(dateStr)

  // Unlock + update sidebar book button
  const sidebarBtn = document.getElementById('sidebar-book-btn')
  if (sidebarBtn) {
    sidebarBtn.disabled = false
    sidebarBtn.textContent = `Book — ${formatted}`
  }

  // Update mobile bar
  const mobileDateText = document.getElementById('mobile-bar-date-text')
  if (mobileDateText) mobileDateText.textContent = formatted
  const mobileBookBtn = document.getElementById('mobile-bar-book-btn')
  if (mobileBookBtn) mobileBookBtn.disabled = false

  updateAdvanceButton()
}

// Update the advance payment button label with the current total
function updateAdvanceButton() {
  const btn = document.getElementById('booking-submit-btn')
  if (!btn) return

  const venue     = appState.currentVenue
  const basePrice = venue?.base_price ? Number(venue.base_price) : 0

  if (!basePrice) {
    btn.textContent = 'Pay Advance'
    return
  }

  const addonSum = Array.from(document.querySelectorAll('.bk-addon-checkbox:checked'))
    .reduce((sum, cb) => sum + Number(cb.dataset.addonPrice), 0)

  btn.textContent = `Pay Advance — ₹${(basePrice + addonSum).toLocaleString('en-IN')}`
}

// ----------------------------------------------------------------
// BOOKING FORM
// ----------------------------------------------------------------

async function handleBookingSubmit(event) {
  event.preventDefault()
  const form = event.target
  const venue = appState.currentVenue

  // Core fields (always present)
  const lead = {
    full_name:            form['full-name'].value.trim(),
    mobile_number:        form['mobile-number'].value.trim(),
    email_address:        form['email-address'].value.trim(),
    guest_count:          parseInt(form['guest-count'].value, 10),
    preferred_date:       form['preferred-date'].value,
    special_requirements: form['special-requirements'].value.trim(),
    confirmed:     false,
    advance_amount: 0,
    created_at:    new Date().toISOString(),
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
  } else {
    // No venue selected — treat as custom (free-text address)
    const addr = form['venue-address'].value.trim()
    if (!addr) {
      showToast('Please enter a venue or location', 'error')
      return
    }
    lead.venue_address = addr
  }

  const submitBtn = form.querySelector('[type="submit"]')
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…' }

  try {
    const { data, error } = await supabase.from('bookings').insert([lead]).select()
    if (error) throw error

    // Save selected add-ons (if any) to booking_addons
    const selectedAddOns = Array.from(document.querySelectorAll('.bk-addon-checkbox:checked'))
      .map(cb => ({
        booking_id:           data[0].id,
        addon_id:             parseInt(cb.dataset.addonId, 10),
        price_at_booking:     parseInt(cb.dataset.addonPrice, 10),
        requires_confirmation: cb.dataset.addonConfirm === 'true',
      }))
    if (selectedAddOns.length > 0) {
      const { error: addonError } = await supabase.from('booking_addons').insert(selectedAddOns)
      if (addonError) console.error('Failed to save add-ons:', addonError)
    }

    // Capture venue name before clearing state
    const venueName = appState.currentVenue?.name || null

    appState.currentBooking      = data[0]
    appState.currentVenue        = null
    appState.currentVenueAddOns  = []
    hideModal('booking-modal')
    form.reset()
    resetBookingModalForVenue(null)
    renderSuccessPage({ booking: data[0], venueName })
    showPage('query-success-page')

  } catch (error) {
    console.error(error)
    showToast('Error submitting query. Please try again.', 'error')
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Query' }
  }
}

// ----------------------------------------------------------------
// BOOKING SUCCESS PAGE
// ----------------------------------------------------------------

function renderSuccessPage({ booking, venueName }) {
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
        <h1 class="bsc-heading">Your picnic is being arranged!</h1>
        <p class="bsc-sub">We've received your request and will confirm within 24 hours.</p>

        <!-- Booking summary card -->
        <div class="bsc-card">
          <div class="bsc-card-label">Booking Request #${booking?.id || '—'}</div>
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
            <div class="bsc-step bsc-step--done">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">Request received</span>
                <span class="bsc-step-desc">We have your booking details</span>
              </div>
            </div>
            <div class="bsc-step">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">We'll confirm within 24h</span>
                <span class="bsc-step-desc">Our team will call or WhatsApp you</span>
              </div>
            </div>
            <div class="bsc-step">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">Pay the advance</span>
                <span class="bsc-step-desc">Secures your date and locks in the setup</span>
              </div>
            </div>
            <div class="bsc-step">
              <div class="bsc-step-dot"></div>
              <div class="bsc-step-text">
                <span class="bsc-step-title">Enjoy your picnic</span>
                <span class="bsc-step-desc">We handle everything, you just show up</span>
              </div>
            </div>
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

        <!-- Contact nudge -->
        <p class="bsc-contact-nudge">
          Questions? Call or WhatsApp us at
          <a href="tel:+919999999999">+91 99999-99999</a>
        </p>

      </div><!-- /bsc-body -->
    </div><!-- /bsc-page -->
  `
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

// Toggle admin UI based on auth state
function applyAuthState(session) {
  appState.session = session
  const adminLogin = document.getElementById('admin-login')
  const adminDashboard = document.getElementById('admin-dashboard')

  if (session) {
    if (adminLogin) adminLogin.classList.add('hidden')
    if (adminDashboard) adminDashboard.classList.remove('hidden')
    loadQueries()
    loadMenuLinks()
  } else {
    if (adminLogin) adminLogin.classList.remove('hidden')
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
      const fullUrl = `${window.location.origin}?menu=${data[0].id}`
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

    // For each booking, fetch its orders
    const bookingsWithOrders = await Promise.all(bookings.map(async booking => {
      const { data: orders, error: oErr } = await supabase
        .from('orders')
        .select('id, selected_items, created_at')
        .eq('booking_id', booking.id)
      if (oErr) throw oErr
      return { ...booking, orders }
    }))

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
    container.innerHTML = '<div class="empty-state"><h3>No queries yet</h3><p>New customer queries will appear here.</p></div>'
    return
  }
  
  container.innerHTML = queries.map(query => {
    // Build venue display line
    let venueHtml = ''
    if (query.venues) {
      venueHtml = `
        <div class="query-detail">
          <strong>Venue:</strong>
          ${escapeHtml(query.venues.name)}
          <span class="admin-venue-badge ${venueTypeBadgeClass(query.venues.type)}">${escapeHtml(formatVenueType(query.venues.type))}</span>
          ${query.venues.area ? `<span class="admin-venue-area">(${escapeHtml(query.venues.area)})</span>` : ''}
        </div>`
    } else if (query.venue_address) {
      venueHtml = `<div class="query-detail"><strong>Venue (custom):</strong> ${escapeHtml(query.venue_address)}</div>`
    }

    const airbnbRefHtml = query.external_booking_ref
      ? `<div class="query-detail"><strong>Airbnb Ref:</strong> <code>${escapeHtml(query.external_booking_ref)}</code></div>`
      : ''

    return `
    <div class="query-item" data-id="${escapeHtml(query.id)}">
      <div class="query-header">
        <span class="query-name">${escapeHtml(query.full_name)}</span>
        <span class="query-date">${new Date(query.created_at).toLocaleDateString()}</span>
      </div>
      <div class="query-details">
        <div class="query-detail"><strong>Mobile:</strong> ${escapeHtml(query.mobile_number)}</div>
        <div class="query-detail"><strong>Email:</strong> ${escapeHtml(query.email_address)}</div>
        ${venueHtml}
        ${airbnbRefHtml}
        <div class="query-detail"><strong>Guests:</strong> ${escapeHtml(query.guest_count)}</div>
        <div class="query-detail"><strong>Date:</strong> ${new Date(query.preferred_date).toLocaleDateString()}</div>
        ${query.special_requirements ? `<div class="query-detail"><strong>Requirements:</strong> ${escapeHtml(query.special_requirements)}</div>` : ''}
      </div>
      <div class="query-actions">
        <div class="advance-input-group">
          <label for="advance-${escapeHtml(query.id)}">Advance Amount:</label>
          <input type="number" id="advance-${escapeHtml(query.id)}" placeholder="Enter amount" min="0" step="0.01">
        </div>
        <button class="confirm-booking-btn" data-id="${escapeHtml(query.id)}">
          Confirm Booking
        </button>
      </div>
    </div>
  `
  }).join('')
}

// Render bookings (confirmed bookings) 
function renderBookings(bookings) {
  const container = document.getElementById('bookings-container')
  if (!container) return
  
  if (!bookings || bookings.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No confirmed bookings yet</h3><p>Confirmed bookings will appear here.</p></div>'
    return
  }
  
  container.innerHTML = bookings.map(booking => {
    let venueHtml = ''
    if (booking.venues) {
      venueHtml = `
        <div class="booking-detail">
          <strong>Venue:</strong>
          ${escapeHtml(booking.venues.name)}
          <span class="admin-venue-badge ${venueTypeBadgeClass(booking.venues.type)}">${escapeHtml(formatVenueType(booking.venues.type))}</span>
          ${booking.venues.area ? `<span class="admin-venue-area">(${escapeHtml(booking.venues.area)})</span>` : ''}
        </div>`
    } else if (booking.venue_address) {
      venueHtml = `<div class="booking-detail"><strong>Venue (custom):</strong> ${escapeHtml(booking.venue_address)}</div>`
    }

    const airbnbRefHtml = booking.external_booking_ref
      ? `<div class="booking-detail"><strong>Airbnb Ref:</strong> <code>${escapeHtml(booking.external_booking_ref)}</code></div>`
      : ''

    return `
    <div class="booking-item" data-id="${escapeHtml(booking.id)}">
      <div class="booking-header">
        <span class="booking-name">${escapeHtml(booking.full_name)}</span>
        <span class="booking-date">${new Date(booking.created_at).toLocaleDateString()}</span>
        <span class="advance-badge">₹${escapeHtml(booking.advance_amount || 0)} paid</span>
      </div>
      <div class="booking-details">
        <div class="booking-detail"><strong>Mobile:</strong> ${escapeHtml(booking.mobile_number)}</div>
        <div class="booking-detail"><strong>Email:</strong> ${escapeHtml(booking.email_address)}</div>
        ${venueHtml}
        ${airbnbRefHtml}
        <div class="booking-detail"><strong>Guests:</strong> ${escapeHtml(booking.guest_count)}</div>
        <div class="booking-detail"><strong>Date:</strong> ${new Date(booking.preferred_date).toLocaleDateString()}</div>
        ${booking.special_requirements ? `<div class="booking-detail"><strong>Requirements:</strong> ${escapeHtml(booking.special_requirements)}</div>` : ''}
      </div>

      <h5>Previous Orders:</h5>
      <ul>
        ${booking.orders.map(o =>
          `<li>Order #${escapeHtml(o.id)} — ${o.selected_items.map(i => escapeHtml(i.name) + '×' + escapeHtml(i.quantity)).join(', ')}</li>`
        ).join('')}
      </ul>

      <div class="menu-generator">
        <div class="menu-controls">
          <div class="control-group">
            <label for="food-count-${escapeHtml(booking.id)}">Food Items:</label>
            <input type="number" id="food-count-${escapeHtml(booking.id)}" value="3" min="1" max="15">
          </div>
          <div class="control-group">
            <label for="bev-count-${escapeHtml(booking.id)}">Beverages:</label>
            <input type="number" id="bev-count-${escapeHtml(booking.id)}" value="2" min="1" max="10">
          </div>
          <button class="generate-menu-btn" data-booking-id="${escapeHtml(booking.id)}">
            Generate Menu Link
          </button>
        </div>
        <div class="generated-menu-link" id="generated-link-${escapeHtml(booking.id)}" style="display: none;">
          <label>Generated Link:</label>
          <div class="link-container">
            <input type="text" id="menu-url-${escapeHtml(booking.id)}" readonly>
            <button class="copy-menu-btn" data-booking-id="${escapeHtml(booking.id)}">Copy</button>
          </div>
        </div>
      </div>
    </div>
  `
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
        <button class="btn btn--sm btn--outline" onclick="copyMenuLink('${link.id}')">Copy Link</button>
      </div>
    </div>
  `).join('')
}

// Copy menu link
function copyMenuLink(linkId) {
  const url = `${window.location.origin}?menu=${linkId}`
  navigator.clipboard.writeText(url).then(() => {
    showToast('Menu link copied to clipboard', 'success')
  }).catch(() => {
    showToast('Failed to copy link', 'error')
  })
}

// Confirm booking
async function confirmBooking(queryId) {
  const advanceInput = document.getElementById(`advance-${queryId}`)
  const advanceAmount = parseFloat(advanceInput.value) || 0
  
  if (advanceAmount <= 0) {
    showToast('Please enter a valid advance amount', 'error')
    return
  }
  
  try {
    const { error } = await supabase
      .from('bookings')
      .update({ 
        confirmed: true, 
        advance_amount: advanceAmount 
      })
      .eq('id', queryId)
    
    if (error) throw error
    
    showToast('Booking confirmed successfully!', 'success')
    loadQueries()
    loadBookings()
    
  } catch (error) {
    console.error(error)
    showToast('Failed to confirm booking', 'error')
  }
}

// Generate menu link for booking
async function generateBookingMenuLink(bookingId) {
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
      const fullUrl = `${window.location.origin}?menu=${data[0].id}&booking=${bookingId}`
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
async function loadMenuSelection(menuId) {
  try {
    const { data, error } = await supabase
      .from('menu_links')
      .select()
      .eq('id', menuId)
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
  if (!appState.selectedItems[key]) {
    appState.selectedItems[key] = { name: itemName, category, quantity: 0 }
  }
  
  const currentItem = appState.selectedItems[key]
  const newQuantity = currentItem.quantity + change
  
  if (newQuantity < 0) return
  if (newQuantity > 5) return // Max 5 per item
  
  // Check total limits
  const { totalFood, totalBev } = getCurrentTotals()
  const maxFood = appState.currentMenuLink.max_food_items
  const maxBev = appState.currentMenuLink.max_bev_items
  
  if (change > 0) { // Adding item
    if (category === 'food' && totalFood >= maxFood) {
      showToast(`Maximum ${maxFood} food items allowed in total`, 'error')
      return
    }
    if (category === 'bev' && totalBev >= maxBev) {
      showToast(`Maximum ${maxBev} beverages allowed in total`, 'error')
      return
    }
  }
  
  currentItem.quantity = newQuantity
  if (newQuantity === 0) {
    delete appState.selectedItems[key]
  }
  
  // Update display
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
  let totalBev = 0
  
  selectedItems.forEach(item => {
    if (item.category === 'food') {
      totalFood += item.quantity
    } else {
      totalBev += item.quantity
    }
  })
  
  return { totalFood, totalBev }
}

// Update button states
function updateButtonStates() {
  if (!appState.currentMenuLink) return
  
  const { totalFood, totalBev } = getCurrentTotals()
  const maxFood = appState.currentMenuLink.max_food_items
  const maxBev = appState.currentMenuLink.max_bev_items
  
  document.querySelectorAll('.quantity-btn').forEach(btn => {
    const itemName = btn.dataset.item
    const category = btn.dataset.category
    const change = parseInt(btn.dataset.change, 10)
    
    const key = `${category}-${itemName}`
    const currentQuantity = appState.selectedItems[key]?.quantity || 0
    
    if (change > 0) { // Add button
      const categoryTotal = category === 'food' ? totalFood : totalBev
      const categoryMax = category === 'food' ? maxFood : maxBev
      btn.disabled = (categoryTotal >= categoryMax) || (currentQuantity >= 5)
    } else { // Minus button
      btn.disabled = currentQuantity <= 0
    }
  })
}

// Update selection summary
function updateSelectionSummary() {
  const selectedItems = Object.values(appState.selectedItems).filter(item => item.quantity > 0)
  
  const summaryContent = document.getElementById('selection-summary-content')
  if (summaryContent) {
    if (selectedItems.length === 0) {
      summaryContent.innerHTML = '<p>No items selected yet.</p>'
    } else {
      summaryContent.innerHTML = selectedItems.map(item => `
        <div class="selected-item">
          <span class="selected-item-name">${item.name}</span>
          <span class="selected-item-quantity">${item.quantity}x</span>
        </div>
      `).join('')
    }
  }
  
  const submitBtn = document.getElementById('submit-menu-selection')
  if (submitBtn) {
    submitBtn.disabled = selectedItems.length === 0
  }
}

// Submit menu selection
async function submitMenuSelection() {
  const selectedItems = Object.values(appState.selectedItems).filter(item => item.quantity > 0)
  
  try {
    const order = {
      menu_link_id: appState.currentMenuLink.id,
      booking_id: appState.currentBooking?.id || null,
      selected_items: selectedItems,
      created_at: new Date().toISOString(),
    }
    
    const { data, error } = await supabase.from('orders').insert([order]).select()
    if (error) throw error
    
    appState.currentOrder = data[0]
    showToast('Menu selection submitted successfully!', 'success')
    showOrderConfirmation(data[0])
    
  } catch (error) {
    console.error(error)
    showToast('Error submitting menu selection. Please try again.', 'error')
  }
}

// Show order confirmation
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
        
        <div style="margin-top: var(--space-32); padding: var(--space-24); background: rgba(16, 185, 129, 0.1); border-radius: var(--radius-lg);">
          <h3>Next Steps</h3>
          <ul style="list-style: none; padding: 0; margin: var(--space-16) 0;">
            <li style="padding: var(--space-8) 0; border-bottom: 1px solid rgba(16, 185, 129, 0.2);">✅ We will contact you within 24 hours to confirm your booking</li>
            <li style="padding: var(--space-8) 0; border-bottom: 1px solid rgba(16, 185, 129, 0.2);">✅ Final menu confirmation and dietary adjustments can be made during the call</li>
            <li style="padding: var(--space-8) 0; border-bottom: 1px solid rgba(16, 185, 129, 0.2);">✅ Payment details and picnic setup will be discussed</li>
            <li style="padding: var(--space-8) 0;">✅ We'll send you the exact location and timing details</li>
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

// Load testimonials
function loadTestimonials() {
  const testimonialsContainer = document.getElementById('testimonials-container')
  if (!testimonialsContainer) return
  
  const testimonials = [
    {
      text: "The Picnic Story created the most magical evening for our anniversary. Every detail was perfect!",
      author: "Priya & Rahul",
      rating: "★★★★★"
    },
    {
      text: "Professional service and stunning setup. Our corporate team loved the boho picnic experience.",
      author: "Tech Solutions Inc.",
      rating: "★★★★★"
    },
    {
      text: "Absolutely beautiful picnic setup in Jaipur. The food was delicious and the ambiance was perfect for our date.",
      author: "Sneha M.",
      rating: "★★★★★"
    }
  ]
  
  testimonialsContainer.innerHTML = testimonials.map(testimonial => `
    <div class="testimonial-card">
      <p class="testimonial-text">"${testimonial.text}"</p>
      <div class="testimonial-footer">
        <span class="testimonial-author">— ${testimonial.author}</span>
        <span class="testimonial-rating">${testimonial.rating}</span>
      </div>
    </div>
  `).join('')
}

// Make functions globally available
window.showModal = showModal
window.hideModal = hideModal
window.showPage = showPage
window.copyMenuLink = copyMenuLink
window.handleNavigation = handleNavigation
window.openBookingForVenue = openBookingForVenue
window.showVenuePage = showVenuePage
window.navigateHome = navigateHome
window.updateAddOnTotal = updateAddOnTotal
window.selectCalendarDate = selectCalendarDate

// Restore venue detail page on browser back/forward
window.addEventListener('popstate', (event) => {
  if (event.state?.venueId) {
    showVenuePage(event.state.venueId, false)
  } else {
    showPage('home-page')
  }
})

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  // Initialize menu preview
  initializeMenuPreview()
  handleMenuPreviewTabs()

  // Check URL parameters
  const urlParams = new URLSearchParams(window.location.search)
  const menuId    = urlParams.get('menu')
  const bookingId = urlParams.get('booking')
  const venueId   = urlParams.get('venue')

  if (menuId) {
    showPage('menu-selection-page')
    loadMenuSelection(menuId)
    if (bookingId) {
      appState.currentBooking = { id: parseInt(bookingId, 10) }
    }
  } else if (venueId) {
    loadVenues().then(() => showVenuePage(parseInt(venueId, 10), false))
  }

  // Event listeners
  const bookPicnicBtn = document.getElementById('book-picnic-btn')
  if (bookPicnicBtn) {
    bookPicnicBtn.addEventListener('click', () => showModal('booking-modal'))
  }

  const closeBookingModalBtn = document.getElementById('close-booking-modal')
  if (closeBookingModalBtn) {
    closeBookingModalBtn.addEventListener('click', () => hideModal('booking-modal'))
  }

  const cancelBookingBtn = document.getElementById('cancel-booking')
  if (cancelBookingBtn) {
    cancelBookingBtn.addEventListener('click', () => hideModal('booking-modal'))
  }

  const bookingForm = document.getElementById('booking-form')
  if (bookingForm) bookingForm.addEventListener('submit', handleBookingSubmit)

  const adminLoginForm = document.getElementById('admin-login-form')
  if (adminLoginForm) adminLoginForm.addEventListener('submit', handleAdminLogin)

  const adminLogoutBtn = document.getElementById('admin-logout')
  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener('click', handleAdminLogout)
  }

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
    preferredDateInput.min = new Date().toISOString().split('T')[0]
  }

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
      if (venue) openBookingForVenue(venue)
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
    if (event.target.classList.contains('confirm-booking-btn')) { confirmBooking(event.target.getAttribute('data-id')); return }
    if (event.target.classList.contains('generate-menu-btn')) { generateBookingMenuLink(event.target.getAttribute('data-booking-id')); return }
    if (event.target.classList.contains('copy-menu-btn')) { copyBookingMenuLink(event.target.getAttribute('data-booking-id')); return }
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
})
