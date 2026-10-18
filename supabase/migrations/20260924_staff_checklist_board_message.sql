-- Board cutouts checklist item shows the actual board message in brackets,
-- but ONLY for today's events[] (staff on-site, same-day context).
-- upcoming[] must never carry the message (same rule as mobile/balance_due).
drop function public.staff_checklist_for(bigint);

create function public.staff_checklist_for(p_booking_id bigint, p_reveal_message boolean default false)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with b as (
    select id, package_key, guest_count, board from public.bookings where id = p_booking_id
  ),
  fixed as (
    select 1 as grp, i.sort, 'i:' || i.key as ref,
           case when i.key = 'board_cutouts' and p_reveal_message
                     and btrim(coalesce(b.board ->> 'message', '')) <> ''
                then i.label || ' (' ||
                     left(btrim(b.board ->> 'message'), 120) ||
                     case when length(btrim(b.board ->> 'message')) > 120 then '…' else '' end ||
                     ')'
                else i.label
           end as label,
           case when i.qty_per_guest is not null then i.qty_per_guest * b.guest_count
                else coalesce((i.qty_by_package ->> b.package_key)::int, i.qty_fixed) end as qty,
           (i.qty_per_guest is not null and b.guest_count is null) as qty_unknown
    from public.checklist_items i cross join b
    where i.is_active
      and not (coalesce(b.package_key, '') = any (i.exclude_packages))
      and (i.condition = 'always'
           or (i.condition = 'white_board'
               and b.board ->> 'type' = 'white'
               and btrim(coalesce(b.board ->> 'message', '')) <> ''))
  ),
  addon_src as (
    select coalesce(ba.addon_id::text, 'n' || md5(lower(btrim(ba.name)))) as k, ba.name as label, 0 as pri
    from public.booking_add_ons ba where ba.booking_id = p_booking_id
    union all
    select a.id::text, a.name, 1
    from b
    join public.packages p on p.key = b.package_key
    join public.package_add_ons pa on pa.package_id = p.id
    join public.add_ons a on a.id = pa.addon_id
  ),
  addons as (
    select distinct on (k) 2 as grp, 0 as sort, 'a:' || k as ref, label, null::int as qty, false as qty_unknown
    from addon_src order by k, pri
  ),
  extras as (
    select 3 as grp, e.sort, e.ref, e.label, e.qty, false as qty_unknown
    from public.booking_checklist_extras e where e.booking_id = p_booking_id
  ),
  items as (
    select * from fixed union all select * from addons union all select * from extras
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'ref', it.ref, 'label', it.label, 'qty', it.qty,
           'qty_unknown', case when it.qty_unknown then true end,
           'done', coalesce(t.checked, false)))
         order by it.grp, it.sort, it.label), '[]'::jsonb)
  from items it
  left join public.booking_checklist_ticks t
    on t.booking_id = p_booking_id and t.item_ref = it.ref;
$function$;

-- staff_today: reveal the message only in events[] (today), not upcoming[]
do $migration$
declare
  v_src text;
  v_anchor_events text := $anchor$        'checklist', public.staff_checklist_for(b.id),
        'add_ons', coalesce((select jsonb_agg(jsonb_build_object('name', ba.name, 'price', ba.price_at_booking) order by ba.id)$anchor$;
  v_new_events text := $anchor$        'checklist', public.staff_checklist_for(b.id, true),
        'add_ons', coalesce((select jsonb_agg(jsonb_build_object('name', ba.name, 'price', ba.price_at_booking) order by ba.id)$anchor$;
begin
  select pg_get_functiondef('public.staff_today(text)'::regprocedure) into v_src;

  if v_src not like '%' || v_anchor_events || '%' then
    raise exception 'anchor not found in staff_today; aborting patch';
  end if;
  if (length(v_src) - length(replace(v_src, v_anchor_events, ''))) / length(v_anchor_events) <> 1 then
    raise exception 'anchor not unique in staff_today; aborting patch';
  end if;

  v_src := replace(v_src, v_anchor_events, v_new_events);
  execute v_src;
end
$migration$;
