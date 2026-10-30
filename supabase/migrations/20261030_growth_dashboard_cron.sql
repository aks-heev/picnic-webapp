-- Growth dashboard syncs (docs/GROWTH_DASHBOARD_PLAN.md). Content-Type only, no
-- Authorization — the lead-digest / sync-meta-ads contract; both fns are verify_jwt=false.
select cron.schedule(
  'sync-posthog-daily',
  '40 0 * * *',   -- 06:10 IST
  $$
  select net.http_post(
    url := 'https://evmftrogyzoudiccqkya.supabase.co/functions/v1/sync-posthog',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
select cron.schedule(
  'sync-gsc-daily',
  '40 3 * * *',   -- 09:10 IST
  $$
  select net.http_post(
    url := 'https://evmftrogyzoudiccqkya.supabase.co/functions/v1/sync-gsc',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
