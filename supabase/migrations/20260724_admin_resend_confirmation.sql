-- admin_resend_confirmation: server-side resend of the booking confirmation email
-- for the admin "edit booking -> send updated confirmation" flow. Called from the
-- browser via PostgREST (supabase.rpc), which Supabase already serves with CORS —
-- so we never call the trigger-only notify-booking-confirmed edge function from
-- the browser (it has no CORS and is not meant to be browser-invoked).
--
-- SECURITY DEFINER so it can use net.http_post (same server-to-server mechanism
-- the cron jobs use); admin-email gated to match the rest of the admin surface.
-- Reads the row fresh by id, so it always reflects the just-saved edit. The email
-- function itself still applies its own guards (confirmed / send_guest_email / email).
create or replace function public.admin_resend_confirmation(p_booking_id bigint)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row    jsonb;
  v_req_id bigint;
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;

  select to_jsonb(b.*) into v_row from public.bookings b where b.id = p_booking_id;
  if v_row is null then raise exception 'Booking % not found', p_booking_id; end if;

  select net.http_post(
    url     := 'https://evmftrogyzoudiccqkya.supabase.co/functions/v1/notify-booking-confirmed',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object('record', v_row)
  ) into v_req_id;

  return v_req_id;
end;
$function$;

revoke all on function public.admin_resend_confirmation(bigint) from public;
grant execute on function public.admin_resend_confirmation(bigint) to authenticated, service_role;
