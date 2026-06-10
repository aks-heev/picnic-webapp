-- My Bookings lookup for the phone-OTP customer flow.
--
-- Customers verify their phone via Supabase Auth (Twilio SMS) and then call
-- this RPC to fetch their own bookings. The phone is read from the verified
-- session JWT (never passed as a parameter), so a caller can only ever see
-- bookings matching the number they actually verified.
--
-- bookings.mobile_number is stored in inconsistent formats (+917742363777,
-- 7742363777, "+91 88888 11111"), so both the JWT phone and the stored number
-- are reduced to their last 10 digits before matching. A plain equality match
-- would hide the bare-format rows.
--
-- Applied to project evmftrogyzoudiccqkya on 2026-06-10 (originally via MCP;
-- this file backfills the migration history to match remote).

create or replace function public.get_my_bookings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(b_row order by preferred_date desc), '[]'::jsonb)
  from (
    select
      to_jsonb(b) || jsonb_build_object(
        'venues',
        case when v.id is null then null else jsonb_build_object(
          'name', v.name, 'type', v.type, 'area', v.area
        ) end
      ) as b_row,
      b.preferred_date
    from public.bookings b
    left join public.venues v on v.id = b.venue_id
    where nullif(regexp_replace(coalesce(auth.jwt() ->> 'phone',''), '\D', '', 'g'), '') is not null
      and right(regexp_replace(b.mobile_number, '\D', '', 'g'), 10)
        = right(regexp_replace(auth.jwt() ->> 'phone', '\D', '', 'g'), 10)
  ) t;
$$;

revoke all on function public.get_my_bookings() from public, anon;
grant execute on function public.get_my_bookings() to authenticated;
