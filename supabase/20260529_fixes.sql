-- ============================================================
-- Migration: Security + Add-ons — The Picnic Stories
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================


-- ----------------------------------------------------------------
-- 1. BOOKING_ADD_ONS
--    Stores per-booking add-on line items so selections aren't lost.
--    Written by submitBookingIntent() after the bookings insert.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_add_ons (
  id                   bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id           bigint  NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  addon_id             integer NOT NULL,
  price_at_booking     numeric(10, 2) NOT NULL DEFAULT 0,
  requires_confirmation boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_add_ons_booking_id_idx
  ON booking_add_ons (booking_id);

ALTER TABLE booking_add_ons ENABLE ROW LEVEL SECURITY;

-- Anon can insert (booking form is public-facing)
CREATE POLICY "anon_insert_booking_add_ons"
  ON booking_add_ons FOR INSERT
  TO anon
  WITH CHECK (true);

-- Admin can read/manage all add-on rows
CREATE POLICY "auth_all_booking_add_ons"
  ON booking_add_ons FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ----------------------------------------------------------------
-- 2. FIX RLS — bookings SELECT policy
--
--    Problem: the existing "auth_select_bookings" policy uses
--    USING (true), which lets ANY OTP-authenticated customer query
--    every booking in the system from their browser console.
--
--    Fix: split into two policies —
--      a) Admin (password auth) → unrestricted read
--      b) Customer (OTP/magic-link auth) → own rows only,
--         matched by email_address column
--
--    IMPORTANT: replace 'your-admin@email.com' below with the
--    actual admin account email before running this migration.
-- ----------------------------------------------------------------

-- Drop the old catch-all policy
DROP POLICY IF EXISTS "auth_select_bookings" ON bookings;

-- Admin: full read access (identified by email)
CREATE POLICY "admin_select_bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (auth.email() = 'your-admin@email.com');

-- Customer: can only read their own bookings
CREATE POLICY "customer_select_own_bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (email_address = auth.email());


-- ----------------------------------------------------------------
-- AFTER RUNNING:
--
-- Replace 'your-admin@email.com' in the admin_select_bookings
-- policy above with your actual admin account email, then re-run.
--
-- Alternatively, use a custom claim / role rather than email
-- matching if you anticipate multiple admin users.
-- ----------------------------------------------------------------
