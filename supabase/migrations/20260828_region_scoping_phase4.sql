-- Phase 4 of docs/STAFF_ACCESS_BY_LOCATION_PLAN.md — issue tokens with a region.
--
-- admin_issue_staff_token is PostgREST-exposed, so adding even a DEFAULTed
-- parameter would leave two resolvable overloads (CLAUDE.md §4). Drop first.
--
-- Applied live 2026-08-28 as migration 20260828060038.

drop function public.admin_issue_staff_token(text);

create function public.admin_issue_staff_token(p_staff_name text, p_region text default null)
returns jsonb
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_token  text;
  v_region text := nullif(btrim(coalesce(p_region, '')), '');
  v_row    public.staff_tokens%rowtype;
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Not authorized';
  end if;

  if p_staff_name is null or btrim(p_staff_name) = '' then
    raise exception 'Staff name is required';
  end if;

  -- Validate and RAISE. A typo must never coerce to NULL: NULL means "every
  -- region", so a silent fallback would hand out an all-access link — the exact
  -- failure this whole plan exists to prevent.
  if v_region is not null and v_region not in ('ncr', 'jaipur') then
    raise exception 'Unknown location %. Use ''ncr'', ''jaipur'', or leave it empty for all locations.', v_region;
  end if;

  -- 32 bytes of CSPRNG, base64url. Only the sha256 hex is persisted.
  v_token := replace(replace(replace(
               encode(extensions.gen_random_bytes(32), 'base64'),
             '+','-'), '/','_'), '=','');

  insert into public.staff_tokens (staff_name, token_hash, region)
  values (btrim(p_staff_name), encode(extensions.digest(v_token, 'sha256'), 'hex'), v_region)
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'staff_name', v_row.staff_name,
    'region', v_row.region,
    'upload_prefix', v_row.upload_prefix,
    'token', v_token   -- shown once; never retrievable again
  );
end;
$function$;

grant execute on function public.admin_issue_staff_token(text, text) to authenticated;

-- ------------------------------------- surface the region on the staff page
-- So a wrong link is obvious on sight rather than after someone acts on the
-- wrong city's booking. Same asserted-substitution approach as Phase 2: the
-- column allowlist in staff_today is the security boundary of the whole staff
-- surface and is not worth retyping.
do $$
declare
  d      text;
  needle text := '''staff'', jsonb_build_object(''name'', v_tok.staff_name, ''upload_prefix'', v_tok.upload_prefix)';
  repl   text := '''staff'', jsonb_build_object(''name'', v_tok.staff_name, ''upload_prefix'', v_tok.upload_prefix, ''region'', v_tok.region)';
begin
  d := pg_get_functiondef('public.staff_today(text)'::regprocedure);
  if (length(d) - length(replace(d, needle, ''))) / length(needle) <> 1 then
    raise exception 'Expected exactly one staff-object site in staff_today; refusing to redefine it';
  end if;
  execute replace(d, needle, repl);
end $$;

-- ---------------------------------------------------------------- ROLLBACK
-- drop function public.admin_issue_staff_token(text, text);
-- recreate the single-arg version from 20260820_staff_rpcs.sql, then re-run the
-- do-block above with needle/repl swapped to remove the region key.
