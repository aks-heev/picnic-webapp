# Occasion Packages — Spec

**Status:** Planned, not yet implemented  
**Source:** Session analysis from "Occasion-based packages and add-ons" (historical bookings + live Supabase data)  
**Last updated:** 2026-06-29

---

## Background & Why

Historical booking notes (126 Gurugram bookings) showed that extras are already heavily sold — just offline over WhatsApp. 61% of bookings had a flowers or "others" cost line, meaning ₹180k+ of extras were delivered last year without ever hitting the website's add-on flow. **This is a capture problem, not a demand problem.**

The online add-on flow sees low attach rates because it presents ~13 items cold, with no occasion-aware curation. Customers default to picking nothing. Occasion packages fix this by pre-filling the cart when a customer selects their occasion — flipping the default effect.

### Real attach data (from booking notes, undercounted since only ~44% of rows had notes)

| Add-on | Attaches | Est. Annual Revenue |
|---|---|---|
| Cake | 16 | ₹17.6k |
| **Photographer** | **11** | **₹66k** |
| Photo Printouts | 10 | ₹5k |
| Extra Hour | 8 | ₹8.8k |
| Extra Flowers | 5 | — |
| Bonfire | 5 | — |
| Sip & Paint | 3 | ₹12k |

Photographer is the single biggest revenue add-on — nearly 4× the next item — and is sold entirely over WhatsApp today.

### Occasion mix (historical)

- **Birthday: ~41%** of all bookings
- **Proposal: ~28%** of all bookings  
- Anniversary, Bridal, Date Night, Baby Shower: ~8 bookings total in a year — single-digit noise

**Build two packages. Not nine.**

---

## Strategy

- **Occasion → pre-selected basket, full price, fully editable.** No "save ₹X" framing. Value prop is curation and trust: "we've done 200 proposals, here's what you'll need."
- **Don't bundle at a discount.** The customers who add extras already pay full price for them offline. Discount bundling hands money back to your best customers.
- **Good-better-best per occasion, default the middle.** The top tier is an anchor, not a sales target. It makes the middle feel modest.
- **Photographer is not a menu item for proposals** — it's the hero of the tier with a reason: "you propose once, don't trust it to a phone camera."

---

## Active Add-on Catalog (as of 2026-06-29)

| ID | Name | Price | Category | Instant Confirm? |
|---|---|---|---|---|
| 17 | Photo Printouts (10 Colored) | ₹500 | decor | ✅ |
| 26 | Bonfire | ₹500 | entertainment | ✅ |
| 20 | Extra Flowers | ₹1,100 | decor | ✅ |
| 21 | Extra Candles | ₹1,100 | decor | ✅ |
| 32 | Extra Hour | ₹1,100 | extension | ❌ needs confirmation |
| 24 | Cake | ₹1,100 | food | ✅ |
| 22 | Bouquet | ₹1,500 | decor | ✅ |
| 23 | Cold Pyros | ₹3,000 | decor | ✅ |
| 25 | Barbeque | ₹4,000 | food | ✅ |
| 27 | Skyshots | ₹4,000 | entertainment | ✅ |
| 28 | Sip & Paint | ₹4,000 | entertainment | ✅ |
| 29 | Movie Screening | ₹4,500 | entertainment | ❌ needs confirmation |
| 30 | Live Music | ₹6,000 | entertainment | ❌ needs confirmation |
| 19 | Photographer | ₹6,000 | photography | ✅ |

**Critical note:** Extra Hour, Movie Screening, and Live Music require confirmation. Any tier containing these can't show "Instantly Confirmed" — must show "Confirmed within 24 hours." Keep these out of default tiers.

---

## Homepage Package Tiers

Three named packages displayed on the homepage. Each has fixed setup inclusions and a flat per-booking price covering up to 6 guests. Above 6, ₹1,500 per additional person applies to all packages.

### Package 1 — The Setting
*"The perfect ambient foundation for any occasion."*

**Setup inclusions (no add-ons pre-included):**
- Teepee tent & umbrella (standard boho setup)
- Fresh flowers & arrangement (curated in-house)
- Wax candles + electric candles (both types)
- Bluetooth speaker
- Personalised message board (customer provides message at booking)
- Cutlery & essentials (plates, napkins, cutlery)

**Pricing:** ₹8,900 for up to 6 guests · +₹1,500 per person (7+)

**Pre-fill IDs:** `[]` (none)

---

### Package 2 — The Moment ⭐ (default / most popular)
*"The setup, plus the touches that make it feel like your occasion."*

**Inclusions:** Everything in The Setting, plus:

| Item | Add-on ID | Price |
|---|---|---|
| Bouquet | 22 | ₹1,500 |
| Cake | 24 | ₹1,100 |
| Photo printouts (10 coloured) | 17 | ₹500 |

**Pricing:** ₹12,900 for up to 6 guests · +₹1,500 per person (7+)

**Pre-fill IDs:** `[22, 24, 17]`

---

### Package 3 — The Story
*"The complete experience. Every detail handled, nothing left to chance."*

**Inclusions:** Everything in The Setting, plus:

| Item | Add-on ID | Price |
|---|---|---|
| Photographer (2 hours) | 19 | ₹6,000 |
| Skyshots (fireworks) | 27 | ₹4,000 |
| Cold pyros | 23 | ₹3,000 |
| Bouquet | 22 | ₹1,500 |
| Cake | 24 | ₹1,100 |
| Photo printouts (10 coloured) | 17 | ₹500 |

**Pricing:** ₹24,900 for up to 6 guests · +₹1,500 per person (7+)

**Pre-fill IDs:** `[19, 27, 23, 22, 24, 17]`

All items are `requires_confirmation = false` — booking is instant-confirmed.

---

## Occasion-based Pre-fill (Booking Form)

### 1. Proposal Package

**Target:** Occasion = "Proposal" · ~28% of bookings · 2 pax · lowest price sensitivity  
**Confirmation-safe:** All tiers below are instant-confirm (no `requires_confirmation` items)

| Tier | Items | Price | Default? |
|---|---|---|---|
| **Essentials** | Bouquet + Cold Pyros | ₹4,500 | — |
| **Capture** ⭐ | Photographer + Bouquet + Cold Pyros | ₹10,500 | **YES** |
| **Grand** | Photographer + Bouquet + Cold Pyros + Skyshots | ₹14,500 | — |

**UI framing for Capture tier (default):**  
*"You propose once. Don't trust it to a phone camera."*

**Cart pre-fill (Capture default):** IDs `[19, 22, 23]`

**What the Essentials tier is for:** Customers on a tight budget or who already have their own photographer. Let them deselect — don't hide it.

**What the Grand tier is for:** Anchor. Makes ₹10.5k feel modest. Skyshots (aerial drone) is the incremental item — appealing for outdoor venues.

---

### 2. Birthday Package

**Target:** Occasion = "Birthday" · ~41% of bookings · bimodal (2-person intimate vs 6-20 group)  
**Strategy:** Split into Intimate and Party tiers. Single birthday "package" doesn't fit both.

| Tier | Items | Price | Default? |
|---|---|---|---|
| **Just Cake** | Cake + Extra Candles + Photo Printouts | ₹2,700 | — |
| **Celebration** ⭐ | Cake + Extra Candles + Extra Flowers + Photo Printouts | ₹3,800 | **YES** |
| **Party** | Cake + Extra Candles + Extra Flowers + Photo Printouts + Bonfire + Barbeque | ₹8,300 | — |

**Cart pre-fill (Celebration default):** IDs `[24, 21, 20, 17]`

**Party tier note:** Barbeque (₹4k) is the big jump. Good anchor for group bookings but likely won't convert at solo/2-pax birthdays. Consider showing it with context: *"Feeding 6+ guests? Add a BBQ."*

**Extra Hour (id:32, ₹1,100):** High-attach (8 notes), near-zero COGS, but `requires_confirmation=true`. Don't include in a pre-filled tier. Show it as a standalone suggestion below the package with note: *"Most birthday groups end up staying — add an extra hour."*

---

### 3. Minor Occasions (no dedicated package — just a light pre-fill)

These occasions have ~1–2 bookings/month combined. Not worth full tier architecture. Pre-fill a simple basket and let them edit.

| Occasion | Pre-fill | IDs |
|---|---|---|
| Anniversary | Bouquet + Extra Flowers + Extra Candles + Photo Printouts | `[22, 20, 21, 17]` |
| Date Night | Bouquet + Bonfire | `[22, 26]` |
| Bridal Shower | Extra Flowers + Extra Candles + Photo Printouts + Bonfire | `[20, 21, 17, 26]` |
| Baby Shower | Cake + Extra Flowers + Photo Printouts | `[24, 20, 17]` |
| Other | (no pre-fill — show full menu) | — |

---

## Implementation Approach

### Option A — Frontend only (recommended first ship)

**No DB changes required.** Add a `OCCASION_PACKAGE_DEFAULTS` map in `app.js`:

```js
const OCCASION_PACKAGE_DEFAULTS = {
  'Proposal':       { defaultTier: 1, tiers: [
    { label: 'Essentials', ids: [22, 23] },
    { label: 'Capture ⭐', ids: [19, 22, 23] },  // default
    { label: 'Grand',     ids: [19, 22, 23, 27] },
  ]},
  'Birthday':       { defaultTier: 1, tiers: [
    { label: 'Just Cake',    ids: [24, 21, 17] },
    { label: 'Celebration ⭐', ids: [24, 21, 20, 17] },  // default
    { label: 'Party',        ids: [24, 21, 20, 17, 26, 25] },
  ]},
  'Anniversary':    { ids: [22, 20, 21, 17] },
  'Date Night':     { ids: [22, 26] },
  'Bridal Shower':  { ids: [20, 21, 17, 26] },
  'Baby Shower':    { ids: [24, 20, 17] },
};
```

**Trigger point:** When the occasion `<select>` changes in the booking form, call `applyOccasionPackageDefaults(occasion)` → sets the pre-ticked add-ons. User can freely edit from there.

**UX:** Show a short framing line above the add-on grid when a package pre-fills: *"We've set up the essentials for a [Proposal]. Change anything."*

For occasions with tiers (Proposal/Birthday), show 3 pill tabs above the add-on grid (Essentials / Capture / Party etc.) — clicking a pill re-fills the checkboxes to that tier's IDs. Still fully editable after picking a tier.

### Option B — DB-backed packages (follow-up, not MVP)

Add a `packages` table for admin-manageable package definitions. Useful once you want the admin to edit packages without a deploy.

```sql
CREATE TABLE packages (
  id           serial PRIMARY KEY,
  occasion     text NOT NULL,
  tier_index   int  NOT NULL DEFAULT 0,
  label        text NOT NULL,
  is_default   boolean NOT NULL DEFAULT false,
  add_on_ids   int[] NOT NULL,
  framing_copy text
);
```

---

## Confirmation-safety rules

Before including any add-on in a package default, check `requires_confirmation`:

- `requires_confirmation = false` → safe for any tier, instant-confirm booking unaffected
- `requires_confirmation = true` → **do not pre-fill**; show as optional suggestion below the package with a "⏱ confirmed within 24 hrs" badge

Current `requires_confirmation = true` items: **Extra Hour (32), Movie Screening (29), Live Music (30)**

---

## What This Doesn't Change

- Pricing logic: `compute_booking_total` RPC already handles add-on IDs — no change needed
- Booking confirmation flow: unchanged
- Admin edit modal: the add-on diff on save already handles pre-filled vs custom selections
- The add-on catalog itself: no new add-ons needed for MVP

---

## Open Questions Before Build

1. **Are the extras in booking notes charged to the customer or absorbed into base price?** If absorbed = this is a margin-recovery project. If charged offline = it's a capture/convenience play. Changes the GTM framing.
2. **Does Photographer (id:19) require ops coordination?** It's `requires_confirmation=false` in DB — is that accurate? A third-party photographer needs to be available.
3. **Which venue types get packages?** Likely: `cafe` and `self_managed`. Combo/partner_bnb bookings are query leads (no add-on flow today).
4. **Should tier selection persist if the user changes their occasion?** Probably reset to default tier on occasion change.

---

## Metrics to Watch After Ship

- **Zero add-on rate** (currently ~65% online, believed to be a measurement artifact) — directional drop is the signal
- **Photographer attach rate online** — should climb from ~3 Supabase bookings toward the 11-offline baseline
- **AOV on proposal bookings** — target: +₹6k average (one Photographer attach per proposal booking)
- **Time in add-on step** — if pre-fill works, should drop (less deliberation needed)
