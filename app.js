import { createClient } from '@supabase/supabase-js'

// Initialize Supabase
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Supabase environment variables are missing!')
}
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Data arrays
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

// App State
const appState = {
    isAdminLoggedIn: false,
    currentMenuLink: null,
    selectedItems: { food: {}, beverages: {} },
    currentPage: 'home'
}

// Toast notifications
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container')
    if (!container) return
    const toast = document.createElement('div')
    toast.className = `toast ${type}`
    toast.textContent = message
    container.appendChild(toast)
    setTimeout(() => toast.classList.add('show'), 10)
    setTimeout(() => {
        toast.classList.remove('show')
        setTimeout(() => container.removeChild(toast), 300)
    }, 3000)
}

// Booking form submit handler
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
    created_at: new Date().toISOString(),
  }

  try {
    const { data, error } = await supabase.from('bookings').insert([lead]).select()
    if (error) throw error
    appState.currentBooking = data[0]
    showToast('Booking submitted! You will receive a menu link shortly.', 'success')
    // TODO: Show menu button or redirect post booking
  } catch (error) {
    console.error(error)
    showToast('Error submitting booking. Please try again.', 'error')
  }
}

// Admin login handler
function handleAdminLogin(event) {
  event.preventDefault()
  const password = event.target['admin-password'].value
  if (password === 'admin123') { // Change password as needed
    appState.isAdminLoggedIn = true
    showToast('Admin logged in', 'success')
    showAdminDashboard()
  } else {
    showToast('Invalid password', 'error')
  }
}

// Show admin dashboard UI (toggle visibility)
function showAdminDashboard() {
  document.getElementById('admin-login').classList.add('hidden')
  document.getElementById('admin-dashboard').classList.remove('hidden')
  // Load leads, menu links, orders, etc.
  loadLeads()
  loadMenuLinks()
  loadOrders()
}

// Load leads for admin
async function loadLeads() {
  if (!appState.isAdminLoggedIn) return
  try {
    const { data, error } = await supabase.from('bookings').select().order('created_at', { ascending: false })
    if (error) throw error
    // Render leads in the admin UI.
    const container = document.getElementById('leads-container')
    container.innerHTML = '' // Clear existing
    data.forEach(lead => {
      const div = document.createElement('div')
      div.className = 'lead-item'
      div.innerHTML = `
        <div class="lead-header">
          <span class="lead-name">${lead.full_name}</span>
          <span class="lead-date">${new Date(lead.created_at).toLocaleDateString()}</span>
        </div>
        <div class="lead-details">
          <div class="lead-detail"><strong>Mobile:</strong> ${lead.mobile_number}</div>
          <div class="lead-detail"><strong>Email:</strong> ${lead.email_address}</div>
          <div class="lead-detail"><strong>Location:</strong> ${lead.location}</div>
          <div class="lead-detail"><strong>Guests:</strong> ${lead.guest_count}</div>
          <div class="lead-detail"><strong>Date:</strong> ${lead.preferred_date}</div>
        </div>
      `
      container.appendChild(div)
    })
  } catch (error) {
    console.error(error)
  }
}

// Add further functions for menu link generation, orders, navigation, modal handling, etc.

// Navigation helpers to show/hide pages
function navigateToPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  const page = document.getElementById(pageId)
  if (page) page.classList.add('active')

  // Update nav links active state
  document.querySelectorAll('.nav-link').forEach(link =>
    link.classList.toggle('active', link.dataset.route === pageId)
  )
}

// Modal open/close for booking
function openBookingModal() {
  const modal = document.getElementById('booking-modal')
  modal.classList.remove('hidden')
}

function closeBookingModal() {
  const modal = document.getElementById('booking-modal')
  modal.classList.add('hidden')
}

// Setup all event listeners after DOM loaded
window.addEventListener('DOMContentLoaded', () => {
  // Navigation links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault()
      const page = link.dataset.route
      if (page === 'home') {
        navigateToPage('home-page')
      } else if (page === 'menu-preview') {
        navigateToPage('menu-preview-page')
      } else if (page === 'admin') {
        navigateToPage('admin-page')
      }
    })
  })

  // Booking Button
  const bookPicnicBtn = document.getElementById('book-picnic-btn')
  if (bookPicnicBtn) {
    bookPicnicBtn.addEventListener('click', () => {
      openBookingModal()
    })
  }

  // Booking modal close button
  const closeBookingBtn = document.getElementById('close-booking-modal')
  if (closeBookingBtn) {
    closeBookingBtn.addEventListener('click', () => {
      closeBookingModal()
    })
  }

  // Booking form submission
  const bookingForm = document.getElementById('booking-form')
  if (bookingForm) {
    bookingForm.addEventListener('submit', handleBookingSubmit)
  }

  // Admin login form
  const adminLoginForm = document.getElementById('admin-login-form')
  if (adminLoginForm) {
    adminLoginForm.addEventListener('submit', handleAdminLogin)
  }

  // Initial page
  navigateToPage('home-page')
})
