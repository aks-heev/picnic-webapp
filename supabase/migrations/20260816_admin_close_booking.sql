-- Applied to production 2026-08-16 via apply_migration (20260816_admin_close_booking).
--
-- Close Booking, phase 2: admin_close_booking RPC.
--
-- Separate from admin_edit_booking on purpose. Not because of signature safety —
-- that function takes jsonb, so adding fields there would be signature-safe — but
-- because closing carries validation editing shouldn't (note-required-on-total-change,
-- terminal-status transitions, quote snapshotting), and admin_edit_booking's
-- definition already moved twice on 2026-08-15.
--
-- Verified before writing: the only UPDATE trigger on bookings is
-- on_booking_confirmed_notify WHEN (old.confirmed=false AND new.confirmed=true).
-- Closing never flips confirmed in that direction, so no guest email fires here.

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
  'Closes or cancels a booking: writes booking_costs, may overwrite bookings.total_amount (a close_notes value is REQUIRED when it changes), stamps booking_status. Cancelled also clears confirmed and releases the booking''s venue_availability rows.';

-- ---------------------------------------------------------------------------
-- Branch tests run pre-deploy in a rolled-back DO block, all passing:
--   1. non-admin caller                          -> rejected
--   2. total changed, no note                    -> rejected
--   3. total unchanged, no note                  -> ok; total_cost 1782+640=2422,
--                                                   quoted snapshot 10000, status Closed
--   4. re-close, total 10000->9000 with a note   -> ok; quoted_total_amount STILL 10000
--   5. Cancelled                                 -> confirmed=false, venue_availability rows 0
--   6. booking_status='Completed'                -> rejected (terminal states only)
-- Residue after rollback: booking_costs 0 rows, no booking with booking_status set.
--
-- ROLLBACK:  drop function if exists public.admin_close_booking(bigint, jsonb);
-- ---------------------------------------------------------------------------
