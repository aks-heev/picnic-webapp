-- Schedules the sync-meta-ads edge function daily. Minute 20 is deliberately clear of
-- every other job's minute (ical-snapshot-prune 15 3, lead-digest-daily 30 3,
-- post-event-nudge-daily 30 4, mark-abandoned-leads 30 20, sync-ical-hourly 0 * — every
-- :00 is taken). 05:20 UTC = 10:50 IST, late enough that Meta's previous Asia/Kolkata
-- day has settled. See docs/HOSTED_DASHBOARD_PLAN.md §6 / META_ADS_DASHBOARD_PLAN.md §4.
--
-- Same shape as lead-digest-daily / post-event-nudge-daily: Content-Type header only, no
-- Authorization. sync-meta-ads MUST stay verify_jwt=false and must never gain a
-- CRON_SECRET check, or every fire here 401s silently while cron.job_run_details keeps
-- reporting 'succeeded' — see the function's own file-header warning.
--
-- 🔴 This job is created here but the function it calls is NOT YET DEPLOYED as of this
-- migration (2026-09-23) — every run will 404/fail until Aksheev deploys sync-meta-ads
-- via the Supabase Dashboard and sets the META_ACCESS_TOKEN / META_AD_ACCOUNT_ID secrets.
-- Failed runs are harmless (ad_insights keeps its last good — currently empty — rows) but
-- will show up in cron.job_run_details as errors until then. Not a bug to chase.

select cron.schedule(
  'sync-meta-ads-daily',
  '20 5 * * *',
  $$
  select net.http_post(
    url := 'https://evmftrogyzoudiccqkya.supabase.co/functions/v1/sync-meta-ads',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
