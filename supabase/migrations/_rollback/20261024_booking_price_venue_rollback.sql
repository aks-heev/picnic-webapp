-- Rollback for 20261024_booking_price_venue.sql — restores compute_booking_total and
-- submit_booking_intent exactly as live before 2026-10-24, then drops the helper.
-- Order matters: restore both functions first (they call the helper), then drop it.

CREATE OR REPLACE FUNCTION public.compute_booking_total(p_venue_id bigint, p_billing_guests integer, p_nights integer, p_addon_ids integer[], p_time_slot text, p_package_key text DEFAULT NULL::text, p_with_food boolean DEFAULT false, p_date date DEFAULT NULL::date)
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
  v_with_food boolean := coalesce(p_with_food, false);
  v_pkg_id bigint; v_has_vp boolean := false; v_tbl_price numeric; v_day text;
begin
  if p_venue_id is null then return 0; end if;
  select type, base_price, metadata, free_guests_upto, overage_per_person, picnic_venue_id
    into v_type, v_base, v_meta, v_free_upto, v_col_overage, v_picnic_venue
    from venues where id = p_venue_id;
  if not found then return 0; end if;

  if v_nights > 0
     and coalesce(btrim(p_time_slot),'') <> ''
     and v_picnic_venue is not null then
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
    return v_nights * coalesce(v_stay_rate,0)
         + coalesce(public.compute_booking_total(
             v_picnic_venue, p_billing_guests, 0, null, p_time_slot, p_package_key, v_with_food, p_date), 0)
         + v_addons;
  end if;

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
    return v_nights*v_picnic + v_addons;
  elsif v_type='partner_bnb' then
    return v_picnic + v_addons;
  else
    return 0;
  end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.submit_booking_intent(p_full_name text, p_mobile_number text, p_email_address text, p_guest_count integer, p_preferred_date date, p_special_requirements text, p_advance_amount numeric, p_confirmed boolean, p_customer_intent text, p_venue_id bigint DEFAULT NULL::bigint, p_venue_address text DEFAULT NULL::text, p_checkout_date date DEFAULT NULL::date, p_time_slot text DEFAULT NULL::text, p_external_booking_ref text DEFAULT NULL::text, p_add_ons jsonb DEFAULT '[]'::jsonb, p_occasion text DEFAULT NULL::text, p_board jsonb DEFAULT NULL::jsonb, p_children_count integer DEFAULT 0, p_booking_id bigint DEFAULT NULL::bigint, p_package_key text DEFAULT NULL::text, p_with_food boolean DEFAULT false)
 RETURNS TABLE(id bigint, confirmed boolean, preferred_date date, guest_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_booking_id bigint; v_confirmed boolean; v_preferred_date date; v_guest_count integer;
  v_advance numeric; v_total numeric; v_addon_ids integer[]; v_nights integer;
  v_package_key text; v_package_name text; v_package_tagline text;
  v_pkg_max_guests integer; v_bundled integer[] := '{}';
  v_with_food boolean := coalesce(p_with_food, false); v_food_credit numeric; v_price_venue bigint;
begin
  if p_customer_intent not in ('lock','query') then raise exception 'Invalid customer_intent value'; end if;
  if p_guest_count < 1 or p_guest_count > 100 then raise exception 'Invalid guest_count'; end if;
  if p_children_count < 0 or p_children_count > p_guest_count then raise exception 'Invalid children_count'; end if;
  if p_venue_id is not null
     and exists (select 1 from venues v where v.id = p_venue_id and v.type = 'combo') then
    p_confirmed := false; p_customer_intent := 'query';
  end if;
  v_package_key := nullif(btrim(p_package_key), '');
  if v_package_key is not null then
    select p.name, p.tagline into v_package_name, v_package_tagline
    from packages p where p.key = v_package_key and p.is_active = true;
    if v_package_name is null then
      raise exception 'PACKAGE_NOT_AVAILABLE: unknown or inactive package %', v_package_key;
    end if;
    select vp.max_guests into v_pkg_max_guests
    from venue_packages vp
    join packages p on p.id = vp.package_id
    where vp.venue_id = p_venue_id and p.key = v_package_key and vp.is_active = true;
    if not found then
      raise exception 'PACKAGE_NOT_AVAILABLE: package % is not offered at venue %', v_package_key, p_venue_id;
    end if;
    if v_pkg_max_guests is not null and p_guest_count > v_pkg_max_guests then
      raise exception 'GUESTS_EXCEED_PACKAGE_MAX: package % allows at most % guests', v_package_key, v_pkg_max_guests;
    end if;
    select coalesce(array_agg(pa.addon_id), '{}') into v_bundled
    from package_add_ons pa
    join packages p on p.id = pa.package_id
    where p.key = v_package_key;
  end if;
  select array_agg(nullif(e->>'addon_id','')::int) into v_addon_ids
  from jsonb_array_elements(coalesce(p_add_ons,'[]'::jsonb)) e
  where nullif(e->>'addon_id','') is not null;
  v_nights := case
    when p_checkout_date is not null and p_preferred_date is not null
      then greatest((p_checkout_date - p_preferred_date),0) else 0 end;
  v_total := coalesce(public.compute_booking_total(
    p_venue_id, greatest(p_guest_count - coalesce(p_children_count,0),0),
    v_nights, v_addon_ids, p_time_slot, v_package_key, v_with_food, p_preferred_date), 0);
  v_advance := coalesce(public.compute_booking_advance(
    p_venue_id, greatest(p_guest_count - coalesce(p_children_count,0),0),
    v_nights, v_addon_ids, p_time_slot, v_package_key, v_with_food, p_preferred_date), 0);
  if v_with_food and v_package_key is not null then
    select case when v_nights > 0 and coalesce(btrim(p_time_slot),'') <> '' and v.picnic_venue_id is not null
                then v.picnic_venue_id else v.id end
      into v_price_venue from venues v where v.id = p_venue_id;
    select pp.food_credit into v_food_credit
      from package_prices pp join packages p on p.id = pp.package_id
      where pp.venue_id = v_price_venue and p.key = v_package_key and pp.is_active and pp.with_food
        and pp.guests = greatest(p_guest_count - coalesce(p_children_count,0),0)
        and (pp.day_type = 'any' or pp.day_type =
             case when p_preferred_date is null then null
                  when extract(isodow from p_preferred_date) in (6,7) then 'weekend' else 'weekday' end)
      order by (pp.day_type = 'any') asc limit 1;
  end if;
  if p_booking_id is not null then
    update bookings b
    set full_name = p_full_name, guest_count = p_guest_count, children_count = coalesce(p_children_count,0),
        preferred_date = p_preferred_date, special_requirements = p_special_requirements,
        advance_amount = v_advance, total_amount = v_total, customer_intent = p_customer_intent,
        venue_id = p_venue_id, venue_address = p_venue_address, checkout_date = p_checkout_date,
        time_slot = p_time_slot, external_booking_ref = p_external_booking_ref,
        occasion = nullif(btrim(p_occasion),''), board = p_board, package_key = v_package_key,
        package_name = v_package_name, package_tagline = v_package_tagline,
        with_food = v_with_food, food_credit = v_food_credit
    where b.id = p_booking_id and b.confirmed = false
      and b.mobile_number = p_mobile_number and b.email_address = p_email_address
    returning b.id, b.confirmed, b.preferred_date, b.guest_count
    into v_booking_id, v_confirmed, v_preferred_date, v_guest_count;
    if v_booking_id is not null then
      delete from booking_add_ons where booking_id = v_booking_id;
      if p_add_ons is not null and jsonb_typeof(p_add_ons)='array' and jsonb_array_length(p_add_ons)>0 then
        insert into booking_add_ons (booking_id, addon_id, name, price_at_booking, requires_confirmation)
        select v_booking_id, nullif(e->>'addon_id','')::int, coalesce(a.name, e->>'name'),
               case when nullif(e->>'addon_id','')::int = any(v_bundled) then 0 else coalesce(a.price,0) end,
               coalesce((e->>'requires_confirmation')::boolean, false)
        from jsonb_array_elements(p_add_ons) e
        left join add_ons a on a.id = nullif(e->>'addon_id','')::int and a.is_active = true;
      end if;
      return query select v_booking_id, v_confirmed, v_preferred_date, v_guest_count;
      return;
    end if;
  end if;
  insert into bookings (
    full_name, mobile_number, email_address, guest_count, children_count,
    preferred_date, special_requirements, advance_amount, total_amount,
    confirmed, customer_intent,
    venue_id, venue_address, checkout_date, time_slot, external_booking_ref,
    occasion, board, package_key, package_name, package_tagline, with_food, food_credit, created_at
  ) values (
    p_full_name, p_mobile_number, p_email_address, p_guest_count, coalesce(p_children_count,0),
    p_preferred_date, p_special_requirements, v_advance, v_total,
    p_confirmed, p_customer_intent,
    p_venue_id, p_venue_address, p_checkout_date, p_time_slot, p_external_booking_ref,
    nullif(btrim(p_occasion),''), p_board, v_package_key, v_package_name, v_package_tagline, v_with_food, v_food_credit, now()
  )
  returning bookings.id, bookings.confirmed, bookings.preferred_date, bookings.guest_count
  into v_booking_id, v_confirmed, v_preferred_date, v_guest_count;
  if p_add_ons is not null and jsonb_typeof(p_add_ons)='array' and jsonb_array_length(p_add_ons)>0 then
    insert into booking_add_ons (booking_id, addon_id, name, price_at_booking, requires_confirmation)
    select v_booking_id, nullif(e->>'addon_id','')::int, coalesce(a.name, e->>'name'),
           case when nullif(e->>'addon_id','')::int = any(v_bundled) then 0 else coalesce(a.price,0) end,
           coalesce((e->>'requires_confirmation')::boolean, false)
    from jsonb_array_elements(p_add_ons) e
    left join add_ons a on a.id = nullif(e->>'addon_id','')::int and a.is_active = true;
  end if;
  return query select v_booking_id, v_confirmed, v_preferred_date, v_guest_count;
end;
$function$;

drop function if exists public.booking_price_venue(bigint, integer, text);
