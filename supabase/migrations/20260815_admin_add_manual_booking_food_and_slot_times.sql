-- admin_add_manual_booking: accept + persist the food/slot-time overrides added
-- in 20260815_booking_food_inclusions_and_slot_times (includes_food,
-- food_items_count, beverage_items_count, slot_start_time, slot_end_time).
--
-- Normalisation rules (so a stored row can never contradict itself, and the
-- guest email never has to guess which half of a pair to trust):
--   - Unticking "Includes food" (includes_food is not true) clears both counts.
--   - No time slot (v_slot is null, i.e. a stay) clears both slot times.
--   - slot_end_time must be strictly after slot_start_time when both are set
--     (mirrors the bookings_slot_times_ordered check constraint, but raises a
--     friendlier admin-facing message before hitting the DB constraint).
--
-- No signature change (still (jsonb, jsonb)).
CREATE OR REPLACE FUNCTION public.admin_add_manual_booking(p_booking jsonb, p_add_ons jsonb DEFAULT '[]'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_venue_id   bigint := (p_booking->>'venue_id')::bigint;
  v_type       text;
  v_max        int;
  v_date       date := (p_booking->>'preferred_date')::date;
  v_checkout   date := nullif(p_booking->>'checkout_date', '')::date;
  v_end        date;
  v_slot       text := nullif(p_booking->>'time_slot', '');
  v_pkg_key    text := nullif(p_booking->>'package_key', '');
  v_pkg_name   text;
  v_pkg_tag    text;
  v_id         bigint;
  v_cnt        int;
  -- Manual overrides (see 20260815_booking_food_inclusions_and_slot_times).
  v_incl_food  boolean := (p_booking->>'includes_food')::boolean;
  v_food_ct    int  := nullif(p_booking->>'food_items_count', '')::int;
  v_bev_ct     int  := nullif(p_booking->>'beverage_items_count', '')::int;
  v_slot_start time := nullif(p_booking->>'slot_start_time', '')::time;
  v_slot_end   time := nullif(p_booking->>'slot_end_time', '')::time;
  d            date;
  a            jsonb;
begin
  -- Admin-only guard (matches the RLS policy convention).
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;

  if v_venue_id is null then raise exception 'Venue is required'; end if;
  select type, coalesce(max_concurrent_setups, 1) into v_type, v_max
    from venues where id = v_venue_id;
  if v_type is null then raise exception 'Unknown venue %', v_venue_id; end if;
  if v_date is null then raise exception 'Date is required'; end if;
  if coalesce(p_booking->>'full_name', '') = '' then raise exception 'Guest name is required'; end if;
  if coalesce(p_booking->>'mobile_number', '') = '' then raise exception 'Phone number is required'; end if;
  if coalesce((p_booking->>'guest_count')::int, 0) < 1 then raise exception 'Guest count is required'; end if;
  if v_checkout is not null and v_checkout <= v_date then
    raise exception 'Checkout must be after check-in';
  end if;
  v_end := coalesce(v_checkout, v_date + 1);

  -- Normalise the overrides so the stored row can never contradict itself:
  -- counts only persist when the box is ticked, times only when there IS a slot.
  if not coalesce(v_incl_food, false) then
    v_food_ct := null;
    v_bev_ct  := null;
  end if;
  if v_slot is null then
    v_slot_start := null;
    v_slot_end   := null;
  end if;
  if v_slot_start is not null and v_slot_end is not null and v_slot_end <= v_slot_start then
    raise exception 'Slot end time (%) must be after the start time (%)', v_slot_end, v_slot_start;
  end if;

  -- Conflict checks (authoritative; the form's disabled slots are hints only)
  if v_type in ('cafe', 'custom') then
    if v_slot is null then raise exception 'Time slot is required for picnic bookings'; end if;
    if exists (
      select 1 from venue_availability
      where venue_id = v_venue_id and date = v_date and source = 'admin'
        and (time_slot is null or time_slot = v_slot)
    ) then
      raise exception '% (%) is admin-blocked at this venue', v_date, v_slot;
    end if;
    select count(*) into v_cnt from bookings
      where venue_id = v_venue_id and confirmed = true
        and preferred_date = v_date and time_slot = v_slot;
    if v_cnt >= v_max then
      raise exception '% (%) already has %/% confirmed setup(s)', v_date, v_slot, v_cnt, v_max;
    end if;

  elsif v_type in ('self_managed', 'partner_bnb') then
    for d in select gs::date from generate_series(v_date, v_end - 1, interval '1 day') gs loop
      if exists (
        select 1 from venue_availability
        where venue_id = v_venue_id and date = d and source in ('admin', 'ical', 'parent')
      ) then
        raise exception '% is blocked (admin block, Airbnb booking, or whole-floor booking)', d;
      end if;
      select count(*) into v_cnt from bookings
        where venue_id = v_venue_id and confirmed = true
          and preferred_date <= d and coalesce(checkout_date, preferred_date + 1) > d;
      if v_cnt >= v_max then
        raise exception '% already has % confirmed stay(s)', d, v_cnt;
      end if;
    end loop;

  elsif v_type = 'combo' then
    for d in select gs::date from generate_series(v_date, v_end - 1, interval '1 day') gs loop
      if exists (
        select 1 from venue_availability
        where venue_id = v_venue_id and date = d and source in ('admin', 'ical', 'parent')
      ) then
        raise exception '% is blocked on the floor itself', d;
      end if;
      if exists (
        select 1 from venue_availability va
        join venues ch on ch.id = va.venue_id
        where ch.parent_venue_id = v_venue_id and va.date = d
          and va.source in ('admin', 'ical', 'parent')
      ) then
        raise exception '% is taken on a single unit inside the floor', d;
      end if;
      if exists (
        select 1 from bookings b
        join venues ch on ch.id = b.venue_id
        where ch.parent_venue_id = v_venue_id and b.confirmed = true
          and b.preferred_date <= d and coalesce(b.checkout_date, b.preferred_date + 1) > d
      ) then
        raise exception '% is already booked on a single unit inside the floor', d;
      end if;
    end loop;
  end if;

  -- Package snapshot (rename-safe, same pattern as submit_booking_intent)
  if v_pkg_key is not null then
    select name, tagline into v_pkg_name, v_pkg_tag from packages where key = v_pkg_key;
  end if;

  insert into bookings (
    full_name, mobile_number, email_address,
    guest_count, children_count,
    preferred_date, checkout_date, time_slot,
    special_requirements, occasion, board,
    venue_id, venue_address, external_booking_ref,
    confirmed, customer_intent, lead_status, lead_status_updated_at,
    advance_amount, total_amount, discount_amount, payment_status,
    package_key, package_name, package_tagline,
    entry_source, send_guest_email,
    includes_food, food_items_count, beverage_items_count,
    slot_start_time, slot_end_time
  ) values (
    p_booking->>'full_name',
    p_booking->>'mobile_number',
    nullif(p_booking->>'email_address', ''),
    (p_booking->>'guest_count')::int,
    coalesce((p_booking->>'children_count')::int, 0),
    v_date, v_checkout, v_slot,
    nullif(p_booking->>'special_requirements', ''),
    nullif(p_booking->>'occasion', ''),
    case when p_booking ? 'board' and jsonb_typeof(p_booking->'board') = 'object'
         then p_booking->'board' else null end,
    v_venue_id,
    nullif(p_booking->>'venue_address', ''),
    nullif(p_booking->>'external_booking_ref', ''),
    true, 'lock', 'confirmed', now(),
    coalesce((p_booking->>'advance_amount')::numeric, 0),
    nullif(p_booking->>'total_amount', '')::numeric,
    coalesce((p_booking->>'discount_amount')::numeric, 0),
    'pending',
    v_pkg_key, v_pkg_name, v_pkg_tag,
    'admin',
    coalesce((p_booking->>'send_guest_email')::boolean, true),
    v_incl_food, v_food_ct, v_bev_ct,
    v_slot_start, v_slot_end
  ) returning id into v_id;

  -- Add-ons in the same transaction (email fns read them after commit)
  for a in select * from jsonb_array_elements(coalesce(p_add_ons, '[]'::jsonb)) loop
    insert into booking_add_ons (booking_id, addon_id, name, price_at_booking, requires_confirmation)
    values (
      v_id,
      (a->>'addon_id')::int,
      coalesce(a->>'name', ''),
      coalesce((a->>'price')::numeric, 0),
      coalesce((a->>'requires_confirmation')::boolean, false)
    );
  end loop;

  -- Combo fanout: parent blocks on every child x every night, atomic with
  -- the booking so they can never diverge (rides export-ical out to Airbnb).
  if v_type = 'combo' then
    insert into venue_availability (venue_id, date, status, source, booking_id, time_slot)
    select ch.id, gs::date, 'blocked', 'parent', v_id, null
    from venues ch
    cross join generate_series(v_date, v_end - 1, interval '1 day') gs
    where ch.parent_venue_id = v_venue_id;
  end if;

  return v_id;
end;
$function$
