-- 20261027_airbnb_auto_ingest.sql
-- Airbnb reservations -> bookings, automatically (Phase 0 + 1 of the
-- auto-ingest plan). The Airbnb iCal feed carries, per reservation, the HM
-- confirmation code and the guest's phone last-4 in DESCRIPTION. The
-- ingest-airbnb edge function (hourly, :10) reads the feeds and calls the two
-- service-role-only functions below. Mode 'dry_run' writes ONLY to
-- airbnb_feed_state / airbnb_ingest_log; 'live' also writes bookings.
--
-- Deliberately NOT done here:
--   * no venue_availability writes. sync-ical already blocks Airbnb dates
--     (source='ical') and fans whole-home Sienna reservations out to the
--     floors (source='parent', booking_id NULL, va_parent_unique). A
--     booking-linked fanout here would collide with that unique index.
--   * no conflict rejection. Airbnb has already accepted the booking; an
--     overlap with one of OUR bookings is reported loudly, never refused.
--   * entry_source stays 'admin' (CHECK allows only site/admin, and every
--     dashboard treats non-admin as "Website"). Auto rows are identified by
--     auto_ingested_at IS NOT NULL.
--   * booking_status stays NULL on create (CHECK has no "pending" value);
--     missing guest details are tracked by airbnb_details_pending.

-- 1. One row per Airbnb reservation, whatever path inserts it.
create unique index if not exists bookings_hm_ref_uniq
  on public.bookings (external_booking_ref)
  where external_booking_ref ~ '^HM[A-Z0-9]{8,}$';

-- 2. Airbnb only ever exposes the phone's last 4 digits. Phone stays
--    mandatory for every other source.
alter table public.bookings alter column mobile_number drop not null;
alter table public.bookings drop constraint if exists bookings_mobile_required_unless_airbnb;
alter table public.bookings add constraint bookings_mobile_required_unless_airbnb
  check (mobile_number is not null or booking_source = 'airbnb');

-- 3. Tracking columns.
alter table public.bookings
  add column if not exists guest_phone_last4      text,
  add column if not exists auto_ingested_at       timestamptz,
  add column if not exists airbnb_details_pending boolean not null default false;

comment on column public.bookings.auto_ingested_at is
  'Set when the row was created by ingest-airbnb from the Airbnb iCal feed (not typed in admin).';
comment on column public.bookings.airbnb_details_pending is
  'true until guest name / count / payout have been filled from the Airbnb confirmation email.';

-- 4. Feed state (cancellation detection) + audit log. Service role only.
create table if not exists public.airbnb_feed_state (
  hm_code       text primary key,
  venue_id      bigint not null references public.venues(id) on delete cascade,
  start_date    date not null,
  end_date      date not null,
  phone_last4   text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  missing_runs  int not null default 0
);
create table if not exists public.airbnb_ingest_log (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  mode       text not null,
  hm_code    text,
  venue_id   bigint,
  booking_id bigint,
  action     text not null,
  detail     jsonb
);
create index if not exists airbnb_ingest_log_created_idx on public.airbnb_ingest_log (created_at desc);
alter table public.airbnb_feed_state enable row level security;
alter table public.airbnb_ingest_log enable row level security;
revoke all on public.airbnb_feed_state, public.airbnb_ingest_log from anon, authenticated;

-- 5a. Log helper. Review-type and dry-run actions repeat every hour while the
--     situation persists; log each (hm, action) at most once per 23h.
create or replace function public.airbnb_ingest_log_once(
  p_mode text, p_hm text, p_venue_id bigint, p_booking_id bigint, p_action text, p_detail jsonb
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_action in ('created', 'created_with_conflict', 'dates_updated', 'cancelled')
     or not exists (
       select 1 from airbnb_ingest_log l
       where l.hm_code = p_hm and l.action = p_action and l.mode = p_mode
         and l.created_at > now() - interval '23 hours')
  then
    insert into airbnb_ingest_log (mode, hm_code, venue_id, booking_id, action, detail)
    values (p_mode, p_hm, p_venue_id, p_booking_id, p_action, p_detail);
  end if;
end $$;

-- 5. Upsert one reservation seen in a feed.
create or replace function public.airbnb_ingest_upsert(
  p_mode text, p_hm text, p_venue_id bigint, p_start date, p_end date, p_last4 text
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_live   boolean := (p_mode = 'live');
  b        record;
  v_dup    record;
  v_parent bigint;
  v_conf   jsonb;
  v_id     bigint;
  v_action text;
  v_detail jsonb := '{}'::jsonb;
begin
  if p_mode not in ('live', 'dry_run') then raise exception 'bad mode %', p_mode; end if;
  if p_hm is null or p_hm !~ '^HM[A-Z0-9]{8,}$' then raise exception 'bad HM code %', p_hm; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'bad dates % - %', p_start, p_end; end if;

  insert into airbnb_feed_state (hm_code, venue_id, start_date, end_date, phone_last4)
  values (p_hm, p_venue_id, p_start, p_end, p_last4)
  on conflict (hm_code) do update set
    venue_id = excluded.venue_id, start_date = excluded.start_date, end_date = excluded.end_date,
    phone_last4 = coalesce(excluded.phone_last4, airbnb_feed_state.phone_last4),
    last_seen_at = now(), missing_runs = 0;

  select * into b from bookings where external_booking_ref = p_hm;

  if found then
    if b.booking_status = 'Cancelled' then
      v_action := 'seen_but_cancelled';          -- reappeared in the feed: human looks
      v_detail := jsonb_build_object('booking_id', b.id);
    elsif b.venue_id is distinct from p_venue_id then
      v_action := 'venue_mismatch';              -- never move a row between venues automatically
      v_detail := jsonb_build_object('db_venue', b.venue_id, 'feed_venue', p_venue_id);
    elsif b.preferred_date <> p_start or coalesce(b.checkout_date, b.preferred_date + 1) <> p_end then
      v_action := case when v_live then 'dates_updated' else 'would_update_dates' end;
      v_detail := jsonb_build_object('old', jsonb_build_array(b.preferred_date, b.checkout_date),
                                     'new', jsonb_build_array(p_start, p_end));
      if v_live then
        update bookings set preferred_date = p_start, checkout_date = p_end where id = b.id;
      end if;
    else
      if v_live and b.guest_phone_last4 is null and p_last4 is not null then
        update bookings set guest_phone_last4 = p_last4 where id = b.id;
      end if;
      return jsonb_build_object('action', 'unchanged', 'booking_id', b.id);  -- not logged (hourly noise)
    end if;
    perform airbnb_ingest_log_once(p_mode, p_hm, p_venue_id, b.id, v_action, v_detail);
    return jsonb_build_object('action', v_action, 'booking_id', b.id, 'detail', v_detail);
  end if;

  -- A hand-entered Airbnb row for the same stay without (or with a mistyped)
  -- HM code: do not create a twin, ask a human.
  select id, external_booking_ref, full_name into v_dup
  from bookings
  where venue_id = p_venue_id and booking_source = 'airbnb' and confirmed
    and coalesce(booking_status, '') <> 'Cancelled'
    and preferred_date < p_end and coalesce(checkout_date, preferred_date + 1) > p_start
  limit 1;
  if found then
    v_action := 'possible_duplicate';
    v_detail := jsonb_build_object('existing_booking_id', v_dup.id, 'existing_ref', v_dup.external_booking_ref,
                                   'existing_name', v_dup.full_name);
    perform airbnb_ingest_log_once(p_mode, p_hm, p_venue_id, v_dup.id, v_action, v_detail);
    return jsonb_build_object('action', v_action, 'detail', v_detail);
  end if;

  -- Overlap with any of OUR confirmed bookings on this unit, its whole-home
  -- parent, or its floors = a real double booking. Insert anyway, alert.
  select parent_venue_id into v_parent from venues where id = p_venue_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'booking_id', x.id, 'name', x.full_name, 'venue_id', x.venue_id,
           'from', x.preferred_date, 'to', x.checkout_date, 'source', x.booking_source)), '[]'::jsonb)
    into v_conf
  from bookings x
  where x.confirmed and coalesce(x.booking_status, '') <> 'Cancelled'
    and x.preferred_date < p_end and coalesce(x.checkout_date, x.preferred_date + 1) > p_start
    and (x.venue_id = p_venue_id
         or x.venue_id = v_parent
         or x.venue_id in (select id from venues where parent_venue_id = p_venue_id));

  v_action := case when v_live then '' else 'would_' end
           || case when jsonb_array_length(v_conf) > 0 then 'create_with_conflict' else 'create' end;
  if v_live then
    v_action := case when jsonb_array_length(v_conf) > 0 then 'created_with_conflict' else 'created' end;
  end if;
  v_detail := jsonb_build_object('from', p_start, 'to', p_end, 'last4', p_last4, 'conflicts', v_conf);

  if v_live then
    insert into bookings (
      full_name, mobile_number, guest_count, children_count,
      preferred_date, checkout_date, venue_id, external_booking_ref,
      confirmed, customer_intent, lead_status, lead_status_updated_at,
      advance_amount, payment_status, entry_source, send_guest_email,
      booking_source, includes_food, guest_phone_last4, auto_ingested_at, airbnb_details_pending
    ) values (
      'Airbnb guest (details pending)', null, 2, 0,
      p_start, p_end, p_venue_id, p_hm,
      true, 'lock', 'confirmed', now(),
      0, 'pending', 'admin', false,
      'airbnb', false, p_last4, now(), true
    ) returning id into v_id;
  end if;

  perform airbnb_ingest_log_once(p_mode, p_hm, p_venue_id, v_id, v_action, v_detail);
  return jsonb_build_object('action', v_action, 'booking_id', v_id, 'detail', v_detail);
end $$;

-- 6. Reservations that vanished from a successfully-fetched feed.
--    Future check-ins only; acts once, on the 2nd consecutive miss.
create or replace function public.airbnb_ingest_mark_missing(
  p_mode text, p_venue_id bigint, p_seen text[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_live boolean := (p_mode = 'live');
  r      record;
  b      record;
  n      int;
  v_out  jsonb := '[]'::jsonb;
  v_act  text;
begin
  if p_mode not in ('live', 'dry_run') then raise exception 'bad mode %', p_mode; end if;
  for r in
    select * from airbnb_feed_state s
    where s.venue_id = p_venue_id and s.start_date > current_date
      and not (s.hm_code = any (coalesce(p_seen, '{}'::text[])))
  loop
    update airbnb_feed_state set missing_runs = missing_runs + 1
      where hm_code = r.hm_code returning missing_runs into n;
    if n = 2 then
      select * into b from bookings where external_booking_ref = r.hm_code;
      if found and coalesce(b.booking_status, '') <> 'Cancelled' then
        v_act := case when v_live then 'cancelled' else 'would_cancel' end;
        if v_live then
          update bookings set booking_status = 'Cancelled', confirmed = false where id = b.id;
        end if;
        insert into airbnb_ingest_log (mode, hm_code, venue_id, booking_id, action, detail)
        values (p_mode, r.hm_code, p_venue_id, b.id, v_act,
                jsonb_build_object('name', b.full_name, 'from', b.preferred_date, 'to', b.checkout_date));
        v_out := v_out || jsonb_build_object('hm', r.hm_code, 'booking_id', b.id, 'action', v_act);
      end if;
    end if;
  end loop;
  return v_out;
end $$;

revoke all on function public.airbnb_ingest_log_once(text, text, bigint, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.airbnb_ingest_upsert(text, text, bigint, date, date, text) from public, anon, authenticated;
revoke all on function public.airbnb_ingest_mark_missing(text, bigint, text[]) from public, anon, authenticated;
grant execute on function public.airbnb_ingest_upsert(text, text, bigint, date, date, text) to service_role;
grant execute on function public.airbnb_ingest_mark_missing(text, bigint, text[]) to service_role;
