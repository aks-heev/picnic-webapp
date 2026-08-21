-- ============================================================================
-- Staff Live Event-Status Tool — PHASE 2 (RPCs)
-- Plan: docs/STAFF_STATUS_TOOL_PLAN.md
--
-- Production received this as TWO migration versions:
--   20260820143755  staff_rpcs
--   20260820143812  staff_today_drop_stable_volatility  (staff_today was declared
--                   STABLE but UPDATEs staff_tokens.last_used_at, which Postgres
--                   rejects at runtime)
-- This file is the coalesced equivalent: replaying it from scratch produces the
-- identical end state (staff_today VOLATILE). Verified against pg_proc:
--   admin_issue_staff_token/v/invoker, staff_event_ids_today/s/definer,
--   staff_log_step/v/definer, staff_today/v/definer
--
-- Three functions. No table, policy, grant or trigger outside these is touched.
--
-- 🔴 staff_today / staff_log_step are SECURITY DEFINER and EXECUTE-granted to
--    `anon`. That is the entire mechanism by which a staff phone reads a narrow
--    slice of `bookings` with NO auth identity and NO RLS rewrite. The security
--    boundary is the hardcoded column allowlist in the function body, not the
--    caller. Any edit to these bodies must be reviewed column by column.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- staff_event_ids_today — SINGLE SOURCE OF TRUTH for "which events are in play".
-- Both public RPCs go through this so their filters can never drift apart.
-- Not part of the API: EXECUTE is revoked from anon/authenticated/public. Nested
-- calls from the DEFINER functions below run as the owner, so they still work.
--
-- 🔴 (now() AT TIME ZONE 'Asia/Kolkata')::date, never current_date. Postgres
--    current_date is UTC; the naive version silently shows the wrong day's
--    events for 5.5 hours after 00:00 UTC.
-- ---------------------------------------------------------------------------
create or replace function public.staff_event_ids_today()
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from public.bookings b
  where b.confirmed = true
    and coalesce(b.booking_status, '') <> 'Cancelled'   -- never dispatch to a cancelled event
    and b.checkout_date is null                          -- picnics only in v1; stays are a separate design
    and b.preferred_date = (now() at time zone 'Asia/Kolkata')::date
$$;

revoke all on function public.staff_event_ids_today() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin_issue_staff_token — admin-only. Returns the plaintext token ONCE.
-- SECURITY INVOKER + hardcoded admin guard, matching the house convention.
-- ---------------------------------------------------------------------------
create or replace function public.admin_issue_staff_token(p_staff_name text)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_token text;
  v_row   public.staff_tokens%rowtype;
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Not authorized';
  end if;

  if p_staff_name is null or btrim(p_staff_name) = '' then
    raise exception 'Staff name is required';
  end if;

  -- 32 bytes of CSPRNG, base64url. Only the sha256 hex is persisted.
  v_token := replace(replace(replace(
               encode(extensions.gen_random_bytes(32), 'base64'),
             '+','-'), '/','_'), '=','');

  insert into public.staff_tokens (staff_name, token_hash)
  values (btrim(p_staff_name), encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'staff_name', v_row.staff_name,
    'upload_prefix', v_row.upload_prefix,
    'token', v_token   -- shown once; never retrievable again
  );
end;
$$;

revoke all on function public.admin_issue_staff_token(text) from public, anon;
grant execute on function public.admin_issue_staff_token(text) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_today — today's events for a valid, active token.
--
-- 🔴 COLUMN ALLOWLIST. Everything returned is listed explicitly below.
--    NEVER add: anything from booking_costs, email_address, razorpay_*,
--    board, lead_status/query_status/customer_intent, discount_amount.
--    (discount_amount is a signed *reporting* column, not a money source —
--     total_amount is authoritative, so balance = total - advance.)
--
-- 🔴 NOT STABLE. It writes last_used_at. See header.
-- ---------------------------------------------------------------------------
create or replace function public.staff_today(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tok    public.staff_tokens%rowtype;
  v_events jsonb;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  select * into v_tok
  from public.staff_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and is_active;

  -- Same opaque error for wrong / inactive / unknown. Never distinguish.
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  select coalesce(jsonb_agg(e order by e_sort_time nulls last, e_sort_id), '[]'::jsonb)
    into v_events
  from (
    select
      b.slot_start_time as e_sort_time,
      b.id              as e_sort_id,
      jsonb_build_object(
        'id',                    b.id,
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
                   'name',     v.name,
                   'area',     v.area,
                   'city',     v.city,
                   'address',  b.venue_address,
                   'maps_url', v.maps_url),
        'add_ons', coalesce((
            select jsonb_agg(jsonb_build_object('name', ba.name, 'price', ba.price_at_booking)
                             order by ba.id)
            from public.booking_add_ons ba where ba.booking_id = b.id), '[]'::jsonb),
        'log', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'step', l.step, 'at', l.at, 'by', l.by_name,
                     'note', l.note, 'amount', l.amount)
                   order by l.at, l.id)
            from public.booking_event_log l where l.booking_id = b.id), '[]'::jsonb)
      ) as e
    from public.bookings b
    left join public.venues v on v.id = b.venue_id
    where b.id in (select public.staff_event_ids_today())
  ) s;

  update public.staff_tokens set last_used_at = now() where id = v_tok.id;

  return jsonb_build_object(
    'ok', true,
    'staff', jsonb_build_object('name', v_tok.staff_name, 'upload_prefix', v_tok.upload_prefix),
    'date', (now() at time zone 'Asia/Kolkata')::date,
    'server_time', now(),
    'events', v_events
  );
end;
$$;

revoke all on function public.staff_today(text) from public;
grant execute on function public.staff_today(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- staff_log_step — append one step to booking_event_log.
--
-- 🔴 This function writes to booking_event_log and NOTHING ELSE. It must never
--    UPDATE bookings (advance_amount, payment_status, booking_status...).
--    p_amount records what staff SAY they collected; reconciling it into
--    bookings.advance_amount stays a deliberate admin action. An unauthenticated
--    token surface does not move money.
--
-- Spine is ordered: reached -> setup_done -> payment_received -> wrapped.
-- Chips (guests_arrived, guests_left) have NO prerequisite and never block the
-- spine — a skipped chip must not be able to strand an event mid-chain.
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
  v_tok    public.staff_tokens%rowtype;
  v_needs  text;
  v_new    boolean := false;
  v_log    jsonb;
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

  -- A valid token can only ever write to TODAY's events. This is what caps the
  -- damage of a leaked link to a single day's bookings.
  if not exists (select 1 from public.staff_event_ids_today() x where x = p_booking_id) then
    return jsonb_build_object('ok', false, 'error', 'not_today');
  end if;

  if p_amount is not null and p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;

  -- Spine ordering (chips deliberately exempt)
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

  -- Idempotent by booking_event_log_step_once. A double-tap on a flaky
  -- connection is a no-op, which is what makes the client retry queue safe.
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

revoke all on function public.staff_log_step(text, bigint, text, text, numeric) from public;
grant execute on function public.staff_log_step(text, bigint, text, text, numeric) to anon, authenticated;
