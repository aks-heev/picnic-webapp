-- 30-day retention for ical_feed_snapshots. SQL-only cron job (no edge
-- function), so it adds no HTTP failure surface. 03:15 UTC = 08:45 IST,
-- deliberately off the :00 and :30 marks used by the other four jobs.
select cron.unschedule('ical-snapshot-prune')
where exists (select 1 from cron.job where jobname = 'ical-snapshot-prune');

select cron.schedule(
  'ical-snapshot-prune',
  '15 3 * * *',
  $$delete from public.ical_feed_snapshots where fetched_at < now() - interval '30 days'$$
);
