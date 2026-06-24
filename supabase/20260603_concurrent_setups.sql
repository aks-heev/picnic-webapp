-- ============================================================
-- Migration: concurrent setup capacity per venue
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Add max_concurrent_setups to venues.
--    DEFAULT 1 preserves existing single-setup behaviour for all venues.
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS max_concurrent_setups integer NOT NULL DEFAULT 1
  CHECK (max_concurrent_setups >= 1);

-- 2. Remove booking-source rows from venue_availability.
--    Booking occupancy is now computed by querying the bookings table directly
--    (count of confirmed bookings per date vs max_concurrent_setups).
--    venue_availability is kept only for admin-blocked dates (source = 'admin').
DELETE FROM venue_availability WHERE source = 'booking';
