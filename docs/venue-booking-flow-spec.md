# Venue-Based Booking Flow
**The Picnic Story — Feature Spec v1**
*Status: Draft | Last updated: May 2026*

---

## Problem Statement

The current booking flow presents a single modal form where customers select a location from a plain dropdown. This doesn't communicate the actual venue options — cafes, Airbnbs, outdoor spaces — that The Picnic Story now offers. Customers have no way to browse what a venue looks, feels, or is suited for before committing to an enquiry. This means the app undersells the product, and the admin receives under-informed bookings that require additional back-and-forth to clarify venue, capacity, and suitability.

---

## Goals

1. **Reduce venue-related back-and-forth** — customers arrive at the booking form already knowing which venue they want, its capacity, and its type. Target: admin spends <1 follow-up message on venue clarification per booking (vs. current ~3).
2. **Increase booking form completion rate** — customers who see a venue they love convert at a higher rate than those staring at a dropdown. Target: form submission rate up 20% within 60 days of launch.
3. **Support three distinct booking intents** — a single app handles full venue bookings (self-managed), service add-ons (partner Airbnbs), and bring-your-own-venue requests without separate workflows.
4. **Give admin full venue control** — admin can add, edit, activate/deactivate venues without a code deploy.
5. **Set the foundation for availability management** — venue data model supports date blocking in a future release without schema changes.

---

## Non-Goals

**v1 explicitly will NOT include:**

- **Real-time availability calendars** — admin confirms availability manually after receiving a booking. The system captures intent, not a guaranteed slot. Too complex for v1 and not needed while booking volume is low.
- **Dynamic / auto-calculated pricing** — base price is displayed per venue for reference. Final price is confirmed by admin post-booking. A pricing engine (day-of-week, service multipliers) is a v2 feature.
- **Airbnb API integration** — partner Airbnb listings link out to the external Airbnb listing. No calendar sync, no API handshake. Manual coordination stays as-is.
- **Image uploads via the app** — venue images are uploaded directly to Supabase Storage by the developer/admin outside the app UI. An admin image uploader is a v2 feature.
- **Customer accounts / booking history** — customers continue to book as guests. Auth is admin-only.

---

## Venue Types

Three venue types drive different booking flows. Everything in this spec branches on `venue.type`.

| Type | Who controls it | Booking flow |
|---|---|---|
| `self_managed` | The Picnic Story | Browse → Venue page → Book Now → Form |
| `partner_bnb` | Third-party Airbnb host | Browse → Venue page → Book on Airbnb (external) → Book Our Services → Form |
| `custom` | The customer | "Your own space" card → Form with free-text address field |

---

## User Stories

### Customer — Browsing

- As a customer, I want to browse all available venues in a visual gallery so that I can find a space that fits my vibe before committing to an enquiry.
- As a customer, I want to see venue photos, capacity range, and location at a glance on the gallery card so that I can shortlist without clicking into each venue.
- As a customer, I want to see a clearly marked "Your own space" option in the gallery so that I know I can book The Picnic Story's services at my own terrace, park, or booked space.

### Customer — Venue Detail

- As a customer browsing a self-managed venue, I want to see full photos, a description, capacity, and a "Book Now" button so that I can move to the booking form with confidence.
- As a customer browsing a partner Airbnb, I want to clearly understand that I need to book the property on Airbnb first, and then book The Picnic Story's services separately, so that I'm not confused about the two-step process.
- As a customer who has already booked a partner Airbnb, I want a simple way to add The Picnic Story's picnic setup as a service, with an optional field to enter my Airbnb booking reference, so that the admin can coordinate with the host.

### Customer — Booking Form

- As a customer with a custom venue, I want to describe my space (address or description) in a free-text field so that the admin understands where they'll be setting up.
- As a customer, I want the booking form to already know which venue I selected so that I don't have to re-enter it.
- As a customer, I want to submit a booking enquiry and receive a clear confirmation that the team will contact me within 24 hours.

### Admin

- As an admin, I want to add new venues with name, type, description, capacity, base price, and image URLs so that new venues go live without a code deploy.
- As an admin, I want to activate or deactivate venues so that unavailable or seasonal venues are hidden from customers without deleting their data.
- As an admin, I want to see the venue name and type on each incoming booking in the admin dashboard so that I can respond with venue-specific information immediately.
- As an admin, I want to see the Airbnb booking reference (if provided) on partner Airbnb bookings so that I can coordinate with the host before confirming.

---

## Requirements

### P0 — Must Have (v1 cannot ship without these)

**Venue Gallery**
- [ ] Home page displays a venue gallery section with one card per active venue
- [ ] Each card shows: primary image, venue name, venue type badge, capacity range, location/area
- [ ] "Your own space" appears as the last card in the gallery with a distinct visual treatment (no photo required, uses an illustration or pattern)
- [ ] Gallery is responsive — 3 columns desktop, 2 tablet, 1 mobile
- [ ] Inactive venues (`is_active = false`) are hidden from customers

**Venue Detail Page**
- [ ] Clicking a venue card navigates to a venue detail page (client-side routing via `showPage()`)
- [ ] Detail page shows: image gallery/carousel, venue name, type, full description, capacity min–max, base price (labeled "Starting from ₹X"), location area
- [ ] **Self-managed:** single "Book Now" CTA → opens booking form pre-filled with `venue_id`
- [ ] **Partner Airbnb:** two CTAs — primary "Book on Airbnb →" (external link, opens in new tab) + secondary "Already booked? Book our services →" → booking form
- [ ] **Custom ("Your own space"):** clicking card goes directly to booking form with venue type = custom, no venue detail page needed

**Booking Form Updates**
- [ ] `venue_id` is passed silently to the form and submitted with the booking (customer doesn't select venue again)
- [ ] For `partner_bnb` bookings: optional "Airbnb booking reference" text field (labeled "Airbnb confirmation number (optional)")
- [ ] For `custom` bookings: required "Venue address / description" free-text field
- [ ] Form validation: custom venue requires address field; partner Airbnb reference is truly optional
- [ ] Success confirmation page remains unchanged

**Database**
- [ ] `venues` table created with all required fields (see Data Model)
- [ ] `bookings` table updated: `location` text column replaced by `venue_id` FK (nullable) + `venue_address` text (nullable) + `external_booking_ref` text (nullable)
- [ ] RLS policies on `venues`: anon can SELECT active venues; authenticated (admin) has full CRUD
- [ ] Admin can insert/update venues via Supabase dashboard (no admin UI in-app for v1)

**Admin Dashboard**
- [ ] Booking cards in the Queries and Bookings tabs display venue name and type (not raw `venue_id`)
- [ ] Partner Airbnb bookings display `external_booking_ref` if present
- [ ] Custom venue bookings display `venue_address`

---

### P1 — Nice to Have (high-priority fast follows)

- [ ] Image carousel on venue detail page (multiple photos, swipeable on mobile)
- [ ] Venue filter/sort on gallery (by type, by capacity)
- [ ] Admin venue management UI in the dashboard (add/edit/deactivate venues without Supabase dashboard)
- [ ] Smooth page transitions when navigating venue → detail → form
- [ ] "Back to venues" breadcrumb navigation on detail and form pages
- [ ] Venue card hover animation (subtle lift/shadow effect, consistent with boho aesthetic)

---

### P2 — Future Considerations (design now, build later)

- **Availability calendar** — `venue_id` + `date` blocking table. Schema supports this; no UI in v1. Design the venues table with this in mind (don't store availability in the venue row).
- **Pricing engine** — `venue_pricing` table with day-of-week, season, and package multipliers. `base_price` in venues table is the hook for this.
- **Admin image uploader** — file upload in admin dashboard writes to Supabase Storage, stores URL in `venues.images` jsonb array.
- **Venue reviews / testimonials** — customer-submitted testimonials linked to `venue_id`, displayed on venue detail page.
- **Multi-city support** — `city` field already in venues table. Filter by city when inventory expands beyond Jaipur.

---

## Data Model

### New: `venues` table

```sql
venues (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             text NOT NULL,
  type             text NOT NULL CHECK (type IN ('self_managed', 'partner_bnb', 'custom')),
  description      text,
  area             text,                        -- e.g. 'Near Nahargarh', 'Civil Lines'
  city             text NOT NULL DEFAULT 'Jaipur',
  capacity_min     integer CHECK (capacity_min >= 1),
  capacity_max     integer CHECK (capacity_max >= capacity_min),
  base_price       numeric(10,2),               -- display only; not auto-calculated
  images           jsonb NOT NULL DEFAULT '[]', -- array of public image URLs
  external_url     text,                        -- Airbnb listing URL for partner_bnb type
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
)
```

### Updated: `bookings` table changes

```sql
-- Remove:  location text
-- Add:
venue_id             bigint REFERENCES venues(id) ON DELETE SET NULL,  -- null for custom
venue_address        text,    -- required when venue_id is null (custom flow)
external_booking_ref text,    -- optional Airbnb confirmation number for partner_bnb
```

---

## Acceptance Criteria — Critical Paths

**Happy path: self-managed venue booking**
- Given a customer on the home page
- When they click a self-managed venue card
- Then they see the venue detail page with a "Book Now" button
- When they click "Book Now"
- Then the booking form opens with the venue pre-selected (not editable by customer)
- When they submit the form
- Then the booking is created with the correct `venue_id` and the success page is shown

**Happy path: partner Airbnb booking**
- Given a customer on a partner Airbnb venue detail page
- When they click "Book on Airbnb →"
- Then the Airbnb listing opens in a new tab (app stays open)
- When they return and click "Already booked? Book our services →"
- Then the booking form opens with an optional "Airbnb confirmation number" field
- When they submit with or without the reference number
- Then the booking is created and the admin can see the reference if provided

**Happy path: custom venue booking**
- Given a customer who clicks "Your own space" in the gallery
- When the booking form opens
- Then the venue address field is visible and marked required
- When they submit without filling the address
- Then form validation prevents submission with a clear error
- When they fill all required fields and submit
- Then the booking is created with `venue_id = null` and `venue_address` populated

**Admin dashboard**
- Given the admin is logged in and views the Queries tab
- When a booking with a partner Airbnb venue is shown
- Then the venue name, type badge, and Airbnb reference (if provided) are all visible on the card

---

## Success Metrics

| Metric | Type | Target | Measured at |
|---|---|---|---|
| Booking form submission rate | Leading | +20% vs. current baseline | 30 days post-launch |
| Venue-related admin follow-up messages per booking | Leading | <1 per booking | 30 days post-launch |
| Venue detail page → form start rate | Leading | >60% | 30 days post-launch |
| Partner Airbnb "already booked" flow usage | Leading | Establish baseline | 30 days post-launch |
| Custom venue booking volume | Leading | Establish baseline | 30 days post-launch |
| Overall booking enquiry volume | Lagging | +30% vs. pre-launch avg | 90 days post-launch |

---

## Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| 1 | Should inactive venues be visible to admin in the dashboard for reference, or fully hidden everywhere? | Product | No |
| 2 | What's the copy for the "Your own space" card — tagline, illustration, or just a text card? | Design/Product | No — can ship with placeholder |
| 3 | For partner Airbnb venues, should the Airbnb listing URL open on click of the venue card, or only on the venue detail page? | Product | Yes — affects card component |
| 4 | Is `base_price` shown as "Starting from ₹X" or "From ₹X/session"? What unit? | Product | No |
| 5 | Do partner Airbnb venues need a different card badge colour vs. self-managed in the gallery, or just the same "Partner Property" text label? | Design | No |

---

## Timeline Considerations

- **Dependency:** Venues table must be created and seeded with initial venue data before frontend work can be tested end-to-end. SQL migration is the first deliverable.
- **Dependency:** At least 2–3 real venue photos needed per venue before the gallery is meaningful. Placeholder images will be used during development.
- **No hard deadline identified** — ship when stable. Suggested phase sequence:
  1. Schema migration + seed data
  2. Venue gallery on home page
  3. Venue detail pages (self-managed first, then partner Airbnb)
  4. Booking form updates
  5. Admin dashboard updates
  6. "Your own space" custom flow (can be phase 2 if needed to hit a date)
