-- 2026-07-28 — fix multi-night stay pricing + partner_bnb/combo returning 0.
--
-- Three bugs, one root cause: compute_booking_total and app.js getVenuePrice
-- resolved the guest price from DIFFERENT sources, and the stay branch
-- multiplied nights by metadata.stay_price_per_night (0 on every venue).
--
--   1. self_managed total was flat across all nights (nights * 0 + base).
--      Live evidence: booking #71, 19 nights, stored total 10900.
--   2. partner_bnb and combo had no branch at all -> fell to `else return 0`,
--      so a partner BnB booking stored total 0 / advance 0.
--   3. Stays never applied free_guests_upto/overage_per_person, because the
--      tiers check came first and stays have `tiers: []`.
--
-- Fix: resolve the guest price from the COLUMNS first (matching app.js
-- getVenuePrice), falling back to metadata.tiers only for venues that have no
-- free_guests_upto — i.e. the partner_bnb stepped ladders. Then give
-- self_managed/combo a real per-night multiplier off base_price, and give
-- partner_bnb a flat picnic-setup price.
--
-- base_price is now unambiguously the NIGHTLY rate for self_managed/combo,
-- and extra-guest overage applies per night. metadata.stay_price_per_night is
-- no longer read by anything -- left in place, do not reintroduce it.
--
-- Signature is deliberately UNCHANGED -- no DROP, no second overload (CLAUDE.md §4).
--
-- Verified before applying against a throwaway probe function: all 45 package
-- combinations and all non-package cafe combinations return byte-identical
-- values. The only non-stay change is Beige Cafe's no-package path
-- (9900 -> 8900), which is dead code -- Beige is packages_enabled=true -- and
-- 8900 is what the site already displays.

CREATE OR REPLACE FUNCTION public.compute_booking_total(
  p_venue_id bigint,
  p_billing_guests integer,
  p_nights integer,
  p_addon_ids integer[],
  p_time_slot text,
  p_package_key text DEFAULT NULL::text)
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
begin
  if p_venue_id is null then return 0; end if;
  select type, base_price, metadata, free_guests_upto, overage_per_person
    into v_type, v_base, v_meta, v_free_upto, v_col_overage
    from venues where id = p_venue_id;
  if not found then return 0; end if;

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
