-- ================================================================
-- Add a self_managed BnB venue
-- ================================================================
INSERT INTO venues (name, type, description, area, city, capacity_min, capacity_max, base_price, images, external_url, is_active, metadata)
VALUES (
  'Venue Name',
  'self_managed',
  'Description here.',
  'Area Name',
  'Jaipur',
  2,        -- min guests
  8,        -- max guests
  5000.00,  -- base picnic price
  '[{"alt": "Image description", "url": "https://..."}]',
  NULL,
  true,
  '{
    "rooms": 3,
    "bathrooms": 2,
    "stay_price_per_night": 9000,
    "amenities": ["Private pool", "WiFi", "AC rooms"],
    "highlights": ["Mountain views", "Walking distance to X"],
    "ideal_for": ["Couples", "Families"]
  }'
);


-- ================================================================
-- Add a cafe venue
-- ================================================================
INSERT INTO venues (name, type, description, area, city, capacity_min, capacity_max, base_price, images, external_url, is_active)
VALUES (
  'Venue Name',
  'cafe',
  'Description here.',
  'Area Name',
  'Jaipur',
  2,
  12,
  3000.00,
  '[{"alt": "Image description", "url": "https://..."}]',
  NULL,
  true
);


-- ================================================================
-- Add a partner_bnb venue (Airbnb-linked)
-- Guest books stay on Airbnb; we provide tiered picnic/setup service.
-- base_price is a fallback only — tiers drive the actual price.
-- ================================================================
INSERT INTO venues (name, type, description, area, city, capacity_min, capacity_max, base_price, images, external_url, is_active, metadata)
VALUES (
  'Venue Name',
  'partner_bnb',
  'Description here.',
  'Area Name',
  'Jaipur',
  2,
  8,
  9900.00,
  '[{"alt": "Image description", "url": "https://..."}]',
  'https://airbnb.com/rooms/...',
  true,
  '{
    "tiers": [
      {"up_to": 2, "price": 9900},
      {"up_to": 4, "price": 12900},
      {"up_to": 6, "price": 15900},
      {"up_to": 8, "price": 18900}
    ],
    "overage_per_person": 2000
  }'
);
