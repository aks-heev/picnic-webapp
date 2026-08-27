# Staff Payment Reconcile — Fix Plan  ·  SUPERSEDED, DO NOT BUILD

**Written 2026-08-27 · Superseded the same day. Kept only so the reasoning isn't rediscovered from scratch.**

This planned a `booking_event_log.reconciled_at` column plus a rewritten
`admin_apply_staff_payment` keyed to the log row, so that moving staff-collected
money into the books would be additive and idempotent.

**It was the wrong shape.** Aksheev's call, and it is the better one: staff only
*report* that they took payment. Nothing does arithmetic on that report, and no
second RPC writes `bookings.advance_amount`. The admin sets the final figures
once, at close.

That turned out to require deleting code rather than adding it, because
`admin_close_booking` **already** did the job properly — it snapshots
`quoted_total_amount` before overwriting, demands `close_notes` when the total
moves, sets `booking_status`, and releases `venue_availability`.
`admin_apply_staff_payment` was a second, weaker path to the same column with
none of that and with inverted arithmetic.

**What actually shipped, 2026-08-27:**

- `admin_apply_staff_payment` dropped — migration `20260827_drop_admin_apply_staff_payment.sql`.
- The Staff Ops "Record ₹X to booking" control, `sttApplyPayment` and the
  `needsReconcile` test removed from `app.js`. The staff *report* stays visible.
- The Close Booking form now prefills its balance-received field from the
  staff-logged amount, capped at what is actually outstanding, with the
  reporter's name and time shown beside it in both the owed and settled states.

No `reconciled_at` column was ever created. Nothing here is live.

**The incident that motivated it**: booking #100 was closed on 2026-08-24 with
₹5,000 recorded while staff had logged ₹6,900 collected that morning — the Close
form prefilled from the stale deposit and the staff report sat in a different
panel. Corrected 2026-08-27. That disconnect, not the arithmetic, was the real
defect.
