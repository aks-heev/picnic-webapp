-- ============================================================
-- Migration: venue_availability — single source of truth
-- Replaces: venues.blocked_dates + direct bookings queries
--
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================


-- ----------------------------------------------------------------
-- 1. CREATE venue_availability
--    One row per (venue, date, source). Two rows can exist for the
--    same date if it is both admin-blocked AND booked (edge case),
--    but status always describes the row's own reason.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS venue_availability (
  id          bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venue_id    bigint  NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  date        date    NOT NULL,
  status      text    NOT NULL CHECK (status IN ('blocked', 'booked')),
  source      text    NOT NULL CHECK (source IN ('admin', 'booking')),
  booking_id  bigint  REFERENCES bookings (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate rows for the same venue+date+source combination
  UNIQUE (venue_id, date, source)
);

CREATE INDEX IF NOT EXISTS va_venue_date_idx ON venue_availability (venue_id, date);

-- ----------------------------------------------------------------
-- 2. RLS — anon can read (date + status only, no PII in this table)
--         admin can do everything
-- ----------------------------------------------------------------
ALTER TABLE venue_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_venue_availability"
  ON venue_availability FOR SELECT TO anon
  USING (true);

CREATE POLICY "auth_all_venue_availability"
  ON venue_availability FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT                         ON TABLE venue_availability TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE venue_availability TO authenticated;

-- ----------------------------------------------------------------
-- 3. MIGRATE existing blocked_dates from venues into the new table
--    Run this to carry over any dates already stored in the JSON array.
-- ----------------------------------------------------------------
INSERT INTO venue_availability (venue_id, date, status, source)
SELECT
  v.id,
  d::date,
  'blocked',
  'admin'
FROM venues v,
     jsonb_array_elements_text(
       CASE
         WHEN v.blocked_dates IS NULL THEN '[]'::jsonb
         ELSE to_jsonb(v.blocked_dates)
       END
     ) AS d
WHERE v.blocked_dates IS NOT NULL
  AND jsonb_array_length(to_jsonb(v.blocked_dates)) > 0
ON CONFLICT (venue_id, date, source) DO NOTHING;

-- ----------------------------------------------------------------
-- 4. MIGRATE confirmed bookings (BnB only) into venue_availability.
--    Expands each stay range into individual date rows.
--    Café slot-level bookings are NOT migrated — they remain tracked
--    via get_cafe_booked_slots RPC which is already SECURITY DEFINER.
-- ----------------------------------------------------------------
INSERT INTO venue_availability (venue_id, date, status, source, booking_id)
SELECT
  b.venue_id,
  generate_series(
    b.preferred_date,
    COALESCE(b.checkout_date, b.preferred_date + interval '1 day') - interval '1 day',
    interval '1 day'
  )::date,
  'booked',
  'booking',
  b.id
FROM bookings b
JOIN venues v ON v.id = b.venue_id
WHERE b.confirmed = true
  AND b.preferred_date IS NOT NULL
  AND v.type IN ('self_managed', 'partner_bnb')
ON CONFLICT (venue_id, date, source) DO NOTHING;

-- ----------------------------------------------------------------
-- 5. DROP venues.blocked_dates — no longer needed.
--    Only run this AFTER verifying the migration above looks correct.
--    Comment this out if you want to keep it as a backup for now.
-- ----------------------------------------------------------------
-- ALTER TABLE venues DROP COLUMN IF EXISTS blocked_dates;

-- ----------------------------------------------------------------
-- AFTER RUNNING:
-- 1. Verify data: SELECT * FROM venue_availability ORDER BY venue_id, date;
-- 2. Check counts match your admin-blocked + confirmed booking dates.
-- 3. Once satisfied, uncomment the DROP COLUMN above and re-run.
-- ----------------------------------------------------------------
