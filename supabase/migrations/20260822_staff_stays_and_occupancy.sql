-- ============================================================================
-- Staff tool — PHASE 7: Airbnb / stays tab.
-- Plan: docs/STAFF_STATUS_TOOL_PLAN.md
--
-- Adds two lifecycle steps (checked_in / checked_out) and three new arrays to
-- staff_today: stays, stays_upcoming, occupancy.
--
-- Picnic behaviour is untouched. staff_event_ids_active/_upcoming and the
-- picnic spine are not modified.
--
-- 🔴 TWO DATA TRAPS THIS ENCODES (verified live 2026-08-22):
--   1. DOUBLE-LISTING. iCal blocks and manually-entered stay rows are disjoint
--      records of the SAME reservation — bookings 106/76/97 each had 3
--      overlapping iCal nights, #91 had 11. occupancy[] therefore suppresses any
--      night already covered by a confirmed stay row for that venue.
--   2. COMBO VENUES. TerraCottage Sienna (type='combo') carries 198 iCal dates
--      because it inherits its children's bookings. Its occupancy is duplicate
--      by construction, so combo venues are excluded from occupancy[] entirely.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Two new steps. Picnic steps and stay steps share one table but never one
--    booking — staff_log_step rejects a cross-kind step as 'wrong_kind'.
-- ---------------------------------------------------------------------------
alter table public.booking_event_log drop constraint booking_event_log_step_check;
alter table public.booking_event_log add constraint booking_event_log_step_check
  check (step in (
    -- picnic
    'reached','setup_done','payment_received','wrapped','guests_arrived','guests_left',
    -- stay
    'checked_in','checked_out'
  ));

comment on column public.booking_event_log.step is
  'Picnic spine: reached -> setup_done -> payment_received -> wrapped (chips: guests_arrived, guests_left). Stay spine: checked_in -> payment_received -> checked_out. payment_received is shared; every other step is kind-specific and staff_log_step enforces it.';

-- ---------------------------------------------------------------------------
-- 2. Stay scopes. A stay is "active" from its check-in date through its
--    check-out date inclusive — staff act on it on arrival day, any day
--    in-house, and departure day.
-- ---------------------------------------------------------------------------
create or replace function public.staff_stay_ids_active()
returns setof bigint
language sql stable security definer set search_path = public
as $$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and b.checkout_date is not null
    and (now() at time zone 'Asia/Kolkata')::date between b.preferred_date and b.checkout_date
$$;

create or replace function public.staff_stay_ids_upcoming()
returns setof bigint
language sql stable security definer set search_path = public
as $$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and b.checkout_date is not null
    and b.preferred_date > (now() at time zone 'Asia/Kolkata')::date
$$;

revoke all on function public.staff_stay_ids_active()   from public, anon, authenticated;
revoke all on function public.staff_stay_ids_upcoming() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. iCal occupancy with no booking row — contiguous ranges per venue.
--    This is the "we know someone is in there, we just haven't entered them"
--    signal. Read-only by definition: no booking_id means nothing to log against.
-- ---------------------------------------------------------------------------
create or replace function public.staff_occupancy_upcoming()
returns table (venue_id bigint, venue_name text, from_date date, to_date date)
language sql stable security definer set search_path = public
as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date d),
  raw as (
    select va.venue_id, va.date, v.name as venue_name
    from public.venue_availability va
    join public.venues v on v.id = va.venue_id
    cross join today
    where va.source = 'ical'
      and va.booking_id is null
      and v.type <> 'combo'                     -- trap 2: combo inherits its children
      and va.date >= today.d
      and va.date < today.d + 120
      -- trap 1: drop nights already explained by a real stay row
      and not exists (
        select 1 from public.bookings b
        where b.venue_id = va.venue_id
          and b.confirmed = true
          and coalesce(b.booking_status, '') <> 'Cancelled'
          and b.checkout_date is not null
          and va.date >= b.preferred_date
          and va.date <  b.checkout_date
      )
  ),
  grouped as (
    select venue_id, venue_name, date,
           date - (row_number() over (partition by venue_id order by date))::int as grp
    from raw
  )
  select venue_id, venue_name, min(date) as from_date, max(date) as to_date
  from grouped
  group by venue_id, venue_name, grp
  order by min(date), venue_name
$$;

revoke all on function public.staff_occupancy_upcoming() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. staff_today — adds stays[], stays_upcoming[], occupancy[].
--    Picnic arrays are byte-identical to Phase 2b.
--
-- 🔴 Money on a stay is NOT the same as on a picnic. An Airbnb-platform booking
--    (external_booking_ref present) is collected by Airbnb — staff must never be
--    told to collect it. Only a DIRECT stay can carry a real balance. The flag
--    `collect_on_arrival` encodes that; the raw balance is only sent when true.
-- ---------------------------------------------------------------------------
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
      case when b.preferred_date = v_today then 0        -- arriving today
           when b.checkout_date  = v_today then 1        -- departing today
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
        'source', case when b.external_booking_ref is not null then 'airbnb' else 'direct' end,
        -- Airbnb collects its own money. Only a direct booking can leave a balance.
        'collect_on_arrival', (b.external_booking_ref is null
                               and greatest(coalesce(b.total_amount,0) - coalesce(b.advance_amount,0), 0) > 0),
        'balance_due', case when b.external_booking_ref is null
                            then greatest(coalesce(b.total_amount,0) - coalesce(b.advance_amount,0), 0)
                            else null end,
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
        'source', case when b.external_booking_ref is not null then 'airbnb' else 'direct' end,
        'special_requirements', b.special_requirements,
        'venue', jsonb_build_object('name', v.name, 'area', v.area, 'city', v.city)
        -- NO mobile. NO balance. Same rule as picnic upcoming[].
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

-- ---------------------------------------------------------------------------
-- 5. staff_log_step — kind-aware spine.
-- ---------------------------------------------------------------------------
create or replace function public.staff_log_step(
  p_token      text,
  p_booking_id bigint,
  p_step       text,
  p_note       text    default null,
  p_amount     numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tok    public.staff_tokens%rowtype;
  v_needs  text;
  v_new    boolean := false;
  v_log    jsonb;
  v_isstay boolean;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  select * into v_tok
  from public.staff_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if p_step is not distinct from null
     or p_step not in ('reached','setup_done','payment_received','wrapped',
                       'guests_arrived','guests_left','checked_in','checked_out') then
    return jsonb_build_object('ok', false, 'error', 'unknown_step');
  end if;

  -- 🔴 Writable set only. Picnics: today + 04:00 grace. Stays: check-in through
  --    check-out. A token can never write to a future booking of either kind.
  if exists (select 1 from public.staff_event_ids_active() x where x = p_booking_id) then
    v_isstay := false;
  elsif exists (select 1 from public.staff_stay_ids_active() x where x = p_booking_id) then
    v_isstay := true;
  else
    return jsonb_build_object('ok', false, 'error', 'not_today');
  end if;

  -- Steps do not cross kinds. payment_received is the one shared step.
  if v_isstay and p_step in ('reached','setup_done','wrapped','guests_arrived','guests_left') then
    return jsonb_build_object('ok', false, 'error', 'wrong_kind');
  end if;
  if not v_isstay and p_step in ('checked_in','checked_out') then
    return jsonb_build_object('ok', false, 'error', 'wrong_kind');
  end if;

  if p_amount is not null and p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;

  v_needs := case
    when v_isstay then case p_step
                         when 'payment_received' then 'checked_in'
                         when 'checked_out'      then 'checked_in'
                         else null end
    else case p_step
           when 'setup_done'       then 'reached'
           when 'payment_received' then 'setup_done'
           when 'wrapped'          then 'payment_received'
           else null end
  end;

  if v_needs is not null
     and not exists (select 1 from public.booking_event_log
                     where booking_id = p_booking_id and step = v_needs) then
    return jsonb_build_object('ok', false, 'error', 'out_of_order', 'needs', v_needs);
  end if;

  insert into public.booking_event_log (booking_id, step, staff_token_id, by_name, note, amount)
  values (p_booking_id, p_step, v_tok.id, v_tok.staff_name,
          nullif(btrim(coalesce(p_note, '')), ''),
          case when p_step = 'payment_received' then p_amount else null end)
  on conflict (booking_id, step) do nothing;

  v_new := found;

  select coalesce(jsonb_agg(jsonb_build_object('step', l.step, 'at', l.at, 'by', l.by_name,
           'note', l.note, 'amount', l.amount) order by l.at, l.id), '[]'::jsonb)
    into v_log
  from public.booking_event_log l where l.booking_id = p_booking_id;

  update public.staff_tokens set last_used_at = now() where id = v_tok.id;

  return jsonb_build_object('ok', true, 'step', p_step, 'created', v_new,
                            'booking_id', p_booking_id, 'log', v_log);
end;
$$;
