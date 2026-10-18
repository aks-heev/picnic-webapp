-- Reveal board message in upcoming[] checklist too (user decision 2026-09-24:
-- board message is not treated as sensitive as mobile/balance for upcoming bookings).
do $migration$
declare
  v_src text;
  v_anchor text := $anchor$        'checklist', public.staff_checklist_for(b.id),
        'add_ons', coalesce((select jsonb_agg(jsonb_build_object('name', ba.name) order by ba.id)$anchor$;
  v_new text := $anchor$        'checklist', public.staff_checklist_for(b.id, true),
        'add_ons', coalesce((select jsonb_agg(jsonb_build_object('name', ba.name) order by ba.id)$anchor$;
begin
  select pg_get_functiondef('public.staff_today(text)'::regprocedure) into v_src;

  if v_src not like '%' || v_anchor || '%' then
    raise exception 'anchor not found in staff_today; aborting patch';
  end if;
  if (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'anchor not unique in staff_today; aborting patch';
  end if;

  v_src := replace(v_src, v_anchor, v_new);
  execute v_src;
end
$migration$;
