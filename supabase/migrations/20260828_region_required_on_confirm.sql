-- Phase 3 of docs/STAFF_ACCESS_BY_LOCATION_PLAN.md — but far smaller than planned,
-- because re-probing showed most of it was already true.
--
-- The plan called for adding a region key to admin_add_manual_booking and
-- admin_edit_booking and a required region control on the admin form. Neither is
-- needed: BOTH RPCs already open with `if v_venue_id is null then raise
-- exception 'Venue is required'`, and every venue has a NOT NULL region, so the
-- Phase 1 trigger always resolves a region on those paths. The planned guard
-- could never have fired.
--
-- Two paths bypass those RPCs:
--   1. Admin confirm — app.js does a DIRECT `.update({confirmed:true, ...})`
--      on bookings, no RPC involved.
--   2. Public checkout — submit_booking_intent can INSERT confirmed=true, and
--      for a custom address app.js deliberately sends no venue_id
--      (`if (venue.type !== 'custom') lead.venue_id = venue.id`).
--
-- 🔴 The guard is deliberately NOT applied to INSERT. Blocking an insert would
-- mean a customer who has just paid for a custom-address picnic gets a failed
-- booking. A region-less confirmed booking is a visibility problem; a failed
-- checkout is a money problem. So the raise fires only on the admin transition
-- unconfirmed -> confirmed, where a human is present and can act on the message.
--
-- Residual, accepted: submit_booking_intent can still create a confirmed,
-- venue-less, region-less booking. It stays visible to NULL-region (master)
-- tokens, so nothing is hidden today. It only matters from Phase 5, and this is
-- the backstop that finds it:
--
--   select id, full_name, preferred_date from public.bookings
--    where confirmed and region is null;
--
-- Add that to the picnic-live-verify checks.
--
-- Applied live 2026-08-28 as migration 20260828055533.

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

  -- Confirming a booking that has no venue AND no region would create a row the
  -- region-scoped staff helpers can never return. Refuse, with a message the
  -- admin can act on. UPDATE only — see the header.
  if tg_op = 'UPDATE'
     and new.confirmed
     and not coalesce(old.confirmed, false)
     and new.region is null then
    raise exception 'Booking % has no venue and no location, so no staff link could ever show it. Set a venue, or set region to ''ncr'' or ''jaipur'', before confirming.', new.id;
  end if;

  -- A region the caller supplied explicitly is never overwritten.
  return new;
end
$fn$;

revoke all on function public.bookings_set_region() from public;
revoke all on function public.bookings_set_region() from anon;
revoke all on function public.bookings_set_region() from authenticated;

-- ---------------------------------------------------------------- ROLLBACK
-- Re-apply the function body from 20260827_region_scoping_phase1.sql §3
-- (identical minus the confirm guard), then re-run the three revokes.
