-- Applied live 2026-10-14 as migration staff_today_black_board_message.
-- Adds 'board_message' to TODAY's events[] only, and only for the black chalkboard
-- (staff write it on-site by hand). Never added to upcoming[]: unbounded horizon.
do $mig$
declare
  d      text := pg_get_functiondef('public.staff_today(text)'::regprocedure);
  anchor text := $a$'add_ons', coalesce((select jsonb_agg(jsonb_build_object('name', ba.name, 'price', ba.price_at_booking)$a$;
  ins    text := $i$'board_message', case when b.board->>'type' = 'black'
                                 then nullif(btrim(b.board->>'message'), '') end,
        $i$;
begin
  if position('board_message' in d) > 0 then
    raise notice 'already applied'; return;
  end if;
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor not found exactly once — function changed, patch by hand';
  end if;
  execute replace(d, anchor, ins || anchor);
end
$mig$;
