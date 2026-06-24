-- ============================================================
-- Migration: Airbnb <-> Website iCal sync — schema + reconcile fn
-- Run in: Supabase Dashboard -> SQL Editor (or via MCP apply_migration)
--
-- Additive / safe. Introduces the 'ical' availability source, a
-- per-venue Airbnb feed URL, sync-status bookkeeping columns, an
-- idempotent unique index for imported blocks, and the atomic
-- replace_ical_blocks() swap used by the sync-ical edge function.
-- No existing rows or behaviour change (verified: 0 booking/ical rows
-- pre-existed; all venue_availability rows were source='admin').
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Per-venue Airbnb feed URL + last-sync bookkeeping.
--    Setting airbnb_ical_url on a venue is what ENABLES sync for it
--    (engine is type-agnostic, driven off this column being non-null).
-- ----------------------------------------------------------------
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS airbnb_ical_url       text,
  ADD COLUMN IF NOT EXISTS last_ical_sync_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_ical_sync_status text;

-- ----------------------------------------------------------------
-- 2. Allow source='ical' on venue_availability.
--    Old constraint allowed only ('admin','booking').
-- ----------------------------------------------------------------
ALTER TABLE venue_availability
  DROP CONSTRAINT IF EXISTS venue_availability_source_check;
ALTER TABLE venue_availability
  ADD  CONSTRAINT venue_availability_source_check
  CHECK (source IN ('admin','booking','ical'));

-- ----------------------------------------------------------------
-- 3. Idempotent importer target: one ical full-day block per
--    venue+date. Mirrors the source='admin' partial unique indexes.
-- ----------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS va_ical_unique
  ON venue_availability (venue_id, date)
  WHERE source = 'ical' AND time_slot IS NULL;

-- ----------------------------------------------------------------
-- 4. Atomic reconcile used by sync-ical (Airbnb -> site).
--    In one transaction: delete this venue's ical blocks NOT in the
--    new date set, then insert the missing ones. This is what prevents
--    a delete-then-insert race from briefly showing the venue fully
--    open (and getting double-booked) mid-sync.
--
--    SAFETY CONTRACT: an empty p_dates array legitimately clears ALL
--    ical blocks for the venue (its Airbnb calendar genuinely freed
--    up). Therefore the caller MUST NOT call this on a failed/garbage
--    fetch — it must validate the feed parses as a VCALENDAR first and
--    skip the venue entirely on any error.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION replace_ical_blocks(p_venue_id bigint, p_dates date[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM venue_availability
  WHERE venue_id = p_venue_id
    AND source = 'ical'
    AND time_slot IS NULL
    AND NOT (date = ANY (COALESCE(p_dates, ARRAY[]::date[])));

  INSERT INTO venue_availability (venue_id, date, status, source, time_slot)
  SELECT p_venue_id, d, 'blocked', 'ical', NULL
  FROM unnest(COALESCE(p_dates, ARRAY[]::date[])) AS d
  ON CONFLICT (venue_id, date) WHERE source = 'ical' AND time_slot IS NULL
  DO NOTHING;
END;
$$;

-- Only the service role (used by the sync-ical edge function) may call it.
-- Supabase grants EXECUTE to anon AND authenticated by default, so revoke both;
-- the admin "Sync now" goes through the edge function (service role), not RPC.
REVOKE ALL ON FUNCTION replace_ical_blocks(bigint, date[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION replace_ical_blocks(bigint, date[]) FROM anon;
REVOKE ALL ON FUNCTION replace_ical_blocks(bigint, date[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION replace_ical_blocks(bigint, date[]) TO service_role;
