-- Stored package pricing: RPC layer (SPEC_stored_package_pricing_2026-07-10.md §4)
--
-- compute_booking_total / compute_booking_advance gain p_package_key (6th arg,
-- DEFAULT NULL). DROP + CREATE, not CREATE OR REPLACE: OR REPLACE with a new
-- signature would ADD an overload and make 5-named-arg PostgREST calls (the
-- currently deployed frontend) ambiguous — the 2026-07-07 lesson. With a single
-- 6-arg function + default, old 5-arg named calls still resolve fine, so the
-- DB→frontend deploy window is safe.
--
-- Package path: total = venue_packages.price
--                     + overage past included_guests
--                     + NON-bundled add-on prices only (bundled ids price at 0).
-- Missing/inactive venue_packages row with a package key given => RAISE
-- (never silently reprice or fall back to derived math).
-- Legacy path (p_package_key NULL) is byte-identical to the previous body.
--
-- submit_booking_intent: same 20-arg signature (OR REPLACE safe). Adds:
-- venue_packages availability check (raise), max_guests check vs total
-- guest_count (raise), passes package key into compute, bundled add-ons
-- inserted into booking_add_ons with price_at_booking = 0 so
-- Σ price_at_booking + package price = total holds by construction.
--
-- ROLLBACK: previous bodies are in git history / pg_catalog before this ran;
-- restoring = recreate 5-arg compute fns (drop 6-arg) + previous
-- submit_booking_intent body. venue_packages table is additive and can stay.

drop function if exists public.compute_booking_total(bigint, integer, integer, integer[], text);
drop function if exists public.compute_booking_advance(bigint, integer, integer, integer[], text);

create function public.compute_booking_total(
  p_venue_id bigint, p_billing_guests integer, p_nights integer,
  p_addon_ids integer[], p_time_slot text, p_package_key text default null)
returns numeric
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_type text; v_base numeric; v_meta jsonb;
  v_guests integer := greatest(coalesce(p_billing_guests,0),0);
  v_nights integer := greatest(coalesce(p_nights,0),0);
  v_picnic numeric := 0; v_addons numeric := 0; v_stay_rate numeric := 0;
  v_overage numeric := 0; v_last_up_to integer; v_last_price numeric;
  v_package_key text := nullif(btrim(p_package_key), '');
  v_pkg record; v_bundled integer[] := '{}';
begin
  if p_venue_id is null then return 0; end if;
  select type, base_price, metadata into v_type, v_base, v_meta from venues where id = p_venue_id;
  if not found then return 0; end if;

  if v_package_key is not null then
    -- Stored per-venue package price. No derived fallback, ever.
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

    -- Bundled add-ons are included in the stored price: only true extras bill.
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
    -- Legacy / non-package path: unchanged from the previous version.
    if v_meta ? 'tiers' and jsonb_typeof(v_meta->'tiers')='array'
       and jsonb_array_length(v_meta->'tiers')>0 then
      select (t->>'price')::numeric into v_picnic
        from jsonb_array_elements(v_meta->'tiers') t
        where (t->>'up_to')::int >= v_guests order by (t->>'up_to')::int asc limit 1;
      if v_picnic is null then
        select (t->>'up_to')::int,(t->>'price')::numeric into v_last_up_to,v_last_price
          from jsonb_array_elements(v_meta->'tiers') t order by (t->>'up_to')::int desc limit 1;
        v_overage := coalesce((v_meta->>'overage_per_person')::numeric,0);
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

  v_stay_rate := coalesce((v_meta->>'stay_price_per_night')::numeric,0);

  if v_type='cafe' and coalesce(btrim(p_time_slot),'')<>'' then
    return v_picnic + v_addons;
  elsif v_type='self_managed' and v_nights>0 then
    return v_nights*v_stay_rate + v_picnic + v_addons;
  else
    return 0;
  end if;
end; $function$;

create function public.compute_booking_advance(
  p_venue_id bigint, p_billing_guests integer, p_nights integer,
  p_addon_ids integer[], p_time_slot text, p_package_key text default null)
returns numeric
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Advance policy unchanged (30% here; submit_booking_intent uses 50% —
  -- pre-existing inconsistency, deliberately not touched by this migration).
  return round(coalesce(public.compute_booking_total(
    p_venue_id, p_billing_guests, p_nights, p_addon_ids, p_time_slot, p_package_key), 0) * 0.3);
end; $function$;

grant execute on function public.compute_booking_total(bigint, integer, integer, integer[], text, text) to public;
grant execute on function public.compute_booking_advance(bigint, integer, integer, integer[], text, text) to public;

-- ── submit_booking_intent: same signature, new internals ──────────────────
create or replace function public.submit_booking_intent(
  p_full_name text, p_mobile_number text, p_email_address text,
  p_guest_count integer, p_preferred_date date, p_special_requirements text,
  p_advance_amount numeric, p_confirmed boolean, p_customer_intent text,
  p_venue_id bigint default null, p_venue_address text default null,
  p_checkout_date date default null, p_time_slot text default null,
  p_external_booking_ref text default null, p_add_ons jsonb default '[]'::jsonb,
  p_occasion text default null, p_board jsonb default null,
  p_children_count integer default 0, p_booking_id bigint default null,
  p_package_key text default null)
returns table(id bigint, confirmed boolean, preferred_date date, guest_count integer)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_booking_id bigint; v_confirmed boolean; v_preferred_date date; v_guest_count integer;
  v_advance numeric; v_total numeric; v_addon_ids integer[]; v_nights integer;
  v_package_key text; v_package_name text; v_package_tagline text;
  v_pkg_max_guests integer; v_bundled integer[] := '{}';
begin
  if p_customer_intent not in ('lock','query') then raise exception 'Invalid customer_intent value'; end if;
  if p_guest_count < 1 or p_guest_count > 100 then raise exception 'Invalid guest_count'; end if;
  if p_children_count < 0 or p_children_count > p_guest_count then raise exception 'Invalid children_count'; end if;

  if p_venue_id is not null
     and exists (select 1 from venues v where v.id = p_venue_id and v.type = 'combo') then
    p_confirmed := false; p_customer_intent := 'query';
  end if;

  -- Package snapshot: resolve name/tagline from the live packages row now,
  -- at booking time, and freeze them onto the booking. A future rename in
  -- admin only affects new bookings, never rewrites old ones' emails/history.
  v_package_key := nullif(btrim(p_package_key), '');
  if v_package_key is not null then
    select p.name, p.tagline into v_package_name, v_package_tagline
    from packages p where p.key = v_package_key and p.is_active = true;
    if v_package_name is null then
      raise exception 'PACKAGE_NOT_AVAILABLE: unknown or inactive package %', v_package_key;
    end if;

    -- Stored pricing: the package must be offered at this venue, and the
    -- booking must respect the package's hard guest cap (total guests incl.
    -- children — it is a physical capacity, not a billing rule).
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

  -- SERVER-AUTHORITATIVE total + advance. Client p_advance_amount is ignored.
  v_total := coalesce(public.compute_booking_total(
    p_venue_id, greatest(p_guest_count - coalesce(p_children_count,0),0),
    v_nights, v_addon_ids, p_time_slot, v_package_key), 0);
  v_advance := round(v_total * 0.5);

  -- UPDATE branch: same journey re-submitting (intent-screen lead already
  -- captured, now picking pay/query or changing package). Guarded: anon can
  -- reach this RPC and booking ids are sequential, so the update only matches
  -- when phone+email equal the stored row's values and the row is unconfirmed.
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
        package_tagline = v_package_tagline
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
               -- Bundled-in-package add-ons are included in the stored package
               -- price: record them at 0 so Σ price_at_booking + package = total.
               case when nullif(e->>'addon_id','')::int = any(v_bundled) then 0
                    else coalesce(a.price,0) end,
               coalesce((e->>'requires_confirmation')::boolean, false)
        from jsonb_array_elements(p_add_ons) e
        left join add_ons a on a.id = nullif(e->>'addon_id','')::int and a.is_active = true;
      end if;
      return query select v_booking_id, v_confirmed, v_preferred_date, v_guest_count;
      return;
    end if;
    -- guard mismatch / row gone -> fall through to a fresh insert
  end if;

  insert into bookings (
    full_name, mobile_number, email_address, guest_count, children_count,
    preferred_date, special_requirements, advance_amount, total_amount,
    confirmed, customer_intent,
    venue_id, venue_address, checkout_date, time_slot, external_booking_ref,
    occasion, board, package_key, package_name, package_tagline, created_at
  ) values (
    p_full_name, p_mobile_number, p_email_address, p_guest_count, coalesce(p_children_count,0),
    p_preferred_date, p_special_requirements, v_advance, v_total,
    p_confirmed, p_customer_intent,
    p_venue_id, p_venue_address, p_checkout_date, p_time_slot, p_external_booking_ref,
    nullif(btrim(p_occasion),''), p_board, v_package_key, v_package_name, v_package_tagline, now()
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
end; $function$;
