-- booked_on must be an IST calendar date, not a UTC one.
--
-- WHY: the business runs in IST. `created_at::date` is UTC, so any booking placed between
-- 00:00 and 05:30 IST falls on the PREVIOUS day's bar in the Meta ads dashboard. It also
-- disagreed with the Google Sheet sync, which already IST-shifts its `Booked On` column via
-- bookedOnDate() - so the sheet and the dashboard would report different days for the same
-- booking, and the sheet was the one that was right.
--
-- IMPACT WHEN APPLIED (2026-09-15): exactly ONE row in the whole table changes bucket -
-- booking 15 (Tanu, 2026-06-30 21:16 UTC -> 2026-07-01 IST), and it is unconfirmed so it never
-- reached the dashboard. Zero current numbers move. This is purely forward-looking correctness.
--
-- 🔴 Note booking 179 is NOT affected: 2026-09-14 18:07 UTC = 23:37 IST, the 14th either way.
-- The midnight-IST boundary is 18:30 UTC. This was raised as "a booking this morning is missing
-- from the chart" - it was not missing, it was last night's, and the admin card's relative
-- "8h ago" label made it read as today. Worth remembering before chasing a phantom bug again.
--
-- Everything else about the view is unchanged - see 20260914_booking_revenue_split_view.sql
-- for the split rules, the add-ons-first carve, split_unknown, and why security_invoker matters.

CREATE OR REPLACE VIEW public.booking_revenue_split
WITH (security_invoker = true) AS
SELECT
  b.id,
  b.created_at,
  (b.created_at AT TIME ZONE 'Asia/Kolkata')::date AS booked_on,
  b.confirmed,
  b.booking_kind,
  b.venue_id,
  v.name                        AS venue_name,
  v.type                        AS venue_type,
  b.total_amount,
  a.addons,
  b.picnic_amount,
  b.stay_amount,

  CASE b.booking_kind
    WHEN 'picnic' THEN coalesce(b.total_amount, 0)
    WHEN 'stay'   THEN 0
    WHEN 'picnic_stay' THEN
      CASE WHEN coalesce(b.picnic_amount,0) + coalesce(b.stay_amount,0) > 0
        THEN a.addons + (coalesce(b.total_amount,0) - a.addons)
             * (b.picnic_amount / (b.picnic_amount + b.stay_amount))
        ELSE NULL
      END
  END                           AS picnic_revenue,

  CASE b.booking_kind
    WHEN 'picnic' THEN 0
    WHEN 'stay'   THEN coalesce(b.total_amount, 0)
    WHEN 'picnic_stay' THEN
      CASE WHEN coalesce(b.picnic_amount,0) + coalesce(b.stay_amount,0) > 0
        THEN (coalesce(b.total_amount,0) - a.addons)
             * (b.stay_amount / (b.picnic_amount + b.stay_amount))
        ELSE NULL
      END
  END                           AS stay_revenue,

  (b.booking_kind = 'picnic_stay'
     AND coalesce(b.picnic_amount,0) + coalesce(b.stay_amount,0) = 0) AS split_unknown,

  CASE
    WHEN coalesce(b.mobile_number,'') LIKE '%7742363777%' THEN 'team_phone'
    WHEN coalesce(b.mobile_number,'') LIKE '%7425055501%' THEN 'team_phone'
    WHEN coalesce(b.full_name,'')     ILIKE 'Test%'       THEN 'test_name'
  END                           AS excluded_reason

FROM public.bookings b
LEFT JOIN public.venues v ON v.id = b.venue_id
LEFT JOIN LATERAL (
  SELECT coalesce(sum(x.price_at_booking), 0) AS addons
  FROM public.booking_add_ons x
  WHERE x.booking_id = b.id
) a ON true;

COMMENT ON VIEW public.booking_revenue_split IS
  'Canonical picnic/stay revenue split. Consumers (Meta ads dashboard, admin) must read picnic_revenue from here rather than re-deriving it. booked_on is an IST calendar date, matching the Google Sheet sync. Filter: excluded_reason IS NULL AND confirmed. split_unknown=true means a picnic_stay has no split recorded and its revenue is unknown, not zero.';

-- VERIFIED AFTER APPLYING (2026-09-15):
--   daily series for the last 5 active days: IDENTICAL to before the change
--   30-day picnic count (2026-08-17..2026-09-15): 12, unchanged
--   booking 179 booked_on: 2026-09-14, unchanged
--   rows where picnic_revenue + stay_revenue <> total_amount (excl. unknown): 0
--   all-time confirmed picnic revenue: 2,86,552 (= prior 2,76,652 + booking 179's 9,900)
