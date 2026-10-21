-- 20261021_bookings_with_food.sql
-- Phase 3 of docs/PACKAGE_PRICING_PLAN_2026-10-21.md: persist the food choice + food-credit snapshot.
-- submit_booking_intent gains p_with_food (DEFAULT false) and passes food + event date to pricing;
-- the 20-arg overload is dropped so exactly one exists. Admin RPCs untouched; admin_set_booking_food added.
-- Rollback: drop the 21-arg submit_booking_intent, run _rollback/20261021_submit_booking_intent_before.sql,
--   drop function admin_set_booking_food; columns may stay (nullable, unread).

alter table public.bookings add column if not exists with_food boolean;
alter table public.bookings add column if not exists food_credit numeric check (food_credit is null or food_credit >= 0);
comment on column public.bookings.with_food is 'Food chosen at booking. NULL = not recorded (rows before 2026-10-21).';
comment on column public.bookings.food_credit is 'Food-bill credit snapshot (e.g. Sunroom). Guest pays above it; unused credit lapses.';

drop function public.submit_booking_intent(text, text, text, integer, date, text, numeric, boolean, text, bigint, text, date, text, text, jsonb, text, jsonb, integer, bigint, text);

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
  -- 2026-10-21 price table: food choice + food-credit snapshot (docs/PACKAGE_PRICING_PLAN_2026-10-21.md)
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

  -- Food credit snapshot (e.g. Sunroom): the same row compute_booking_total priced from.
  -- picnic_stay prices the picnic on the twin venue, so the credit is read there too.
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
    set full_name = p_full_name,
        guest_count = p_guest_count,
        children_count = coalesce(p_children_count,0),
        preferred_date = p_preferred_date,
        special_requirements = p_special_requirements,
        advance_amount = v_advance,
        total_amount = v_total,
        customer_intent = p_customer_intent,
        venue_id = p_venue_id,
        venue_address = p_venue_address,
        checkout_date = p_checkout_date,
        time_slot = p_time_slot,
        external_booking_ref = p_external_booking_ref,
        occasion = nullif(btrim(p_occasion),''),
        board = p_board,
        package_key = v_package_key,
        package_name = v_package_name,
        package_tagline = v_package_tagline,
        with_food = v_with_food,
        food_credit = v_food_credit
    where b.id = p_booking_id
      and b.confirmed = false
      and b.mobile_number = p_mobile_number
      and b.email_address = p_email_address
    returning b.id, b.confirmed, b.preferred_date, b.guest_count
    into v_booking_id, v_confirmed, v_preferred_date, v_guest_count;

    if v_booking_id is not null then
      delete from booking_add_ons where booking_id = v_booking_id;
      if p_add_ons is not null and jsonb_typeof(p_add_ons)='array' and jsonb_array_length(p_add_ons)>0 then
        insert into booking_add_ons (booking_id, addon_id, name, price_at_booking, requires_confirmation)
        select v_booking_id, nullif(e->>'addon_id','')::int,
               coalesce(a.name, e->>'name'),
               case when nullif(e->>'addon_id','')::int = any(v_bundled) then 0
                    else coalesce(a.price,0) end,
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
    select v_booking_id, nullif(e->>'addon_id','')::int,
           coalesce(a.name, e->>'name'),
           case when nullif(e->>'addon_id','')::int = any(v_bundled) then 0
                else coalesce(a.price,0) end,
           coalesce((e->>'requires_confirmation')::boolean, false)
    from jsonb_array_elements(p_add_ons) e
    left join add_ons a on a.id = nullif(e->>'addon_id','')::int and a.is_active = true;
  end if;

  return query select v_booking_id, v_confirmed, v_preferred_date, v_guest_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_booking_food(p_booking_id bigint, p_with_food boolean, p_food_credit numeric DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;
  if p_food_credit is not null and p_food_credit < 0 then
    raise exception 'Food credit cannot be negative';
  end if;
  -- Admin bookings take totals verbatim; this only records what was sold, it never re-prices.
  update public.bookings set with_food = p_with_food, food_credit = p_food_credit where id = p_booking_id;
  if not found then
    raise exception 'Booking % not found', p_booking_id;
  end if;
end; $function$;

revoke execute on function public.admin_set_booking_food(bigint, boolean, numeric) from public, anon;
grant execute on function public.admin_set_booking_food(bigint, boolean, numeric) to authenticated, service_role;
