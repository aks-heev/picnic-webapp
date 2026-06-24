-- Customer "lock" bookings are created with confirmed=true at INSERT time.
-- The confirmation email (notify-booking-confirmed) was only wired to UPDATE
-- (false->true), so locks never received it (no directions, no breakdown).
-- This adds an INSERT trigger that fires the confirmation when a booking is
-- created already-confirmed. notify-booking-received separately skips the
-- "we'll confirm soon" ack for confirmed rows.

create or replace function public.trigger_notify_booking_confirmed_on_insert()
returns trigger
language plpgsql
security definer
as $$
begin
  perform call_edge_function(
    'notify-booking-confirmed',
    jsonb_build_object(
      'record',     row_to_json(NEW)::jsonb,
      'old_record', jsonb_build_object('confirmed', false)
    )
  );
  return NEW;
end;
$$;

drop trigger if exists on_booking_insert_confirmed on public.bookings;

create trigger on_booking_insert_confirmed
  after insert on public.bookings
  for each row
  when (NEW.confirmed = true)
  execute function public.trigger_notify_booking_confirmed_on_insert();
