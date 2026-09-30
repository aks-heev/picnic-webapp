-- Ledger for server-side Meta Conversions API sends (meta-capi-offline).
-- Deliberately a separate table, NOT a capi_sent_at column on bookings:
-- any UPDATE on bookings fires set_booking_region (BEFORE UPDATE) and is
-- visible to the Google Sheet sync; a send-ledger must not touch booking rows.
create table if not exists public.meta_capi_events (
  id          bigserial primary key,
  run_at      timestamptz not null default now(),
  mode        text not null check (mode in ('dry_run','test','live')),
  booking_id  bigint not null references public.bookings(id) on delete cascade,
  event_name  text not null,
  event_id    text not null,
  status      text not null check (status in ('sent','rejected','error','skipped')),
  value_inr   numeric,
  detail      text
);

-- Idempotency: at most one successful LIVE send per booking+event.
create unique index if not exists meta_capi_events_live_sent_uniq
  on public.meta_capi_events (booking_id, event_name)
  where mode = 'live' and status = 'sent';

create index if not exists meta_capi_events_run_at_idx on public.meta_capi_events (run_at desc);

alter table public.meta_capi_events enable row level security;

-- Admin read-only (same single-admin convention as bookings/ad_insights).
-- Writes come only from the edge function via the service role (bypasses RLS).
drop policy if exists meta_capi_events_admin_select on public.meta_capi_events;
create policy meta_capi_events_admin_select on public.meta_capi_events
  for select to authenticated
  using ((select auth.email()) = 'aksh.eeev@gmail.com');

revoke all on public.meta_capi_events from anon;
revoke insert, update, delete on public.meta_capi_events from authenticated;
