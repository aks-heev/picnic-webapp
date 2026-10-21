CREATE OR REPLACE FUNCTION public.compute_booking_advance(p_venue_id bigint, p_billing_guests integer, p_nights integer, p_addon_ids integer[], p_time_slot text, p_package_key text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return round(coalesce(public.compute_booking_total(
    p_venue_id, p_billing_guests, p_nights, p_addon_ids, p_time_slot, p_package_key), 0) * 0.3);
end; $function$
