-- 2026-11-03: one price source for the city brochures (/brochure/ncr, /brochure/jaipur).
-- Applied live via apply_migration (name: brochure_city_prices_view) on 2026-11-03.
-- Mirrors compute_booking_total's two-source rule exactly:
--   a venue with any active package_prices row for the package -> the minimum over those rows
--     (no-food rows and with-food rows separately; weekday/weekend and guest bands collapse to "from");
--   otherwise venue_packages.price (no food), with-food unavailable.
-- package_price_grid only covers the first source, so it misses venues priced only in
-- venue_packages (GARH 66, Satoria Villa 65, Padao 67 on 2026-11-03).
-- Verified before apply: for all 33 rows, from_no_food / from_with_food equal the minimum
-- compute_booking_total returns (2 guests no food; 2-6 guests with food; a Monday and a Saturday).
-- anon can read it (22 Jaipur rows / 5 venues, 11 NCR rows / 3 venues on 2026-11-03).
-- Rollback: DROP VIEW public.brochure_city_prices;  (only brochure.js and the prerender read it)
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
       CASE WHEN pp.package_id IS NOT NULL THEN 'package_prices' ELSE 'venue_packages' END AS price_source
  FROM public.venue_packages vp
  JOIN public.venues   v ON v.id = vp.venue_id AND v.is_active AND v.type = 'cafe'
  JOIN public.packages p ON p.id = vp.package_id AND p.is_active
  LEFT JOIN pp ON pp.venue_id = vp.venue_id AND pp.package_id = vp.package_id
 WHERE vp.is_active
   AND p.key NOT LIKE 'date_night%'
   AND p.key NOT LIKE 'movie_night%';

GRANT SELECT ON public.brochure_city_prices TO anon, authenticated;
