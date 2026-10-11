-- 2026-10-11: rename add-on 38 "Macramé Umbrella" -> "Picnic Umbrella" (Aksheev's call).
-- Name only; price (1500), venue mappings and past booking_add_ons rows untouched.
-- Rollback: update public.add_ons set name = 'Macramé Umbrella' where id = 38;
update public.add_ons set name = 'Picnic Umbrella' where id = 38 and name = 'Macramé Umbrella';
