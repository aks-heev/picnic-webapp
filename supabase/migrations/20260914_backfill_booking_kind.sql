-- Phase 2: backfill booking_kind + split amounts for all existing rows.
--
-- Only ONE picnic_stay exists in the data and it must be set by ID, because nothing in the
-- row distinguishes it from a plain stay:
--   165 - Countryside Offgrid, 20-21 Sep, total 21,900, plus a 6,000 Photographer add-on.
--         Notes: "Picnic Setup for Proposal in front of cottage in the evening. Photographer.
--         Will you marry me? (White Board)". Confirmed by Aksheev to INCLUDE stay charges.
-- Its picnic/stay split is left NULL on purpose - it cannot be derived (the total was set
-- manually by an admin, so compute_booking_total cannot reproduce it) and guessing would
-- silently corrupt the exact metric this feature exists to produce.
--
-- NOT picnic_stay, despite looking like candidates:
--   172 - Countryside Offgrid, 19-20 Sep, 5,900. A picnic AT the stay property with NO stay
--         sold. checkout_date is set only because the venue is a stay property and the form
--         captures its dates; the money is picnic-only. Handled by the partner_bnb rule below.
--   153 - TerraCottage Umber, 16,900 against a 10,900 nightly rate. The 6,000 gap is NOT a
--         picnic; confirmed by Aksheev. Left as 'stay'.

UPDATE public.bookings b
SET booking_kind = 'picnic_stay'
WHERE b.id = 165;

-- Picnic venues: cafe (our picnic venues) and custom ("Your Own Space" - customer-supplied
-- location, still a picnic). Whole total is picnic revenue.
UPDATE public.bookings b
SET booking_kind  = 'picnic',
    picnic_amount = coalesce(b.total_amount, 0),
    stay_amount   = 0
FROM public.venues v
WHERE v.id = b.venue_id
  AND b.booking_kind IS NULL
  AND v.type IN ('cafe', 'custom');

-- partner_bnb: guest books the stay off-platform (Airbnb), we price the picnic setup only,
-- so the recorded total is picnic revenue. This correctly covers booking 172.
UPDATE public.bookings b
SET booking_kind  = 'picnic',
    picnic_amount = coalesce(b.total_amount, 0),
    stay_amount   = 0
FROM public.venues v
WHERE v.id = b.venue_id
  AND b.booking_kind IS NULL
  AND v.type = 'partner_bnb';

-- Stays: self_managed (ours) and combo (whole TerraCottage property, blocks its children).
-- NOTE: many of these totals are far below the nightly rate because they record only our cut
-- of an Airbnb-originated stay (e.g. booking 90: "Direct extension of Airbnb stay HM24QNCBZ8").
-- That is fine here - stay revenue is not used for ad math - but stay_amount is therefore NOT
-- comparable across rows.
UPDATE public.bookings b
SET booking_kind  = 'stay',
    stay_amount   = coalesce(b.total_amount, 0),
    picnic_amount = 0
FROM public.venues v
WHERE v.id = b.venue_id
  AND b.booking_kind IS NULL
  AND v.type IN ('self_managed', 'combo');

-- Last resort for any row with no venue row: fall back to the old shape inference.
UPDATE public.bookings b
SET booking_kind  = 'picnic',
    picnic_amount = coalesce(b.total_amount, 0),
    stay_amount   = 0
WHERE b.booking_kind IS NULL AND b.time_slot IS NOT NULL;

UPDATE public.bookings b
SET booking_kind  = 'stay',
    stay_amount   = coalesce(b.total_amount, 0),
    picnic_amount = 0
WHERE b.booking_kind IS NULL AND b.checkout_date IS NOT NULL;

-- VERIFICATION (run after applying):
--   select coalesce(booking_kind,'** NULL **'), count(*), count(*) filter (where picnic_amount is null)
--   from bookings group by 1;
--   -> picnic 43 (0 null) | stay 40 (0 null) | picnic_stay 1 (1 null, expected pending manual split)
--
--   select count(*) from bookings
--   where booking_kind <> 'picnic_stay'
--     and coalesce(picnic_amount,0)+coalesce(stay_amount,0) is distinct from coalesce(total_amount,0);
--   -> 0
