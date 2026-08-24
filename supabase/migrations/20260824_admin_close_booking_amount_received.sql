-- ============================================================================
-- Close Booking — payment leg: record the balance collected at the event.
--
-- WHY: admin_close_booking could stamp a booking "Closed — books settled" while
-- money was still outstanding. Booking #100 (David James) sat Closed at
-- total 11900 / advance 5000 with 6900 unrecorded, and #92 the same. The close
-- form had no way to say "the balance came in", so it never got said.
--
-- advance_amount is overloaded as "amount received" (see admin_apply_staff_payment,
-- 20260821). This RPC now writes the same column, with the same cap, from the
-- same absolute semantics: p_close->>'amount_received' is the TOTAL received on
-- the booking, not a delta, so a retried save cannot double-count.
--
-- Absent/blank key => advance_amount is left exactly as it is (back-compatible
-- with any caller that predates this change).
--
-- New refusals:
--   * amount_received < 0
--   * amount_received > the (possibly edited) total  -- an on-site upsell is a
--     negative discount_amount, not an inflated receipt
--   * status 'Closed' while received < total         -- "books settled" now means it
-- The over-total check uses coalesce(provided, existing), so lowering the total
-- below what has already been received is refused too; that hole was open before.
-- 'Cancelled' is exempt from the settled gate: lowering the received amount on a
-- cancelled booking is how a refund gets recorded.
-- ============================================================================

create or replace function public.admin_close_booking(
  p_booking_id bigint,
  p_close      jsonb
)
returns bigint
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_existing  public.bookings%rowtype;
  v_new_total numeric;
  v_received  numeric;
  v_status    text;
  v_notes     text := nullif(btrim(p_close->>'close_notes'), '');
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;

  if p_booking_id is null then
    raise exception 'Booking id is required';
  end if;

  select * into v_existing from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking % not found', p_booking_id;
  end if;

  -- This RPC only ever writes terminal states. Enquiry/Confirmed/Completed stay
  -- derived from confirmed + event date; see the phase 1 migration.
  v_status := coalesce(nullif(p_close->>'booking_status', ''), 'Closed');
  if v_status not in ('Closed', 'Cancelled') then
    raise exception 'admin_close_booking sets Closed or Cancelled only (got %)', v_status;
  end if;

  if v_status = 'Closed' and not v_existing.confirmed then
    raise exception 'Booking % is not confirmed — confirm it before closing', p_booking_id;
  end if;

  v_new_total := coalesce(nullif(p_close->>'total_amount', '')::numeric, v_existing.total_amount);

  if v_new_total is not null and v_new_total < 0 then
    raise exception 'Total cannot be negative';
  end if;

  -- The whole point of allowing the total to be overwritten: force an explanation.
  -- Enforced here, not just in the UI, so the API cannot bypass it.
  if v_new_total is distinct from v_existing.total_amount and v_notes is null then
    raise exception 'A note is required when the total changes (% -> %)',
      coalesce(v_existing.total_amount::text, 'null'),
      coalesce(v_new_total::text, 'null');
  end if;

  -- Money received. ABSOLUTE, not a delta. Blank or absent => unchanged.
  v_received := coalesce(
    nullif(p_close->>'amount_received', '')::numeric,
    coalesce(v_existing.advance_amount, 0)
  );

  if v_received < 0 then
    raise exception 'Amount received cannot be negative';
  end if;

  if v_new_total is not null and v_received > v_new_total then
    raise exception 'Amount received (%) is more than the booking total (%). Record an on-site upsell as a negative discount_amount instead.',
      v_received, v_new_total;
  end if;

  -- "Closed — books settled" must mean settled.
  if v_status = 'Closed' and v_new_total is not null and v_received < v_new_total then
    raise exception 'Balance of % is still outstanding — record the payment or lower the total before closing',
      v_new_total - v_received;
  end if;

  -- Costs. A blank/absent key clears the value: the admin form always submits all
  -- five, so "not sent" means "cleared", and null stays distinct from zero.
  insert into public.booking_costs as bc (
    booking_id, cost_food, cost_fruits, cost_flowers, cost_decor_other,
    cost_vendor_photo, quoted_total_amount, close_notes, closed_at, closed_by
  ) values (
    p_booking_id,
    nullif(p_close->>'cost_food',          '')::numeric,
    nullif(p_close->>'cost_fruits',        '')::numeric,
    nullif(p_close->>'cost_flowers',       '')::numeric,
    nullif(p_close->>'cost_decor_other',   '')::numeric,
    nullif(p_close->>'cost_vendor_photo',  '')::numeric,
    v_existing.total_amount,   -- the quote, captured BEFORE any overwrite below
    v_notes, now(), auth.email()
  )
  on conflict (booking_id) do update set
    cost_food           = excluded.cost_food,
    cost_fruits         = excluded.cost_fruits,
    cost_flowers        = excluded.cost_flowers,
    cost_decor_other    = excluded.cost_decor_other,
    cost_vendor_photo   = excluded.cost_vendor_photo,
    -- never overwritten: the FIRST close's quote is the one worth keeping
    quoted_total_amount = coalesce(bc.quoted_total_amount, excluded.quoted_total_amount),
    -- a blank note on re-close keeps the earlier explanation rather than erasing it
    close_notes         = coalesce(excluded.close_notes, bc.close_notes),
    closed_at           = now(),
    closed_by           = auth.email();

  update public.bookings
     set total_amount   = v_new_total,
         advance_amount = v_received,
         booking_status = v_status,
         confirmed      = case when v_status = 'Cancelled' then false else confirmed end
   where id = p_booking_id;

  -- A cancelled booking must stop blocking the calendar. Two mechanisms hold a
  -- date: confirmed=true on the booking (cleared above) and any venue_availability
  -- rows this booking created. ical-sourced rows carry no booking_id and are left
  -- alone — they mirror the Airbnb feed and get re-synced.
  if v_status = 'Cancelled' then
    delete from public.venue_availability where booking_id = p_booking_id;
  end if;

  return p_booking_id;
end;
$function$;

revoke all on function public.admin_close_booking(bigint, jsonb) from public, anon;
grant execute on function public.admin_close_booking(bigint, jsonb) to authenticated;

comment on function public.admin_close_booking(bigint, jsonb) is
  'Closes or cancels a booking: writes booking_costs, may overwrite bookings.total_amount (a close_notes value is REQUIRED when it changes), records money received into bookings.advance_amount (absolute, capped at the total; Closed is refused while a balance is outstanding), stamps booking_status. Cancelled also clears confirmed and releases the booking''s venue_availability rows.';

-- ROLLBACK: re-apply supabase/migrations/20260816_admin_close_booking.sql

-- ---------------------------------------------------------------------------
-- Applied to production 2026-08-24 as migration admin_close_booking_amount_received.
-- 9 branches verified against the DEPLOYED function inside a rolled-back
-- transaction (zero residue re-checked on bookings 100 and 115 afterwards):
--   1. legacy call, no amount_received key, balance outstanding -> refused
--      ("Balance of 15200.00 is still outstanding")
--   2. amount_received -1                                       -> refused
--   3. amount_received 30000 vs total 22200                     -> refused
--   4. partial settle 20000 vs total 22200                      -> refused (2200 short)
--   5. amount_received 22200 + a cost                           -> ok, advance=22200, Closed
--   6. Cancelled with amount_received 2000 (was 7000)           -> ok, refund recorded,
--                                                                  confirmed=false
--   7. total lowered to 4000 under an existing 5000 received    -> refused (this hole
--                                                                  was open before)
--   8. write-off: total lowered to the 5000 actually received   -> ok, quoted stays 11900
--   9. non-admin caller                                         -> refused
-- ---------------------------------------------------------------------------
