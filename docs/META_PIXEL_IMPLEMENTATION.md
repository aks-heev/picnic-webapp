# Meta Pixel Events — Implementation Plan
**Pixel ID: 1366746648648321 (new pixel ggn)**
Based on: `pixel_events_plan.docx` — June 2026

---

## Status

> **✅ FULLY SHIPPED — verified in live code 2026-07-06.** All five events are implemented in app.js
> (ViewContent ~L425/L2140 incl. /packages, Lead ~L4388, InitiateCheckout ~L9099, Contact ~L9152).
> Nothing below is pending; kept for reference. Only related open item: deferring the Pixel's
> synchronous `<head>` init for INP (see SPEED_REGRESSION_2026-07-04.md Phase 2C).

| Event | Status | Priority |
|---|---|---|
| PageView | ✅ Live (index.html ~line 96) | — |
| Lead | ✅ Live (finishBookingFlow) | — |
| Contact | ✅ Live (delegated wa.me listener) | — |
| InitiateCheckout | ✅ Live (Book Now handler) | — |
| ViewContent | ✅ Live (venue cards observer + /packages) | — |

---

## What NOT to change

The doc's code snippets assume a different codebase structure (class selectors, no module pattern, etc). **Do not copy-paste them verbatim.** The hooks below are derived from reading the actual app.js.

CSP is already fine — `https://connect.facebook.net` is in `script-src` and `connect-src` in `index.html`.

---

## Change 1 — Lead event

**File:** `app.js`
**Line:** ~2664 (inside `finishBookingFlow`)
**Trigger:** Every time the booking/enquiry flow completes and the success page renders — both query leads (`confirmed=false`) and paid bookings (`confirmed=true`).

### Current code (line 2658–2664)
```js
track(confirmed ? 'booking_confirmed' : 'booking_query_submitted', {
  booking_id:  bookingRow?.id,
  venue_name:  venueName,
  venue_type:  venue?.type,
  guests:      bookingRow?.guest_count,
  advance_amount: bookingRow?.advance_amount,
})
```

### Add immediately after that block (before line 2666)
```js
// Meta Pixel — Lead event (enquiry or confirmed booking)
if (typeof fbq === 'function') {
  fbq('track', 'Lead', {
    content_category: bookingRow?.occasion || '',
    content_name:     venue?.city || '',
    num_items:        bookingRow?.guest_count || 0,
    currency:         'INR',
  })
}
```

**Why here:** `finishBookingFlow` is the single convergence point for all booking outcomes (query path, Razorpay success, Razorpay fallback). `bookingRow` has `occasion`, `guest_count`; `venue` has `city`. No duplication risk.

---

## Change 2 — Contact event

**File:** `app.js`
**Location:** Inside the `DOMContentLoaded` block, near the bottom (~line 7228, just before `loadVenues()`)
**Trigger:** Any click on a `wa.me` link — covers all three in the app:
- Hero "Contact Us" button (`index.html` line 146, `href="https://wa.me/919773703982"`)
- Footer team WhatsApp links (`renderFooterTeams`, `app.js` ~line 396)
- Floating venue WhatsApp button (`.vd-wa-float`, `app.js` ~line 1202)

### Add before `loadVenues()` call (~line 7229)
```js
// Meta Pixel — Contact event (any WhatsApp link tap)
document.addEventListener('click', (e) => {
  const waLink = e.target.closest('a[href*="wa.me"]')
  if (!waLink) return
  if (typeof fbq === 'function') fbq('track', 'Contact')
})
```

**Why here:** Single delegated listener catches all WA links regardless of when they're injected into the DOM (footer, floating btn, etc.). No need to add separate handlers per link.

---

## Change 3 — InitiateCheckout event

**File:** `app.js`
**Location:** Inside the existing delegated click handler at ~line 7195–7227
**Trigger:** User clicks the enabled "Book Now" or "Select guests →" button (sidebar `#sidebar-book-btn` or mobile `#mobile-bar-book-btn`).

### Current handler (line 7195–7227, simplified)
```js
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#sidebar-book-btn, #mobile-bar-book-btn')
  if (!btn || btn.disabled) return
  const venueId = parseInt(btn.dataset.bookVenueId, 10)
  if (isNaN(venueId)) return
  const venue = appState.venues.find(v => v.id === venueId)
  if (venue) {
    // ... changeMode fast-resume logic ...
    showBookingForm(venue)  // or showGuestSelector
  }
})
```

### Add right after `const venue = appState.venues.find(...)` and the `if (venue)` check, before any branch:
```js
if (venue) {
  // Meta Pixel — InitiateCheckout event
  if (typeof fbq === 'function') {
    fbq('track', 'InitiateCheckout', {
      content_name: venue.name,
      content_ids:  [String(venueId)],
      currency:     'INR',
    })
  }
  // ... rest of existing branch logic (changeMode, showBookingForm, etc.) ...
}
```

**Why here:** This is the only delegated handler for the Book Now buttons. Fires once per click, after we've confirmed the venue is valid, before the booking UI opens.

---

## Change 4 — ViewContent event

Two edits required.

### 4a — Add `data-venue-name` to venue card HTML

**File:** `app.js`
**Line:** ~508 (inside `venueCardHtml`)

#### Current
```js
<a class="venue-card" href="/venues/${escapeHtml(venue.slug || '')}"
   data-venue-id="${venue.id}" aria-label="View ${escapeHtml(venue.name)}">
```

#### Change to
```js
<a class="venue-card" href="/venues/${escapeHtml(venue.slug || '')}"
   data-venue-id="${venue.id}" data-venue-name="${escapeHtml(venue.name)}"
   aria-label="View ${escapeHtml(venue.name)}">
```

### 4b — Set up IntersectionObserver after venues render

**File:** `app.js`
**Location:** Inside `loadVenues()` at ~line 360, right after `renderVenueGallery(data || [])`

#### Current
```js
appState.venues = data || []
renderVenueGallery(data || [])
renderCityPills(data || [])
```

#### Change to
```js
appState.venues = data || []
renderVenueGallery(data || [])
renderCityPills(data || [])
setupVenueCardViewContentObserver()
```

Then **add the function** somewhere before `loadVenues` (e.g., line ~348):
```js
function setupVenueCardViewContentObserver() {
  if (typeof fbq !== 'function' || typeof IntersectionObserver === 'undefined') return
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return
      const el = entry.target
      fbq('track', 'ViewContent', {
        content_ids:  [el.dataset.venueId],
        content_name: el.dataset.venueName || '',
        content_type: 'venue',
      })
      observer.unobserve(el) // fire once per card per session
    })
  }, { threshold: 0.5 })

  document.querySelectorAll('.venue-card').forEach(card => observer.observe(card))
}
```

**Why after `renderVenueGallery`:** Venue cards don't exist in the DOM until `renderVenueGallery` writes them. Calling the observer setup in `loadVenues` callback is the right place — the cards are guaranteed to exist.

---

## Verification Checklist

After changes are in and deployed:

1. **Install [Meta Pixel Helper](https://chromewebstore.google.com/detail/meta-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc)** Chrome extension
2. Open `picnicstories.com` — verify **PageView** fires on load
3. Scroll through venue grid — verify **ViewContent** fires per card (once per card, not repeatedly on scroll-back)
4. Click "Contact Us" / footer WhatsApp / venue floating WA button — verify **Contact** fires
5. Open a venue, select a date, click "Book Now" — verify **InitiateCheckout** fires with correct `content_name`
6. Complete a booking enquiry to the success screen — verify **Lead** fires with correct `content_category` (occasion), `content_name` (city), `num_items` (guest count)
7. In Meta Events Manager → Dataset → **Test Events tab** — confirm all 4 events appear with populated parameters
8. Check **no duplicate events** fire on a single action (Pixel Helper shows counts)

---

## Gotchas

- `fbq` is a global injected by the inline snippet in `index.html`. The `typeof fbq === 'function'` guard prevents errors on pages where the snippet isn't loaded (admin panel).
- The `venue-card` selector also captures the `.venue-custom-cta` div — but that element doesn't have `data-venue-id` / `data-venue-name` and isn't an `<a class="venue-card">`, so `querySelectorAll('.venue-card')` won't match it. No issue.
- Don't add `fbq('track', 'Lead')` inside `handleInlineBookingSubmit` (step 1 of the form) — that fires before the booking is actually inserted into the DB. Use `finishBookingFlow` only.
- The floating `.vd-wa-float` button is injected after `renderVenueDetail` runs. The delegated `a[href*="wa.me"]` listener handles this correctly because it's on `document` (captures bubbling events from late-injected elements).

---

## Files changed

| File | Change |
|---|---|
| `app.js` | Add Lead fbq call in `finishBookingFlow` (~line 2665) |
| `app.js` | Add Contact delegated listener in DOMContentLoaded (~line 7228) |
| `app.js` | Add InitiateCheckout call in Book Now click handler (~line 7201) |
| `app.js` | Add `data-venue-name` to `venueCardHtml` (~line 508) |
| `app.js` | Add `setupVenueCardViewContentObserver()` function + call in `loadVenues` (~line 348 + 360) |

No changes to `index.html`, `style.css`, or Supabase.
