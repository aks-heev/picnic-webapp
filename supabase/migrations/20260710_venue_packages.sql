-- Stored per-venue package pricing (SPEC_stored_package_pricing_2026-07-10.md)
-- Kills derived package pricing. A package is offered at a venue iff an active
-- venue_packages row exists; its price/guest rules live on that row.
-- Seeds = today's derived values (venue base + bundle add-on sum), so nothing
-- customer-visible moves at cutover. The Prelude deliberately gets NO rows —
-- user enables it per venue from admin (it is currently mispriced at venue base).

-- 1) Free-text inclusions for bundle-less packages (The Prelude & future
--    non-derived packages). Array of strings, rendered as card bullets.
alter table public.packages
  add column if not exists inclusions jsonb not null default '[]'::jsonb;

-- 2) The Prelude: render before The Setting, real tagline + inclusions.
update public.packages
set sort_order = 0,
    tagline    = 'An intimate little world for up to four.',
    inclusions = '["Cozy macramé tent setup","Ambient fairy lighting","Curated lamps & floor seating","Perfect for 2–4 guests"]'::jsonb
where key = 'the_prelude';

-- 3) The price matrix.
create table public.venue_packages (
  venue_id           bigint  not null references public.venues(id)   on delete cascade,
  package_id         bigint  not null references public.packages(id) on delete cascade,
  price              numeric not null check (price > 0),
  included_guests    integer not null check (included_guests >= 1),
  overage_per_person numeric not null default 0 check (overage_per_person >= 0),
  max_guests         integer     null check (max_guests >= included_guests),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (venue_id, package_id)
);

alter table public.venue_packages enable row level security;

create policy "Public read venue_packages"
  on public.venue_packages for select using (true);

create policy "Authenticated insert venue_packages"
  on public.venue_packages for insert to authenticated with check (true);

create policy "Authenticated update venue_packages"
  on public.venue_packages for update to authenticated using (true) with check (true);

create policy "Authenticated delete venue_packages"
  on public.venue_packages for delete to authenticated using (true);

grant select on public.venue_packages to anon, authenticated;
grant insert, update, delete on public.venue_packages to authenticated;

-- 4) Seed: 7 existing packages × Beige (14) / Castle Valley (19) at today's
--    derived prices. included_guests/overage mirror the venues' current flat-to-6
--    +2,000/head cafe pricing. max_guests NULL = venue capacity applies.
insert into public.venue_packages (venue_id, package_id, price, included_guests, overage_per_person)
select v.venue_id, p.id, v.price, 6, 2000
from (values
  -- Beige Cafe (base 8,900)
  (14, 'setting',             8900::numeric),
  (14, 'moment',             12000),
  (14, 'story',              25000),
  (14, 'date_night_classic', 10900),
  (14, 'date_night_deluxe',  13900),
  (14, 'movie_night_classic',13900),
  (14, 'movie_night_deluxe', 17900),
  -- Castle Valley (base 9,900)
  (19, 'setting',             9900),
  (19, 'moment',             13000),
  (19, 'story',              26000),
  (19, 'date_night_classic', 11900),
  (19, 'date_night_deluxe',  14900),
  (19, 'movie_night_classic',14900),
  (19, 'movie_night_deluxe', 18900)
) as v(venue_id, pkg_key, price)
join public.packages p on p.key = v.pkg_key;
