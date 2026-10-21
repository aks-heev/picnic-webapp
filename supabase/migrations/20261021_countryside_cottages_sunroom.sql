-- 20261021_countryside_cottages_sunroom.sql
-- Phase 4 of docs/PACKAGE_PRICING_PLAN_2026-10-21.md.
--  * Two Countryside cottage stay listings (picnic_stay twin = venue 27), couples only, on request.
--  * 2026-11-02 blocked on the SMALL cottage for booking 263 (confirmed, made on old venue 22).
--  * Venue 27 (Countryside picnic): capacity 2-2; venue_packages prices aligned to Beige (display paths).
--  * Venue 22 (old single Countryside stay listing) deactivated; its bookings untouched.
--  * Sunroom: Setting offered (venue_packages row) but packages_enabled stays FALSE until the site shows food (Phase 5).
-- Rollback:
--   delete from venues where slug in ('countryside-offgrid-small-cottage','countryside-offgrid-big-cottage');  -- cascades blocks/add-ons
--   update venues set is_active = true where slug = 'countryside-offgrid';
--   update venues set capacity_min = 2, capacity_max = 6 where slug = 'countryside-offgrid-picnic';
--   update venue_packages vp set price = x.p from packages p, (values ('the_prelude',11900),('setting',14900),('moment',18900),('story',30900)) x(k,p)
--     where p.key = x.k and vp.package_id = p.id and vp.venue_id = (select id from venues where slug = 'countryside-offgrid-picnic');
--   delete from venue_packages where venue_id = (select id from venues where slug = 'the-sunroom')
--     and package_id = (select id from packages where key = 'setting');

do $$
declare
  v_old bigint; v_twin bigint; v_small bigint; v_big bigint; v_sun bigint; v_setting bigint;
  t numeric;
begin
  select id into v_old  from venues where slug = 'countryside-offgrid';
  select id into v_twin from venues where slug = 'countryside-offgrid-picnic';
  select id into v_sun  from venues where slug = 'the-sunroom';
  select id into v_setting from packages where key = 'setting';
  if v_old is null or v_twin is null or v_sun is null or v_setting is null then
    raise exception 'PHASE4: could not resolve venues/packages (old %, twin %, sunroom %, setting %)', v_old, v_twin, v_sun, v_setting;
  end if;

  -- 1) cottages, cloned from the old listing's content; pricing columns set explicitly
  insert into venues (name, slug, type, description, area, city, region, setting, team_id, maps_url, images, menu_pages,
                      sort_order, capacity_min, capacity_max, base_price, free_guests_upto, overage_per_person, metadata,
                      max_concurrent_setups, requires_confirmation, packages_enabled, picnic_venue_id, external_url, is_active)
  select 'Countryside Offgrid — Small Cottage', 'countryside-offgrid-small-cottage', type, description, area, city, region, setting,
         team_id, maps_url, images, menu_pages, sort_order, 2, 2, 5000, 2, 0, '{"includes": []}'::jsonb,
         1, true, false, v_twin, null, true
  from venues where id = v_old
  returning id into v_small;

  insert into venues (name, slug, type, description, area, city, region, setting, team_id, maps_url, images, menu_pages,
                      sort_order, capacity_min, capacity_max, base_price, free_guests_upto, overage_per_person, metadata,
                      max_concurrent_setups, requires_confirmation, packages_enabled, picnic_venue_id, external_url, is_active)
  select 'Countryside Offgrid — Big Cottage', 'countryside-offgrid-big-cottage', type, description, area, city, region, setting,
         team_id, maps_url, images, menu_pages, sort_order, 2, 2, 7000, 2, 0, '{"includes": []}'::jsonb,
         1, true, false, v_twin, null, true
  from venues where id = v_old
  returning id into v_big;

  insert into venue_add_ons (venue_id, addon_id)
  select x.vid, va.addon_id from venue_add_ons va cross join (values (v_small), (v_big)) x(vid) where va.venue_id = v_old;

  -- 2) booking 263 (confirmed, 2026-11-02 -> 11-03, old listing) is the small cottage
  insert into venue_availability (venue_id, date, status, source, booking_id, time_slot)
  values (v_small, date '2026-11-02', 'blocked', 'admin', null, null);

  -- 3) Countryside picnic listing: couples only; display prices = Beige
  update venues set capacity_min = 2, capacity_max = 2 where id = v_twin;
  update venue_packages vp set price = x.p, updated_at = now()
  from packages p, (values ('the_prelude',5900),('setting',8900),('moment',12900),('story',24900)) x(k,p)
  where p.key = x.k and vp.package_id = p.id and vp.venue_id = v_twin;

  -- 4) retire the old single listing
  update venues set is_active = false where id = v_old;

  -- 5) Sunroom: offer Setting (max 6) but keep packages hidden on the site
  insert into venue_packages (venue_id, package_id, price, included_guests, overage_per_person, max_guests, is_active)
  values (v_sun, v_setting, 13900, 6, 0, 6, true);

  -- ===== self-checks: any failure aborts the whole migration =====
  t := public.compute_booking_total(v_small, 2, 1, null, 'evening', 'the_prelude');
  if t <> 10900 then raise exception 'PHASE4 small prelude 1n = % (want 10900)', t; end if;
  t := public.compute_booking_total(v_big, 2, 1, null, 'evening', 'the_prelude');
  if t <> 12900 then raise exception 'PHASE4 big prelude 1n = % (want 12900)', t; end if;
  t := public.compute_booking_total(v_small, 2, 1, null, 'evening', 'the_prelude', true);
  if t <> 12399 then raise exception 'PHASE4 small prelude food = % (want 12399)', t; end if;
  t := public.compute_booking_total(v_big, 2, 1, null, 'evening', 'story', true);
  if t <> 32900 then raise exception 'PHASE4 big story food = % (want 32900)', t; end if;
  t := public.compute_booking_total(v_small, 2, 2, null, 'evening', 'setting');
  if t <> 18900 then raise exception 'PHASE4 small setting 2n = % (want 18900)', t; end if;
  t := public.compute_booking_total(v_twin, 2, 0, null, 'evening', 'moment');
  if t <> 12900 then raise exception 'PHASE4 picnic-only moment = % (want 12900)', t; end if;
  if (select count(*) from venue_availability where venue_id = v_small and date = '2026-11-02') <> 1 then
    raise exception 'PHASE4 block for booking 263 missing'; end if;
  if (select is_active from venues where id = v_old) then raise exception 'PHASE4 old listing still active'; end if;
  if (select packages_enabled from venues where id = v_sun) then raise exception 'PHASE4 Sunroom packages must stay hidden'; end if;
  if (select count(*) from venue_add_ons where venue_id in (v_small, v_big))
     <> 2 * (select count(*) from venue_add_ons where venue_id = v_old) then raise exception 'PHASE4 add-on copy mismatch'; end if;
end $$;
