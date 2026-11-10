-- RBAC v2, Phase 2 (docs/RBAC_PLAN_v2_2026-11-10.md §4): READ access for app_users roles.
-- Additive only: new permissive SELECT policies named rbac_*_select, placed beside the existing
-- aksh.eeev@ policies (Postgres ORs permissive policies). Nothing existing is altered.
-- Rollback: _rollback/20261110_rbac_phase2_rollback.sql

-- Regions where the caller holds a capability. Constant argument => (select app_regions('x'))
-- is evaluated once per statement (InitPlan), not once per row.
create or replace function public.app_regions(p_cap text)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when public.is_owner() then array['ncr','jaipur']
    else coalesce((select u.regions from public.app_users u
                   where u.user_id = auth.uid() and u.is_active
                     and p_cap = any(public.app_role_caps(u.role))), array[]::text[])
  end
$$;
revoke execute on function public.app_regions(text) from public, anon;
grant execute on function public.app_regions(text) to authenticated, service_role;

-- A. Region rows -------------------------------------------------------------
create policy rbac_bookings_select on public.bookings for select to authenticated
  using (region = any((select public.app_regions('read'))::text[]));
create policy rbac_expenses_select on public.expenses for select to authenticated
  using (region = any((select public.app_regions('money'))::text[]));

-- B. Booking children (read) ---------------------------------------------------
create policy rbac_booking_add_ons_select on public.booking_add_ons for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('read'))::text[])));
create policy rbac_booking_checklist_extras_select on public.booking_checklist_extras for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('read'))::text[])));
create policy rbac_booking_checklist_ticks_select on public.booking_checklist_ticks for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('read'))::text[])));
create policy rbac_booking_event_log_select on public.booking_event_log for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('read'))::text[])));
create policy rbac_booking_postponements_select on public.booking_postponements for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('read'))::text[])));
create policy rbac_booking_reviews_select on public.booking_reviews for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('read'))::text[])));
create policy rbac_orders_select on public.orders for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('read'))::text[])));
-- Drafts may exist before a booking row does: fall back to the draft's venue.
create policy rbac_booking_drafts_select on public.booking_drafts for select to authenticated
  using (
    (booking_id is not null and exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('read'))::text[])))
    or (booking_id is null and exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('read'))::text[]))));

-- C. Money -------------------------------------------------------------------
create policy rbac_booking_costs_select on public.booking_costs for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.region = any((select public.app_regions('money'))::text[])));
create policy rbac_cost_allocation_select on public.cost_allocation for select to authenticated
  using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('money'))::text[])));

-- D. Venue children ------------------------------------------------------------
create policy rbac_ical_feed_snapshots_select on public.ical_feed_snapshots for select to authenticated
  using (exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('read'))::text[])));
-- Active reels are already public; this adds inactive ones for the venue's region, global ones for owners.
create policy rbac_reels_select on public.reels for select to authenticated
  using ((select public.is_owner())
         or exists (select 1 from public.venues v where v.id = venue_id and v.region = any((select public.app_regions('read'))::text[])));

-- E. Config any staff/partner needs to run the admin forms ----------------------
create policy rbac_checklist_items_select on public.checklist_items for select to authenticated
  using ((select public.app_role()) is not null);

-- F. Owner analytics (Neeraj, Adhiraj; managers excluded) ----------------------
create policy rbac_ad_insights_select      on public.ad_insights      for select to authenticated using ((select public.is_owner()));
create policy rbac_ad_sync_runs_select     on public.ad_sync_runs     for select to authenticated using ((select public.is_owner()));
create policy rbac_gsc_daily_select        on public.gsc_daily        for select to authenticated using ((select public.is_owner()));
create policy rbac_gsc_page_window_select  on public.gsc_page_window  for select to authenticated using ((select public.is_owner()));
create policy rbac_gsc_query_window_select on public.gsc_query_window for select to authenticated using ((select public.is_owner()));
create policy rbac_web_daily_select        on public.web_daily        for select to authenticated using ((select public.is_owner()));
create policy rbac_web_event_daily_select  on public.web_event_daily  for select to authenticated using ((select public.is_owner()));
create policy rbac_web_sync_runs_select    on public.web_sync_runs    for select to authenticated using ((select public.is_owner()));
create policy rbac_web_window_select       on public.web_window       for select to authenticated using ((select public.is_owner()));
create policy rbac_meta_capi_events_select on public.meta_capi_events for select to authenticated using ((select public.is_owner()));

-- staff_tokens: superuser only (decision 2026-11-10).
create policy rbac_staff_tokens_select on public.staff_tokens for select to authenticated using ((select public.is_superuser()));
