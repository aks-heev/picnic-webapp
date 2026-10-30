-- Growth dashboard (docs/GROWTH_DASHBOARD_PLAN.md, 2026-10-30).
-- Synced daily by edge functions sync-posthog and sync-gsc (service role; RLS bypassed).
-- Read by hosted-dashboard/growth.html as the single admin email. NO anon policy, ever.
-- 🔴 Unique visitors do not add across days: *_daily tables are for trend lines only;
--    window totals (7/30/90 days) live in web_window / gsc_*_window.

create table public.web_daily (
  date        date primary key,          -- IST calendar day
  visitors    integer not null,
  sessions    integer not null,
  pageviews   integer not null,
  synced_at   timestamptz not null default now()
);

create table public.web_event_daily (
  date        date not null,
  event       text not null,
  people      integer not null,
  events      integer not null,
  synced_at   timestamptz not null default now(),
  primary key (date, event)
);

create table public.web_window (
  window_end  date not null,             -- last IST day included (yesterday at sync time)
  window_days integer not null check (window_days in (7, 30, 90)),
  kind        text not null check (kind in ('overview','source','page','device','event')),
  key         text not null,
  people      integer not null,          -- unique people (visitors)
  count       integer,                   -- pageviews / events where meaningful
  synced_at   timestamptz not null default now(),
  primary key (window_end, window_days, kind, key)
);

create table public.gsc_daily (
  date        date primary key,
  clicks      integer not null,
  impressions integer not null,
  ctr         numeric,
  position    numeric,
  synced_at   timestamptz not null default now()
);

create table public.gsc_page_window (
  window_end  date not null,
  window_days integer not null check (window_days in (7, 28, 90)),
  page        text not null,
  clicks      integer not null,
  impressions integer not null,
  position    numeric,
  synced_at   timestamptz not null default now(),
  primary key (window_end, window_days, page)
);

create table public.gsc_query_window (
  window_end  date not null,
  window_days integer not null check (window_days in (7, 28, 90)),
  query       text not null,
  clicks      integer not null,
  impressions integer not null,
  position    numeric,
  synced_at   timestamptz not null default now(),
  primary key (window_end, window_days, query)
);

create table public.web_sync_runs (
  id           bigserial primary key,
  source       text not null check (source in ('posthog','gsc')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  window_start date,
  window_end   date,
  rows_written integer not null default 0,
  ok           boolean not null,
  error        text
);
create index web_sync_runs_source_started on public.web_sync_runs (source, started_at desc);

do $$
declare t text;
begin
  foreach t in array array['web_daily','web_event_daily','web_window','gsc_daily','gsc_page_window','gsc_query_window','web_sync_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy admin_select_%1$s on public.%1$I for select to authenticated using (auth.email() = %2$L)',
      t, 'aksh.eeev@gmail.com');
  end loop;
end $$;
