-- ============================================================
-- Migration: Hold action (combo-only pre-confirm state)
-- Additive / safe. "Held" = held_at IS NOT NULL AND confirmed = false:
-- the singles are parent-blocked and Airbnb is importing, but the
-- combo guest is not yet committed. Lets the iCal propagation lag
-- elapse before we promise the floor to the guest.
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS held_at timestamptz;
