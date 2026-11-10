-- Reverts 20261110_rbac_phase2_read_policies.sql
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname='public' and policyname like 'rbac\_%\_select' escape '\' and tablename <> 'app_users'
  loop execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
end $$;
drop function if exists public.app_regions(text);
