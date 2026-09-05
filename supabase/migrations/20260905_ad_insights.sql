-- Meta Ads spend-control tables. Phase 1 of docs/META_ADS_DASHBOARD_PLAN.md.
--
-- Purpose is spend CONTROL, not performance: on 2026-07-24 the only active campaign
-- stopped delivering (prepaid balance ran out) while its status kept reading Active,
-- and nobody noticed for six weeks. These tables exist so that condition is detectable.
--
-- Attribution (which campaign produced which booking) is deliberately OUT of scope:
-- 0 of 46 confirmed bookings carry an ad reference and 44 of 46 never touched the
-- website, so campaign-level ROI is not computable from today's data.

create table if not exists public.ad_insights (
  account_id      text not null,
  campaign_id     text not null,
  campaign_name   text,
  date            date not null,
  spend_inr       numeric not null default 0 check (spend_inr >= 0),
  impressions     integer,
  clicks          integer,
  reach           integer,
  results         integer,
  result_indicator text,
  -- NOT historical. Every sync run restamps the whole trailing window with the
  -- campaign's status AS OF THAT RUN, so this answers "is this campaign active now",
  -- never "what was its status on that date". Named accordingly so it cannot be
  -- misread later.
  effective_status_at_sync text,
  synced_at       timestamptz not null default now(),
  primary key (campaign_id, date)
);

comment on table public.ad_insights is
  'One row per Meta campaign per day, in the ad account timezone (Asia/Kolkata, verified 2026-09-05 - same calendar day as bookings, no date shift needed). Upserted on (campaign_id, date) over a trailing ~30-day window because Meta restates recent days as attribution settles. A day with no delivery is stored as spend_inr = 0, NOT as a missing row: the alarm distinguishes "spent nothing" from "never synced", and that difference is the whole point of the table.';
comment on column public.ad_insights.effective_status_at_sync is
  'Campaign effective_status as of the last sync, restamped across the entire window on every run. Current-state only - never read it as the status on that row''s date.';
comment on column public.ad_insights.result_indicator is
  'Which action Meta counted as a "result", e.g. actions:onsite_conversion.messaging_conversation_started_7d. Stored because the objective can change and a bare results count would then be incomparable across periods.';

create index if not exists ad_insights_date_idx on public.ad_insights (date);
create index if not exists ad_insights_campaign_date_idx on public.ad_insights (campaign_id, date desc);

-- Written on EVERY run, success or failure. This is the staleness detector:
-- pg_cron's job_run_details reported 'succeeded' for all five jobs throughout the
-- 11-day 402 outage, so the scheduler cannot be trusted to say the sync ran.
create table if not exists public.ad_sync_runs (
  id             bigserial primary key,
  run_at         timestamptz not null default now(),
  window_start   date,
  window_end     date,
  rows_upserted  integer,
  ok             boolean not null,
  error          text
);

comment on table public.ad_sync_runs is
  'Audit row per sync-meta-ads invocation, written on success AND failure. The dashboard''s "last synced" badge and the Morning-brief watchdog both read max(run_at) here. pg_cron job_run_details cannot serve this purpose - it reports success whenever the HTTP request was issued, regardless of the response.';

create index if not exists ad_sync_runs_run_at_idx on public.ad_sync_runs (run_at desc);

alter table public.ad_insights enable row level security;
alter table public.ad_sync_runs enable row level security;

-- Policies mirror public.expenses exactly. Deliberately NO anon policy of any kind on
-- either table: ad spend and sync cadence are business data, and the absence of an anon
-- SELECT is the only thing making a hosted dashboard URL safe.
-- ad_sync_runs is easy to dismiss as plumbing - it still leaks spend cadence if opened.

drop policy if exists admin_select_ad_insights on public.ad_insights;
create policy admin_select_ad_insights on public.ad_insights
  for select to authenticated
  using (auth.email() = 'aksh.eeev@gmail.com');

drop policy if exists admin_insert_ad_insights on public.ad_insights;
create policy admin_insert_ad_insights on public.ad_insights
  for insert to authenticated
  with check (auth.email() = 'aksh.eeev@gmail.com');

drop policy if exists admin_update_ad_insights on public.ad_insights;
create policy admin_update_ad_insights on public.ad_insights
  for update to authenticated
  using (auth.email() = 'aksh.eeev@gmail.com');

drop policy if exists admin_delete_ad_insights on public.ad_insights;
create policy admin_delete_ad_insights on public.ad_insights
  for delete to authenticated
  using (auth.email() = 'aksh.eeev@gmail.com');

drop policy if exists admin_select_ad_sync_runs on public.ad_sync_runs;
create policy admin_select_ad_sync_runs on public.ad_sync_runs
  for select to authenticated
  using (auth.email() = 'aksh.eeev@gmail.com');

drop policy if exists admin_insert_ad_sync_runs on public.ad_sync_runs;
create policy admin_insert_ad_sync_runs on public.ad_sync_runs
  for insert to authenticated
  with check (auth.email() = 'aksh.eeev@gmail.com');

drop policy if exists admin_update_ad_sync_runs on public.ad_sync_runs;
create policy admin_update_ad_sync_runs on public.ad_sync_runs
  for update to authenticated
  using (auth.email() = 'aksh.eeev@gmail.com');

drop policy if exists admin_delete_ad_sync_runs on public.ad_sync_runs;
create policy admin_delete_ad_sync_runs on public.ad_sync_runs
  for delete to authenticated
  using (auth.email() = 'aksh.eeev@gmail.com');
