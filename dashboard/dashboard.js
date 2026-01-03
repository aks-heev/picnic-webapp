// dashboard/dashboard.js
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== State =====
let isLoggedIn = false;
let allBookings = [];
let allQueries = [];
let charts = {};
let autoRefreshInterval = null;
let countdownInterval = null;
let countdown = 60;

// ===== Toast Helper =====
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast show ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => container.removeChild(toast), 300);
  }, 3000);
}

// ===== Loading =====
function showLoading() {
  document.getElementById('loading-overlay')?.classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loading-overlay')?.classList.add('hidden');
}

// ===== Auth =====
function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('dash-email')?.value;
  const password = document.getElementById('dash-password')?.value;

  // Same credentials as admin
  if (email === 'admin@picnic.com' && password === 'admin123') {
    isLoggedIn = true;
    document.getElementById('dashboard-login')?.classList.add('hidden');
    document.getElementById('dashboard-content')?.classList.remove('hidden');
    showToast('Login successful!', 'success');
    loadDashboard();
    startAutoRefresh();
  } else {
    showToast('Invalid credentials', 'error');
  }
}

function handleLogout() {
  isLoggedIn = false;
  stopAutoRefresh();
  document.getElementById('dashboard-login')?.classList.remove('hidden');
  document.getElementById('dashboard-content')?.classList.add('hidden');
  showToast('Logged out', 'success');
}

// ===== Date Filter =====
function getDateRange() {
  const preset = document.getElementById('filter-preset')?.value || 'month';
  const today = new Date();
  let fromDate = null;
  let toDate = new Date(today);
  toDate.setHours(23, 59, 59, 999);

  switch (preset) {
    case 'today':
      fromDate = new Date(today);
      fromDate.setHours(0, 0, 0, 0);
      break;
    case 'week':
      fromDate = new Date(today);
      fromDate.setDate(today.getDate() - today.getDay());
      fromDate.setHours(0, 0, 0, 0);
      break;
    case 'month':
      fromDate = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case 'quarter':
      const quarter = Math.floor(today.getMonth() / 3);
      fromDate = new Date(today.getFullYear(), quarter * 3, 1);
      break;
    case 'year':
      fromDate = new Date(today.getFullYear(), 0, 1);
      break;
    case 'custom':
      const fromInput = document.getElementById('filter-from')?.value;
      const toInput = document.getElementById('filter-to')?.value;
      if (fromInput) fromDate = new Date(fromInput);
      if (toInput) {
        toDate = new Date(toInput);
        toDate.setHours(23, 59, 59, 999);
      }
      break;
    case 'all':
    default:
      fromDate = null;
      toDate = null;
  }

  return { fromDate, toDate };
}

function toggleCustomDateRange() {
  const preset = document.getElementById('filter-preset')?.value;
  const customRange = document.getElementById('custom-date-range');
  if (customRange) {
    customRange.style.display = preset === 'custom' ? 'flex' : 'none';
  }
}

// ===== Data Loading =====
async function fetchAllData() {
  try {
    // Fetch all bookings
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false });

    if (bookingsError) throw bookingsError;
    allBookings = bookings || [];
    allQueries = allBookings.filter(b => !b.confirmed);

    return { bookings: allBookings, queries: allQueries };
  } catch (err) {
    console.error('Failed to fetch data:', err);
    showToast('Failed to load data', 'error');
    return { bookings: [], queries: [] };
  }
}

function filterBookingsByDate(bookings, fromDate, toDate) {
  if (!fromDate && !toDate) return bookings;
  
  return bookings.filter(b => {
    const bookingDate = new Date(b.preferred_date || b.created_at);
    if (fromDate && bookingDate < fromDate) return false;
    if (toDate && bookingDate > toDate) return false;
    return true;
  });
}

// ===== Stats Calculation =====
function calculateStats(bookings, queries) {
  const confirmedBookings = bookings.filter(b => b.confirmed);
  
  const totalBookings = confirmedBookings.length;
  const totalRevenue = confirmedBookings.reduce((sum, b) => sum + (b.booking_amount || 0), 0);
  const totalAdvance = confirmedBookings.reduce((sum, b) => sum + (b.advance_amount || 0), 0);
  const pendingBalance = totalRevenue - totalAdvance;
  const pendingQueries = queries.length;
  const avgBooking = totalBookings > 0 ? Math.round(totalRevenue / totalBookings) : 0;
  const totalGuests = confirmedBookings.reduce((sum, b) => sum + (b.guest_count || 0), 0);
  const avgGuests = totalBookings > 0 ? Math.round(totalGuests / totalBookings) : 0;

  return {
    totalBookings,
    totalRevenue,
    totalAdvance,
    pendingBalance,
    pendingQueries,
    avgBooking,
    totalGuests,
    avgGuests
  };
}

function updateStatsUI(stats) {
  document.getElementById('stat-total-bookings').textContent = stats.totalBookings;
  document.getElementById('stat-total-revenue').textContent = `₹${stats.totalRevenue.toLocaleString('en-IN')}`;
  document.getElementById('stat-advance').textContent = `₹${stats.totalAdvance.toLocaleString('en-IN')}`;
  document.getElementById('stat-pending').textContent = `₹${stats.pendingBalance.toLocaleString('en-IN')}`;
  document.getElementById('stat-queries').textContent = stats.pendingQueries;
  document.getElementById('stat-avg-booking').textContent = `₹${stats.avgBooking.toLocaleString('en-IN')}`;
  document.getElementById('stat-total-guests').textContent = stats.totalGuests;
  document.getElementById('stat-avg-guests').textContent = stats.avgGuests;
}

// ===== Charts =====
function getMonthlyData(bookings) {
  const monthlyBookings = {};
  const monthlyRevenue = {};
  
  const confirmedBookings = bookings.filter(b => b.confirmed);
  
  confirmedBookings.forEach(b => {
    const date = new Date(b.preferred_date || b.created_at);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    monthlyBookings[monthKey] = (monthlyBookings[monthKey] || 0) + 1;
    monthlyRevenue[monthKey] = (monthlyRevenue[monthKey] || 0) + (b.booking_amount || 0);
  });

  // Sort by month and get last 12 months
  const sortedMonths = Object.keys(monthlyBookings).sort().slice(-12);
  
  const labels = sortedMonths.map(m => {
    const [year, month] = m.split('-');
    return new Date(year, month - 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  });

  return {
    labels,
    bookingsData: sortedMonths.map(m => monthlyBookings[m] || 0),
    revenueData: sortedMonths.map(m => monthlyRevenue[m] || 0)
  };
}

function getLocationData(bookings) {
  const locationCounts = {};
  const confirmedBookings = bookings.filter(b => b.confirmed);
  
  confirmedBookings.forEach(b => {
    const location = b.location || 'Unknown';
    locationCounts[location] = (locationCounts[location] || 0) + 1;
  });

  return {
    labels: Object.keys(locationCounts),
    data: Object.values(locationCounts)
  };
}

function getOccasionData(bookings) {
  const occasionCounts = {};
  const confirmedBookings = bookings.filter(b => b.confirmed);
  
  confirmedBookings.forEach(b => {
    const occasion = b.occasion || 'Other';
    occasionCounts[occasion] = (occasionCounts[occasion] || 0) + 1;
  });

  return {
    labels: Object.keys(occasionCounts),
    data: Object.values(occasionCounts)
  };
}

function createCharts(bookings) {
  const monthlyData = getMonthlyData(bookings);
  const locationData = getLocationData(bookings);
  const occasionData = getOccasionData(bookings);

  const chartColors = {
    pink: '#ec4899',
    teal: '#14b8a6',
    purple: '#8b5cf6',
    orange: '#f97316',
    blue: '#3b82f6',
    green: '#22c55e',
    yellow: '#eab308',
    red: '#ef4444'
  };

  const pieColors = [
    chartColors.pink,
    chartColors.teal,
    chartColors.purple,
    chartColors.orange,
    chartColors.blue,
    chartColors.green,
    chartColors.yellow,
    chartColors.red
  ];

  // Destroy existing charts
  Object.values(charts).forEach(chart => chart?.destroy());

  // Bookings Chart
  const bookingsCtx = document.getElementById('bookings-chart')?.getContext('2d');
  if (bookingsCtx) {
    charts.bookings = new Chart(bookingsCtx, {
      type: 'bar',
      data: {
        labels: monthlyData.labels,
        datasets: [{
          label: 'Bookings',
          data: monthlyData.bookingsData,
          backgroundColor: chartColors.pink,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    });
  }

  // Revenue Chart
  const revenueCtx = document.getElementById('revenue-chart')?.getContext('2d');
  if (revenueCtx) {
    charts.revenue = new Chart(revenueCtx, {
      type: 'line',
      data: {
        labels: monthlyData.labels,
        datasets: [{
          label: 'Revenue (₹)',
          data: monthlyData.revenueData,
          borderColor: chartColors.teal,
          backgroundColor: 'rgba(20, 184, 166, 0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { 
            beginAtZero: true,
            ticks: {
              callback: (value) => '₹' + value.toLocaleString('en-IN')
            }
          }
        }
      }
    });
  }

  // Location Chart
  const locationCtx = document.getElementById('location-chart')?.getContext('2d');
  if (locationCtx) {
    charts.location = new Chart(locationCtx, {
      type: 'doughnut',
      data: {
        labels: locationData.labels,
        datasets: [{
          data: locationData.data,
          backgroundColor: pieColors
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' }
        }
      }
    });
  }

  // Occasion Chart
  const occasionCtx = document.getElementById('occasion-chart')?.getContext('2d');
  if (occasionCtx) {
    charts.occasion = new Chart(occasionCtx, {
      type: 'pie',
      data: {
        labels: occasionData.labels,
        datasets: [{
          data: occasionData.data,
          backgroundColor: pieColors
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' }
        }
      }
    });
  }
}

// ===== Lists =====
function renderUpcomingBookings(bookings) {
  const container = document.getElementById('upcoming-list');
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = bookings
    .filter(b => b.confirmed && new Date(b.preferred_date) >= today)
    .sort((a, b) => new Date(a.preferred_date) - new Date(b.preferred_date))
    .slice(0, 10);

  if (upcoming.length === 0) {
    container.innerHTML = '<div class="empty-state">No upcoming bookings</div>';
    return;
  }

  container.innerHTML = upcoming.map(b => {
    const date = new Date(b.preferred_date);
    const formattedDate = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    
    return `
      <div class="upcoming-item">
        <div class="upcoming-item-info">
          <h4>${b.full_name}</h4>
          <p>👥 ${b.guest_count} guests • 📍 ${b.location || 'N/A'}</p>
        </div>
        <div class="upcoming-item-date">
          <div class="date">${formattedDate}</div>
          <div class="time">${b.event_time || 'TBD'}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderRecentQueries(queries) {
  const container = document.getElementById('recent-queries');
  if (!container) return;

  const recent = queries
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10);

  if (recent.length === 0) {
    container.innerHTML = '<div class="empty-state">No pending queries</div>';
    return;
  }

  container.innerHTML = recent.map(q => {
    const date = new Date(q.created_at);
    const formattedDate = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    
    return `
      <div class="upcoming-item">
        <div class="upcoming-item-info">
          <h4>${q.full_name}</h4>
          <p>📅 ${q.preferred_date || 'Flexible'} • 👥 ${q.guest_count} guests</p>
        </div>
        <div class="upcoming-item-date">
          <div class="date">${formattedDate}</div>
          <div class="time">Query</div>
        </div>
      </div>
    `;
  }).join('');
}

// ===== Auto Refresh =====
function startAutoRefresh() {
  countdown = 60;
  updateCountdown();
  
  // Clear existing intervals
  stopAutoRefresh();
  
  // Countdown every second
  countdownInterval = setInterval(() => {
    countdown--;
    updateCountdown();
    
    if (countdown <= 0) {
      countdown = 60;
      loadDashboard(true); // silent refresh
    }
  }, 1000);
}

function stopAutoRefresh() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function updateCountdown() {
  const el = document.getElementById('countdown');
  if (el) el.textContent = countdown;
}

// ===== Main Load =====
async function loadDashboard(silent = false) {
  if (!silent) showLoading();
  
  try {
    await fetchAllData();
    
    const { fromDate, toDate } = getDateRange();
    const filteredBookings = filterBookingsByDate(allBookings, fromDate, toDate);
    const filteredQueries = filteredBookings.filter(b => !b.confirmed);
    const confirmedFiltered = filteredBookings.filter(b => b.confirmed);
    
    // Update stats
    const stats = calculateStats(filteredBookings, filteredQueries);
    updateStatsUI(stats);
    
    // Update charts (always use all data for trends)
    createCharts(allBookings);
    
    // Update lists
    renderUpcomingBookings(allBookings);
    renderRecentQueries(allQueries);
    
    // Update timestamp
    document.getElementById('last-updated').textContent = new Date().toLocaleString('en-IN');
    
    if (!silent) showToast('Dashboard updated!', 'success');
  } catch (err) {
    console.error('Dashboard load error:', err);
    showToast('Failed to load dashboard', 'error');
  } finally {
    hideLoading();
  }
}

// ===== Event Listeners =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('dashboard-login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('dashboard-logout')?.addEventListener('click', handleLogout);
  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    countdown = 60;
    loadDashboard();
  });
  document.getElementById('apply-filter')?.addEventListener('click', () => loadDashboard());
  document.getElementById('filter-preset')?.addEventListener('change', toggleCustomDateRange);
});
