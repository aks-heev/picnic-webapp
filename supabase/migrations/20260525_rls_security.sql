-- ============================================================
-- Migration: Row-Level Security for The Picnic Story
-- Run this in Supabase SQL Editor or via Supabase CLI
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Enable RLS on all three tables
-- ----------------------------------------------------------------
ALTER TABLE bookings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_links  ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- 2. BOOKINGS
--    anon  → INSERT only (public booking form)
--    authenticated (admin JWT) → SELECT, UPDATE, DELETE
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "anon_insert_bookings"  ON bookings;
DROP POLICY IF EXISTS "auth_select_bookings"  ON bookings;
DROP POLICY IF EXISTS "auth_update_bookings"  ON bookings;
DROP POLICY IF EXISTS "auth_delete_bookings"  ON bookings;

CREATE POLICY "anon_insert_bookings"
  ON bookings FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "auth_select_bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "auth_update_bookings"
  ON bookings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "auth_delete_bookings"
  ON bookings FOR DELETE
  TO authenticated
  USING (true);

-- ----------------------------------------------------------------
-- 3. ORDERS
--    anon  → INSERT only (customer submits menu selection)
--    authenticated → SELECT, UPDATE, DELETE
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "anon_insert_orders"  ON orders;
DROP POLICY IF EXISTS "auth_select_orders"  ON orders;
DROP POLICY IF EXISTS "auth_update_orders"  ON orders;
DROP POLICY IF EXISTS "auth_delete_orders"  ON orders;

CREATE POLICY "anon_insert_orders"
  ON orders FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "auth_select_orders"
  ON orders FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "auth_update_orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "auth_delete_orders"
  ON orders FOR DELETE
  TO authenticated
  USING (true);

-- ----------------------------------------------------------------
-- 4. MENU_LINKS
--    anon  → SELECT (needed to load the customer menu selection page)
--    authenticated → INSERT, UPDATE, DELETE (admin manages links)
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "anon_select_menu_links"  ON menu_links;
DROP POLICY IF EXISTS "auth_insert_menu_links"  ON menu_links;
DROP POLICY IF EXISTS "auth_update_menu_links"  ON menu_links;
DROP POLICY IF EXISTS "auth_delete_menu_links"  ON menu_links;

CREATE POLICY "anon_select_menu_links"
  ON menu_links FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "auth_insert_menu_links"
  ON menu_links FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_menu_links"
  ON menu_links FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "auth_delete_menu_links"
  ON menu_links FOR DELETE
  TO authenticated
  USING (true);

-- ----------------------------------------------------------------
-- AFTER RUNNING THIS MIGRATION:
-- 1. Go to Supabase Dashboard → Authentication → Users
-- 2. Create the admin user with your email + a strong password
-- 3. Update your .env / Vite env vars:
--      SUPABASE_URL=...
--      SUPABASE_ANON_KEY=...
--    The anon key is safe to expose; RLS enforces access.
-- ----------------------------------------------------------------
