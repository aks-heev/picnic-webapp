-- Phase 1 of docs/STAFF_ACCESS_BY_LOCATION_PLAN.md — ADDITIVE ONLY.
--
-- Adds a two-value region ('ncr' | 'jaipur') to venues, bookings and staff_tokens.
-- Nothing reads these columns yet: staff_today, staff_log_step and the five id
-- helpers are untouched by this migration, so it cannot change what any staff
-- phone displays. Phase 2 does the scoping.
--
-- Region, NOT city. venues.city has THREE values — Gurugram, Delhi, Jaipur —
-- and The Sunroom (id 18) is Delhi. A city='Gurugram' filter would have hidden
-- booking #100, the first event taken through a complete spine. 'ncr'/'jaipur'
-- matches the LOCATION vocabulary already used in scripts/google-sheet-sync.gs.

-- ---------------------------------------------------------------- 1. venues
alter table public.venues add column if not exists region text;

update public.venues
   set region = case when city = 'Jaipur' then 'jaipur' else 'ncr' end
 where region is null;

alter table public.venues alter column region set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'venues_region_chk') then
    alter table public.venues
      add constraint venues_region_chk check (region in ('ncr','jaipur'));
  end if;
end $$;

-- -------------------------------------------------------------- 2. bookings
-- Nullable on purpose. The public custom-address path stores venue_id NULL
-- (app.js: `if (venue.type !== 'custom') lead.venue_id = venue.id`), so such a
-- row has nothing to inherit from. Phase 3 makes the admin supply a region
-- before a booking like that can be confirmed; the staff tool only ever reads
-- confirmed rows, so an unconfirmed lead with a NULL region is harmless.
alter table public.bookings add column if not exists region text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_region_chk') then
    alter table public.bookings
      add constraint bookings_region_chk check (region is null or region in ('ncr','jaipur'));
  end if;
end $$;

create index if not exists bookings_region_idx on public.bookings (region);

-- ------------------------------------------------- 3. materialise on write
-- Region is materialised onto the booking rather than resolved at read time.
-- The four staff id helpers select from bookings with NO join to venues; a
-- read-time coalesce(b.region, v.region) would mean adding a join to each of
-- them, and one inner join where a LEFT was needed would silently hide every
-- venue-less booking from every staff phone. One column, one trigger, no joins.
--
-- SECURITY DEFINER so the lookup against venues succeeds whatever role is
-- inserting (public leads arrive through SECURITY DEFINER RPCs, but a direct
-- anon insert must not be able to make this fail).
--
-- bookings already carries three AFTER triggers (on_booking_insert_notify,
-- on_booking_insert_confirmed, on_booking_confirmed_notify) and no BEFORE
-- trigger. This one sets a single column and returns.
create or replace function public.bookings_set_region()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'UPDATE'
     and new.venue_id is distinct from old.venue_id
     and new.region is not distinct from old.region
     and new.venue_id is not null then
    -- The booking moved to a different venue and the caller did not set a
    -- region in the same statement: re-derive, so a Gurugram -> Jaipur move
    -- cannot leave a stale region behind.
    select v.region into new.region from public.venues v where v.id = new.venue_id;

  elsif new.region is null and new.venue_id is not null then
    select v.region into new.region from public.venues v where v.id = new.venue_id;
  end if;

  -- A region the caller supplied explicitly is never overwritten.
  return new;
end
$fn$;

drop trigger if exists set_booking_region on public.bookings;
create trigger set_booking_region
  before insert or update on public.bookings
  for each row execute function public.bookings_set_region();

-- ------------------------------------------------------------- 4. backfill
update public.bookings b
   set region = v.region
  from public.venues v
 where v.id = b.venue_id
   and b.region is null;

-- --------------------------------------------------------- 5. staff_tokens
-- NULL means "every region" — a master token. Every existing token stays NULL,
-- so this migration changes nothing about who sees what until a region is set
-- by hand. That is what makes the rollout flag-day-free.
alter table public.staff_tokens add column if not exists region text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_tokens_region_chk') then
    alter table public.staff_tokens
      add constraint staff_tokens_region_chk check (region is null or region in ('ncr','jaipur'));
  end if;
end $$;

-- ------------------------------------------------- 6. lock the trigger fn down
-- bookings_set_region() is a trigger function and must never be reachable over
-- PostgREST. It stays SECURITY DEFINER on purpose: it has to read venues
-- whatever role is inserting, including inactive legacy venue rows that an
-- RLS-filtered SECURITY INVOKER read could miss, which would silently leave
-- region NULL. Revoking EXECUTE keeps the definer read and removes the RPC
-- surface. Applied live as migration `region_scoping_phase1_revoke_trigger_fn`.
revoke all on function public.bookings_set_region() from public;
revoke all on function public.bookings_set_region() from anon;
revoke all on function public.bookings_set_region() from authenticated;

-- ---------------------------------------------------------------- ROLLBACK
-- drop trigger if exists set_booking_region on public.bookings;
-- drop function if exists public.bookings_set_region();
-- drop index if exists public.bookings_region_idx;
-- alter table public.bookings     drop constraint if exists bookings_region_chk;
-- alter table public.staff_tokens drop constraint if exists staff_tokens_region_chk;
-- alter table public.venues       drop constraint if exists venues_region_chk;
-- alter table public.bookings     drop column if exists region;
-- alter table public.staff_tokens drop column if exists region;
-- alter table public.venues       drop column if exists region;
