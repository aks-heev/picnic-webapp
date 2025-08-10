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
        container.innerHTML = '<div class="empty-state"><h3>No queries yet</h3><p>New customer queries will appear here.</p></div>';
        return;
    }

    container.innerHTML = queries.map(query => `
        <div class="query-item leads-table" data-id="${query.id}">
            <div class="lead-item">
                <div class="lead-header">
                    <span class="lead-name">${query.full_name}</span>
                    <span class="lead-date">${new Date(query.created_at).toLocaleDateString()}</span>
                </div>
                <div class="lead-details">
                    <div class="lead-detail"><strong>Mobile:</strong> ${query.mobile_number}</div>
                    <div class="lead-detail"><strong>Email:</strong> ${query.email_address}</div>
                    <div class="lead-detail"><strong>Location:</strong> ${query.location}</div>
                    <div class="lead-detail"><strong>Guests:</strong> ${query.guest_count}</div>
                    <div class="lead-detail"><strong>Date:</strong> ${new Date(query.preferred_date).toLocaleDateString()}</div>
                    ${query.special_requirements ? `<div class="lead-detail"><strong>Requirements:</strong> ${query.special_requirements}</div>` : ''}
                </div>
                <div class="query-actions" style="margin-top: var(--space-16); display: flex; gap: var(--space-12); align-items: center;">
                    <div class="advance-input-group" style="display: flex; flex-direction: column; gap: var(--space-4);">
                        <label for="advance-${query.id}" style="font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);">Advance Amount:</label>
                        <input type="number" id="advance-${query.id}" placeholder="Enter amount" min="0" step="0.01" class="form-control" style="width: 150px;">
                    </div>
                    <button class="confirm-booking-btn btn btn--primary" data-id="${query.id}">
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
        container.innerHTML = '<div class="empty-state"><h3>No confirmed bookings yet</h3><p>Confirmed bookings will appear here.</p></div>';
        return;
    }

    container.innerHTML = bookings.map(booking => `
        <div class="booking-item leads-table" data-id="${booking.id}">
            <div class="lead-item">
                <div class="lead-header">
                    <span class="lead-name">${booking.full_name}</span>
                    <span class="lead-date">${new Date(booking.created_at).toLocaleDateString()}</span>
                    <span class="advance-badge" style="background: var(--color-success); color: white; padding: var(--space-4) var(--space-8); border-radius: var(--radius-base); font-size: var(--font-size-sm);">₹${booking.advance_amount || 0} paid</span>
                </div>
                <div class="lead-details">
                    <div class="lead-detail"><strong>Mobile:</strong> ${booking.mobile_number}</div>
                    <div class="lead-detail"><strong>Email:</strong> ${booking.email_address}</div>
                    <div class="lead-detail"><strong>Location:</strong> ${booking.location}</div>
                    <div class="lead-detail"><strong>Guests:</strong> ${booking.guest_count}</div>
                    <div class="lead-detail"><strong>Date:</strong> ${new Date(booking.preferred_date).toLocaleDateString()}</div>
                    ${booking.special_requirements ? `<div class="lead-detail"><strong>Requirements:</strong> ${booking.special_requirements}</div>` : ''}
                </div>

                ${booking.orders.length > 0 ? `
                    <div style="margin-top: var(--space-16);">
                        <h5 style="color: var(--color-primary);">Previous Orders:</h5>
                        <ul style="margin: var(--space-8) 0; padding-left: var(--space-20);">
                            ${booking.orders.map(o =>
                                `<li style="margin-bottom: var(--space-4);">Order #${o.id} — ${o.selected_items.map(i => i.name + '×' + i.quantity).join(', ')}</li>`
                            ).join('')}
                        </ul>
                    </div>
                ` : ''}

                <div class="menu-generator" style="margin-top: var(--space-20);">
                    <div class="menu-controls">
                        <div class="control-group">
                            <label for="food-count-${booking.id}">Food Items:</label>
                            <input type="number" id="food-count-${booking.id}" value="3" min="1" max="15" class="form-control" style="width: 80px;">
                        </div>
                        <div class="control-group">
                            <label for="bev-count-${booking.id}">Beverages:</label>
                            <input type="number" id="bev-count-${booking.id}" value="2" min="1" max="10" class="form-control" style="width: 80px;">
                        </div>
                        <button class="generate-menu-btn btn btn--primary" data-booking-id="${booking.id}">
                            Generate Menu Link
                        </button>
                    </div>
                    <div class="generated-menu-link" id="generated-link-${booking.id}" style="display: none; margin-top: var(--space-12);">
                        <label>Generated Link:</label>
                        <div class="link-display">
                            <input type="text" id="menu-url-${booking.id}" readonly class="form-control">
                            <button class="copy-menu-btn btn btn--outline" data-booking-id="${booking.id}">Copy</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function renderMenuLinks(links) {
    const container = document.getElementById('menu-links-list');
    if (!links || links.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No menu links yet</h3><p>Generated menu links will appear here.</p></div>';
        return;
    }

    container.innerHTML = links.map(link => `
        <div class="menu-link-item">
            <div class="menu-link-info">
                <div class="menu-link-id">Menu Link #${link.id}</div>
                <div class="menu-link-details">
                    Food Items: ${link.max_food_items} | Beverages: ${link.max_bev_items} | 
                    Created: ${new Date(link.created_at).toLocaleDateString()}
                </div>
            </div>
            <div class="menu-link-actions">
                <button class="btn btn--sm btn--outline" onclick="copyMenuLink('${link.id}')">Copy Link</button>
            </div>
        </div>
    `).join('');
}

// ===== Utility Functions =====
function copyMenuLink(linkId) {
    const url = `${window.location.origin}?menu=${linkId}`;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Menu link copied to clipboard', 'success');
    }).catch(() => {
        showToast('Failed to copy link', 'error');
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        content.hidden = true;
    });

    document.querySelectorAll('.tab-btn').forEach(button => {
        button.classList.remove('active');
        button.setAttribute('aria-selected', 'false');
    });

    const targetContent = document.getElementById(`${tabName}-tab`);
    if (targetContent) {
        targetContent.classList.add('active');
        targetContent.hidden = false;
    }

    const targetButton = document.querySelector(`[data-tab="${tabName}"]`);
    if (targetButton) {
        targetButton.classList.add('active');
        targetButton.setAttribute('aria-selected', 'true');
    }

    if (tabName === 'queries') {
        loadQueries();
    } else if (tabName === 'bookings') {
        loadBookings();
    } else if (tabName === 'menu-link') {
        loadMenuLinks();
    }
}

// ===== Event Listeners =====
window.addEventListener('DOMContentLoaded', () => {
    // Login form
    const adminLoginForm = document.getElementById('admin-login-form');
    if (adminLoginForm) adminLoginForm.addEventListener('submit', handleAdminLogin);

    // Logout button
    const adminLogoutBtn = document.getElementById('admin-logout');
    if (adminLogoutBtn) adminLogoutBtn.addEventListener('click', handleAdminLogout);

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    // Menu link generation
    const generateMenuLinkBtn = document.getElementById('generate-menu-link');
    if (generateMenuLinkBtn) {
        generateMenuLinkBtn.addEventListener('click', () => {
            const foodCount = parseInt(document.getElementById('food-count').value, 10);
            const bevCount = parseInt(document.getElementById('bev-count').value, 10);
            generateMenuLink(foodCount, bevCount);
        });
    }

    // Copy link
    const copyLinkBtn = document.getElementById('copy-link');
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
            const linkInput = document.getElementById('generated-link-url');
            if (linkInput) {
                navigator.clipboard.writeText(linkInput.value).then(() => {
                    showToast('Link copied to clipboard', 'success');
                }).catch(() => {
                    showToast('Failed to copy link', 'error');
                });
            }
        });
    }

    // Event delegation for dynamic elements
    document.addEventListener('click', (event) => {
        // Confirm booking
        if (event.target.classList.contains('confirm-booking-btn')) {
            const queryId = event.target.getAttribute('data-id');
            confirmBooking(queryId);
        }

        // Generate menu link for booking
        if (event.target.classList.contains('generate-menu-btn')) {
            const bookingId = event.target.getAttribute('data-booking-id');
            const foodCountInput = document.getElementById(`food-count-${bookingId}`);
            const bevCountInput = document.getElementById(`bev-count-${bookingId}`);
            
            const foodCount = parseInt(foodCountInput.value, 10);
            const bevCount = parseInt(bevCountInput.value, 10);
            
            generateBookingMenuLink(bookingId, foodCount, bevCount);
        }

        // Copy booking menu link
        if (event.target.classList.contains('copy-menu-btn')) {
            const bookingId = event.target.getAttribute('data-booking-id');
            copyBookingMenuLink(bookingId);
        }
    });
});

// Generate menu link for specific booking
async function generateBookingMenuLink(bookingId, foodCount, bevCount) {
    if (foodCount < 1 || foodCount > 15 || bevCount < 1 || bevCount > 10) {
        showToast('Food items must be 1-15, beverages 1-10', 'error');
        return;
    }

    try {
        const menuLink = {
            max_food_items: foodCount,
            max_bev_items: bevCount,
            created_at: new Date().toISOString(),
        };

        const { data, error } = await supabase.from('menu_links').insert([menuLink]).select();
        if (error) throw error;

        const generatedLinkDiv = document.getElementById(`generated-link-${bookingId}`);
        const linkInput = document.getElementById(`menu-url-${bookingId}`);

        if (generatedLinkDiv && linkInput) {
            const fullUrl = `${window.location.origin}?menu=${data[0].id}&booking=${bookingId}`;
            linkInput.value = fullUrl;
            generatedLinkDiv.style.display = 'block';
        }

        showToast('Menu link generated for booking!', 'success');
        loadMenuLinks();

    } catch (error) {
        console.error(error);
        showToast('Failed to generate menu link', 'error');
    }
}

// Copy booking menu link
function copyBookingMenuLink(bookingId) {
    const linkInput = document.getElementById(`menu-url-${bookingId}`);
    if (linkInput && linkInput.value) {
        navigator.clipboard.writeText(linkInput.value).then(() => {
            showToast('Menu link copied to clipboard', 'success');
        }).catch(() => {
            showToast('Failed to copy link', 'error');
        });
    }
}

// Make copyMenuLink globally available for inline onclick
window.copyMenuLink = copyMenuLink;
