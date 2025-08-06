import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Supabase environment variables are missing!')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Menu Data
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

// App state
const appState = {
  isAdminLoggedIn: false,
  currentBooking: null,
  currentMenuLink: null,
  currentOrder: null,
  selectedItems: {}
}

// Helper functions
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

function showModal(modalId) {
  const modal = document.getElementById(modalId)
  if (modal) modal.classList.remove('hidden')
}

function hideModal(modalId) {
  const modal = document.getElementById(modalId)
  if (modal) modal.classList.add('hidden')
}

function showPage(pageId) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'))
  
  // Show target page
  const targetPage = document.getElementById(pageId)
  if (targetPage) targetPage.classList.add('active')
  
  // Update navigation
  document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'))
  const activeNavLink = document.querySelector(`[data-route="${pageId.replace('-page', '')}"]`)
  if (activeNavLink) activeNavLink.classList.add('active')
}

// Initialize menu preview - THIS IS THE KEY FIX
function initializeMenuPreview() {
  console.log('Initializing menu preview...')
  
  const foodsGrid = document.getElementById('food-preview-grid')
  const beveragesGrid = document.getElementById('beverage-preview-grid')
  
  if (foodsGrid) {
    console.log('Populating food grid with', foodList.length, 'items')
    foodsGrid.innerHTML = foodList.map(item => `
      <div class="menu-item-preview">
        <h4>${item}</h4>
        <p>Deliciously prepared</p>
      </div>
    `).join('')
  } else {
    console.error('Food grid not found!')
  }
  
  if (beveragesGrid) {
    console.log('Populating beverage grid with', bevList.length, 'items')
    beveragesGrid.innerHTML = bevList.map(item => `
      <div class="menu-item-preview">
        <h4>${item}</h4>
        <p>Refreshing drink</p>
      </div>
    `).join('')
  } else {
    console.error('Beverage grid not found!')
  }
}

// Handle menu preview tabs - FIXED VERSION
function handleMenuPreviewTabs() {
  const menuTabBtns = document.querySelectorAll('.menu-tab-btn')
  console.log('Setting up menu tabs for', menuTabBtns.length, 'buttons')
  
  menuTabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      const tab = btn.dataset.tab
      console.log('Tab clicked:', tab)
      
      // Update button states
      menuTabBtns.forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      
      // Show/hide content
      document.querySelectorAll('.menu-tab-content').forEach(content => {
        content.style.display = 'none'
      })
      
      const targetContent = document.getElementById(`${tab}-preview`)
      if (targetContent) {
        targetContent.style.display = 'block'
        console.log('Showing content for:', tab)
      }
    })
  })
}

// Booking form submit - FIXED TO SHOW SUCCESS PAGE
async function handleBookingSubmit(event) {
  event.preventDefault()
  console.log('Form submitted!')
  
  const form = event.target
  const formData = new FormData(form)
  
  const lead = {
    full_name: formData.get('full-name').trim(),
    mobile_number: formData.get('mobile-number').trim(),
    email_address: formData.get('email-address').trim(),
    location: formData.get('location'),
    guest_count: parseInt(formData.get('guest-count'), 10),
    preferred_date: formData.get('preferred-date'),
    special_requirements: formData.get('special-requirements').trim(),
    confirmed: false,
    advance_amount: 0,
    created_at: new Date().toISOString(),
  }

  try {
    const { data, error } = await supabase.from('bookings').insert([lead]).select()
    if (error) throw error

    appState.currentBooking = data[0]
    console.log('Booking saved:', data[0])
    
    showToast('Query submitted! We will contact you soon.', 'success')
    hideModal('booking-modal')
    form.reset()
    
    // THIS IS THE CRITICAL FIX - Show success page
    console.log('Redirecting to success page...')
    showPage('query-success-page')
    
  } catch (error) {
    console.error('Error submitting booking:', error)
    showToast('Error submitting query. Please try again.', 'error')
  }
}

// Admin functions
function handleAdminLogin(event) {
  event.preventDefault()
  const password = event.target['admin-password'].value
  
  if (password === 'admin123') {
    appState.isAdminLoggedIn = true
    showToast('Admin logged in', 'success')
    
    document.getElementById('admin-login').classList.add('hidden')
    document.getElementById('admin-dashboard').classList.remove('hidden')
    
    loadQueries()
    loadMenuLinks()
  } else {
    showToast('Invalid password', 'error')
  }
}

function handleAdminLogout() {
  appState.isAdminLoggedIn = false
  showToast('Logged out', 'success')
  
  document.getElementById('admin-login').classList.remove('hidden')
  document.getElementById('admin-dashboard').classList.add('hidden')
  
  const adminForm = document.getElementById('admin-login-form')
  if (adminForm) adminForm.reset()
}

// Generate menu link
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
    const { data: bookings, error: bErr } = await supabase
      .from('bookings')
      .select()
      .eq('confirmed', true)
      .order('created_at', { ascending: false })
    
    if (bErr) throw bErr

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

// Load menu links
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

// Render queries
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

// Render bookings
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

// Initialize on page load - THE COMPLETE SOLUTION
function initializeApp() {
  console.log('App initializing...')
  
  // Initialize menu preview FIRST
  initializeMenuPreview()
  handleMenuPreviewTabs()
  
  // Load testimonials
  loadTestimonials()

  // Event listeners for buttons
  const bookPicnicBtn = document.getElementById('book-picnic-btn')
  if (bookPicnicBtn) {
    bookPicnicBtn.addEventListener('click', () => {
      console.log('Book picnic button clicked')
      showModal('booking-modal')
    })
  }

  // Modal controls
  const closeBookingModalBtn = document.getElementById('close-booking-modal')
  if (closeBookingModalBtn) {
    closeBookingModalBtn.addEventListener('click', () => hideModal('booking-modal'))
  }

  const cancelBookingBtn = document.getElementById('cancel-booking')
  if (cancelBookingBtn) {
    cancelBookingBtn.addEventListener('click', () => hideModal('booking-modal'))
  }

  // Form submission - THE MOST CRITICAL PART
  const bookingForm = document.getElementById('booking-form')
  if (bookingForm) {
    console.log('Setting up booking form listener')
    bookingForm.addEventListener('submit', handleBookingSubmit)
  } else {
    console.error('Booking form not found!')
  }

  // Admin functionality
  const adminLoginForm = document.getElementById('admin-login-form')
  if (adminLoginForm) adminLoginForm.addEventListener('submit', handleAdminLogin)

  const adminLogoutBtn = document.getElementById('admin-logout')
  if (adminLogoutBtn) adminLogoutBtn.addEventListener('click', handleAdminLogout)

  // Navigation
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

  // Modal close on outside click
  const bookingModal = document.getElementById('booking-modal')
  if (bookingModal) {
    bookingModal.addEventListener('click', (event) => {
      if (event.target === bookingModal) {
        hideModal('booking-modal')
      }
    })
  }

  // Set minimum date
  const preferredDateInput = document.getElementById('preferred-date')
  if (preferredDateInput) {
    const today = new Date().toISOString().split('T')[0]
    preferredDateInput.min = today
  }

  // Event delegation for admin actions
  document.addEventListener('click', (event) => {
    // Confirm booking
    if (event.target.classList.contains('confirm-booking-btn')) {
      const queryId = event.target.getAttribute('data-id')
      confirmBooking(queryId)
    }
  })

  console.log('App initialization complete!')
}

// MAIN INITIALIZATION - The complete solution
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp)
} else {
  initializeApp()
}
