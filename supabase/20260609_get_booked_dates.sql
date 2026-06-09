-- Anon key cannot SELECT from bookings (RLS: only authenticated can read).
-- fetchBookedData() for self_managed and combo venues was doing a direct table
-- query that silently returned [] for anon callers, so no dates were ever blocked.
-- This SECURITY DEFINER function bypasses RLS and is safe to expose to anon
-- because it only returns the two date columns needed to render the calendar.

create or replace function public.get_booked_dates(p_venue_ids bigint[])
returns table(venue_id bigint, preferred_date date, checkout_date date)
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  select venue_id, preferred_date::date, checkout_date::date
  from bookings
  where venue_id = any(p_venue_ids)
    and confirmed = true
    and preferred_date is not null;
$$;

grant execute on function public.get_booked_dates(bigint[]) to anon;
