-- ============================================================
-- Migration: slot-level admin blocking on venue_availability
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Add time_slot column (nullable).
--    NULL = full-day block (BnB / all-slots-blocked for café).
--    'morning' | 'afternoon' | 'evening' = slot-specific café block.
ALTER TABLE venue_availability
  ADD COLUMN IF NOT EXISTS time_slot text
  CHECK (time_slot IN ('morning', 'afternoon', 'evening'));

-- 2. Drop the old unique constraint that prevented multiple admin-source
--    rows per venue+date (which we now need for per-slot blocks).
--    The auto-generated name in Supabase is typically the one below;
--    verify in Dashboard → Table Editor → venue_availability → Constraints
--    if this errors, and replace with the actual name.
ALTER TABLE venue_availability
  DROP CONSTRAINT IF EXISTS venue_availability_venue_id_date_source_key;

-- 3. Replace with two partial unique indexes:
--    a) One full-day admin block per venue+date
CREATE UNIQUE INDEX IF NOT EXISTS va_admin_fullday_unique
  ON venue_availability (venue_id, date)
  WHERE source = 'admin' AND time_slot IS NULL;

--    b) One slot admin block per venue+date+slot
CREATE UNIQUE INDEX IF NOT EXISTS va_admin_slot_unique
  ON venue_availability (venue_id, date, time_slot)
  WHERE source = 'admin' AND time_slot IS NOT NULL;
