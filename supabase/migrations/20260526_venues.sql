-- ============================================================
-- Migration: Venue-Based Booking Flow
-- The Picnic Stories — v1
--
-- Run in: Supabase Dashboard → SQL Editor
-- Depends on: 20260525_create_schema.sql (bookings table must exist)
-- ============================================================


-- ----------------------------------------------------------------
-- 1. CREATE VENUES TABLE
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS venues (
  id               bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  name             text    NOT NULL,

  -- 'self_managed' : The Picnic Stories owns/manages the property
  -- 'partner_bnb'  : Third-party Airbnb; customer books externally first
  -- 'custom'       : Reserved row for the "Your own space" entry point
  type             text    NOT NULL
                   CHECK (type IN ('self_managed', 'partner_bnb', 'custom')),

  description      text,
  area             text,                          -- display label, e.g. 'Near Nahargarh'
  city             text    NOT NULL DEFAULT 'Jaipur',

  capacity_min     integer CHECK (capacity_min >= 1),
  capacity_max     integer CHECK (
                     capacity_max IS NULL OR capacity_max >= capacity_min
                   ),

  -- Displayed as "Starting from ₹X" — reference only, not auto-calculated
  base_price       numeric(10, 2) CHECK (base_price >= 0),

  -- Array of public image URLs, e.g.:
  -- [{"url": "https://...","alt": "Rooftop setup"}, ...]
  images           jsonb   NOT NULL DEFAULT '[]'::jsonb,

  -- Airbnb listing URL — populated for partner_bnb type only
  external_url     text,

  -- Admin can hide a venue without deleting it
  is_active        boolean NOT NULL DEFAULT true,

  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Customers only ever browse active venues
CREATE INDEX IF NOT EXISTS venues_is_active_idx ON venues (is_active);
CREATE INDEX IF NOT EXISTS venues_type_idx      ON venues (type);


-- ----------------------------------------------------------------
-- 2. UPDATE BOOKINGS TABLE
--    Replace the text `location` column with proper relational fields.
--    Since the project database is fresh (no customer data yet),
--    we can drop and add cleanly.
-- ----------------------------------------------------------------

-- Drop the old free-text location column
ALTER TABLE bookings DROP COLUMN IF EXISTS location;

-- venue_id: null when customer uses their own venue (custom flow)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS venue_id
    bigint REFERENCES venues (id) ON DELETE SET NULL;

-- venue_address: required for custom-venue bookings, null otherwise
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS venue_address text;

-- external_booking_ref: optional Airbnb confirmation number
-- shown to admin on partner_bnb bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS external_booking_ref text;

-- Index for admin dashboard: filter bookings by venue
CREATE INDEX IF NOT EXISTS bookings_venue_id_idx ON bookings (venue_id);


-- ----------------------------------------------------------------
-- 3. RLS FOR VENUES
--    anon  → SELECT active venues only (gallery + detail page)
--    authenticated → full CRUD (admin manages venues)
-- ----------------------------------------------------------------
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_active_venues"
  ON venues FOR SELECT
  TO anon
  USING (is_active = true);

CREATE POLICY "auth_select_all_venues"
  ON venues FOR SELECT
  TO authenticated
  USING (true);   -- admin can see inactive venues too

CREATE POLICY "auth_insert_venues"
  ON venues FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_venues"
  ON venues FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_venues"
  ON venues FOR DELETE
  TO authenticated
  USING (true);

-- Grant table access (matches pattern from create_schema.sql)
GRANT SELECT                         ON TABLE venues TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE venues TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;


-- ----------------------------------------------------------------
-- 4. SEED DATA — placeholder venues
--    Replace image URLs and descriptions with real content.
--    The 'custom' type row is the "Your own space" card — one is enough.
-- ----------------------------------------------------------------
INSERT INTO venues (name, type, description, area, city, capacity_min, capacity_max, base_price, images, external_url, is_active)
VALUES

  -- Self-managed venues
  (
    'The Garden Nook',
    'self_managed',
    'A lush private garden tucked away in the heart of Jaipur. Perfect for intimate romantic picnics and small celebrations. We handle setup, food, and cleanup — you just show up.',
    'Civil Lines',
    'Jaipur',
    2, 8,
    2500.00,
    '[{"url": "https://placehold.co/800x600?text=Garden+Nook", "alt": "Garden Nook setup"}]'::jsonb,
    NULL,
    true
  ),

  (
    'Nahargarh Terrace',
    'self_managed',
    'A rooftop terrace with sweeping views of Jaipur''s skyline and the Aravalli hills. The perfect backdrop for golden-hour picnics, anniversaries, and proposals.',
    'Nahargarh Area',
    'Jaipur',
    2, 12,
    3500.00,
    '[{"url": "https://placehold.co/800x600?text=Nahargarh+Terrace", "alt": "Nahargarh Terrace view"}]'::jsonb,
    NULL,
    true
  ),

  (
    'Amber Courtyard Cafe',
    'self_managed',
    'A charming courtyard cafe near Amber Fort. Stone walls, fairy lights, and heritage architecture make this our most photographed venue. Ideal for corporate gatherings and birthday celebrations.',
    'Near Amber Fort',
    'Jaipur',
    4, 20,
    4000.00,
    '[{"url": "https://placehold.co/800x600?text=Amber+Courtyard", "alt": "Amber Courtyard Cafe"}]'::jsonb,
    NULL,
    true
  ),

  -- Partner Airbnb
  (
    'The Blue Haveli Suite',
    'partner_bnb',
    'A stunning heritage haveli with a private courtyard, rooftop, and pool — managed independently and listed on Airbnb. Book your stay directly on Airbnb, then layer in our picnic setup for a complete experience.',
    'Old City',
    'Jaipur',
    2, 10,
    2000.00,   -- Our service add-on price, not the Airbnb stay
    '[{"url": "https://placehold.co/800x600?text=Blue+Haveli", "alt": "Blue Haveli Suite"}]'::jsonb,
    'https://airbnb.com/rooms/placeholder-id',  -- replace with real Airbnb URL
    true
  ),

  -- Custom / bring your own venue
  (
    'Your Own Space',
    'custom',
    'Have your own venue in mind? Your terrace, a booked park, or a private space — we''ll bring the full picnic experience to you. Just tell us where.',
    NULL,
    'Jaipur',
    2, NULL,
    NULL,      -- Price depends on location and services; admin quotes after booking
    '[]'::jsonb,
    NULL,
    true
  );


-- ----------------------------------------------------------------
-- NEXT STEPS:
-- 1. Replace placeholder image URLs with real Supabase Storage URLs
-- 2. Replace the Airbnb partner URL with the real listing link
-- 3. Add more venues as needed via Supabase Dashboard → Table Editor
--    or by running additional INSERT statements
-- 4. Update app.js to load venues from Supabase and render the gallery
-- ----------------------------------------------------------------
