-- Migration: Add name column to booking_add_ons
-- Fixes silent insert failures in submitBookingIntent() where the insert payload
-- included a `name` field that had no corresponding column in the table.
-- Run in: Supabase Dashboard → SQL Editor → New query

ALTER TABLE booking_add_ons
  ADD COLUMN IF NOT EXISTS name text;
