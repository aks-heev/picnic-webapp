-- Reverts 20261110_rbac_phase3_write_and_audit.sql
do $$ declare r record; begin
  for r in select tablename, policyname from pg_policies
           where schemaname='public' and policyname ~ '^rbac_.*_(insert|update|delete)$' and tablename <> 'app_users'
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
  for r in select def from archive.rbac_phase3_fn_backup loop execute r.def; end loop;
  for r in select c.relname from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgname='rbac_audit'
  loop execute format('drop trigger rbac_audit on public.%I', r.relname); end loop;
end $$;
drop function if exists public.rbac_audit();
drop table if exists public.admin_audit_log;
-- archive.rbac_phase3_fn_backup is kept on purpose.
