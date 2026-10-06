-- Picnic + Stay bookings (booking_kind = 'picnic_stay') carry a checkout_date, so the
-- old "picnic = checkout_date is null" split routed them to the Airbnb tab as plain
-- stays: no package, slot, checklist or step buttons. Staff could not run the picnic.
--
-- Fix:
--  * picnic lists (events / upcoming, and therefore staff_log_step's write scope)
--    also take booking_kind = 'picnic_stay'. The picnic happens on preferred_date.
--  * stay lists (Airbnb tab) drop picnic_stay rows entirely, so each booking
--    appears once and its balance is never shown twice. (Owner's call 2026-10-06:
--    picnic+stay belongs on the Picnic tab.)

create or replace function public.staff_event_ids_active(p_region text)
 returns setof bigint language sql stable security definer set search_path to 'public'
as $$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and (b.checkout_date is null or b.booking_kind = 'picnic_stay')
    and (
      b.preferred_date = (now() at time zone 'Asia/Kolkata')::date
      or (
        b.preferred_date = (now() at time zone 'Asia/Kolkata')::date - 1
        and (now() at time zone 'Asia/Kolkata')::time < time '04:00'
      )
    )
    and (p_region is null or b.region = p_region)
$$;

create or replace function public.staff_event_ids_upcoming(p_region text)
 returns setof bigint language sql stable security definer set search_path to 'public'
as $$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and (b.checkout_date is null or b.booking_kind = 'picnic_stay')
    and b.preferred_date > (now() at time zone 'Asia/Kolkata')::date
    and (p_region is null or b.region = p_region)
$$;

create or replace function public.staff_stay_ids_active(p_region text)
 returns setof bigint language sql stable security definer set search_path to 'public'
as $$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and b.checkout_date is not null
    and b.booking_kind is distinct from 'picnic_stay'
    and (now() at time zone 'Asia/Kolkata')::date between b.preferred_date and b.checkout_date
    and (p_region is null or b.region = p_region)
$$;

create or replace function public.staff_stay_ids_upcoming(p_region text)
 returns setof bigint language sql stable security definer set search_path to 'public'
as $$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and b.checkout_date is not null
    and b.booking_kind is distinct from 'picnic_stay'
    and b.preferred_date > (now() at time zone 'Asia/Kolkata')::date
    and (p_region is null or b.region = p_region)
$$;
