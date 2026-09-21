-- 20260921_postponed_booking_status.sql
--
-- Adds a 'Postponed' booking status and the admin RPCs to manage it.
--
-- POLICY (decided 2026-09-21, see Todoist "Postponement policy"):
--   * Advance payments are NEVER refunded. A customer cancel forfeits the advance.
--   * A postponement keeps the advance as credit, with NO expiry.
--   * 48h notice for a free reschedule; the free-reschedule cap is tentative, so the
--     RPCs only REPORT reschedules_used and never block on it.
--
-- DESIGN
--   * booking_status='Postponed' is stored (it cannot be derived from dates).
--   * confirmed stays TRUE. Flipping confirmed false->true would fire
--     on_booking_confirmed_notify and re-send the guest a confirmation email.
--   * preferred_date is NOT NULL, so a Postponed row keeps its ORIGINAL date;
--     the history lives in booking_postponements.
--   * advance_amount is never touched by postpone/reschedule: it IS the credit.
--   * Internal notes stay OFF bookings (customer RLS exposes every bookings column).
--
-- Consumers that read confirmed=true and a date (public availability RPCs, staff
-- helpers, post-event-nudge, other conflict checks) are NOT changed here; they are
-- tracked in Todoist. Postponed rows keep their original date until then.

-- 1. Allow the new status ----------------------------------------------------------
alter table public.bookings drop constraint bookings_booking_status_check;
alter table public.bookings add constraint bookings_booking_status_check
  check (booking_status is null or booking_status = any (array[
    'Enquiry','Confirmed','Completed','Closed','Cancelled','Postponed'
  ]));

-- 2. Postponement history (admin-only) ----------------------------------------------
create table public.booking_postponements (
  id                     bigint generated always as identity primary key,
  booking_id             bigint not null references public.bookings(id) on delete cascade,
  original_date          date   not null,
  original_checkout_date date,
  original_time_slot     text,
  credit_amount          numeric not null default 0,   -- advance held at the time
  reason                 text,
  requested_at           timestamptz not null default now(),  -- when the customer asked (48h rule)
  postponed_at           timestamptz not null default now(),  -- when it was recorded
  postponed_by           text,
  follow_up_by           date,
  new_date               date,
  new_checkout_date      date,
  new_time_slot          text,
  resolved_at            timestamptz,                  -- set when rescheduled or cancelled
  constraint booking_postponements_credit_nonneg check (credit_amount >= 0)
);

-- at most ONE open (unresolved) postponement per booking
create unique index booking_postponements_one_open
  on public.booking_postponements (booking_id) where resolved_at is null;
create index booking_postponements_booking_idx
  on public.booking_postponements (booking_id);

alter table public.booking_postponements enable row level security;

create policy admin_select_booking_postponements on public.booking_postponements
  for select to authenticated using (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_insert_booking_postponements on public.booking_postponements
  for insert to authenticated with check (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_update_booking_postponements on public.booking_postponements
  for update to authenticated using (auth.email() = 'aksh.eeev@gmail.com')
  with check (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_delete_booking_postponements on public.booking_postponements
  for delete to authenticated using (auth.email() = 'aksh.eeev@gmail.com');

revoke all on table public.booking_postponements from anon;

-- 3. admin_postpone_booking: park a booking with no new date --------------------------
create or replace function public.admin_postpone_booking(
  p_booking_id   bigint,
  p_reason       text        default null,
  p_follow_up_by date        default null,
  p_requested_at timestamptz default null
) returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_b      public.bookings%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_used   int;
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;
  if p_booking_id is null then raise exception 'Booking id is required'; end if;

  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking % not found', p_booking_id; end if;

  if not v_b.confirmed then
    raise exception 'Booking % is not confirmed - only confirmed bookings can be postponed', p_booking_id;
  end if;
  if v_b.booking_status in ('Closed', 'Completed', 'Cancelled', 'Enquiry') then
    raise exception 'Booking % is % - it cannot be postponed', p_booking_id, v_b.booking_status;
  end if;

  if v_b.booking_status = 'Postponed' then
    -- already parked: just refresh the reason / follow-up on the open row
    update public.booking_postponements
       set reason       = coalesce(v_reason, reason),
           follow_up_by = coalesce(p_follow_up_by, follow_up_by)
     where booking_id = p_booking_id and resolved_at is null;
  else
    insert into public.booking_postponements (
      booking_id, original_date, original_checkout_date, original_time_slot,
      credit_amount, reason, requested_at, postponed_by, follow_up_by
    ) values (
      p_booking_id, v_b.preferred_date, v_b.checkout_date, v_b.time_slot,
      coalesce(v_b.advance_amount, 0), v_reason, coalesce(p_requested_at, now()),
      auth.email(), p_follow_up_by
    );

    -- confirmed and advance_amount are deliberately untouched
    update public.bookings set booking_status = 'Postponed' where id = p_booking_id;

    -- release any calendar blocks this booking created (combo child fanout);
    -- ical-sourced rows carry no booking_id and are left alone
    delete from public.venue_availability where booking_id = p_booking_id;
  end if;

  select count(*) into v_used from public.booking_postponements
   where booking_id = p_booking_id and new_date is not null;

  return jsonb_build_object(
    'booking_id', p_booking_id,
    'booking_status', 'Postponed',
    'credit', coalesce(v_b.advance_amount, 0),
    'reschedules_used', v_used
  );
end;
$fn$;

-- 4. admin_reschedule_booking: move to a new date (from Confirmed or Postponed) -------
-- Wraps admin_edit_booking so the conflict checks, combo fanout and slot/checkout
-- handling stay in ONE place. admin_edit_booking rewrites EVERY field and re-inserts
-- add-ons from its arguments, so this hands it the booking's OWN current values plus
-- only the requested changes (p_changes: preferred_date required; checkout_date and
-- time_slot optional, absent = keep). Add-ons are read back from booking_add_ons.
create or replace function public.admin_reschedule_booking(
  p_booking_id   bigint,
  p_changes      jsonb,
  p_reason       text        default null,
  p_requested_at timestamptz default null
) returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_b            public.bookings%rowtype;
  v_open         public.booking_postponements%rowtype;
  v_new_date     date := nullif(p_changes->>'preferred_date', '')::date;
  v_new_checkout date;
  v_new_slot     text;
  v_reason       text := nullif(btrim(p_reason), '');
  v_payload      jsonb;
  v_addons       jsonb;
  v_used         int;
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;
  if p_booking_id is null then raise exception 'Booking id is required'; end if;

  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking % not found', p_booking_id; end if;

  if not v_b.confirmed then
    raise exception 'Booking % is not confirmed - only confirmed bookings can be rescheduled', p_booking_id;
  end if;
  if v_b.booking_status in ('Closed', 'Completed', 'Cancelled', 'Enquiry') then
    raise exception 'Booking % is % - it cannot be rescheduled', p_booking_id, v_b.booking_status;
  end if;
  if v_new_date is null then raise exception 'New date is required'; end if;

  v_new_checkout := case when p_changes ? 'checkout_date'
                         then nullif(p_changes->>'checkout_date', '')::date
                         else v_b.checkout_date end;
  v_new_slot     := case when p_changes ? 'time_slot'
                         then nullif(p_changes->>'time_slot', '')
                         else v_b.time_slot end;

  if v_b.booking_status is distinct from 'Postponed'
     and v_new_date = v_b.preferred_date
     and v_new_checkout is not distinct from v_b.checkout_date
     and v_new_slot is not distinct from v_b.time_slot then
    raise exception 'The new date and slot are the same as the current booking';
  end if;

  select * into v_open from public.booking_postponements
   where booking_id = p_booking_id and resolved_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'addon_id', addon_id, 'name', name,
           'price', price_at_booking, 'requires_confirmation', requires_confirmation)), '[]'::jsonb)
    into v_addons
    from public.booking_add_ons where booking_id = p_booking_id;

  -- the advance IS the credit and is forced through unchanged
  v_payload := to_jsonb(v_b) || jsonb_build_object(
    'preferred_date', v_new_date,
    'checkout_date',  v_new_checkout,
    'time_slot',      v_new_slot,
    'advance_amount', coalesce(v_b.advance_amount, 0)
  );
  if v_new_slot is distinct from v_b.time_slot then
    v_payload := v_payload || jsonb_build_object('slot_start_time', null, 'slot_end_time', null);
  end if;

  perform public.admin_edit_booking(p_booking_id, v_payload, v_addons);

  if v_open.id is not null then
    update public.booking_postponements
       set new_date          = v_new_date,
           new_checkout_date = v_new_checkout,
           new_time_slot     = v_new_slot,
           reason            = coalesce(v_reason, reason),
           resolved_at       = now()
     where id = v_open.id;
  else
    insert into public.booking_postponements (
      booking_id, original_date, original_checkout_date, original_time_slot,
      credit_amount, reason, requested_at, postponed_by,
      new_date, new_checkout_date, new_time_slot, resolved_at
    ) values (
      p_booking_id, v_b.preferred_date, v_b.checkout_date, v_b.time_slot,
      coalesce(v_b.advance_amount, 0), v_reason, coalesce(p_requested_at, now()), auth.email(),
      v_new_date, v_new_checkout, v_new_slot, now()
    );
  end if;

  update public.bookings set booking_status = null
   where id = p_booking_id and booking_status = 'Postponed';

  select count(*) into v_used from public.booking_postponements
   where booking_id = p_booking_id and new_date is not null;

  return jsonb_build_object(
    'booking_id', p_booking_id,
    'booking_status', null,
    'preferred_date', v_new_date,
    'credit', coalesce(v_b.advance_amount, 0),
    'reschedules_used', v_used
  );
end;
$fn$;

revoke execute on function public.admin_postpone_booking(bigint, text, date, timestamptz) from public, anon;
grant  execute on function public.admin_postpone_booking(bigint, text, date, timestamptz) to authenticated;
revoke execute on function public.admin_reschedule_booking(bigint, jsonb, text, timestamptz) from public, anon;
grant  execute on function public.admin_reschedule_booking(bigint, jsonb, text, timestamptz) to authenticated;

-- 5. admin_close_booking: two additions (everything else is byte-for-byte the live body)
--    a) Closed is refused while Postponed (the credit is unresolved).
--    b) Cancelling a Postponed booking resolves its open postponement row. The advance
--       stays untouched unless amount_received is sent: that IS the forfeiture.
create or replace function public.admin_close_booking(p_booking_id bigint, p_close jsonb)
 returns bigint
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $fn$
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

  if v_status = 'Closed' and v_existing.booking_status = 'Postponed' then
    raise exception 'Booking % is postponed — reschedule it or cancel it before closing', p_booking_id;
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
    -- cancelling a postponed booking closes its open credit row (advance is forfeited)
    update public.booking_postponements set resolved_at = now()
     where booking_id = p_booking_id and resolved_at is null;
  end if;

  return p_booking_id;
end;
$fn$;
