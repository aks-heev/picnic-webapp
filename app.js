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
  toast.className = `toast show toast--${type}`
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

// Booking form submit handler - UPDATED to set confirmed = false by default
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
    confirmed: false, // NEW: Default to false (query)
    advance_amount: 0, // NEW: Default to 0
    created_at: new Date().toISOString(),
  }

  try {
    const { data, error } = await supabase.from('bookings').insert([lead]).select()
    if (error) throw error
    
    appState.currentBooking = data[0]
    showToast('Query submitted! We will contact you soon.', 'success')
    hideModal('booking-modal')
    form.reset()
    
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

// NEW: Load queries (unconfirmed bookings)
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

// NEW: Load bookings (confirmed bookings)
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

// NEW: Render queries (unconfirmed bookings) with confirm functionality
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
        <button class="btn btn--primary confirm-booking-btn" data-id="${query.id}">
          Confirm Booking
        </button>
      </div>
    </div>
  `).join('')
}

// NEW: Render bookings (confirmed bookings) with menu link generator
function renderBookings(bookings) {
  const container = document.getElementById('bookings-container')
  if (!container) return

  if (!bookings.length) {
    container.innerHTML = '<p>No confirmed bookings yet.</p>'
    return
  }

  container.innerHTML = bookings.map(booking => `
    <div class="booking-item" data-id="${booking.id}">
      <div class="booking-header">
        <h4>Booking #${booking.id} — ₹${booking.advance_amount} advance</h4>
        <p>${booking.full_name} | ${new Date(booking.preferred_date).toLocaleDateString()}</p>
      </div>

      <h5>Previous Orders:</h5>
      <ul>
        ${booking.orders.map(o =>
          `<li>Order #${o.id} — ${o.selected_items.map(i=>i.name+'×'+i.quantity).join(', ')}</li>`
        ).join('')}
      </ul>

      <!-- Menu Generator Controls -->
      <div class="menu-generator">
        <div class="control-group">
          <label>Food Items (1-15):</label>
          <input type="number" id="food-count-${booking.id}" min="1" max="15" value="${booking.max_food_items||3}">
        </div>
        <div class="control-group">
          <label>Beverages (1-10):</label>
          <input type="number" id="bev-count-${booking.id}" min="1" max="10" value="${booking.max_bev_items||2}">
        </div>
        <button class="btn btn--secondary generate-menu-btn" data-booking-id="${booking.id}">
          Generate Link
        </button>
      </div>

      <div id="generated-link-${booking.id}" class="generated-link" style="display:none;">
        <label>Link:</label>
        <input type="text" id="menu-url-${booking.id}" readonly>
        <button class="btn btn--outline copy-menu-btn" data-booking-id="${booking.id}">Copy</button>
      </div>
    </div>
  `).join('')
}



// Render menu links in admin dashboard
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

// Copy menu link to clipboard
function copyMenuLink(linkId) {
  const url = `${window.location.origin}?menu=${linkId}`
  navigator.clipboard.writeText(url).then(() => {
    showToast('Menu link copied to clipboard', 'success')
  }).catch(() => {
    showToast('Failed to copy link', 'error')
  })
}

// NEW: Confirm booking function
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
    
    // Refresh both queries and bookings
    loadQueries()
    loadBookings()
    
  } catch (error) {
    console.error(error)
    showToast('Failed to confirm booking', 'error')
  }
}

// NEW: Generate menu link for specific booking
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
    
    // Show generated link in the booking row WITH booking ID
    const generatedLinkDiv = document.getElementById(`generated-link-${bookingId}`)
    const linkInput = document.getElementById(`menu-url-${bookingId}`)
    
    if (generatedLinkDiv && linkInput) {
      const fullUrl = `${window.location.origin}?menu=${data[0].id}&booking=${bookingId}`
      linkInput.value = fullUrl
      generatedLinkDiv.style.display = 'block'
    }
    
    showToast('Menu link generated for booking!', 'success')
    loadMenuLinks() // Refresh menu links list
    
  } catch (error) {
    console.error(error)
    showToast('Failed to generate menu link', 'error')
  }
}


// NEW: Copy booking menu link
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

// Handle tab switching in admin dashboard - UPDATED for new tabs
function switchTab(tabName) {
  const allTabContents = document.querySelectorAll('.tab-content')
  allTabContents.forEach(content => {
    content.classList.remove('active')
    content.hidden = true
  })
  
  const allTabButtons = document.querySelectorAll('.tab-btn')
  allTabButtons.forEach(button => {
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
  
  // Load appropriate data based on tab
  if (tabName === 'queries') {
    loadQueries()
  } else if (tabName === 'bookings') {
    loadBookings()
  } else if (tabName === 'menu-link') {
    loadMenuLinks()
  }
}

// Handle navigation
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

// *** MENU SELECTION FUNCTIONALITY WITH TOTAL CATEGORY LIMITS ***
// Load menu selection for specific menu link
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

// Helper: Calculate current totals by category
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

// Helper: Check if adding one more item would exceed category limit
function withinCategoryLimit(category) {
  const { totalFood, totalBev } = getCurrentTotals()
  const maxFood = appState.currentMenuLink.max_food_items
  const maxBev = appState.currentMenuLink.max_bev_items
  
  if (category === 'food') {
    return totalFood < maxFood
  } else {
    return totalBev < maxBev
  }
}

// Render menu selection page - FIXED WITH TOTAL CATEGORY LIMITS
function renderMenuSelection(menuLink) {
  const container = document.getElementById('menu-selection-page')
  if (!container) return
  
  const maxFood = menuLink.max_food_items
  const maxBev = menuLink.max_bev_items
  
  container.innerHTML = `
    <div class="page-header">
      <h1>Select Your Menu</h1>
      <p>Choose up to <strong>${maxFood} total food items</strong> and <strong>${maxBev} total beverage items</strong> for your picnic.</p>
      <p class="help-text">Mix and match any combination - e.g., 2 Parathas + 1 Maggi = 3 food items total</p>
    </div>
    
    <div class="menu-sections">
      <div class="menu-section">
        <h2>Food Items <span class="item-count">(${maxFood} total items allowed)</span></h2>
        <div class="selection-items">
          ${foodList.map(item => `
            <div class="selection-item">
              <div class="selection-item-info">
                <h4>${item}</h4>
                <p>Delicious ${item.toLowerCase()}</p>
              </div>
              <div class="quantity-selector">
                <button class="quantity-btn" data-item="${item}" data-category="food" data-change="-1" disabled>-</button>
                <input type="number" class="quantity-input" value="0" min="0" max="5" 
                       id="food-${item.replace(/\s+/g, '-').toLowerCase()}" readonly>
                <button class="quantity-btn" data-item="${item}" data-category="food" data-change="1">+</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="menu-section">
        <h2>Beverages <span class="item-count">(${maxBev} total items allowed)</span></h2>
        <div class="selection-items">
          ${bevList.map(item => `
            <div class="selection-item">
              <div class="selection-item-info">
                <h4>${item}</h4>
                <p>Refreshing ${item.toLowerCase()}</p>
              </div>
              <div class="quantity-selector">
                <button class="quantity-btn" data-item="${item}" data-category="beverage" data-change="-1" disabled>-</button>
                <input type="number" class="quantity-input" value="0" min="0" max="5" 
                       id="beverage-${item.replace(/\s+/g, '-').toLowerCase()}" readonly>
                <button class="quantity-btn" data-item="${item}" data-category="beverage" data-change="1">+</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    
    <div class="selection-summary">
      <h3>Your Selection</h3>
      <div id="selection-summary-content">
        <p>No items selected yet.</p>
      </div>
      <div class="total-items">
        <strong>Total Food Items: <span id="total-food">0</span>/${maxFood} | Total Beverages: <span id="total-bev">0</span>/${maxBev}</strong>
      </div>
      <button id="submit-menu-selection" class="btn btn--primary btn--full-width" disabled>
        Submit Menu Selection
      </button>
    </div>
  `
  
  // Initialize button states
  updateButtonStates()
}

// Update quantity for menu items - FIXED WITH TOTAL CATEGORY LIMITS
function updateQuantity(itemName, category, change) {
  if (!appState.currentMenuLink) return
  
  const inputId = `${category}-${itemName.replace(/\s+/g, '-').toLowerCase()}`
  const input = document.getElementById(inputId)
  
  if (!input) {
    console.error('Input not found:', inputId)
    return
  }
  
  const currentValue = parseInt(input.value, 10) || 0
  let newValue = currentValue + change
  
  // Apply constraints
  if (change > 0) {
    // Check if we can add more items to this category
    if (!withinCategoryLimit(category)) {
      const categoryName = category === 'food' ? 'food' : 'beverage'
      const limit = category === 'food' ? appState.currentMenuLink.max_food_items : appState.currentMenuLink.max_bev_items
      showToast(`Maximum ${limit} ${categoryName} items allowed in total`, 'error')
      return
    }
    // Individual item limit of 5
    newValue = Math.min(newValue, 5)
  } else {
    // Ensure minimum is 0
    newValue = Math.max(0, newValue)
  }
  
  // Update input value
  input.value = newValue
  
  // Update app state
  const key = `${category}-${itemName}`
  if (newValue > 0) {
    appState.selectedItems[key] = { name: itemName, quantity: newValue, category }
  } else {
    delete appState.selectedItems[key]
  }
  
  // Update UI
  updateSelectionSummary()
  updateButtonStates()
}

// Helper: Update button states based on category limits
function updateButtonStates() {
  if (!appState.currentMenuLink) return
  
  const { totalFood, totalBev } = getCurrentTotals()
  const maxFood = appState.currentMenuLink.max_food_items
  const maxBev = appState.currentMenuLink.max_bev_items
  
  // Update all food buttons
  foodList.forEach(item => {
    const inputId = `food-${item.replace(/\s+/g, '-').toLowerCase()}`
    const input = document.getElementById(inputId)
    if (!input) return
    
    const currentValue = parseInt(input.value, 10) || 0
    const plusBtn = document.querySelector(`[data-item="${item}"][data-category="food"][data-change="1"]`)
    const minusBtn = document.querySelector(`[data-item="${item}"][data-category="food"][data-change="-1"]`)
    
    if (plusBtn) {
      // Disable + button if total food limit reached OR individual item at max (5)
      plusBtn.disabled = (totalFood >= maxFood) || (currentValue >= 5)
    }
    
    if (minusBtn) {
      minusBtn.disabled = currentValue <= 0
    }
  })
  
  // Update all beverage buttons
  bevList.forEach(item => {
    const inputId = `beverage-${item.replace(/\s+/g, '-').toLowerCase()}`
    const input = document.getElementById(inputId)
    if (!input) return
    
    const currentValue = parseInt(input.value, 10) || 0
    const plusBtn = document.querySelector(`[data-item="${item}"][data-category="beverage"][data-change="1"]`)
    const minusBtn = document.querySelector(`[data-item="${item}"][data-category="beverage"][data-change="-1"]`)
    
    if (plusBtn) {
      // Disable + button if total beverage limit reached OR individual item at max (5)
      plusBtn.disabled = (totalBev >= maxBev) || (currentValue >= 5)
    }
    
    if (minusBtn) {
      minusBtn.disabled = currentValue <= 0
    }
  })
}

// Update selection summary
function updateSelectionSummary() {
  const selectedItems = Object.values(appState.selectedItems)
  const { totalFood, totalBev } = getCurrentTotals()
  
  // Update totals display
  const totalFoodSpan = document.getElementById('total-food')
  const totalBevSpan = document.getElementById('total-bev')
  
  if (totalFoodSpan) totalFoodSpan.textContent = totalFood
  if (totalBevSpan) totalBevSpan.textContent = totalBev
  
  // Update summary content
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
  
  // Enable/disable submit button
  const submitBtn = document.getElementById('submit-menu-selection')
  const maxFood = appState.currentMenuLink?.max_food_items || 0
  const maxBev = appState.currentMenuLink?.max_bev_items || 0
  
  if (submitBtn) {
    const isValid = totalFood <= maxFood && totalBev <= maxBev && selectedItems.length > 0
    submitBtn.disabled = !isValid
    
    // Update submit button text with helpful message
    if (selectedItems.length === 0) {
      submitBtn.textContent = 'Select Items to Continue'
    } else if (totalFood > maxFood || totalBev > maxBev) {
      submitBtn.textContent = 'Too Many Items Selected'
    } else {
      submitBtn.textContent = 'Submit Menu Selection'
    }
  }
}

// Submit menu selection
async function submitMenuSelection() {
  const selectedItems = Object.values(appState.selectedItems)
  try {
    const orderPayload = {
      menu_link_id: appState.currentMenuLink.id,
      booking_id: appState.currentBooking.id,      // booking’s bigint ID
      selected_items: selectedItems,
      created_at: new Date().toISOString(),
    }
    const { data, error } = await supabase
      .from('orders')
      .insert([orderPayload])
      .select()
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
        
        <div class="next-steps">
          <h3>Next Steps</h3>
          <ul>
            <li>We will contact you within 24 hours to confirm your booking</li>
            <li>Final menu confirmation and dietary adjustments can be made during the call</li>
            <li>Payment details and picnic setup will be discussed</li>
            <li>We'll send you the exact location and timing details</li>
          </ul>
        </div>
      </div>
    </div>
    
    <div class="confirmation-actions">
      <button class="btn btn--primary" onclick="handleNavigation('home')">Back to Home</button>
      <button class="btn btn--secondary" onclick="window.print()">Print Confirmation</button>
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

// On page load
window.addEventListener('DOMContentLoaded', () => {
  // Check URL for menu parameter
  const urlParams = new URLSearchParams(window.location.search)
  const menuId = urlParams.get('menu')
  const bookingId = urlParams.get('booking')
  
  if (menuId) {
    showPage('menu-selection-page')
    loadMenuSelection(menuId)
    
    // Set booking ID if provided in URL
    if (bookingId) {
      appState.currentBooking = { id: parseInt(bookingId, 10) }
    }
  }

  // Main CTA button
  const bookPicnicBtn = document.getElementById('book-picnic-btn')
  if (bookPicnicBtn) {
    bookPicnicBtn.addEventListener('click', () => {
      showModal('booking-modal')
    })
  }

  // Modal close buttons
  const closeBookingModalBtn = document.getElementById('close-booking-modal')
  if (closeBookingModalBtn) {
    closeBookingModalBtn.addEventListener('click', () => {
      hideModal('booking-modal')
    })
  }

  const cancelBookingBtn = document.getElementById('cancel-booking')
  if (cancelBookingBtn) {
    cancelBookingBtn.addEventListener('click', () => {
      hideModal('booking-modal')
    })
  }

  // Form submissions
  const bookingForm = document.getElementById('booking-form')
  if (bookingForm) bookingForm.addEventListener('submit', handleBookingSubmit)

  const adminLoginForm = document.getElementById('admin-login-form')
  if (adminLoginForm) adminLoginForm.addEventListener('submit', handleAdminLogin)

  // Admin logout
  const adminLogoutBtn = document.getElementById('admin-logout')
  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener('click', handleAdminLogout)
  }

  // Close modal when clicking outside
  const bookingModal = document.getElementById('booking-modal')
  if (bookingModal) {
    bookingModal.addEventListener('click', (event) => {
      if (event.target === bookingModal) {
        hideModal('booking-modal')
      }
    })
  }

  // Navigation links
  const navLinks = document.querySelectorAll('.nav-link')
  navLinks.forEach(link => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      const route = link.getAttribute('data-route')
      handleNavigation(route)
    })
  })

  // Admin tab buttons
  const tabButtons = document.querySelectorAll('.tab-btn')
  tabButtons.forEach(button => {
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

  // Copy generated link button
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

  // Set minimum date for booking form (today)
  const preferredDateInput = document.getElementById('preferred-date')
  if (preferredDateInput) {
    const today = new Date().toISOString().split('T')[0]
    preferredDateInput.min = today
  }

  // Load testimonials
  loadTestimonials()

  // Event delegation for dynamically created buttons
  document.addEventListener('click', (event) => {
    // 1. Quantity buttons
    if (event.target.classList.contains('quantity-btn') && !event.target.disabled) {
      const itemName = event.target.dataset.item
      const category = event.target.dataset.category
      const change = parseInt(event.target.dataset.change, 10)
      updateQuantity(itemName, category, change)
    }

    // 2. Submit menu selection
    if (event.target.id === 'submit-menu-selection') {
      submitMenuSelection()
    }

    // 3. Confirm booking in Queries tab
    if (event.target.classList.contains('confirm-booking-btn')) {
      const queryId = event.target.dataset.id
      confirmBooking(queryId)
    }

    // 4. Generate per-booking menu link
    if (event.target.classList.contains('generate-menu-btn')) {
      const bookingId = event.target.dataset.bookingId
      generateBookingMenuLink(bookingId)
    }

    // 5. Copy per-booking menu link
    if (event.target.classList.contains('copy-menu-btn')) {
      const bookingId = event.target.dataset.bookingId
      copyBookingMenuLink(bookingId)
    }
  })
})