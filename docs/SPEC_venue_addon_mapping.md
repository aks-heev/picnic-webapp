# Build Spec — Per-Venue Add-On Mapping

**Goal:** Move add-on availability from venue *type* to specific *venue*. Today an add-on is shown for all venues of a type (`add_ons.available_for text[]`). After this change, availability is decided per venue via a junction table. Pure show/hide — **no per-venue pricing, no per-venue confirmation logic.**

**Status:** Spec only. Nothing built. DB + code changes all pending.

---

## 1. Decisions locked (from brainstorm)

- **Show/hide only.** No price override per venue. `add_ons.price` stays global. → junction needs no price column.
- **Venue-specific, not setting-specific.** The hide decisions don't cluster by outdoor/indoor, so a `setting`-based axis is insufficient. Full junction is justified.
- **Single source of truth.** Presence of a `(venue_id, addon_id)` row = the add-on shows at that venue. No type-default-plus-override hybrid — what's in the table is what shows.
- **Inheritance becomes a seeding action, not a runtime rule.** New venues don't fall back to type defaults at query time; instead an admin "prefill from type" action seeds rows once, then you edit them.

---

## 2. Data model

### New table

```sql
create table public.venue_add_ons (
  venue_id  bigint  not null references public.venues(id) on delete cascade,
  addon_id  integer not null references public.add_ons(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (venue_id, addon_id)
);

create index on public.venue_add_ons (addon_id);
```

Presence = visible. No `is_active`, no `price`, no `requires_confirmation` — none are needed for show/hide-only. (If a "needs confirmation only at this venue" case ever appears, add a `requires_confirmation boolean` column then, not now.)

RLS: match the existing `add_ons` policy (public read of active data, writes via service role / authenticated admin). Mirror whatever `add_ons` currently uses.

### Columns being retired

- `add_ons.available_for` — **keep the column for now**, stop reading it (see §5). Removing it is a separate cleanup once the junction is verified live. Don't drop in the same migration.
- `add_ons.requires_confirmation_for` — **dead already** (no read site references it). Safe to drop, but out of scope; leave it and note it for cleanup.

Confirmation continues to come from the two existing booleans: `add_ons.requires_confirmation` OR `venues.requires_confirmation`. Unchanged.

---

## 3. Migration / seeding

Seed the junction so day-one behaviour is identical to today: every active venue gets the add-ons its type currently inherits.

```sql
insert into public.venue_add_ons (venue_id, addon_id)
select v.id, a.id
from public.venues v
join public.add_ons a
  on a.is_active = true
 and v.type = any (a.available_for)
where v.is_active = true
on conflict do nothing;
```

### ⚠️ Manual call-out: the `combo` venue gets nothing

Terracottage Sienna (id 17, `type='combo'`) inherits **zero** add-ons today — no add-on lists `combo` in `available_for`. The seed above will leave it empty, preserving an existing silent gap. **Do NOT fix this by changing Sienna's type** — `combo` is load-bearing (whole-floor parent of Umber 15 + Ochre 16; drives availability fanout, request-only booking, and the Hold→Confirm child-blocking in `app.js`). Changing it to `self_managed` would instant-lock the whole floor with no child fanout = real double-bookings.

Instead, hand-seed Sienna's add-ons to mirror the active `self_managed` set its children offer:

```sql
-- Sienna (whole floor) = union of children's add-ons (both self_managed, identical sets)
insert into public.venue_add_ons (venue_id, addon_id)
values (17,17),(17,19),(17,20),(17,21),(17,22),(17,24),(17,28),(17,29)
on conflict do nothing;
-- 17 Photo Printouts · 19 Photographer · 20 Extra Flowers · 21 Extra Candles
-- 22 Bouquet · 24 Cake · 28 Sip & Paint · 29 Movie Screening
```

Revisit if stay-friendly premium add-ons are ever added — a full-floor takeover could justify more than the per-room set, but today every non-`self_managed` active add-on is cafe-only.

Only active venues are seeded (avoids ~hundreds of dead rows for the stale/duplicate inactive venues). Reactivating a venue later → use the admin prefill action (§4) to seed it.

---

## 4. Admin UX

Orient the editing around the **venue**, not the add-on. When setting up a venue you ask "which add-ons does this place offer?" — a checklist, not a per-add-on venue picker.

In the venue form (`admin.html` `vf-*` fields + `openVenueForm`/`saveVenue` in `app.js`):

- Add a **"Add-ons offered here"** fieldset: one checkbox per active add-on, checked = mapped.
- Populate checked-state from `venue_add_ons` when the form opens (`populateVenueForm`).
- On save: diff against current rows and insert/delete in `venue_add_ons` (or simplest: delete-all-for-venue then insert checked set, in one call).
- **"Prefill from type"** button: checks the add-ons whose `available_for` includes this venue's type. This is the only place type-inheritance survives — as a convenience, not runtime logic. Lets new venues skip the blank slate.

The existing add-on form's "Available for" venue-type checkboxes (`app.js` ~4103–4108, 4174, 4186, 4221–4236) become vestigial. Leave them functional but they no longer drive availability. Optional: relabel to "Default types (used by Prefill)" so it's clear they only seed, or hide them. Don't delete the wiring in this pass.

---

## 5. Read-site changes (the part that must not be half-done)

All availability filtering is in **one function**, `loadVenueAddOns`, called 3×. The DB mapping is meaningless until these switch from type to venue id.

**`app.js:131` — change the filter:**

```js
// before
async function loadVenueAddOns(venueType) {
  const { data, error } = await supabase
    .from('add_ons')
    .select('*')
    .eq('is_active', true)
    .contains('available_for', [venueType])
    .order('sort_order')
  ...
}

// after — filter by venue via junction
async function loadVenueAddOns(venueId) {
  const { data, error } = await supabase
    .from('add_ons')
    .select('*, venue_add_ons!inner(venue_id)')
    .eq('is_active', true)
    .eq('venue_add_ons.venue_id', venueId)
    .order('sort_order')
  ...
}
```

**Update the 3 call sites** to pass `venue.id` instead of `venue.type`:
- `app.js:585` `loadVenueAddOns(venue.type)` → `loadVenueAddOns(venue.id)`
- `app.js:607` (inside a `Promise.all`) `loadVenueAddOns(venue.type)` → `loadVenueAddOns(venue.id)`
- `app.js:1778` `loadVenueAddOns(venue.type)` → `loadVenueAddOns(venue.id)`

Verify the embedded-join syntax against the PostgREST version in use; if the `!inner` embed is awkward, the fallback is a two-step query (fetch `addon_id`s from `venue_add_ons` for the venue, then `add_ons.in(id, …)`).

**No edge-function changes.** `_shared/addons.ts` reads `booking_add_ons` (chosen add-ons on a booking), not availability. `notify-booking-*` unaffected. Confirmed by grep.

**RPC `submit_booking_intent`:** currently inserts whatever add-ons the client submits without checking availability. Out of scope for show/hide, but optional hardening — reject add-ons not mapped to the booking's venue. Note it; don't build unless wanted.

---

## 6. Build order

1. Migration: create `venue_add_ons`, RLS, seed from `available_for × type` (active venues).
2. Insert Sienna (id 17) rows manually per decision above.
3. `app.js`: switch `loadVenueAddOns` to venue-id + junction; update 3 call sites.
4. Admin venue form: checklist + populate + save-diff + "Prefill from type" button.
5. Verify: pick one venue, uncheck an add-on, confirm it disappears from that venue's booking screen and stays on others. Confirm a brand-new venue starts empty and Prefill seeds it.
6. (Later, separate commit) drop `available_for` / `requires_confirmation_for` once stable.

## 7. Risks / watch-items

- **Half-migration** is the main failure mode: DB mapping live but `loadVenueAddOns` still type-filtering, or vice versa. Steps 1 and 3 must ship together.
- **PostgREST embed syntax** — validate the `!inner` join works on this project before committing; have the two-query fallback ready.
- **Stale duplicate venues** in the table (e.g. two "Lakeside Lawn", two "Villa Aradhya") are inactive and excluded by the seed `where is_active = true`. Don't seed them.
- Per the repo rule: `app.js` is 6,000+ lines — edit via file tools only, never bash. Don't commit without explicit go-ahead.
