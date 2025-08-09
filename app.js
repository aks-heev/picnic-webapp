import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client with environment variables set by the bundler/environment
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    'Supabase environment variables are missing! Please set SUPABASE_URL and SUPABASE_ANON_KEY.'
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
  isAdminLoggedIn: false,
  currentBooking: null,
  currentMenuLink: null,
  currentOrder: null,
  selectedItems: {}
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

// Booking form submit handler - UPDATED to show success page
async function handleBookingSubmit(event) {
  event.preventDefault()
  const form = event.target

  // Gather form data
  const lead = {
    full_name: form['full-name'].value.trim(),
    mobile_number: form['mobile-number'].value.trim(),
    email_address: form['email-address'].value.trim(),
    location: form['location'].value,
    guest_count: parseInt(form['guest-count'].value, 10),
    preferred_date: form['preferred-date'].value,
    special_requirements: form['special-requirements'].value.trim(),
    confirmed: false, // Default to false (query)
    advance_amount: 0, // Default to 0
    created_at: new Date().toISOString(),
  }

  try {
    const { data, error } = await supabase.from('bookings').insert([lead]).select()
    if (error) throw error

    appState.currentBooking = data[0]
    showToast('Query submitted! We will contact you soon.', 'success')
    hideModal('booking-modal')
    form.reset()
    
    // Show success page instead of going back to home
    showPage('query-success-page')
    
  } catch (error) {
    console.error(error)
    showToast('Error submitting query. Please try again.', 'error')
  }
}

// Admin login
function handleAdminLogin(event) {
  event.preventDefault()
  const password = event.target['admin-password'].value
  
  if (password === 'admin123') {
    appState.isAdminLoggedIn = true
    showToast('Admin logged in', 'success')
    
    // Show admin dashboard
    const adminLogin = document.getElementById('admin-login')
    const adminDashboard = document.getElementById('admin-dashboard')
    if (adminLogin) adminLogin.classList.add('hidden')
    if (adminDashboard) adminDashboard.classList.remove('hidden')
    
    // Load initial data
    loadQueries()
    loadMenuLinks()
  } else {
    showToast('Invalid password', 'error')
  }
}

// Admin logout
function handleAdminLogout() {
  appState.isAdminLoggedIn = false
  showToast('Logged out', 'success')
  
  // Show login form, hide dashboard
  const adminLogin = document.getElementById('admin-login')
  const adminDashboard = document.getElementById('admin-dashboard')
  if (adminLogin) adminLogin.classList.remove('hidden')
  if (adminDashboard) adminDashboard.classList.add('hidden')
  
  // Reset admin form
  const adminForm = document.getElementById('admin-login-form')
  if (adminForm) adminForm.reset()
}

// Generate menu link with limits
async function generateMenuLink(foodCount, bevCount) {
  if (!appState.isAdminLoggedIn) return showToast('Admin login required', 'error')
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
  if (!appState.isAdminLoggedIn) return
  
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select()
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
  if (!appState.isAdminLoggedIn) return
  
  try {
    // Fetch confirmed bookings
    const { data: bookings, error: bErr } = await supabase
      .from('bookings')
      .select()
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
  if (!appState.isAdminLoggedIn) return
  
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
  
  container.innerHTML = queries.map(query => `
    <div class="query-item" data-id="${query.id}">
      <div class="query-header">
        <span class="query-name">${query.full_name}</span>
        <span class="query-date">${new Date(query.created_at).toLocaleDateString()}</span>
      </div>
      <div class="query-details">
        <div class="query-detail"><strong>Mobile:</strong> ${query.mobile_number}</div>
        <div class="query-detail"><strong>Email:</strong> ${query.email_address}</div>
        <div class="query-detail"><strong>Location:</strong> ${query.location}</div>
        <div class="query-detail"><strong>Guests:</strong> ${query.guest_count}</div>
        <div class="query-detail"><strong>Date:</strong> ${new Date(query.preferred_date).toLocaleDateString()}</div>
        ${query.special_requirements ? `<div class="query-detail"><strong>Requirements:</strong> ${query.special_requirements}</div>` : ''}
      </div>
      <div class="query-actions">
        <div class="advance-input-group">
          <label for="advance-${query.id}">Advance Amount:</label>
          <input type="number" id="advance-${query.id}" placeholder="Enter amount" min="0" step="0.01">
        </div>
        <button class="confirm-booking-btn" data-id="${query.id}">
          Confirm Booking
        </button>
      </div>
    </div>
  `).join('')
}

// Render bookings (confirmed bookings) 
function renderBookings(bookings) {
  const container = document.getElementById('bookings-container')
  if (!container) return
  
  if (!bookings || bookings.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No confirmed bookings yet</h3><p>Confirmed bookings will appear here.</p></div>'
    return
  }
  
  container.innerHTML = bookings.map(booking => `
    <div class="booking-item" data-id="${booking.id}">
      <div class="booking-header">
        <span class="booking-name">${booking.full_name}</span>
        <span class="booking-date">${new Date(booking.created_at).toLocaleDateString()}</span>
        <span class="advance-badge">₹${booking.advance_amount || 0} paid</span>
      </div>
      <div class="booking-details">
        <div class="booking-detail"><strong>Mobile:</strong> ${booking.mobile_number}</div>
        <div class="booking-detail"><strong>Email:</strong> ${booking.email_address}</div>
        <div class="booking-detail"><strong>Location:</strong> ${booking.location}</div>
        <div class="booking-detail"><strong>Guests:</strong> ${booking.guest_count}</div>
        <div class="booking-detail"><strong>Date:</strong> ${new Date(booking.preferred_date).toLocaleDateString()}</div>
        ${booking.special_requirements ? `<div class="booking-detail"><strong>Requirements:</strong> ${booking.special_requirements}</div>` : ''}
      </div>

      <h5>Previous Orders:</h5>
      <ul>
        ${booking.orders.map(o =>
          `<li>Order #${o.id} — ${o.selected_items.map(i=>i.name+'×'+i.quantity).join(', ')}</li>`
        ).join('')}
      </ul>

      <div class="menu-generator">
        <div class="menu-controls">
          <div class="control-group">
            <label for="food-count-${booking.id}">Food Items:</label>
            <input type="number" id="food-count-${booking.id}" value="3" min="1" max="15">
          </div>
          <div class="control-group">
            <label for="bev-count-${booking.id}">Beverages:</label>
            <input type="number" id="bev-count-${booking.id}" value="2" min="1" max="10">
          </div>
          <button class="generate-menu-btn" data-booking-id="${booking.id}">
            Generate Menu Link
          </button>
        </div>
        <div class="generated-menu-link" id="generated-link-${booking.id}" style="display: none;">
          <label>Generated Link:</label>
          <div class="link-container">
            <input type="text" id="menu-url-${booking.id}" readonly>
            <button class="copy-menu-btn" data-booking-id="${booking.id}">Copy</button>
          </div>
        </div>
      </div>
    </div>
  `).join('')
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
                <span class="selected-item-name">${item.name}</span>
                <span class="selected-item-quantity">${item.quantity}x</span>
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

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  // Initialize menu preview
  initializeMenuPreview()
  handleMenuPreviewTabs()
  
  // Check URL parameters
  const urlParams = new URLSearchParams(window.location.search)
  const menuId = urlParams.get('menu')
  const bookingId = urlParams.get('booking')
  
  if (menuId) {
    showPage('menu-selection-page')
    loadMenuSelection(menuId)
    
    if (bookingId) {
      appState.currentBooking = { id: parseInt(bookingId, 10) }
    }
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

  // Modal close on outside click
  const bookingModal = document.getElementById('booking-modal')
  if (bookingModal) {
    bookingModal.addEventListener('click', (event) => {
      if (event.target === bookingModal) {
        hideModal('booking-modal')
      }
    })
  }

  // Navigation links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      const route = link.getAttribute('data-route')
      handleNavigation(route)
    })
  })

  // Admin tabs
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab')
      switchTab(tabName)
    })
  })

  // Menu link generation
  const generateMenuLinkBtn = document.getElementById('generate-menu-link')
  if (generateMenuLinkBtn) {
    generateMenuLinkBtn.addEventListener('click', () => {
      const foodCount = parseInt(document.getElementById('food-count').value, 10)
      const bevCount = parseInt(document.getElementById('bev-count').value, 10)
      generateMenuLink(foodCount, bevCount)
    })
  }

  // Copy link
  const copyLinkBtn = document.getElementById('copy-link')
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
      const linkInput = document.getElementById('generated-link-url')
      if (linkInput) {
        navigator.clipboard.writeText(linkInput.value).then(() => {
          showToast('Link copied to clipboard', 'success')
        }).catch(() => {
          showToast('Failed to copy link', 'error')
        })
      }
    })
  }

  // Set minimum date
  const preferredDateInput = document.getElementById('preferred-date')
  if (preferredDateInput) {
    const today = new Date().toISOString().split('T')[0]
    preferredDateInput.min = today
  }

  // Load testimonials
  loadTestimonials()

  // Event delegation
  // Event delegation - UPDATED FOR MODERN DESIGN
document.addEventListener('click', (event) => {
  // Modern quantity buttons - FIXED
  if (event.target.closest('.modern-qty-btn') && !event.target.closest('.modern-qty-btn').disabled) {
    const btn = event.target.closest('.modern-qty-btn')
    const itemName = btn.getAttribute('data-item')
    const category = btn.getAttribute('data-category')
    const change = parseInt(btn.getAttribute('data-change'), 10)
    
    updateQuantity(itemName, category, change)
    return
  }
  
  // Legacy quantity buttons (for backward compatibility)
  if (event.target.classList.contains('quantity-btn') && !event.target.disabled) {
    const itemName = event.target.getAttribute('data-item')
    const category = event.target.getAttribute('data-category')
    const change = parseInt(event.target.getAttribute('data-change'), 10)
    
    updateQuantity(itemName, category, change)
    return
  }
  
  // Modern tab buttons
  if (event.target.closest('.modern-tab-btn')) {
    const btn = event.target.closest('.modern-tab-btn')
    const tab = btn.getAttribute('data-tab')
    
    if (tab) {
      // Update button states
      document.querySelectorAll('.modern-tab-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      
      // Show/hide content
      document.querySelectorAll('.modern-tab-content').forEach(content => {
        content.classList.remove('active')
        content.style.display = 'none'
      })
      
      const targetContent = document.getElementById(tab)
      if (targetContent) {
        targetContent.classList.add('active')
        targetContent.style.display = 'block'
      }
    }
    return
  }
  
  // Submit menu selection
  if (event.target.id === 'submit-menu-selection') {
    submitMenuSelection()
    return
  }
  
  // Confirm booking
  if (event.target.classList.contains('confirm-booking-btn')) {
    const queryId = event.target.getAttribute('data-id')
    confirmBooking(queryId)
    return
  }
  
  // Generate menu link for booking
  if (event.target.classList.contains('generate-menu-btn')) {
    const bookingId = event.target.getAttribute('data-booking-id')
    generateBookingMenuLink(bookingId)
    return
  }
  
  // Copy booking menu link
  if (event.target.classList.contains('copy-menu-btn')) {
    const bookingId = event.target.getAttribute('data-booking-id')
    copyBookingMenuLink(bookingId)
    return
  }
  })
})
