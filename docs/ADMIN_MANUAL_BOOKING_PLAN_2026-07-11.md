# Admin Manual Booking Entry — Plan (2026-07-11)

> **STATUS: SHIPPED 2026-07-14.** All four phases done and verified live (migration + RPC applied,
> notify fns v21/v30 deployed, frontend on disk verified + machine-parsed, live smoke test passed,
> test rows deleted). Remaining: user's browser/phone eyeball + commit. See CLAUDE.md 2026-07-14 handoff.

Plan-optimizer run: 81 → 90 → 91 (plateau). Decisions locked with user: guest-email toggle in form;
pricing prefilled from venue/package data but editable; "Airbnb" = direct/offline stays at our BnB
rooms (Airbnb-platform bookings stay with iCal sync); phone required, email optional.

## Goal

A phone-friendly "Add Booking" tab in admin.html that lets the team enter a confirmed offline
booking — picnic (cafe/custom, slot-based) or stay (self_managed/partner_bnb/combo, night-based) —
in under 60 seconds, with the same downstream effects as a site booking: calendar blocked on the
public site, stay dates exported to Airbnb via export-ical, correct emails, package snapshot intact.

**Done =** a picnic and a stay entered from a real phone; public calendar shows them blocked;
export-ical feed carries the stay; confirmation email received (and correctly suppressed when
toggled off); zero regression to the site booking flow.

## What already exists (grounded, verified this session)

- Inserting `bookings` with `confirmed=true` fires `on_booking_insert_confirmed` →
  notify-booking-confirmed (guest confirmation) AND `on_booking_insert_notify` →
  notify-booking-received, which **already skips the guest "pay advance" ack for confirmed rows**
  (index.ts ~L442-444) and sends the admin notice in "booking" variant. Email routing is right
  by default — only the suppress-toggle needs new code.
- Availability is computed live from `bookings` (`get_cafe_booked_slots`, `get_booked_dates`
  SECURITY DEFINER RPCs) — a confirmed row blocks the public calendar with **no extra writes**,
  except combo, which needs `source='parent'` fanout rows onto children (existing pattern in
  `confirmBooking`, app.js ~L6385-6407).
- export-ical exports confirmed bookings + admin blocks → a manual stay auto-propagates to Airbnb.
- RLS: `auth_insert_bookings` (authenticated, with_check true), `admin_all_booking_add_ons` and
  `admin_write_venue_availability` gated on `auth.email()='aksh.eeev@gmail.com'` — the logged-in
  admin can do everything needed; no service key in the client.
- `confirmBooking` already holds the authoritative conflict-check logic for all three venue shapes.

## Build order (each phase gated on verification before the next)

### Phase 1 — Migration `supabase/migrations/20260711_manual_booking.sql` (apply via MCP)

1. `bookings.email_address` → DROP NOT NULL.
2. New columns: `entry_source text not null default 'site' check (entry_source in ('site','admin'))`;
   `send_guest_email boolean not null default true`.
3. Widen `guest_count` check 1..20 → 1..100 (offline events exceed 20; site UI still caps 20
   client-side, `submit_booking_intent` unaffected).
4. **RPC `admin_add_manual_booking(p_booking jsonb, p_add_ons jsonb)`** — SECURITY INVOKER
   (deliberate: RLS admin policies enforce admin-only), one transaction:
   - Server-side conflict check (authoritative; client hints are UX only):
     cafe/custom → count confirmed bookings on (venue, date, slot) + admin blocks vs
     `max_concurrent_setups`; self_managed/partner_bnb → per-night occupancy vs capacity +
     admin/ical/parent blocks; combo → every child free every night.
     On conflict: `raise exception` with a human-readable message (client toasts it verbatim).
   - Insert booking (`confirmed=true`, `entry_source='admin'`, `customer_intent='lock'`,
     `payment_status='pending'` — 'paid' stays Razorpay-verified-only by design; advance lives in
     `advance_amount`). Package snapshot resolved server-side from `p_package_key` →
     `packages.name/tagline` (same pattern as `submit_booking_intent`).
   - Insert `booking_add_ons` rows (name + price_at_booking snapshot) **in the same transaction** —
     kills the email race where pg_net fires before a second client request lands the add-ons.
   - Combo → parent-fanout rows into `venue_availability` in the same transaction (idempotent,
     mirrors confirmBooking's block) — booking + blocks can't diverge on a mid-save network drop.
   - Return booking id. Grants: `authenticated` only (NOT anon/PUBLIC — unlike submit_booking_intent).
5. Audit null-email consumers before applying (email now nullable): notify-booking-confirmed
   (`to: record.email_address`, no guard — fixed in Phase 2), notify-booking-received (guest ack
   already skipped for confirmed rows; add guard anyway), post-event-nudge (check live source),
   admin cards/CSV export (render "—"), my-bookings OTP (phone-based, unaffected),
   `submit_booking_intent` email-match upsert (site always sends email, unaffected).
6. `get_advisors` after applying.

### Phase 2 — Edge functions (drift rule: fetch live via `get_edge_function`, edit that, deploy, then sync local)

- **notify-booking-confirmed**: skip guest send when `record.send_guest_email === false` OR
  `!record.email_address`; admin/team notice unchanged. Add "MANUAL ENTRY" badge line when
  `entry_source==='admin'` and show advance as "Advance recorded (offline)" so pending
  payment_status doesn't read as unpaid.
- **notify-booking-received**: same guard on the guest ack path (future-proofs unconfirmed manual
  leads); admin notice gains the same badge.
- Verify with the Node harness pattern (esbuild → stubbed Deno/fetch) before deploying: manual row
  with email+toggle-on, email+toggle-off, no-email; then one legacy site-shaped row to prove no
  regression.

### Phase 3 — Frontend (admin.html + app.js + style.css; user commits from own terminal per standing rule)

New "Add Booking" tab (first position after Queries; deep link `admin.html#add-booking` selects it
on load — Supabase session persists in localStorage so phone opens land straight on the form).

Form flow, single column, 44px+ targets, sticky Save button:

1. **Type toggle**: Picnic | Stay. Picnic → venues where type in (cafe, custom); Stay → type in
   (self_managed, partner_bnb, combo). (Note: fetchBookedData treats partner_bnb slot-based while
   confirmBooking treats it night-based — the form follows confirmBooking/nights; re-confirm against
   Countryside Offgrid's real usage during build.)
2. **Venue** select. If custom → free-text address (→ `venue_address`).
3. **Dates**: Picnic → date + slot chips (morning/afternoon/evening), taken slots disabled via
   existing `fetchBookedData` (hint only; RPC re-checks). Stay → check-in + check-out
   (`preferred_date`/`checkout_date`), nights count shown.
4. **Guests**: adults + children (stay + picnic both).
5. **Picnic extras**: package select from `venue_packages`×`packages` for that venue (incl.
   occasion packages, "No package" option) → sets package_key; add-ons checklist from
   `venue_add_ons` with prices; occasion select (reuse `OCCASIONS`); optional board (type+message).
6. **Stay extras**: optional `external_booking_ref` ("Reference"), add-ons checklist (stay-eligible
   add-ons via `available_for`).
7. **Contact**: name (required), phone (required, 10-digit validation), email (optional).
8. **Pricing**: Total prefilled — picnic w/ package: `venue_packages.price + max(0, guests −
   included_guests) × overage_per_person + Σ extras`; picnic no-package: `base_price` + venue
   overage fields + extras; stay: `base_price × nights + Σ add-ons`. Both Total and Advance
   received are editable (negotiated deals). Advance defaults to 0.
9. **"Send confirmation email to guest"** toggle — default ON, auto-disabled+OFF when email blank.
10. Save → `admin_add_manual_booking` RPC → success toast with booking id + jump to Bookings tab;
    RPC exception message toasted verbatim (conflicts read as "2026-07-14 evening already has 1/1
    setups").

No refactor of `confirmBooking` — it stays untouched (checks now also live server-side in the RPC,
which is authoritative for this flow). style.css: new `abk-` prefixed block, mobile-first.

### Phase 4 — Verification (gate before handing over commit block)

1. Local dev (`localhost:5173/admin.html`): picnic at Beige — happy path, then same slot again →
   conflict toast; stay at Umber spanning 3 nights; combo at Sienna → parent rows on Umber+Ochre
   confirmed via SQL; no-email entry; email+toggle-off entry.
2. Public site: Beige calendar shows slot taken; Umber dates blocked.
3. export-ical: `net.http_get` the Umber feed → manual stay dates present.
4. Emails: `get_logs` shows 200s; one real send to a `+smoketest` Gmail alias; confirm suppressed
   cases sent nothing (Resend log absence).
5. One REAL site booking smoke test (then delete) to prove zero regression to the site flow.
6. Delete all test rows (bookings, booking_add_ons, venue_availability parent rows).
7. Real-phone eyeball of the form (standing gap: no mobile-viewport tooling in sandbox).
8. `get_advisors` clean; user runs build + commits from own terminal (sandbox never commits app.js/
   style.css — torn-read rule).

## Risks & mitigations

- **Nullable email breaks an unaudited consumer** → Phase 1 step 5 audit is a hard gate; edge fns
  get explicit guards; post-event-nudge checked from live source.
- **RPC conflict logic diverges from JS logic** → RPC is authoritative for manual entries only;
  site flow unchanged; divergence surfaces as a false-block (safe direction), not a double-book.
- **Trigger emails fire before admin realizes a typo** → acceptable at current volume; fix path is
  the existing admin edit/delete + the toggle default choices.
- **Two admins save the same slot simultaneously** → server-side check inside one transaction
  narrows the window to ~0; residual race accepted (same as site flow today, volume ~0.7/day).
- **Rollback**: migration is additive (new cols default-safe; NOT NULL drop is one-line to restore
  after clearing nulls); edge fns redeploy from the pre-edit fetched source; frontend is one revert.

## Explicitly out of scope (parked)

Editing manual bookings after save (existing Bookings-tab flows), unconfirmed manual leads
("Save as query" — the RPC + email guards already make this a ~20-line follow-up), payment-method
field, menu-link generation for manual bookings, my-bookings visibility for null-email guests.
