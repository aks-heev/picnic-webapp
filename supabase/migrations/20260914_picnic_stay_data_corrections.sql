-- Data corrections applied 2026-09-14 via execute_sql during the picnic_stay session.
-- Written here so the repo matches production (CLAUDE.md §4: apply_migration AND a repo file).
-- These are idempotent and safe to re-run.
--
-- CONTEXT: only ONE picnic_stay exists in the whole table. Two other bookings were wrongly
-- suspected and are recorded here so nobody re-litigates them:
--   153 - TerraCottage Umber, 16,900 against a 10,900 nightly rate. The 6,000 gap was flagged
--         as a possible picnic by a price-gap heuristic. WRONG, confirmed by Aksheev. The gap
--         is unexplained but is not a picnic. Left as 'stay'. Do not "fix" it.
--   172 - Countryside Offgrid, 19-20 Sep, 5,900. A picnic AT the stay property with NO stay
--         sold. It only carried a checkout_date because, before venue 27 existed, the stay row
--         was the only place to record it.
--
-- 🔴 LESSON (worth keeping): checkout_date being present says NOTHING about whether a stay was
-- sold at a partner_bnb venue. That heuristic is what misclassified 172 and is precisely why
-- booking_kind had to become an explicit column rather than an inference.

-- 172: picnic only. Aksheev separately moved it onto venue 27 (the picnic twin) via the admin
-- UI, clearing checkout_date and setting time_slot 'evening' 18:00-20:30.
UPDATE public.bookings
SET booking_kind  = 'picnic',
    picnic_amount = coalesce(total_amount, 0),
    stay_amount   = 0
WHERE id = 172;

-- 165: the one real picnic_stay. Countryside Offgrid, 20-21 Sep, total 21,900.
-- Split given by Aksheev 2026-09-14, from the actual sale:
--   photographer add-on 6,000 + setup 8,900 + stay 7,000 = 21,900
-- The 8,900 matches The Setting package price.
--
-- 🔴 The components are a RATIO, not final revenue - total_amount is authoritative because it
-- is negotiated. booking_revenue_split carves the add-on to the picnic side first, then splits
-- the remaining 15,900 by 8,900:7,000, yielding picnic_revenue 14,900 / stay_revenue 7,000.
--
-- 🔴 DO NOT derive this split from compute_booking_total. The pricing function reproduces the
-- TOTAL to within 100 (21,800 vs 21,900) but gets the COMPONENTS wrong - it predicts
-- 5,900 picnic / 9,900 stay, which would understate picnic revenue by ~3,000 and feed a wrong
-- MER. Hand-entered totals must have their split taken from whoever sold the booking.
UPDATE public.bookings
SET picnic_amount = 8900,
    stay_amount   = 7000
WHERE id = 165;

-- VERIFICATION (run after applying):
--   select booking_kind, count(*), count(*) filter (where split_unknown) as unknown,
--          round(sum(picnic_revenue)) as picnic_rev, round(sum(stay_revenue)) as stay_rev
--   from booking_revenue_split where excluded_reason is null and confirmed group by 1;
--   -> picnic 20 (0 unknown) 2,61,752 / 0
--      picnic_stay 1 (0 unknown) 14,900 / 7,000
--      stay 36 (0 unknown) 0 / 3,61,909
--
--   select count(*) from booking_revenue_split
--   where not split_unknown
--     and round(coalesce(picnic_revenue,0)+coalesce(stay_revenue,0),2)
--         is distinct from round(coalesce(total_amount,0),2);
--   -> 0
