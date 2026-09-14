-- Phase 4: one canonical definition of "how much of this booking was picnic revenue".
--
-- Ads run on picnic only, never on stay, so ad-efficiency math (MER, cost per picnic booking)
-- needs this split. Putting it in a view means the dashboard and admin cannot drift apart by
-- each re-deriving it.
--
-- SPLIT RULES (decided by Aksheev, 2026-09-11/14):
--   picnic      -> the whole total is picnic revenue
--   stay        -> the whole total is stay revenue
--   picnic_stay -> add-ons are carved to the picnic side FIRST (they are pass-through vendor
--                  cost and must not absorb a discount), then the remaining negotiated amount
--                  is split by the picnic_amount : stay_amount RATIO. The components are a
--                  ratio, not final rupees, because total_amount is negotiated independently.
--   picnic_stay with no split recorded -> revenue is NULL, not a guess. split_unknown flags it
--                  so the dashboard can show it in its own bucket rather than distorting MER.
--
-- Negative discount_amount means a surcharge, but this reads total_amount directly, so the
-- sign resolves itself - no special handling needed.
--
-- security_invoker=true so the view respects the RLS on bookings instead of bypassing it
-- with the view owner's rights. Verified with get_advisors: no security_definer_view finding.

CREATE OR REPLACE VIEW public.booking_revenue_split
WITH (security_invoker = true) AS
SELECT
  b.id,
  b.created_at,
  b.created_at::date            AS booked_on,
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

  -- true when a picnic_stay has no usable split yet: revenue is unknown, not zero
  (b.booking_kind = 'picnic_stay'
     AND coalesce(b.picnic_amount,0) + coalesce(b.stay_amount,0) = 0) AS split_unknown,

  -- standing exclusions live here so every consumer applies them identically
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
  'Canonical picnic/stay revenue split. Consumers (Meta ads dashboard, admin) must read picnic_revenue from here rather than re-deriving it. Filter: excluded_reason IS NULL AND confirmed. split_unknown=true means a picnic_stay has no split recorded and its revenue is unknown, not zero.';

-- VERIFIED AFTER APPLYING (2026-09-14), confirmed rows only, exclusions applied:
--   picnic       20 rows  picnic_rev 2,61,752  stay_rev 0        total 2,61,752
--   stay         36 rows  picnic_rev 0         stay_rev 3,61,909 total 3,61,909
--   picnic_stay   1 row   picnic_rev NULL      stay_rev NULL     total   21,900  (split_unknown)
--   rows where picnic_revenue + stay_revenue <> total_amount (excluding unknown): 0
--
-- OLD vs NEW dashboard filter over 180d:
--   OLD (checkout_date IS NULL): 20 bookings, 2,61,752
--   NEW (this view):             21 bookings, 2,61,752
--   The extra row is booking 165, a real picnic+stay that the old filter discarded entirely.
--   Revenue is unchanged only because 165's split is still unrecorded.
