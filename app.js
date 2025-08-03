// Application Data
const appData = {
    company: {
        name: "The Picnic Story",
        tagline: "Creating Unforgettable Boho Picnic Experiences",
        description: "We specialize in curating luxurious boho-style picnic setups for intimate gatherings, romantic dates, celebrations, and corporate events."
    },
    locations: ["Jaipur", "Gurgaon", "Other Location"],
    sampleMenuItems: {
        food: [
            {id: 1, name: "Artisan Cheese & Charcuterie Board", description: "Selection of premium cheeses, cured meats, nuts, and preserves"},
            {id: 2, name: "Mediterranean Hummus Platter", description: "House-made hummus with fresh vegetables, olives, and pita bread"},
            {id: 3, name: "Gourmet Sandwich Selection", description: "Assorted artisan sandwiches with premium fillings"},
            {id: 4, name: "Fresh Fruit & Berry Bowl", description: "Seasonal fresh fruits and berries beautifully arranged"},
            {id: 5, name: "Quinoa Power Salad", description: "Nutritious quinoa salad with roasted vegetables and herbs"},
            {id: 6, name: "Chocolate Strawberry Tart", description: "Decadent chocolate tart topped with fresh strawberries"},
            {id: 7, name: "Macarons & Petit Fours", description: "French macarons and elegant petit fours"},
            {id: 8, name: "Artisan Flatbread Pizza", description: "Wood-fired flatbread with gourmet toppings"},
            {id: 9, name: "Stuffed Dates & Nuts", description: "Medjool dates stuffed with almonds and cream cheese"},
            {id: 10, name: "Seasonal Soup Thermos", description: "Warm seasonal soup served in elegant thermos"}
        ],
        beverages: [
            {id: 1, name: "Sparkling Elderflower Lemonade", description: "Refreshing elderflower lemonade with sparkling water"},
            {id: 2, name: "Iced Hibiscus Tea", description: "Floral hibiscus tea served over ice with mint"},
            {id: 3, name: "Fresh Orange Juice", description: "Freshly squeezed orange juice"},
            {id: 4, name: "Artisan Coffee", description: "Premium coffee blend served hot or iced"},
            {id: 5, name: "Herbal Tea Selection", description: "Variety of premium herbal teas"},
            {id: 6, name: "Cucumber Mint Agua Fresca", description: "Refreshing cucumber and mint infused water"},
            {id: 7, name: "Pomegranate Sparkler", description: "Pomegranate juice with sparkling water and lime"},
            {id: 8, name: "Chai Latte", description: "Spiced chai latte with steamed milk"}
        ]
    },
    testimonials: [
        {name: "Priya Sharma", text: "The Picnic Story made our anniversary absolutely magical! The boho setup was stunning and the food was incredible.", rating: 5},
        {name: "Arjun Patel", text: "Perfect for our corporate team outing. Professional service and beautiful presentation. Highly recommend!", rating: 5},
        {name: "Meera Singh", text: "They transformed our garden party into a dreamy boho paradise. Every detail was perfect!", rating: 5}
    ]
};

// Application State
let appState = {
    currentPage: 'home',
    isAdminLoggedIn: false,
    currentBooking: null,
    currentMenuLink: null,
    leads: [],
    menuLinks: [],
    menuSelections: []
};

// DOM Elements
const elements = {
    pages: document.querySelectorAll('.page'),
    navLinks: document.querySelectorAll('.nav-link'),
    bookPicnicBtn: document.getElementById('book-picnic-btn'),
    bookingModal: document.getElementById('booking-modal'),
    closeBookingModal: document.getElementById('close-booking-modal'),
    cancelBooking: document.getElementById('cancel-booking'),
    bookingForm: document.getElementById('booking-form'),
    adminLoginForm: document.getElementById('admin-login-form'),
    adminLogin: document.getElementById('admin-login'),
    adminDashboard: document.getElementById('admin-dashboard'),
    adminLogout: document.getElementById('admin-logout'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    generateMenuLinkBtn: document.getElementById('generate-menu-link'),
    copyLinkBtn: document.getElementById('copy-link'),
    menuSelectionForm: document.getElementById('menu-selection-form'),
    successNotification: document.getElementById('success-notification'),
    errorNotification: document.getElementById('error-notification')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    loadTestimonials();
    setMinDate();
    loadSampleMenuPreview();
});

function initializeApp() {
    // Load saved data from sessionStorage
    const savedState = sessionStorage.getItem('picnicAppState');
    if (savedState) {
        const parsed = JSON.parse(savedState);
        appState.leads = parsed.leads || [];
        appState.menuLinks = parsed.menuLinks || [];
        appState.menuSelections = parsed.menuSelections || [];
    }
    
    // Check for menu link in URL
    const urlParams = new URLSearchParams(window.location.search);
    const menuId = urlParams.get('menu');
    if (menuId) {
        const menuLink = appState.menuLinks.find(link => link.id === menuId);
        if (menuLink) {
            appState.currentMenuLink = menuLink;
            navigateToPage('menu-selection');
            loadMenuSelection(menuLink);
        }
    }
    
    navigateToPage('home');
}

function setupEventListeners() {
    // Navigation
    elements.navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const route = link.dataset.route;
            if (route === 'admin' && !appState.isAdminLoggedIn) {
                navigateToPage('admin');
            } else {
                navigateToPage(route);
            }
        });
    });

    // Booking Modal
    elements.bookPicnicBtn?.addEventListener('click', openBookingModal);
    elements.closeBookingModal?.addEventListener('click', closeBookingModal);
    elements.cancelBooking?.addEventListener('click', closeBookingModal);
    elements.bookingModal?.addEventListener('click', (e) => {
        if (e.target === elements.bookingModal) closeBookingModal();
    });

    // Forms
    elements.bookingForm?.addEventListener('submit', handleBookingSubmit);
    elements.adminLoginForm?.addEventListener('submit', handleAdminLogin);
    elements.menuSelectionForm?.addEventListener('submit', handleMenuSelectionSubmit);

    // Admin Dashboard
    elements.adminLogout?.addEventListener('click', handleAdminLogout);
    elements.generateMenuLinkBtn?.addEventListener('click', generateMenuLink);
    elements.copyLinkBtn?.addEventListener('click', copyGeneratedLink);

    // Tab Navigation
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });
}

// Navigation Functions
function navigateToPage(page) {
    // Hide all pages
    elements.pages.forEach(p => p.classList.remove('active'));
    
    // Show target page
    const targetPage = document.getElementById(`${page}-page`);
    if (targetPage) {
        targetPage.classList.add('active');
        appState.currentPage = page;
    }
    
    // Update navigation
    elements.navLinks.forEach(link => {
        link.classList.toggle('active', link.dataset.route === page);
    });
    
    // Load page-specific content
    switch(page) {
        case 'admin':
            if (appState.isAdminLoggedIn) {
                showAdminDashboard();
            } else {
                showAdminLogin();
            }
            break;
        case 'menu-selection':
            // Will be loaded by loadMenuSelection
            break;
    }
}

// Booking Modal Functions
function openBookingModal() {
    elements.bookingModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeBookingModal() {
    elements.bookingModal.classList.add('hidden');
    document.body.style.overflow = '';
    elements.bookingForm.reset();
    hideError('booking-error');
}

// Form Handling
function handleBookingSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData(elements.bookingForm);
    const booking = {
        id: generateId(),
        fullName: document.getElementById('full-name').value,
        mobileNumber: document.getElementById('mobile-number').value,
        emailAddress: document.getElementById('email-address').value,
        location: document.getElementById('location').value,
        guestCount: parseInt(document.getElementById('guest-count').value),
        preferredDate: document.getElementById('preferred-date').value,
        specialRequirements: document.getElementById('special-requirements').value,
        submittedAt: new Date().toISOString()
    };
    
    // Validate form
    if (!validateBookingForm(booking)) {
        return;
    }
    
    // Save booking
    appState.leads.push(booking);
    appState.currentBooking = booking;
    saveAppState();
    
    // Close modal and navigate
    closeBookingModal();
    showNotification('Booking submitted successfully! Redirecting to menu preview...', 'success');
    
    setTimeout(() => {
        navigateToPage('menu-preview');
    }, 2000);
}

function validateBookingForm(booking) {
    let isValid = true;
    
    // Mobile number validation
    const mobileRegex = /^[0-9]{10}$/;
    if (!mobileRegex.test(booking.mobileNumber)) {
        showError('booking-error', 'Please enter a valid 10-digit mobile number');
        isValid = false;
    }
    
    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(booking.emailAddress)) {
        showError('booking-error', 'Please enter a valid email address');
        isValid = false;
    }
    
    // Date validation
    const selectedDate = new Date(booking.preferredDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (selectedDate < today) {
        showError('booking-error', 'Please select a future date');
        isValid = false;
    }
    
    // Guest count validation
    if (booking.guestCount < 2) {
        showError('booking-error', 'Minimum 2 guests required');
        isValid = false;
    }
    
    if (isValid) {
        hideError('booking-error');
    }
    
    return isValid;
}

// Admin Functions
function handleAdminLogin(e) {
    e.preventDefault();
    
    const password = document.getElementById('admin-password').value;
    if (password === 'admin123') {
        appState.isAdminLoggedIn = true;
        showAdminDashboard();
        showNotification('Admin login successful', 'success');
    } else {
        showError('login-error', 'Invalid password');
    }
}

function handleAdminLogout() {
    appState.isAdminLoggedIn = false;
    showAdminLogin();
    showNotification('Logged out successfully', 'success');
}

function showAdminLogin() {
    document.getElementById('admin-login').classList.remove('hidden');
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('admin-password').value = '';
    hideError('login-error');
}

function showAdminDashboard() {
    document.getElementById('admin-login').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    loadLeads();
    loadMenuLinks();
    switchTab('leads');
}

function switchTab(tabName) {
    // Update tab buttons
    elements.tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    // Show/hide tab content
    elements.tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-tab`);
    });
}

function loadLeads() {
    const container = document.getElementById('leads-container');
    
    if (appState.leads.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No leads yet</h3><p>Customer bookings will appear here</p></div>';
        return;
    }
    
    const leadsHtml = appState.leads.map(lead => `
        <div class="leads-table">
            <div class="lead-item">
                <div class="lead-header">
                    <span class="lead-name">${lead.fullName}</span>
                    <span class="lead-date">${formatDate(lead.submittedAt)}</span>
                </div>
                <div class="lead-details">
                    <div class="lead-detail">
                        <strong>Mobile:</strong>
                        <span>${lead.mobileNumber}</span>
                    </div>
                    <div class="lead-detail">
                        <strong>Email:</strong>
                        <span>${lead.emailAddress}</span>
                    </div>
                    <div class="lead-detail">
                        <strong>Location:</strong>
                        <span>${lead.location}</span>
                    </div>
                    <div class="lead-detail">
                        <strong>Guests:</strong>
                        <span>${lead.guestCount}</span>
                    </div>
                    <div class="lead-detail">
                        <strong>Date:</strong>
                        <span>${formatDate(lead.preferredDate)}</span>
                    </div>
                    ${lead.specialRequirements ? `
                    <div class="lead-detail" style="grid-column: 1 / -1;">
                        <strong>Special Requirements:</strong>
                        <span>${lead.specialRequirements}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `).join('');
    
    container.innerHTML = leadsHtml;
}

function generateMenuLink() {
    const foodCount = parseInt(document.getElementById('food-count').value);
    const beverageCount = parseInt(document.getElementById('beverage-count').value);
    
    const menuLink = {
        id: generateId(),
        foodCount,
        beverageCount,
        createdAt: new Date().toISOString(),
        status: 'Active'
    };
    
    appState.menuLinks.push(menuLink);
    saveAppState();
    
    // Show generated link
    const linkUrl = `${window.location.origin}${window.location.pathname}?menu=${menuLink.id}`;
    document.getElementById('generated-link').value = linkUrl;
    document.getElementById('generated-link-container').classList.remove('hidden');
    
    loadMenuLinks();
    showNotification('Menu link generated successfully!', 'success');
}

function copyGeneratedLink() {
    const linkInput = document.getElementById('generated-link');
    linkInput.select();
    linkInput.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(linkInput.value);
    showNotification('Link copied to clipboard!', 'success');
}

function loadMenuLinks() {
    const container = document.getElementById('menu-links-container');
    
    if (appState.menuLinks.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No menu links generated</h3><p>Generated menu links will appear here</p></div>';
        return;
    }
    
    const linksHtml = appState.menuLinks.map(link => `
        <div class="menu-links-list">
            <div class="menu-link-item">
                <div class="menu-link-info">
                    <div class="menu-link-id">Menu Link: ${link.id}</div>
                    <div class="menu-link-details">
                        ${link.foodCount} food items, ${link.beverageCount} beverages | 
                        Created: ${formatDate(link.createdAt)} | 
                        Status: ${link.status}
                    </div>
                </div>
                <div class="menu-link-actions">
                    <button class="btn btn--sm btn--secondary" onclick="copyMenuLink('${link.id}')">Copy Link</button>
                    <button class="btn btn--sm btn--outline" onclick="viewMenuLink('${link.id}')">View</button>
                </div>
            </div>
        </div>
    `).join('');
    
    container.innerHTML = linksHtml;
}

function copyMenuLink(linkId) {
    const linkUrl = `${window.location.origin}${window.location.pathname}?menu=${linkId}`;
    navigator.clipboard.writeText(linkUrl);
    showNotification('Menu link copied to clipboard!', 'success');
}

function viewMenuLink(linkId) {
    const menuLink = appState.menuLinks.find(link => link.id === linkId);
    if (menuLink) {
        appState.currentMenuLink = menuLink;
        navigateToPage('menu-selection');
        loadMenuSelection(menuLink);
    }
}

// Menu Selection Functions
function loadMenuSelection(menuLink) {
    const foodItems = appData.sampleMenuItems.food.slice(0, menuLink.foodCount);
    const beverageItems = appData.sampleMenuItems.beverages.slice(0, menuLink.beverageCount);
    
    loadSelectionItems('selection-food-items', foodItems, 'food');
    loadSelectionItems('selection-beverage-items', beverageItems, 'beverage');
}

function loadSelectionItems(containerId, items, type) {
    const container = document.getElementById(containerId);
    
    const itemsHtml = items.map(item => `
        <div class="selection-item">
            <div class="selection-item-info">
                <h4>${item.name}</h4>
                <p>${item.description}</p>
            </div>
            <div class="quantity-selector">
                <button type="button" class="quantity-btn" onclick="changeQuantity('${type}-${item.id}', -1)">-</button>
                <input type="number" class="quantity-input" id="${type}-${item.id}" value="0" min="0" max="10" readonly>
                <button type="button" class="quantity-btn" onclick="changeQuantity('${type}-${item.id}', 1)">+</button>
            </div>
        </div>
    `).join('');
    
    container.innerHTML = itemsHtml;
}

function changeQuantity(itemId, change) {
    const input = document.getElementById(itemId);
    const currentValue = parseInt(input.value);
    const newValue = Math.max(0, Math.min(10, currentValue + change));
    input.value = newValue;
}

function handleMenuSelectionSubmit(e) {
    e.preventDefault();
    
    const selection = {
        id: generateId(),
        menuLinkId: appState.currentMenuLink.id,
        items: [],
        submittedAt: new Date().toISOString()
    };
    
    // Collect food selections
    const foodItems = appData.sampleMenuItems.food.slice(0, appState.currentMenuLink.foodCount);
    foodItems.forEach(item => {
        const quantity = parseInt(document.getElementById(`food-${item.id}`).value);
        if (quantity > 0) {
            selection.items.push({
                ...item,
                type: 'food',
                quantity
            });
        }
    });
    
    // Collect beverage selections
    const beverageItems = appData.sampleMenuItems.beverages.slice(0, appState.currentMenuLink.beverageCount);
    beverageItems.forEach(item => {
        const quantity = parseInt(document.getElementById(`beverage-${item.id}`).value);
        if (quantity > 0) {
            selection.items.push({
                ...item,
                type: 'beverage',
                quantity
            });
        }
    });
    
    // Validate selection
    if (selection.items.length === 0) {
        showError('menu-selection-error', 'Please select at least one item');
        return;
    }
    
    // Save selection
    appState.menuSelections.push(selection);
    appState.currentMenuSelection = selection;
    saveAppState();
    
    // Navigate to confirmation
    navigateToPage('confirmation');
    loadConfirmation();
}

// Confirmation Functions
function loadConfirmation() {
    const confirmationNumber = generateConfirmationNumber();
    document.getElementById('confirmation-number').textContent = confirmationNumber;
    
    // Load customer info (from current booking or create demo data)
    const customerInfo = appState.currentBooking || {
        fullName: 'Demo Customer',
        mobileNumber: '9876543210',
        emailAddress: 'demo@example.com',
        location: 'Jaipur',
        guestCount: 4,
        preferredDate: new Date().toISOString().split('T')[0]
    };
    
    document.getElementById('customer-info').innerHTML = `
        <div class="info-grid">
            <div class="info-item">
                <span class="info-label">Name</span>
                <span class="info-value">${customerInfo.fullName}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Mobile</span>
                <span class="info-value">${customerInfo.mobileNumber}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Email</span>
                <span class="info-value">${customerInfo.emailAddress}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Location</span>
                <span class="info-value">${customerInfo.location}</span>
            </div>
        </div>
    `;
    
    document.getElementById('event-info').innerHTML = `
        <div class="info-grid">
            <div class="info-item">
                <span class="info-label">Date</span>
                <span class="info-value">${formatDate(customerInfo.preferredDate)}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Guests</span>
                <span class="info-value">${customerInfo.guestCount}</span>
            </div>
        </div>
    `;
    
    // Load selected menu items
    if (appState.currentMenuSelection) {
        const selectedItemsHtml = appState.currentMenuSelection.items.map(item => `
            <div class="selected-item">
                <span class="selected-item-name">${item.name}</span>
                <span class="selected-item-quantity">Qty: ${item.quantity}</span>
            </div>
        `).join('');
        
        document.getElementById('selected-menu-items').innerHTML = `
            <div class="selected-items">${selectedItemsHtml}</div>
        `;
    }
}

// Utility Functions
function loadTestimonials() {
    const container = document.getElementById('testimonials-container');
    
    const testimonialsHtml = appData.testimonials.map(testimonial => `
        <div class="testimonial-card">
            <p class="testimonial-text">"${testimonial.text}"</p>
            <div class="testimonial-footer">
                <span class="testimonial-author">${testimonial.name}</span>
                <span class="testimonial-rating">${'★'.repeat(testimonial.rating)}</span>
            </div>
        </div>
    `).join('');
    
    container.innerHTML = testimonialsHtml;
}

function loadSampleMenuPreview() {
    // Load sample food items
    const foodContainer = document.getElementById('preview-food-items');
    const sampleFood = appData.sampleMenuItems.food.slice(0, 4);
    
    const foodHtml = sampleFood.map(item => `
        <div class="menu-item">
            <h4>${item.name}</h4>
            <p>${item.description}</p>
        </div>
    `).join('');
    
    foodContainer.innerHTML = foodHtml;
    
    // Load sample beverage items
    const beverageContainer = document.getElementById('preview-beverage-items');
    const sampleBeverages = appData.sampleMenuItems.beverages.slice(0, 3);
    
    const beverageHtml = sampleBeverages.map(item => `
        <div class="menu-item">
            <h4>${item.name}</h4>
            <p>${item.description}</p>
        </div>
    `).join('');
    
    beverageContainer.innerHTML = beverageHtml;
}

function setMinDate() {
    const dateInput = document.getElementById('preferred-date');
    if (dateInput) {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateInput.min = tomorrow.toISOString().split('T')[0];
    }
}

function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateConfirmationNumber() {
    return 'PCS' + Date.now().toString().slice(-6);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function saveAppState() {
    const stateToSave = {
        leads: appState.leads,
        menuLinks: appState.menuLinks,
        menuSelections: appState.menuSelections
    };
    sessionStorage.setItem('picnicAppState', JSON.stringify(stateToSave));
}

function showNotification(message, type = 'success') {
    const notification = document.getElementById(`${type}-notification`);
    const messageElement = document.getElementById(`${type}-message`);
    
    messageElement.textContent = message;
    notification.classList.remove('hidden');
    
    setTimeout(() => {
        notification.classList.add('hidden');
    }, 3000);
}

function showError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.remove('hidden');
    }
}

function hideError(elementId) {
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        errorElement.classList.add('hidden');
    }
}

// Global functions for onclick handlers
window.navigateToPage = navigateToPage;
window.changeQuantity = changeQuantity;
window.copyMenuLink = copyMenuLink;
window.viewMenuLink = viewMenuLink;