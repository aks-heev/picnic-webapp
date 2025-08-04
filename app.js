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

<<<<<<< HEAD
// App State
=======
// Application state
>>>>>>> 5c94c78 (button listener changes)
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

<<<<<<< HEAD
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
=======
// Modal management
function toggleModal(modalId, show = null) {
    const modal = document.getElementById(modalId)
    if (!modal) return
    if (show === null) modal.classList.toggle('hidden')
    else modal.classList.toggle('hidden', !show)
}

// Page navigation
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'))
    const target = document.getElementById(pageId + '-page')
    if (target) target.classList.add('active')
    appState.currentPage = pageId
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'))
    const activeLink = document.querySelector(`[data-page="${pageId}"]`)
    if (activeLink) activeLink.classList.add('active')
}

// Booking form handler
async function handleBookingSubmit(e) {
    e.preventDefault()
    const form = e.target
    const lead = {
        full_name: form['full-name'].value.trim(),
        mobile_number: form['mobile-number'].value.trim(),
        email_address: form['email-address'].value.trim(),
        location: form['location'].value,
        guest_count: +form['guest-count'].value,
        preferred_date: form['preferred-date'].value,
        special_requirements: form['special-requirements'].value.trim(),
        created_at: new Date().toISOString()
    }
    try {
        const { data, error } = await supabase.from('bookings').insert([lead]).select()
        if (error) throw error
        showToast('Booking submitted successfully!', 'success')
        toggleModal('booking-modal', false)
        form.reset()
    } catch (err) {
        console.error(err)
        showToast('Error submitting booking.', 'error')
    }
}

// Admin login handler
function handleAdminLogin(e) {
    e.preventDefault()
    const pwd = e.target['admin-password'].value
    if (pwd === 'admin123') {
        appState.isAdminLoggedIn = true
        showToast('Admin logged in', 'success')
        toggleModal('admin-login-modal', false)
        showPage('admin')
        loadLeads()
        loadMenuLinks()
        e.target.reset()
    } else {
        showToast('Invalid password', 'error')
    }
}

// Generate menu link
async function generateMenuLink(foodCount, bevCount) {
    if (!appState.isAdminLoggedIn) return showToast('Admin required', 'error')
    if (foodCount<1||foodCount>15||bevCount<1||bevCount>10) return showToast('Limits: food 1-15, bev 1-10','error')
    try {
        const linkObj = { max_food_items: foodCount, max_bev_items: bevCount, created_at: new Date().toISOString() }
        const { data, error } = await supabase.from('menu_links').insert([linkObj]).select()
        if (error) throw error
        const url = `${window.location.origin}?menu=${data[0].id}`
        document.getElementById('generated-link').value = url
        document.getElementById('generated-link-container').classList.remove('hidden')
        showToast('Menu link generated', 'success')
        loadMenuLinks()
    } catch (err) {
        console.error(err)
        showToast('Failed to generate link', 'error')
    }
}

// Load leads
async function loadLeads() {
    if (!appState.isAdminLoggedIn) return
    try {
        const { data, error } = await supabase.from('bookings').select().order('created_at',{ascending:false})
        if (error) throw error
        const container = document.getElementById('leads-container')
        if (data.length === 0) {
            container.innerHTML = `<div class="empty-state"><h3>No leads yet</h3><p>Bookings will appear here.</p></div>`
            return
        }
        container.innerHTML = `
          <div class="leads-table">
            ${data.map(lead=>`
              <div class="lead-item">
                <div class="lead-header">
                  <div class="lead-name">${lead.full_name}</div>
                  <div class="lead-date">${new Date(lead.created_at).toLocaleDateString()}</div>
                </div>
                <div class="lead-details">
                  <div class="lead-detail"><strong>Mobile:</strong><span>${lead.mobile_number}</span></div>
                  <div class="lead-detail"><strong>Email:</strong><span>${lead.email_address}</span></div>
                  <div class="lead-detail"><strong>Location:</strong><span>${lead.location}</span></div>
                  <div class="lead-detail"><strong>Guests:</strong><span>${lead.guest_count}</span></div>
                  <div class="lead-detail"><strong>Date:</strong><span>${lead.preferred_date}</span></div>
                  <div class="lead-detail"><strong>Requirements:</strong><span>${lead.special_requirements||'None'}</span></div>
                </div>
              </div>
            `).join('')}
          </div>`
    } catch (err) {
        console.error(err)
        showToast('Failed to load leads', 'error')
    }
}

// Load menu links
async function loadMenuLinks() {
    if (!appState.isAdminLoggedIn) return
    try {
        const { data, error } = await supabase.from('menu_links').select().order('created_at',{ascending:false})
        if (error) throw error
        const container = document.getElementById('menu-links-container')
        if (data.length === 0) {
            container.innerHTML = `<div class="empty-state"><h3>No links yet</h3><p>Generated links will appear here.</p></div>`
            return
        }
        container.innerHTML = `
          <div class="menu-links-list">
            ${data.map(link=>`
              <div class="menu-link-item">
                <div class="menu-link-info">
                  <div class="menu-link-id">Link ID: ${link.id}</div>
                  <div class="menu-link-details">
                    Food: ${link.max_food_items} | Beverages: ${link.max_bev_items} | Created: ${new Date(link.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div class="menu-link-actions">
                  <button class="btn btn--sm btn--secondary" onclick="copyMenuLink(${link.id})">Copy Link</button>
                </div>
              </div>
            `).join('')}
          </div>`
    } catch (err) {
        console.error(err)
        showToast('Failed to load links', 'error')
    }
}

// Copy menu link
function copyMenuLink(id) {
    const url = `${window.location.origin}?menu=${id}`
    navigator.clipboard.writeText(url)
      .then(()=>showToast('Link copied', 'success'))
      .catch(()=>showToast('Copy failed','error'))
}

// Preview menu
function loadMenuPreview() {
    const foodContainer = document.getElementById('preview-food-items')
    const bevContainer = document.getElementById('preview-bev-items')
    if (foodContainer) {
        foodContainer.innerHTML = foodList.slice(0,6).map(item=>`
            <div class="menu-item"><h4>${item}</h4><p>Delicious ${item.toLowerCase()}</p></div>
        `).join('')
    }
    if (bevContainer) {
        bevContainer.innerHTML = bevList.slice(0,4).map(item=>`
            <div class="menu-item"><h4>${item}</h4><p>Refreshing ${item.toLowerCase()}</p></div>
        `).join('')
    }
}

// Load custom menu selection
async function loadMenuSelection(id) {
    try {
        const { data, error } = await supabase.from('menu_links').select().eq('id',id).single()
        if (error) throw error
        appState.currentMenuLink = data
        appState.selectedItems = { food: {}, beverages: {} }
        document.getElementById('food-limit-display').textContent = `(Select up to ${data.max_food_items})`
        document.getElementById('bev-limit-display').textContent = `(Select up to ${data.max_bev_items})`
        // Render selection items...
        // (Quantity controls call updateQuantity)
        showPage('menu-selection')
    } catch (err) {
        console.error(err)
        showToast('Invalid menu link', 'error')
    }
}

// Quantity update
function updateQuantity(type, item, delta) {
    const list = appState.selectedItems[type]
    const current = list[item]||0
    const total = Object.values(list).reduce((s,v)=>s+v,0)
    const max = type==='food'?appState.currentMenuLink.max_food_items:appState.currentMenuLink.max_bev_items
    if (delta>0 && total>=max) return showToast(`Max ${max} ${type}`, 'error')
    const newQty = Math.max(0, current+delta)
    if (newQty) list[item]=newQty
    else delete list[item]
    document.querySelector(`#${type==='food'?'food':'bev'}-${(type==='food'?foodList:bevList).indexOf(item)}`).value=newQty
    updateSelectionSummary()
}

// Selection summary
function updateSelectionSummary() {
    const container = document.getElementById('selection-summary-content')
    const fCount = Object.values(appState.selectedItems.food).reduce((s,v)=>s+v,0)
    const bCount = Object.values(appState.selectedItems.beverages).reduce((s,v)=>s+v,0)
    document.getElementById('food-count-display').textContent=fCount
    document.getElementById('bev-count-display').textContent=bCount
    if (fCount===0&&bCount===0) {
        container.innerHTML = '<p>No items selected yet</p>'
        return
    }
    let html = '<div class="selected-items">'
    Object.entries(appState.selectedItems.food).forEach(([item,qty])=> {
        html += `<div class="selected-item"><span>${item}</span><span>×${qty}</span></div>`
    })
    Object.entries(appState.selectedItems.beverages).forEach(([item,qty])=> {
        html += `<div class="selected-item"><span>${item}</span><span>×${qty}</span></div>`
    })
    container.innerHTML = html + '</div>'
}

// Submit selection
async function submitMenuSelection() {
    const foodCount = Object.values(appState.selectedItems.food).reduce((s,v)=>s+v,0)
    const bevCount = Object.values(appState.selectedItems.beverages).reduce((s,v)=>s+v,0)
    if (foodCount+bevCount===0) return showToast('Select at least one item','error')
    try {
        const order = {
            menu_link_id: appState.currentMenuLink.id,
            selected_items: appState.selectedItems,
            food_count: foodCount,
            beverage_count: bevCount,
            created_at: new Date().toISOString()
        }
        const { data, error } = await supabase.from('orders').insert([order]).select()
        if (error) throw error
        showToast('Order submitted!', 'success')
        showPage('home')
    } catch (err) {
        console.error(err)
        showToast('Failed to submit order','error')
    }
}

// Expose globals
window.updateQuantity = updateQuantity
window.copyMenuLink    = copyMenuLink

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search)
    const menuId = params.get('menu')
    if (menuId) { loadMenuSelection(menuId); return }

    loadMenuPreview()

    // Button handlers
    document.getElementById('book-picnic-btn')?.addEventListener('click',()=>toggleModal('booking-modal',true))
    document.getElementById('book-from-preview-btn')?.addEventListener('click',()=>toggleModal('booking-modal',true))
    document.getElementById('admin-btn')?.addEventListener('click',()=>{
        appState.isAdminLoggedIn ? showPage('admin') : toggleModal('admin-login-modal',true)
    })
    document.getElementById('menu-preview-btn')?.addEventListener('click',()=>showPage('menu-preview'))

    // Form handlers
    document.getElementById('booking-form')?.addEventListener('submit', handleBookingSubmit)
    document.getElementById('admin-login-form')?.addEventListener('submit', handleAdminLogin)
    document.getElementById('menu-generator-form')?.addEventListener('submit', e=>{
        e.preventDefault()
        generateMenuLink(+e.target['food-count'].value, +e.target['bev-count'].value)
    })
    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn=>{
        btn.addEventListener('click', e => {
            const id = e.target.dataset.modal || e.target.closest('.modal').id
            toggleModal(id,false)
        })
    })
    document.querySelectorAll('.nav-link').forEach(link=>{
        link.addEventListener('click', e=>{
            e.preventDefault()
            showPage(e.target.dataset.page)
        })
    })
    document.getElementById('admin-logout-btn')?.addEventListener('click',()=>{
        appState.isAdminLoggedIn=false
        showPage('home')
        showToast('Logged out','success')
    })
    document.querySelectorAll('.tab-btn').forEach(btn=>{
        btn.addEventListener('click', e=>{
            document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'))
            e.target.classList.add('active')
            document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'))
            document.getElementById(e.target.dataset.tab+'-tab').classList.add('active')
        })
    })
    document.getElementById('refresh-leads-btn')?.addEventListener('click', loadLeads)
    document.getElementById('refresh-menu-links-btn')?.addEventListener('click', loadMenuLinks)
    document.getElementById('copy-link-btn')?.addEventListener('click', ()=>{
        const input = document.getElementById('generated-link')
        input.select()
        navigator.clipboard.writeText(input.value).then(()=>showToast('Copied','success'))
    })
    document.getElementById('submit-selection-btn')?.addEventListener('click', submitMenuSelection)

    // Leads search
    document.getElementById('leads-search')?.addEventListener('input', e=>{
        const term = e.target.value.toLowerCase()
        document.querySelectorAll('.lead-item').forEach(item=>{
            item.style.display = item.textContent.toLowerCase().includes(term)?'block':'none'
        })
    })

    console.log('App initialized!')
>>>>>>> 5c94c78 (button listener changes)
})
