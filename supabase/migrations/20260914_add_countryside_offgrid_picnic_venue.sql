-- Countryside Offgrid picnic twin.
--
-- Every other stay property that also hosts picnics already has TWO venue rows, one per
-- product: House of Amer 23 (partner_bnb) + 24 (cafe), Om Niwas 25 (partner_bnb) + 20 (cafe).
-- Countryside Offgrid only had the stay row (22), so picnic-only sales had to be recorded
-- against it - which is how booking 172 ended up carrying a checkout_date for a night nobody
-- sold, and why it was initially misclassified as a stay.
--
-- With this row, the common case ("guest already booked the stay, now books the picnic")
-- lands on a cafe-type venue: priced by the cafe branch, requires a time_slot, and does not
-- touch stay-night inventory. booking_kind='picnic_stay' on venue 22 is then reserved for the
-- genuinely bundled sale (booking 165).
--
-- Slug note: convention is cafe=clean slug, stay=<slug>-stay. Venue 22 already holds
-- 'countryside-offgrid' and it is live, so this row takes '-picnic' rather than renaming a
-- live slug. venues_slug_key is a UNIQUE index.
--
-- Created INACTIVE on purpose: packages_enabled=true with zero venue_packages rows would
-- render an empty package picker. Activate after packages are wired.

INSERT INTO public.venues (
  name, type, slug, region, city, area,
  description, images,
  base_price, free_guests_upto, overage_per_person,
  capacity_min, capacity_max,
  packages_enabled, requires_confirmation, max_concurrent_setups,
  setting, sort_order, team_id, is_active, metadata
)
SELECT
  v.name,
  'cafe',
  'countryside-offgrid-picnic',
  v.region, v.city, v.area,
  v.description, v.images,
  5900,            -- picnic setup base, per booking 172 (5,900 picnic-only sale at this venue)
  6,               -- free guests up to 6; property capacity is 6, so overage never fires today
  2000,            -- mirrors the stay row's overage
  v.capacity_min, v.capacity_max,
  true,            -- offers packages
  true,            -- partner property: keep manual confirmation, same as the stay row
  1,               -- one physical property: one setup at a time
  v.setting,
  7,               -- sits just after the stay row (sort_order 6)
  v.team_id,
  false,           -- INACTIVE until packages are wired
  jsonb_build_object(
    'tiers', jsonb_build_array(jsonb_build_object('up_to', 6, 'price', 5900)),
    'includes', '[]'::jsonb,
    'overage_per_person', 2000
  )
FROM public.venues v
WHERE v.id = 22
  AND NOT EXISTS (SELECT 1 FROM public.venues x WHERE x.slug = 'countryside-offgrid-picnic');

-- Applied 2026-09-14 -> created venue id 27.
