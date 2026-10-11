-- 2026-10-11 — APPLIED LIVE via execute_sql (record only; do not re-run).
-- White Board Message (id 37, ₹1000) + Macramé Umbrella (id 38, ₹1500).
-- Included (₹0, package_add_ons) in The Setting / The Moment / The Story.
-- Paid extras on The Prelude (and any other cafe package at these venues).
-- Offered at packages-enabled cafes only: Beige Cafe 14, Castle Valley 19,
-- Countryside Offgrid 27. Not on TerraCottage stays (setup add-ons 33-36).
-- app.js gates the free board picker on Prelude behind add-on 37.
insert into add_ons (name, description, price, category, available_for, is_active, sort_order, requires_confirmation, requires_confirmation_for) values
  ('White Board Message', 'White wooden arch board with your message.', 1000, 'decor', array['cafe'], true, 62, false, '{}'),
  ('Macramé Umbrella', null, 1500, 'decor', array['cafe'], true, 64, false, '{}');
-- then: venue_add_ons (14|19|27, 37|38); package_add_ons (setting|moment|story, 37|38)
