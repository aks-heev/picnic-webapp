-- Fix: for a Cancelled booking, total_amount stays at the pre-cancellation quote even after a
-- refund (refunds reduce advance_amount instead, per admin_close_booking's design: see
-- 20260824_admin_close_booking_amount_received.sql). booking_revenue_split was using
-- total_amount as the revenue basis for every row, so a cancelled booking with a full refund
-- (advance_amount=0) was still counted as full revenue, and a partial refund understated the
-- refund and overstated revenue. Found 2026-09-22 while backfilling booking 207
-- (HM34J5JC5W, cancelled Airbnb reservation, advance_amount=total_amount so unaffected by
-- this fix). Confirmed live before fix: booking 155 (Mangesh, total 16,655.22, advance 0.00,
-- "cancelled by guest") showed stay_revenue 16,655.22, should be 0. Booking 192 (aaradhy, total
-- 7,400, advance 2,000.00, "guest didn't show up") showed picnic_revenue 7,400 -- this one feeds
-- the Meta ads dashboard since ads run on picnic only -- should be 2,000.
--
-- Fix: use advance_amount as the revenue basis when booking_status='Cancelled', total_amount
-- otherwise. No column added/removed/retyped; security_invoker=true preserved (get_advisors
-- clean, no security_definer_view finding, checked 2026-09-22).
--
-- Verified after apply: 155 -> stay_revenue 0.00, 192 -> picnic_revenue 2000.00, 207 unchanged
-- at 1671.12. Total picnic_sum 635,662.999... / stay_sum 477,427.75 across 104 rows post-fix.

CREATE OR REPLACE VIEW public.booking_revenue_split
WITH (security_invoker = true) AS
SELECT
  b.id,
  b.created_at,
  (b.created_at AT TIME ZONE 'Asia/Kolkata')::date AS booked_on,
  b.confirmed,
  b.booking_kind,
  b.venue_id,
  v.name AS venue_name,
  v.type AS venue_type,
  b.total_amount,
  a.addons,
  b.picnic_amount,
  b.stay_amount,
  CASE b.booking_kind
    WHEN 'picnic' THEN COALESCE(rb.basis, 0::numeric)
    WHEN 'stay' THEN 0::numeric
    WHEN 'picnic_stay' THEN
      CASE
        WHEN (COALESCE(b.picnic_amount, 0::numeric) + COALESCE(b.stay_amount, 0::numeric)) > 0::numeric
          THEN a.addons + (COALESCE(rb.basis, 0::numeric) - a.addons) * (b.picnic_amount / (b.picnic_amount + b.stay_amount))
        ELSE NULL::numeric
      END
    ELSE NULL::numeric
  END AS picnic_revenue,
  CASE b.booking_kind
    WHEN 'picnic' THEN 0::numeric
    WHEN 'stay' THEN COALESCE(rb.basis, 0::numeric)
    WHEN 'picnic_stay' THEN
      CASE
        WHEN (COALESCE(b.picnic_amount, 0::numeric) + COALESCE(b.stay_amount, 0::numeric)) > 0::numeric
          THEN (COALESCE(rb.basis, 0::numeric) - a.addons) * (b.stay_amount / (b.picnic_amount + b.stay_amount))
        ELSE NULL::numeric
      END
    ELSE NULL::numeric
  END AS stay_revenue,
  b.booking_kind = 'picnic_stay'::text AND (COALESCE(b.picnic_amount, 0::numeric) + COALESCE(b.stay_amount, 0::numeric)) = 0::numeric AS split_unknown,
  CASE
    WHEN COALESCE(b.mobile_number, ''::text) ~~ '%7742363777%'::text THEN 'team_phone'::text
    WHEN COALESCE(b.mobile_number, ''::text) ~~ '%7425055501%'::text THEN 'team_phone'::text
    WHEN COALESCE(b.full_name, ''::text) ~~* 'Test%'::text THEN 'test_name'::text
    ELSE NULL::text
  END AS excluded_reason
FROM bookings b
LEFT JOIN venues v ON v.id = b.venue_id
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(x.price_at_booking), 0::numeric) AS addons
  FROM booking_add_ons x
  WHERE x.booking_id = b.id
) a ON true
LEFT JOIN LATERAL (
  SELECT CASE WHEN b.booking_status = 'Cancelled' THEN COALESCE(b.advance_amount, 0::numeric) ELSE b.total_amount END AS basis
) rb ON true;
