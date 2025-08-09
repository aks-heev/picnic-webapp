// Import Supabase client (for bookings)
import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Supabase variables missing!')
}
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Menu data
const foodList = [/* … same as before … */]
const bevList  = [/* … same as before … */]

// App state
const appState = { selectedItems: {} }

// Toast helper
function showToast(msg,type='success'){
  const c=document.getElementById('toast-container')
  if(!c)return
  const t=document.createElement('div')
  t.className=`toast show ${type}`
  t.textContent=msg
  c.appendChild(t)
  setTimeout(()=>{
    t.classList.remove('show')
    setTimeout(()=>c.removeChild(t),300)
  },3000)
}

// Modal helpers
const showModal=id=>document.getElementById(id)?.classList.remove('hidden')
const hideModal=id=>document.getElementById(id)?.classList.add('hidden')

// Page switching
function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'))
  document.getElementById(id)?.classList.add('active')
  document.querySelectorAll('.nav-link').forEach(l=>l.classList.remove('active'))
  document.querySelector(`[data-route="${id}"]`)?.classList.add('active')
}

// Quantity update
function updateQuantity(item,cat,delta){
  const key=`${cat}-${item}`
  const e=appState.selectedItems[key]||{name:item,category:cat,quantity:0}
  e.quantity=Math.max(0,e.quantity+delta)
  if(e.quantity) appState.selectedItems[key]=e
  else delete appState.selectedItems[key]
  const disp=document.getElementById(`qty-${cat}-${item.replace(/\s+/g,'-').toLowerCase()}`)
  if(disp) disp.textContent=e.quantity
  document.querySelectorAll(`.modern-qty-btn.minus[data-item="${item}"]`)
    .forEach(b=>b.disabled=e.quantity===0)
}

// Render menu
function renderMenuItems(){
  const fc=document.querySelector('#food-items .modern-menu-grid')
  const bc=document.querySelector('#bev-items .modern-menu-grid')
  fc.innerHTML=foodList.map(item=>`
    <div class="modern-menu-item">
      <div class="item-info"><h4 class="item-name">${item}</h4></div>
      <div class="modern-quantity-controls">
        <button class="modern-qty-btn minus" data-item="${item}" data-category="food" data-change="-1" disabled>−</button>
        <span class="modern-qty-display" id="qty-food-${item.replace(/\s+/g,'-').toLowerCase()}">0</span>
        <button class="modern-qty-btn plus" data-item="${item}" data-category="food" data-change="1">+</button>
      </div>
    </div>
  `).join('')
  bc.innerHTML=bevList.map(item=>`
    <div class="modern-menu-item">
      <div class="item-info"><h4 class="item-name">${item}</h4></div>
      <div class="modern-quantity-controls">
        <button class="modern-qty-btn minus" data-item="${item}" data-category="bev" data-change="-1" disabled>−</button>
        <span class="modern-qty-display" id="qty-bev-${item.replace(/\s+/g,'-').toLowerCase()}">0</span>
        <button class="modern-qty-btn plus" data-item="${item}" data-category="bev" data-change="1">+</button>
      </div>
    </div>
  `).join('')
}

// Tabs for menu
function handleMenuSelectionTabs(){
  document.querySelectorAll('.modern-tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const tab=btn.dataset.tab
      document.querySelectorAll('.modern-tab-btn').forEach(b=>b.classList.remove('active'))
      btn.classList.add('active')
      document.querySelectorAll('.modern-tab-content').forEach(c=>c.style.display='none')
      document.getElementById(tab).style.display='block'
    })
  })
}

// Booking form
async function handleBookingSubmit(e){
  e.preventDefault()
  const f=e.target
  const lead={
    full_name:f['full-name'].value.trim(),
    mobile_number:f['mobile-number'].value.trim(),
    email_address:f['email-address'].value.trim(),
    location:f['location'].value,
    guest_count:parseInt(f['guest-count'].value,10),
    preferred_date:f['preferred-date'].value,
    special_requirements:f['special-requirements'].value.trim(),
    confirmed:false,advance_amount:0,created_at:new Date().toISOString()
  }
  try{
    const { data,error } = await supabase.from('bookings').insert([lead]).select()
    if(error)throw error
    showToast('Enquiry submitted! We will contact you soon.','success')
    hideModal('booking-modal')
    f.reset()
    showPage('query-success-page')
  }catch(err){
    console.error(err)
    showToast('Error submitting enquiry. Please try again.','error')
  }
}

// Init
window.addEventListener('DOMContentLoaded',()=>{
  // Navigation
  document.querySelectorAll('.nav-link').forEach(link=>{
    link.addEventListener('click', e=>{
      e.preventDefault()
      const route=link.dataset.route
      showPage(route==='home'? 'home-page' : route)
    })
  })

  // Render & tabs
  renderMenuItems()
  handleMenuSelectionTabs()

  // Booking modal & form
  document.getElementById('booking-open')?.addEventListener('click',()=>showModal('booking-modal'))
  document.querySelector('.modal-close')?.addEventListener('click',()=>hideModal('booking-modal'))
  document.getElementById('booking-form')?.addEventListener('submit',handleBookingSubmit)

  // Quantity controls
  document.addEventListener('click',e=>{
    const btn=e.target.closest('.modern-qty-btn')
    if(btn&&!btn.disabled){
      updateQuantity(btn.dataset.item,btn.dataset.category,parseInt(btn.dataset.change,10))
    }
  })
})
