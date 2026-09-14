-- Phase 1 of the picnic_stay work.
-- Adds an EXPLICIT booking kind plus a picnic/stay revenue split.
--
-- Why explicit rather than inferred: today "picnic vs stay" is derived from which of
-- time_slot / checkout_date is set. Booking 165 (Countryside Offgrid, picnic proposal
-- during a 1-night stay) and booking 172 (Countryside Offgrid, 19-20 Sep) are both
-- picnic+stay and are indistinguishable from plain stays under that rule. Ads run on
-- picnic only, so misclassifying them corrupts ad-efficiency math.
--
-- NOTE: booking_kind is deliberately ORTHOGONAL to venues.type.
--   venues.type answers "which inventory does this block" (combo = parent property,
--   partner_bnb = partner-owned, self_managed = ours, cafe = picnic venue).
--   booking_kind answers "what did the customer actually buy".
-- A booking at the combo venue (TerraCottage Sienna) can legitimately be picnic_stay.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_kind  text,
  ADD COLUMN IF NOT EXISTS picnic_amount numeric,
  ADD COLUMN IF NOT EXISTS stay_amount   numeric;

-- Nullable for now on purpose: NOT NULL only after the Phase 2 backfill verifies all 84 rows.
-- NULL passes a CHECK constraint (three-valued logic), so this is safe to add immediately.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_booking_kind_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_booking_kind_check
  CHECK (booking_kind IS NULL OR booking_kind IN ('picnic','stay','picnic_stay'));

-- Amounts must never be negative. A surcharge is expressed in total_amount, not here.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_split_amounts_nonneg;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_split_amounts_nonneg
  CHECK ((picnic_amount IS NULL OR picnic_amount >= 0)
     AND (stay_amount   IS NULL OR stay_amount   >= 0));

-- DELIBERATELY NO CONSTRAINT tying picnic_amount + stay_amount to total_amount.
-- Final prices go through negotiation, so total_amount is authoritative and the two
-- components act as a RATIO. Analytics splits the negotiated total by that ratio
-- (see the booking_revenue_split view in Phase 4), with add-ons carved to the picnic
-- side first because they are pass-through vendor cost.

COMMENT ON COLUMN public.bookings.booking_kind IS
  'What the customer bought: picnic | stay | picnic_stay. Explicit, not inferred from time_slot/checkout_date. Orthogonal to venues.type.';
COMMENT ON COLUMN public.bookings.picnic_amount IS
  'Picnic component of the sale. A RATIO input, not final revenue - total_amount is authoritative after negotiation.';
COMMENT ON COLUMN public.bookings.stay_amount IS
  'Stay component of the sale. A RATIO input, not final revenue - total_amount is authoritative after negotiation.';
