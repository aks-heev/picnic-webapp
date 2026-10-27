-- 20261027_airbnb_ingest_cancellations.sql
-- Airbnb "Cancelled: Reservation HMXXXX for …" emails become authoritative.
--
-- Incident that prompted this: the first email-ingest run (14-day backfill)
-- read Tanushree Mundhra's confirmation (HMMJQCJA2Z, Boho, 20 Oct) and created
-- booking #329 — but the guest had cancelled on 14 Oct, which is why no row
-- existed. The feed path's cancellation detection only covers FUTURE check-ins
-- that vanish from the feed, so a past/backfilled stay had no protection.
--
-- Rules after this migration:
--   * airbnb_cancellations records every HM code Airbnb has emailed a
--     cancellation for. Nothing (feed or email) ever creates a row for one.
--   * airbnb_ingest_cancel() cancels the matching row whoever created it —
--     auto-ingested or typed in admin — because Airbnb is the source of truth
--     for an Airbnb reservation.
--   * airbnb_ingest_email() no longer CREATES a row for a stay that has already
--     checked out (backfill guard); it logs email_past_stay_not_created instead.
--   * The Apps Script processes cancellation emails BEFORE confirmations in the
--     same run, so a backfill sees the cancellation first.

create table if not exists public.airbnb_cancellations (
  hm_code      text primary key,
  cancelled_at timestamptz not null default now(),
  detail       jsonb
);
alter table public.airbnb_cancellations enable row level security;
revoke all on public.airbnb_cancellations from anon, authenticated;

create or replace function public.airbnb_ingest_cancel(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hm text := upper(coalesce(p->>'hm', ''));
  b    record;
begin
  if v_hm !~ '^HM[A-Z0-9]{8,}$' then raise exception 'bad HM code %', v_hm; end if;
  insert into airbnb_cancellations (hm_code, detail) values (v_hm, p) on conflict (hm_code) do nothing;

  select * into b from bookings where external_booking_ref = v_hm;
  if not found then
    perform airbnb_ingest_log_once('live', v_hm, null, null, 'cancel_email_no_row', p);
    return jsonb_build_object('action', 'cancel_email_no_row');
  end if;
  if b.booking_status = 'Cancelled' then
    perform airbnb_ingest_log_once('live', v_hm, b.venue_id, b.id, 'cancel_email_already_cancelled', null);
    return jsonb_build_object('action', 'cancel_email_already_cancelled', 'booking_id', b.id);
  end if;

  update bookings set booking_status = 'Cancelled', confirmed = false where id = b.id;
  insert into airbnb_ingest_log (mode, hm_code, venue_id, booking_id, action, detail)
  values ('live', v_hm, b.venue_id, b.id, 'cancelled_by_email',
          jsonb_build_object('name', b.full_name, 'from', b.preferred_date, 'to', b.checkout_date,
                             'auto_ingested', b.auto_ingested_at is not null, 'email', p));
  return jsonb_build_object('action', 'cancelled_by_email', 'booking_id', b.id);
end $$;

-- Feed path: never resurrect a cancelled HM code.
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
      v_action := 'seen_but_cancelled';
      v_detail := jsonb_build_object('booking_id', b.id);
    elsif b.venue_id is distinct from p_venue_id then
      v_action := 'venue_mismatch';
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
      return jsonb_build_object('action', 'unchanged', 'booking_id', b.id);
    end if;
    perform airbnb_ingest_log_once(p_mode, p_hm, p_venue_id, b.id, v_action, v_detail);
    return jsonb_build_object('action', v_action, 'booking_id', b.id, 'detail', v_detail);
  end if;

  if exists (select 1 from airbnb_cancellations c where c.hm_code = p_hm) then
    perform airbnb_ingest_log_once(p_mode, p_hm, p_venue_id, null, 'seen_but_cancelled', null);
    return jsonb_build_object('action', 'seen_but_cancelled');
  end if;

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

-- Email path: respect cancellations; never create an already-finished stay.
create or replace function public.airbnb_ingest_email(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hm     text    := upper(coalesce(p->>'hm', ''));
  v_room   text    := coalesce(p->>'room_id', '');
  v_name   text    := nullif(btrim(coalesce(p->>'name', '')), '');
  v_adults int     := coalesce((p->>'adults')::int, 0);
  v_kids   int     := coalesce((p->>'children')::int, 0);
  v_fee    numeric := (p->>'room_fee')::numeric;
  v_earn   numeric := (p->>'you_earn')::numeric;
  v_in     date    := (p->>'checkin')::date;
  v_out    date    := (p->>'checkout')::date;
  v_venue  bigint;
  v_total  numeric;
  b        record;
  r        jsonb;
  v_detail jsonb;
begin
  if v_hm !~ '^HM[A-Z0-9]{8,}$' then raise exception 'bad HM code %', v_hm; end if;
  if v_room !~ '^\d{6,}$' then raise exception 'bad room id %', v_room; end if;
  if v_name is null then raise exception 'name required'; end if;
  if v_adults < 1 then raise exception 'adults required'; end if;
  if v_fee is null or v_fee <= 0 or v_earn is null or v_earn <= 0 then raise exception 'room fee / you earn required'; end if;
  if v_in is null or v_out is null or v_out <= v_in then raise exception 'bad dates % - %', v_in, v_out; end if;

  if exists (select 1 from airbnb_cancellations c where c.hm_code = v_hm) then
    perform airbnb_ingest_log_once('live', v_hm, null, null, 'email_skipped_cancelled', null);
    return jsonb_build_object('action', 'email_skipped_cancelled');
  end if;

  select id into v_venue from venues where airbnb_ical_url ~ ('/ical/' || v_room || '\.ics');
  if v_venue is null then
    perform airbnb_ingest_log_once('live', v_hm, null, null, 'email_unknown_listing', p);
    return jsonb_build_object('action', 'email_unknown_listing');
  end if;

  v_total := round(v_earn - v_fee * 0.001, 2);

  select * into b from bookings where external_booking_ref = v_hm;
  if not found then
    if v_out < current_date then
      perform airbnb_ingest_log_once('live', v_hm, v_venue, null, 'email_past_stay_not_created', p);
      return jsonb_build_object('action', 'email_past_stay_not_created');
    end if;
    r := airbnb_ingest_upsert('live', v_hm, v_venue, v_in, v_out, null);
    if coalesce(r->>'action', '') not in ('created', 'created_with_conflict') then
      perform airbnb_ingest_log_once('live', v_hm, v_venue, null, 'email_create_blocked', r);
      return jsonb_build_object('action', 'email_create_blocked', 'detail', r);
    end if;
    select * into b from bookings where external_booking_ref = v_hm;
  end if;

  if not b.airbnb_details_pending then
    perform airbnb_ingest_log_once('live', v_hm, b.venue_id, b.id, 'email_skipped_filled_row', null);
    return jsonb_build_object('action', 'email_skipped_filled_row', 'booking_id', b.id);
  end if;

  update bookings set
    full_name = v_name,
    guest_count = greatest(v_adults + v_kids, 1),
    children_count = v_kids,
    total_amount = v_total,
    stay_amount = v_total,
    picnic_amount = 0,
    airbnb_details_pending = false
  where id = b.id;

  v_detail := jsonb_build_object('name', v_name, 'adults', v_adults, 'children', v_kids,
                                 'room_fee', v_fee, 'you_earn', v_earn, 'total_amount', v_total,
                                 'email_dates', jsonb_build_array(v_in, v_out),
                                 'row_dates', jsonb_build_array(b.preferred_date, b.checkout_date),
                                 'venue_matches', b.venue_id = v_venue);
  insert into airbnb_ingest_log (mode, hm_code, venue_id, booking_id, action, detail)
  values ('live', v_hm, b.venue_id, b.id, 'email_enriched', v_detail);
  return jsonb_build_object('action', 'email_enriched', 'booking_id', b.id, 'detail', v_detail);
end $$;

revoke all on function public.airbnb_ingest_cancel(jsonb) from public, anon, authenticated;
grant execute on function public.airbnb_ingest_cancel(jsonb) to service_role;
