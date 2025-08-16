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
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select()
      .eq('confirmed', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    renderBookings(bookings);
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
  if (!queries || queries.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No Pending Queries</h3></div>';
    return;
  }
  container.innerHTML = queries.map(q => `
    <div class="leads-table">
      <div class="lead-item">
        <div class="lead-header">
          <div class="lead-name">${q.full_name}</div>
          <div class="lead-date">${new Date(q.created_at).toLocaleDateString()}</div>
        </div>
        <div class="lead-details">
          <div class="lead-detail"><strong>Mobile:</strong><span>${q.mobile_number}</span></div>
          <div class="lead-detail"><strong>Email:</strong><span>${q.email_address}</span></div>
          <div class="lead-detail"><strong>Location:</strong><span>${q.location}</span></div>
          <div class="lead-detail"><strong>Guests:</strong><span>${q.guest_count}</span></div>
          <div class="lead-detail"><strong>Date:</strong><span>${q.preferred_date}</span></div>
        </div>
        ${q.special_requirements ? `
          <div style="margin-top:12px;">
            <strong>Special:</strong>
            <p>${q.special_requirements}</p>
          </div>
        ` : ''}
        <div style="margin-top:16px;">
          <div class="form-group">
            <label class="form-label" for="booking-${q.id}">Total Booking Amount (₹)</label>
            <input id="booking-${q.id}" type="number" class="form-control" placeholder="Total amount" min="0" step="50" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="advance-${q.id}">Advance Amount (₹)</label>
            <input id="advance-${q.id}" type="number" class="form-control" placeholder="Advance amount" min="0" step="50">
          </div>
          <button class="btn btn--primary" onclick="confirmBooking(${q.id})">
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
    container.innerHTML = '<div class="empty-state"><h3>No Confirmed Bookings</h3></div>';
    return;
  }
  container.innerHTML = bookings.map(b => {
    const balance = (b.booking_amount || 0) - (b.advance_amount || 0);
    return `
      <div class="leads-table">
        <div class="lead-item">
          <div class="lead-header">
            <div class="lead-name">${b.full_name}</div>
            <div class="lead-date">${new Date(b.created_at).toLocaleDateString()}</div>
          </div>
          <div class="lead-details">
            <div class="lead-detail"><strong>Mobile:</strong><span>${b.mobile_number}</span></div>
            <div class="lead-detail"><strong>Email:</strong><span>${b.email_address}</span></div>
            <div class="lead-detail"><strong>Location:</strong><span>${b.location}</span></div>
            <div class="lead-detail"><strong>Guests:</strong><span>${b.guest_count}</span></div>
            <div class="lead-detail"><strong>Date:</strong><span>${b.preferred_date}</span></div>
            <div class="lead-detail"><strong>Total:</strong><span>₹${b.booking_amount||0}</span></div>
            <div class="lead-detail"><strong>Advance:</strong><span>₹${b.advance_amount||0}</span></div>
            <div class="lead-detail"><strong>Balance:</strong><span style="${balance > 0 ? 'color: #f59e0b;' : 'color: #10b981;'}">₹${balance}</span></div>
          </div>
          ${b.special_requirements ? `
            <div style="margin-top:12px;">
              <strong>Special:</strong>
              <p>${b.special_requirements}</p>
            </div>
          ` : ''}
          <button class="btn btn--secondary" onclick="updateBookingAmount(${b.id})">
            Update Amount
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderMenuLinks(links) {
  const container = document.getElementById('menu-links-container');
  if (!links || links.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No Menu Links</h3></div>';
    return;
  }
  container.innerHTML = links.map(link => `
    <div class="menu-links-list">
      <div class="menu-link-item">
        <div class="menu-link-info">
          <div class="menu-link-id">Menu Link #${link.id}</div>
          <div class="menu-link-details">
            Food: ${link.max_food_items} items | Beverages: ${link.max_bev_items} items
            <br>Created: ${new Date(link.created_at).toLocaleDateString()}
          </div>
        </div>
        <button class="btn btn--sm btn--outline" onclick="copyToClipboard('${window.location.origin}?menu=${link.id}')">
          Copy Link
        </button>
      </div>
    </div>
  `).join('');
}

// ===== Actions =====
async function confirmBooking(queryId) {
  const bookingInput = document.getElementById(`booking-${queryId}`);
  const advanceInput = document.getElementById(`advance-${queryId}`);
  const bookingAmount = parseFloat(bookingInput.value);
  const advanceAmount = parseFloat(advanceInput.value) || 0;

  if (!bookingAmount || bookingAmount <= 0) {
    showToast('Please enter a valid total booking amount', 'error');
    return;
  }
  if (advanceAmount < 0 || advanceAmount > bookingAmount) {
    showToast('Please enter a valid advance amount (0 to total)', 'error');
    return;
  }

  try {
    const { error } = await supabase
      .from('bookings')
      .update({
        confirmed: true,
        booking_amount: bookingAmount,
        advance_amount: advanceAmount
      })
      .eq('id', queryId);
    if (error) throw error;
    showToast('Booking confirmed', 'success');
    loadQueries();
    loadBookings();
  } catch (err) {
    console.error(err);
    showToast('Failed to confirm booking', 'error');
  }
}

async function updateBookingAmount(bookingId) {
  const booking = await getBookingById(bookingId);
  if (!booking) return;

  const modal = document.createElement('div');
  modal.id = 'update-modal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>Update Booking Amount - ${booking.full_name}</h2>
        <button class="modal-close" onclick="closeModal('update-modal')">&times;</button>
      </div>
      <div class="modal-body">
        <form id="update-form">
          <div class="form-group">
            <label class="form-label" for="upd-total">Total Amount (₹)</label>
            <input id="upd-total" type="number" class="form-control" value="${booking.booking_amount||0}" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="upd-adv">Advance Amount (₹)</label>
            <input id="upd-adv" type="number" class="form-control" value="${booking.advance_amount||0}">
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn--outline" onclick="closeModal('update-modal')">Cancel</button>
            <button type="submit" class="btn btn--primary">Update</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.classList.remove('hidden');

  document.getElementById('update-form').addEventListener('submit', async e => {
    e.preventDefault();
    const total = parseFloat(document.getElementById('upd-total').value);
    const adv = parseFloat(document.getElementById('upd-adv').value)||0;
    if (total <= 0) return showToast('Enter valid total','error');
    if (adv > total) return showToast('Advance > total','error');
    const { error } = await supabase
      .from('bookings')
      .update({ booking_amount: total, advance_amount: adv })
      .eq('id', bookingId);
    if (error) return showToast('Update failed','error');
    showToast('Amount updated','success');
    closeModal('update-modal');
    loadBookings();
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

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.remove();
}

async function generateMenuLink() {
  if (!isAdminLoggedIn) return showToast('Login required','error');
  const foodCount = parseInt(document.getElementById('food-count').value);
  const bevCount = parseInt(document.getElementById('bev-count').value);
  if (foodCount<1||foodCount>15||bevCount<1||bevCount>10) {
    return showToast('Invalid counts','error');
  }
  const { data, error } = await supabase
    .from('menu_links')
    .insert([{ max_food_items: foodCount, max_bev_items: bevCount }])
    .select();
  if (error) return showToast('Generate failed','error');
  const url = `${window.location.origin}?menu=${data[0].id}`;
  document.querySelector('.generated-link').classList.remove('hidden');
  document.getElementById('generated-link-url').value = url;
  showToast('Menu link created','success');
  loadMenuLinks();
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(()=>showToast('Copied to clipboard','success'))
    .catch(()=>showToast('Copy failed','error'));
}

// ===== Event Listeners =====
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('admin-login-form')?.addEventListener('submit', handleAdminLogin);
  document.getElementById('admin-logout')?.addEventListener('click', handleAdminLogout);
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
      document.getElementById(tab).classList.add('active');
    });
  });
  
  document.getElementById('generate-menu-link')?.addEventListener('click', generateMenuLink);
  document.getElementById('copy-generated-link')?.addEventListener('click', () => {
    const linkInput = document.getElementById('generated-link-url');
    copyToClipboard(linkInput.value);
  });
});

// Expose functions globally
window.confirmBooking = confirmBooking;
window.updateBookingAmount = updateBookingAmount;
window.copyToClipboard = copyToClipboard;
window.closeModal = closeModal;
