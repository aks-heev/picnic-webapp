-- Persist which package tier a booking is for, snapshotting name/tagline at
-- booking time so a later rename in the admin Packages panel never
-- retroactively changes historical bookings/emails. package_key is a plain
-- text pointer to packages.key (no FK — packages rows can be edited/reordered
-- freely without needing to touch old bookings; the snapshot columns are the
-- source of truth for display).
alter table public.bookings
  add column if not exists package_key text,
  add column if not exists package_name text,
  add column if not exists package_tagline text;

comment on column public.bookings.package_key is 'FK-less pointer to packages.key at time of booking (setting/moment/story/date_night_classic/...). NULL for pre-package-capture bookings.';
comment on column public.bookings.package_name is 'Snapshot of packages.name at booking time — rename-safe.';
comment on column public.bookings.package_tagline is 'Snapshot of packages.tagline at booking time — rename-safe.';

-- Old 19-arg overload dropped (not CREATE OR REPLACE) to avoid leaving an
-- ambiguous PostgREST overload alongside the new 20-arg signature — same
-- reasoning as the 18->19 arg migration on 2026-07-07.
drop function if exists public.submit_booking_intent(
  text, text, text, integer, date, text, numeric, boolean, text,
  bigint, text, date, text, text, jsonb, text, jsonb, integer, bigint
);

create function public.submit_booking_intent(
  p_full_name text, p_mobile_number text, p_email_address text, p_guest_count integer,
  p_preferred_date date, p_special_requirements text, p_advance_amount numeric,
  p_confirmed boolean, p_customer_intent text,
  p_venue_id bigint default null, p_venue_address text default null,
  p_checkout_date date default null, p_time_slot text default null,
  p_external_booking_ref text default null, p_add_ons jsonb default '[]'::jsonb,
  p_occasion text default null, p_board jsonb default null, p_children_count integer default 0,
  p_booking_id bigint default null, p_package_key text default null
)
returns table(id bigint, confirmed boolean, preferred_date date, guest_count integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_booking_id bigint; v_confirmed boolean; v_preferred_date date; v_guest_count integer;
  v_advance numeric; v_total numeric; v_addon_ids integer[]; v_nights integer;
  v_package_key text; v_package_name text; v_package_tagline text;
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
    from packages p where p.key = v_package_key;
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
    v_nights, v_addon_ids, p_time_slot), 0);
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
               coalesce(a.name, e->>'name'), coalesce(a.price,0),
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
           coalesce(a.name, e->>'name'), coalesce(a.price,0),
           coalesce((e->>'requires_confirmation')::boolean, false)
    from jsonb_array_elements(p_add_ons) e
    left join add_ons a on a.id = nullif(e->>'addon_id','')::int and a.is_active = true;
  end if;

  return query select v_booking_id, v_confirmed, v_preferred_date, v_guest_count;
end; $function$;

grant execute on function public.submit_booking_intent(
  text, text, text, integer, date, text, numeric, boolean, text,
  bigint, text, date, text, text, jsonb, text, jsonb, integer, bigint, text
) to public;
