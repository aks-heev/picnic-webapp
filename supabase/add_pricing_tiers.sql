-- ================================================================
-- Picnic Webapp — Add pricing tiers to all venue types
-- Run in: Supabase Dashboard → SQL Editor
--
-- Cafe / partner_bnb picnic tier curve:
--   ≤2 guests  → ₹9,900
--   ≤4 guests  → ₹12,900
--   ≤6 guests  → ₹15,900
--   ≤8 guests  → ₹18,900
--   9+ guests  → ₹18,900 + ₹2,000 × (guests − 8)
--
-- Self_managed picnic tier curve (lower — stay cost is separate):
--   ≤2 guests  → ₹4,900
--   ≤4 guests  → ₹6,900
--   ≤6 guests  → ₹8,900
--   ≤8 guests  → ₹10,900
--   9+ guests  → ₹10,900 + ₹2,000 × (guests − 8)
--
-- Children (under 10) count at 0.5× for billing guests.
-- ================================================================


-- 1. Cafes — set metadata (tiers only, no other metadata needed)
UPDATE venues
SET metadata = jsonb_build_object(
  'tiers', jsonb_build_array(
    jsonb_build_object('up_to', 2, 'price', 9900),
    jsonb_build_object('up_to', 4, 'price', 12900),
    jsonb_build_object('up_to', 6, 'price', 15900),
    jsonb_build_object('up_to', 8, 'price', 18900)
  ),
  'overage_per_person', 2000
)
WHERE type = 'cafe';


-- 2. Self-managed BnBs — merge tiers into existing metadata
--    (preserves rooms, bathrooms, stay_price_per_night, amenities, etc.)
UPDATE venues
SET metadata = metadata || jsonb_build_object(
  'tiers', jsonb_build_array(
    jsonb_build_object('up_to', 2, 'price', 4900),
    jsonb_build_object('up_to', 4, 'price', 6900),
    jsonb_build_object('up_to', 6, 'price', 8900),
    jsonb_build_object('up_to', 8, 'price', 10900)
  ),
  'overage_per_person', 2000
)
WHERE type = 'self_managed';


-- Verify all venue types
SELECT id, name, type,
       metadata->'tiers'               AS tiers,
       metadata->>'overage_per_person' AS overage_per_person,
       metadata->>'stay_price_per_night' AS stay_per_night
FROM venues
ORDER BY type, id;
