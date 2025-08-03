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

  // Basic validations could be here, or rely on form validation

  try {
    const { data, error } = await supabase.from('bookings').insert([lead]).select()
    if (error) throw error
    appState.currentBooking = data[0]
    showToast('Booking submitted! You will receive a menu link shortly.', 'success')
    // You could redirect or show next steps here
  } catch (error) {
    console.error(error)
    showToast('Error submitting booking. Please try again.', 'error')
  }
}

// Admin login
function handleAdminLogin(event) {
  event.preventDefault()
  const password = event.target['admin-password'].value
  if (password === 'admin123') {
    appState.isAdminLoggedIn = true
    showToast('Admin logged in', 'success')
    // Show admin dashboard UI here
  } else {
    showToast('Invalid password', 'error')
  }
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
    // Show or copy generated link to admin UI
    showToast('Menu link generated', 'success')
    return data[0]
  } catch (error) {
    console.error(error)
    showToast('Failed to generate menu link', 'error')
  }
}

// Load existing leads for admin
async function loadLeads() {
  if (!appState.isAdminLoggedIn) return
  try {
    const { data, error } = await supabase.from('bookings').select().order('created_at', { ascending: false })
    if (error) throw error
    // Render leads in admin UI
  } catch (error) {
    console.error(error)
  }
}

// On page load
window.addEventListener('DOMContentLoaded', () => {
  // Attach event listeners for forms and buttons

  const bookingForm = document.getElementById('booking-form')
  if (bookingForm) bookingForm.addEventListener('submit', handleBookingSubmit)

  const adminLoginForm = document.getElementById('admin-login-form')
  if (adminLoginForm) adminLoginForm.addEventListener('submit', handleAdminLogin)

  // More UI handlers: admin logout, tab switch, menu link generation, menu selection page, etc.

  // Render testimonials dynamically from a JS object or fetched data

  // Show/hide pages and modals based on navigation

  // Implement menu link parsing from URL querystring to load menu selection page
})
