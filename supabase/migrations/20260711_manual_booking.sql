-- Manual booking entry from the admin panel (2026-07-11)
-- 1. email_address becomes optional (offline/WhatsApp bookings often have no email)
-- 2. entry_source distinguishes site vs admin-entered rows
-- 3. send_guest_email lets admin suppress the guest confirmation email per entry
-- 4. guest_count cap widened 20 -> 100 (offline events exceed the site's cap;
--    the public site UI still caps at 20 client-side, submit_booking_intent unaffected)
-- 5. admin_add_manual_booking RPC: server-side conflict checks + atomic
--    booking + booking_add_ons + combo parent-fanout insert.
--    SECURITY INVOKER on purpose: RLS admin policies apply, plus an explicit
--    admin-email guard (same convention as the RLS policies).

alter table public.bookings alter column email_address drop not null;

alter table public.bookings
  add column if not exists entry_source text not null default 'site'
    check (entry_source in ('site', 'admin'));

comment on column public.bookings.entry_source is
  'site = customer flow; admin = manually entered from the admin panel.';

alter table public.bookings
  add column if not exists send_guest_email boolean not null default true;

comment on column public.bookings.send_guest_email is
  'When false, notify edge fns skip the guest-facing email (admin/team notices still send). Set from the admin manual-entry form.';

alter table public.bookings drop constraint bookings_guest_count_check;
alter table public.bookings add constraint bookings_guest_count_check
  check (guest_count >= 1 and guest_count <= 100);

create or replace function public.admin_add_manual_booking(
  p_booking jsonb,
  p_add_ons jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
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

  -- ── Conflict checks (authoritative; the form's disabled slots are hints only)
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

  -- ── Package snapshot (rename-safe, same pattern as submit_booking_intent)
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
    advance_amount, total_amount, payment_status,
    package_key, package_name, package_tagline,
    entry_source, send_guest_email
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
    'pending',
    v_pkg_key, v_pkg_name, v_pkg_tag,
    'admin',
    coalesce((p_booking->>'send_guest_email')::boolean, true)
  ) returning id into v_id;

  -- ── Add-ons in the same transaction (email fns read them after commit)
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

  -- ── Combo fanout: parent blocks on every child x every night, atomic with
  --    the booking so they can never diverge (rides export-ical out to Airbnb).
  if v_type = 'combo' then
    insert into venue_availability (venue_id, date, status, source, booking_id, time_slot)
    select ch.id, gs::date, 'blocked', 'parent', v_id, null
    from venues ch
    cross join generate_series(v_date, v_end - 1, interval '1 day') gs
    where ch.parent_venue_id = v_venue_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.admin_add_manual_booking(jsonb, jsonb) from public, anon;
grant execute on function public.admin_add_manual_booking(jsonb, jsonb) to authenticated;
