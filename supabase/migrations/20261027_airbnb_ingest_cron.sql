-- 20261027_airbnb_ingest_cron.sql
-- Run ingest-airbnb hourly at :10 (sync-ical runs at :00). Same vault key and
-- auth pattern as sync-ical-hourly. Apply AFTER the function is deployed.
select cron.schedule(
  'ingest-airbnb-hourly',
  '10 * * * *',
  $$
  select net.http_post(
    url     := 'https://evmftrogyzoudiccqkya.supabase.co/functions/v1/ingest-airbnb',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret
                                       from vault.decrypted_secrets
                                       where name = 'ical_service_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
