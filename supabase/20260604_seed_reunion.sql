-- ============================================================
-- Seed + wire: The Reunion (combo parent of The Nook + The Gathering)
-- Run AFTER 20260604_parent_child.sql.
--
-- The Reunion is created INACTIVE with PLACEHOLDER content. Before you
-- flip is_active = true you must set real: description, base_price /
-- bundle pricing, capacity, and images. Leave airbnb_ical_url NULL
-- forever — the combo is direct-only and must never be exported.
--
-- Idempotent: re-running will not create a duplicate Reunion.
-- ============================================================

-- 1. Create The Reunion as a combo venue if it doesn't already exist.
INSERT INTO venues (name, type, description, area, city,
                    capacity_min, capacity_max, base_price,
                    is_active, max_concurrent_setups, airbnb_ical_url)
SELECT 'The Reunion', 'combo',
       'Full floor — The Nook (1RK) + The Gathering (2BHK) combined, with terrace. DLF Phase 2, Gurugram. [PLACEHOLDER — set real copy before activating.]',
       'DLF Phase 2', 'Gurugram',
       1, 10, 8000,            -- PLACEHOLDER capacity + price
       false, 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM venues WHERE name = 'The Reunion');

-- 2. Reunion is direct-only: never export to Airbnb.
UPDATE venues SET type = 'combo', airbnb_ical_url = NULL
  WHERE name = 'The Reunion';

-- 3. Point the two singles at the Reunion as their parent.
UPDATE venues
   SET parent_venue_id = (SELECT id FROM venues WHERE name = 'The Reunion')
 WHERE name IN ('The Nook', 'The Gathering');

-- Sanity check (read-only): should list Reunion=combo and both children linked.
-- select id, name, type, parent_venue_id from venues
--   where name in ('The Reunion','The Nook','The Gathering') order by name;
