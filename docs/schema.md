# Picnic Webapp — Supabase Database Schema

> Regenerated from the live database (project `evmftrogyzoudiccqkya`) on **2026-07-06**.
> All tables have RLS enabled. If this file disagrees with the live DB, the DB wins —
> regenerate via the Supabase MCP `list_tables` rather than editing by hand.

## Table `venues` (25 rows)

| Name | Type | Constraints / Notes |
|------|------|---------------------|
| `id` | `int8` | PK, identity |
| `name` | `text` | |
| `type` | `text` | CHECK: `self_managed \| partner_bnb \| custom \| cafe \| combo` |
| `description` | `text` | nullable |
| `area` | `text` | nullable |
| `city` | `text` | default `'Jaipur'` |
| `capacity_min` / `capacity_max` | `int4` | nullable; min ≥ 1 |
| `base_price` | `numeric` | nullable, ≥ 0 |
| `images` | `jsonb` | default `[]` — array of `{url, alt}` |
| `external_url` | `text` | nullable |
| `is_active` | `bool` | default true |
| `metadata` | `jsonb` | nullable — `tiers` (partner_bnb stepped pricing), `overage_per_person` (legacy), `stay_price_per_night`, `includes`, `food_offline`, `food_multiplier`/`drink_multiplier` (retained, banner hidden via `food_offline`) |
| `max_concurrent_setups` | `int4` | default 1 |
| `airbnb_ical_url` | `text` | nullable — set = iCal sync enabled for this venue |
| `last_ical_sync_at` / `last_ical_sync_status` | `timestamptz` / `text` | sync health, shown in admin |
| `parent_venue_id` | `int8` | nullable, FK → `venues.id` — child room → combo parent (Umber 15 / Ochre 16 → Sienna 17) |
| `maps_url` | `text` | nullable |
| `sort_order` | `int4` | nullable |
| `setting` | `text` | CHECK `indoor \| outdoor`, nullable — home-gallery grouping, decoupled from `type` |
| `requires_confirmation` | `bool` | default false |
| `menu_pages` | `jsonb` | default `[]` |
| `team_id` | `int4` | nullable, FK → `teams.id` |
| `slug` | `text` | nullable — permanent URL slug for `/venues/<slug>` (do not regenerate on rename) |
| `packages_enabled` | `bool` | default false — per-venue toggle for the packages flow (cafe only); `?packages=1/0` QA override |
| `free_guests_upto` | `int4` | nullable — cafe flat pricing: `base_price` flat through this count (set on the 6 cafes) |
| `overage_per_person` | `numeric` | nullable — promoted column (was metadata-only); per-person past `free_guests_upto` |

Cafe pricing: `base_price` + `free_guests_upto` + `overage_per_person` (flat path in `getVenuePrice()` / `compute_booking_total`). `partner_bnb` still uses `metadata.tiers`. Venues without `free_guests_upto` fall through to the legacy tiers path.

## Table `bookings` (15 rows)

| Name | Type | Constraints / Notes |
|------|------|---------------------|
| `id` | `int8` | PK, identity |
| `full_name` / `mobile_number` / `email_address` | `text` | |
| `guest_count` | `int4` | CHECK 1–20 |
| `children_count` | `int4` | default 0 — children under 10, free, excluded from pricing |
| `preferred_date` | `date` | check-in for stays |
| `checkout_date` | `date` | nullable — BnB checkout; NULL = picnic-only booking |
| `time_slot` | `text` | nullable — cafe slot `morning \| afternoon \| evening` |
| `occasion` | `text` | nullable — guest-selected occasion or free text |
| `board` | `jsonb` | nullable — `{"type":"black"\|"white","message":"..."}` |
| `special_requirements` | `text` | nullable |
| `confirmed` | `bool` | default false |
| `customer_intent` | `text` | default `'query'`, CHECK `lock \| query` |
| `query_status` | `text` | default `'new'`, CHECK `new \| in_talk \| quoted \| no_reply \| lost` — lead pipeline; ignored once confirmed |
| `held_at` | `timestamptz` | nullable — combo Hold state (`held_at` set + `confirmed=false` = held) |
| `hold_status` / `hold_checked_at` / `hold_conflict_dates` | `text` / `timestamptz` / `text[]` | nullable — hold ripeness check (`clear \| ripe \| conflict`) |
| `advance_amount` | `numeric` | default 0, ≥ 0 — **server-computed** via `compute_booking_advance` (client value ignored) |
| `total_amount` | `numeric` | nullable |
| `razorpay_order_id` / `razorpay_payment_id` / `razorpay_signature` | `text` | nullable — payment binding; order id written at create-order, verified in verify-payment/webhook |
| `payment_status` | `text` | default `'pending'`, CHECK `pending \| paid \| failed` — `paid` only after server-side signature verification |
| `venue_id` | `int8` | nullable, FK → `venues.id` |
| `venue_address` | `text` | nullable — custom-venue address |
| `external_booking_ref` | `text` | nullable |
| `created_at` | `timestamptz` | default now() |

Note: bookings store the **advance** (and optionally `total_amount`); add-on detail lives in `booking_add_ons`.

## Table `venue_availability` (139 rows)

| Name | Type | Constraints / Notes |
|------|------|---------------------|
| `id` | `int8` | PK, identity |
| `venue_id` | `int8` | FK → `venues.id` |
| `date` | `date` | |
| `status` | `text` | CHECK `blocked \| booked` |
| `source` | `text` | CHECK `admin \| booking \| ical \| parent` — `admin` = manual block; `ical` = imported from Airbnb (sync-owned, read-only in admin); `parent` = combo-booking fanout onto children (`booking_id` set, cascades on delete); `booking` legacy (rows deleted 2026-06-03) |
| `booking_id` | `int8` | nullable, FK → `bookings.id` (ON DELETE CASCADE) |
| `time_slot` | `text` | nullable, CHECK `morning \| afternoon \| evening` — NULL = full-day |

Partial unique indexes scoped per source (`admin` full-day, `admin` slot, `ical`). Availability for self_managed/combo is computed in-app: admin ∪ ical ∪ parent blocks ∪ confirmed bookings vs `max_concurrent_setups`; combo (Sienna) = intersection of children.

## Table `add_ons` (32 rows)

| Name | Type | Constraints / Notes |
|------|------|---------------------|
| `id` | `int4` | PK |
| `name` / `description` | `text` | |
| `price` | `int4` | global price (no per-venue override) |
| `category` | `text` | default `'extra'` (decor/food/entertainment/photography/extension) |
| `available_for` | `text[]` | ⚠️ **vestigial** — availability now comes from `venue_add_ons`; only used by the admin "Prefill from type" seeding action. Cleanup candidate. |
| `requires_confirmation_for` | `text[]` | ⚠️ dead column, cleanup candidate |
| `requires_confirmation` | `bool` | default false — gated add-ons: 29 Movie Screening, 30 Live Music, 32 Extra Hour |
| `is_active` | `bool` | default true |
| `sort_order` | `int4` | default 0 |
| `image_url` | `text` | nullable |

## Table `venue_add_ons` (129 rows) — junction, presence = add-on offered at venue

| Name | Type | Notes |
|------|------|-------|
| `venue_id` | `int8` | PK part, FK → `venues.id` |
| `addon_id` | `int4` | PK part, FK → `add_ons.id` |
| `created_at` | `timestamptz` | |

Single source of truth for add-on visibility per venue (`loadVenueAddOns` filters via this junction). Known gap: venue 21 lacks addon 27 (Skyshots) — deliberate-or-not unconfirmed.

## Table `packages` (7 rows) + `package_add_ons` (19 rows)

| Name | Type | Constraints / Notes |
|------|------|---------------------|
| `id` | `int8` | PK, identity |
| `key` | `text` | unique — `setting`, `moment`, `story`, `date_night_classic/deluxe`, `movie_night_classic/deluxe` |
| `name` / `tagline` | `text` | |
| `occasion` | `text` | nullable — NULL = universal tier; set = replaces the universal ladder for that occasion (Date Night, Movie Night) |
| `is_featured` / `is_active` | `bool` | |
| `sort_order` | `int4` | |
| `images` | `jsonb` | default `[]` — card carousel images (`package-images` storage bucket) |
| `created_at` / `updated_at` | `timestamptz` | |

`package_add_ons(package_id, addon_id, sort_order)` — a package's locked add-on bundle. Package price is always **derived** (venue base + add-on catalog prices), never stored. Required-addon gating: a package is hidden at venues whose catalog can't serve its add-ons (`packageServiceableAt`).

## Table `booking_add_ons` (18 rows)

`id` PK · `booking_id` FK → bookings · `addon_id` FK → add_ons (nullable) · `name` text · `price_at_booking` numeric · `requires_confirmation` bool · `created_at`. Written inside `submit_booking_intent` (same txn as the booking). No quantity column.

## Table `menu_links` (0 rows) / `orders` (0 rows)

`menu_links`: `id` PK · `booking_id` FK · `max_food_items` (1–15) · `max_bev_items` (1–10) · `token` uuid · `created_at`. Customer menu-selection links (T4 email).
`orders`: `id` PK · `menu_link_id` FK · `booking_id` FK · `selected_items` jsonb · `created_at`.

## Table `teams` (2 rows)

`id` PK · `name` · `city` (unique) · `whatsapp` · `phone` · `contact_email` · `display_address` · `created_at`. Per-city contact info (Jaipur / Gurugram), rendered in the footer; venues link via `team_id`.

## Table `site_settings` (4 rows)

`key` text PK · `value` text · `updated_at`. Keys include `packages_hero_image_url` (arch-hero photo on /packages) and hero-image settings.

## Key RPCs (SECURITY DEFINER)

- `submit_booking_intent(...)` — inserts booking + `booking_add_ons` in one txn; **ignores client advance**, computes it via `compute_booking_advance`.
- `compute_booking_total(venue, guests, children, addon_ids, slot)` — authoritative price; used by tier cards and the booking form.
- `compute_booking_advance(venue_id, billing_guests, nights, addon_ids)` — server-authoritative 50% advance.
- `get_my_bookings()` — phone-OTP My Bookings; matches JWT phone to `bookings.mobile_number` on last-10-digits.
- `replace_ical_blocks(venue_id, dates[])` / parent variant — atomic iCal reconcile (sync-ical).

## Edge functions (deployed; source of truth = deployed version, use `get_edge_function`)

`notify-booking-received` (v27) · `notify-booking-confirmed` (v20) · `notify-menu-link` (v8) · `notify-order-received` (v8) · `export-ical` (v11, public) · `sync-ical` (v10, JWT) · `create-order` (v10) · `verify-payment` (v8) · `razorpay-webhook` (v4, public, HMAC-authed) · `post-event-nudge` (v1)

## Storage buckets

`venue-images` · `addon-images` · `site-images` · `package-images` — public read, authenticated write. (Venue menu pages live in the `venues.menu_pages` jsonb column, not a bucket.)
