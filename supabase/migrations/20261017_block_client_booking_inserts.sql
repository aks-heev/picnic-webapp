-- 2026-10-17 — close two ways a client could create a CONFIRMED booking with the public anon key.
--
-- Hole 1: anon + authenticated had table INSERT on bookings / booking_add_ons with RLS
--         WITH CHECK (true), so a direct POST /rest/v1/bookings could set confirmed=true,
--         advance_amount=1 (fires the confirmation email, blocks the slot, create-order then
--         charges ₹1). The site never inserts directly — it calls submit_booking_intent
--         (SECURITY DEFINER), so these grants/policies were unused by legit traffic.
-- Hole 2: submit_booking_intent honours the caller's p_confirmed for every non-combo venue.
--         The site always sends false; an attacker can send true. Fixed with a BEFORE INSERT
--         trigger instead of rewriting the ~10k-char RPC (large-function rewrite risk).
--
-- Admin paths unaffected: admin_add_manual_booking / admin_edit_booking are SECURITY INVOKER and
-- run as aksh.eeev@gmail.com; admin_all_booking_add_ons already covers add-on writes.
-- Service-role edge functions (verify-payment, webhook, sync-ical) confirm via UPDATE and have
-- auth.role() = 'service_role', so the trigger ignores them.
--
-- ROLLBACK:
--   drop trigger if exists trg_bookings_block_client_confirm on public.bookings;
--   drop function if exists public.bookings_block_client_confirm();
--   drop policy if exists admin_insert_bookings on public.bookings;
--   grant insert on public.bookings, public.booking_add_ons to anon;
--   create policy anon_insert_bookings on public.bookings for insert to anon with check (true);
--   create policy auth_insert_bookings on public.bookings for insert to authenticated with check (true);
--   create policy anon_insert_booking_add_ons on public.booking_add_ons for insert to anon with check (true);

drop policy if exists anon_insert_bookings on public.bookings;
drop policy if exists auth_insert_bookings on public.bookings;
create policy admin_insert_bookings on public.bookings for insert to authenticated
  with check (auth.email() = 'aksh.eeev@gmail.com');

drop policy if exists anon_insert_booking_add_ons on public.booking_add_ons;

revoke insert on public.bookings, public.booking_add_ons from anon;

create or replace function public.bookings_block_client_confirm() returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $f$
begin
  if new.confirmed is true
     and coalesce(auth.role(), '') in ('anon', 'authenticated')
     and coalesce(auth.email(), '') <> 'aksh.eeev@gmail.com' then
    new.confirmed := false;
  end if;
  return new;
end $f$;

revoke execute on function public.bookings_block_client_confirm() from public, anon, authenticated;

drop trigger if exists trg_bookings_block_client_confirm on public.bookings;
create trigger trg_bookings_block_client_confirm
  before insert on public.bookings
  for each row execute function public.bookings_block_client_confirm();
