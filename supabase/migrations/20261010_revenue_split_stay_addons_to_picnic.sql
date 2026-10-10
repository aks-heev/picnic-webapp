-- Stay-only + Celebration Stay (2026-10-10). APPLIED live 2026-10-10 via apply_migration.
-- TerraCottage stays will be sold stay-only, with the celebration setup sold as add-ons
-- on the stay venue (booking_kind stays 'stay'). Before this change, a 'stay' booking put its
-- ENTIRE total into stay_revenue, so setup add-ons would have been counted as stay revenue.
-- Now, for 'stay', add-ons are carved to the picnic side, the same rule picnic_stay already uses
-- (add-ons are celebration/vendor items, never accommodation).
-- Historical effect: zero. Read-only dry run on 2026-10-10: 139 rows, 0 changed
-- (no 'stay' booking has any booking_add_ons row yet).
-- Only the two 'stay' branches differ from 20260923_booking_revenue_split_add_city.
create or replace view public.booking_revenue_split
with (security_invoker = true) as
 SELECT b.id,
    b.created_at,
    (b.created_at AT TIME ZONE 'Asia/Kolkata'::text)::date AS booked_on,
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
            WHEN 'picnic'::text THEN COALESCE(b.total_amount, 0::numeric)
            WHEN 'stay'::text THEN LEAST(a.addons, COALESCE(b.total_amount, 0::numeric))
            WHEN 'picnic_stay'::text THEN
            CASE
                WHEN (COALESCE(b.picnic_amount, 0::numeric) + COALESCE(b.stay_amount, 0::numeric)) > 0::numeric THEN a.addons + (COALESCE(b.total_amount, 0::numeric) - a.addons) * (b.picnic_amount / (b.picnic_amount + b.stay_amount))
                ELSE NULL::numeric
            END
            ELSE NULL::numeric
        END AS picnic_revenue,
        CASE b.booking_kind
            WHEN 'picnic'::text THEN 0::numeric
            WHEN 'stay'::text THEN COALESCE(b.total_amount, 0::numeric) - LEAST(a.addons, COALESCE(b.total_amount, 0::numeric))
            WHEN 'picnic_stay'::text THEN
            CASE
                WHEN (COALESCE(b.picnic_amount, 0::numeric) + COALESCE(b.stay_amount, 0::numeric)) > 0::numeric THEN (COALESCE(b.total_amount, 0::numeric) - a.addons) * (b.stay_amount / (b.picnic_amount + b.stay_amount))
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
        END AS excluded_reason,
    v.city AS venue_city,
        CASE
            WHEN v.city = 'Jaipur'::text THEN 'jaipur'::text
            ELSE 'gurugram'::text
        END AS city
   FROM bookings b
     LEFT JOIN venues v ON v.id = b.venue_id
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(x.price_at_booking), 0::numeric) AS addons
           FROM booking_add_ons x
          WHERE x.booking_id = b.id) a ON true;
