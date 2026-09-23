-- Adds city to booking_revenue_split rather than creating a second view.
--
-- HOSTED_DASHBOARD_PLAN.md §5 proposed a new view, public.picnic_revenue_by_city_day, to
-- promote the Cowork artifact's inline city-bucketed query. Building it, the better move
-- turned out to be simpler: booking_revenue_split ALREADY joins venues (for venue_name /
-- venue_type), so the city bucket is two more columns on the existing join, not a second
-- view with a second venues join to keep in sync. One canonical booking-revenue definition
-- stays canonical. Deviation from the written plan, noted here per house convention.
--
-- venue_city is the raw column (Gurugram / Jaipur / Delhi). city is the bucket the Meta
-- Ads dashboards actually filter on: Delhi's one lifetime booking folds into 'gurugram'
-- because the only NCR ad campaign targets both — same rule the Cowork artifact's inline
-- SQL already used (cityOfCampaignName regex + this same case expression), now promoted
-- to one place instead of copy-pasted per consumer.
--
-- Row-level, not pre-aggregated by day — callers group/filter as needed, same as every
-- other consumer of this view does today. No new columns removed or reordered; both are
-- appended at the end so CREATE OR REPLACE VIEW doesn't break anything already reading
-- positionally (nothing does today, but the convention is worth keeping).

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
  END                           AS excluded_reason,

  v.city                        AS venue_city,
  CASE WHEN v.city = 'Jaipur' THEN 'jaipur' ELSE 'gurugram' END AS city

FROM public.bookings b
LEFT JOIN public.venues v ON v.id = b.venue_id
LEFT JOIN LATERAL (
  SELECT coalesce(sum(x.price_at_booking), 0) AS addons
  FROM public.booking_add_ons x
  WHERE x.booking_id = b.id
) a ON true;

COMMENT ON VIEW public.booking_revenue_split IS
  'Canonical picnic/stay revenue split. Consumers (Meta ads dashboards, admin) must read picnic_revenue from here rather than re-deriving it. booked_on is an IST calendar date, matching the Google Sheet sync. Filter: excluded_reason IS NULL AND confirmed. split_unknown=true means a picnic_stay has no split recorded and its revenue is unknown, not zero. city buckets venue_city into gurugram/jaipur for ad-spend-vs-bookings comparisons (Delhi folds into gurugram - the only NCR campaign targets both).';
