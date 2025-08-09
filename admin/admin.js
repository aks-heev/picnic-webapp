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
  const advanceInput = document.getElementById(`advance-${queryId}`);
  const advanceAmount = parseFloat(advanceInput.value) || 0;

  if (advanceAmount <= 0) {
    showToast('Please enter a valid advance amount', 'error');
    return;
  }

  try {
    const { error } = await supabase
      .from('bookings')
      .update({ confirmed: true, advance_amount: advanceAmount })
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
    container.innerHTML = '<div class="empty-state"><h3>No queries yet</h3></div>';
    return;
  }
  container.innerHTML = queries
    .map(q => `
      <div class="query-item" data-id="${q.id}">
        <div><strong>${q.full_name}</strong> (${q.mobile_number})</div>
        <div>Date: ${new Date(q.preferred_date).toLocaleDateString()}</div>
        <input type="number" id="advance-${q.id}" placeholder="Advance Amount" />
        <button onclick="confirmBooking('${q.id}')">Confirm</button>
      </div>
    `)
    .join('');
}

function renderBookings(bookings) {
  const container = document.getElementById('bookings-container');
  if (!bookings || bookings.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No confirmed bookings</h3></div>';
    return;
  }
  container.innerHTML = bookings
    .map(b => `
      <div class="booking-item" data-id="${b.id}">
        <div><strong>${b.full_name}</strong> - ₹${b.advance_amount}</div>
        <div>${new Date(b.preferred_date).toLocaleDateString()}</div>
        <ul>${b.orders.map(o => `<li>${o.selected_items.map(i => `${i.name}×${i.quantity}`).join(', ')}</li>`).join('')}</ul>
      </div>
    `)
    .join('');
}

function renderMenuLinks(links) {
  const container = document.getElementById('menu-links-list');
  if (!links || links.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No menu links yet</h3></div>';
    return;
  }
  container.innerHTML = links
    .map(l => `
      <div>
        Link #${l.id} — Food: ${l.max_food_items}, Bev: ${l.max_bev_items}
        <button onclick="navigator.clipboard.writeText('${window.location.origin}?menu=${l.id}')">Copy</button>
      </div>
    `)
    .join('');
}

// ===== Event Listeners =====
document.getElementById('admin-login-form')?.addEventListener('submit', handleAdminLogin);
document.getElementById('admin-logout')?.addEventListener('click', handleAdminLogout);
document.getElementById('generate-menu-link')?.addEventListener('click', () => {
  const foodCount = parseInt(document.getElementById('food-count').value, 10);
  const bevCount = parseInt(document.getElementById('bev-count').value, 10);
  generateMenuLink(foodCount, bevCount);
});

// Make certain functions global for inline onclick
window.confirmBooking = confirmBooking;

// ===== Tab Switching =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.add('hidden');
      content.classList.remove('active');
    });

    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');

    const targetId = btn.getAttribute('data-tab');
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      targetEl.classList.remove('hidden');
      targetEl.classList.add('active');
    }
  });
});
