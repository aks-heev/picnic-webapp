-- ============================================================================
-- Staff tool — PHASE 2b: split READ scope from WRITE scope.
-- Applied to production as migration version 20260821150810
-- Plan: docs/STAFF_STATUS_TOOL_PLAN.md
--
-- Why this exists:
--   Staff asked to see future bookings. Widening the single existing scope
--   function would have widened WRITES too — a leaked link could then tick
--   "payment received" on an event three weeks out. The cap on a leaked link is
--   the whole reason the token model is defensible, so read and write scopes
--   are now separate functions:
--
--     staff_event_ids_active()    -> readable AND writable  (today + grace)
--     staff_event_ids_upcoming()  -> readable ONLY          (future dates)
--
-- 🔴 staff_log_step must only ever call staff_event_ids_active(). If a future
--    edit points it at the upcoming set, the day-scoping guarantee is gone.
--
-- Also fixes a real bug: "today" rolls at midnight IST, so an event wrapping at
-- 00:30 dropped off the list and staff could no longer log 'wrapped' — they'd
-- get not_today with no way to finish. Yesterday's events stay writable until
-- 04:00 IST.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ACTIVE = what staff can act on. Single source of truth for both the "today"
-- section of staff_today and every write in staff_log_step.
-- ---------------------------------------------------------------------------
create or replace function public.staff_event_ids_active()
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and b.checkout_date is null                         -- picnics only; stays are a separate design
    and (
      b.preferred_date = (now() at time zone 'Asia/Kolkata')::date
      or (                                              -- past-midnight grace
        b.preferred_date = (now() at time zone 'Asia/Kolkata')::date - 1
        and (now() at time zone 'Asia/Kolkata')::time < time '04:00'
      )
    )
$$;

-- ---------------------------------------------------------------------------
-- UPCOMING = read-only planning view. Never writable.
-- Unbounded horizon by the user's explicit choice (2026-08-21); the exposure is
-- capped by the reduced column set in staff_today instead — no phone number,
-- no balance, no totals.
-- ---------------------------------------------------------------------------
create or replace function public.staff_event_ids_upcoming()
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'
    and b.checkout_date is null
    and b.preferred_date > (now() at time zone 'Asia/Kolkata')::date
$$;

revoke all on function public.staff_event_ids_active()   from public, anon, authenticated;
revoke all on function public.staff_event_ids_upcoming() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- staff_today — now returns `events` (actionable) + `upcoming` (read-only).
--
-- 🔴 TWO SEPARATE ALLOWLISTS.
--    events[]   : full operational detail, needed to run the event today.
--    upcoming[] : planning detail ONLY. Deliberately omits mobile, balance_due,
--                 total_amount and advance_amount — staff do not need to phone
--                 next month's guest today, and this list has no horizon limit.
--    Never add contact or money fields to upcoming[].
-- ---------------------------------------------------------------------------
create or replace function public.staff_today(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tok      public.staff_tokens%rowtype;
  v_events   jsonb;
  v_upcoming jsonb;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  select * into v_tok
  from public.staff_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and is_active;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  -- ---- actionable events (today + grace) ----
  select coalesce(jsonb_agg(e order by e_sort_date, e_sort_time nulls last, e_sort_id), '[]'::jsonb)
    into v_events
  from (
    select
      b.preferred_date  as e_sort_date,
      b.slot_start_time as e_sort_time,
      b.id              as e_sort_id,
      jsonb_build_object(
        'id',                    b.id,
        'date',                  b.preferred_date,
        'guest_name',            b.full_name,
        'mobile',                b.mobile_number,
        'guests',                b.guest_count,
        'children',              b.children_count,
        'time_slot',             b.time_slot,
        'slot_start',            b.slot_start_time,
        'slot_end',              b.slot_end_time,
        'occasion',              b.occasion,
        'package_name',          b.package_name,
        'special_requirements',  b.special_requirements,
        'includes_food',         b.includes_food,
        'food_items_count',      b.food_items_count,
        'beverage_items_count',  b.beverage_items_count,
        'total_amount',          b.total_amount,
        'advance_amount',        b.advance_amount,
        'balance_due',           greatest(coalesce(b.total_amount, 0) - coalesce(b.advance_amount, 0), 0),
        'venue', jsonb_build_object(
                   'name', v.name, 'area', v.area, 'city', v.city,
                   'address', b.venue_address, 'maps_url', v.maps_url),
        'add_ons', coalesce((
            select jsonb_agg(jsonb_build_object('name', ba.name, 'price', ba.price_at_booking) order by ba.id)
            from public.booking_add_ons ba where ba.booking_id = b.id), '[]'::jsonb),
        'log', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'step', l.step, 'at', l.at, 'by', l.by_name, 'note', l.note, 'amount', l.amount)
                   order by l.at, l.id)
            from public.booking_event_log l where l.booking_id = b.id), '[]'::jsonb)
      ) as e
    from public.bookings b
    left join public.venues v on v.id = b.venue_id
    where b.id in (select public.staff_event_ids_active())
  ) s;

  -- ---- upcoming (read-only planning list) ----
  select coalesce(jsonb_agg(u order by u_sort_date, u_sort_time nulls last, u_sort_id), '[]'::jsonb)
    into v_upcoming
  from (
    select
      b.preferred_date  as u_sort_date,
      b.slot_start_time as u_sort_time,
      b.id              as u_sort_id,
      jsonb_build_object(
        'id',                   b.id,
        'date',                 b.preferred_date,
        'guest_name',           b.full_name,
        'guests',               b.guest_count,
        'children',             b.children_count,
        'time_slot',            b.time_slot,
        'slot_start',           b.slot_start_time,
        'slot_end',             b.slot_end_time,
        'occasion',             b.occasion,
        'package_name',         b.package_name,
        'special_requirements', b.special_requirements,
        'includes_food',        b.includes_food,
        'venue', jsonb_build_object('name', v.name, 'area', v.area, 'city', v.city),
        'add_ons', coalesce((
            select jsonb_agg(jsonb_build_object('name', ba.name) order by ba.id)
            from public.booking_add_ons ba where ba.booking_id = b.id), '[]'::jsonb)
        -- NO mobile. NO balance_due. NO total_amount / advance_amount.
      ) as u
    from public.bookings b
    left join public.venues v on v.id = b.venue_id
    where b.id in (select public.staff_event_ids_upcoming())
  ) t;

  update public.staff_tokens set last_used_at = now() where id = v_tok.id;

  return jsonb_build_object(
    'ok', true,
    'staff', jsonb_build_object('name', v_tok.staff_name, 'upload_prefix', v_tok.upload_prefix),
    'date', (now() at time zone 'Asia/Kolkata')::date,
    'server_time', now(),
    'events', v_events,
    'upcoming', v_upcoming
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- staff_log_step — repointed at the ACTIVE set. Everything else unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.staff_log_step(
  p_token      text,
  p_booking_id bigint,
  p_step       text,
  p_note       text    default null,
  p_amount     numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tok   public.staff_tokens%rowtype;
  v_needs text;
  v_new   boolean := false;
  v_log   jsonb;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  select * into v_tok
  from public.staff_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if p_step is not distinct from null
     or p_step not in ('reached','setup_done','payment_received','wrapped',
                       'guests_arrived','guests_left') then
    return jsonb_build_object('ok', false, 'error', 'unknown_step');
  end if;

  -- 🔴 ACTIVE only. A token can never write to a future event, however far the
  --    read scope reaches. This is what caps the damage of a leaked link.
  if not exists (select 1 from public.staff_event_ids_active() x where x = p_booking_id) then
    return jsonb_build_object('ok', false, 'error', 'not_today');
  end if;

  if p_amount is not null and p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;

  v_needs := case p_step
               when 'setup_done'       then 'reached'
               when 'payment_received' then 'setup_done'
               when 'wrapped'          then 'payment_received'
               else null end;

  if v_needs is not null
     and not exists (select 1 from public.booking_event_log
                     where booking_id = p_booking_id and step = v_needs) then
    return jsonb_build_object('ok', false, 'error', 'out_of_order', 'needs', v_needs);
  end if;

  insert into public.booking_event_log (booking_id, step, staff_token_id, by_name, note, amount)
  values (p_booking_id, p_step, v_tok.id, v_tok.staff_name,
          nullif(btrim(coalesce(p_note, '')), ''),
          case when p_step = 'payment_received' then p_amount else null end)
  on conflict (booking_id, step) do nothing;

  v_new := found;

  select coalesce(jsonb_agg(jsonb_build_object(
           'step', l.step, 'at', l.at, 'by', l.by_name, 'note', l.note, 'amount', l.amount)
         order by l.at, l.id), '[]'::jsonb)
    into v_log
  from public.booking_event_log l where l.booking_id = p_booking_id;

  update public.staff_tokens set last_used_at = now() where id = v_tok.id;

  return jsonb_build_object('ok', true, 'step', p_step, 'created', v_new,
                            'booking_id', p_booking_id, 'log', v_log);
end;
$$;

-- The old combined scope function is gone: keeping it would leave two
-- overlapping definitions of "which events count", which is exactly the drift
-- the single-source-of-truth helper exists to prevent.
drop function if exists public.staff_event_ids_today();
