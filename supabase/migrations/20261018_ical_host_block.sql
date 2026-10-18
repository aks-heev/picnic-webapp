-- 2026-10-18 — Tell Airbnb host blocks apart from Airbnb guest reservations.
--
-- Why: the owner blocks a night on Airbnb for every direct (off-Airbnb) stay.
-- sync-ical imported that block as an ordinary source='ical' row, and the admin
-- save/confirm checks hard-reject every ical row — so a direct booking could not
-- be saved on the very night that had been blocked FOR it (booking #279, Umber,
-- 2026-10-18, needed a hand-deleted venue_availability row).
--
-- Airbnb's feed already distinguishes the two: guest stays carry SUMMARY
-- "Reserved", host / linked-listing / beyond-window blocks carry
-- "Airbnb (Not available)". sync-ical v26 now persists that as
-- venue_availability.ical_host_block.
--
-- Rules after this migration:
--   * ical_host_block = false (default, and anything unclassifiable) → hard block, as before.
--   * ical_host_block = true  → admin save raises 'HOST_BLOCK: …'; the admin form asks
--     "is this your own block?" and re-sends with p_booking.allow_host_block = true.
--   * source 'admin' / 'parent' rows are untouched — still hard blocks. A whole-home
--     Sienna reservation reaches the floors as source='parent', so it can never be waved through.
--   * The public calendar and public booking checks are NOT changed: customers still see
--     host-blocked nights as unavailable.
--   * combo-branch checks are deliberately NOT changed (out of scope; still hard).
--
-- No RPC signature changes: the override rides inside the existing p_booking jsonb.
-- The function patches are applied as exact-text replacements on the live bodies,
-- each asserted to match exactly once, so nothing else in the 8–10k-char functions moves.

alter table public.venue_availability
  add column if not exists ical_host_block boolean not null default false;

comment on column public.venue_availability.ical_host_block is
  'source=ical only. true = Airbnb "Not available" (host/linked/window block, no guest reservation). '
  'false = genuine reservation or unclassifiable (fail-safe). Set by sync-ical on every run.';

do $mig$
declare
  d      text;
  v_old  text;
  v_new  text;
  n      int;
begin
  ---------------------------------------------------------------------------
  -- admin_add_manual_booking
  ---------------------------------------------------------------------------
  d := pg_get_functiondef('public.admin_add_manual_booking(jsonb, jsonb)'::regprocedure);

  -- 1. declare the override flag next to v_ext_ref
  v_old := $o$  v_ext_ref    text := nullif(p_booking->>'external_booking_ref', '');
$o$;
  v_new := $o$  v_ext_ref    text := nullif(p_booking->>'external_booking_ref', '');
  -- Set by the admin form after the owner confirms an Airbnb "Not available" night is their own block.
  v_allow_hb   boolean := coalesce((p_booking->>'allow_host_block')::boolean, false);
$o$;
  n := (length(d) - length(replace(d, v_old, ''))) / length(v_old);
  if n <> 1 then raise exception 'add: v_ext_ref decl matched % times', n; end if;
  d := replace(d, v_old, v_new);

  -- 2. self_managed / partner_bnb night check
  v_old := $o$          and ( source in ('admin', 'parent')
                or (source = 'ical' and v_ext_ref is null) )
      ) then
        raise exception '% is blocked (admin block, Airbnb booking, or whole-floor booking)', d;
      end if;
$o$;
  v_new := $o$          and ( source in ('admin', 'parent')
                or (source = 'ical' and v_ext_ref is null and not ical_host_block) )
      ) then
        raise exception '% is blocked (admin block, Airbnb booking, or whole-floor booking)', d;
      end if;
      -- Airbnb "Not available" with no guest reservation: usually the owner's own block for
      -- this very booking. Soft — the form asks and re-sends with allow_host_block.
      if v_ext_ref is null and not v_allow_hb and exists (
        select 1 from venue_availability
        where venue_id = v_venue_id and date = d and source = 'ical' and ical_host_block
      ) then
        raise exception 'HOST_BLOCK: % is blocked on Airbnb but has no guest reservation', d;
      end if;
$o$;
  n := (length(d) - length(replace(d, v_old, ''))) / length(v_old);
  if n <> 1 then raise exception 'add: stay check matched % times', n; end if;
  d := replace(d, v_old, v_new);

  execute d;

  ---------------------------------------------------------------------------
  -- admin_edit_booking
  ---------------------------------------------------------------------------
  d := pg_get_functiondef('public.admin_edit_booking(bigint, jsonb, jsonb)'::regprocedure);

  v_old := $o$  v_checkout   date := nullif(p_booking->>'checkout_date', '')::date;
$o$;
  v_new := $o$  v_checkout   date := nullif(p_booking->>'checkout_date', '')::date;
  -- Set by the admin form after the owner confirms an Airbnb "Not available" night is their own block.
  v_allow_hb   boolean := coalesce((p_booking->>'allow_host_block')::boolean, false);
$o$;
  n := (length(d) - length(replace(d, v_old, ''))) / length(v_old);
  if n <> 1 then raise exception 'edit: v_checkout decl matched % times', n; end if;
  d := replace(d, v_old, v_new);

  v_old := $o$            where venue_id = v_venue_id and date = d and source in ('admin', 'ical', 'parent')
              and booking_id is distinct from p_booking_id
          ) then
            raise exception '% is blocked (admin block, Airbnb booking, or whole-floor booking)', d;
          end if;
$o$;
  v_new := $o$            where venue_id = v_venue_id and date = d and source in ('admin', 'ical', 'parent')
              and booking_id is distinct from p_booking_id
              and not (source = 'ical' and ical_host_block)
          ) then
            raise exception '% is blocked (admin block, Airbnb booking, or whole-floor booking)', d;
          end if;
          if not v_allow_hb and exists (
            select 1 from public.venue_availability
            where venue_id = v_venue_id and date = d and source = 'ical' and ical_host_block
          ) then
            raise exception 'HOST_BLOCK: % is blocked on Airbnb but has no guest reservation', d;
          end if;
$o$;
  n := (length(d) - length(replace(d, v_old, ''))) / length(v_old);
  if n <> 1 then raise exception 'edit: stay check matched % times', n; end if;
  d := replace(d, v_old, v_new);

  execute d;
end
$mig$;
