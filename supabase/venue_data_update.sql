-- ================================================================
-- Picnic Webapp — Venue data update
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

-- 1. Add metadata column for BnB property details
ALTER TABLE venues ADD COLUMN IF NOT EXISTS metadata jsonb;

-- 2. Extend the type check constraint to include 'cafe'
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_type_check;
ALTER TABLE venues ADD CONSTRAINT venues_type_check
  CHECK (type IN ('self_managed', 'partner_bnb', 'custom', 'cafe'));


-- ================================================================
-- 2. Reclassify existing venues
-- ================================================================

-- Garden Nook → cafe (it's a hosted garden space, not a BnB)
UPDATE venues SET
  type = 'cafe',
  name = 'The Garden Nook',
  description = 'A lush private garden tucked away in the heart of Jaipur. Shaded by old trees and filled with wildflowers — perfect for intimate romantic picnics, birthday lunches, and small gatherings. We handle setup, food, and cleanup. You just show up and enjoy.'
WHERE id = 1;

-- Nahargarh Terrace → cafe (rooftop terrace, not a BnB)
UPDATE venues SET
  type = 'cafe',
  name = 'Nahargarh Terrace',
  description = 'A rooftop terrace with sweeping views of Jaipur''s skyline and the Aravalli hills. The perfect backdrop for golden-hour picnics, anniversaries, and proposals. Fully managed by us — arrive to a styled setup and leave without lifting a finger.'
WHERE id = 2;

-- Amber Courtyard Cafe → cafe (already a cafe in spirit)
UPDATE venues SET
  type = 'cafe',
  name = 'Amber Courtyard',
  description = 'A charming heritage courtyard near Amber Fort. Stone walls, fairy lights, and centuries-old architecture make this our most photographed venue. Ideal for corporate gatherings, birthdays, and anniversary dinners with a heritage touch.'
WHERE id = 3;


-- ================================================================
-- 3. New self-managed BnB venues
-- ================================================================

INSERT INTO venues (name, type, description, area, city, capacity_min, capacity_max, base_price, images, external_url, is_active, metadata)
VALUES
(
  'Haveli 14 — Heritage Stay',
  'self_managed',
  'A fully restored 19th-century haveli in the heart of Jaipur''s Old City. Three private rooms, a central courtyard with a fountain, and a rooftop with unobstructed fort views. We manage the property directly — no middlemen, no compromise on quality. Stay overnight and wake up to a picnic breakfast set up in the courtyard.',
  'Old City',
  'Jaipur',
  2,
  6,
  4500.00,
  '[{"alt": "Haveli 14 courtyard", "url": "https://placehold.co/800x600?text=Haveli+14+Courtyard"},
    {"alt": "Haveli 14 rooftop", "url": "https://placehold.co/800x600?text=Haveli+14+Rooftop"},
    {"alt": "Haveli 14 room", "url": "https://placehold.co/800x600?text=Haveli+14+Room"}]',
  NULL,
  true,
  '{
    "rooms": 3,
    "bathrooms": 3,
    "stay_price_per_night": 8500,
    "amenities": ["Private courtyard", "Rooftop terrace", "AC rooms", "Heritage architecture", "In-house chef", "WiFi", "24h host support"],
    "highlights": ["Fort views from rooftop", "Restored 19th-century architecture", "Courtyard fountain", "Walking distance to Hawa Mahal"],
    "ideal_for": ["Couples", "Family getaways", "Heritage enthusiasts"]
  }'
),
(
  'Villa Aradhya — Poolside Retreat',
  'self_managed',
  'A contemporary boutique villa on the outskirts of Jaipur with a private pool, manicured garden, and mountain views. Designed for couples and small families who want privacy without sacrificing luxury. Add a poolside or garden picnic to your stay for a complete experience.',
  'Kukas',
  'Jaipur',
  2,
  8,
  5500.00,
  '[{"alt": "Villa Aradhya pool", "url": "https://placehold.co/800x600?text=Villa+Aradhya+Pool"},
    {"alt": "Villa Aradhya garden", "url": "https://placehold.co/800x600?text=Villa+Aradhya+Garden"},
    {"alt": "Villa Aradhya bedroom", "url": "https://placehold.co/800x600?text=Villa+Aradhya+Room"}]',
  NULL,
  true,
  '{
    "rooms": 2,
    "bathrooms": 2,
    "stay_price_per_night": 12000,
    "amenities": ["Private pool", "Garden lawn", "AC rooms", "Mountain views", "BBQ area", "WiFi", "Parking", "Dedicated caretaker"],
    "highlights": ["Private pool exclusive to guests", "30 min from city center", "Sunrise mountain views", "2-acre landscaped property"],
    "ideal_for": ["Couples", "Honeymoon", "Small families", "Weekend escapes"]
  }'
);


-- ================================================================
-- 4. New cafe-type venues
-- ================================================================

INSERT INTO venues (name, type, description, area, city, capacity_min, capacity_max, base_price, images, external_url, is_active)
VALUES
(
  'Lakeside Lawn — Mansagar',
  'cafe',
  'A private lawn on the banks of Mansagar Lake, with Jal Mahal floating in the background. Morning and evening slots available. One of Jaipur''s most iconic backdrops for a picnic — sunrise setups especially are unforgettable.',
  'Mansagar Lake',
  'Jaipur',
  2,
  16,
  3200.00,
  '[{"alt": "Lakeside Lawn setup", "url": "https://placehold.co/800x600?text=Lakeside+Lawn"}]',
  NULL,
  true
),
(
  'The Pink Veranda',
  'cafe',
  'A bougainvillea-draped veranda at a boutique guesthouse in C-Scheme. Intimate, shaded, and beautifully styled — this spot seats up to 10 and works perfectly for bridal showers, baby showers, and birthday teas.',
  'C-Scheme',
  'Jaipur',
  2,
  10,
  2800.00,
  '[{"alt": "The Pink Veranda", "url": "https://placehold.co/800x600?text=Pink+Veranda"}]',
  NULL,
  true
);


-- ================================================================
-- 5. Bookings schema — add time_slot and checkout_date
-- ================================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS time_slot text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkout_date date;

-- Optional: document allowed slot values
COMMENT ON COLUMN bookings.time_slot IS 'Cafe slot: morning | afternoon | evening';
COMMENT ON COLUMN bookings.checkout_date IS 'BnB checkout date (check-in = preferred_date)';


-- ================================================================
-- Verify
-- ================================================================
SELECT id, name, type, base_price,
       metadata->>'rooms' AS rooms,
       metadata->>'stay_price_per_night' AS stay_per_night
FROM venues
ORDER BY type, id;
