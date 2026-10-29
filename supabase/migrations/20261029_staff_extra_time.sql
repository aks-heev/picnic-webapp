-- 2026-10-29 — Staff-logged extra time, applied to the bill by an admin.
--
-- Staff REPORT extra hours on /staff (booking_event_log step 'extra_time',
-- amount = HOURS, never rupees). Only an admin turns that into money, via
-- admin_apply_staff_extra_time, which adds the active 'extension' add-on
-- (Extra Hour) once per hour at its catalogue price and raises total_amount by
-- the same figure. Same split as payments: staff_log_step still writes
-- booking_event_log and nothing else.

-- 1. Allow the new step ---------------------------------------------------------
alter table public.booking_event_log drop constraint booking_event_log_step_check;
alter table public.booking_event_log add constraint booking_event_log_step_check
  check (step = any (array['reached','setup_done','payment_received','wrapped',
                           'guests_arrived','guests_left','checked_in','checked_out',
                           'extra_time']));

-- 2. staff_log_step — same signature; extra_time is picnic-only, needs 'reached',
--    hours 0..4 (0 = staff correcting a mistaken tap), and is the ONE step whose
--    repeat overwrites (set-state, so a replayed queue job is still idempotent).
create or replace function public.staff_log_step(p_token text, p_booking_id bigint, p_step text,
                                                 p_note text default null, p_amount numeric default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_tok    public.staff_tokens%rowtype;
  v_needs  text;
  v_new    boolean := false;
  v_log    jsonb;
  v_isstay boolean;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  select * into v_tok
  from public.staff_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if p_step is not distinct from null
     or p_step not in ('reached','setup_done','payment_received','wrapped',
                       'guests_arrived','guests_left','checked_in','checked_out',
                       'extra_time') then
    return jsonb_build_object('ok', false, 'error', 'unknown_step');
  end if;

  -- 🔴 Writable set only. Picnics: today + 04:00 grace. Stays: check-in through
  --    check-out. A token can never write to a future booking of either kind.
  if exists (select 1 from public.staff_event_ids_active(v_tok.region) x where x = p_booking_id) then
    v_isstay := false;
  elsif exists (select 1 from public.staff_stay_ids_active(v_tok.region) x where x = p_booking_id) then
    v_isstay := true;
  else
    return jsonb_build_object('ok', false, 'error', 'not_today');
  end if;

  -- Steps do not cross kinds. payment_received is the one shared step.
  if v_isstay and p_step in ('reached','setup_done','wrapped','guests_arrived','guests_left','extra_time') then
    return jsonb_build_object('ok', false, 'error', 'wrong_kind');
  end if;
  if not v_isstay and p_step in ('checked_in','checked_out') then
    return jsonb_build_object('ok', false, 'error', 'wrong_kind');
  end if;

  if p_amount is not null and p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;

  -- extra_time: whole hours 0..4. amount carries HOURS here, never rupees.
  if p_step = 'extra_time'
     and (p_amount is null or p_amount <> trunc(p_amount) or p_amount > 4) then
    return jsonb_build_object('ok', false, 'error', 'bad_hours');
  end if;

  v_needs := case
    when v_isstay then case p_step
                         when 'payment_received' then 'checked_in'
                         when 'checked_out'      then 'checked_in'
                         else null end
    else case p_step
           when 'setup_done'       then 'reached'
           when 'payment_received' then 'setup_done'
           when 'wrapped'          then 'payment_received'
           when 'extra_time'       then 'reached'
           else null end
  end;

  if v_needs is not null
     and not exists (select 1 from public.booking_event_log
                     where booking_id = p_booking_id and step = v_needs) then
    return jsonb_build_object('ok', false, 'error', 'out_of_order', 'needs', v_needs);
  end if;

  if p_step = 'extra_time' then
    insert into public.booking_event_log (booking_id, step, staff_token_id, by_name, note, amount)
    values (p_booking_id, p_step, v_tok.id, v_tok.staff_name,
            nullif(btrim(coalesce(p_note, '')), ''), p_amount)
    on conflict (booking_id, step) do update
      set amount = excluded.amount, at = now(),
          staff_token_id = excluded.staff_token_id, by_name = excluded.by_name;
  else
    insert into public.booking_event_log (booking_id, step, staff_token_id, by_name, note, amount)
    values (p_booking_id, p_step, v_tok.id, v_tok.staff_name,
            nullif(btrim(coalesce(p_note, '')), ''),
            case when p_step = 'payment_received' then p_amount else null end)
    on conflict (booking_id, step) do nothing;
  end if;

  v_new := found;

  select coalesce(jsonb_agg(jsonb_build_object('step', l.step, 'at', l.at, 'by', l.by_name,
           'note', l.note, 'amount', l.amount) order by l.at, l.id), '[]'::jsonb)
    into v_log
  from public.booking_event_log l where l.booking_id = p_booking_id;

  update public.staff_tokens set last_used_at = now() where id = v_tok.id;

  return jsonb_build_object('ok', true, 'step', p_step, 'created', v_new,
                            'booking_id', p_booking_id, 'log', v_log);
end;
$function$;

-- 3. admin_apply_staff_extra_time — the deliberate admin action -----------------
--    Idempotent: adds only (hours logged − Extra Hour rows already on the
--    booking). Never removes rows if staff later lower the hours — that is a
--    manual edit, reported back as hours_on_booking > hours_logged.
create or replace function public.admin_apply_staff_extra_time(p_booking_id bigint)
 returns jsonb
 language plpgsql
 security invoker
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_b      record;
  v_hours  int;
  v_addon  record;
  v_n      int;
  v_have   int;
  v_add    int;
  v_total  numeric;
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;

  select id, confirmed, checkout_date, total_amount into v_b
  from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking % not found', p_booking_id;
  end if;
  if v_b.checkout_date is not null then
    raise exception 'Extra time applies to picnics only';
  end if;
  if v_b.total_amount is null then
    raise exception 'Booking % has no total — set the total first', p_booking_id;
  end if;

  select amount::int into v_hours
  from public.booking_event_log where booking_id = p_booking_id and step = 'extra_time';
  if v_hours is null then
    raise exception 'No extra time logged by staff for this booking';
  end if;

  select count(*) into v_n from public.add_ons where category = 'extension' and is_active;
  if v_n <> 1 then
    raise exception 'Expected exactly one active Extra Hour add-on (category extension), found %', v_n;
  end if;
  select id, name, price into v_addon from public.add_ons where category = 'extension' and is_active;

  select count(*) into v_have from public.booking_add_ons
  where booking_id = p_booking_id and addon_id = v_addon.id;

  v_add := greatest(v_hours - v_have, 0);
  v_total := v_b.total_amount;

  if v_add > 0 then
    insert into public.booking_add_ons (booking_id, addon_id, name, price_at_booking, requires_confirmation)
    select p_booking_id, v_addon.id, v_addon.name, v_addon.price, false
    from generate_series(1, v_add);

    update public.bookings set total_amount = total_amount + v_add * v_addon.price
    where id = p_booking_id
    returning total_amount into v_total;
  end if;

  return jsonb_build_object(
    'booking_id',       p_booking_id,
    'addon_name',       v_addon.name,
    'unit_price',       v_addon.price,
    'hours_logged',     v_hours,
    'hours_added',      v_add,
    'hours_on_booking', v_have + v_add,
    'amount_added',     v_add * v_addon.price,
    'total_amount',     v_total);
end;
$function$;

revoke all on function public.admin_apply_staff_extra_time(bigint) from public, anon;
grant execute on function public.admin_apply_staff_extra_time(bigint) to authenticated;
