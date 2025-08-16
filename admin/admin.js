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
  if (!container) return;
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

// Modified renderBookings to include menu link generator per booking
function renderBookings(bookings) {
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

  container.innerHTML = bookings.map(booking => `
    <div class="booking-card" data-booking-id="${booking.id}">
      <h4>${booking.full_name}</h4>
      <p>Event Date: ${booking.preferred_date}</p>
      <p>Guest Count: ${booking.guest_count}</p>

      <!-- Menu Link Generator Form for this booking -->
      <form class="menu-link-generator">
        <label>
          Food Items Limit:
          <input type="number" name="food-limit" min="1" max="74" required />
        </label>
        <label>
          Beverage Items Limit:
          <input type="number" name="beverage-limit" min="1" max="24" required />
        </label>
        <button type="submit">Generate Menu Link</button>
      </form>

      <div class="menu-link-result" id="menu-link-result-${booking.id}"></div>
    </div>
  `).join('');
}

// Add event listener for menu link generator form submissions (delegated)
document.getElementById('bookings-container').addEventListener('submit', async function(event) {
  if (!event.target.classList.contains('menu-link-generator')) return;

  event.preventDefault();

  const form = event.target;
  const bookingCard = form.closest('.booking-card');
  if (!bookingCard) return;

  const bookingId = bookingCard.dataset.bookingId;
  const foodLimit = parseInt(form['food-limit'].value, 10);
  const beverageLimit = parseInt(form['beverage-limit'].value, 10);

  const customerName = bookingCard.querySelector('h4')?.textContent || '';

  const eventDateText = bookingCard.querySelector('p')?.textContent || '';
  const eventDate = bookingCard.querySelector('p') ? bookingCard.querySelector('p').textContent.replace('Event Date: ', '') : '';

  try {
    const { data, error } = await supabase
      .from('menu_links')
      .insert([{
        customer_name: customerName,
        event_date: eventDate,
        food_limit: foodLimit,
        beverage_limit: beverageLimit,
        booking_id: bookingId
      }]);

    if (error) throw error;

    const linkId = data[0]?.link_id || 'N/A';
    const resultContainer = bookingCard.querySelector('.menu-link-result');
    const url = `${window.location.origin}/menu/${linkId}`;
    resultContainer.innerHTML = `<p>Menu Link Generated: <a href="${url}" target="_blank">${url}</a></p>`;
    showToast('Menu link generated successfully.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to generate menu link.', 'error');
  }
});

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
