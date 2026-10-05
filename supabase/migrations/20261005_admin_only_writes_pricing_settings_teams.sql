-- 2026-10-05 — Close the authenticated-write holes on venue_packages, site_settings, teams.
-- Applied to prod by Aksheev via the Supabase SQL Editor on 2026-10-05 (not via apply_migration,
-- so it does not appear in supabase_migrations.schema_migrations).
--
-- Before: any `authenticated` user could write these tables (USING true / WITH CHECK true).
-- Customers sign in by phone OTP and ARE `authenticated`, so any customer could
--   PATCH /rest/v1/venue_packages {"price":1}
-- and compute_booking_total (SECURITY DEFINER, reads venue_packages.price) would price a real
-- booking at ₹1. teams holds the WhatsApp/phone numbers shown to customers (phishing vector);
-- site_settings holds the hero image URLs.
--
-- After: writes are admin-only (same admin email as the project's other admin policies).
-- SELECT policies untouched — public read stays. Every app.js writer to these tables is an
-- admin-panel path (venue package upsert/delete, Teams tab save, hero image settings).
--
-- Rollback: drop the "Admin …" policies below and re-create the originals with USING (true) /
-- WITH CHECK (true): "Authenticated insert/update/delete venue_packages",
-- "Auth update site_settings", "Teams editable by authenticated" (FOR ALL).

drop policy if exists "Authenticated insert venue_packages" on public.venue_packages;
drop policy if exists "Authenticated update venue_packages" on public.venue_packages;
drop policy if exists "Authenticated delete venue_packages" on public.venue_packages;
create policy "Admin insert venue_packages" on public.venue_packages for insert to authenticated with check ((select auth.email()) = 'aksh.eeev@gmail.com');
create policy "Admin update venue_packages" on public.venue_packages for update to authenticated using ((select auth.email()) = 'aksh.eeev@gmail.com') with check ((select auth.email()) = 'aksh.eeev@gmail.com');
create policy "Admin delete venue_packages" on public.venue_packages for delete to authenticated using ((select auth.email()) = 'aksh.eeev@gmail.com');
drop policy if exists "Auth update site_settings" on public.site_settings;
create policy "Admin update site_settings" on public.site_settings for update to authenticated using ((select auth.email()) = 'aksh.eeev@gmail.com') with check ((select auth.email()) = 'aksh.eeev@gmail.com');
drop policy if exists "Teams editable by authenticated" on public.teams;
create policy "Admin insert teams" on public.teams for insert to authenticated with check ((select auth.email()) = 'aksh.eeev@gmail.com');
create policy "Admin update teams" on public.teams for update to authenticated using ((select auth.email()) = 'aksh.eeev@gmail.com') with check ((select auth.email()) = 'aksh.eeev@gmail.com');
create policy "Admin delete teams" on public.teams for delete to authenticated using ((select auth.email()) = 'aksh.eeev@gmail.com');
