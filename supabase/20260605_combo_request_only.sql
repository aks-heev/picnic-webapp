-- ============================================================
-- Combo = request-only on the public site.
-- Whole-floor (type='combo') bookings must never be customer-confirmed:
-- they route through admin Hold -> Confirm, where the child-blocking
-- fanout and the Airbnb sync buffer run. This hardens the public RPC so
-- a combo submission is always downgraded to a query (confirmed=false),
-- regardless of what the client sends. The client UI (app.js) also hides
-- the "Lock" button for combos; this is the server-side backstop.
--
-- Re-applies submit_booking_intent with the combo guard added; the rest
-- of the function body is unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_booking_intent(p_full_name text, p_mobile_number text, p_email_address text, p_guest_count integer, p_preferred_date date, p_special_requirements text, p_advance_amount numeric, p_confirmed boolean, p_customer_intent text, p_venue_id bigint DEFAULT NULL::bigint, p_venue_address text DEFAULT NULL::text, p_checkout_date date DEFAULT NULL::date, p_time_slot text DEFAULT NULL::text, p_external_booking_ref text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, confirmed boolean, preferred_date date, guest_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_customer_intent NOT IN ('lock', 'query') THEN
    RAISE EXCEPTION 'Invalid customer_intent value';
  END IF;

  IF p_advance_amount < 0 THEN
    RAISE EXCEPTION 'Invalid advance_amount';
  END IF;

  IF p_guest_count < 1 OR p_guest_count > 100 THEN
    RAISE EXCEPTION 'Invalid guest_count';
  END IF;

  -- Whole-floor (combo) bookings can never be customer-confirmed.
  -- Qualify venues.id — the function declares an OUT column named 'id'.
  IF p_venue_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM venues v WHERE v.id = p_venue_id AND v.type = 'combo') THEN
    p_confirmed := false;
    p_customer_intent := 'query';
  END IF;

  RETURN QUERY
  INSERT INTO bookings (
    full_name, mobile_number, email_address, guest_count,
    preferred_date, special_requirements, advance_amount,
    confirmed, customer_intent,
    venue_id, venue_address, checkout_date, time_slot, external_booking_ref,
    created_at
  ) VALUES (
    p_full_name, p_mobile_number, p_email_address, p_guest_count,
    p_preferred_date, p_special_requirements, p_advance_amount,
    p_confirmed, p_customer_intent,
    p_venue_id, p_venue_address, p_checkout_date, p_time_slot, p_external_booking_ref,
    now()
  )
  RETURNING bookings.id, bookings.confirmed, bookings.preferred_date, bookings.guest_count;
END;
$function$;
