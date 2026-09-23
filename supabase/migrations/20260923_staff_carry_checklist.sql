-- 2026-09-23 — Carry-fresh checklist on /staff.
--
-- What staff see: one flat, tickable list per picnic =
--   (1) master items from checklist_items, resolved against the booking's package snapshot,
--       guest_count and board,
--   (2) add-ons: the package's bundled add-ons (package_add_ons — these are NOT copied into
--       booking_add_ons; verified on booking 209 / The Moment) UNION the booking's own
--       booking_add_ons, de-duplicated by add-on,
--   (3) per-booking extras the admin typed into the Add/Edit Booking form.
--
-- Ticks live in booking_checklist_ticks, are written ONLY through staff_set_checklist_tick,
-- and ONLY for the writable set staff_event_ids_active() (today + pre-04:00 IST grace) —
-- same day-cap as staff_log_step. A tick is SET-STATE, not toggle, so the staff.js retry
-- queue can replay it safely. No admin UI reads ticks (Aksheev's call, 2026-09-23).
--
-- 🔴 Nothing here is a column on `bookings`: customer_select_own_bookings is row-level, so a
--    signed-in customer reads every bookings column — an extra like "ring in the cake box"
--    must never live there.
-- 🔴 upcoming[] gets the checklist too (packing the night before), but it only ever carries
--    the LABEL "Board cutouts" — never board->>'message'.

-- ---------------------------------------------------------------- master list
create table if not exists public.checklist_items (
  key              text primary key,
  label            text not null,
  sort             int  not null default 100,
  qty_fixed        int,                               -- null = no count shown
  qty_per_guest    int,                               -- set => qty = qty_per_guest * guest_count
  qty_by_package   jsonb not null default '{}'::jsonb,-- {"the_prelude": 1} overrides qty_fixed
  exclude_packages text[] not null default '{}',
  condition        text not null default 'always' check (condition in ('always','white_board')),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);
alter table public.checklist_items enable row level security;
drop policy if exists admin_all_checklist_items on public.checklist_items;
create policy admin_all_checklist_items on public.checklist_items
  for all using (auth.email() = 'aksh.eeev@gmail.com') with check (auth.email() = 'aksh.eeev@gmail.com');

insert into public.checklist_items (key, label, sort, qty_fixed, qty_per_guest, qty_by_package, exclude_packages, condition) values
  ('vases',         'Flower vases',  10, 2,    null, '{"the_prelude": 1}', '{}',              'always'),
  ('plate_flowers', 'Plate flowers', 20, null, 1,    '{}',                 '{}',              'always'),
  ('napkins',       'Napkins',       30, null, 1,    '{}',                 '{}',              'always'),
  ('fruits',        'Fruits',        40, null, null, '{}',                 '{the_prelude}',   'always'),
  ('table_cloth',   'Table cloth',   50, null, null, '{}',                 '{}',              'always'),
  ('board_cutouts', 'Board cutouts', 60, null, null, '{}',                 '{}',              'white_board')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- per-booking extras
create table if not exists public.booking_checklist_extras (
  booking_id bigint not null references public.bookings(id) on delete cascade,
  label      text   not null check (char_length(btrim(label)) between 1 and 80),
  qty        int    check (qty is null or qty between 1 and 999),
  sort       int    not null default 0,
  -- stable id so a tick survives the admin re-saving the same list on the event day
  ref        text   generated always as ('x:' || md5(lower(btrim(label)))) stored,
  created_at timestamptz not null default now(),
  primary key (booking_id, ref)
);
alter table public.booking_checklist_extras enable row level security;
drop policy if exists admin_all_booking_checklist_extras on public.booking_checklist_extras;
create policy admin_all_booking_checklist_extras on public.booking_checklist_extras
  for all using (auth.email() = 'aksh.eeev@gmail.com') with check (auth.email() = 'aksh.eeev@gmail.com');

-- ---------------------------------------------------------------- ticks
create table if not exists public.booking_checklist_ticks (
  booking_id     bigint not null references public.bookings(id) on delete cascade,
  item_ref       text   not null,
  checked        boolean not null,
  at             timestamptz not null default now(),
  staff_token_id bigint references public.staff_tokens(id) on delete set null,
  by_name        text,
  primary key (booking_id, item_ref)
);
alter table public.booking_checklist_ticks enable row level security;
drop policy if exists admin_all_booking_checklist_ticks on public.booking_checklist_ticks;
create policy admin_all_booking_checklist_ticks on public.booking_checklist_ticks
  for all using (auth.email() = 'aksh.eeev@gmail.com') with check (auth.email() = 'aksh.eeev@gmail.com');

-- ---------------------------------------------------------------- resolver (internal)
create or replace function public.staff_checklist_for(p_booking_id bigint)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with b as (
    select id, package_key, guest_count, board from public.bookings where id = p_booking_id
  ),
  fixed as (
    select 1 as grp, i.sort, 'i:' || i.key as ref, i.label,
           case when i.qty_per_guest is not null then i.qty_per_guest * b.guest_count
                else coalesce((i.qty_by_package ->> b.package_key)::int, i.qty_fixed) end as qty,
           (i.qty_per_guest is not null and b.guest_count is null) as qty_unknown
    from public.checklist_items i cross join b
    where i.is_active
      and not (coalesce(b.package_key, '') = any (i.exclude_packages))
      and (i.condition = 'always'
           or (i.condition = 'white_board'
               and b.board ->> 'type' = 'white'
               and btrim(coalesce(b.board ->> 'message', '')) <> ''))
  ),
  addon_src as (
    -- booked rows win the label (price-time snapshot name); addon_id can be NULL (ON DELETE SET NULL)
    select coalesce(ba.addon_id::text, 'n' || md5(lower(btrim(ba.name)))) as k, ba.name as label, 0 as pri
    from public.booking_add_ons ba where ba.booking_id = p_booking_id
    union all
    select a.id::text, a.name, 1
    from b
    join public.packages p on p.key = b.package_key
    join public.package_add_ons pa on pa.package_id = p.id
    join public.add_ons a on a.id = pa.addon_id
  ),
  addons as (
    select distinct on (k) 2 as grp, 0 as sort, 'a:' || k as ref, label, null::int as qty, false as qty_unknown
    from addon_src order by k, pri
  ),
  extras as (
    select 3 as grp, e.sort, e.ref, e.label, e.qty, false as qty_unknown
    from public.booking_checklist_extras e where e.booking_id = p_booking_id
  ),
  items as (
    select * from fixed union all select * from addons union all select * from extras
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'ref', it.ref, 'label', it.label, 'qty', it.qty,
           'qty_unknown', case when it.qty_unknown then true end,
           'done', coalesce(t.checked, false)))
         order by it.grp, it.sort, it.label), '[]'::jsonb)
  from items it
  left join public.booking_checklist_ticks t
    on t.booking_id = p_booking_id and t.item_ref = it.ref;
$function$;

revoke all on function public.staff_checklist_for(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------- staff write
create or replace function public.staff_set_checklist_tick(p_token text, p_booking_id bigint, p_item_ref text, p_checked boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_tok public.staff_tokens%rowtype;
  v_list jsonb;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  select * into v_tok from public.staff_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  -- 🔴 Same writable set as staff_log_step: today's picnics (+ pre-04:00 grace). Never upcoming.
  if not exists (select 1 from public.staff_event_ids_active(v_tok.region) x where x = p_booking_id) then
    return jsonb_build_object('ok', false, 'error', 'not_today');
  end if;

  if p_checked is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_item');
  end if;

  v_list := public.staff_checklist_for(p_booking_id);
  if not exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'ref' = p_item_ref) then
    return jsonb_build_object('ok', false, 'error', 'unknown_item');
  end if;

  -- SET-STATE, idempotent: replaying the same job leaves the same row.
  insert into public.booking_checklist_ticks (booking_id, item_ref, checked, at, staff_token_id, by_name)
  values (p_booking_id, p_item_ref, p_checked, now(), v_tok.id, v_tok.staff_name)
  on conflict (booking_id, item_ref) do update
    set checked = excluded.checked, at = excluded.at,
        staff_token_id = excluded.staff_token_id, by_name = excluded.by_name;

  update public.staff_tokens set last_used_at = now() where id = v_tok.id;

  return jsonb_build_object('ok', true, 'booking_id', p_booking_id,
                            'checklist', public.staff_checklist_for(p_booking_id));
end;
$function$;

revoke all on function public.staff_set_checklist_tick(text, bigint, text, boolean) from public;
grant execute on function public.staff_set_checklist_tick(text, bigint, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------- admin write
create or replace function public.admin_set_booking_checklist_extras(p_booking_id bigint, p_items jsonb)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;
  if not exists (select 1 from public.bookings where id = p_booking_id) then
    raise exception 'Booking % not found', p_booking_id;
  end if;
  if p_items is null then p_items := '[]'::jsonb; end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Checklist extras must be a list';
  end if;

  -- Replace the whole set (the form always sends the full list).
  delete from public.booking_checklist_extras where booking_id = p_booking_id;

  insert into public.booking_checklist_extras (booking_id, label, qty, sort)
  select p_booking_id, btrim(x.item ->> 'label'),
         nullif(x.item ->> 'qty', '')::int, x.ord::int
  from jsonb_array_elements(p_items) with ordinality as x(item, ord)
  where btrim(coalesce(x.item ->> 'label', '')) <> ''
  on conflict (booking_id, ref) do nothing;          -- same label twice = one item

  -- Drop ticks for extras that no longer exist (fixed/add-on ticks untouched).
  delete from public.booking_checklist_ticks t
  where t.booking_id = p_booking_id and t.item_ref like 'x:%'
    and not exists (select 1 from public.booking_checklist_extras e
                    where e.booking_id = p_booking_id and e.ref = t.item_ref);
end;
$function$;

revoke all on function public.admin_set_booking_checklist_extras(bigint, jsonb) from public, anon;
grant execute on function public.admin_set_booking_checklist_extras(bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------- staff_today: add 'checklist'
-- Patched in place from the LIVE definition rather than re-typed (8 KB body; re-assembly is the
-- CLAUDE.md §3 tearing risk). Each anchor must occur exactly once or the migration aborts.
do $migration$
declare
  v_def  text := pg_get_functiondef('public.staff_today(text)'::regprocedure);
  a_ev   text := $a$'add_ons', coalesce((select jsonb_agg(jsonb_build_object('name', ba.name, 'price', ba.price_at_booking) order by ba.id)$a$;
  a_up   text := $a$'add_ons', coalesce((select jsonb_agg(jsonb_build_object('name', ba.name) order by ba.id)$a$;
  ins    text := $a$'checklist', public.staff_checklist_for(b.id),
        $a$;
begin
  if position('staff_checklist_for' in v_def) > 0 then
    raise notice 'staff_today already carries checklist — skipping';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, a_ev, ''))) / length(a_ev) <> 1 then
    raise exception 'events add_ons anchor not found exactly once';
  end if;
  if (length(v_def) - length(replace(v_def, a_up, ''))) / length(a_up) <> 1 then
    raise exception 'upcoming add_ons anchor not found exactly once';
  end if;
  v_def := replace(v_def, a_ev, ins || a_ev);
  v_def := replace(v_def, a_up, ins || a_up);
  execute v_def;
end
$migration$;
