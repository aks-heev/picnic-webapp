-- 2026-11-03 — ADMIN_VENUE_SETUP_PLAN Phase 3: admin editor for package_prices.
--
-- package_prices is the price table compute_booking_total checks FIRST ("price
-- table wins"). Until now it could only be changed with SQL. This function is
-- the single write path for the admin price-grid editor.
--
-- Semantics: REPLACES every row for one (venue, package) pair with p_rows, in one
-- transaction. p_dry_run (DEFAULT TRUE) writes, prices every row through
-- compute_booking_total, then rolls the writes back and returns the preview.
-- Pass p_dry_run => false to keep the writes.
--
-- SECURITY INVOKER: the table's own RLS (admin-email policies) still applies on
-- top of the explicit check below.
--
-- Rollback: DROP FUNCTION public.admin_set_package_prices(bigint, bigint, jsonb, boolean);
-- (No schema or data change ships with this migration.)

create function public.admin_set_package_prices(
  p_venue_id   bigint,
  p_package_id bigint,
  p_rows       jsonb,
  p_dry_run    boolean default true
) returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_key text; v_incl integer; v_vp_price numeric;
  e jsonb; i integer := 0;
  v_food boolean; v_guests integer; v_day text; v_price numeric; v_credit numeric; v_items integer;
  v_deleted integer := 0; v_inserted integer := 0;
  v_preview jsonb := '[]'::jsonb;
  v_dow integer := extract(isodow from current_date)::int;
  -- next Tuesday / Saturday strictly after today: stand-ins for "a weekday" / "a weekend day"
  v_tue date := current_date + (((2 - v_dow + 6) % 7) + 1);
  v_sat date := current_date + (((6 - v_dow + 6) % 7) + 1);
  v_tue_price numeric; v_sat_price numeric; v_tue_err text; v_sat_err text; v_g integer;
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows must be a JSON array';
  end if;

  select p.key into v_key from packages p where p.id = p_package_id;
  if v_key is null then
    raise exception 'Package % not found', p_package_id;
  end if;
  -- The price table only applies to a pair the site offers. Enabling happens in
  -- the Packages tab (venue_packages); refuse to price a pair that isn't set up.
  select vp.included_guests, vp.price into v_incl, v_vp_price
    from venue_packages vp where vp.venue_id = p_venue_id and vp.package_id = p_package_id;
  if not found then
    raise exception 'Package "%" is not set up at venue % yet. Enable it in the Packages tab first.', v_key, p_venue_id;
  end if;

  -- Validate every row before touching anything. Messages name the row (1-based).
  for e in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_food   := coalesce((e->>'with_food')::boolean, false);
      v_guests := nullif(e->>'guests', '')::integer;
      v_day    := coalesce(nullif(e->>'day_type', ''), 'any');
      v_price  := nullif(e->>'price', '')::numeric;
      v_credit := nullif(e->>'food_credit', '')::numeric;
      v_items  := nullif(e->>'food_items', '')::integer;
    exception when others then
      raise exception 'Row %: a value is not a valid number or yes/no', i;
    end;
    if v_day not in ('any', 'weekday', 'weekend') then
      raise exception 'Row %: day must be any, weekday or weekend', i;
    end if;
    if v_food and v_guests is null then
      raise exception 'Row %: a with-food price needs a guest count', i;
    end if;
    -- compute_booking_total looks up no-food prices with guests IS NULL, so a
    -- no-food row with a guest count could never be charged.
    if not v_food and v_guests is not null then
      raise exception 'Row %: a no-food price must not have a guest count (extra guests use the Packages tab overage)', i;
    end if;
    if v_guests is not null and v_guests < 1 then
      raise exception 'Row %: guests must be at least 1', i;
    end if;
    if v_price is null or v_price <= 0 then
      raise exception 'Row %: price must be more than 0', i;
    end if;
    if v_credit is not null and v_credit < 0 then
      raise exception 'Row %: voucher cannot be negative', i;
    end if;
    if v_items is not null and v_items < 1 then
      raise exception 'Row %: food items must be at least 1 (or blank)', i;
    end if;
  end loop;

  if (select count(*) from (
        select coalesce((x->>'with_food')::boolean, false), coalesce(nullif(x->>'guests','')::int, 0),
               coalesce(nullif(x->>'day_type',''), 'any')
        from jsonb_array_elements(p_rows) x group by 1, 2, 3 having count(*) > 1) d) > 0 then
    raise exception 'Two rows have the same food / guests / day combination';
  end if;

  begin
    delete from package_prices where venue_id = p_venue_id and package_id = p_package_id;
    get diagnostics v_deleted = row_count;

    insert into package_prices (venue_id, package_id, with_food, guests, day_type, price, food_credit, food_items, is_active)
    select p_venue_id, p_package_id,
           coalesce((x->>'with_food')::boolean, false),
           nullif(x->>'guests', '')::integer,
           coalesce(nullif(x->>'day_type', ''), 'any'),
           (x->>'price')::numeric,
           nullif(x->>'food_credit', '')::numeric,
           nullif(x->>'food_items', '')::integer,
           true
    from jsonb_array_elements(p_rows) x;
    get diagnostics v_inserted = row_count;

    -- Preview: what a guest is charged for each row's own case, from the real
    -- pricing function, on the next Tuesday and next Saturday. No-food rows are
    -- priced at the package's included guests (no overage).
    for e in select * from jsonb_array_elements(p_rows) loop
      v_food := coalesce((e->>'with_food')::boolean, false);
      v_day  := coalesce(nullif(e->>'day_type', ''), 'any');
      v_g    := coalesce(nullif(e->>'guests', '')::integer, v_incl);
      v_tue_price := null; v_sat_price := null; v_tue_err := null; v_sat_err := null;
      if v_day in ('any', 'weekday') then
        begin
          v_tue_price := public.compute_booking_total(p_venue_id, v_g, 0, '{}'::int[], 'evening', v_key, v_food, v_tue);
        exception when others then v_tue_err := split_part(sqlerrm, ':', 1);
        end;
      end if;
      if v_day in ('any', 'weekend') then
        begin
          v_sat_price := public.compute_booking_total(p_venue_id, v_g, 0, '{}'::int[], 'evening', v_key, v_food, v_sat);
        exception when others then v_sat_err := split_part(sqlerrm, ':', 1);
        end;
      end if;
      v_preview := v_preview || jsonb_build_array(jsonb_build_object(
        'with_food', v_food, 'guests', v_g, 'day_type', v_day,
        'weekday_price', v_tue_price, 'weekend_price', v_sat_price,
        'weekday_error', v_tue_err, 'weekend_error', v_sat_err));
    end loop;

    if p_dry_run then
      raise exception using errcode = 'P0099', message = 'dry run rollback';
    end if;
  exception when sqlstate 'P0099' then
    null; -- dry run: the block's writes are rolled back, the preview is kept
  end;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'package_key', v_key, 'included_guests', v_incl,
    'stored_price', v_vp_price, 'deleted', v_deleted, 'inserted', v_inserted,
    'weekday_date', v_tue, 'weekend_date', v_sat, 'preview', v_preview);
end;
$function$;

revoke execute on function public.admin_set_package_prices(bigint, bigint, jsonb, boolean) from public, anon;
grant  execute on function public.admin_set_package_prices(bigint, bigint, jsonb, boolean) to authenticated;

comment on function public.admin_set_package_prices(bigint, bigint, jsonb, boolean) is
  'Admin price-grid editor: replaces package_prices rows for one venue x package. Dry run by default (writes, previews via compute_booking_total, rolls back). See docs/ADMIN_VENUE_SETUP_PLAN_2026-11-03.md Phase 3.';
