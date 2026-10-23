-- Applied 2026-10-23 via MCP apply_migration.
-- Combined food & drink item count included in a with-food package price.
-- Source: pricing sheet Notes column (Aksheev 2026-10-23): Prelude = 1x guests,
-- Setting/Moment/Story = 1.5x guests, rounded up; one combined count, guest picks the mix.
-- Voucher rows (food_credit, Sunroom) have no item count.
alter table public.package_prices add column if not exists food_items integer
  check (food_items is null or food_items > 0);
comment on column public.package_prices.food_items is
  'Food & drink items (combined) included in this with-food price. NULL = not itemised (e.g. voucher rows).';

update public.package_prices pp
set food_items = ceil(pp.guests * case p.key when 'the_prelude' then 1.0 else 1.5 end)::int
from public.packages p
where p.id = pp.package_id
  and pp.with_food
  and pp.food_credit is null
  and pp.guests is not null
  and p.key in ('the_prelude','setting','moment','story');

-- Rollback: alter table public.package_prices drop column food_items;
