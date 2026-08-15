# Print Content Sheet — FROZEN 2026-07-11

Authoritative content for the three print pieces (booklet, cafe one-pager, Airbnb card).
Source of truth: live Supabase (`venue_packages`, `packages`, `add_ons`, `venues`) queried 2026-07-11, plus decisions locked with Aksheev the same day.
Re-run the proof SQL (§8) before every print run.

## 1. Decisions locked

- Tier prices in print follow the **intended** prices (flyer values), NOT the current seed values — ⚠️ gated on the `venue_packages` update in §2 shipping first.
- Add-on naming: **"Skyshots (fireworks)"** everywhere; never plain "Fireworks".
- Hot Air Balloon and Polaroid Pictures: **dropped from print** (inactive in system).
- Venue naming: **TerraCottage Ochre / Umber / Sienna** (matches Airbnb listings). Remove stray "The Nook"/"The Gathering" references from venue descriptions.
- Packages hosted at **all venues** via WhatsApp/ops (online booking currently Beige + Castle Valley) — print does not restrict.
- Occasion packages (Date Night / Movie Night ×2): **NOT in print** (decided 2026-07-11, revisit later). Print carries the 4 universal tiers only.

## 2. ⚠️ Pre-distribution blocker — DB price alignment

Live `venue_packages` still holds the 07-10 seed (Moment 12,000 / Story 25,000; CV 13,000 / 26,000). Intended prices per Aksheev 2026-07-11 = print prices below. Until updated, the site charges MORE than print promises for The Story. Update (Beige confirmed; **Castle Valley cells need Aksheev's numbers** — 13,900 / 25,900 if the +1,000 pattern holds):

```sql
-- run only with explicit go-ahead; then re-run §8 proof
update venue_packages set price = 12900, updated_at = now() where venue_id = 14 and package_id = 2; -- moment @ Beige
update venue_packages set price = 24900, updated_at = now() where venue_id = 14 and package_id = 3; -- story @ Beige
-- Castle Valley (package_id 2,3 @ venue_id 19): values TBC by Aksheev
```

## 3. Packages (print copy)

Price line pattern: **"from ₹X · up to N guests"** + one shared footnote: *"₹2,000 per extra guest beyond 6. Food & beverages not included unless listed."*

| # | Package | Print price | Guests | Tagline (DB) |
|---|---|---|---|---|
| 0 | The Prelude — STARTER | from ₹5,900 | up to 4 (hard cap, no overage) · **at Beige Cafe** | An intimate little world for up to four. |
| 1 | The Setting — ESSENTIALS | from ₹8,900 | up to 6 | The signature setup, beautifully done. |
| 2 | The Moment — ★ MOST POPULAR | from ₹12,900 ⚠️§2 | up to 6 | Bouquet, cake and printed memories. |
| 3 | The Story — PREMIUM | from ₹24,900 ⚠️§2 | up to 6 | The full production — photographer and more. |
Occasion packages excluded from print per §1. (For reference if revisited: Date Night 10,900 / Deluxe 13,900 · Movie Night 13,900 / Deluxe 17,900.)

**Inclusions**

- **The Prelude** (DB free-text; does NOT chain the ladder): Cozy macramé tent setup · Ambient fairy lighting · Curated lamps & floor seating · Perfect for 2–4 guests. Plus: Dedicated host support.
- **The Setting** (base list, from current site copy — not DB): Fresh Fruits · Flower decor · Candles & Lamps · Crockery & cutlery · Bluetooth speaker · Macrame Tent · Message board · Dedicated host support.
- **The Moment** = The Setting + (DB bundle): Cake · Bouquet · Photo Printouts (10 pics).
- **The Story** = The Moment + (DB bundle): Photographer · **Skyshots (fireworks)** · Cold Pyros.
- **Date Night** = The Setting + Bouquet · Bonfire. **Deluxe** adds Cold Pyros.
- **Movie Night** = The Setting + Movie Screening · Bonfire. **Deluxe** adds Barbeque.

## 4. Add-Ons Menu (active only — verified 2026-07-11)

Header line: *"Any add-on can be layered onto any tier. Some add-ons vary by venue — Skyshots and Movie Screening on request."*

| Add-On | Price |
|---|---|
| Bonfire (charcoal pit) | ₹500 |
| Photo Printouts (10 pics) | ₹500 |
| Extra Flowers | ₹1,100 |
| Extra Candles | ₹1,100 |
| Extra Hour | ₹1,100 |
| Cake | ₹1,100 |
| Bouquet | ₹1,500 |
| Cold Pyros | ₹3,000 |
| Skyshots (fireworks) | ₹4,000 |
| Barbeque | ₹4,000 |
| Sip & Paint | ₹4,000 |
| Movie Screening | ₹4,500 |
| Live Music | ₹6,000 |
| Photographer | ₹6,000 |

REMOVED vs old flyer: Polaroid Pictures ₹1,100, Hot Air Balloon ₹7,000 (both inactive in system).

## 5. Venues (all prices verified against `venues.base_price` 2026-07-11 — every one matched the old flyer)

**Gurugram & Delhi NCR**
| Venue | Tags | Area | From |
|---|---|---|---|
| Beige Cafe | Outdoor · Cafe | Leopard Trail, Gurugram | ₹8,900 |
| Countryside Offgrid | Outdoor · Nature · subject to availability | Leopard Trail, Gurugram | ₹9,900 |
| The Sunroom | Outdoor · Cafe · subject to availability | Palam Farms, Delhi | ₹13,900 |
| TerraCottage Ochre | Indoor · All-weather · Setup with stay | DLF Phase 2, Gurugram | ₹9,800 |
| TerraCottage Umber | Indoor · All-weather · Setup with stay | DLF Phase 2, Gurugram | ₹10,900 |
| TerraCottage Sienna | Indoor · All-weather · Setup with stay | DLF Phase 2, Gurugram | ₹18,900 |

Description fixes: Umber's description must not say "The Gathering"; Sienna's reads "Ochre and Umber combined — a full floor with terrace, for bigger celebrations."

**Jaipur**
| Venue | Tags | Area | From |
|---|---|---|---|
| Castle Valley | Outdoor · Restaurant | Amer, Jaipur | ₹9,900 |
| House of Amer | Heritage · Stay available | Amer, Jaipur | ₹9,900 |
| Om Niwas Suite Hotel | Heritage hotel · Stay available | Bani Park, Jaipur | ₹12,900 |
| Once Upon A Time at The Bagh | Heritage · Garden | Vidyadhar Ji Ka Bagh, Jaipur | ₹15,900 |

Plus the "your own spot" line: *"Have your own spot in mind? A backyard, rooftop, or a place that means something — we'll bring the picnic to you."*

## 6. Fixed copy blocks

- Time slots: Morning 9:00–11:00 AM · Sunset 5:30–8:00 PM · Custom on request.
- Contact: www.picnicstories.com · +91 97737-03982 (Gurugram) · +91 92669-64666 (Jaipur) · @the.picnic.stories · Open every day.
- Legal footer (every page): *"Prices subject to confirmation."* F&B line moves up next to prices (§3 footnote), not footer-only.
- CTA (verb-first, one per piece): **"Scan to plan your picnic on WhatsApp"**.
- Airbnb card headline: **"You're already here. Add a picnic to your stay tonight."** — no venue directory on this piece.

## 7. QR / attribution matrix

| Piece | WhatsApp QR (prefilled) | Site QR |
|---|---|---|
| Cafe flyer | wa.me/919773703982 (GGN) / wa.me/919266964666 (JPR): "Hi! Saw your flyer at a cafe — I'd like to plan a picnic." | picnicstories.com/?utm_source=flyer-cafe |
| Airbnb card | wa.me/919773703982: "Hi! I'm staying at TerraCottage — can I add a picnic to my stay?" | picnicstories.com/?utm_source=flyer-airbnb |
| Booklet | per-city wa.me: "Hi! Found your packages guide — I'd like to plan a picnic." | picnicstories.com/?utm_source=booklet |

## 8. Reprint proof SQL (run before every print run)

```sql
-- tier prices + guest rules (print must match)
select v.name, p.name, vp.price, vp.included_guests, vp.overage_per_person, vp.max_guests
from venue_packages vp join venues v on v.id=vp.venue_id join packages p on p.id=vp.package_id
where vp.is_active order by v.id, p.sort_order;
-- active add-ons (print must list exactly these, minus deliberate drops)
select name, price from add_ons where is_active order by price, name;
-- venue from-prices
select name, city, base_price from venues where is_active order by city, sort_order;
```

## 9. Photos

12 unique print-grade images extracted from "Packages (1).pdf" (session outputs `pdf-photos/`): 1 background texture (1650×2850), 5 singles (1122×1402 ≈ 200–490ppi), 1 tall single (704×1140), 5 flattened collages (1441×1018–1153). At A5 placement sizes all exceed 300dpi effective. Originals preferred where handy; never upscale.
