-- On-site upsell / discount as first-class data.
-- Signed, matching the ops sheet's "Discount (₹)" column convention:
--   positive  = a discount that LOWERED the total,
--   negative  = an on-site extra/upsell that RAISED the total.
-- total_amount remains the single source of truth for money charged/collected;
-- discount_amount is a reporting breakdown only (lets the sheet show
--   Base = total_amount - add-ons + discount_amount).
alter table public.bookings
  add column if not exists discount_amount numeric not null default 0;

comment on column public.bookings.discount_amount is
  'Signed adjustment reconciling total_amount with base+add-ons. +discount (lowered total), -extra/upsell (raised total). Reporting only; total_amount is authoritative for money.';
