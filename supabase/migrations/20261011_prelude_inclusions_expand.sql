-- 2026-10-11: The Prelude's inclusions (free-text, packages.inclusions) expanded
-- to match what Aksheev set on /brochure. /packages and /brochure both render
-- this column now. Dropped "Perfect for 2–4 guests" — capacity is shown from
-- venue_packages on both pages, so it was a duplicate, not an inclusion.
-- Rollback:
--   update public.packages set inclusions = '["Cozy macramé tent setup","Ambient fairy lighting","Curated lamps & floor seating","Perfect for 2–4 guests"]'::jsonb where key = 'the_prelude';
update public.packages
set inclusions = '["Cozy macramé tent setup","Ambient fairy lighting","Curated lamps & floor seating","Wax candles","Electric candles","Fresh flowers","Bluetooth speaker","Crockery & cutlery","Dedicated host support"]'::jsonb,
    updated_at = now()
where key = 'the_prelude';
