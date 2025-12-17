// /admin/admin.js
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Supabase environment variables missing!');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== Toast Helper =====
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast show ${type === 'success' ? 'success' : 'error'}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => container.removeChild(toast), 300);
  }, 3000);
}

// ===== State =====
let isAdminLoggedIn = false;

// Track selected add-ons per query (key: queryId, value: array of {name, price})
const selectedAddons = {};

// Available add-ons list (update this with your actual add-ons)
const addonsList = [
  "Extra Decor Setup",
  "Photography (1 hour)",
  "Photography (2 hours)",
  "Balloon Decoration",
  "Flower Arrangement",
  "Custom Cake",
  "Live Music",
  "Extra Seating",
  "Projector Setup",
  "Fairy Lights",
  "Smoke Machine",
  "Party Props",
  "Custom Banner",
  "Extra Food Platter",
  "Extra Beverage Package"
];

// Helper function to build complete booking JSON
function buildBookingJSON(booking, menuLink = null) {
  const addons = booking.addons || [];
  const addonsTotal = addons.reduce((sum, a) => sum + (a.price || 0), 0);
  
  return {
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
      balance_amount: (booking.booking_amount || 0) - (booking.advance_amount || 0),
      addons_total: addonsTotal
    },
    addons: addons,
    menu_selection: menuLink ? {
      link_id: menuLink.id,
      max_food_items: menuLink.max_food_items,
      max_bev_items: menuLink.max_bev_items,
      selected_food: menuLink.selected_food || [],
      selected_beverages: menuLink.selected_beverages || [],
      selection_complete: (menuLink.selected_food?.length > 0 || menuLink.selected_beverages?.length > 0)
    } : null,
    metadata: {
      confirmed: booking.confirmed,
      created_at: booking.created_at,
      last_updated: new Date().toISOString()
    }
  };
}

// Update booking_json in Supabase
async function updateBookingJSON(bookingId) {
  try {
    // Fetch latest booking data
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select()
      .eq('id', bookingId)
      .single();
    if (bookingError) throw bookingError;

    // Fetch associated menu link
    const { data: menuLinks, error: linkError } = await supabase
      .from('menu_links')
      .select()
      .eq('booking_id', bookingId);
    if (linkError) throw linkError;

    const menuLink = menuLinks?.[0] || null;
    const bookingJSON = buildBookingJSON(booking, menuLink);

    // Update the booking_json column
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ booking_json: bookingJSON })
      .eq('id', bookingId);
    if (updateError) throw updateError;

    console.log('Booking JSON updated for booking:', bookingId);
    return bookingJSON;
  } catch (err) {
    console.error('Failed to update booking JSON:', err);
    return null;
  }
}

// ===== Login / Logout =====
async function handleAdminLogin(event) {
  event.preventDefault();
  const email = event.target['admin-email'].value.trim();
  const password = event.target['admin-password'].value;
  // TODO: Replace with Supabase Auth
  if (email === 'admin@picnic.com' && password === 'admin123') {
    isAdminLoggedIn = true;
    showToast('Admin logged in', 'success');
    document.getElementById('admin-login').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    loadQueries();
    loadBookings();
    loadMenuLinks();
  } else {
    showToast('Invalid credentials', 'error');
  }
}

function handleAdminLogout() {
  isAdminLoggedIn = false;
  showToast('Logged out', 'success');
  document.getElementById('admin-login').classList.remove('hidden');
  document.getElementById('admin-dashboard').classList.add('hidden');
  document.getElementById('admin-login-form').reset();
}

// ===== Data Fetch =====
async function loadQueries() {
  if (!isAdminLoggedIn) return;
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select()
      .eq('confirmed', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    renderQueries(data);
  } catch (err) {
    console.error(err);
    showToast('Failed to load queries', 'error');
  }
}

async function loadBookings() {
  if (!isAdminLoggedIn) return;
  try {
    // Fetch bookings
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select()
      .eq('confirmed', true)
      .order('created_at', { ascending: false });
    if (bookingsError) throw bookingsError;

    // Fetch menu links to get selections
    const { data: menuLinks, error: linksError } = await supabase
      .from('menu_links')
      .select();
    if (linksError) throw linksError;

    // Create a map of booking_id -> menu_link
    const menuLinksByBooking = {};
    menuLinks?.forEach(link => {
      if (link.booking_id) {
        menuLinksByBooking[link.booking_id] = link;
      }
    });

    renderBookings(bookings, menuLinksByBooking);
  } catch (err) {
    console.error(err);
    showToast('Failed to load bookings', 'error');
  }
}

async function loadMenuLinks() {
  if (!isAdminLoggedIn) return;
  try {
    const { data, error } = await supabase
      .from('menu_links')
      .select()
      .order('created_at', { ascending: false });
    if (error) throw error;
    renderMenuLinks(data);
  } catch (err) {
    console.error(err);
    showToast('Failed to load menu links', 'error');
  }
}

// ===== Render Functions =====
function renderQueries(queries) {
  const container = document.getElementById('queries-container');
  if (!container) return;
  if (!queries || queries.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No Pending Queries</h3></div>';
    return;
  }
  container.innerHTML = queries.map(q => `
    <div class="leads-table">
      <div class="lead-item" data-query-id="${q.id}">
        <div class="lead-header">
          <div class="lead-name">${q.full_name}</div>
          <div class="lead-date">${new Date(q.created_at).toLocaleDateString()}</div>
        </div>
        <div class="lead-details">
          <div class="lead-detail"><strong>Mobile:</strong><span>${q.mobile_number}</span></div>
          <div class="lead-detail"><strong>Email:</strong><span>${q.email_address}</span></div>
          <div class="lead-detail"><strong>Location:</strong><span>${q.location}</span></div>
          <div class="lead-detail"><strong>Guests:</strong><span>${q.guest_count}</span></div>
          <div class="lead-detail"><strong>Preferred Date:</strong><span>${q.preferred_date}</span></div>
        </div>
        ${q.special_requirements ? `
          <div style="margin-top:12px;">
            <strong>Special:</strong>
            <p>${q.special_requirements}</p>
          </div>
        ` : ''}
        <div class="confirm-booking-form" style="margin-top:16px;">
          <h5 style="margin-bottom:12px; color:var(--color-primary);">Confirm Booking Details</h5>
          <div class="form-row-grid">
            <div class="form-group">
              <label class="form-label" for="time-${q.id}">Event Time</label>
              <input id="time-${q.id}" type="time" class="form-control" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="booking-${q.id}">Total Amount (₹)</label>
              <input id="booking-${q.id}" type="number" class="form-control" placeholder="Total amount" min="0" step="50" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="advance-${q.id}">Advance Amount (₹)</label>
              <input id="advance-${q.id}" type="number" class="form-control" placeholder="Advance" min="0" step="50">
            </div>
          </div>
          <div class="form-row-grid">
            <div class="form-group">
              <label class="form-label" for="food-limit-${q.id}">Food Items Limit</label>
              <input id="food-limit-${q.id}" type="number" class="form-control" placeholder="e.g. 5" min="1" max="74" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="bev-limit-${q.id}">Beverages Limit</label>
              <input id="bev-limit-${q.id}" type="number" class="form-control" placeholder="e.g. 3" min="1" max="24" required>
            </div>
          </div>
          
          <!-- Add-ons Section -->
          <div class="addons-section" style="margin-top:16px; padding:12px; background:var(--color-surface); border-radius:8px;">
            <div class="addons-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
              <label class="form-label" style="margin:0;">🎁 Add-ons</label>
              <button type="button" class="btn btn--sm btn--outline" onclick="showAddonSelector(${q.id})" style="padding:4px 12px;">
                ➕ Add
              </button>
            </div>
            <div id="selected-addons-${q.id}" class="selected-addons-list">
              <!-- Selected add-ons will appear here -->
            </div>
            <div id="addon-selector-${q.id}" class="addon-selector hidden" style="margin-top:12px; padding:12px; background:var(--color-background); border-radius:8px; border:1px solid var(--color-border);">
              <div class="form-group" style="margin-bottom:8px;">
                <select id="addon-select-${q.id}" class="form-control">
                  <option value="">-- Select Add-on --</option>
                  ${addonsList.map(addon => `<option value="${addon}">${addon}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" style="margin-bottom:8px;">
                <input type="number" id="addon-price-${q.id}" class="form-control" placeholder="Price (₹)" min="0" step="50">
              </div>
              <div style="display:flex; gap:8px;">
                <button type="button" class="btn btn--sm btn--primary" onclick="addAddon(${q.id})">Add</button>
                <button type="button" class="btn btn--sm btn--outline" onclick="hideAddonSelector(${q.id})">Cancel</button>
              </div>
            </div>
          </div>
          
          <button class="btn btn--primary" onclick="confirmBooking(${q.id})" style="margin-top:16px;">
            Confirm Booking & Generate Menu Link
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// Modified renderBookings to include editable fields and menu selections
function renderBookings(bookings, menuLinksByBooking = {}) {
  const container = document.getElementById('bookings-container');
  if (!container) return;

  if (!bookings || bookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h4>No confirmed bookings.</h4>
        <p>No bookings have been confirmed yet.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = bookings.map(booking => {
    const menuLink = menuLinksByBooking[booking.id];
    const hasSelections = menuLink && (menuLink.selected_food?.length > 0 || menuLink.selected_beverages?.length > 0);
    const hasMenuLink = !!menuLink;

    return `
    <div class="booking-card" data-booking-id="${booking.id}">
      <div class="booking-header">
        <h4 class="editable-name" contenteditable="false">${booking.full_name}</h4>
        <div class="booking-header-actions">
          <span class="booking-status ${hasSelections ? 'status-complete' : hasMenuLink ? 'status-pending' : 'status-new'}">
            ${hasSelections ? '✓ Menu Selected' : hasMenuLink ? '⏳ Awaiting Selection' : 'New'}
          </span>
          <button class="btn btn--sm btn--outline edit-booking-btn" onclick="toggleEditBooking(${booking.id})">✏️ Edit</button>
        </div>
      </div>
      
      <div class="booking-details-view" id="booking-view-${booking.id}">
        <div class="booking-details-grid">
          <p><strong>📅 Date:</strong> ${booking.preferred_date || 'N/A'}</p>
          <p><strong>🕐 Time:</strong> ${booking.event_time || 'N/A'}</p>
          <p><strong>👥 Guests:</strong> ${booking.guest_count || 'N/A'}</p>
          <p><strong>📍 Location:</strong> ${booking.location || 'N/A'}</p>
          <p><strong>📱 Mobile:</strong> ${booking.mobile_number || 'N/A'}</p>
          <p><strong>📧 Email:</strong> ${booking.email_address || 'N/A'}</p>
          <p><strong>💰 Total:</strong> ₹${booking.booking_amount || 0}</p>
          <p><strong>💵 Advance:</strong> ₹${booking.advance_amount || 0}</p>
        </div>
        ${booking.special_requirements ? `<p style="margin-top:8px;"><strong>📝 Special:</strong> ${booking.special_requirements}</p>` : ''}
        
        ${booking.addons && booking.addons.length > 0 ? `
          <div class="booking-addons-display" style="margin-top:12px; padding:12px; background:var(--color-surface); border-radius:8px;">
            <h5 style="margin-bottom:8px; color:var(--color-primary);">🎁 Add-ons</h5>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
              ${booking.addons.map(addon => `
                <span style="display:inline-flex; align-items:center; gap:6px; padding:6px 12px; background:var(--color-background); border-radius:20px; font-size:0.875rem; border:1px solid var(--color-border);">
                  ${addon.name} <strong style="color:var(--color-primary);">₹${addon.price}</strong>
                </span>
              `).join('')}
            </div>
            <p style="margin-top:8px; text-align:right; font-weight:600;">Add-ons Total: ₹${booking.addons.reduce((sum, a) => sum + (a.price || 0), 0)}</p>
          </div>
        ` : ''}
      </div>

      <div class="booking-details-edit hidden" id="booking-edit-${booking.id}">
        <div class="form-row-grid">
          <div class="form-group">
            <label class="form-label">Full Name</label>
            <input type="text" class="form-control" id="edit-name-${booking.id}" value="${booking.full_name || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Mobile</label>
            <input type="tel" class="form-control" id="edit-mobile-${booking.id}" value="${booking.mobile_number || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-control" id="edit-email-${booking.id}" value="${booking.email_address || ''}">
          </div>
        </div>
        <div class="form-row-grid">
          <div class="form-group">
            <label class="form-label">Event Date</label>
            <input type="date" class="form-control" id="edit-date-${booking.id}" value="${booking.preferred_date || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Event Time</label>
            <input type="time" class="form-control" id="edit-time-${booking.id}" value="${booking.event_time || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Guest Count</label>
            <input type="number" class="form-control" id="edit-guests-${booking.id}" value="${booking.guest_count || ''}" min="1">
          </div>
        </div>
        <div class="form-row-grid">
          <div class="form-group">
            <label class="form-label">Location</label>
            <select class="form-control" id="edit-location-${booking.id}">
              <option value="jaipur" ${booking.location === 'jaipur' ? 'selected' : ''}>Jaipur</option>
              <option value="gurugram" ${booking.location === 'gurugram' ? 'selected' : ''}>Gurugram</option>
              <option value="custom" ${booking.location === 'custom' ? 'selected' : ''}>Custom Location</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Total Amount (₹)</label>
            <input type="number" class="form-control" id="edit-total-${booking.id}" value="${booking.booking_amount || ''}" min="0">
          </div>
          <div class="form-group">
            <label class="form-label">Advance Amount (₹)</label>
            <input type="number" class="form-control" id="edit-advance-${booking.id}" value="${booking.advance_amount || ''}" min="0">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Special Requirements</label>
          <textarea class="form-control" id="edit-special-${booking.id}" rows="2">${booking.special_requirements || ''}</textarea>
        </div>
        
        <!-- Add-ons Section for Bookings -->
        <div class="addons-section" style="margin-top:16px; padding:12px; background:var(--color-surface); border-radius:8px;">
          <div class="addons-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <label class="form-label" style="margin:0;">🎁 Add-ons</label>
            <button type="button" class="btn btn--sm btn--outline" onclick="showBookingAddonSelector(${booking.id})" style="padding:4px 12px;">
              ➕ Add
            </button>
          </div>
          <div id="booking-addons-${booking.id}" class="selected-addons-list">
            <!-- Selected add-ons will appear here -->
          </div>
          <div id="booking-addon-selector-${booking.id}" class="addon-selector hidden" style="margin-top:12px; padding:12px; background:var(--color-background); border-radius:8px; border:1px solid var(--color-border);">
            <div class="form-group" style="margin-bottom:8px;">
              <select id="booking-addon-select-${booking.id}" class="form-control">
                <option value="">-- Select Add-on --</option>
                ${addonsList.map(addon => `<option value="${addon}">${addon}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom:8px;">
              <input type="number" id="booking-addon-price-${booking.id}" class="form-control" placeholder="Price (₹)" min="0" step="50">
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn btn--sm btn--primary" onclick="addBookingAddon(${booking.id})">Add</button>
              <button type="button" class="btn btn--sm btn--outline" onclick="hideBookingAddonSelector(${booking.id})">Cancel</button>
            </div>
          </div>
        </div>
        
        <div class="edit-actions" style="margin-top:16px;">
          <button class="btn btn--primary btn--sm" onclick="saveBookingEdit(${booking.id})">💾 Save Changes</button>
          <button class="btn btn--outline btn--sm" onclick="toggleEditBooking(${booking.id})">Cancel</button>
        </div>
      </div>

      ${hasSelections ? `
        <div class="selected-items-section">
          <h5>🍽️ Selected Food Items (${menuLink.selected_food?.length || 0})</h5>
          <div class="selected-items-list">
            ${menuLink.selected_food?.map(item => `<span class="selected-item-tag">${item}</span>`).join('') || '<em>None selected</em>'}
          </div>
          
          <h5>🥤 Selected Beverages (${menuLink.selected_beverages?.length || 0})</h5>
          <div class="selected-items-list">
            ${menuLink.selected_beverages?.map(item => `<span class="selected-item-tag bev">${item}</span>`).join('') || '<em>None selected</em>'}
          </div>
        </div>
      ` : `
        <div class="menu-link-section">
          ${hasMenuLink ? `
            <div class="menu-link-result">
              <p><strong>🔗 Menu Link:</strong></p>
              <div class="link-copy-row">
                <input type="text" class="form-control" value="${window.location.origin}?menu=${menuLink.id}" readonly>
                <button class="btn btn--sm btn--primary" onclick="copyToClipboard('${window.location.origin}?menu=${menuLink.id}')">Copy</button>
              </div>
            </div>
          ` : `
            <p class="menu-link-note">⚠️ No menu link generated. Menu link was created during booking confirmation.</p>
          `}
        </div>
      `}
    </div>
  `}).join('');
}

// Handler for menu link generator form submissions (called via event delegation)
async function handleMenuLinkGeneration(event) {
  if (!event.target.classList.contains('menu-link-generator')) return;

  event.preventDefault();

  const form = event.target;
  const bookingCard = form.closest('.booking-card');
  if (!bookingCard) return;

  const bookingId = parseInt(bookingCard.dataset.bookingId, 10);
  const foodLimit = parseInt(form['food-limit'].value, 10);
  const beverageLimit = parseInt(form['beverage-limit'].value, 10);

  try {
    const { data, error } = await supabase
      .from('menu_links')
      .insert([{
        max_food_items: foodLimit,
        max_bev_items: beverageLimit,
        booking_id: bookingId
      }])
      .select();

    if (error) throw error;

    const linkId = data?.[0]?.id;
    if (!linkId) throw new Error('No link ID returned');
    
    const url = `${window.location.origin}?menu=${linkId}`;
    showToast('Menu link generated successfully.', 'success');
    
    // Reload bookings to show updated state
    loadBookings();
    loadMenuLinks();
  } catch (err) {
    console.error(err);
    showToast('Failed to generate menu link.', 'error');
  }
}

function renderMenuLinks(links) {
  const container = document.getElementById('menu-links-container') || document.getElementById('menu-links-list');
  if (!container) return;
  if (!links || links.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No Menu Links</h3></div>';
    return;
  }
  container.innerHTML = links.map(link => `
    <div class="menu-links-list">
      <div class="menu-link-item">
        <div class="menu-link-info">
          <div class="menu-link-id">#${link.id}</div>
          <div class="menu-link-details">Food: ${link.max_food_items}, Bev: ${link.max_bev_items}</div>
        </div>
        <button class="btn btn--sm btn--outline" onclick="copyToClipboard('${window.location.origin}?menu=${link.id}')">
          Copy Link
        </button>
      </div>
    </div>
  `).join('');
}

// ===== Add-ons Functions =====
function showAddonSelector(queryId) {
  document.getElementById(`addon-selector-${queryId}`)?.classList.remove('hidden');
}

function hideAddonSelector(queryId) {
  document.getElementById(`addon-selector-${queryId}`)?.classList.add('hidden');
  document.getElementById(`addon-select-${queryId}`).value = '';
  document.getElementById(`addon-price-${queryId}`).value = '';
}

function addAddon(queryId) {
  const selectEl = document.getElementById(`addon-select-${queryId}`);
  const priceEl = document.getElementById(`addon-price-${queryId}`);
  
  const addonName = selectEl?.value;
  const addonPrice = parseFloat(priceEl?.value) || 0;
  
  if (!addonName) {
    showToast('Please select an add-on', 'error');
    return;
  }
  if (addonPrice <= 0) {
    showToast('Please enter a valid price', 'error');
    return;
  }
  
  // Initialize array if needed
  if (!selectedAddons[queryId]) {
    selectedAddons[queryId] = [];
  }
  
  // Check if already added
  if (selectedAddons[queryId].some(a => a.name === addonName)) {
    showToast('This add-on is already added', 'error');
    return;
  }
  
  // Add to list
  selectedAddons[queryId].push({ name: addonName, price: addonPrice });
  
  // Render updated list
  renderSelectedAddons(queryId);
  
  // Hide selector and reset
  hideAddonSelector(queryId);
  showToast('Add-on added', 'success');
}

function removeAddon(queryId, addonName) {
  if (!selectedAddons[queryId]) return;
  
  selectedAddons[queryId] = selectedAddons[queryId].filter(a => a.name !== addonName);
  renderSelectedAddons(queryId);
}

function renderSelectedAddons(queryId) {
  const container = document.getElementById(`selected-addons-${queryId}`);
  if (!container) return;
  
  const addons = selectedAddons[queryId] || [];
  
  if (addons.length === 0) {
    container.innerHTML = '<p style="color:var(--color-text-muted); font-size:0.875rem;">No add-ons selected</p>';
    return;
  }
  
  const total = addons.reduce((sum, a) => sum + a.price, 0);
  
  container.innerHTML = `
    <div class="addons-list" style="display:flex; flex-direction:column; gap:8px;">
      ${addons.map(addon => `
        <div class="addon-item" style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--color-background); border-radius:6px; border:1px solid var(--color-border);">
          <span style="flex:1;">${addon.name}</span>
          <span style="font-weight:600; color:var(--color-primary); margin-right:12px;">₹${addon.price}</span>
          <button type="button" onclick="removeAddon(${queryId}, '${addon.name}')" style="background:none; border:none; color:var(--color-error); cursor:pointer; font-size:1.2rem; padding:0 4px;">✕</button>
        </div>
      `).join('')}
      <div style="text-align:right; font-weight:600; padding-top:8px; border-top:1px solid var(--color-border);">
        Add-ons Total: ₹${total}
      </div>
    </div>
  `;
}

// ===== Booking Add-ons Functions (for confirmed bookings) =====
// Track add-ons for bookings being edited (key: 'b-' + bookingId)
const bookingAddons = {};

function initBookingAddons(bookingId, existingAddons) {
  bookingAddons[`b-${bookingId}`] = existingAddons ? [...existingAddons] : [];
  renderBookingAddons(bookingId);
}

function showBookingAddonSelector(bookingId) {
  document.getElementById(`booking-addon-selector-${bookingId}`)?.classList.remove('hidden');
}

function hideBookingAddonSelector(bookingId) {
  document.getElementById(`booking-addon-selector-${bookingId}`)?.classList.add('hidden');
  const selectEl = document.getElementById(`booking-addon-select-${bookingId}`);
  const priceEl = document.getElementById(`booking-addon-price-${bookingId}`);
  if (selectEl) selectEl.value = '';
  if (priceEl) priceEl.value = '';
}

function addBookingAddon(bookingId) {
  const selectEl = document.getElementById(`booking-addon-select-${bookingId}`);
  const priceEl = document.getElementById(`booking-addon-price-${bookingId}`);
  
  const addonName = selectEl?.value;
  const addonPrice = parseFloat(priceEl?.value) || 0;
  
  if (!addonName) {
    showToast('Please select an add-on', 'error');
    return;
  }
  if (addonPrice <= 0) {
    showToast('Please enter a valid price', 'error');
    return;
  }
  
  const key = `b-${bookingId}`;
  if (!bookingAddons[key]) {
    bookingAddons[key] = [];
  }
  
  // Check if already added
  if (bookingAddons[key].some(a => a.name === addonName)) {
    showToast('This add-on is already added', 'error');
    return;
  }
  
  bookingAddons[key].push({ name: addonName, price: addonPrice });
  renderBookingAddons(bookingId);
  hideBookingAddonSelector(bookingId);
  showToast('Add-on added', 'success');
}

function removeBookingAddon(bookingId, addonName) {
  const key = `b-${bookingId}`;
  if (!bookingAddons[key]) return;
  
  bookingAddons[key] = bookingAddons[key].filter(a => a.name !== addonName);
  renderBookingAddons(bookingId);
}

function renderBookingAddons(bookingId) {
  const container = document.getElementById(`booking-addons-${bookingId}`);
  if (!container) return;
  
  const key = `b-${bookingId}`;
  const addons = bookingAddons[key] || [];
  
  if (addons.length === 0) {
    container.innerHTML = '<p style="color:var(--color-text-muted); font-size:0.875rem;">No add-ons selected</p>';
    return;
  }
  
  const total = addons.reduce((sum, a) => sum + a.price, 0);
  
  container.innerHTML = `
    <div class="addons-list" style="display:flex; flex-direction:column; gap:8px;">
      ${addons.map(addon => `
        <div class="addon-item" style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--color-background); border-radius:6px; border:1px solid var(--color-border);">
          <span style="flex:1;">${addon.name}</span>
          <span style="font-weight:600; color:var(--color-primary); margin-right:12px;">₹${addon.price}</span>
          <button type="button" onclick="removeBookingAddon(${bookingId}, '${addon.name}')" style="background:none; border:none; color:var(--color-error); cursor:pointer; font-size:1.2rem; padding:0 4px;">✕</button>
        </div>
      `).join('')}
      <div style="text-align:right; font-weight:600; padding-top:8px; border-top:1px solid var(--color-border);">
        Add-ons Total: ₹${total}
      </div>
    </div>
  `;
}

// ===== Actions =====
async function confirmBooking(queryId) {
  const timeInput = document.getElementById(`time-${queryId}`);
  const bookingInput = document.getElementById(`booking-${queryId}`);
  const advanceInput = document.getElementById(`advance-${queryId}`);
  const foodLimitInput = document.getElementById(`food-limit-${queryId}`);
  const bevLimitInput = document.getElementById(`bev-limit-${queryId}`);

  const eventTime = timeInput?.value;
  const bookingAmount = parseFloat(bookingInput?.value);
  const advanceAmount = parseFloat(advanceInput?.value) || 0;
  const foodLimit = parseInt(foodLimitInput?.value, 10);
  const bevLimit = parseInt(bevLimitInput?.value, 10);

  if (!eventTime) {
    showToast('Please enter event time', 'error');
    return;
  }
  if (!bookingAmount || bookingAmount <= 0) {
    showToast('Please enter a valid total booking amount', 'error');
    return;
  }
  if (advanceAmount < 0 || advanceAmount > bookingAmount) {
    showToast('Please enter a valid advance amount (0 to total)', 'error');
    return;
  }
  if (!foodLimit || foodLimit < 1) {
    showToast('Please enter food items limit', 'error');
    return;
  }
  if (!bevLimit || bevLimit < 1) {
    showToast('Please enter beverages limit', 'error');
    return;
  }

  try {
    // Get selected add-ons for this booking
    const addons = selectedAddons[queryId] || [];
    
    // Update booking
    const { error: bookingError } = await supabase
      .from('bookings')
      .update({
        confirmed: true,
        event_time: eventTime,
        booking_amount: bookingAmount,
        advance_amount: advanceAmount,
        addons: addons
      })
      .eq('id', queryId);
    if (bookingError) throw bookingError;
    
    // Clear selected addons for this query
    delete selectedAddons[queryId];

    // Create menu link for this booking
    const { data: linkData, error: linkError } = await supabase
      .from('menu_links')
      .insert([{
        max_food_items: foodLimit,
        max_bev_items: bevLimit,
        booking_id: queryId
      }])
      .select();
    if (linkError) throw linkError;

    const menuLinkUrl = `${window.location.origin}?menu=${linkData[0].id}`;
    showToast('Booking confirmed & menu link generated!', 'success');
    
    // Update the booking_json column
    await updateBookingJSON(queryId);
    
    // Copy link to clipboard
    try {
      await navigator.clipboard.writeText(menuLinkUrl);
      showToast('Menu link copied to clipboard!', 'success');
    } catch (e) {
      console.log('Could not copy to clipboard');
    }

    loadQueries();
    loadBookings();
    loadMenuLinks();
  } catch (err) {
    console.error(err);
    showToast('Failed to confirm booking', 'error');
  }
}

// Toggle edit mode for booking
async function toggleEditBooking(bookingId) {
  const viewSection = document.getElementById(`booking-view-${bookingId}`);
  const editSection = document.getElementById(`booking-edit-${bookingId}`);
  
  if (viewSection && editSection) {
    const isEnteringEditMode = editSection.classList.contains('hidden');
    
    viewSection.classList.toggle('hidden');
    editSection.classList.toggle('hidden');
    
    // Initialize addons when entering edit mode
    if (isEnteringEditMode) {
      // Fetch current booking data to get addons
      try {
        const { data: booking, error } = await supabase
          .from('bookings')
          .select('addons')
          .eq('id', bookingId)
          .single();
        
        if (!error && booking) {
          initBookingAddons(bookingId, booking.addons);
        }
      } catch (err) {
        console.error('Failed to load booking addons:', err);
        initBookingAddons(bookingId, []);
      }
    }
  }
}

// Save booking edits
async function saveBookingEdit(bookingId) {
  // Get addons for this booking
  const addons = bookingAddons[`b-${bookingId}`] || [];
  
  const updates = {
    full_name: document.getElementById(`edit-name-${bookingId}`)?.value,
    mobile_number: document.getElementById(`edit-mobile-${bookingId}`)?.value,
    email_address: document.getElementById(`edit-email-${bookingId}`)?.value,
    preferred_date: document.getElementById(`edit-date-${bookingId}`)?.value,
    event_time: document.getElementById(`edit-time-${bookingId}`)?.value,
    guest_count: parseInt(document.getElementById(`edit-guests-${bookingId}`)?.value, 10) || null,
    location: document.getElementById(`edit-location-${bookingId}`)?.value,
    booking_amount: parseFloat(document.getElementById(`edit-total-${bookingId}`)?.value) || 0,
    advance_amount: parseFloat(document.getElementById(`edit-advance-${bookingId}`)?.value) || 0,
    special_requirements: document.getElementById(`edit-special-${bookingId}`)?.value,
    addons: addons
  };

  try {
    const { error } = await supabase
      .from('bookings')
      .update(updates)
      .eq('id', bookingId);
    
    if (error) throw error;
    
    // Update the booking_json column
    await updateBookingJSON(bookingId);
    
    showToast('Booking updated successfully', 'success');
    loadBookings();
  } catch (err) {
    console.error(err);
    showToast('Failed to update booking', 'error');
  }
}

async function generateMenuLink() {
  if (!isAdminLoggedIn) return showToast('Login required', 'error');
  const foodCount = parseInt(document.getElementById('food-count').value);
  const bevCount = parseInt(document.getElementById('bev-count').value);
  if (foodCount < 1 || foodCount > 15 || bevCount < 1 || bevCount > 10) {
    return showToast('Invalid item counts', 'error');
  }
  try {
    const { data, error } = await supabase
      .from('menu_links')
      .insert([{ max_food_items: foodCount, max_bev_items: bevCount }])
      .select();
    if (error) throw error;
    const url = `${window.location.origin}?menu=${data[0].id}`;
    document.querySelector('.generated-link').classList.remove('hidden');
    document.getElementById('generated-link-url').value = url;
    showToast('Menu link generated', 'success');
    loadMenuLinks();
  } catch (err) {
    console.error(err);
    showToast('Failed to generate menu link', 'error');
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => showToast('Copied to clipboard', 'success'))
    .catch(() => showToast('Copy failed', 'error'));
}

// ===== Event Listeners =====
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('admin-login-form')?.addEventListener('submit', handleAdminLogin);
  document.getElementById('admin-logout')?.addEventListener('click', handleAdminLogout);

  // Delegated event listener for menu link generation in bookings tab
  document.getElementById('bookings-container')?.addEventListener('submit', handleMenuLinkGeneration);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab + "-tab";
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
        c.setAttribute('hidden', true);
      });
      const target = document.getElementById(tab);
      if (target) {
        target.classList.add('active');
        target.removeAttribute('hidden');
      }
    });
  });

  document.getElementById('generate-menu-link')?.addEventListener('click', generateMenuLink);
});

// Expose functions globally
window.confirmBooking = confirmBooking;
window.copyToClipboard = copyToClipboard;
window.toggleEditBooking = toggleEditBooking;
window.saveBookingEdit = saveBookingEdit;
window.showAddonSelector = showAddonSelector;
window.hideAddonSelector = hideAddonSelector;
window.addAddon = addAddon;
window.removeAddon = removeAddon;
window.showBookingAddonSelector = showBookingAddonSelector;
window.hideBookingAddonSelector = hideBookingAddonSelector;
window.addBookingAddon = addBookingAddon;
window.removeBookingAddon = removeBookingAddon;
