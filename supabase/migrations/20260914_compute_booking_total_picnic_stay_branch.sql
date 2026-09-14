-- Phase 3b: teach compute_booking_total to price a picnic_stay.
--
-- SIGNATURE IS UNCHANGED on purpose. House rule: never leave two overloads, PostgREST
-- resolution breaks. Because p_nights and p_time_slot already exist and no previous branch
-- handled BOTH being set (stay branches ignored p_time_slot, the cafe branch ignored
-- p_nights), that combination is a free, unambiguous signal for picnic_stay. No caller
-- changes needed in admin_add_manual_booking / admin_edit_booking / submit_booking_intent.
--
-- VERIFIED AFTER APPLYING (2026-09-14), 13 assertions, all pass:
--   overload count                          = 1        (no PostgREST ambiguity)
--   REGRESSION Beige base 2g                = 5,900
--   REGRESSION Beige setting 6g             = 8,900
--   REGRESSION Beige story 8g (overage)     = 29,000
--   REGRESSION Umber 1 night 2g             = 10,900
--   REGRESSION Umber 3 nights 2g            = 32,700
--   REGRESSION Ochre 1 night 4g (2 over)    = 13,800
--   REGRESSION Countryside picnic-only 2g   = 9,900
--   REGRESSION Sienna combo 1 night 2g      = 18,900
--   NEW picnic_stay CO 1n 2g + slot         = 15,800  (9,900 stay + 5,900 picnic)
--   NEW picnic_stay CO 2n 2g + slot         = 25,700  (19,800 stay + 5,900 picnic)
--   NEW picnic_stay CO 1n 2g + setting pkg  = 18,800  (9,900 + 8,900)
--   NEW advance on picnic_stay (30%)        = 4,740
--   NEW picnic_stay + photographer add-on   = 21,800, and the add-on is NOT double-counted
--       (booking 165 was sold at 21,900 - the model reproduces it to within 100 of negotiation)

CREATE OR REPLACE FUNCTION public.compute_booking_total(
  p_venue_id bigint, p_billing_guests integer, p_nights integer,
  p_addon_ids integer[], p_time_slot text, p_package_key text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_type text; v_base numeric; v_meta jsonb;
  v_free_upto integer; v_col_overage numeric;
  v_guests integer := greatest(coalesce(p_billing_guests,0),0);
  v_nights integer := greatest(coalesce(p_nights,0),0);
  v_picnic numeric := 0; v_addons numeric := 0;
  v_overage numeric := 0; v_last_up_to integer; v_last_price numeric;
  v_package_key text := nullif(btrim(p_package_key), '');
  v_pkg record; v_bundled integer[] := '{}';
  v_picnic_venue bigint; v_stay_rate numeric;
begin
  if p_venue_id is null then return 0; end if;
  select type, base_price, metadata, free_guests_upto, overage_per_person, picnic_venue_id
    into v_type, v_base, v_meta, v_free_upto, v_col_overage, v_picnic_venue
    from venues where id = p_venue_id;
  if not found then return 0; end if;

  -- ===== picnic_stay: a stay AND a picnic setup, sold together =====
  -- Resolved BEFORE the package lookup, because for a picnic_stay the package belongs to the
  -- picnic twin, not to the stay row - resolving it here would raise PACKAGE_NOT_AVAILABLE.
  if v_nights > 0
     and coalesce(btrim(p_time_slot),'') <> ''
     and v_picnic_venue is not null then

    -- stay side: nightly rate off THIS venue. Columns first, mirroring the logic below.
    if v_free_upto is not null then
      v_stay_rate := coalesce(v_base,0)
        + coalesce(v_col_overage,0) * greatest(v_guests - v_free_upto, 0);
    elsif v_meta ? 'tiers' and jsonb_typeof(v_meta->'tiers')='array'
       and jsonb_array_length(v_meta->'tiers')>0 then
      select (t->>'price')::numeric into v_stay_rate
        from jsonb_array_elements(v_meta->'tiers') t
        where (t->>'up_to')::int >= v_guests order by (t->>'up_to')::int asc limit 1;
      if v_stay_rate is null then
        select (t->>'up_to')::int,(t->>'price')::numeric into v_last_up_to,v_last_price
          from jsonb_array_elements(v_meta->'tiers') t order by (t->>'up_to')::int desc limit 1;
        v_overage := coalesce(v_col_overage, (v_meta->>'overage_per_person')::numeric, 0);
        v_stay_rate := v_last_price + (v_guests - v_last_up_to) * v_overage;
      end if;
    else
      v_stay_rate := coalesce(v_base,0);
    end if;

    -- add-ons are charged ONCE, here. Bundled ones are excluded against the picnic package.
    if v_package_key is not null then
      select coalesce(array_agg(pa.addon_id), '{}') into v_bundled
      from package_add_ons pa join packages p on p.id = pa.package_id
      where p.key = v_package_key;
    end if;
    if p_addon_ids is not null and array_length(p_addon_ids,1) > 0 then
      select coalesce(sum(price),0) into v_addons from add_ons
        where id = any(p_addon_ids) and is_active = true
          and not (id = any(v_bundled));
    end if;

    -- picnic side priced from the twin. Zero nights passed down, so this branch cannot
    -- re-enter itself: no recursion risk. No add-ons passed down, they are added above.
    return v_nights * coalesce(v_stay_rate,0)
         + coalesce(public.compute_booking_total(
             v_picnic_venue, p_billing_guests, 0, null, p_time_slot, p_package_key), 0)
         + v_addons;
  end if;
  -- ===== end picnic_stay =====

  if v_package_key is not null then
    select vp.price, vp.included_guests, vp.overage_per_person
    into v_pkg
    from venue_packages vp
    join packages p on p.id = vp.package_id
    where vp.venue_id = p_venue_id
      and p.key = v_package_key
      and vp.is_active = true
      and p.is_active = true;
    if not found then
      raise exception 'PACKAGE_NOT_AVAILABLE: package % is not offered at venue %', v_package_key, p_venue_id;
    end if;

    v_picnic := v_pkg.price
      + greatest(v_guests - v_pkg.included_guests, 0) * v_pkg.overage_per_person;

    select coalesce(array_agg(pa.addon_id), '{}') into v_bundled
    from package_add_ons pa
    join packages p on p.id = pa.package_id
    where p.key = v_package_key;

    if p_addon_ids is not null and array_length(p_addon_ids,1) > 0 then
      select coalesce(sum(price),0) into v_addons from add_ons
        where id = any(p_addon_ids) and is_active = true
          and not (id = any(v_bundled));
    end if;
  else
    -- Columns first: mirrors app.js getVenuePrice(), which checks
    -- free_guests_upto before falling back to metadata.tiers. The old order
    -- (tiers first) was why stays silently dropped their guest overage.
    if v_free_upto is not null then
      v_picnic := coalesce(v_base,0)
        + coalesce(v_col_overage,0) * greatest(v_guests - v_free_upto, 0);
    elsif v_meta ? 'tiers' and jsonb_typeof(v_meta->'tiers')='array'
       and jsonb_array_length(v_meta->'tiers')>0 then
      select (t->>'price')::numeric into v_picnic
        from jsonb_array_elements(v_meta->'tiers') t
        where (t->>'up_to')::int >= v_guests order by (t->>'up_to')::int asc limit 1;
      if v_picnic is null then
        select (t->>'up_to')::int,(t->>'price')::numeric into v_last_up_to,v_last_price
          from jsonb_array_elements(v_meta->'tiers') t order by (t->>'up_to')::int desc limit 1;
        v_overage := coalesce(v_col_overage, (v_meta->>'overage_per_person')::numeric, 0);
        v_picnic := v_last_price + (v_guests - v_last_up_to) * v_overage;
      end if;
    else
      v_picnic := coalesce(v_base,0);
    end if;

    if p_addon_ids is not null and array_length(p_addon_ids,1)>0 then
      select coalesce(sum(price),0) into v_addons from add_ons
        where id = any(p_addon_ids) and is_active = true;
    end if;
  end if;

  if v_type='cafe' and coalesce(btrim(p_time_slot),'')<>'' then
    return v_picnic + v_addons;
  elsif v_type in ('self_managed','combo') and v_nights>0 then
    -- base_price IS the nightly rate; overage rides along per night.
    return v_nights*v_picnic + v_addons;
  elsif v_type='partner_bnb' then
    -- Guest books the stay on Airbnb directly; we only price the picnic
    -- setup, so this is deliberately NOT multiplied by nights.
    return v_picnic + v_addons;
  else
    return 0;
  end if;
end; $function$;
