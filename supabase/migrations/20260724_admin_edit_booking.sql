-- admin_edit_booking: edit any field of an existing booking from the admin panel.
-- Mirrors admin_add_manual_booking (SECURITY INVOKER, same admin guard, same
-- conflict-check shape) but UPDATEs an existing row instead of inserting, and adds:
--   * paid-advance lock  : payment_status='paid' rows freeze advance_amount (Razorpay charge)
--   * no-refund invariant: total_amount can never drop below the stored advance
--   * self-exclusion     : conflict checks ignore THIS booking's own row / parent blocks
--   * add-on reconcile    : delete-and-reinsert booking_add_ons
--   * combo re-fanout     : drop this booking's old parent blocks, re-place if still combo
-- Never changes confirmed / payment_status / entry_source, so no notify trigger fires.
create or replace function public.admin_edit_booking(
  p_booking_id bigint,
  p_booking    jsonb,
  p_add_ons    jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
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
  d            date;
  a            jsonb;
begin
  -- Admin-only guard (same literal + convention as admin_add_manual_booking).
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;

  if p_booking_id is null then raise exception 'Booking id is required'; end if;

  -- Lock the row under edit; also confirms it exists.
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

  -- Money rules.
  --   Razorpay-verified (paid): advance is frozen — it records what was actually charged.
  --   Otherwise (offline / unpaid): admin-entered advance verbatim.
  if v_existing.payment_status = 'paid' then
    v_advance := v_existing.advance_amount;
  else
    v_advance := coalesce((p_booking->>'advance_amount')::numeric, 0);
  end if;
  -- No refunds ever: total can't fall below the stored advance/collected amount.
  if v_total is not null and v_total < v_advance then
    raise exception 'Total (%) cannot be less than the advance already set (%)', v_total, v_advance;
  end if;

  -- Conflict checks: only a CONFIRMED booking contends for a slot. An unconfirmed
  -- enquiry reserves nothing, so skip. Always exclude THIS booking's own row/blocks.
  if v_existing.confirmed then
    if v_type in ('cafe', 'custom') then
      if v_slot is null then raise exception 'Time slot is required for picnic bookings'; end if;
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

    elsif v_type in ('self_managed', 'partner_bnb') then
      for d in select gs::date from generate_series(v_date, v_end - 1, interval '1 day') gs loop
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
      end loop;

    elsif v_type = 'combo' then
      for d in select gs::date from generate_series(v_date, v_end - 1, interval '1 day') gs loop
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
      end loop;
    end if;
  end if;

  -- Package snapshot re-freeze from the (possibly new) key. Rename-safe: same
  -- pattern as submit_booking_intent / admin_add_manual_booking.
  if v_pkg_key is not null then
    select name, tagline into v_pkg_name, v_pkg_tag from public.packages where key = v_pkg_key;
  end if;

  -- Update the parent row. Deliberately NOT touched: confirmed, payment_status,
  -- entry_source, created_at, lead_status, customer_intent, razorpay_* — this RPC
  -- edits details only, never booking state or payment identity.
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
    package_key          = v_pkg_key,
    package_name         = v_pkg_name,
    package_tagline      = v_pkg_tag,
    send_guest_email     = coalesce((p_booking->>'send_guest_email')::boolean, v_existing.send_guest_email)
  where id = p_booking_id;

  -- Add-ons: delete-and-reinsert (no external references to these child rows by id).
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

  -- Combo re-fanout: always clear this booking's old parent blocks (handles
  -- combo -> non-combo), then re-place across children x nights if still combo.
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
$function$;

revoke all on function public.admin_edit_booking(bigint, jsonb, jsonb) from public;
grant execute on function public.admin_edit_booking(bigint, jsonb, jsonb) to authenticated, service_role;
