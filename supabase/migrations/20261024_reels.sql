-- Brochure reels (2026-10-24).
-- One row per Instagram reel/post shown on /brochure. package_id set = the reel
-- may sit on that package's card (rule: everything visible in it is part of the
-- package; the admin form makes the admin confirm this). package_id null = the
-- reel feeds theme rows / "Get inspired" only. No images or video are stored:
-- the brochure shows a branded tile and links to (later: embeds) Instagram.
-- packages.reels (jsonb, unused by any code) is left in place; its one row is
-- copied in below.

create table public.reels (
  id          bigint generated always as identity primary key,
  package_id  bigint references public.packages(id) on delete set null,
  ig_kind     text not null default 'reel' check (ig_kind in ('reel', 'p')),
  ig_code     text not null check (ig_code ~ '^[A-Za-z0-9_-]{5,40}$'),
  theme       text check (theme in ('blush_pink', 'ivory_beige', 'sage_green', 'custom')),
  -- Same list as app.js OCCASIONS (string equality across surfaces).
  occasion    text check (occasion in ('Birthday', 'Anniversary', 'Proposal', 'Date Night', 'Movie Night', 'Bridal Shower', 'Baby Shower', 'Graduation', 'Just Because')),
  caption     text check (char_length(caption) <= 200),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- The same reel can't be added twice to one package (or twice to "no package").
create unique index reels_package_code_uniq on public.reels (coalesce(package_id, 0), ig_code);
create index reels_package_idx on public.reels (package_id);

alter table public.reels enable row level security;

create policy reels_public_select_active on public.reels
  for select to anon, authenticated
  using (is_active = true);

create policy reels_admin_select on public.reels
  for select to authenticated
  using ((select auth.email()) = 'aksh.eeev@gmail.com');

create policy reels_admin_insert on public.reels
  for insert to authenticated
  with check ((select auth.email()) = 'aksh.eeev@gmail.com');

create policy reels_admin_update on public.reels
  for update to authenticated
  using ((select auth.email()) = 'aksh.eeev@gmail.com')
  with check ((select auth.email()) = 'aksh.eeev@gmail.com');

create policy reels_admin_delete on public.reels
  for delete to authenticated
  using ((select auth.email()) = 'aksh.eeev@gmail.com');

revoke all on public.reels from anon;
grant select on public.reels to anon;
grant select, insert, update, delete on public.reels to authenticated;

-- Reorder reels within one group: p_ids in the new order get sort_order 1..n.
create or replace function public.admin_reorder_reels(p_ids bigint[])
returns void
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;
  update public.reels r
     set sort_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where r.id = o.id;
end;
$$;

revoke all on function public.admin_reorder_reels(bigint[]) from public, anon;
grant execute on function public.admin_reorder_reels(bigint[]) to authenticated;

-- Carry over the one reel stored in packages.reels (The Story).
insert into public.reels (package_id, ig_kind, ig_code, caption, sort_order)
select p.id, m[1], m[2], left(r->>'caption', 200), 1
  from public.packages p,
       jsonb_array_elements(coalesce(p.reels, '[]'::jsonb)) r,
       regexp_match(r->>'url', 'instagram\.com/(reel|p)/([A-Za-z0-9_-]+)') m
 where m is not null;

-- ---------------------------------------------------------------------------
-- Second migration (reels_import_occasion_reels), applied the same day:
-- allow 'Bachelorette', merge the two SELECT policies into one, and copy the
-- 9 rows of occasion_reels (also unused by any code) in as package-less reels.
-- occasion_reels is left in place.

alter table public.reels drop constraint reels_occasion_check;
alter table public.reels add constraint reels_occasion_check check (occasion in ('Birthday', 'Anniversary', 'Proposal', 'Date Night', 'Movie Night', 'Bridal Shower', 'Baby Shower', 'Graduation', 'Just Because', 'Bachelorette'));

drop policy reels_public_select_active on public.reels;
drop policy reels_admin_select on public.reels;
create policy reels_select on public.reels for select to anon, authenticated
  using (is_active = true or (select auth.email()) = 'aksh.eeev@gmail.com');

update public.reels set occasion = 'Proposal' where ig_code = 'DUqOYSxky-4' and occasion is null;
insert into public.reels (package_id, ig_kind, ig_code, occasion, caption, sort_order, is_active)
select null, m[1], m[2],
       case o.occasion when 'proposal' then 'Proposal' when 'birthday' then 'Birthday'
                       when 'bachelorette' then 'Bachelorette' when 'date_night' then 'Date Night' end,
       left(o.caption, 200), o.id, o.is_active
  from public.occasion_reels o,
       regexp_match(o.url, 'instagram\.com/(reel|p)/([A-Za-z0-9_-]+)') m
 where m is not null
   and not exists (select 1 from public.reels r where r.ig_code = m[2]);
