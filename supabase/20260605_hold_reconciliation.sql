-- ============================================================
-- Hold reconciliation fields (set by sync-ical's Phase 2 reconcileHolds).
-- After each hourly import, every held floor is re-tested against the
-- fresh child data and stamped with a verdict the admin card reads.
--   hold_status        : 'clear' | 'ripe' | 'conflict' (NULL when not held)
--   hold_checked_at     : when reconciliation last ran for this booking
--   hold_conflict_dates : the clashing nights, when status = 'conflict'
-- Confirmation is never automated — these are advisory flags + email only.
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS hold_status text,
  ADD COLUMN IF NOT EXISTS hold_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS hold_conflict_dates text[];

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_hold_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_hold_status_check
  CHECK (hold_status IS NULL OR hold_status IN ('clear','ripe','conflict'));
