-- ============================================================================
-- Staff tool — fix: stay channel detection + money layering.
-- Plan: docs/STAFF_STATUS_TOOL_PLAN.md
--
-- BUG (reported 2026-08-22): every in-house stay showed "Paid via Airbnb", including
-- direct ones. Phase 7 treated `external_booking_ref IS NOT NULL` as "this is an
-- Airbnb booking". That is wrong — the column is FREE TEXT holding mixed
-- semantics. Live values today:
--     14 real Airbnb codes matching ^HM[A-Z0-9]{8}$   (all have zero balance)
--      4 'WhatsApp'          (direct; 2 carry a real balance)
--      3 'direct-extension'  (direct; a guest who arrived via Airbnb then
--                             extended directly, so the row keeps the old code
--                             in its notes but is NOT an Airbnb reservation)
--      1 'Direct', 1 null    (direct)
--
-- 🔴 THE REAL LESSON, encoded below: a fragile string test must never gate a
--    MONEY decision. collect_on_arrival is now driven purely by
--    (total_amount - advance_amount) > 0, independent of channel. The channel
--    only chooses the wording. If the channel guess is ever wrong, staff still
--    get the right instruction about money — which is the part that can cost
--    real rupees.
-- ============================================================================

-- Airbnb confirmation codes are 10 uppercase alphanumerics beginning HM.
-- Anything else in external_booking_ref is a channel label, not a reservation.
create or replace function public.staff_is_airbnb_ref(p_ref text)
returns boolean
language sql immutable
set search_path = public
as $$ select p_ref is not null and p_ref ~ '^HM[A-Z0-9]{8}$' $$;

revoke all on function public.staff_is_airbnb_ref(text) from public, anon, authenticated;

create or replace function public.staff_today(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tok        public.staff_tokens%rowtype;
  v_events     jsonb;
  v_upcoming   jsonb;
  v_stays      jsonb;
  v_stays_up   jsonb;
  v_occupancy  jsonb;
  v_today      date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  select * into v_tok
  from public.staff_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  -- ---------------- picnics today (unchanged) ----------------
  select coalesce(jsonb_agg(e order by e_sort_date, e_sort_time nulls last, e_sort_id), '[]'::jsonb)
    into v_events
  from (
    select b.preferred_date as e_sort_date, b.slot_start_time as e_sort_time, b.id as e_sort_id,
      jsonb_build_object(
        'id', b.id, 'date', b.preferred_date, 'guest_name', b.full_name,
        'mobile', b.mobile_number, 'guests', b.guest_count, 'children', b.children_count,
        'time_slot', b.time_slot, 'slot_start', b.slot_start_time, 'slot_end', b.slot_end_time,
        'occasion', b.occasion, 'package_name', b.package_name,
        'special_requirements', b.special_requirements,
        'includes_food', b.includes_food, 'food_items_count', b.food_items_count,
        'beverage_items_count', b.beverage_items_count,
        'total_amount', b.total_amount, 'advance_amount', b.advance_amount,
        'balance_due', greatest(coalesce(b.total_amount,0) - coalesce(b.advance_amount,0), 0),
        'venue', jsonb_build_object('name', v.name, 'area', v.area, 'city', v.city,
                                    'address', b.venue_address, 'maps_url', v.maps_url),
        'add_ons', coalesce((select jsonb_agg(jsonb_build_object('name', ba.name, 'price', ba.price_at_booking) order by ba.id)
                             from public.booking_add_ons ba where ba.booking_id = b.id), '[]'::jsonb),
        'log', coalesce((select jsonb_agg(jsonb_build_object('step', l.step, 'at', l.at, 'by', l.by_name,
                                 'note', l.note, 'amount', l.amount) order by l.at, l.id)
                         from public.booking_event_log l where l.booking_id = b.id), '[]'::jsonb)
      ) as e
    from public.bookings b
    left join public.venues v on v.id = b.venue_id
    where b.id in (select public.staff_event_ids_active())
  ) s;

  -- ---------------- picnics upcoming (unchanged) ----------------
  select coalesce(jsonb_agg(u order by u_sort_date, u_sort_time nulls last, u_sort_id), '[]'::jsonb)
    into v_upcoming
  from (
    select b.preferred_date as u_sort_date, b.slot_start_time as u_sort_time, b.id as u_sort_id,
      jsonb_build_object(
        'id', b.id, 'date', b.preferred_date, 'guest_name', b.full_name,
        'guests', b.guest_count, 'children', b.children_count,
        'time_slot', b.time_slot, 'slot_start', b.slot_start_time, 'slot_end', b.slot_end_time,
        'occasion', b.occasion, 'package_name', b.package_name,
        'special_requirements', b.special_requirements, 'includes_food', b.includes_food,
        'food_items_count', b.food_items_count, 'beverage_items_count', b.beverage_items_count,
        'venue', jsonb_build_object('name', v.name, 'area', v.area, 'city', v.city),
        'add_ons', coalesce((select jsonb_agg(jsonb_build_object('name', ba.name) order by ba.id)
                             from public.booking_add_ons ba where ba.booking_id = b.id), '[]'::jsonb)
      ) as u
    from public.bookings b
    left join public.venues v on v.id = b.venue_id
    where b.id in (select public.staff_event_ids_upcoming())
  ) t;

  -- ---------------- stays active today ----------------
  select coalesce(jsonb_agg(st order by st_sort_phase, st_sort_date, st_sort_id), '[]'::jsonb)
    into v_stays
  from (
    select
      case when b.preferred_date = v_today then 0
           when b.checkout_date  = v_today then 1
           else 2 end                       as st_sort_phase,
      b.preferred_date as st_sort_date, b.id as st_sort_id,
      jsonb_build_object(
        'id', b.id,
        'guest_name', b.full_name,
        'mobile', b.mobile_number,
        'guests', b.guest_count,
        'children', b.children_count,
        'check_in', b.preferred_date,
        'check_out', b.checkout_date,
        'nights', (b.checkout_date - b.preferred_date),
        'phase', case when b.preferred_date = v_today then 'arriving'
                      when b.checkout_date  = v_today then 'departing'
                      else 'in_house' end,
        'special_requirements', b.special_requirements,
        -- display only
        'source', case when public.staff_is_airbnb_ref(b.external_booking_ref)
                       then 'airbnb' else 'direct' end,
        -- 🔴 money is decided by the money, never by the channel guess
        'collect_on_arrival', (greatest(coalesce(b.total_amount,0) - coalesce(b.advance_amount,0), 0) > 0),
        'balance_due', nullif(greatest(coalesce(b.total_amount,0) - coalesce(b.advance_amount,0), 0), 0),
        'venue', jsonb_build_object('name', v.name, 'area', v.area, 'city', v.city,
                                    'address', b.venue_address, 'maps_url', v.maps_url),
        'log', coalesce((select jsonb_agg(jsonb_build_object('step', l.step, 'at', l.at, 'by', l.by_name,
                                 'note', l.note, 'amount', l.amount) order by l.at, l.id)
                         from public.booking_event_log l where l.booking_id = b.id), '[]'::jsonb)
      ) as st
    from public.bookings b
    left join public.venues v on v.id = b.venue_id
    where b.id in (select public.staff_stay_ids_active())
  ) q;

  -- ---------------- stays upcoming (planning detail only) ----------------
  select coalesce(jsonb_agg(su order by su_sort_date, su_sort_id), '[]'::jsonb)
    into v_stays_up
  from (
    select b.preferred_date as su_sort_date, b.id as su_sort_id,
      jsonb_build_object(
        'id', b.id, 'guest_name', b.full_name,
        'guests', b.guest_count, 'children', b.children_count,
        'check_in', b.preferred_date, 'check_out', b.checkout_date,
        'nights', (b.checkout_date - b.preferred_date),
        'source', case when public.staff_is_airbnb_ref(b.external_booking_ref)
                       then 'airbnb' else 'direct' end,
        -- a heads-up that money will be due on arrival, WITHOUT the figure
        'will_collect', (greatest(coalesce(b.total_amount,0) - coalesce(b.advance_amount,0), 0) > 0),
        'special_requirements', b.special_requirements,
        'venue', jsonb_build_object('name', v.name, 'area', v.area, 'city', v.city)
        -- NO mobile. NO balance figure. Same rule as picnic upcoming[].
      ) as su
    from public.bookings b
    left join public.venues v on v.id = b.venue_id
    where b.id in (select public.staff_stay_ids_upcoming())
  ) r;

  -- ---------------- iCal occupancy with no booking row ----------------
  select coalesce(jsonb_agg(jsonb_build_object(
           'venue_name', o.venue_name, 'from_date', o.from_date, 'to_date', o.to_date,
           'nights', (o.to_date - o.from_date) + 1)
         order by o.from_date, o.venue_name), '[]'::jsonb)
    into v_occupancy
  from public.staff_occupancy_upcoming() o;

  update public.staff_tokens set last_used_at = now() where id = v_tok.id;

  return jsonb_build_object(
    'ok', true,
    'staff', jsonb_build_object('name', v_tok.staff_name, 'upload_prefix', v_tok.upload_prefix),
    'date', v_today,
    'server_time', now(),
    'events', v_events,
    'upcoming', v_upcoming,
    'stays', v_stays,
    'stays_upcoming', v_stays_up,
    'occupancy', v_occupancy
  );
end;
$$;
