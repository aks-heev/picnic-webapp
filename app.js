// Customer-facing script only

// Menu data
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
// In app.js, after definitions of foodList and bevList, add:

function renderMenuItems() {
  const foodContainer = document.querySelector('#food-items .modern-menu-grid');
  const bevContainer = document.querySelector('#bev-items .modern-menu-grid');

  foodContainer.innerHTML = foodList.map(item => `
    <div class="modern-menu-item">
      <div class="item-info">
        <h4 class="item-name">${item}</h4>
      </div>
      <div class="modern-quantity-controls">
        <button class="modern-qty-btn minus" data-item="${item}" data-category="food" data-change="-1" disabled>−</button>
        <span class="modern-qty-display" id="qty-food-${item.replace(/\s+/g,'-').toLowerCase()}">0</span>
        <button class="modern-qty-btn plus" data-item="${item}" data-category="food" data-change="1">+</button>
      </div>
    </div>
  `).join('');

  bevContainer.innerHTML = bevList.map(item => `
    <div class="modern-menu-item">
      <div class="item-info">
        <h4 class="item-name">${item}</h4>
      </div>
      <div class="modern-quantity-controls">
        <button class="modern-qty-btn minus" data-item="${item}" data-category="bev" data-change="-1" disabled>−</button>
        <span class="modern-qty-display" id="qty-bev-${item.replace(/\s+/g,'-').toLowerCase()}">0</span>
        <button class="modern-qty-btn plus" data-item="${item}" data-category="bev" data-change="1">+</button>
      </div>
    </div>
  `).join('');
}

// Call on page load
window.addEventListener('DOMContentLoaded', () => {
  renderMenuItems();
  handleMenuSelectionTabs();  // ensure tab click logic attached
  // existing init code...
});

// App state
const appState = {
  currentBooking: null,
  currentMenuLink: null,
  currentOrder: null,
  selectedItems: {}
}

// Supabase client (used only for customer booking form)
import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Helper: show toast notifications
function showToast(message, type='success') {
  const container = document.getElementById('toast-container')
  if (!container) return
  const toast = document.createElement('div')
  toast.className = `toast show ${type}`
  toast.textContent = message
  container.appendChild(toast)
  setTimeout(()=>{
    toast.classList.remove('show')
    setTimeout(()=>container.removeChild(toast),300)
  },3000)
}

// Modal helpers
function showModal(id){ document.getElementById(id)?.classList.remove('hidden') }
function hideModal(id){ document.getElementById(id)?.classList.add('hidden') }

// Page switching
function showPage(pageId){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'))
  document.getElementById(pageId)?.classList.add('active')
  document.querySelectorAll('.nav-link').forEach(l=>l.classList.remove('active'))
  document.querySelector(`[data-route="${pageId.replace('-page','')}"]`)?.classList.add('active')
}

// Booking form submission
async function handleBookingSubmit(event){
  event.preventDefault()
  const form = event.target
  const lead = {
    full_name: form['full-name'].value.trim(),
    mobile_number: form['mobile-number'].value.trim(),
    email_address: form['email-address'].value.trim(),
    location: form['location'].value,
    guest_count: parseInt(form['guest-count'].value,10),
    preferred_date: form['preferred-date'].value,
    special_requirements: form['special-requirements'].value.trim(),
    confirmed: false,
    advance_amount: 0,
    created_at: new Date().toISOString()
  }
  try {
    const { data, error } = await supabase
      .from('bookings')
      .insert([lead])
      .select()
    if (error) throw error
    showToast('Enquiry submitted! We will contact you soon.', 'success')
    hideModal('booking-modal')
    form.reset()
    showPage('query-success-page')
  } catch (err) {
    console.error(err)
    showToast('Error submitting enquiry. Please try again.', 'error')
  }
}

// Initialize event listeners
window.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('booking-open')?.addEventListener('click',()=>showModal('booking-modal'))
  document.querySelector('.modal-close')?.addEventListener('click',()=>hideModal('booking-modal'))
  document.getElementById('booking-form')?.addEventListener('submit', handleBookingSubmit)
})

