-- 2026-10-11 (Aksheev's call): switch off the leftover test row in packages
-- (key test_package, blank name, no venue_packages rows, 0 bookings).
-- Rollback: update public.packages set is_active = true where key = 'test_package';
update public.packages set is_active = false, updated_at = now() where key = 'test_package' and is_active = true;
