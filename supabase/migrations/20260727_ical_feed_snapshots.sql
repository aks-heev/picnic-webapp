-- Phase 0.1 of docs/ICAL_FIX_PLAN_2026-07-27.md
-- Records what each Airbnb feed actually contained on every sync run, so the
-- "is there still a cross-floor linked-listing echo?" question can be answered
-- from data instead of inference. Purely observational: nothing reads this
-- table to make availability decisions.
create table if not exists public.ical_feed_snapshots (
  id            bigint generated always as identity primary key,
  venue_id      bigint      not null references public.venues(id) on delete cascade,
  fetched_at    timestamptz not null default now(),
  ok            boolean     not null default true,
  error         text,
  event_count   integer     not null default 0,
  has_summaries boolean,
  raw_sha256    text,
  -- [{start, end, summary, cancelled}] as parsed by sync-ical
  events        jsonb       not null default '[]'::jsonb
);

create index if not exists ical_feed_snapshots_venue_time_idx
  on public.ical_feed_snapshots (venue_id, fetched_at desc);

alter table public.ical_feed_snapshots enable row level security;

-- service_role (the edge function) bypasses RLS and does the writing.
-- Admin gets read-only visibility, matching the house convention on
-- venues / venue_availability / bookings. anon gets nothing.
drop policy if exists admin_select_ical_feed_snapshots on public.ical_feed_snapshots;
create policy admin_select_ical_feed_snapshots
  on public.ical_feed_snapshots
  for select
  to authenticated
  using (auth.email() = 'aksh.eeev@gmail.com'::text);
