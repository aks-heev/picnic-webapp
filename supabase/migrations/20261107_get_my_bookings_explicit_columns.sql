-- Applied to evmftrogyzoudiccqkya 2026-11-07.
-- get_my_bookings returned to_jsonb(b): the whole bookings row (razorpay_signature,
-- lead/follow-up notes, discount, booking_source, hold_*, customer_intent ...) to the
-- customer. Now returns only the fields mbkCardHtml/renderMyBookings read (app.js).
-- Verified 2026-11-07: 25 phones / 75 rows, 0 differences on every returned key vs the old body.
create or replace function public.get_my_bookings()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(b_row order by preferred_date desc), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'id', b.id, 'venue_id', b.venue_id,
        'preferred_date', b.preferred_date, 'checkout_date', b.checkout_date,
        'time_slot', b.time_slot, 'slot_start_time', b.slot_start_time, 'slot_end_time', b.slot_end_time,
        'guest_count', b.guest_count, 'children_count', b.children_count,
        'occasion', b.occasion, 'board', b.board, 'package_name', b.package_name,
        'special_requirements', b.special_requirements, 'venue_address', b.venue_address,
        'confirmed', b.confirmed, 'booking_status', b.booking_status,
        'total_amount', b.total_amount, 'advance_amount', b.advance_amount,
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
