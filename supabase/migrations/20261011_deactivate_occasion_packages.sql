-- 2026-10-11 (Aksheev's call): drop the 4 occasion-locked packages. 0 bookings
-- had ever referenced them (bookings.package_key), and in the last 120 days no
-- lead picked the Date Night or Movie Night occasion. Customers book
-- Birthday / Proposal on the universal ladder instead.
-- Deactivated, not deleted: venue_packages + package_add_ons rows are kept, so
-- this is reversible. "Date Night" stays as an OCCASION (booking-form dropdown,
-- OCCASIONS in app.js) — only the packages are gone.
-- Rollback:
--   update public.packages set is_active = true where key in ('date_night_classic','date_night_deluxe','movie_night_classic','movie_night_deluxe');
update public.packages set is_active = false, updated_at = now()
where key in ('date_night_classic','date_night_deluxe','movie_night_classic','movie_night_deluxe') and is_active = true;
