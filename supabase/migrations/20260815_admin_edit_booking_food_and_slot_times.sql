-- admin_edit_booking: accept + persist the same food/slot-time overrides added
-- to admin_add_manual_booking in 20260815_admin_add_manual_booking_food_and_slot_times
-- (includes_food, food_items_count, beverage_items_count, slot_start_time,
-- slot_end_time). Same normalisation rules as the add path — unticking the
-- box clears the counts, removing the slot clears the times, so a row can
-- never hold orphaned values that the emails would then render.
--
-- No signature change (still (bigint, jsonb, jsonb)).
CREATE OR REPLACE FUNCTION public.admin_edit_booking(p_booking_id bigint, p_booking jsonb, p_add_ons jsonb DEFAULT '[]'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_existing   public.bookings%rowtype;
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
  v_advance    numeric;
  v_total      numeric := nullif(p_booking->>'total_amount', '')::numeric;
  v_cnt        int;
  v_was_mine   boolean;
  v_incl_food  boolean := (p_booking->>'includes_food')::boolean;
  v_food_ct    int  := nullif(p_booking->>'food_items_count', '')::int;
  v_bev_ct     int  := nullif(p_booking->>'beverage_items_count', '')::int;
  v_slot_start time := nullif(p_booking->>'slot_start_time', '')::time;
  v_slot_end   time := nullif(p_booking->>'slot_end_time', '')::time;
  d            date;
  a            jsonb;
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;

  if p_booking_id is null then raise exception 'Booking id is required'; end if;

  select * into v_existing from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking % not found', p_booking_id; end if;

  if v_venue_id is null then raise exception 'Venue is required'; end if;
  select type, coalesce(max_concurrent_setups, 1) into v_type, v_max
    from public.venues where id = v_venue_id;
  if v_type is null then raise exception 'Unknown venue %', v_venue_id; end if;
  if v_date is null then raise exception 'Date is required'; end if;
  if coalesce(p_booking->>'full_name', '') = '' then raise exception 'Guest name is required'; end if;
  if coalesce(p_booking->>'mobile_number', '') = '' then raise exception 'Phone number is required'; end if;
  if coalesce((p_booking->>'guest_count')::int, 0) < 1 then raise exception 'Guest count is required'; end if;
  if v_checkout is not null and v_checkout <= v_date then
    raise exception 'Checkout must be after check-in';
  end if;
  v_end := coalesce(v_checkout, v_date + 1);

  -- Same normalisation as the add path: unticking the box clears the counts,
  -- and removing the slot clears the times, so a row can never hold orphaned
  -- values that the emails would then render.
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

  if v_existing.payment_status = 'paid' then
    v_advance := v_existing.advance_amount;
  else
    v_advance := coalesce((p_booking->>'advance_amount')::numeric, 0);
  end if;
  if v_total is not null and v_total < v_advance then
    raise exception 'Total (%) cannot be less than the advance already set (%)', v_total, v_advance;
  end if;

  -- Conflict checks: skip any (venue, night) this booking already occupies.
  if v_existing.confirmed then
    if v_type in ('cafe', 'custom') then
      if v_slot is null then raise exception 'Time slot is required for picnic bookings'; end if;

      v_was_mine := (v_venue_id = v_existing.venue_id
                     and v_date = v_existing.preferred_date
                     and v_slot is not distinct from v_existing.time_slot);

      if not v_was_mine then
        if exists (
          select 1 from public.venue_availability
          where venue_id = v_venue_id and date = v_date and source = 'admin'
            and (time_slot is null or time_slot = v_slot)
            and booking_id is distinct from p_booking_id
        ) then
          raise exception '% (%) is admin-blocked at this venue', v_date, v_slot;
        end if;
        select count(*) into v_cnt from public.bookings
          where venue_id = v_venue_id and confirmed = true
            and preferred_date = v_date and time_slot = v_slot
            and id <> p_booking_id;
        if v_cnt >= v_max then
          raise exception '% (%) already has %/% confirmed setup(s)', v_date, v_slot, v_cnt, v_max;
        end if;
      end if;

    elsif v_type in ('self_managed', 'partner_bnb') then
      for d in select gs::date from generate_series(v_date, v_end - 1, interval '1 day') gs loop
        v_was_mine := (v_venue_id = v_existing.venue_id
                       and d >= v_existing.preferred_date
                       and d <  coalesce(v_existing.checkout_date, v_existing.preferred_date + 1));

        if not v_was_mine then
          if exists (
            select 1 from public.venue_availability
            where venue_id = v_venue_id and date = d and source in ('admin', 'ical', 'parent')
              and booking_id is distinct from p_booking_id
          ) then
            raise exception '% is blocked (admin block, Airbnb booking, or whole-floor booking)', d;
          end if;
          select count(*) into v_cnt from public.bookings
            where venue_id = v_venue_id and confirmed = true
              and preferred_date <= d and coalesce(checkout_date, preferred_date + 1) > d
              and id <> p_booking_id;
          if v_cnt >= v_max then
            raise exception '% already has % confirmed stay(s)', d, v_cnt;
          end if;
        end if;
      end loop;

    elsif v_type = 'combo' then
      for d in select gs::date from generate_series(v_date, v_end - 1, interval '1 day') gs loop
        v_was_mine := (v_venue_id = v_existing.venue_id
                       and d >= v_existing.preferred_date
                       and d <  coalesce(v_existing.checkout_date, v_existing.preferred_date + 1));

        if not v_was_mine then
          if exists (
            select 1 from public.venue_availability
            where venue_id = v_venue_id and date = d and source in ('admin', 'ical', 'parent')
              and booking_id is distinct from p_booking_id
          ) then
            raise exception '% is blocked on the floor itself', d;
          end if;
          if exists (
            select 1 from public.venue_availability va
            join public.venues ch on ch.id = va.venue_id
            where ch.parent_venue_id = v_venue_id and va.date = d
              and va.source in ('admin', 'ical', 'parent')
              and va.booking_id is distinct from p_booking_id
          ) then
            raise exception '% is taken on a single unit inside the floor', d;
          end if;
          if exists (
            select 1 from public.bookings b
            join public.venues ch on ch.id = b.venue_id
            where ch.parent_venue_id = v_venue_id and b.confirmed = true
              and b.preferred_date <= d and coalesce(b.checkout_date, b.preferred_date + 1) > d
              and b.id <> p_booking_id
          ) then
            raise exception '% is already booked on a single unit inside the floor', d;
          end if;
        end if;
      end loop;
    end if;
  end if;

  if v_pkg_key is not null then
    select name, tagline into v_pkg_name, v_pkg_tag from public.packages where key = v_pkg_key;
  end if;

  update public.bookings set
    full_name            = p_booking->>'full_name',
    mobile_number        = p_booking->>'mobile_number',
    email_address        = nullif(p_booking->>'email_address', ''),
    guest_count          = (p_booking->>'guest_count')::int,
    children_count       = coalesce((p_booking->>'children_count')::int, 0),
    preferred_date       = v_date,
    checkout_date        = v_checkout,
    time_slot            = v_slot,
    special_requirements = nullif(p_booking->>'special_requirements', ''),
    occasion             = nullif(p_booking->>'occasion', ''),
    board                = case when p_booking ? 'board' and jsonb_typeof(p_booking->'board') = 'object'
                                then p_booking->'board' else null end,
    venue_id             = v_venue_id,
    venue_address        = nullif(p_booking->>'venue_address', ''),
    external_booking_ref = nullif(p_booking->>'external_booking_ref', ''),
    advance_amount       = v_advance,
    total_amount         = v_total,
    discount_amount      = coalesce((p_booking->>'discount_amount')::numeric, 0),
    package_key          = v_pkg_key,
    package_name         = v_pkg_name,
    package_tagline      = v_pkg_tag,
    send_guest_email     = coalesce((p_booking->>'send_guest_email')::boolean, v_existing.send_guest_email),
    includes_food        = v_incl_food,
    food_items_count     = v_food_ct,
    beverage_items_count = v_bev_ct,
    slot_start_time      = v_slot_start,
    slot_end_time        = v_slot_end
  where id = p_booking_id;

  delete from public.booking_add_ons where booking_id = p_booking_id;
  for a in select * from jsonb_array_elements(coalesce(p_add_ons, '[]'::jsonb)) loop
    insert into public.booking_add_ons (booking_id, addon_id, name, price_at_booking, requires_confirmation)
    values (
      p_booking_id,
      (a->>'addon_id')::int,
      coalesce(a->>'name', ''),
      coalesce((a->>'price')::numeric, 0),
      coalesce((a->>'requires_confirmation')::boolean, false)
    );
  end loop;

  delete from public.venue_availability where booking_id = p_booking_id and source = 'parent';
  if v_type = 'combo' then
    insert into public.venue_availability (venue_id, date, status, source, booking_id, time_slot)
    select ch.id, gs::date, 'blocked', 'parent', p_booking_id, null
    from public.venues ch
    cross join generate_series(v_date, v_end - 1, interval '1 day') gs
    where ch.parent_venue_id = v_venue_id;
  end if;

  return p_booking_id;
end;
$function$
