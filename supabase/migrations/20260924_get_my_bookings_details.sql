-- get_my_bookings: return more detail for the customer "My Bookings" page.
-- Same signature (no args) -> CREATE OR REPLACE, no overload risk.
-- Adds: venue.city / maps_url / team_id, and add_ons[] (name + price snapshot).
-- Existing keys are untouched (to_jsonb(b) row + venues.name/type/area).
CREATE OR REPLACE FUNCTION public.get_my_bookings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(b_row order by preferred_date desc), '[]'::jsonb)
  from (
    select
      to_jsonb(b) || jsonb_build_object(
        'venues',
        case when v.id is null then null else jsonb_build_object(
          'name', v.name, 'type', v.type, 'area', v.area,
          'city', v.city, 'maps_url', v.maps_url, 'team_id', v.team_id
        ) end,
        'add_ons',
        coalesce((
          select jsonb_agg(jsonb_build_object('name', ba.name, 'price', ba.price_at_booking) order by ba.id)
          from public.booking_add_ons ba
          where ba.booking_id = b.id
        ), '[]'::jsonb)
      ) as b_row,
      b.preferred_date
    from public.bookings b
    left join public.venues v on v.id = b.venue_id
    where nullif(regexp_replace(coalesce(auth.jwt() ->> 'phone',''), '\D', '', 'g'), '') is not null
      and right(regexp_replace(b.mobile_number, '\D', '', 'g'), 10)
        = right(regexp_replace(auth.jwt() ->> 'phone', '\D', '', 'g'), 10)
  ) t;
$function$;
