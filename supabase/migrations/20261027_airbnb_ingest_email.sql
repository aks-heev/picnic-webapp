-- 20261027_airbnb_ingest_email.sql
-- Phase 2 of Airbnb auto-ingest: the "Reservation confirmed" email fills in
-- what the iCal feed can't carry — guest name, guest count, payout.
--
-- Caller: Apps Script ingestAirbnbEmails() (scripts/airbnb-email-ingest.gs),
-- every 15 min, with the service_role key it already holds for syncBookings.
--
--   * Venue is resolved from the Airbnb room id in the email, matched against
--     venues.airbnb_ical_url (…/calendar/ical/<roomid>.ics). No hardcoded ids.
--   * total_amount = "YOU EARN" − 0.1% TDS on the room fee — the convention
--     every hand-entered Airbnb row already follows (#316/#317/#318 reproduce
--     to the paisa).
--   * Email before feed: if the HM code has no row yet, the row is created via
--     airbnb_ingest_upsert('live', …) so the duplicate/conflict checks and the
--     log are identical to the hourly feed path.
--   * Only rows still flagged airbnb_details_pending are written. A row a human
--     typed or edited is never overwritten.
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

  select id into v_venue from venues where airbnb_ical_url ~ ('/ical/' || v_room || '\.ics');
  if v_venue is null then
    perform airbnb_ingest_log_once('live', v_hm, null, null, 'email_unknown_listing', p);
    return jsonb_build_object('action', 'email_unknown_listing');
  end if;

  v_total := round(v_earn - v_fee * 0.001, 2);

  select * into b from bookings where external_booking_ref = v_hm;
  if not found then
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

revoke all on function public.airbnb_ingest_email(jsonb) from public, anon, authenticated;
grant execute on function public.airbnb_ingest_email(jsonb) to service_role;
