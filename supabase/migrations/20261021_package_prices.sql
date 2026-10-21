-- 20261021_package_prices.sql
-- Phase 1 of docs/PACKAGE_PRICING_PLAN_2026-10-21.md — INERT: nothing reads this table yet.
-- Multi-dimensional package prices (food / guests / weekday-weekend / food credit).
-- Rollback: drop view public.package_price_grid; drop table public.package_prices;

create table public.package_prices (
  id          bigint generated always as identity primary key,
  venue_id    bigint  not null references public.venues(id),
  package_id  bigint  not null references public.packages(id),
  with_food   boolean not null,
  guests      integer null check (guests is null or guests > 0),   -- null = any guest count (no-food rows)
  day_type    text    not null default 'any' check (day_type in ('any','weekday','weekend')),
  price       numeric not null check (price >= 0),
  food_credit numeric null check (food_credit is null or food_credit >= 0),  -- null = food served, no credit
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint package_prices_food_needs_guests check (not with_food or guests is not null)
);

create unique index package_prices_combo_key
  on public.package_prices (venue_id, package_id, with_food, coalesce(guests, 0), day_type);
create index package_prices_venue_pkg on public.package_prices (venue_id, package_id);

alter table public.package_prices enable row level security;

create policy "Public read package_prices" on public.package_prices
  for select to anon, authenticated using (true);
create policy "Admin insert package_prices" on public.package_prices
  for insert to authenticated with check ((select auth.email()) = 'aksh.eeev@gmail.com');
create policy "Admin update package_prices" on public.package_prices
  for update to authenticated using ((select auth.email()) = 'aksh.eeev@gmail.com')
  with check ((select auth.email()) = 'aksh.eeev@gmail.com');
create policy "Admin delete package_prices" on public.package_prices
  for delete to authenticated using ((select auth.email()) = 'aksh.eeev@gmail.com');

-- Seed — ids resolved at apply time by slug / key (never hardcoded).
-- Source: OneDrive "Ledger Picnic stories.xlsx" Packages tab + decisions 2026-10-21.
-- 3 and 5 guests = midpoint of neighbours, rounded UP to the next 100 (with-food only).
with s(slug, pkey, with_food, guests, day_type, price, food_credit) as (values
  -- Beige Cafe, no food
  ('beige-cafe','the_prelude', false, null::int, 'any',  5900, null::numeric),
  ('beige-cafe','setting',     false, null, 'any',  8900, null),
  ('beige-cafe','moment',      false, null, 'any', 12900, null),
  ('beige-cafe','story',       false, null, 'any', 24900, null),
  -- Beige Cafe, with food (Prelude capped at 4)
  ('beige-cafe','the_prelude', true, 2, 'any',  7399, null),
  ('beige-cafe','the_prelude', true, 3, 'any',  8100, null),
  ('beige-cafe','the_prelude', true, 4, 'any',  8699, null),
  ('beige-cafe','setting',     true, 2, 'any',  9900, null),
  ('beige-cafe','setting',     true, 3, 'any', 11400, null),
  ('beige-cafe','setting',     true, 4, 'any', 12900, null),
  ('beige-cafe','setting',     true, 5, 'any', 14400, null),
  ('beige-cafe','setting',     true, 6, 'any', 15900, null),
  ('beige-cafe','moment',      true, 2, 'any', 13900, null),
  ('beige-cafe','moment',      true, 3, 'any', 15400, null),
  ('beige-cafe','moment',      true, 4, 'any', 16900, null),
  ('beige-cafe','moment',      true, 5, 'any', 18400, null),
  ('beige-cafe','moment',      true, 6, 'any', 19900, null),
  ('beige-cafe','story',       true, 2, 'any', 25900, null),
  ('beige-cafe','story',       true, 3, 'any', 27400, null),
  ('beige-cafe','story',       true, 4, 'any', 28900, null),
  ('beige-cafe','story',       true, 5, 'any', 30400, null),
  ('beige-cafe','story',       true, 6, 'any', 31900, null),
  -- Countryside picnic (venue slug countryside-offgrid-picnic): Beige prices, couples only
  ('countryside-offgrid-picnic','the_prelude', false, null, 'any',  5900, null),
  ('countryside-offgrid-picnic','setting',     false, null, 'any',  8900, null),
  ('countryside-offgrid-picnic','moment',      false, null, 'any', 12900, null),
  ('countryside-offgrid-picnic','story',       false, null, 'any', 24900, null),
  ('countryside-offgrid-picnic','the_prelude', true, 2, 'any',  7399, null),
  ('countryside-offgrid-picnic','setting',     true, 2, 'any',  9900, null),
  ('countryside-offgrid-picnic','moment',      true, 2, 'any', 13900, null),
  ('countryside-offgrid-picnic','story',       true, 2, 'any', 25900, null),
  -- The Sunroom: Setting, always with food credit, weekday (Mon-Fri) / weekend (Sat-Sun)
  ('the-sunroom','setting', true, 2, 'weekday', 13900, 3000),
  ('the-sunroom','setting', true, 2, 'weekend', 15900, 3000),
  ('the-sunroom','setting', true, 3, 'weekday', 14900, 4000),
  ('the-sunroom','setting', true, 3, 'weekend', 16900, 4000),
  ('the-sunroom','setting', true, 4, 'weekday', 15900, 5000),
  ('the-sunroom','setting', true, 4, 'weekend', 17900, 5000),
  ('the-sunroom','setting', true, 5, 'weekday', 16900, 6000),
  ('the-sunroom','setting', true, 5, 'weekend', 18900, 6000),
  ('the-sunroom','setting', true, 6, 'weekday', 17900, 7000),
  ('the-sunroom','setting', true, 6, 'weekend', 19900, 7000)
)
insert into public.package_prices (venue_id, package_id, with_food, guests, day_type, price, food_credit)
select v.id, p.id, s.with_food, s.guests, s.day_type, s.price, s.food_credit
from s
join public.venues   v on v.slug = s.slug
join public.packages p on p.key  = s.pkey;

do $$
declare n int;
begin
  select count(*) into n from public.package_prices;
  if n <> 40 then raise exception 'SEED_COUNT expected 40, got %', n; end if;
end $$;

-- Brochure grid: "from" price per active venue x active package. Dropped date/movie night keys excluded.
create view public.package_price_grid
with (security_invoker = true) as
select v.id   as venue_id, v.name as venue_name, v.slug as venue_slug, v.city,
       p.id   as package_id, p.key as package_key, p.name as package_name,
       min(pp.price) filter (where not pp.with_food) as from_price_no_food,
       min(pp.price) filter (where pp.with_food)     as from_price_with_food,
       min(pp.food_credit) filter (where pp.with_food) as min_food_credit
from public.package_prices pp
join public.venues   v on v.id = pp.venue_id and v.is_active
join public.packages p on p.id = pp.package_id and p.is_active
where pp.is_active
  and p.key not like 'date_night%' and p.key not like 'movie_night%'
group by v.id, v.name, v.slug, v.city, p.id, p.key, p.name;

grant select on public.package_price_grid to anon, authenticated;
