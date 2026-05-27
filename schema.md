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
| `is_active` | `bool` | |
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

## Table `booking_addons`
| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int4` | Primary |
| `booking_id` | `int4` | |
| `addon_id` | `int4` | |
| `quantity` | `int4` | |
| `price_at_booking` | `int4` | |
| `requires_confirmation` | `bool` | |
| `created_at` | `timestamptz` | Nullable |

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

- `venues.type` distinguishes self-managed venues from partner/Airbnb listings (`partner_bnb`).
- Availability for self-managed venues is derived from `bookings` — query for `venue_id` + `preferred_date` conflicts where `confirmed = true`.
- No separate blocked-dates table exists; host-side availability management is not yet implemented.
- `booking_addons.requires_confirmation` tracks whether each add-on needs host sign-off.
