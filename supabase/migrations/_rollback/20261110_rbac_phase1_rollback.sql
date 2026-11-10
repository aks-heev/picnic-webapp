-- Reverts 20261110_rbac_phase1_app_users.sql. Safe while no policy references these helpers (true until Phase 2).
drop index if exists public.expenses_region_idx;
drop index if exists public.venues_region_idx;
alter table public.expenses drop column if exists region;
drop table if exists public.app_users cascade;
drop function if exists public.app_users_keep_superuser();
drop function if exists public.my_access();
drop function if exists public.app_can_booking(bigint, text);
drop function if exists public.app_can_region(text, text);
drop function if exists public.app_role_caps(text);
drop function if exists public.is_superuser();
drop function if exists public.is_owner();
drop function if exists public.app_role();
-- staff_tokens 9 and 10 (inactive) were region NULL before; leaving them 'ncr' is harmless.
