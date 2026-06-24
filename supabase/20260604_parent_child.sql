-- ============================================================
-- Migration: parent-child linked listings (combo venue)
-- Additive / safe. Adds combo venue type, parent link, and the
-- 'parent' availability source used to block children when the
-- whole floor is booked.
--
-- Direction of blocking (the asymmetry):
--   Reunion booked  -> STORED source='parent' rows on each child
--                       (children are on Airbnb; blocks must ride
--                        export-ical out to Airbnb)
--   Child booked    -> COMPUTED at read time (intersection of children)
--                       (Reunion is direct-only, never exported)
-- ============================================================

-- 1. Parent link: a child single points at its combo parent.
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS parent_venue_id bigint
    REFERENCES venues (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS venues_parent_idx ON venues (parent_venue_id);

-- 2. Allow the 'combo' venue type (direct-only whole-floor unit).
--    Existing constraint also lists 'cafe', so preserve all four + combo.
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_type_check;
ALTER TABLE venues ADD CONSTRAINT venues_type_check
  CHECK (type IN ('self_managed','partner_bnb','custom','cafe','combo'));

-- 3. Allow source='parent' on venue_availability (combo-origin child blocks).
ALTER TABLE venue_availability DROP CONSTRAINT IF EXISTS venue_availability_source_check;
ALTER TABLE venue_availability ADD CONSTRAINT venue_availability_source_check
  CHECK (source IN ('admin','booking','ical','parent'));

-- 4. One parent block per child venue+date (mirrors va_ical_unique).
--    booking_id ties each block to the combo booking that created it.
CREATE UNIQUE INDEX IF NOT EXISTS va_parent_unique
  ON venue_availability (venue_id, date)
  WHERE source = 'parent' AND time_slot IS NULL;
