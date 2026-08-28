-- Custom picnics must file under the region the customer chose.
--
-- Before this, ONE custom venue row existed (id 5, "Your Own Space", city
-- Jaipur, region 'jaipur'). Both custom booking paths -- the public custom
-- picnic modal (app.js handleCustomPicnicSubmit -> p_venue_id: customVenue.id)
-- and the admin + Add Booking form (abk -> venue_id: v.id) -- stored that id,
-- so bookings_set_region() derived region = 'jaipur' for EVERY custom booking,
-- including NCR ones. Silent: nothing errored. An NCR custom picnic showed on
-- the Jaipur staff link and was invisible on the NCR one.
--
-- Fix: one custom venue per region, so region derives from the venue exactly
-- as it does for all other bookings. No RPC change, no new jsonb key, no
-- change to submit_booking_intent's 20 positional params.
--
-- Load-bearing values (NOT cosmetic):
--   city 'Gurugram'  -- scripts/google-sheet-sync.gs routes on venue CITY via
--                       locationOf(); NCR_CITIES = Delhi/Gurugram/Noida/Faridabad.
--                       A non-NCR city here and the booking never reaches the
--                       NCR workbook.
--   team_id 2        -- teams: 1 = jaipur, 2 = gurugram. Drives the WhatsApp
--                       handoff and getVenueInfo()'s team email.
--   sort_order 26    -- MUST exceed venue 5's 13. The public fetch orders
--                       sort_order asc, id asc, so the pre-deploy .find() keeps
--                       returning venue 5 for the whole deploy window and the
--                       public site is unchanged until app.js ships. 14 is
--                       taken; 25 was the max.
--   name identical   -- getVenueInfo builds the guest-facing label as
--                       [name, area, city].join(', '); a distinct name would
--                       leak "Your Own Space (NCR)" into confirmation emails.
--                       The admin dropdown carries the region instead.
--
-- Rollback: update public.venues set is_active = false where slug = 'your-own-space-ncr';
-- NEVER delete the row. bookings_venue_id_fkey is ON DELETE SET NULL, so a
-- delete silently orphans any booking that landed on it -- venue_id NULL with a
-- stale region is the invisible-booking state this whole effort exists to
-- prevent.
--
-- Applied live 2026-08-28 as migration `custom_venue_per_region`; new row got
-- id 26. Exit assertions A-E passed in a rolled-back DO block (two custom
-- venues one per region; new row's city in NCR_CITIES, team 2, sort_order >
-- venue 5's, active; trigger derives ncr on the new venue and jaipur on 5;
-- venue-move 5 -> 26 re-derives to ncr; the 58 pre-existing bookings unchanged
-- at ncr 52 / jaipur 6 / null 0). Residue 0, get_advisors unchanged.

insert into public.venues
  (name, type, city, region, area, slug, team_id, base_price, overage_per_person,
   capacity_min, capacity_max, sort_order, is_active, packages_enabled, requires_confirmation)
values
  ('Your Own Space', 'custom', 'Gurugram', 'ncr', '', 'your-own-space-ncr', 2, 0, 2000,
   2, 10, 26, true, false, false);
