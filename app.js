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

// Add-ons from database
let addonsMasterList = []

// Load add-ons from addon_master table
async function loadAddons() {
  try {
    const { data, error } = await supabase
      .from('addon_master')
      .select('id, name, price, description')
      .eq('is_active', true)
      .order('price', { ascending: true })
    
    if (error) throw error
    addonsMasterList = data || []
    renderAddonsCheckboxes()
  } catch (err) {
    console.error('Failed to load add-ons:', err)
    addonsMasterList = []
  }
}

// Render add-ons as checkboxes in booking form
function renderAddonsCheckboxes() {
  const container = document.getElementById('addons-list')
  if (!container || addonsMasterList.length === 0) return
  
  container.innerHTML = addonsMasterList.map(addon => `
    <label class="addon-checkbox-item">
      <input type="checkbox" name="addon" value="${addon.id}" data-name="${addon.name}" data-price="${addon.price}" onchange="updateAddonsSummary()">
      <span class="addon-checkbox-content">
        <span class="addon-name">${addon.name}</span>
        <span class="addon-price">₹${addon.price}</span>
        ${addon.description ? `<span class="addon-desc">${addon.description}</span>` : ''}
      </span>
    </label>
  `).join('')
}

// Toggle addons dropdown
function toggleAddonsDropdown() {
  const content = document.getElementById('addons-dropdown-content')
  const trigger = document.querySelector('.addons-dropdown-trigger')
  if (content && trigger) {
    content.classList.toggle('hidden')
    trigger.classList.toggle('open')
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.querySelector('.addons-dropdown')
  if (dropdown && !dropdown.contains(e.target)) {
    const content = document.getElementById('addons-dropdown-content')
    const trigger = document.querySelector('.addons-dropdown-trigger')
    if (content && trigger) {
      content.classList.add('hidden')
      trigger.classList.remove('open')
    }
  }
})

// Update addons summary display
function updateAddonsSummary() {
  const checkboxes = document.querySelectorAll('#addons-list input[type="checkbox"]')
  const summary = document.getElementById('selected-addons-summary')
  const trigger = document.querySelector('.addons-dropdown-trigger')
  const triggerText = trigger?.querySelector('.addons-dropdown-text')
  
  const selected = Array.from(checkboxes).filter(cb => cb.checked)
  
  if (selected.length === 0) {
    summary.innerHTML = ''
    if (triggerText) triggerText.textContent = 'Select extras for your picnic'
    trigger?.classList.remove('has-selection')
  } else {
    // Update trigger text
    if (triggerText) triggerText.textContent = `${selected.length} add-on${selected.length > 1 ? 's' : ''} selected`
    trigger?.classList.add('has-selection')
    
    // Update summary tags
    summary.innerHTML = selected.map(cb => `
      <span class="selected-addon-tag">
        ${cb.dataset.name} - ₹${cb.dataset.price}
        <button type="button" class="remove-addon" onclick="removeAddonSelection('${cb.value}')">&times;</button>
      </span>
    `).join('')
  }
}

// Remove addon from selection
function removeAddonSelection(addonId) {
  const checkbox = document.querySelector(`#addons-list input[value="${addonId}"]`)
  if (checkbox) {
    checkbox.checked = false
    updateAddonsSummary()
  }
}

// Expose functions globally
window.toggleAddonsDropdown = toggleAddonsDropdown
window.updateAddonsSummary = updateAddonsSummary
window.removeAddonSelection = removeAddonSelection

// Get selected add-ons from checkboxes
function getSelectedAddons() {
  const checkboxes = document.querySelectorAll('#addons-list input[type="checkbox"]:checked')
  return Array.from(checkboxes).map(cb => ({
    id: parseInt(cb.value, 10),
    name: cb.dataset.name,
    price: parseInt(cb.dataset.price, 10)
  }))
}

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
  // Scroll to top when changing pages
  window.scrollTo(0, 0)
}

// Render menu cards
function renderMenuItems() {
  const fc = document.querySelector('#food-items .modern-menu-grid')
  const bc = document.querySelector('#bev-items .modern-menu-grid')
  if (!fc || !bc) return
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
    
    // Pre-populate existing selections if any (for editing)
    if (data.selected_food && data.selected_food.length > 0) {
      data.selected_food.forEach(item => {
        // Parse "item x quantity" format
        const match = item.match(/^(.+)\s+x(\d+)$/)
        if (match) {
          selectedFood.set(match[1], parseInt(match[2], 10))
        } else {
          selectedFood.set(item, 1)
        }
      })
    }
    
    if (data.selected_beverages && data.selected_beverages.length > 0) {
      data.selected_beverages.forEach(item => {
        // Parse "item x quantity" format
        const match = item.match(/^(.+)\s+x(\d+)$/)
        if (match) {
          selectedBev.set(match[1], parseInt(match[2], 10))
        } else {
          selectedBev.set(item, 1)
        }
      })
    }
    
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
    
    // Update booking_json if this menu link has a booking_id
    if (menuLinkData.booking_id) {
      await updateBookingJSONForCustomer(menuLinkData.booking_id)
    }
    
    showToast('Selection submitted successfully!', 'success')
    showPage('selection-success-page')
    
    // Hide navbar for cleaner success page
    document.querySelector('.navbar').style.display = 'none'
  } catch (err) {
    console.error(err)
    showToast('Error saving selection. Please try again.', 'error')
  }
}

// Update booking_json when customer submits menu selection
async function updateBookingJSONForCustomer(bookingId) {
  try {
    // Fetch booking
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select()
      .eq('id', bookingId)
      .single()
    if (bookingError) throw bookingError

    // Fetch menu link
    const { data: menuLinks, error: linkError } = await supabase
      .from('menu_links')
      .select()
      .eq('booking_id', bookingId)
    if (linkError) throw linkError

    const menuLink = menuLinks?.[0] || null
    
    // Build JSON
    const bookingJSON = {
      booking_id: booking.id,
      customer: {
        full_name: booking.full_name,
        mobile_number: booking.mobile_number,
        email_address: booking.email_address
      },
      event: {
        date: booking.preferred_date,
        time: booking.event_time,
        location: booking.location,
        guest_count: booking.guest_count,
        special_requirements: booking.special_requirements
      },
      financials: {
        total_amount: booking.booking_amount,
        advance_amount: booking.advance_amount,
        balance_amount: (booking.booking_amount || 0) - (booking.advance_amount || 0)
      },
      menu_selection: menuLink ? {
        link_id: menuLink.id,
        max_food_items: menuLink.max_food_items,
        max_bev_items: menuLink.max_bev_items,
        selected_food: menuLink.selected_food || [],
        selected_beverages: menuLink.selected_beverages || [],
        selection_complete: true
      } : null,
      metadata: {
        confirmed: booking.confirmed,
        created_at: booking.created_at,
        last_updated: new Date().toISOString()
      }
    }

    // Update booking
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ booking_json: bookingJSON })
      .eq('id', bookingId)
    if (updateError) throw updateError

    console.log('Booking JSON updated after menu selection')
  } catch (err) {
    console.error('Failed to update booking JSON:', err)
  }
}

// ===== CUSTOMER REVIEWS FUNCTIONALITY =====
async function loadApprovedReviews() {
  const container = document.getElementById('reviews-container')
  if (!container) return
  
  try {
    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('is_approved', true)
      .order('created_at', { ascending: false })
      .limit(6)
    
    if (error) throw error
    
    if (!reviews || reviews.length === 0) {
      container.innerHTML = `
        <div class="reviews-empty">
          <span class="empty-emoji">💭</span>
          <p>No reviews yet. Be the first to share your experience!</p>
        </div>
      `
      return
    }
    
    // Render review cards
    container.innerHTML = reviews.map(review => renderReviewCard(review)).join('')
    
    // Add summary if we have reviews
    if (reviews.length > 0) {
      const avgRating = calculateAverageRating(reviews)
      const summaryHTML = `
        <div class="reviews-summary">
          <div class="summary-rating">
            <span class="summary-stars">${renderStars(avgRating)}</span>
            <span class="summary-score">${avgRating.toFixed(1)}</span>
          </div>
          <p class="summary-count">Based on ${reviews.length} review${reviews.length > 1 ? 's' : ''}</p>
        </div>
      `
      container.insertAdjacentHTML('afterend', summaryHTML)
    }
    
  } catch (err) {
    console.error('Failed to load reviews:', err)
    container.innerHTML = `
      <div class="reviews-empty">
        <span class="empty-emoji">💭</span>
        <p>Reviews coming soon!</p>
      </div>
    `
  }
}

function renderReviewCard(review) {
  const stars = renderStars(review.rating)
  const date = new Date(review.created_at).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
  
  // Get first letter of name for avatar
  const initial = review.customer_name.charAt(0).toUpperCase()
  
  return `
    <div class="review-card">
      <div class="review-card-header">
        <div class="review-avatar">${initial}</div>
        <div class="review-author-info">
          <h4 class="review-author-name">${escapeHtml(review.customer_name)}</h4>
          ${review.occasion ? `<span class="review-occasion">${escapeHtml(review.occasion)}</span>` : ''}
        </div>
        <div class="review-stars">${stars}</div>
      </div>
      <p class="review-text">${escapeHtml(review.review_text)}</p>
      <span class="review-date">${date}</span>
    </div>
  `
}

function renderStars(rating) {
  const fullStars = Math.floor(rating)
  const halfStar = rating % 1 >= 0.5 ? 1 : 0
  const emptyStars = 5 - fullStars - halfStar
  
  return '★'.repeat(fullStars) + (halfStar ? '½' : '') + '☆'.repeat(emptyStars)
}

function calculateAverageRating(reviews) {
  if (!reviews || reviews.length === 0) return 0
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0)
  return sum / reviews.length
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ===== MOBILE MENU FUNCTIONALITY =====
function initMobileMenu() {
  const toggle = document.getElementById('mobile-menu-toggle')
  const navLinks = document.getElementById('nav-links')
  const overlay = document.getElementById('mobile-menu-overlay')
  
  if (!toggle || !navLinks) return
  
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('open')
    navLinks.classList.toggle('open')
    overlay?.classList.toggle('active')
    document.body.style.overflow = navLinks.classList.contains('open') ? 'hidden' : ''
  })
  
  overlay?.addEventListener('click', () => {
    toggle.classList.remove('open')
    navLinks.classList.remove('open')
    overlay.classList.remove('active')
    document.body.style.overflow = ''
  })
  
  // Close mobile menu when clicking a nav link
  navLinks.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      toggle.classList.remove('open')
      navLinks.classList.remove('open')
      overlay?.classList.remove('active')
      document.body.style.overflow = ''
    })
  })
}

// ===== NAVBAR SCROLL EFFECT =====
function initNavbarScroll() {
  const navbar = document.getElementById('navbar')
  if (!navbar) return
  
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled')
    } else {
      navbar.classList.remove('scrolled')
    }
  })
}

// ===== WIZARD FUNCTIONALITY =====
let currentWizardStep = 1
const totalWizardSteps = 3

function initWizard() {
  const prevBtn = document.getElementById('wizard-prev')
  const nextBtn = document.getElementById('wizard-next')
  const submitBtn = document.getElementById('wizard-submit')
  
  prevBtn?.addEventListener('click', () => goToWizardStep(currentWizardStep - 1))
  nextBtn?.addEventListener('click', () => {
    if (validateCurrentStep()) {
      goToWizardStep(currentWizardStep + 1)
    }
  })
  
  // Reset wizard when modal opens
  document.getElementById('booking-open')?.addEventListener('click', () => {
    resetWizard()
    showModal('booking-modal')
  })
  
  // Also hook other booking buttons
  document.getElementById('nav-book-btn')?.addEventListener('click', (e) => {
    e.preventDefault()
    resetWizard()
    showModal('booking-modal')
  })
  
  document.getElementById('contact-book-btn')?.addEventListener('click', () => {
    resetWizard()
    showModal('booking-modal')
  })
}

function resetWizard() {
  currentWizardStep = 1
  updateWizardUI()
  
  // Reset form if exists
  const form = document.getElementById('booking-form')
  if (form) form.reset()
  
  // Reset add-ons
  const checkboxes = document.querySelectorAll('#addons-list input[type="checkbox"]')
  checkboxes.forEach(cb => cb.checked = false)
  updateAddonsSummary()
}

function goToWizardStep(step) {
  if (step < 1 || step > totalWizardSteps) return
  currentWizardStep = step
  updateWizardUI()
}

function updateWizardUI() {
  // Update step content
  document.querySelectorAll('.wizard-step').forEach(el => {
    el.classList.remove('active')
  })
  document.querySelector(`.wizard-step[data-step="${currentWizardStep}"]`)?.classList.add('active')
  
  // Update progress indicators
  document.querySelectorAll('.progress-step').forEach(el => {
    const stepNum = parseInt(el.dataset.step, 10)
    el.classList.remove('active', 'completed')
    if (stepNum === currentWizardStep) {
      el.classList.add('active')
    } else if (stepNum < currentWizardStep) {
      el.classList.add('completed')
    }
  })
  
  // Update buttons
  const prevBtn = document.getElementById('wizard-prev')
  const nextBtn = document.getElementById('wizard-next')
  const submitBtn = document.getElementById('wizard-submit')
  
  if (prevBtn) prevBtn.style.display = currentWizardStep > 1 ? 'block' : 'none'
  if (nextBtn) nextBtn.style.display = currentWizardStep < totalWizardSteps ? 'block' : 'none'
  if (submitBtn) submitBtn.style.display = currentWizardStep === totalWizardSteps ? 'block' : 'none'
}

function validateCurrentStep() {
  const currentStepEl = document.querySelector(`.wizard-step[data-step="${currentWizardStep}"]`)
  if (!currentStepEl) return true
  
  const requiredFields = currentStepEl.querySelectorAll('[required]')
  let isValid = true
  
  requiredFields.forEach(field => {
    if (!field.value.trim()) {
      field.classList.add('error')
      isValid = false
      
      // Remove error class after user starts typing
      field.addEventListener('input', () => field.classList.remove('error'), { once: true })
    } else {
      field.classList.remove('error')
    }
  })
  
  if (!isValid) {
    showToast('Please fill in all required fields', 'error')
  }
  
  return isValid
}

// ===== UPDATED BOOKING SUBMIT FOR WIZARD =====
async function handleBookingSubmit(e) {
  e.preventDefault()
  const f = e.target
  
  // Get selected add-ons
  const selectedAddons = getSelectedAddons()
  
  // Get theme from radio buttons
  const selectedTheme = f.querySelector('input[name="theme"]:checked')?.value || ''
  
  const lead = {
    full_name: f['full-name'].value.trim(),
    mobile_number: f['mobile-number'].value.trim(),
    email_address: f['email-address'].value.trim() || null,
    location: f['location'].value,
    guest_count: parseInt(f['guest-count'].value, 10),
    preferred_date: f['preferred-date'].value,
    event_time: f['preferred-time'].value,
    occasion: f['occasion'].value,
    theme: selectedTheme,
    addons: selectedAddons,
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
    resetWizard()
    showPage('query-success-page')
  } catch (err) {
    console.error(err)
    showToast('Error submitting enquiry. Please try again.', 'error')
  }
}

// Init
window.addEventListener('DOMContentLoaded', async ()=>{
  // Initialize mobile menu
  initMobileMenu()
  
  // Initialize navbar scroll effect
  initNavbarScroll()
  
  // Initialize wizard
  initWizard()
  
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
  document.querySelectorAll('.nav-link[data-route]').forEach(link=>{
    link.addEventListener('click', ev=>{
      ev.preventDefault()
      const route = link.dataset.route
      if (route) {
        showPage(route)
      }
    })
  })

  renderMenuItems()
  handleMenuSelectionTabs()
  
  // Load add-ons for booking form
  await loadAddons()
  
  // Load approved reviews for home page
  await loadApprovedReviews()
  
  // Set minimum date for booking to today
  const dateInput = document.getElementById('preferred-date')
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0]
    dateInput.min = today
  }

  // Booking modal close button
  document.querySelector('.modal-close')?.addEventListener('click', ()=>hideModal('booking-modal'))
  
  // Click outside modal to close
  document.getElementById('booking-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'booking-modal') {
      hideModal('booking-modal')
    }
  })
  
  // Form submit handler
  document.getElementById('booking-form')?.addEventListener('submit', handleBookingSubmit)
})
