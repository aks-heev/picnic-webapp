-- RBAC v2, Phase 3 (docs/RBAC_PLAN_v2_2026-11-10.md §5, §6): WRITE access + audit log.
-- 1. admin_audit_log + generic audit trigger on money/booking/venue/role tables.
-- 2. The 15 admin functions: back up the current definition to archive.rbac_phase3_fn_backup,
--    then replace ONLY the one-line email guard (asserted to occur exactly once).
-- 3. bookings_block_client_confirm: rewritten (tiny) so anon website inserts never call role helpers.
-- 4. 60 additive rbac_* INSERT/UPDATE/DELETE policies. Deletes of bookings, venues, packages,
--    add-ons, reels, teams, staff tokens stay with the existing superuser (email) policies.
-- Rollback: _rollback/20261110_rbac_phase3_rollback.sql

-- 1. Audit log ----------------------------------------------------------------
create table public.admin_audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_email text,
  actor_role  text,
  table_name  text not null,
  op          text not null,
  row_pk      text,
  booking_id  bigint,
  changes     jsonb not null
);
create index admin_audit_log_at_idx on public.admin_audit_log (at desc);
create index admin_audit_log_booking_idx on public.admin_audit_log (booking_id);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon;
-- Owners read. No INSERT/UPDATE/DELETE policy for anyone: append-only, written by the trigger below.
create policy rbac_admin_audit_log_select on public.admin_audit_log for select to authenticated
  using ((select public.is_owner()));

create or replace function public.rbac_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare o jsonb; n jsonb; d jsonb; r jsonb; pkcol text := coalesce(tg_argv[0], 'id');
begin
  -- Only human sessions. Service-role jobs (sheet sync, iCal, edge functions) have no auth.uid().
  if auth.uid() is null then return null; end if;
  if tg_op <> 'INSERT' then o := to_jsonb(old) - 'token_hash'; end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new) - 'token_hash'; end if;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(o -> k, n -> k)) into d
      from jsonb_object_keys(n) as t(k)
     where (o -> k) is distinct from (n -> k) and k not in ('updated_at', 'last_used_at', 'synced_at');
    if d is null then return null; end if;
  else
    d := coalesce(n, o);
  end if;
  r := coalesce(n, o);
  insert into public.admin_audit_log (actor, actor_email, actor_role, table_name, op, row_pk, booking_id, changes)
  values (auth.uid(), auth.email(), coalesce(public.app_role(), case when public.is_owner() then 'owner' end),
          tg_table_name, tg_op, r ->> pkcol,
          case when tg_table_name = 'bookings' then (r ->> 'id')::bigint
               else nullif(r ->> 'booking_id', '')::bigint end,
          d);
  return null;
end $$;
revoke execute on function public.rbac_audit() from public, anon, authenticated;

create trigger rbac_audit after insert or update or delete on public.bookings              for each row execute function public.rbac_audit('id');
create trigger rbac_audit after insert or update or delete on public.booking_costs         for each row execute function public.rbac_audit('booking_id');
create trigger rbac_audit after insert or update or delete on public.booking_postponements for each row execute function public.rbac_audit('id');
create trigger rbac_audit after insert or update or delete on public.venues                for each row execute function public.rbac_audit('id');
create trigger rbac_audit after insert or update or delete on public.venue_packages        for each row execute function public.rbac_audit('id');
create trigger rbac_audit after insert or update or delete on public.package_prices        for each row execute function public.rbac_audit('id');
create trigger rbac_audit after insert or update or delete on public.app_users             for each row execute function public.rbac_audit('user_id');
create trigger rbac_audit after insert or update or delete on public.staff_tokens          for each row execute function public.rbac_audit('id');

-- 2. Function guards ------------------------------------------------------------
create table if not exists archive.rbac_phase3_fn_backup (
  proname text primary key, def text not null, saved_at timestamptz not null default now());
revoke all on archive.rbac_phase3_fn_backup from anon, authenticated;

do $$
declare
  old_guard constant text := 'if auth.email() is distinct from ''aksh.eeev@gmail.com'' then';
  g record; def text; n int;
begin
  for g in select * from (values
    ('admin_add_manual_booking',
     'if not public.app_can_region((select v.region from public.venues v where v.id = nullif(p_booking->>''venue_id'', '''')::bigint), ''write'') then'),
    ('admin_edit_booking',
     'if not (public.app_can_booking(p_booking_id, ''write'') and (nullif(p_booking->>''venue_id'', '''') is null or public.app_can_region((select v.region from public.venues v where v.id = (p_booking->>''venue_id'')::bigint), ''write''))) then'),
    ('admin_apply_staff_extra_time',      'if not public.app_can_booking(p_booking_id, ''write'') then'),
    ('admin_postpone_booking',            'if not public.app_can_booking(p_booking_id, ''write'') then'),
    ('admin_reschedule_booking',          'if not public.app_can_booking(p_booking_id, ''write'') then'),
    ('admin_set_booking_checklist_extras','if not public.app_can_booking(p_booking_id, ''write'') then'),
    ('admin_set_booking_food',            'if not public.app_can_booking(p_booking_id, ''write'') then'),
    ('admin_set_booking_split',           'if not public.app_can_booking(p_booking_id, ''write'') then'),
    ('admin_resend_confirmation',         'if not public.app_can_booking(p_booking_id, ''write'') then'),
    ('admin_close_booking',               'if not public.app_can_booking(p_booking_id, ''money'') then'),
    ('admin_set_review_status',
     'if not public.app_can_booking((select r.booking_id from public.booking_reviews r where r.id = p_review_id), ''write'') then'),
    ('admin_set_package_prices',
     'if not public.app_can_region((select v.region from public.venues v where v.id = p_venue_id), ''venue'') then'),
    ('admin_reorder_reels',               'if not public.is_owner() then'),
    ('admin_issue_staff_token',           'if not public.is_superuser() then')
  ) as x(fn, new_guard) loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = g.fn;
    if def is null then raise exception 'rbac phase3: function % not found', g.fn; end if;
    n := (length(def) - length(replace(def, old_guard, ''))) / length(old_guard);
    if n <> 1 then raise exception 'rbac phase3: % has % guard matches, expected 1', g.fn, n; end if;
    insert into archive.rbac_phase3_fn_backup (proname, def) values (g.fn, def)
      on conflict (proname) do nothing;
    execute replace(def, old_guard, g.new_guard);
  end loop;
end $$;

-- 3. Client-confirm guard. Website (anon) inserts never reach the role helpers.
insert into archive.rbac_phase3_fn_backup (proname, def)
select 'bookings_block_client_confirm', pg_get_functiondef('public.bookings_block_client_confirm()'::regprocedure)
on conflict (proname) do nothing;

create or replace function public.bookings_block_client_confirm()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $function$
begin
  if new.confirmed is true and coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if coalesce(auth.role(), '') = 'anon' then
      new.confirmed := false;
    elsif not public.app_can_region(new.region, 'write') then
      new.confirmed := false;
    end if;
  end if;
  return new;
end $function$;

-- 4. Write policies -------------------------------------------------------------
-- A. bookings
create policy rbac_bookings_insert on public.bookings for insert to authenticated with check (region = any((select public.app_regions('write'))::text[]));
create policy rbac_bookings_update on public.bookings for update to authenticated using (region = any((select public.app_regions('write'))::text[])) with check (region = any((select public.app_regions('write'))::text[]));
-- B. booking children (the admin functions rewrite these rows, so delete is included)
create policy rbac_booking_add_ons_insert on public.booking_add_ons for insert to authenticated with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_add_ons_update on public.booking_add_ons for update to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_add_ons_delete on public.booking_add_ons for delete to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_checklist_extras_insert on public.booking_checklist_extras for insert to authenticated with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_checklist_extras_update on public.booking_checklist_extras for update to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_checklist_extras_delete on public.booking_checklist_extras for delete to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_checklist_ticks_insert on public.booking_checklist_ticks for insert to authenticated with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_checklist_ticks_update on public.booking_checklist_ticks for update to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_checklist_ticks_delete on public.booking_checklist_ticks for delete to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_event_log_insert on public.booking_event_log for insert to authenticated with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_event_log_update on public.booking_event_log for update to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_event_log_delete on public.booking_event_log for delete to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_postponements_insert on public.booking_postponements for insert to authenticated with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_postponements_update on public.booking_postponements for update to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_postponements_delete on public.booking_postponements for delete to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_menu_links_insert on public.menu_links for insert to authenticated with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_menu_links_update on public.menu_links for update to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_menu_links_delete on public.menu_links for delete to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_orders_insert on public.orders for insert to authenticated with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_orders_update on public.orders for update to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_orders_delete on public.orders for delete to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_reviews_update on public.booking_reviews for update to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[])));
create policy rbac_booking_drafts_insert on public.booking_drafts for insert to authenticated with check ((booking_id is not null and exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) or (booking_id is null and exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('write'))::text[]))));
create policy rbac_booking_drafts_update on public.booking_drafts for update to authenticated using ((booking_id is not null and exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) or (booking_id is null and exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('write'))::text[])))) with check ((booking_id is not null and exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) or (booking_id is null and exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('write'))::text[]))));
create policy rbac_booking_drafts_delete on public.booking_drafts for delete to authenticated using ((booking_id is not null and exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('write'))::text[]))) or (booking_id is null and exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('write'))::text[]))));
-- C. money
create policy rbac_booking_costs_insert on public.booking_costs for insert to authenticated with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('money'))::text[])));
create policy rbac_booking_costs_update on public.booking_costs for update to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('money'))::text[]))) with check (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('money'))::text[])));
create policy rbac_booking_costs_delete on public.booking_costs for delete to authenticated using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('money'))::text[])));
create policy rbac_cost_allocation_insert on public.cost_allocation for insert to authenticated with check (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('money'))::text[])));
create policy rbac_cost_allocation_update on public.cost_allocation for update to authenticated using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('money'))::text[]))) with check (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('money'))::text[])));
create policy rbac_cost_allocation_delete on public.cost_allocation for delete to authenticated using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('money'))::text[])));
-- D. venues and venue children
create policy rbac_venues_insert on public.venues for insert to authenticated with check (region = any((select public.app_regions('venue'))::text[]));
create policy rbac_venues_update on public.venues for update to authenticated using (region = any((select public.app_regions('venue'))::text[])) with check (region = any((select public.app_regions('venue'))::text[]));
create policy rbac_venue_packages_insert on public.venue_packages for insert to authenticated with check (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[])));
create policy rbac_venue_packages_update on public.venue_packages for update to authenticated using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[]))) with check (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[])));
create policy rbac_venue_packages_delete on public.venue_packages for delete to authenticated using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[])));
create policy rbac_venue_add_ons_insert on public.venue_add_ons for insert to authenticated with check (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[])));
create policy rbac_venue_add_ons_update on public.venue_add_ons for update to authenticated using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[]))) with check (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[])));
create policy rbac_venue_add_ons_delete on public.venue_add_ons for delete to authenticated using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[])));
create policy rbac_package_prices_insert on public.package_prices for insert to authenticated with check (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[])));
create policy rbac_package_prices_update on public.package_prices for update to authenticated using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[]))) with check (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[])));
create policy rbac_package_prices_delete on public.package_prices for delete to authenticated using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('venue'))::text[])));
create policy rbac_venue_availability_insert on public.venue_availability for insert to authenticated with check (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('write'))::text[])));
create policy rbac_venue_availability_update on public.venue_availability for update to authenticated using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('write'))::text[]))) with check (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('write'))::text[])));
create policy rbac_venue_availability_delete on public.venue_availability for delete to authenticated using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('write'))::text[])));
-- E. global catalogue/config: any owner inserts/updates; deletes stay superuser-only
create policy rbac_add_ons_insert on public.add_ons for insert to authenticated with check ((select public.is_owner()));
create policy rbac_add_ons_update on public.add_ons for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy rbac_packages_insert on public.packages for insert to authenticated with check ((select public.is_owner()));
create policy rbac_packages_update on public.packages for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy rbac_checklist_items_insert on public.checklist_items for insert to authenticated with check ((select public.is_owner()));
create policy rbac_checklist_items_update on public.checklist_items for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy rbac_reels_insert on public.reels for insert to authenticated with check ((select public.is_owner()));
create policy rbac_reels_update on public.reels for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy rbac_package_add_ons_insert on public.package_add_ons for insert to authenticated with check ((select public.is_owner()));
create policy rbac_package_add_ons_update on public.package_add_ons for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy rbac_package_add_ons_delete on public.package_add_ons for delete to authenticated using ((select public.is_owner()));
create policy rbac_site_settings_update on public.site_settings for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy rbac_teams_update on public.teams for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
