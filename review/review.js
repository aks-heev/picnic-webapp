import { createClient } from '@supabase/supabase-js'

// Supabase init
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

// State
let selectedRating = 0

// Rating text labels
const ratingLabels = {
  0: 'Click to rate',
  1: 'Poor 😕',
  2: 'Fair 😐',
  3: 'Good 🙂',
  4: 'Very Good 😊',
  5: 'Excellent! 🤩'
}

// Toast helper
function showToast(msg, type = 'success') {
  const c = document.getElementById('toast-container')
  if (!c) return
  const t = document.createElement('div')
  t.className = `toast show ${type}`
  t.textContent = msg
  c.appendChild(t)
  setTimeout(() => {
    t.classList.remove('show')
    setTimeout(() => c.removeChild(t), 300)
  }, 3000)
}

// Initialize star rating
function initStarRating() {
  const starButtons = document.querySelectorAll('.star-btn')
  const ratingInput = document.getElementById('rating-value')
  const ratingText = document.getElementById('rating-text')
  
  starButtons.forEach(btn => {
    // Click handler
    btn.addEventListener('click', () => {
      const rating = parseInt(btn.dataset.rating, 10)
      selectedRating = rating
      ratingInput.value = rating
      updateStars(rating)
      ratingText.textContent = ratingLabels[rating]
    })
    
    // Hover effect
    btn.addEventListener('mouseenter', () => {
      const rating = parseInt(btn.dataset.rating, 10)
      updateStars(rating, true)
    })
    
    btn.addEventListener('mouseleave', () => {
      updateStars(selectedRating)
    })
  })
}

// Update star display
function updateStars(rating, isHover = false) {
  const starButtons = document.querySelectorAll('.star-btn')
  starButtons.forEach(btn => {
    const btnRating = parseInt(btn.dataset.rating, 10)
    const starIcon = btn.querySelector('.star-icon')
    
    if (btnRating <= rating) {
      starIcon.textContent = '★'
      btn.classList.add('active')
      if (isHover) btn.classList.add('hover')
    } else {
      starIcon.textContent = '☆'
      btn.classList.remove('active', 'hover')
    }
  })
}

// Handle form submission
async function handleReviewSubmit(e) {
  e.preventDefault()
  
  const form = e.target
  const submitBtn = document.getElementById('submit-review-btn')
  const btnText = submitBtn.querySelector('.btn-text')
  const btnLoading = submitBtn.querySelector('.btn-loading')
  
  // Get form values
  const name = form['reviewer-name'].value.trim()
  const rating = parseInt(form['rating'].value, 10)
  const reviewText = form['review-text'].value.trim()
  const occasion = form['occasion'].value || null
  
  // Validation
  if (!name) {
    showToast('Please enter your name', 'error')
    return
  }
  
  if (rating === 0) {
    showToast('Please select a rating', 'error')
    return
  }
  
  if (!reviewText) {
    showToast('Please write a review', 'error')
    return
  }
  
  if (reviewText.length < 10) {
    showToast('Please write at least 10 characters', 'error')
    return
  }
  
  // Show loading
  btnText.classList.add('hidden')
  btnLoading.classList.remove('hidden')
  submitBtn.disabled = true
  
  try {
    const { error } = await supabase
      .from('reviews')
      .insert([{
        customer_name: name,
        rating: rating,
        review_text: reviewText,
        occasion: occasion,
        is_approved: null, // Pending admin approval
        created_at: new Date().toISOString()
      }])
    
    if (error) throw error
    
    // Show success
    document.getElementById('review-form-section').classList.add('hidden')
    document.getElementById('review-success-section').classList.remove('hidden')
    
  } catch (err) {
    console.error('Error submitting review:', err)
    showToast('Error submitting review. Please try again.', 'error')
    
    // Reset button
    btnText.classList.remove('hidden')
    btnLoading.classList.add('hidden')
    submitBtn.disabled = false
  }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  initStarRating()
  
  const form = document.getElementById('review-form')
  form?.addEventListener('submit', handleReviewSubmit)
})
