-- ============================================================
-- Scheduler for sync-ical (Airbnb -> site).
-- Run ONCE in: Supabase Dashboard -> SQL Editor.
--
-- This is the ONLY manual, secret-dependent step of the iCal sync
-- feature. It is safe to defer until your first Airbnb listing exists:
-- until a venue has `airbnb_ical_url` set, sync-ical processes zero
-- venues, so the cron is a harmless no-op before then.
--
-- Why this isn't in the main migration / wasn't auto-run: step 2 needs
-- your service_role key, a secret that must not live in the repo or be
-- pasted by tooling. It is stored in Supabase Vault and read at run
-- time, never written into the job body.
--
-- NOTE: extensions pg_cron + pg_net are already enabled on this project,
-- so step 1 below is a harmless no-op kept for portability.
-- ============================================================

-- 1. Extensions (already enabled; safe to re-run).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Store the service_role key in Vault.
--    (Dashboard -> Project Settings -> API -> service_role secret.)
--    Replace the placeholder, run once. Re-running with the same name
--    errors — that's fine, it means the secret is already stored.
select vault.create_secret('PASTE_YOUR_SERVICE_ROLE_KEY_HERE', 'ical_service_key');

-- 3. Schedule the import. HOURLY by default — see the note below on cadence.
--    The job reads the key from Vault at run time, so the secret never
--    appears in the job definition.
select cron.schedule(
  'sync-ical-hourly',
  '0 * * * *',                 -- top of every hour
  $$
  select net.http_post(
    url     := 'https://evmftrogyzoudiccqkya.supabase.co/functions/v1/sync-ical',
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

-- ----------------------------------------------------------------
-- Cadence / cost note (disk IO + egress):
--   Each run = 1 internal http_post + one external fetch per venue that
--   has airbnb_ical_url set, then replace_ical_blocks() does a DELETE +
--   INSERT even when the feed is unchanged. With 1-2 units this is
--   trivial, and hourly is plenty while Airbnb volume is low — Airbnb
--   itself only re-polls export-ical every few hours, so a tighter import
--   cadence buys little. The real reason to tighten LATER is double-book
--   protection: if a guest books a single directly on Airbnb, the import
--   lag is your exposure window. When volume grows, change to:
--     '*/30 * * * *' (30 min)  or  '*/15 * * * *' (15 min)
--   via cron.unschedule + cron.schedule (or just re-run schedule w/ new cron).
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- Useful management queries:
--   select * from cron.job;                              -- list jobs
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select cron.unschedule('sync-ical-hourly');          -- remove the job
-- ----------------------------------------------------------------
