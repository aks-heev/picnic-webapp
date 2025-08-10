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
    const { data: bookings, error: bErr } = await supabase
      .from('bookings')
      .select()
      .eq('confirmed', true)
      .order('created_at', { ascending: false });

    if (bErr) throw bErr;

    const bookingsWithOrders = await Promise.all(
      bookings.map(async booking => {
        const { data: orders, error: oErr } = await supabase
          .from('orders')
          .select('id, selected_items, created_at')
          .eq('booking_id', booking.id);

        if (oErr) throw oErr;
        return { ...booking, orders };
      })
    );

    renderBookings(bookingsWithOrders);
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

// ===== Actions =====
async function confirmBooking(queryId) {
  const query = await getBookingById(queryId);
  if (!query) return;

  // Create confirmation modal
  const modalHTML = `
    <div id="confirm-booking-modal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Confirm Booking - ${query.full_name}</h2>
          <button class="modal-close" onclick="closeConfirmModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="booking-summary">
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Customer:</span>
                <span class="info-value">${query.full_name}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Mobile:</span>
                <span class="info-value">${query.mobile_number}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Guests:</span>
                <span class="info-value">${query.guest_count}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Date:</span>
                <span class="info-value">${query.preferred_date}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Location:</span>
                <span class="info-value">${query.location}</span>
              </div>
            </div>
          </div>
          <form id="confirm-booking-form">
            <div class="form-group">
              <label class="form-label" for="total-booking-amount">Total Booking Amount (₹)</label>
              <input id="total-booking-amount" name="total-booking-amount" type="number" 
                     class="form-control" value="${query.booking_amount || ''}" 
                     placeholder="Enter total booking amount" min="0" step="50" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="advance-booking-amount">Advance Amount Received (₹)</label>
              <input id="advance-booking-amount" name="advance-booking-amount" type="number" 
                     class="form-control" value="${query.advance_amount || ''}" 
                     placeholder="Enter advance amount received" min="0" step="50">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn--outline" onclick="closeConfirmModal()">
                Cancel
              </button>
              <button type="submit" class="btn btn--primary">
                Confirm Booking
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  // Remove existing modal if any
  const existingModal = document.getElementById('confirm-booking-modal');
  if (existingModal) existingModal.remove();

  // Add modal to body
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  document.getElementById('confirm-booking-modal').classList.remove('hidden');

  // Handle form submission
  document.getElementById('confirm-booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const totalAmount = parseFloat(formData.get('total-booking-amount'));
    const advanceAmount = parseFloat(formData.get('advance-booking-amount')) || 0;

    if (totalAmount <= 0) {
      showToast('Please enter a valid total booking amount', 'error');
      return;
    }

    if (advanceAmount > totalAmount) {
      showToast('Advance amount cannot be greater than total amount', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('bookings')
        .update({
          booking_amount: totalAmount,
          advance_amount: advanceAmount,
          confirmed: true
        })
        .eq('id', queryId);

      if (error) throw error;

      showToast('Booking confirmed successfully!', 'success');
      closeConfirmModal();
      loadQueries();
      loadBookings();
    } catch (err) {
      console.error(err);
      showToast('Failed to confirm booking', 'error');
    }
  });
}

async function updateBookingAmount(bookingId) {
  const booking = await getBookingById(bookingId);
  if (!booking) return;

  // Create update modal
  const modalHTML = `
    <div id="update-booking-modal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Update Booking Amount - ${booking.full_name}</h2>
          <button class="modal-close" onclick="closeUpdateModal()">&times;</button>
        </div>
        <div class="modal-body">
          <form id="update-booking-form">
            <div class="form-group">
              <label class="form-label" for="update-total-amount">Total Booking Amount (₹)</label>
              <input id="update-total-amount" name="update-total-amount" type="number" 
                     class="form-control" value="${booking.booking_amount || ''}" 
                     placeholder="Enter total booking amount" min="0" step="50" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="update-advance-amount">Advance Amount Received (₹)</label>
              <input id="update-advance-amount" name="update-advance-amount" type="number" 
                     class="form-control" value="${booking.advance_amount || ''}" 
                     placeholder="Enter advance amount received" min="0" step="50">
            </div>
            <div class="form-group">
              <div class="payment-summary">
                <strong>Current Balance: ₹${(booking.booking_amount || 0) - (booking.advance_amount || 0)}</strong>
              </div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn--outline" onclick="closeUpdateModal()">
                Cancel
              </button>
              <button type="submit" class="btn btn--primary">
                Update Amount
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  // Remove existing modal if any
  const existingModal = document.getElementById('update-booking-modal');
  if (existingModal) existingModal.remove();

  // Add modal to body
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  document.getElementById('update-booking-modal').classList.remove('hidden');

  // Handle form submission
  document.getElementById('update-booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const totalAmount = parseFloat(formData.get('update-total-amount'));
    const advanceAmount = parseFloat(formData.get('update-advance-amount')) || 0;

    if (totalAmount <= 0) {
      showToast('Please enter a valid total booking amount', 'error');
      return;
    }

    if (advanceAmount > totalAmount) {
      showToast('Advance amount cannot be greater than total amount', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('bookings')
        .update({
          booking_amount: totalAmount,
          advance_amount: advanceAmount
        })
        .eq('id', bookingId);

      if (error) throw error;

      showToast('Booking amount updated successfully!', 'success');
      closeUpdateModal();
      loadBookings();
    } catch (err) {
      console.error(err);
      showToast('Failed to update booking amount', 'error');
    }
  });
}

async function getBookingById(id) {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select()
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error fetching booking:', err);
    showToast('Failed to fetch booking details', 'error');
    return null;
  }
}

function closeConfirmModal() {
  const modal = document.getElementById('confirm-booking-modal');
  if (modal) modal.remove();
}

function closeUpdateModal() {
  const modal = document.getElementById('update-booking-modal');
  if (modal) modal.remove();
}

async function generateMenuLink(foodCount, bevCount) {
  if (!isAdminLoggedIn) return showToast('Login required', 'error');

  if (foodCount < 1 || foodCount > 15 || bevCount < 1 || bevCount > 10) {
    return showToast('Invalid item counts', 'error');
  }

  try {
    const menuLink = {
      max_food_items: foodCount,
      max_bev_items: bevCount,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('menu_links')
      .insert([menuLink])
      .select();

    if (error) throw error;

    const linkInput = document.getElementById('generated-link-url');
    linkInput.value = `${window.location.origin}?menu=${data[0].id}`;
    document.querySelector('.generated-link').style.display = 'block';

    showToast('Menu link generated', 'success');
    loadMenuLinks();
  } catch (err) {
    console.error(err);
    showToast('Failed to generate menu link', 'error');
  }
}

// ===== Render Functions =====
function renderQueries(queries) {
  const container = document.getElementById('queries-container');

  if (!queries || queries.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No Pending Queries</h3><p>New customer queries will appear here.</p></div>';
    return;
  }

  container.innerHTML = queries.map(query => `
    <div class="leads-table">
      <div class="lead-item">
        <div class="lead-header">
          <div class="lead-name">${query.full_name}</div>
          <div class="lead-date">${new Date(query.created_at).toLocaleDateString()}</div>
        </div>
        <div class="lead-details">
          <div class="lead-detail">
            <strong>Mobile:</strong>
            <span>${query.mobile_number}</span>
          </div>
          <div class="lead-detail">
            <strong>Email:</strong>
            <span>${query.email_address}</span>
          </div>
          <div class="lead-detail">
            <strong>Location:</strong>
            <span>${query.location}</span>
          </div>
          <div class="lead-detail">
            <strong>Guests:</strong>
            <span>${query.guest_count}</span>
          </div>
          <div class="lead-detail">
            <strong>Preferred Date:</strong>
            <span>${query.preferred_date}</span>
          </div>
        </div>
        ${query.special_requirements ? `
          <div style="margin-top: 12px;">
            <strong>Special Requirements:</strong>
            <p style="margin: 4px 0;">${query.special_requirements}</p>
          </div>
        ` : ''}
        <div style="margin-top: 16px;">
          <button class="btn btn--primary" onclick="confirmBooking(${query.id})">
            Confirm Booking
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderBookings(bookings) {
  const container = document.getElementById('bookings-container');

  if (!bookings || bookings.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No Confirmed Bookings</h3><p>Confirmed bookings will appear here.</p></div>';
    return;
  }

  container.innerHTML = bookings.map(booking => {
    const balance = (booking.booking_amount || 0) - (booking.advance_amount || 0);
    const balanceColor = balance > 0 ? 'color: #f59e0b;' : 'color: #10b981;';
    
    return `
      <div class="leads-table">
        <div class="lead-item">
          <div class="lead-header">
            <div class="lead-name">${booking.full_name}</div>
            <div class="lead-date">${new Date(booking.created_at).toLocaleDateString()}</div>
          </div>
          <div class="lead-details">
            <div class="lead-detail">
              <strong>Mobile:</strong>
              <span>${booking.mobile_number}</span>
            </div>
            <div class="lead-detail">
              <strong>Email:</strong>
              <span>${booking.email_address}</span>
            </div>
            <div class="lead-detail">
              <strong>Location:</strong>
              <span>${booking.location}</span>
            </div>
            <div class="lead-detail">
              <strong>Guests:</strong>
              <span>${booking.guest_count}</span>
            </div>
            <div class="lead-detail">
              <strong>Preferred Date:</strong>
              <span>${booking.preferred_date}</span>
            </div>
            <div class="lead-detail">
              <strong>Total Amount:</strong>
              <span>₹${booking.booking_amount || 0}</span>
            </div>
            <div class="lead-detail">
              <strong>Advance Paid:</strong>
              <span>₹${booking.advance_amount || 0}</span>
            </div>
            <div class="lead-detail">
              <strong>Balance:</strong>
              <span style="${balanceColor}"><strong>₹${balance}</strong></span>
            </div>
          </div>
          ${booking.special_requirements ? `
            <div style="margin-top: 12px;">
              <strong>Special Requirements:</strong>
              <p style="margin: 4px 0;">${booking.special_requirements}</p>
            </div>
          ` : ''}
          <div style="margin-top: 16px; display: flex; gap: 8px;">
            <button class="btn btn--secondary" onclick="updateBookingAmount(${booking.id})">
              Update Amount
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderMenuLinks(menuLinks) {
  const container = document.getElementById('menu-links-container');

  if (!menuLinks || menuLinks.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No Menu Links</h3><p>Generated menu links will appear here.</p></div>';
    return;
  }

  container.innerHTML = menuLinks.map(link => `
    <div class="menu-links-list">
      <div class="menu-link-item">
        <div class="menu-link-info">
          <div class="menu-link-id">Menu Link #${link.id}</div>
          <div class="menu-link-details">
            Food: ${link.max_food_items} items | Beverages: ${link.max_bev_items} items
            <br>Created: ${new Date(link.created_at).toLocaleDateString()}
          </div>
        </div>
        <div class="menu-link-actions">
          <button class="btn btn--sm btn--outline" 
                  onclick="copyToClipboard('${window.location.origin}?menu=${link.id}')">
            Copy Link
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// ===== Utility Functions =====
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Link copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy link', 'error');
  });
}

// ===== Event Listeners =====
window.addEventListener('DOMContentLoaded', () => {
  // Login form
  document.getElementById('admin-login-form')?.addEventListener('submit', handleAdminLogin);
  
  // Logout button
  document.getElementById('admin-logout')?.addEventListener('click', handleAdminLogout);

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      // Update active tab
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Show/hide content
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(tab)?.classList.add('active');
    });
  });

  // Menu link generator
  document.getElementById('generate-menu-link')?.addEventListener('click', () => {
    const foodCount = parseInt(document.getElementById('food-count').value);
    const bevCount = parseInt(document.getElementById('bev-count').value);
    generateMenuLink(foodCount, bevCount);
  });

  // Copy generated link
  document.getElementById('copy-generated-link')?.addEventListener('click', () => {
    const linkInput = document.getElementById('generated-link-url');
    copyToClipboard(linkInput.value);
  });
});

// Make functions global for onclick handlers
window.confirmBooking = confirmBooking;
window.updateBookingAmount = updateBookingAmount;
window.closeConfirmModal = closeConfirmModal;
window.closeUpdateModal = closeUpdateModal;
window.copyToClipboard = copyToClipboard;
