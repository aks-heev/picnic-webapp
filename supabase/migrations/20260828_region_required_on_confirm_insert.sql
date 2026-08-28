-- Applied live 2026-08-28 as migration `bookings_set_region_guard_insert`.
-- Amends 20260828_region_required_on_confirm.sql.
--
-- Close the INSERT-side hole in bookings_set_region()'s no-region guard.
--
-- Before: the raise fired only on UPDATE, and only on a false -> true
-- confirmation. An INSERT that carried confirmed = true with no venue_id
-- therefore landed a row with region NULL and no error at all -- a booking
-- no region-scoped staff link could ever return. Proven live 2026-08-28 in
-- a rolled-back DO block: the insert succeeded, region came back NULL.
--
-- After: any write that leaves a row confirmed with region NULL is refused,
-- INSERT and UPDATE alike. Safe to apply: 0 of 58 bookings have ever had a
-- NULL venue_id, and 0 have confirmed = true with region NULL, so no
-- existing row becomes un-updatable. Unconfirmed venue-less enquiries are
-- untouched -- they are the normal lead shape.
--
-- Region derivation logic above the guard is byte-for-byte unchanged.

create or replace function public.bookings_set_region()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $body$
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

  -- A confirmed booking with no region is invisible to every region-scoped
  -- staff helper. Refuse on INSERT as well as UPDATE. No reference to `old`
  -- here, so the same branch is valid for both tg_op values.
  if new.confirmed and new.region is null then
    raise exception 'Booking % has no venue and no location, so no staff link could ever show it. Set a venue, or set region to ''ncr'' or ''jaipur'', before confirming.', new.id;
  end if;

  -- A region the caller supplied explicitly is never overwritten.
  return new;
end
$body$;
