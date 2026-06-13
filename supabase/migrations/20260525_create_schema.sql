-- ============================================================
-- The Picnic Stories — Complete Database Schema
-- Reconstructed from app.js source analysis
--
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- Order matters: menu_links before orders (FK dependency)
-- ============================================================


-- ----------------------------------------------------------------
-- 1. BOOKINGS
--    Created when a customer submits the booking form (handleBookingSubmit).
--    Starts unconfirmed (confirmed = false). Admin confirms it and sets
--    advance_amount via the Queries tab.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id               bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Customer details (all required by the booking form)
  full_name        text    NOT NULL,
  mobile_number    text    NOT NULL,
  email_address    text    NOT NULL,
  location         text    NOT NULL,
    -- Valid values from the HTML select:
    -- 'jaipur-city' | 'jaipur-outskirts' | 'amber-fort'
    -- 'jal-mahal'   | 'nahargarh'        | 'custom'

  guest_count      integer NOT NULL CHECK (guest_count >= 1 AND guest_count <= 20),
  preferred_date   date    NOT NULL,
  special_requirements text,          -- nullable; customer may leave blank

  -- Admin-managed fields
  confirmed        boolean NOT NULL DEFAULT false,
  advance_amount   numeric(10, 2) NOT NULL DEFAULT 0
                   CHECK (advance_amount >= 0),

  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Speed up the two most common admin queries:
--   loadQueries()   → WHERE confirmed = false ORDER BY created_at DESC
--   loadBookings()  → WHERE confirmed = true  ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS bookings_confirmed_created_idx
  ON bookings (confirmed, created_at DESC);


-- ----------------------------------------------------------------
-- 2. MENU_LINKS
--    Admin generates these (generateMenuLink / generateBookingMenuLink).
--    Each link carries limits on how many food/bev items the customer
--    can select. Shared via URL: ?menu=<id>&booking=<booking_id>
--
--    NOTE — data model gap in original app:
--    The booking association was URL-only (?booking=X), so if a customer
--    navigated away the order became orphaned (booking_id NULL on orders).
--    We add an optional booking_id FK here so the link itself records
--    which booking it was generated for. The app.js generateBookingMenuLink()
--    function already passes bookingId in the URL; persist it here too.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_links (
  id               bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Which booking this link was generated for (optional — standalone links
  -- generated from the Menu Link Generator tab have no booking yet)
  booking_id       bigint  REFERENCES bookings (id) ON DELETE SET NULL,

  max_food_items   integer NOT NULL CHECK (max_food_items  >= 1 AND max_food_items  <= 15),
  max_bev_items    integer NOT NULL CHECK (max_bev_items   >= 1 AND max_bev_items   <= 10),

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS menu_links_booking_id_idx
  ON menu_links (booking_id);


-- ----------------------------------------------------------------
-- 3. ORDERS
--    Created when a customer submits their menu selection
--    (submitMenuSelection). selected_items is a JSONB array of objects:
--      [ { "name": "Paneer Tikka", "category": "food", "quantity": 2 }, … ]
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id               bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Which menu link the customer used
  menu_link_id     bigint  REFERENCES menu_links (id) ON DELETE SET NULL,

  -- Which booking this order belongs to (NULL = orphaned / standalone link)
  booking_id       bigint  REFERENCES bookings (id) ON DELETE SET NULL,

  -- Array of { name: text, category: "food"|"bev", quantity: integer }
  selected_items   jsonb   NOT NULL DEFAULT '[]'::jsonb,

  created_at       timestamptz NOT NULL DEFAULT now()
);

-- loadBookings() fetches orders per booking_id (N+1 — fix later with a join)
CREATE INDEX IF NOT EXISTS orders_booking_id_idx
  ON orders (booking_id);

CREATE INDEX IF NOT EXISTS orders_menu_link_id_idx
  ON orders (menu_link_id);


-- ----------------------------------------------------------------
-- 4. ROW-LEVEL SECURITY
--    Anon key = customer-facing operations only.
--    Authenticated (admin JWT via Supabase Auth) = full read/write.
-- ----------------------------------------------------------------
ALTER TABLE bookings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders      ENABLE ROW LEVEL SECURITY;

-- BOOKINGS --
CREATE POLICY "anon_insert_bookings"   ON bookings FOR INSERT TO anon         WITH CHECK (true);
CREATE POLICY "auth_select_bookings"   ON bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_update_bookings"   ON bookings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_bookings"   ON bookings FOR DELETE TO authenticated USING (true);

-- MENU_LINKS --
-- Anon needs SELECT to load the menu selection page (?menu=<id>)
CREATE POLICY "anon_select_menu_links" ON menu_links FOR SELECT TO anon         USING (true);
CREATE POLICY "auth_insert_menu_links" ON menu_links FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_menu_links" ON menu_links FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_menu_links" ON menu_links FOR DELETE TO authenticated USING (true);

-- ORDERS --
CREATE POLICY "anon_insert_orders"     ON orders FOR INSERT TO anon         WITH CHECK (true);
CREATE POLICY "auth_select_orders"     ON orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_update_orders"     ON orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_orders"     ON orders FOR DELETE TO authenticated USING (true);


-- ----------------------------------------------------------------
-- AFTER RUNNING THIS MIGRATION:
--
-- 1. Go to Authentication → Users → Add user
--    Create the admin account (email + strong password).
--    This is the credential used on the Admin Login page.
--
-- 2. Update your environment variables (create .env.local at project root):
--      SUPABASE_URL=https://<your-project-ref>.supabase.co
--      SUPABASE_ANON_KEY=<your-anon-key>
--    Both values are in: Supabase Dashboard → Settings → API
--
-- 3. Run: npm run dev   (or npm run build for production)
-- ----------------------------------------------------------------
