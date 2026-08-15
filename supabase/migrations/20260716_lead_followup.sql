-- Lead follow-up tracking for the daily lead digest (P0-4, 2026-07-16)
-- Applied live via MCP apply_migration as `lead_followup_tracking` on 2026-07-16.
-- followed_up_at: set when the team has contacted the lead (digest keeps nagging until set)
-- followup_reason: the answer to "why didn't you complete?" — price / advance / date / browsing / friction / other
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS followed_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS followup_reason text;
