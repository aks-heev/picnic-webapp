-- 2026-11-03: expose venues.packages_enabled so the brochure lists only venues
-- whose packages can be booked (the /packages venue step hides the rest).
-- The Sunroom (18) has a Setting price but packages_enabled = false.
-- Column appended at the end, so CREATE OR REPLACE keeps the existing columns.
-- Applied live via apply_migration (name: brochure_city_prices_add_packages_enabled) on 2026-11-03.
-- Prices unchanged from 20261103_brochure_city_prices_view.sql (same expressions).
CREATE OR REPLACE VIEW public.brochure_city_prices WITH (security_invoker = true) AS
WITH pp AS (
  SELECT venue_id, package_id,
         min(price) FILTER (WHERE NOT with_food) AS nf,
         min(price) FILTER (WHERE with_food)     AS wf
    FROM public.package_prices
   WHERE is_active
   GROUP BY venue_id, package_id
)
SELECT v.region, v.city, v.id AS venue_id, v.name AS venue_name, v.slug AS venue_slug, v.area AS venue_area,
       p.id AS package_id, p.key AS package_key, p.name AS package_name,
       vp.included_guests, vp.max_guests,
       CASE WHEN pp.package_id IS NOT NULL THEN pp.nf ELSE vp.price END AS from_no_food,
       CASE WHEN pp.package_id IS NOT NULL THEN pp.wf END                AS from_with_food,
       CASE WHEN pp.package_id IS NOT NULL THEN 'package_prices' ELSE 'venue_packages' END AS price_source,
       coalesce(v.packages_enabled, false) AS packages_enabled
  FROM public.venue_packages vp
  JOIN public.venues   v ON v.id = vp.venue_id AND v.is_active AND v.type = 'cafe'
  JOIN public.packages p ON p.id = vp.package_id AND p.is_active
  LEFT JOIN pp ON pp.venue_id = vp.venue_id AND pp.package_id = vp.package_id
 WHERE vp.is_active
   AND p.key NOT LIKE 'date_night%'
   AND p.key NOT LIKE 'movie_night%';
