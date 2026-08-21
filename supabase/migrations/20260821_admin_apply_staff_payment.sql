-- ============================================================================
-- Staff tool — PHASE 4 support: reconcile a staff-logged payment into bookings.
-- Applied to production as migration version 20260821152442
-- Plan: docs/STAFF_STATUS_TOOL_PLAN.md
--
-- staff_log_step deliberately never touches bookings.advance_amount — an
-- unauthenticated token surface does not move money. It records only what staff
-- SAY they collected, in booking_event_log.amount. This RPC is the deliberate
-- admin action that turns that claim into the books.
--
-- Why not reuse admin_edit_booking(p_booking_id, p_booking jsonb, p_add_ons jsonb):
--   it takes an opaque jsonb blob whose absent-key semantics differ per field,
--   it rewrites add-ons, and it carries iCal footprint handling. Moving money
--   should go through something that does exactly one thing and can be read in
--   full in ten seconds.
--
-- Touches ONE column. No trigger fires: the only UPDATE trigger on bookings is
-- on_booking_confirmed_notify WHEN (old.confirmed=false AND new.confirmed=true),
-- and this never touches `confirmed`. Verified against pg_trigger 2026-08-21.
-- ============================================================================

create or replace function public.admin_apply_staff_payment(
  p_booking_id bigint,
  p_amount     numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Not authorized';
  end if;

  select * into v_b from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Booking % not found', p_booking_id;
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Amount must be zero or more';
  end if;

  -- advance_amount is overloaded as "amount received"; advance = total is how
  -- "fully paid" is derived. Letting it exceed total would produce a negative
  -- balance everywhere downstream. An on-site upsell belongs in
  -- discount_amount (negative = upsell earned), not inflated into the advance.
  if p_amount > coalesce(v_b.total_amount, 0) then
    raise exception 'Amount (%) is more than the booking total (%). Record an on-site upsell as a negative discount_amount instead.',
      p_amount, coalesce(v_b.total_amount, 0);
  end if;

  update public.bookings
     set advance_amount = p_amount
   where id = p_booking_id
  returning * into v_b;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_b.id,
    'advance_amount', v_b.advance_amount,
    'total_amount', v_b.total_amount,
    'balance_due', greatest(coalesce(v_b.total_amount,0) - coalesce(v_b.advance_amount,0), 0),
    'fully_paid', coalesce(v_b.advance_amount,0) >= coalesce(v_b.total_amount,0)
                  and coalesce(v_b.total_amount,0) > 0
  );
end;
$$;

revoke all on function public.admin_apply_staff_payment(bigint, numeric) from public, anon;
grant execute on function public.admin_apply_staff_payment(bigint, numeric) to authenticated;
