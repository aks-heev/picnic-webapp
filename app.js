// Application Data with Updated Indian Menu
const appData = {
    company: {
        name: "The Picnic Story",
        tagline: "Creating Unforgettable Boho Picnic Experiences",
        description: "We specialize in curating luxurious boho-style picnic setups for intimate gatherings, romantic dates, celebrations, and corporate events in Jaipur and Gurgaon."
    },
    locations: ["Jaipur", "Gurgaon", "Other Location"],
    menuItems: {
        food: [
            {id: 1, name: "Plain Omelette", description: "Classic fluffy omelette prepared with fresh eggs"},
            {id: 2, name: "Cheese Burst Omelette", description: "Omelette loaded with melted cheese"},
            {id: 3, name: "Chicken Omelette", description: "Protein-rich omelette with tender chicken pieces"},
            {id: 4, name: "Bread Omelette", description: "Omelette served with toasted bread"},
            {id: 5, name: "Egg Bhurji with Toast", description: "Spiced scrambled eggs served with crispy toast"},
            {id: 6, name: "Aloo Paratha", description: "Traditional stuffed flatbread with spiced potatoes"},
            {id: 7, name: "Aloo Pyaz Paratha", description: "Paratha stuffed with potatoes and onions"},
            {id: 8, name: "Gobi Paratha", description: "Cauliflower stuffed paratha with herbs"},
            {id: 9, name: "Paneer Paratha", description: "Cottage cheese stuffed paratha"},
            {id: 10, name: "Egg Paratha", description: "Paratha layered with beaten eggs"},
            {id: 11, name: "Chicken Paratha", description: "Paratha stuffed with spiced chicken"},
            {id: 12, name: "Garden Fresh Sandwich", description: "Fresh vegetables in multigrain bread"},
            {id: 13, name: "Cheese Corn Sandwich", description: "Grilled sandwich with cheese and sweet corn"},
            {id: 14, name: "Paneer Tikka Sandwich", description: "Sandwich with marinated paneer tikka"},
            {id: 15, name: "Chicken Tikka Sandwich", description: "Grilled chicken tikka sandwich"},
            {id: 16, name: "Plain Maggi", description: "Classic instant noodles"},
            {id: 17, name: "Veg Maggi", description: "Maggi with mixed vegetables"},
            {id: 18, name: "Egg & Cheese Maggi", description: "Maggi topped with egg and cheese"},
            {id: 19, name: "Cheese Maggi", description: "Creamy cheese-loaded maggi"},
            {id: 20, name: "Chicken Maggi", description: "Maggi with tender chicken pieces"},
            {id: 21, name: "Salted Fries", description: "Crispy golden french fries with salt"},
            {id: 22, name: "Peri Peri Fries", description: "Spicy peri peri seasoned fries"},
            {id: 23, name: "Mix Fries", description: "Assorted seasoned fries variety"},
            {id: 24, name: "Paneer Pakoda", description: "Deep-fried cottage cheese fritters"},
            {id: 25, name: "Bun Maska", description: "Soft bun with butter"},
            {id: 26, name: "Masala Bun", description: "Spiced and toasted bun"},
            {id: 27, name: "Malai Bun", description: "Creamy malai-filled bun"},
            {id: 28, name: "Anda Bun", description: "Bun with egg preparation"},
            {id: 29, name: "Aloo Bun", description: "Bun stuffed with spiced potatoes"},
            {id: 30, name: "Keema Bun", description: "Bun filled with spiced minced meat"},
            {id: 31, name: "Cheesy Crazy", description: "Extra cheesy comfort food"},
            {id: 32, name: "Chicken Chakna", description: "Spicy chicken appetizer"},
            {id: 33, name: "Peanut Masala", description: "Spiced roasted peanuts"},
            {id: 34, name: "Crispy Corn", description: "Seasoned crispy corn kernels"},
            {id: 35, name: "Loaded Nachos", description: "Nachos with cheese and toppings"},
            {id: 36, name: "Chicken Nuggets", description: "Crispy fried chicken nuggets"},
            {id: 37, name: "Chicken Strips", description: "Tender chicken strips"},
            {id: 38, name: "Chicken Popcorn", description: "Bite-sized crispy chicken pieces"},
            {id: 39, name: "Veg Hakka Noodles", description: "Stir-fried vegetable noodles"},
            {id: 40, name: "Chilli Garlic Noodles", description: "Spicy garlic-flavored noodles"},
            {id: 41, name: "Egg Noodles", description: "Noodles tossed with scrambled eggs"},
            {id: 42, name: "Chicken Noodles", description: "Noodles with tender chicken pieces"},
            {id: 43, name: "Veg Fried Rice", description: "Aromatic fried rice with vegetables"},
            {id: 44, name: "Egg Fried Rice", description: "Fried rice with scrambled eggs"},
            {id: 45, name: "Chicken Fried Rice", description: "Fried rice with chicken pieces"},
            {id: 46, name: "Honey Chilli Potato", description: "Sweet and spicy potato dish"},
            {id: 47, name: "Chilli Mushroom", description: "Spicy mushroom in Chinese style"},
            {id: 48, name: "Chilli Paneer", description: "Cottage cheese in spicy sauce"},
            {id: 49, name: "Veg Manchurian", description: "Vegetable balls in tangy sauce"},
            {id: 50, name: "Chilli Chicken", description: "Spicy chicken in Indo-Chinese style"},
            {id: 51, name: "Crispy Chicken", description: "Crunchy fried chicken"},
            {id: 52, name: "Chicken Manchurian", description: "Chicken balls in manchurian sauce"},
            {id: 53, name: "Paneer Tikka", description: "Grilled marinated cottage cheese"},
            {id: 54, name: "Paneer Malai Tikka", description: "Creamy cottage cheese tikka"},
            {id: 55, name: "Mushroom Tikka", description: "Grilled marinated mushrooms"},
            {id: 56, name: "Dahi Kebab", description: "Yogurt-based vegetarian kebab"},
            {id: 57, name: "Hara Bhara Kebab", description: "Green vegetable kebab"},
            {id: 58, name: "Tandoori Chicken", description: "Clay oven roasted chicken"},
            {id: 59, name: "Chicken Tikka", description: "Grilled marinated chicken pieces"},
            {id: 60, name: "Chicken Malai Tikka", description: "Creamy chicken tikka"},
            {id: 61, name: "Chicken Seekh Kebab", description: "Minced chicken kebab"},
            {id: 62, name: "Paneer Butter Masala", description: "Cottage cheese in rich tomato gravy"},
            {id: 63, name: "Kadhai Paneer", description: "Paneer cooked with bell peppers"},
            {id: 64, name: "Dal Makhni", description: "Creamy black lentil curry"},
            {id: 65, name: "Dal Tadka", description: "Tempered yellow lentil curry"},
            {id: 66, name: "Mix Veg", description: "Mixed vegetable curry"},
            {id: 67, name: "Butter Chicken", description: "Chicken in rich tomato-butter gravy"},
            {id: 68, name: "Kadhai Chicken", description: "Chicken cooked with bell peppers"},
            {id: 69, name: "Chicken Curry", description: "Traditional spiced chicken curry"},
            {id: 70, name: "Roti", description: "Traditional Indian flatbread"},
            {id: 71, name: "Naan", description: "Leavened Indian bread"},
            {id: 72, name: "Garlic Naan", description: "Naan topped with garlic"},
            {id: 73, name: "Steamed Rice", description: "Plain steamed basmati rice"},
            {id: 74, name: "Jeera Rice", description: "Cumin-flavored basmati rice"}
        ],
        beverages: [
            {id: 1, name: "Ginger Tea", description: "Refreshing tea with fresh ginger"},
            {id: 2, name: "Black Tea", description: "Classic strong black tea"},
            {id: 3, name: "Masala Tea", description: "Spiced Indian tea with aromatic herbs"},
            {id: 4, name: "Elaichi Tea", description: "Cardamom-flavored tea"},
            {id: 5, name: "Green Tea", description: "Healthy antioxidant-rich green tea"},
            {id: 6, name: "Lemon Ginger Tea", description: "Zesty tea with lemon and ginger"},
            {id: 7, name: "Hot Coffee", description: "Freshly brewed hot coffee"},
            {id: 8, name: "Americano", description: "Strong black coffee"},
            {id: 9, name: "Cold Coffee", description: "Iced coffee with milk"},
            {id: 10, name: "Ice Tea", description: "Chilled tea with refreshing flavors"},
            {id: 11, name: "Virgin Mojito", description: "Mint and lime refreshing drink"},
            {id: 12, name: "Fresh Lime", description: "Fresh lime water with salt/sugar"},
            {id: 13, name: "Lemonade", description: "Classic sweet and tangy lemonade"},
            {id: 14, name: "Blue Lagoon", description: "Blue-colored refreshing mocktail"},
            {id: 15, name: "Watermelon Mojito", description: "Watermelon-flavored mint drink"},
            {id: 16, name: "Watermelon Lemonade", description: "Fresh watermelon and lemon drink"},
            {id: 17, name: "Oreo Shake", description: "Creamy shake with oreo cookies"},
            {id: 18, name: "KitKat Shake", description: "Chocolate shake with KitKat pieces"},
            {id: 19, name: "Chocolate Shake", description: "Rich and creamy chocolate shake"},
            {id: 20, name: "Sweet Lassi", description: "Traditional sweet yogurt drink"},
            {id: 21, name: "Salty Lassi", description: "Traditional salted yogurt drink"},
            {id: 22, name: "Mineral Water", description: "Pure mineral water bottle"},
            {id: 23, name: "Soda", description: "Carbonated soft drinks"},
            {id: 24, name: "Mixers", description: "Variety of mixer drinks"}
        ]
    },
    testimonials: [
        {name: "Priya Sharma", text: "The Picnic Story made our anniversary absolutely magical! The boho setup was stunning and the food was incredible.", rating: 5},
        {name: "Arjun Patel", text: "Perfect for our corporate team outing. Professional service and beautiful presentation. Highly recommend!", rating: 5},
        {name: "Meera Singh", text: "They transformed our garden party into a dreamy boho paradise. Every detail was perfect!", rating: 5}
    ]
};

// Mock Database Service (Simulating Supabase)
class MockDatabase {
    constructor() {
        this.leads = JSON.parse(localStorage.getItem('picnic_leads') || '[]');
        this.menuLinks = JSON.parse(localStorage.getItem('picnic_menu_links') || '[]');
        this.orders = JSON.parse(localStorage.getItem('picnic_orders') || '[]');
        this.isConnected = true;
    }

    async saveLead(lead) {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.leads.push({ ...lead, id: this.generateId() });
                localStorage.setItem('picnic_leads', JSON.stringify(this.leads));
                resolve({ success: true, id: lead.id });
            }, 500);
        });
    }

    async saveMenuLink(menuLink) {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.menuLinks.push(menuLink);
                localStorage.setItem('picnic_menu_links', JSON.stringify(this.menuLinks));
                resolve({ success: true });
            }, 300);
        });
    }

    async saveOrder(order) {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.orders.push({ ...order, id: this.generateId() });
                localStorage.setItem('picnic_orders', JSON.stringify(this.orders));
                resolve({ success: true, id: order.id });
            }, 500);
        });
    }

    async getLeads() {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(this.leads);
            }, 200);
        });
    }

    async getMenuLinks() {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(this.menuLinks);
            }, 200);
        });
    }

    async getOrders() {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(this.orders);
            }, 200);
        });
    }

    generateId() {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    getConnectionStatus() {
        return this.isConnected;
    }
}

// Application State
let appState = {
    currentPage: 'home',
    isAdminLoggedIn: false,
    currentBooking: null,
    currentMenuLink: null,
    currentMenuSelection: null,
    database: new MockDatabase()
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
    exportLeadsBtn: document.getElementById('export-leads'),
    leadsSearch: document.getElementById('leads-search'),
    locationFilter: document.getElementById('location-filter'),
    toastContainer: document.getElementById('toast-container')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    loadTestimonials();
    setMinDate();
    loadSampleMenuPreview();
    updateDatabaseStatus();
});

function initializeApp() {
    // Check for menu link in URL
    const urlParams = new URLSearchParams(window.location.search);
    const menuId = urlParams.get('menu');
    if (menuId) {
        loadMenuLinkById(menuId);
        return;
    }
    
    navigateToPage('home');
}

async function loadMenuLinkById(menuId) {
    try {
        const menuLinks = await appState.database.getMenuLinks();
        const menuLink = menuLinks.find(link => link.id === menuId);
        if (menuLink) {
            appState.currentMenuLink = menuLink;
            navigateToPage('menu-selection');
            loadMenuSelection(menuLink);
        } else {
            showToast('Menu link not found or expired', 'error');
            navigateToPage('home');
        }
    } catch (error) {
        showToast('Error loading menu link', 'error');
        navigateToPage('home');
    }
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

    // Forms with real-time validation
    elements.bookingForm?.addEventListener('submit', handleBookingSubmit);
    elements.adminLoginForm?.addEventListener('submit', handleAdminLogin);
    elements.menuSelectionForm?.addEventListener('submit', handleMenuSelectionSubmit);

    // Real-time form validation
    if (elements.bookingForm) {
        const inputs = elements.bookingForm.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.addEventListener('blur', () => validateField(input));
            input.addEventListener('input', () => clearFieldError(input));
        });
    }

    // Admin Dashboard
    elements.adminLogout?.addEventListener('click', handleAdminLogout);
    elements.generateMenuLinkBtn?.addEventListener('click', generateMenuLink);
    elements.copyLinkBtn?.addEventListener('click', copyGeneratedLink);
    elements.exportLeadsBtn?.addEventListener('click', exportLeads);

    // Search and Filter
    elements.leadsSearch?.addEventListener('input', filterLeads);
    elements.locationFilter?.addEventListener('change', filterLeads);

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
            updateSelectionSummary();
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
    clearAllFieldErrors();
}

// Form Validation
function validateField(input) {
    const fieldName = input.id.replace('-', '_');
    const value = input.value.trim();
    
    switch(input.id) {
        case 'full-name':
            if (!value) {
                showFieldError(input, 'Full name is required');
                return false;
            }
            if (value.length < 2) {
                showFieldError(input, 'Name must be at least 2 characters');
                return false;
            }
            break;
            
        case 'mobile-number':
            const mobileRegex = /^[0-9]{10}$/;
            if (!mobileRegex.test(value)) {
                showFieldError(input, 'Enter a valid 10-digit mobile number');
                return false;
            }
            break;
            
        case 'email-address':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                showFieldError(input, 'Enter a valid email address');
                return false;
            }
            break;
            
        case 'location':
            if (!value) {
                showFieldError(input, 'Please select a location');
                return false;
            }
            break;
            
        case 'guest-count':
            const guestCount = parseInt(value);
            if (!guestCount || guestCount < 2) {
                showFieldError(input, 'Minimum 2 guests required');
                return false;
            }
            if (guestCount > 50) {
                showFieldError(input, 'Maximum 50 guests allowed');
                return false;
            }
            break;
            
        case 'preferred-date':
            const selectedDate = new Date(value);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            if (selectedDate < today) {
                showFieldError(input, 'Please select a future date');
                return false;
            }
            break;
    }
    
    clearFieldError(input);
    return true;
}

function showFieldError(input, message) {
    const errorElement = document.getElementById(`${input.id}-error`);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }
    input.style.borderColor = 'var(--color-error)';
}

function clearFieldError(input) {
    const errorElement = document.getElementById(`${input.id}-error`);
    if (errorElement) {
        errorElement.style.display = 'none';
    }
    input.style.borderColor = '';
}

function clearAllFieldErrors() {
    const errorElements = elements.bookingForm?.querySelectorAll('.form-error');
    errorElements?.forEach(error => error.style.display = 'none');
    
    const inputs = elements.bookingForm?.querySelectorAll('input, select, textarea');
    inputs?.forEach(input => input.style.borderColor = '');
}

// Form Handling
async function handleBookingSubmit(e) {
    e.preventDefault();
    
    // Show loading state
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const btnText = submitBtn.querySelector('.btn-text');
    const spinner = submitBtn.querySelector('.loading-spinner');
    
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');
    submitBtn.disabled = true;
    
    try {
        const booking = {
            fullName: document.getElementById('full-name').value,
            mobileNumber: document.getElementById('mobile-number').value,
            emailAddress: document.getElementById('email-address').value,
            location: document.getElementById('location').value,
            guestCount: parseInt(document.getElementById('guest-count').value),
            preferredDate: document.getElementById('preferred-date').value,
            specialRequirements: document.getElementById('special-requirements').value,
            submittedAt: new Date().toISOString()
        };
        
        // Validate all fields
        const inputs = elements.bookingForm.querySelectorAll('input[required], select[required]');
        let isValid = true;
        
        inputs.forEach(input => {
            if (!validateField(input)) {
                isValid = false;
            }
        });
        
        if (!isValid) {
            throw new Error('Please fix the errors above');
        }
        
        // Save to database
        const result = await appState.database.saveLead(booking);
        
        if (result.success) {
            appState.currentBooking = { ...booking, id: result.id };
            closeBookingModal();
            showToast('Booking submitted successfully!', 'success');
            
            setTimeout(() => {
                navigateToPage('menu-preview');
            }, 1500);
        }
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        // Reset button state
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
        submitBtn.disabled = false;
    }
}

// Admin Functions
async function handleAdminLogin(e) {
    e.preventDefault();
    
    const password = document.getElementById('admin-password').value;
    if (password === 'admin123') {
        appState.isAdminLoggedIn = true;
        await showAdminDashboard();
        showToast('Admin login successful', 'success');
    } else {
        showFieldError(document.getElementById('admin-password'), 'Invalid password');
    }
}

function handleAdminLogout() {
    appState.isAdminLoggedIn = false;
    showAdminLogin();
    showToast('Logged out successfully', 'success');
}

function showAdminLogin() {
    document.getElementById('admin-login').classList.remove('hidden');
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('admin-password').value = '';
}

async function showAdminDashboard() {
    document.getElementById('admin-login').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    
    await Promise.all([
        loadLeads(),
        loadMenuLinks(),
        loadOrders()
    ]);
    
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

async function loadLeads() {
    try {
        const leads = await appState.database.getLeads();
        displayLeads(leads);
    } catch (error) {
        showToast('Error loading leads', 'error');
    }
}

function displayLeads(leads) {
    const container = document.getElementById('leads-container');
    
    if (leads.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No leads yet</h3><p>Customer bookings will appear here</p></div>';
        return;
    }
    
    const leadsHtml = leads.map(lead => `
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

async function generateMenuLink() {
    const foodCount = parseInt(document.getElementById('food-count').value);
    const beverageCount = parseInt(document.getElementById('beverage-count').value);
    
    // Show loading state
    const btn = elements.generateMenuLinkBtn;
    const btnText = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.loading-spinner');
    
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');
    btn.disabled = true;
    
    try {
        const menuLink = {
            id: generateId(),
            foodCount,
            beverageCount,
            createdAt: new Date().toISOString(),
            status: 'Active'
        };
        
        await appState.database.saveMenuLink(menuLink);
        
        // Show generated link
        const linkUrl = `${window.location.origin}${window.location.pathname}?menu=${menuLink.id}`;
        document.getElementById('generated-link').value = linkUrl;
        document.getElementById('generated-link-container').classList.remove('hidden');
        
        await loadMenuLinks();
        showToast('Menu link generated successfully!', 'success');
        
    } catch (error) {
        showToast('Error generating menu link', 'error');
    } finally {
        // Reset button state
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
        btn.disabled = false;
    }
}

function copyGeneratedLink() {
    const linkInput = document.getElementById('generated-link');
    linkInput.select();
    linkInput.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(linkInput.value);
    showToast('Link copied to clipboard!', 'success');
}

async function loadMenuLinks() {
    try {
        const menuLinks = await appState.database.getMenuLinks();
        displayMenuLinks(menuLinks);
    } catch (error) {
        showToast('Error loading menu links', 'error');
    }
}

function displayMenuLinks(menuLinks) {
    const container = document.getElementById('menu-links-container');
    
    if (menuLinks.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No menu links generated</h3><p>Generated menu links will appear here</p></div>';
        return;
    }
    
    const linksHtml = menuLinks.map(link => `
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

async function loadOrders() {
    try {
        const orders = await appState.database.getOrders();
        displayOrders(orders);
    } catch (error) {
        showToast('Error loading orders', 'error');
    }
}

function displayOrders(orders) {
    const container = document.getElementById('orders-container');
    
    if (orders.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No orders yet</h3><p>Customer orders will appear here</p></div>';
        return;
    }
    
    const ordersHtml = orders.map(order => `
        <div class="leads-table">
            <div class="lead-item">
                <div class="lead-header">
                    <span class="lead-name">Order #${order.id.slice(-8)}</span>
                    <span class="lead-date">${formatDate(order.submittedAt)}</span>
                </div>
                <div class="lead-details">
                    <div class="lead-detail">
                        <strong>Menu Link:</strong>
                        <span>${order.menuLinkId}</span>
                    </div>
                    <div class="lead-detail">
                        <strong>Total Items:</strong>
                        <span>${order.items.length}</span>
                    </div>
                    <div class="lead-detail" style="grid-column: 1 / -1;">
                        <strong>Items:</strong>
                        <span>${order.items.map(item => `${item.name} (${item.quantity})`).join(', ')}</span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
    
    container.innerHTML = ordersHtml;
}

function copyMenuLink(linkId) {
    const linkUrl = `${window.location.origin}${window.location.pathname}?menu=${linkId}`;
    navigator.clipboard.writeText(linkUrl);
    showToast('Menu link copied to clipboard!', 'success');
}

async function viewMenuLink(linkId) {
    try {
        const menuLinks = await appState.database.getMenuLinks();
        const menuLink = menuLinks.find(link => link.id === linkId);
        if (menuLink) {
            appState.currentMenuLink = menuLink;
            navigateToPage('menu-selection');
            loadMenuSelection(menuLink);
        }
    } catch (error) {
        showToast('Error loading menu link', 'error');
    }
}

// Search and Filter Functions
async function filterLeads() {
    try {
        const leads = await appState.database.getLeads();
        const searchTerm = elements.leadsSearch.value.toLowerCase();
        const locationFilter = elements.locationFilter.value;
        
        let filteredLeads = leads.filter(lead => {
            const matchesSearch = !searchTerm || 
                lead.fullName.toLowerCase().includes(searchTerm) ||
                lead.emailAddress.toLowerCase().includes(searchTerm) ||
                lead.mobileNumber.includes(searchTerm);
                
            const matchesLocation = !locationFilter || lead.location === locationFilter;
            
            return matchesSearch && matchesLocation;
        });
        
        displayLeads(filteredLeads);
    } catch (error) {
        showToast('Error filtering leads', 'error');
    }
}

async function exportLeads() {
    try {
        const leads = await appState.database.getLeads();
        
        if (leads.length === 0) {
            showToast('No leads to export', 'error');
            return;
        }
        
        const csvContent = [
            ['Name', 'Mobile', 'Email', 'Location', 'Guests', 'Date', 'Special Requirements', 'Submitted At'],
            ...leads.map(lead => [
                lead.fullName,
                lead.mobileNumber,
                lead.emailAddress,
                lead.location,
                lead.guestCount,
                lead.preferredDate,
                lead.specialRequirements || '',
                formatDate(lead.submittedAt)
            ])
        ].map(row => row.map(field => `"${field}"`).join(',')).join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `picnic_leads_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        
        showToast('Leads exported successfully!', 'success');
    } catch (error) {
        showToast('Error exporting leads', 'error');
    }
}

// Menu Selection Functions
function loadMenuSelection(menuLink) {
    const foodItems = appData.menuItems.food.slice(0, menuLink.foodCount);
    const beverageItems = appData.menuItems.beverages.slice(0, menuLink.beverageCount);
    
    document.getElementById('food-item-count').textContent = `(${menuLink.foodCount})`;
    document.getElementById('beverage-item-count').textContent = `(${menuLink.beverageCount})`;
    
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
                <button type="button" class="quantity-btn" onclick="changeQuantity('${type}-${item.id}', -1)">−</button>
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
    updateSelectionSummary();
}

function updateSelectionSummary() {
    if (!appState.currentMenuLink) return;
    
    const selectedItems = [];
    let totalCount = 0;
    
    // Check food items
    const foodItems = appData.menuItems.food.slice(0, appState.currentMenuLink.foodCount);
    foodItems.forEach(item => {
        const quantity = parseInt(document.getElementById(`food-${item.id}`)?.value || 0);
        if (quantity > 0) {
            selectedItems.push(`${item.name} × ${quantity}`);
            totalCount += quantity;
        }
    });
    
    // Check beverage items
    const beverageItems = appData.menuItems.beverages.slice(0, appState.currentMenuLink.beverageCount);
    beverageItems.forEach(item => {
        const quantity = parseInt(document.getElementById(`beverage-${item.id}`)?.value || 0);
        if (quantity > 0) {
            selectedItems.push(`${item.name} × ${quantity}`);
            totalCount += quantity;
        }
    });
    
    const summaryContainer = document.getElementById('summary-items');
    if (selectedItems.length === 0) {
        summaryContainer.textContent = 'No items selected';
    } else {
        summaryContainer.innerHTML = selectedItems.map(item => `<div>${item}</div>`).join('');
    }
    
    document.getElementById('total-count').textContent = totalCount;
}

async function handleMenuSelectionSubmit(e) {
    e.preventDefault();
    
    // Show loading state
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const btnText = submitBtn.querySelector('.btn-text');
    const spinner = submitBtn.querySelector('.loading-spinner');
    
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');
    submitBtn.disabled = true;
    
    try {
        const selection = {
            menuLinkId: appState.currentMenuLink.id,
            items: [],
            submittedAt: new Date().toISOString()
        };
        
        // Collect food selections
        const foodItems = appData.menuItems.food.slice(0, appState.currentMenuLink.foodCount);
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
        const beverageItems = appData.menuItems.beverages.slice(0, appState.currentMenuLink.beverageCount);
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
            throw new Error('Please select at least one item');
        }
        
        // Save selection to database
        const result = await appState.database.saveOrder(selection);
        
        if (result.success) {
            appState.currentMenuSelection = { ...selection, id: result.id };
            showToast('Order submitted successfully!', 'success');
            
            setTimeout(() => {
                navigateToPage('confirmation');
                loadConfirmation();
            }, 1500);
        }
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        // Reset button state
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
        submitBtn.disabled = false;
    }
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
    const sampleFood = appData.menuItems.food.slice(0, 6);
    
    const foodHtml = sampleFood.map(item => `
        <div class="menu-item">
            <h4>${item.name}</h4>
            <p>${item.description}</p>
        </div>
    `).join('');
    
    foodContainer.innerHTML = foodHtml;
    
    // Load sample beverage items
    const beverageContainer = document.getElementById('preview-beverage-items');
    const sampleBeverages = appData.menuItems.beverages.slice(0, 4);
    
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
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateInput.min = tomorrow.toISOString().split('T')[0];
    }
}

function updateDatabaseStatus() {
    const statusElements = document.querySelectorAll('.database-status');
    const isConnected = appState.database.getConnectionStatus();
    
    statusElements.forEach(element => {
        const indicator = element.querySelector('.status-indicator');
        const text = element.querySelector('.status-text');
        
        if (isConnected) {
            indicator.classList.add('connected');
            text.textContent = 'Database Status: Connected';
            element.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
            element.style.borderColor = 'rgba(16, 185, 129, 0.2)';
        } else {
            indicator.classList.remove('connected');
            text.textContent = 'Database Status: Disconnected';
            element.style.backgroundColor = 'rgba(220, 38, 38, 0.1)';
            element.style.borderColor = 'rgba(220, 38, 38, 0.2)';
        }
    });
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

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    elements.toastContainer.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Global functions for onclick handlers
window.navigateToPage = navigateToPage;
window.changeQuantity = changeQuantity;
window.copyMenuLink = copyMenuLink;
window.viewMenuLink = viewMenuLink;