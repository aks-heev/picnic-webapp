-- RBAC v2, Phase 1 (docs/RBAC_PLAN_v2_2026-11-10.md §3, §7).
-- Purely additive: new table + helper functions + one owner row + expenses.region.
-- No existing policy or function is changed, so nobody gains or loses access.
-- Rollback: _rollback/20261110_rbac_phase1_rollback.sql

-- 1. Role membership ------------------------------------------------------------
create table public.app_users (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('owner','manager','sales','viewer')),
  regions      text[] not null default '{}' check (regions <@ array['ncr','jaipur']::text[]),
  is_superuser boolean not null default false,
  display_name text not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  constraint app_users_superuser_is_owner check (not is_superuser or role = 'owner'),
  constraint app_users_nonowner_has_region check (role = 'owner' or cardinality(regions) > 0)
);
comment on table public.app_users is
  'Staff/partner access. Only a row here grants business access; customers (phone OTP) never have one. RBAC v2.';

alter table public.app_users enable row level security;
revoke all on public.app_users from anon;

-- 2. Helpers. SECURITY DEFINER so they read app_users without recursing into its RLS.
--    STABLE, fixed search_path. Policies must call them as (select fn(...)) for InitPlan.
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select u.role from public.app_users u where u.user_id = auth.uid() and u.is_active
$$;

-- Email fallback keeps the owner in while the 82 legacy policies are migrated. Removed in Phase 6.
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select u.role = 'owner' from public.app_users u where u.user_id = auth.uid() and u.is_active), false)
      or coalesce(auth.email() = 'aksh.eeev@gmail.com', false)
$$;

create or replace function public.is_superuser()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select u.is_superuser from public.app_users u where u.user_id = auth.uid() and u.is_active), false)
      or coalesce(auth.email() = 'aksh.eeev@gmail.com', false)
$$;

-- Capabilities: read | write | money | venue. Owner has all, in every region.
create or replace function public.app_role_caps(p_role text)
returns text[] language sql immutable set search_path = public, pg_temp as $$
  select case p_role
    when 'owner'   then array['read','write','money','venue']
    when 'manager' then array['read','write','money','venue']
    when 'sales'   then array['read','write']
    when 'viewer'  then array['read','money']
    else array[]::text[] end
$$;

create or replace function public.app_can_region(p_region text, p_cap text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_owner()
      or exists (
        select 1 from public.app_users u
        where u.user_id = auth.uid() and u.is_active
          and p_region = any(u.regions)
          and p_cap = any(public.app_role_caps(u.role)))
$$;

create or replace function public.app_can_booking(p_booking_id bigint, p_cap text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.app_can_region((select b.region from public.bookings b where b.id = p_booking_id), p_cap)
$$;

-- What the frontends read. Never trusted for security; the DB policies are the boundary.
create or replace function public.my_access()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when u.user_id is not null and u.is_active then jsonb_build_object(
      'role', u.role,
      'regions', case when u.role = 'owner' then to_jsonb(array['ncr','jaipur']) else to_jsonb(u.regions) end,
      'is_superuser', u.is_superuser,
      'caps', to_jsonb(public.app_role_caps(u.role)),
      'display_name', u.display_name)
    when coalesce(auth.email() = 'aksh.eeev@gmail.com', false) then jsonb_build_object(
      'role', 'owner', 'regions', to_jsonb(array['ncr','jaipur']), 'is_superuser', true,
      'caps', to_jsonb(public.app_role_caps('owner')), 'display_name', 'Aksheev')
    else null end
  from (select 1) one
  left join public.app_users u on u.user_id = auth.uid()
$$;

revoke execute on function public.app_role(), public.is_owner(), public.is_superuser(),
  public.app_role_caps(text), public.app_can_region(text, text), public.app_can_booking(bigint, text),
  public.my_access() from public, anon;
grant execute on function public.app_role(), public.is_owner(), public.is_superuser(),
  public.app_role_caps(text), public.app_can_region(text, text), public.app_can_booking(bigint, text),
  public.my_access() to authenticated, service_role;

-- 3. app_users policies: see your own row; owners see all; only the superuser writes.
create policy rbac_app_users_select on public.app_users for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_owner()));
create policy rbac_app_users_insert on public.app_users for insert to authenticated
  with check ((select public.is_superuser()));
create policy rbac_app_users_update on public.app_users for update to authenticated
  using ((select public.is_superuser())) with check ((select public.is_superuser()));
create policy rbac_app_users_delete on public.app_users for delete to authenticated
  using ((select public.is_superuser()));

-- Never leave the business without an active superuser.
create or replace function public.app_users_keep_superuser()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if not exists (
      select 1 from public.app_users u
      where u.is_superuser and u.is_active and u.role = 'owner'
        and u.user_id <> old.user_id)
     and old.is_superuser and old.is_active
     and (tg_op = 'DELETE' or not (new.is_superuser and new.is_active and new.role = 'owner')) then
    raise exception 'app_users: cannot remove or demote the last active superuser';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.app_users_keep_superuser() from public, anon, authenticated;
create trigger app_users_keep_superuser before update or delete on public.app_users
  for each row execute function public.app_users_keep_superuser();

-- 4. Seed the owner/superuser. Neeraj, Adhiraj, Deepika are added in Phase 5 once invited
--    (app_users.user_id must reference an existing auth user).
insert into public.app_users (user_id, role, regions, is_superuser, display_name, created_by)
select id, 'owner', array['ncr','jaipur'], true, 'Aksheev', id
from auth.users where email = 'aksh.eeev@gmail.com';

-- 5. expenses.region, derived from the sheet's free-text city (blank/unknown = ncr).
alter table public.expenses add column region text
  generated always as (case when lower(trim(coalesce(city,''))) = 'jaipur' then 'jaipur' else 'ncr' end) stored;
create index expenses_region_idx on public.expenses (region);
create index if not exists venues_region_idx on public.venues (region);

-- 6. Tidy: the two retired (inactive) staff tokens with no region.
update public.staff_tokens set region = 'ncr' where region is null and is_active = false;
