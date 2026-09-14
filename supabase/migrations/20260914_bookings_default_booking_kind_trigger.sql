-- Phase 5a: guarantee every booking gets a booking_kind, without rewriting the RPCs.
--
-- PROBLEM: admin_add_manual_booking, admin_edit_booking and submit_booking_intent do not know
-- booking_kind exists, so every NEW booking would land with NULL - re-creating exactly the
-- classification mess this feature was built to end. Those three functions are 7-10k chars
-- each and rewriting all of them to add one column is high-risk for little gain (and §3 warns
-- that large-file reads on this repo tear, so reassembling them is worse than it looks).
--
-- DESIGN: explicit still wins. This only fills booking_kind when the caller did not supply it,
-- so the admin form can set it directly the moment it has the field, and nothing here
-- overrides a deliberate choice. The derivation uses the SAME signal compute_booking_total
-- now uses for pricing - nights AND a time_slot at a venue with a picnic twin - so pricing and
-- classification can never disagree about what a booking is.
--
-- It also backfills the split for the unambiguous kinds so booking_revenue_split always
-- reconciles. picnic_stay is deliberately left NULL: its split is a commercial decision that
-- must be entered by whoever sold it, and the view reports it as split_unknown until then.

CREATE OR REPLACE FUNCTION public.bookings_set_booking_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_type text;
  v_picnic_venue bigint;
begin
  if NEW.venue_id is not null then
    select type, picnic_venue_id into v_type, v_picnic_venue
    from public.venues where id = NEW.venue_id;
  end if;

  -- 1. Explicit wins. Never override what the caller asked for.
  if NEW.booking_kind is null then
    if NEW.checkout_date is not null
       and NEW.time_slot is not null
       and v_picnic_venue is not null then
      -- stay nights AND a setup slot at a venue that can host both
      NEW.booking_kind := 'picnic_stay';
    elsif v_type in ('cafe', 'custom') then
      NEW.booking_kind := 'picnic';
    elsif v_type = 'partner_bnb' then
      -- guest books the stay off-platform; what we sell here is the picnic setup
      NEW.booking_kind := 'picnic';
    elsif v_type in ('self_managed', 'combo') and NEW.checkout_date is not null then
      NEW.booking_kind := 'stay';
    elsif NEW.time_slot is not null then
      NEW.booking_kind := 'picnic';
    elsif NEW.checkout_date is not null then
      NEW.booking_kind := 'stay';
    else
      NEW.booking_kind := 'picnic';
    end if;
  end if;

  -- 2. Fill the split only for the unambiguous kinds, and only when not already set.
  --    picnic_stay is left NULL on purpose - see header.
  if NEW.booking_kind = 'picnic' then
    if NEW.picnic_amount is null then NEW.picnic_amount := coalesce(NEW.total_amount, 0); end if;
    if NEW.stay_amount   is null then NEW.stay_amount   := 0; end if;
  elsif NEW.booking_kind = 'stay' then
    if NEW.stay_amount   is null then NEW.stay_amount   := coalesce(NEW.total_amount, 0); end if;
    if NEW.picnic_amount is null then NEW.picnic_amount := 0; end if;
  end if;

  return NEW;
end; $function$;

DROP TRIGGER IF EXISTS trg_bookings_set_booking_kind ON public.bookings;

CREATE TRIGGER trg_bookings_set_booking_kind
  BEFORE INSERT OR UPDATE OF venue_id, time_slot, checkout_date, total_amount, booking_kind
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_set_booking_kind();

COMMENT ON FUNCTION public.bookings_set_booking_kind() IS
  'Defaults booking_kind and the picnic/stay split when the caller did not supply them. Explicit values always win. Derivation mirrors compute_booking_total picnic_stay signal (nights + time_slot at a venue with picnic_venue_id) so pricing and classification cannot disagree.';

-- TESTED 2026-09-14 with a rolled-back DO block, 5 cases, zero residue verified afterwards:
--   cafe + slot (Beige 14)             -> picnic       8900 / 0
--   self_managed + nights (Umber 15)   -> stay            0 / 10900
--   Countryside 22, nights + slot      -> picnic_stay  NULL / NULL   (correct: needs manual split)
--   Countryside twin 27 + slot         -> picnic       5900 / 0
--   explicit 'stay' on a cafe venue    -> stay         (override respected)
