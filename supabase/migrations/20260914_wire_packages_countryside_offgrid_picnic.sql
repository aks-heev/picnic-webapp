-- Wire the package catalogue onto the Countryside Offgrid picnic venue (id 27) by mirroring
-- Beige Cafe (id 14). Both sit in Leopard Trail, Gurugram and share the same 5,900 base, so
-- the price ladder is the same. Confirmed by Aksheev 2026-09-14.
--
-- Copies price, included_guests, overage_per_person, max_guests and is_active verbatim.
-- Bundled add-ons ride along automatically: package_add_ons is keyed on package_id, not on
-- venue_packages, so compute_booking_total's v_bundled exclusion behaves identically here.

INSERT INTO public.venue_packages (
  venue_id, package_id, price, included_guests, overage_per_person, max_guests, is_active
)
SELECT
  27, vp.package_id, vp.price, vp.included_guests, vp.overage_per_person, vp.max_guests, vp.is_active
FROM public.venue_packages vp
WHERE vp.venue_id = 14
  AND NOT EXISTS (
    SELECT 1 FROM public.venue_packages x
    WHERE x.venue_id = 27 AND x.package_id = vp.package_id
  );

-- Applied 2026-09-14. All 8 packages copied, prices verified identical to Beige Cafe:
--   the_prelude 5,900 (incl 4, overage 0, max 4) | setting 8,900 | date_night_classic 10,900
--   moment 12,900 | movie_night_classic 13,900 | date_night_deluxe 13,900
--   movie_night_deluxe 17,900 | story 25,000     (all incl 6, overage 2,000 unless noted)
--
-- Live pricing checks against venue 27:
--   base 2 guests            -> 5,900  (advance 1,770)
--   the_prelude 2 guests     -> 5,900  (advance 1,770)
--   setting 6 guests         -> 8,900  (advance 2,670)
--   story 8 guests (2 over)  -> 29,000 (advance 8,700)
--
-- REMAINING before this venue goes live:
--   1. UPDATE venues SET is_active = true WHERE id = 27;
--   2. Move booking 172 onto venue 27 (needs its actual time_slot; clear checkout_date).
--   3. Booking 165 picnic/stay split still pending.
