# Picnic Webapp — Supabase Database Schema

## Table `venues`
| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `name` | `text` | |
| `type` | `text` | |
| `description` | `text` | Nullable |
| `area` | `text` | Nullable |
| `city` | `text` | |
| `capacity_min` | `int4` | Nullable |
| `capacity_max` | `int4` | Nullable |
| `base_price` | `numeric` | Nullable |
| `images` | `jsonb` | |
| `external_url` | `text` | Nullable |
| `maps_url` | `text` | Nullable — pasted Google Maps share link; powers "Get Directions" button in confirmation email |
| `metadata` | `jsonb` | Nullable — BnB rooms/amenities/highlights/tiers |
| `is_active` | `bool` | |
| `max_concurrent_setups` | `int4` | Default 1 (≥1) |
| `airbnb_ical_url` | `text` | Nullable — Airbnb feed; non-null ENABLES iCal sync for the venue |
| `last_ical_sync_at` | `timestamptz` | Nullable — last successful import |
| `last_ical_sync_status` | `text` | Nullable — last import result / error string |
| `sort_order` | `int4` | Nullable — display order (active-first by default); null sorts last |
| `created_at` | `timestamptz` | |

## Table `bookings`
| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `full_name` | `text` | |
| `mobile_number` | `text` | |
| `email_address` | `text` | |
| `guest_count` | `int4` | |
| `preferred_date` | `date` | |
| `special_requirements` | `text` | Nullable |
| `confirmed` | `bool` | |
| `advance_amount` | `numeric` | |
| `created_at` | `timestamptz` | |
| `venue_id` | `int8` | Nullable |
| `venue_address` | `text` | Nullable |
| `external_booking_ref` | `text` | Nullable |
| `time_slot` | `text` | Nullable — café slot (`morning`/`afternoon`/`evening`) |
| `checkout_date` | `date` | Nullable — self_managed stay end. EXCLUSIVE: nights are `[preferred_date, checkout_date)` |
| `customer_intent` | `text` | Nullable — `query` \| `lock` |

## Table `venue_availability`
| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `venue_id` | `int8` | FK venues, NOT NULL |
| `date` | `date` | NOT NULL |
| `status` | `text` | `blocked` \| `booked` |
| `source` | `text` | `admin` \| `booking` \| `ical` |
| `time_slot` | `text` | Nullable — slot block; NULL = full day |
| `booking_id` | `int8` | Nullable, FK bookings |
| `created_at` | `timestamptz` | |

Partial unique indexes: one full-day admin block per (venue,date); one admin slot block per (venue,date,slot); one `ical` block per (venue,date). `source='ical'` rows are owned by the `sync-ical` edge function and reconciled atomically via `replace_ical_blocks(venue_id, dates[])` — do not hand-edit them.

## Table `add_ons`
| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int4` | Primary |
| `name` | `text` | |
| `description` | `text` | Nullable |
| `price` | `int4` | |
| `category` | `text` | |
| `available_for` | `_text` | |
| `is_active` | `bool` | |
| `sort_order` | `int4` | |
| `created_at` | `timestamptz` | Nullable |
| `requires_confirmation_for` | `_text` | |

## Table `booking_add_ons`
| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `booking_id` | `int8` | Nullable, FK bookings |
| `addon_id` | `int4` | Nullable |
| `name` | `text` | Snapshot of add-on name at booking time |
| `price_at_booking` | `numeric` | |
| `requires_confirmation` | `bool` | Whether the add-on needs host sign-off |
| `created_at` | `timestamptz` | Nullable |

Add-on line items are written inside `submit_booking_intent` (same transaction as the booking) so they exist before the insert-trigger email fires. No `quantity` column — one row per selected add-on.

## Table `menu_links`
| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `booking_id` | `int8` | Nullable |
| `max_food_items` | `int4` | |
| `max_bev_items` | `int4` | |
| `created_at` | `timestamptz` | |

## Table `orders`
| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `menu_link_id` | `int8` | Nullable |
| `booking_id` | `int8` | Nullable |
| `selected_items` | `jsonb` | |
| `created_at` | `timestamptz` | |

---

## Notes

- `venues.type`: `cafe` | `self_managed` | `partner_bnb` | `custom`. self_managed = dual-listed website+Airbnb stays — the only venues the iCal sync targets.
- self_managed availability = admin blocks (`venue_availability.source='admin'`) ∪ imported Airbnb blocks (`source='ical'`) ∪ confirmed `bookings` expanded over `[preferred_date, checkout_date)`, counted per night vs `max_concurrent_setups`.
- `venue_availability` stores `admin` and `ical` rows; live booking occupancy is computed from `bookings` (not stored here — `source='booking'` rows were removed in `20260603_concurrent_setups.sql`).
- `booking_addons.requires_confirmation` tracks whether each add-on needs host sign-off.
