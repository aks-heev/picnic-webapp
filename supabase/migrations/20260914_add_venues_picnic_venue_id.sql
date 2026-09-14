-- Phase 3a: link each stay venue to the venue its picnic is priced from.
--
-- A picnic_stay is "a stay here PLUS a picnic setup here". The picnic price already lives on
-- the cafe twin (Countryside Offgrid 22 -> 27, House of Amer 23 -> 24, Om Niwas 25 -> 20), so
-- pricing should read it from there rather than duplicating a picnic rate onto the stay row.
--
-- Deliberately NOT reusing parent_venue_id: that models combo parent/child inventory
-- (Sienna -> Umber/Ochre, where booking the parent blocks the children). This is a different
-- relationship - same physical place, two products - and conflating them would break the
-- availability propagation in admin_add_manual_booking / staff_occupancy_upcoming.
--
-- NULL means "picnic_stay is not offerable at this venue", which is the correct default.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS picnic_venue_id bigint REFERENCES public.venues(id);

COMMENT ON COLUMN public.venues.picnic_venue_id IS
  'For a stay venue: the cafe-type venue its picnic setup is priced from, enabling booking_kind=picnic_stay. NULL = picnic_stay not offerable here. Distinct from parent_venue_id, which models combo parent/child inventory.';

UPDATE public.venues SET picnic_venue_id = 27 WHERE id = 22;  -- Countryside Offgrid -> its picnic twin
UPDATE public.venues SET picnic_venue_id = 24 WHERE id = 23;  -- House of Amer stay -> House of Amer cafe
UPDATE public.venues SET picnic_venue_id = 20 WHERE id = 25;  -- Om Niwas Stay -> Om Niwas cafe

-- A venue must not point at itself.
ALTER TABLE public.venues DROP CONSTRAINT IF EXISTS venues_picnic_venue_not_self;
ALTER TABLE public.venues
  ADD CONSTRAINT venues_picnic_venue_not_self
  CHECK (picnic_venue_id IS NULL OR picnic_venue_id <> id);

-- NOT YET WIRED: TerraCottage Umber (15), Ochre (16) and Sienna (17). The original ask named
-- these as first candidates for picnic_stay, but none has a picnic twin to price from. Either
-- create cafe twins for them, or point picnic_venue_id at an existing NCR picnic venue whose
-- rate should apply. Until then picnic_stay is simply not offerable there, which is safe.
