-- Applied 2026-10-25 via MCP apply_migration (package_prices_food_items_count_drinks).
-- Fix: 20261023 stored food-only counts (1x / ceil 1.5x guests). On 2026-10-24 Aksheev
-- corrected that drinks are included ON TOP (Prelude 1x food + 1x drinks; Setting/Moment/
-- Story 1.5x food + 1x drinks) and with-food prices were repriced at ~Rs375/item on that
-- basis. The site showed "2 guests · 3 items" against a price built for 5 items.
update public.package_prices pp
set food_items = case p.key when 'the_prelude' then 2 * pp.guests
                            else ceil(pp.guests * 1.5)::int + pp.guests end
from public.packages p
where p.id = pp.package_id
  and pp.with_food
  and pp.food_credit is null
  and pp.guests is not null
  and p.key in ('the_prelude','setting','moment','story');
comment on column public.package_prices.food_items is
  'Food + drink items (combined) included in this with-food price: Prelude = guests food + guests drinks; Setting/Moment/Story = ceil(1.5x guests) food + guests drinks. NULL = not itemised (e.g. voucher rows).';
-- Rollback: rerun the update from 20261023_package_prices_food_items.sql.
