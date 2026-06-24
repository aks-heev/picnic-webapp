-- ============================================================
-- Migration: Add-ons catalog + booking line items
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================


-- ----------------------------------------------------------------
-- 1. ENUM for add-on categories
-- ----------------------------------------------------------------
CREATE TYPE addon_category AS ENUM (
  'photography',
  'decor',
  'food',
  'entertainment',
  'extension'
);


-- ----------------------------------------------------------------
-- 2. ADD_ONS — global catalog of available add-ons
--    available_for: array of venue types that show this add-on
--    requires_confirmation: admin must confirm before it's locked in
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS add_ons (
  id                    bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                  text    NOT NULL,
  category              addon_category NOT NULL,
  price                 numeric(10, 2) NOT NULL DEFAULT 0,
  description           text,
  requires_confirmation boolean NOT NULL DEFAULT false,
  available_for         text[]  NOT NULL DEFAULT '{cafe,self_managed,partner_bnb}',
  is_active             boolean NOT NULL DEFAULT true,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS add_ons_category_idx    ON add_ons (category);
CREATE INDEX IF NOT EXISTS add_ons_is_active_idx   ON add_ons (is_active);
CREATE INDEX IF NOT EXISTS add_ons_sort_order_idx  ON add_ons (sort_order);

ALTER TABLE add_ons ENABLE ROW LEVEL SECURITY;

-- Anyone can read active add-ons (needed for customer booking form)
CREATE POLICY "anon_select_add_ons"
  ON add_ons FOR SELECT TO anon
  USING (is_active = true);

-- Admin can read all (including inactive)
CREATE POLICY "auth_select_add_ons"
  ON add_ons FOR SELECT TO authenticated
  USING (true);

-- Admin can create / update / delete
CREATE POLICY "auth_insert_add_ons"
  ON add_ons FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_add_ons"
  ON add_ons FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_add_ons"
  ON add_ons FOR DELETE TO authenticated
  USING (true);


-- ----------------------------------------------------------------
-- 3. UPDATE BOOKING_ADD_ONS
--    - Make addon_id a proper FK to add_ons(id)
--    - Add name column so historical records are self-contained
--      (if an add-on is deleted, the booking record still shows its name)
-- ----------------------------------------------------------------

-- Add name column if it doesn't exist
ALTER TABLE booking_add_ons
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';

-- Add proper FK to add_ons (SET NULL on delete preserves the line item)
ALTER TABLE booking_add_ons
  ADD CONSTRAINT booking_add_ons_addon_id_fk
  FOREIGN KEY (addon_id) REFERENCES add_ons (id) ON DELETE SET NULL;

-- addon_id can now be null when the source add-on is deleted
ALTER TABLE booking_add_ons
  ALTER COLUMN addon_id DROP NOT NULL;


-- ----------------------------------------------------------------
-- 4. SEED — the 16 add-ons from the catalog
-- ----------------------------------------------------------------
INSERT INTO add_ons (name, category, price, sort_order, available_for) VALUES
  -- Photography
  ('Photo Printouts',   'photography', 500,  10, '{cafe,self_managed,partner_bnb}'),
  ('Polaroid Pictures', 'photography', 1100, 20, '{cafe,self_managed,partner_bnb}'),
  ('Photographer',      'photography', 6000, 30, '{cafe,self_managed,partner_bnb}'),

  -- Decor
  ('Extra Flowers',     'decor',       1100, 40, '{cafe,self_managed,partner_bnb}'),
  ('Extra Candles',     'decor',       1100, 50, '{cafe,self_managed,partner_bnb}'),
  ('Bouquet',           'decor',       1500, 60, '{cafe,self_managed,partner_bnb}'),
  ('Cold Pyros',        'decor',       3000, 70, '{cafe,self_managed,partner_bnb}'),

  -- Food
  ('Cake',              'food',        1100, 80, '{cafe,self_managed,partner_bnb}'),
  ('Barbeque',          'food',        4000, 90, '{cafe,self_managed,partner_bnb}'),

  -- Entertainment
  ('Bonfire',           'entertainment', 500,  100, '{self_managed,partner_bnb}'),
  ('Skyshots',          'entertainment', 4000, 110, '{cafe,self_managed,partner_bnb}'),
  ('Sip & Paint',       'entertainment', 4000, 120, '{cafe,self_managed,partner_bnb}'),
  ('Movie Screening',   'entertainment', 4500, 130, '{cafe,self_managed,partner_bnb}'),
  ('Live Music',        'entertainment', 6000, 140, '{cafe,self_managed,partner_bnb}'),
  ('Hot Air Balloon',   'entertainment', 6000, 150, '{self_managed,partner_bnb}'),

  -- Extension
  ('Extra Hour',        'extension',   1100, 160, '{cafe,self_managed,partner_bnb}')

ON CONFLICT DO NOTHING;
