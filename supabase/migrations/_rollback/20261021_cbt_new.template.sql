CREATE OR REPLACE FUNCTION __FN__(p_venue_id bigint, p_billing_guests integer, p_nights integer, p_addon_ids integer[], p_time_slot text, p_package_key text DEFAULT NULL::text, p_with_food boolean DEFAULT false, p_date date DEFAULT NULL::date)
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
  -- 2026-10-21 price table (docs/PACKAGE_PRICING_PLAN_2026-10-21.md)
  v_with_food boolean := coalesce(p_with_food, false);
  v_pkg_id bigint; v_has_vp boolean := false; v_tbl_price numeric; v_day text;
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
    -- Food choice and event date are passed down: the twin's price table decides them.
    return v_nights * coalesce(v_stay_rate,0)
         + coalesce(__FN__(
             v_picnic_venue, p_billing_guests, 0, null, p_time_slot, p_package_key, v_with_food, p_date), 0)
         + v_addons;
  end if;
  -- ===== end picnic_stay =====

  if v_package_key is not null then
    select p.id into v_pkg_id from packages p where p.key = v_package_key and p.is_active = true;

    select vp.price, vp.included_guests, vp.overage_per_person
    into v_pkg
    from venue_packages vp
    where vp.venue_id = p_venue_id
      and vp.package_id = v_pkg_id
      and vp.is_active = true;
    v_has_vp := found;

    if v_pkg_id is not null and exists (
         select 1 from package_prices pp
         where pp.venue_id = p_venue_id and pp.package_id = v_pkg_id and pp.is_active) then
      -- Price table wins. Weekend = Sat/Sun of the event date (a date: no timezone shift).
      v_day := case when p_date is null then null
                    when extract(isodow from p_date) in (6,7) then 'weekend' else 'weekday' end;
      select pp.price into v_tbl_price
        from package_prices pp
        where pp.venue_id = p_venue_id and pp.package_id = v_pkg_id and pp.is_active
          and pp.with_food = v_with_food
          and (case when v_with_food then pp.guests = v_guests else pp.guests is null end)
          and (pp.day_type = 'any' or pp.day_type = v_day)
        order by (pp.day_type = 'any') asc
        limit 1;
      if v_tbl_price is null then
        raise exception 'PRICE_NOT_AVAILABLE: package % (food=%) for % guests is not priced at venue %',
          v_package_key, v_with_food, v_guests, p_venue_id;
      end if;
      -- No-food rows keep today's extra-guest charge beyond included_guests; with-food rows are per guest count.
      v_picnic := v_tbl_price
        + case when not v_with_food and v_has_vp
               then greatest(v_guests - v_pkg.included_guests, 0) * v_pkg.overage_per_person
               else 0 end;
    elsif v_has_vp and not v_with_food then
      v_picnic := v_pkg.price
        + greatest(v_guests - v_pkg.included_guests, 0) * v_pkg.overage_per_person;
    elsif v_has_vp then
      raise exception 'PRICE_NOT_AVAILABLE: package % with food is not priced at venue %', v_package_key, p_venue_id;
    else
      raise exception 'PACKAGE_NOT_AVAILABLE: package % is not offered at venue %', v_package_key, p_venue_id;
    end if;

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
    if v_with_food then
      raise exception 'PRICE_NOT_AVAILABLE: food needs a package (venue %)', p_venue_id;
    end if;
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
end; $function$
