-- Monthly occupancy for active self_managed venues (TerraCottage Umber/Ochre).
-- Formula (per Aksheev, 2026-09-22 brainstorm):
--   occupancy_pct = nights_booked / active_days, per venue per month
--   active_days   = calendar days since the venue went live, capped at CURRENT_DATE
--                   (venues.created_at is used as the "went live" proxy since
--                    is_active has no history -- see CLAUDE.md Countryside Offgrid
--                    precedent: activated well after its row was created)
--   nights_booked = distinct nights covered by CONFIRMED bookings with
--                    booking_kind IN ('stay','picnic_stay'), counted as
--                    [preferred_date, checkout_date) -- i.e. a booking with
--                    no matching row on a given day counts as empty, per Aksheev:
--                    "if there's a booking in the database, count it as occupied,
--                    if there's no booking for a day, count it as empty."
--
-- security_invoker = true so the view respects RLS on bookings/venues, matching
-- the booking_revenue_split pattern from 20260914_booking_revenue_split_view.

CREATE OR REPLACE VIEW public.monthly_occupancy_self_managed
WITH (security_invoker = true) AS
WITH self_managed_venues AS (
  SELECT id, name, created_at::date AS active_since
  FROM venues
  WHERE type = 'self_managed' AND is_active = true
),
calendar AS (
  SELECT v.id AS venue_id, v.name AS venue_name, d::date AS day
  FROM self_managed_venues v
  CROSS JOIN LATERAL generate_series(v.active_since, CURRENT_DATE, interval '1 day') AS d
),
booked AS (
  SELECT
    c.venue_id,
    c.venue_name,
    c.day,
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.venue_id = c.venue_id
        AND b.confirmed = true
        AND b.booking_kind IN ('stay','picnic_stay')
        AND b.checkout_date IS NOT NULL
        AND c.day >= b.preferred_date
        AND c.day < b.checkout_date
    ) AS is_booked
  FROM calendar c
)
SELECT
  venue_id,
  venue_name,
  date_trunc('month', day)::date AS month,
  COUNT(*) AS active_days,
  COUNT(*) FILTER (WHERE is_booked) AS nights_booked,
  ROUND(COUNT(*) FILTER (WHERE is_booked)::numeric / COUNT(*) * 100, 1) AS occupancy_pct
FROM booked
GROUP BY venue_id, venue_name, date_trunc('month', day)
ORDER BY venue_id, month;

COMMENT ON VIEW public.monthly_occupancy_self_managed IS
'Monthly occupancy for active self_managed venues (TerraCottage). active_days = calendar days since venue.created_at (proxy for listing-live date, since is_active has no history), capped at CURRENT_DATE so the current partial month is not penalized. nights_booked = distinct nights covered by confirmed bookings with booking_kind IN (stay, picnic_stay), counted [preferred_date, checkout_date). occupancy_pct = nights_booked / active_days * 100.';
