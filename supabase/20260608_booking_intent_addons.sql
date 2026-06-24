-- Write add-ons inside submit_booking_intent so they're committed in the SAME
-- transaction as the booking. The AFTER INSERT trigger on bookings enqueues a
-- pg_net call that only dispatches post-commit, so by the time the
-- notify-booking-received edge function runs, the add-ons are visible.
-- Previously add-ons were inserted by a separate client call after the RPC,
-- which raced the notification (admin alert almost always saw zero add-ons).

drop function if exists public.submit_booking_intent(
  text, text, text, integer, date, text, numeric, boolean, text,
  bigint, text, date, text, text
);

create or replace function public.submit_booking_intent(
  p_full_name text,
  p_mobile_number text,
  p_email_address text,
  p_guest_count integer,
  p_preferred_date date,
  p_special_requirements text,
  p_advance_amount numeric,
  p_confirmed boolean,
  p_customer_intent text,
  p_venue_id bigint default null,
  p_venue_address text default null,
  p_checkout_date date default null,
  p_time_slot text default null,
  p_external_booking_ref text default null,
  p_add_ons jsonb default '[]'::jsonb
)
returns table(id bigint, confirmed boolean, preferred_date date, guest_count integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_booking_id bigint;
  v_confirmed boolean;
  v_preferred_date date;
  v_guest_count integer;
begin
  if p_customer_intent not in ('lock', 'query') then
    raise exception 'Invalid customer_intent value';
  end if;

  if p_advance_amount < 0 then
    raise exception 'Invalid advance_amount';
  end if;

  if p_guest_count < 1 or p_guest_count > 100 then
    raise exception 'Invalid guest_count';
  end if;

  -- Whole-floor (combo) bookings can never be customer-confirmed.
  if p_venue_id is not null
     and exists (select 1 from venues v where v.id = p_venue_id and v.type = 'combo') then
    p_confirmed := false;
    p_customer_intent := 'query';
  end if;

  insert into bookings (
    full_name, mobile_number, email_address, guest_count,
    preferred_date, special_requirements, advance_amount,
    confirmed, customer_intent,
    venue_id, venue_address, checkout_date, time_slot, external_booking_ref,
    created_at
  ) values (
    p_full_name, p_mobile_number, p_email_address, p_guest_count,
    p_preferred_date, p_special_requirements, p_advance_amount,
    p_confirmed, p_customer_intent,
    p_venue_id, p_venue_address, p_checkout_date, p_time_slot, p_external_booking_ref,
    now()
  )
  returning bookings.id, bookings.confirmed, bookings.preferred_date, bookings.guest_count
  into v_booking_id, v_confirmed, v_preferred_date, v_guest_count;

  -- Persist add-on line items in the same transaction.
  if p_add_ons is not null and jsonb_typeof(p_add_ons) = 'array'
     and jsonb_array_length(p_add_ons) > 0 then
    insert into booking_add_ons (booking_id, addon_id, name, price_at_booking, requires_confirmation)
    select v_booking_id,
           nullif(e->>'addon_id','')::int,
           e->>'name',
           coalesce(nullif(e->>'price_at_booking','')::numeric, 0),
           coalesce((e->>'requires_confirmation')::boolean, false)
    from jsonb_array_elements(p_add_ons) e;
  end if;

  return query select v_booking_id, v_confirmed, v_preferred_date, v_guest_count;
end;
$function$;

grant execute on function public.submit_booking_intent(
  text, text, text, integer, date, text, numeric, boolean, text,
  bigint, text, date, text, text, jsonb
) to anon, authenticated, service_role;
