-- Lead capture: track where each unconfirmed booking (lead) sits in the
-- follow-up funnel, driven by the success-page WhatsApp CTA and payment flow.
--   pending → whatsapp_clicked / payment_initiated → confirmed | abandoned
--
-- 'confirmed' is written server-side only (verify-payment / razorpay-webhook);
-- 'abandoned' only by the nightly pg_cron sweep. The client-callable RPC below
-- is restricted to the two customer-action statuses.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS lead_status TEXT
    CHECK (lead_status IN (
      'pending','whatsapp_clicked',
      'payment_initiated','confirmed','abandoned'
    )) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS lead_status_updated_at TIMESTAMPTZ;

-- Backfill existing rows. bookings has NO updated_at column, so created_at is
-- the best available timestamp for both branches. (ADD COLUMN ... DEFAULT
-- already filled every row with 'pending', so only confirmed rows need the
-- status flipped.)
UPDATE bookings
  SET lead_status = 'confirmed',
      lead_status_updated_at = created_at
  WHERE confirmed = true;

UPDATE bookings
  SET lead_status_updated_at = created_at
  WHERE confirmed = false AND lead_status_updated_at IS NULL;

-- Index for lead-targeting queries (only unconfirmed rows matter)
CREATE INDEX IF NOT EXISTS idx_bookings_lead_status
  ON bookings (lead_status) WHERE confirmed = false;

-- Client-callable status update (fire-and-forget from app.js).
-- bookings.id is int8 (identity), NOT uuid — hence BIGINT.
CREATE OR REPLACE FUNCTION update_lead_status(
  p_booking_id BIGINT,
  p_status     TEXT,
  p_clicked_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Anon-reachable, so only allow the customer-action statuses. Terminal
  -- statuses ('confirmed', 'abandoned') are set by trusted server paths.
  IF p_status NOT IN ('whatsapp_clicked', 'payment_initiated') THEN
    RAISE EXCEPTION 'update_lead_status: status % not allowed from client', p_status;
  END IF;

  UPDATE bookings
  SET lead_status = p_status,
      lead_status_updated_at = p_clicked_at
  WHERE id = p_booking_id
    AND confirmed = false;
END;
$$;

-- Customers book anonymously (anon key, no auth session), so anon needs it too.
GRANT EXECUTE ON FUNCTION update_lead_status(BIGINT, TEXT, TIMESTAMPTZ) TO anon, authenticated;

-- Nightly sweep: untouched 24h-old leads → abandoned. 20:30 UTC = 02:00 IST.
-- Requires the pg_cron extension (Dashboard → Database → Extensions). Guarded
-- so this migration still applies cleanly if pg_cron isn't enabled yet — in
-- that case enable it and re-run the cron.schedule(...) call manually.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('mark-abandoned-leads', '30 20 * * *', $cron$
      UPDATE bookings
      SET lead_status = 'abandoned',
          lead_status_updated_at = NOW()
      WHERE lead_status = 'pending'
        AND confirmed = false
        AND created_at < NOW() - INTERVAL '24 hours';
    $cron$);
  ELSE
    RAISE NOTICE 'pg_cron not installed — skipping mark-abandoned-leads schedule; enable pg_cron and run the cron.schedule block manually';
  END IF;
END
$do$;
