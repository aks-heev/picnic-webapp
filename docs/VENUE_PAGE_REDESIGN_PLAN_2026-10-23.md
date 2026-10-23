# Venue page redesign — build plan (2026-10-23)

Design: the "Venue Page Redesign" canvas (desktop, phone, phone package sheet), approved by Aksheev 2026-10-23
("looks good"; "₹3,100 of extras" line removed). Code lives in `app.js` `renderVenueDetail()` (~L1104–1500),
`style.css` `.vd-*` rules (261 selectors), `scripts/prerender-venues.mjs` (SEO pre-content, untouched).

## 0. Done means
- Every venue type still books end to end: cafe + packages (Beige, Countryside picnic), cafe without packages,
  partner_bnb (Airbnb two-step), self_managed / combo stays, stay-only cottages, custom.
- No fact on the page that the data can't back: prices, guest counts, food items, slots all read from the DB / TIME_SLOTS.
- Desktop 1366 and phone 390 checked in `npm run preview` + one real phone, per phase.
- Each phase is one commit and can be reverted alone. No DB schema change.

## 1. Phases, in shipping order

### P1 — Facts strip + title block (fixes wrong information; smallest)
- Price fact: rupee glyph, not the `$` icon. Value = lowest no-food package price at the venue when
  `packageFlowActive`, else `base_price` (as today). Sub-line names it ("The Prelude, up to 4 guests").
- Guests fact: `capacity_min`–`capacity_max`, sub-line "N included, then ₹X each" from the cheapest
  non-capped `venue_packages` row (included_guests / overage_per_person). Packages off → today's text.
- Replace "7 days a week" with time slots from `TIME_SLOTS` ("3 hours each · 9–12 · 1–4 · 5–8").
- Food fact only when the venue has with-food price rows ("Optional add · from the café menu").
- Layout: one horizontal row (4 cells) on desktop, 2×2 on phone (today it stacks vertically).
- Title block: eyebrow (type · area, city), H1, one-line pitch, rating chip "★ 4.6 · 7 guest reviews"
  filled by `fillVenueReviews()` from the same query it already runs (hidden when 0 reviews).
- Description: shown open (drop the accordion). Clamp to ~4 lines with "Read more" only if longer.
- Feature chips (pet-friendly etc.): read from `venues.metadata.highlights` — render nothing until set.
  Nothing is inferred from the description text.

### P2 — "Packages here" section + package details sheet (cafe + packages only)
- Await `loadPackages()` before render when `packageFlowActive(venue)` (today it isn't awaited on this page).
- Cards: name, tagline, no-food price, "With food: ₹Y · N items" for 2 guests (package_prices + food_items).
  No strike-through price here (as on the canvas); the package step keeps its current display.
- Tap a card → details: bottom sheet on phone, centred dialog on desktop. Contents:
  - photo (package carousel image if any, else venue photo — own package photos are a Todoist task)
  - both prices; guest rule; with-food price at 6 guests
  - "Everything in <prev>, plus:" extras as tiles (icon, name, "₹X if added" from the venue add-on catalog);
    The Prelude shows its own `inclusions` list
  - base setup collapsed (`venueSetupLabels(venue)`), 3-hour slot line
  - ‹ prev / next › package links; CTA "Choose <name> — Next: pick your date"
- CTA sets `appState.pendingPackage = {venueId, tierKey}` and scrolls to the calendar. The existing
  brochure-entry path then does the rest (incl. the single-card food step) — no new booking logic.
- Dialog a11y: focus moves in and is trapped, Esc and the back button close it (pushState), focus returns.
- Track `package_details_opened`, `package_details_chosen`.

### P3 — Add-ons, compact (removes ~1,800px)
- Desktop: grouped price lists in cards (Decor / Experiences / Food & time), "On request" tag kept.
- Phone: one collapsed `<details>` per group with "N items, ₹min–max".
- Drop the emoji category labels. Menu link moves into the Food group card; menu viewer unchanged.

### P4 — Gallery mosaic (desktop) 
- ≥1024px: one large + 2×2 grid with "All N photos" button opening the existing image viewer/slider.
- Phone: keep today's swipe slider (counter "1 / N" instead of dots).

### P5 — Booking card copy + info cards
- Card header "Packages from ₹X for up to N guests"; reassurance: 30% advance locks the date, setup/styling/
  cleanup, personal host; WhatsApp link.
- "How booking works" (3 steps + advance/postponement line) and "Where it is" (directions link) cards.
- Out of scope: the compact date/guests/slot form shown on the canvas — that rewrites the calendar flow;
  separate plan if wanted.

### P6 — Doodles + bunting
- One CSS layer: line doodles as CSS background images in the side margins, only ≥1320px; on phone one
  doodle beside each section heading via `h2::after`. `aria-hidden`, no extra DOM per doodle.
- Bunting strip under the nav. Match or replace the existing occasion-chip doodle style — one style site-wide.

## 2. Risks
- Other venue types: every new block is gated (`packageFlowActive`, `stayOnlyActive`, type checks);
  P1–P6 each re-checked on one venue of every type.
- `prerender-venues.mjs` swaps its SEO content out when the first `vd-` element appears — new markup keeps `vd-` classes.
- Sticky mobile bar + bottom sheet both at the bottom: sheet sits above the bar and hides it while open.
- Package step uses the 40% strike-through; venue page won't. Decide later whether to align them.

## 3. Open (Aksheev)
- Is "up to 30 guests" true for a picnic setup at Beige Cafe? If not, set capacity_max or show "N included" only.
- Fill `metadata.highlights` per venue (pet-friendly, poolside seating, …) — only true ones.
- Is "Most picked" (packages.is_featured) backed by bookings? Can be checked from bookings by package_key.

## 4. Progress
- P1 built 2026-10-23: facts card (data-driven), description open with Read more. Rating chip held — public_reviews()
  filters by min rating, so its average would be inflated; needs an all-reviews stats RPC.
- P2 + P2b built 2026-10-23: "Packages here" cards, package details dialog (desktop) / bottom sheet (phone),
  phone date/slot/guests sheet for picnic (cafe) venues — the booking card becomes the sheet; it hands back to the
  page at the package step / form / intent. Stays and partner_bnb keep the old layout. Floating WhatsApp button
  lifted above the phone booking bar. Verified desktop 1366 + phone 375 on Beige, Countryside picnic, Sunroom,
  House of Amer, TerraCottage Umber, brochure path. Events: package_details_opened, package_details_chosen,
  check_dates_opened.
- Known gaps: phone back button doesn't close the sheets (no history entry); the sheet keeps the existing two
  screens (calendar+slot, then guests) rather than the canvas's single screen.
- Booking form redesign built 2026-10-23 (canvas "Booking Form Redesign"): summary card right on desktop with
  "Pay now · 30% advance" / "On the day"; package card + full contents; extras as one collapsible panel of photo
  cards with category chips; occasion chips; board as 3-way choice (included · optional on Setting/Moment/Story,
  white-only paid on Prelude — 2026-10-11 rule kept); WhatsApp +91 field. The "You're almost there!" intent screen
  is skipped: "Continue to payment" → Razorpay, "Continue on WhatsApp" → lead captured (whatsapp_clicked) + wa.me;
  request-only venues (combo / requires_confirmation) keep one "Send a request". Fixed: "Change date" lost
  name/email/add-ons (wrong field names). Doodles: side-margin layer >=1440px on venue + form pages, basket in
  the summary card corner, sprig by "Add extras". Test leads 300 (lock) and 301 (WhatsApp) to delete.
