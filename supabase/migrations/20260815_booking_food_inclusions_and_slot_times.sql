-- Per-booking manual OVERRIDES for two values the emails currently compute.
--
-- 1. Food inclusions. notify-booking-confirmed already renders an "INCLUDED" row
--    from venues.metadata.food_multiplier/drink_multiplier x adults (getInclusionText).
--    That is per-venue and cannot express "this particular booking got 6 items".
--    includes_food + the two counts let admin state it per booking; when
--    includes_food is true the manual numbers win and the multiplier is ignored.
--    Counts are TOTALS for the booking, matching what the computed row already
--    displays (ceil(adults x multiplier)) — not per-guest.
--
-- 2. Slot times. The TIME row is currently a hardcoded lookup (morning 9-12,
--    afternoon 1-4, evening 5-8). Real picnics shift. slot_start_time/slot_end_time
--    override that lookup for a single booking.
--
-- All nullable with no defaults: existing rows, site bookings, and the public
-- booking flow are completely unaffected and keep the computed behaviour.
alter table public.bookings
  add column if not exists includes_food         boolean,
  add column if not exists food_items_count      integer,
  add column if not exists beverage_items_count  integer,
  add column if not exists slot_start_time       time,
  add column if not exists slot_end_time         time;

comment on column public.bookings.includes_food is
  'Admin-set. When true, food_items_count/beverage_items_count override the venue food_multiplier/drink_multiplier inclusion text in emails. Null/false = fall back to the computed venue multipliers.';
comment on column public.bookings.food_items_count is
  'Total food items included in this booking (not per guest). Only meaningful when includes_food is true.';
comment on column public.bookings.beverage_items_count is
  'Total beverage items included in this booking (not per guest). Only meaningful when includes_food is true.';
comment on column public.bookings.slot_start_time is
  'Overrides the hardcoded TIME_SLOTS start for this booking. Null = use the slot default.';
comment on column public.bookings.slot_end_time is
  'Overrides the hardcoded TIME_SLOTS end for this booking. Null = use the slot default.';

-- Counts must be sane if present. Deliberately permissive on 0 (a booking may
-- include food but zero beverages).
alter table public.bookings
  drop constraint if exists bookings_food_counts_nonneg;
alter table public.bookings
  add constraint bookings_food_counts_nonneg
  check (
    (food_items_count     is null or food_items_count     >= 0) and
    (beverage_items_count is null or beverage_items_count >= 0)
  );

-- An end time before the start time is always a data-entry error. Overnight
-- picnic slots do not exist (stays use checkout_date, not time slots).
alter table public.bookings
  drop constraint if exists bookings_slot_times_ordered;
alter table public.bookings
  add constraint bookings_slot_times_ordered
  check (
    slot_start_time is null or slot_end_time is null or slot_end_time > slot_start_time
  );
