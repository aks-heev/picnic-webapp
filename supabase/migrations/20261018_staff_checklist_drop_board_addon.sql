-- Applied live 2026-10-18 via apply_migration "staff_checklist_drop_board_addon".
-- The board is decided ONLY by bookings.board (type + message). Add-on 37 "White Board Message"
-- is bundled into setting/moment/story, so it listed a WHITE board on every booking of those
-- packages, incl. black-chalkboard ones (e.g. #267). Exclude it from the carry checklist; the
-- fixed 'board_cutouts' item (condition white_board) already covers the white-arch case.
-- Only change vs previous body: the two `37` filters in addon_src.
CREATE OR REPLACE FUNCTION public.staff_checklist_for(p_booking_id bigint, p_reveal_message boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    from public.booking_add_ons ba
    where ba.booking_id = p_booking_id
      and ba.addon_id is distinct from 37   -- board is driven by bookings.board, not this add-on
    union all
    select a.id::text, a.name, 1
    from b
    join public.packages p on p.key = b.package_key
    join public.package_add_ons pa on pa.package_id = p.id
    join public.add_ons a on a.id = pa.addon_id
    where a.id <> 37                         -- same
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
