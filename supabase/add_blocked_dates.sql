-- ================================================================
-- Add blocked_dates column to venues
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

ALTER TABLE venues ADD COLUMN IF NOT EXISTS blocked_dates jsonb DEFAULT '[]'::jsonb;

-- Verify
SELECT id, name, type, blocked_dates FROM venues ORDER BY id;
