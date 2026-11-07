-- Applied to evmftrogyzoudiccqkya 2026-11-07.
-- Advisor: anon-executable SECURITY DEFINER functions.
-- trigger_notify_*: trigger functions. Postgres does not check EXECUTE when a trigger
-- fires (only at CREATE TRIGGER), so revoking from API roles cannot break the triggers.
-- admin_resend_confirmation: already guarded by an admin-email check inside; admin calls
-- it while logged in (authenticated), so anon/PUBLIC lose it, authenticated keeps it.
revoke execute on function public.trigger_notify_booking_received() from public, anon, authenticated;
revoke execute on function public.trigger_notify_booking_confirmed() from public, anon, authenticated;
revoke execute on function public.trigger_notify_menu_link() from public, anon, authenticated;
revoke execute on function public.trigger_notify_order_received() from public, anon, authenticated;
revoke execute on function public.trigger_notify_booking_confirmed_on_insert() from public, anon, authenticated;
revoke execute on function public.admin_resend_confirmation(bigint) from public, anon;
grant execute on function public.admin_resend_confirmation(bigint) to authenticated, service_role;
