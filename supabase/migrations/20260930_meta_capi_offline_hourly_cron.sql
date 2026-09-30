-- Hourly send of admin-closed picnic bookings to Meta CAPI (meta-capi-offline).
-- Same header contract as lead-digest-daily / sync-meta-ads-daily: Content-Type only,
-- no Authorization (function is verify_jwt=false). Minute 7 avoids sync-ical-hourly at :00.
-- Created INACTIVE. Go-live = set secret META_CAPI_MODE=live, then:
--   select cron.alter_job((select jobid from cron.job where jobname='meta-capi-offline-hourly'), active := true);
-- (A direct UPDATE on cron.job is permission-denied here — use cron.alter_job.)
select cron.schedule(
  'meta-capi-offline-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://evmftrogyzoudiccqkya.supabase.co/functions/v1/meta-capi-offline',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
select cron.alter_job(
  (select jobid from cron.job where jobname = 'meta-capi-offline-hourly'),
  active := false
);
