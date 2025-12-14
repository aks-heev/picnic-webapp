import { createClient } from '@supabase/supabase-js'

// Supabase init
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

// Menu link state
let menuLinkData = null
let selectedFood = new Map()  // Map of item -> quantity
let selectedBev = new Map()   // Map of item -> quantity

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

// Toast helper
function showToast(msg, type='success') {
  const c = document.getElementById('toast-container')
  if (!c) return
  const t = document.createElement('div')
  t.className = `toast show ${type}`
  t.textContent = msg
  c.appendChild(t)
  setTimeout(()=>{
    t.classList.remove('show')
    setTimeout(()=>c.removeChild(t),300)
  },3000)
}

// Modal helpers
const showModal = id => document.getElementById(id)?.classList.remove('hidden')
const hideModal = id => document.getElementById(id)?.classList.add('hidden')

// Page switch
function showPage(id) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'))
  document.getElementById(id)?.classList.add('active')
  document.querySelectorAll('.nav-link').forEach(l=>l.classList.remove('active'))
  document.querySelector(`[data-route="${id}"]`)?.classList.add('active')
}

// Render menu cards
function renderMenuItems() {
  const fc = document.querySelector('#food-items .modern-menu-grid')
  const bc = document.querySelector('#bev-items .modern-menu-grid')
  const card = name => `
    <div class="modern-menu-card">
      <h4 class="menu-card-title">${name}</h4>
    </div>
  `
  fc.innerHTML = foodList.map(card).join('')
  bc.innerHTML = bevList.map(card).join('')
}

// Tabs handler
function handleMenuSelectionTabs() {
  document.querySelectorAll('.modern-tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const tab = btn.dataset.tab
      document.querySelectorAll('.modern-tab-btn').forEach(b=>b.classList.remove('active'))
      btn.classList.add('active')
      document.querySelectorAll('.modern-tab-content').forEach(c=>c.style.display='none')
      document.getElementById(tab).style.display='block'
    })
  })
}

// Booking submit
async function handleBookingSubmit(e) {
  e.preventDefault()
  const f = e.target
  const lead = {
    full_name: f['full-name'].value.trim(),
    mobile_number: f['mobile-number'].value.trim(),
    email_address: f['email-address'].value.trim(),
    location: f['location'].value,
    guest_count: parseInt(f['guest-count'].value,10),
    preferred_date: f['preferred-date'].value,
    special_requirements: f['special-requirements'].value.trim(),
    confirmed: false,
    advance_amount: 0,
    created_at: new Date().toISOString()
  }
  try {
    const { error } = await supabase.from('bookings').insert([lead])
    if (error) throw error
    showToast('Enquiry submitted! We will contact you soon.', 'success')
    hideModal('booking-modal')
    f.reset()
    showPage('query-success-page')
  } catch (err) {
    console.error(err)
    showToast('Error submitting enquiry. Please try again.', 'error')
  }
}

// Check for menu link parameter
async function checkMenuLink() {
  const params = new URLSearchParams(window.location.search)
  const menuId = params.get('menu')
  
  if (!menuId) return false
  
  try {
    const { data, error } = await supabase
      .from('menu_links')
      .select()
      .eq('id', menuId)
      .single()
    
    if (error || !data) {
      showToast('Invalid or expired menu link', 'error')
      return false
    }
    
    menuLinkData = data
    return true
  } catch (err) {
    console.error(err)
    showToast('Error loading menu link', 'error')
    return false
  }
}

// Render selectable menu items
function renderSelectableMenuItems() {
  if (!menuLinkData) return
  
  const foodGrid = document.querySelector('#food-selection .selection-menu-grid')
  const bevGrid = document.querySelector('#bev-selection .selection-menu-grid')
  
  const createCard = (name, type) => {
    const quantity = type === 'food' ? (selectedFood.get(name) || 0) : (selectedBev.get(name) || 0)
    const hasQuantity = quantity > 0
    return `
      <div class="modern-menu-card selectable ${hasQuantity ? 'selected' : ''}" data-item="${name}" data-type="${type}">
        <h4 class="menu-card-title">${name}</h4>
        <div class="quantity-controls">
          <button class="qty-btn minus" data-action="decrease" ${!hasQuantity ? 'disabled' : ''}>−</button>
          <span class="qty-value">${quantity}</span>
          <button class="qty-btn plus" data-action="increase">+</button>
        </div>
      </div>
    `
  }
  
  foodGrid.innerHTML = foodList.map(name => createCard(name, 'food')).join('')
  bevGrid.innerHTML = bevList.map(name => createCard(name, 'bev')).join('')
  
  updateSelectionCounts()
}

// Get total quantity from a Map
function getTotalQuantity(map) {
  let total = 0
  for (const qty of map.values()) {
    total += qty
  }
  return total
}

// Update selection counts display
function updateSelectionCounts() {
  if (!menuLinkData) return
  
  const maxFood = menuLinkData.max_food_items
  const maxBev = menuLinkData.max_bev_items
  const totalFood = getTotalQuantity(selectedFood)
  const totalBev = getTotalQuantity(selectedBev)
  
  document.getElementById('selection-limits').textContent = 
    `Select up to ${maxFood} food items and ${maxBev} beverages`
  document.getElementById('selected-food-count').textContent = 
    `Food Items: ${totalFood} / ${maxFood}`
  document.getElementById('selected-bev-count').textContent = 
    `Beverages: ${totalBev} / ${maxBev}`
}

// Handle item selection
function handleItemSelection(e) {
  const btn = e.target.closest('.qty-btn')
  if (!btn) return
  
  const card = btn.closest('.modern-menu-card.selectable')
  if (!card) return
  
  const item = card.dataset.item
  const type = card.dataset.type
  const action = btn.dataset.action
  const maxFood = menuLinkData.max_food_items
  const maxBev = menuLinkData.max_bev_items
  
  const map = type === 'food' ? selectedFood : selectedBev
  const max = type === 'food' ? maxFood : maxBev
  const currentQty = map.get(item) || 0
  const totalQty = getTotalQuantity(map)
  
  if (action === 'increase') {
    if (totalQty >= max) {
      showToast(`Maximum ${max} ${type === 'food' ? 'food items' : 'beverages'} allowed`, 'error')
      return
    }
    map.set(item, currentQty + 1)
  } else if (action === 'decrease') {
    if (currentQty <= 1) {
      map.delete(item)
    } else {
      map.set(item, currentQty - 1)
    }
  }
  
  renderSelectableMenuItems()
}

// Handle selection tabs
function handleSelectionTabs() {
  document.querySelectorAll('.selection-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      document.querySelectorAll('.selection-tab-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      document.querySelectorAll('.selection-tab-content').forEach(c => c.style.display = 'none')
      document.getElementById(tab).style.display = 'block'
    })
  })
}

// Convert Map to array of "item x quantity" strings
function mapToArray(map) {
  const result = []
  for (const [item, qty] of map.entries()) {
    result.push(`${item} x${qty}`)
  }
  return result
}

// Submit selection
async function handleSubmitSelection() {
  if (getTotalQuantity(selectedFood) === 0 && getTotalQuantity(selectedBev) === 0) {
    showToast('Please select at least one item', 'error')
    return
  }
  
  try {
    const { error } = await supabase
      .from('menu_links')
      .update({
        selected_food: mapToArray(selectedFood),
        selected_beverages: mapToArray(selectedBev)
      })
      .eq('id', menuLinkData.id)
    
    if (error) throw error
    
    showToast('Selection submitted successfully!', 'success')
    showPage('selection-success-page')
    
    // Hide navbar for cleaner success page
    document.querySelector('.navbar').style.display = 'none'
  } catch (err) {
    console.error(err)
    showToast('Error saving selection. Please try again.', 'error')
  }
}

// Init
window.addEventListener('DOMContentLoaded', async ()=>{
  // Check if this is a menu selection link
  const isMenuLink = await checkMenuLink()
  
  if (isMenuLink) {
    // Hide navbar for customer menu selection
    document.querySelector('.navbar').style.display = 'none'
    showPage('menu-selection-page')
    renderSelectableMenuItems()
    handleSelectionTabs()
    
    // Add click handlers for selection
    document.querySelector('#food-selection')?.addEventListener('click', handleItemSelection)
    document.querySelector('#bev-selection')?.addEventListener('click', handleItemSelection)
    document.getElementById('submit-selection')?.addEventListener('click', handleSubmitSelection)
    return
  }
  
  // Normal site navigation
  document.querySelectorAll('.nav-link').forEach(link=>{
    link.addEventListener('click', ev=>{
      ev.preventDefault()
      showPage(link.dataset.route==='home-page'?'home-page':'menu-page')
    })
  })

  renderMenuItems()
  handleMenuSelectionTabs()

  // Booking modal & form
  document.getElementById('booking-open')?.addEventListener('click', ()=>showModal('booking-modal'))
  document.querySelector('.modal-close')?.addEventListener('click', ()=>hideModal('booking-modal'))
  document.getElementById('booking-form')?.addEventListener('submit', handleBookingSubmit)
})
