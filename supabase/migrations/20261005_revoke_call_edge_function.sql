-- 2026-10-05 — Revoke public EXECUTE on call_edge_function.
-- Applied to prod by Aksheev via the Supabase SQL Editor on 2026-10-05 (not via apply_migration).
--
-- call_edge_function(fn_name, payload) is SECURITY DEFINER with no auth guard and POSTs any
-- payload to any edge function. It was callable by anon/authenticated via /rest/v1/rpc/.
-- Only the notify-* trigger functions use it, and they run as the definer, so they don't
-- need this grant. Nothing in app.js calls it. Verified after applying:
--   has_function_privilege('anon'|'authenticated', 'public.call_edge_function(text,jsonb)', 'execute') = false
revoke execute on function public.call_edge_function(text, jsonb) from anon, authenticated, public;
