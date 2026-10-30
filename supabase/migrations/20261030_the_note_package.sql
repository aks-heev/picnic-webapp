-- 2026-10-30 — New package "The Note" (key the_note) = The Prelude setup + Cake + White Board Message.
-- Plan: docs/PRELUDE_PLUS_PACKAGE_PLAN_2026-10-30.md. Prices approved by Aksheev 2026-10-30.
-- Inserted INACTIVE; activated only after the app.js/brochure changes are live.
-- Rollback: delete from package_prices/venue_packages/package_add_ons where package_id = (the_note id);
--           delete from packages where key='the_note'; update packages set sort_order = sort_order - 1 where sort_order >= 2;

-- 1. Make room between The Prelude (0) and The Setting (1).
update packages set sort_order = sort_order + 1 where sort_order >= 1;

-- 2. Package row — same photos/inclusions as The Prelude, plus cake + board. Standalone (has inclusions).
insert into packages (key, name, tagline, sort_order, is_featured, is_active, images, occasion, inclusions, reels)
select 'the_note', 'The Note',
       'The Prelude setup, with a cake and your message on a board.',
       1, false, false, p.images, null,
       p.inclusions || '["Cake", "White sunboard with your message"]'::jsonb,
       '[]'::jsonb
from packages p where p.key = 'the_prelude';

-- 3. Bundled add-ons (resolved by name + active, not by remembered id).
insert into package_add_ons (package_id, addon_id, sort_order)
select (select id from packages where key = 'the_note'), a.id, x.ord
from (values ('Cake', 0), ('White Board Message', 1)) x(name, ord)
join add_ons a on a.name = x.name and a.is_active = true;

-- 4. Per-venue base rows — copy The Prelude's guest caps (4, no overage); price = The Note no-food price.
insert into venue_packages (venue_id, package_id, price, included_guests, overage_per_person, max_guests, is_active)
select vp.venue_id, (select id from packages where key = 'the_note'), n.price,
       vp.included_guests, vp.overage_per_person, vp.max_guests, true
from venue_packages vp
join packages p on p.id = vp.package_id and p.key = 'the_prelude'
join (values (14, 7400), (27, 7400), (24, 8400), (19, 8400)) n(venue_id, price) on n.venue_id = vp.venue_id
where vp.is_active;

-- 5. Price table — mirror every active Prelude package_prices row: no-food = The Note price;
--    with-food = The Note price + the Prelude's food delta for that guest count; same food_items (1x guests).
insert into package_prices (venue_id, package_id, with_food, guests, day_type, price, food_credit, food_items, is_active)
select pp.venue_id, (select id from packages where key = 'the_note'), pp.with_food, pp.guests, pp.day_type,
       n.price + (pp.price - base.price), pp.food_credit, pp.food_items, true
from package_prices pp
join packages p on p.id = pp.package_id and p.key = 'the_prelude'
join package_prices base on base.venue_id = pp.venue_id and base.package_id = pp.package_id
     and base.is_active and not base.with_food and base.day_type = 'any'
join (values (14, 7400), (27, 7400), (24, 8400), (19, 8400)) n(venue_id, price) on n.venue_id = pp.venue_id
where pp.is_active;
