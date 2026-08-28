-- Phase 2 of docs/STAFF_ACCESS_BY_LOCATION_PLAN.md — scope the staff surface by region.
--
-- staff_today does not inline its row filters: it selects ids from five zero-arg
-- SECURITY DEFINER helpers, and staff_log_step gates its WRITES through the same
-- two _active helpers. Scope the helpers and both reads and writes follow, with
-- NO change to staff_today's hardcoded column allowlist and no change to
-- staff_log_step's step-ordering logic — the two riskiest pieces of the original
-- build are untouched here.
--
-- p_region NULL means "every region": a master token behaves exactly as before.
--
-- The four id helpers filter bookings.region directly (materialised in Phase 1),
-- so no join to venues is introduced anywhere. staff_occupancy_upcoming has no
-- booking row — it reports iCal-blocked nights — so it filters venues.region.
--
-- Applied live 2026-08-28 as migration 20260828054442.

-- ------------------------------------------------ 1. the five scoped variants
create or replace function public.staff_event_ids_active(p_region text)
returns setof bigint language sql stable security definer set search_path to 'public'
as $function$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and b.checkout_date is null                         -- picnics only; stays are a separate design
    and (
      b.preferred_date = (now() at time zone 'Asia/Kolkata')::date
      or (                                              -- past-midnight grace
        b.preferred_date = (now() at time zone 'Asia/Kolkata')::date - 1
        and (now() at time zone 'Asia/Kolkata')::time < time '04:00'
      )
    )
    and (p_region is null or b.region = p_region)
$function$;

create or replace function public.staff_event_ids_upcoming(p_region text)
returns setof bigint language sql stable security definer set search_path to 'public'
as $function$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and b.checkout_date is null
    and b.preferred_date > (now() at time zone 'Asia/Kolkata')::date
    and (p_region is null or b.region = p_region)
$function$;

create or replace function public.staff_stay_ids_active(p_region text)
returns setof bigint language sql stable security definer set search_path to 'public'
as $function$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and b.checkout_date is not null
    and (now() at time zone 'Asia/Kolkata')::date between b.preferred_date and b.checkout_date
    and (p_region is null or b.region = p_region)
$function$;

create or replace function public.staff_stay_ids_upcoming(p_region text)
returns setof bigint language sql stable security definer set search_path to 'public'
as $function$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and b.checkout_date is not null
    and b.preferred_date > (now() at time zone 'Asia/Kolkata')::date
    and (p_region is null or b.region = p_region)
$function$;

create or replace function public.staff_occupancy_upcoming(p_region text)
returns table(venue_id bigint, venue_name text, from_date date, to_date date)
language sql stable security definer set search_path to 'public'
as $function$
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
      and (p_region is null or v.region = p_region)
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
$function$;

-- These are internal to staff_today / staff_log_step and must not be reachable
-- over PostgREST. New functions grant EXECUTE to PUBLIC by default; the zero-arg
-- originals had it revoked, which is why they never appeared in get_advisors.
revoke all on function public.staff_event_ids_active(text)    from public, anon, authenticated;
revoke all on function public.staff_event_ids_upcoming(text)  from public, anon, authenticated;
revoke all on function public.staff_stay_ids_active(text)     from public, anon, authenticated;
revoke all on function public.staff_stay_ids_upcoming(text)   from public, anon, authenticated;
revoke all on function public.staff_occupancy_upcoming(text)  from public, anon, authenticated;

-- ------------------------------------- 2. point the two callers at the variants
-- Done by rewriting the LIVE definitions rather than restating them: staff_today
-- carries the hardcoded column allowlist that is the entire security boundary of
-- the staff surface, and retyping ~160 lines of it here would risk a
-- transcription error in exactly the place that must not have one. Both callers
-- already declare `v_tok public.staff_tokens%rowtype`, so v_tok.region is in
-- scope with no new variable. Every substitution is asserted.
do $$
declare
  d text;
  n int;
  fn text;
  hits int;
  calls text[] := array[
    'public.staff_event_ids_active()',
    'public.staff_event_ids_upcoming()',
    'public.staff_stay_ids_active()',
    'public.staff_stay_ids_upcoming()',
    'public.staff_occupancy_upcoming()'
  ];
  c text;
begin
  foreach fn in array array['public.staff_today(text)',
                            'public.staff_log_step(text,bigint,text,text,numeric)']
  loop
    d := pg_get_functiondef(fn::regprocedure);
    hits := 0;
    foreach c in array calls loop
      n := (length(d) - length(replace(d, c, ''))) / length(c);
      hits := hits + n;
      if n > 0 then
        d := replace(d, c, replace(c, '()', '(v_tok.region)'));
      end if;
    end loop;
    if hits = 0 then
      raise exception 'No helper call sites found in % — refusing to redefine it', fn;
    end if;
    execute d;
    raise notice 'rewrote % (% call sites)', fn, hits;
  end loop;
end $$;

-- --------------------------------------------- 3. drop the unscoped originals
-- NOT optional. A surviving zero-arg helper silently bypasses region scoping and
-- nothing errors — the worst failure mode available here.
drop function public.staff_event_ids_active();
drop function public.staff_event_ids_upcoming();
drop function public.staff_stay_ids_active();
drop function public.staff_stay_ids_upcoming();
drop function public.staff_occupancy_upcoming();

-- ---------------------------------------------------------------- ROLLBACK
-- Recreate the five zero-arg helpers from
-- supabase/migrations/20260820_staff_rpcs.sql + 20260822_staff_stays_and_occupancy.sql,
-- then re-run the do-block above with '(v_tok.region)' -> '()' to point the
-- callers back, then drop the (text) variants.
