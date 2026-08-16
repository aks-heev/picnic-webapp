-- Applied to production 2026-08-16 as migration version 20260816070900.
--
-- Close Booking, phase 1: per-booking direct costs + booking status.
--
-- Costs live in their OWN table, not on bookings, because bookings carries
--   customer_select_own_bookings USING (email_address = auth.email())
-- and RLS is row-level, not column-level. A customer signed in with the email
-- on their booking can GET /rest/v1/bookings?select=* and receive every column.
-- Cost of goods, margin and internal close notes must not be in that result.
-- Column-level GRANTs cannot separate them either: admin and customer are both
-- the `authenticated` role, distinguished only by auth.email() inside policies.
--
-- booking_status DOES stay on bookings — a customer seeing "Completed" is fine,
-- and the sheet/admin need it alongside the row.

create table if not exists public.booking_costs (
  booking_id           bigint primary key
                         references public.bookings(id) on delete cascade,
  cost_food            numeric,
  cost_fruits          numeric,
  cost_flowers         numeric,
  cost_decor_other     numeric,
  cost_vendor_photo    numeric,
  total_cost           numeric generated always as (
                         coalesce(cost_food, 0) + coalesce(cost_fruits, 0)
                       + coalesce(cost_flowers, 0) + coalesce(cost_decor_other, 0)
                       + coalesce(cost_vendor_photo, 0)
                       ) stored,
  quoted_total_amount  numeric,
  close_notes          text,
  created_at           timestamptz not null default now(),
  closed_at            timestamptz not null default now(),
  closed_by            text
);

comment on table  public.booking_costs is
  'One row per CLOSED booking. Existence of a row = the booking has been closed. Admin-only via RLS; deliberately not columns on bookings, which customers can read wholesale.';
comment on column public.booking_costs.cost_food is
  'Direct cost, nulls mean NOT ENTERED (not zero). Mirrors the Google Sheet Cost: columns.';
comment on column public.booking_costs.quoted_total_amount is
  'Snapshot of bookings.total_amount at FIRST close, before any admin override. Never overwritten on re-close.';
comment on column public.booking_costs.close_notes is
  'Internal. Required by admin_close_booking when the total is changed. Never customer-facing.';
comment on column public.booking_costs.created_at is 'First close.';
comment on column public.booking_costs.closed_at  is 'Most recent close/edit.';

alter table public.booking_costs enable row level security;

revoke all on public.booking_costs from anon;

-- Admin gate hardcoded to match the existing convention in admin_select_bookings
-- and admin_edit_booking. TECH DEBT: this email is now in ~7 places.
create policy admin_select_booking_costs on public.booking_costs
  for select to authenticated using (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_insert_booking_costs on public.booking_costs
  for insert to authenticated with check (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_update_booking_costs on public.booking_costs
  for update to authenticated using (auth.email() = 'aksh.eeev@gmail.com')
                              with check (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_delete_booking_costs on public.booking_costs
  for delete to authenticated using (auth.email() = 'aksh.eeev@gmail.com');

-- booking_status on bookings.
-- Nullable and NOT backfilled by design: Enquiry / Confirmed / Completed are
-- derivable from confirmed + the event date (exactly what the sheet's
-- bookingStatus() already does) and a stored copy would go stale the moment an
-- event date passes. Only the TERMINAL states get stored, by RPC:
--   Closed    — set by admin_close_booking
--   Cancelled — set by admin_close_booking, which also clears confirmed
-- Readers use: coalesce(booking_status, <derived>). confirmed stays the truth flag.
alter table public.bookings
  add column if not exists booking_status text;

alter table public.bookings
  drop constraint if exists bookings_booking_status_check;

alter table public.bookings
  add constraint bookings_booking_status_check
  check (booking_status is null
         or booking_status in ('Enquiry','Confirmed','Completed','Closed','Cancelled'));

comment on column public.bookings.booking_status is
  'Terminal states only (Closed/Cancelled), written by admin_close_booking. NULL means derive from confirmed + event date. confirmed remains the authoritative is-it-booked flag.';

-- ---------------------------------------------------------------------------
-- ROLLBACK (safe while nothing reads these — true at the end of phase 1):
--
--   drop table if exists public.booking_costs;
--   alter table public.bookings drop constraint if exists bookings_booking_status_check;
--   alter table public.bookings drop column if exists booking_status;
-- ---------------------------------------------------------------------------
