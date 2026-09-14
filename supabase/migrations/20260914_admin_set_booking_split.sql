-- Persists the picnic/stay split for a picnic_stay booking.
--
-- WHY A NEW RPC: admin_add_manual_booking (8.3k chars) and admin_edit_booking (10k) build their
-- INSERT/UPDATE column lists explicitly and do not carry picnic_amount / stay_amount. The admin
-- form can send the keys in p_booking all it likes - they are silently dropped. Rewriting both
-- functions from reassembled substrings to add two columns is exactly the transcription risk
-- CLAUDE.md §3 warns about, for a field only the combined booking type ever uses.
--
-- 🔴 Without this, the split inputs in the Add Booking form LOOK like they save and do nothing.
-- app.js calls it via abkSaveSplit() immediately after the main save, and reports a failure as
-- "booking saved, split didn't" rather than as a failed booking - the booking really is saved.
--
-- booking_kind itself needs nothing here: trg_bookings_set_booking_kind already derives it from
-- the shape the form now submits (checkout_date + time_slot at a venue with a picnic twin).
--
-- House convention (§4): SECURITY INVOKER, explicit search_path, hardcoded admin-email guard
-- matching the one inside admin_add_manual_booking - resolved from its live body, not guessed.

CREATE OR REPLACE FUNCTION public.admin_set_booking_split(
  p_booking_id bigint,
  p_picnic_amount numeric,
  p_stay_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;

  if p_picnic_amount is not null and p_picnic_amount < 0 then
    raise exception 'Picnic portion cannot be negative';
  end if;
  if p_stay_amount is not null and p_stay_amount < 0 then
    raise exception 'Stay portion cannot be negative';
  end if;

  -- Deliberately NOT validated against total_amount: the components are a ratio, and the total
  -- is negotiated independently. booking_revenue_split scales the negotiated total by this
  -- proportion after carving add-ons to the picnic side.
  update public.bookings
  set picnic_amount = p_picnic_amount,
      stay_amount   = p_stay_amount
  where id = p_booking_id;

  if not found then
    raise exception 'Booking % not found', p_booking_id;
  end if;
end; $function$;

REVOKE ALL ON FUNCTION public.admin_set_booking_split(bigint, numeric, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_booking_split(bigint, numeric, numeric) TO authenticated;

-- TESTED 2026-09-14 with a rolled-back DO block against booking 165:
--   before                    -> 8900/7000
--   admin sets 1111/2222      -> 1111/2222          (write works)
--   non-admin email           -> 'Admin login required'  (guard works)
--   after rollback            -> 8900/7000          (no residue, verified separately)
