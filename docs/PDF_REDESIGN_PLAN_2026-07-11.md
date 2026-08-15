# Packages PDF Redesign Plan — 2026-07-11

**Goal:** Replace `The Picnic Stories - Packages.pdf` with three print-ready pieces built in Claude design, with every number verifiable against the live DB and every copy scannable/trackable.

**Done means:** (1) booklet + cafe one-pager + Airbnb card exported print-ready AND digital-ready, (2) every price/inclusion matches the live Supabase DB on proof day, (3) each piece carries a scannable QR whose traffic is attributable in PostHog, (4) one physical test print approved before any volume run.

**Decisions locked (2026-07-11):**
- Scope: fix the 10-page booklet (in-room lookbook) + new 1-page cafe flyer + new Airbnb in-room card.
- The Prelude stays at ₹5,900 (confirmed bookable) — but print copy must state where/how it applies, since listed venue floors start at ₹8,900 and its DB tagline caps it at 4 guests.
- Hot Air Balloon and Polaroid Pictures dropped from print (inactive in system).

---

## Phase 0 — Content lock (blocker for everything else)

Source of truth is the live DB, not the old PDF.

1. **Generate a content sheet from Supabase** (packages, package_add_ons, active add_ons only, packages-enabled venues with from-prices). Keep the SQL — it gets re-run before every future reprint.
2. **Resolve naming conflicts (one term everywhere):**
   - "Fireworks" (flyer, The Story) vs "Skyshots" (system + flyer's own add-on menu). Pick one.
   - "TerraCottage Ochre/Umber/Sienna" vs "The Nook/The Gathering" — use whatever name the Airbnb listings actually show, since guests only know that name.
3. **Guest-count baseline per tier.** Prelude = up to 4 (per DB tagline). Confirm what Setting/Moment/Story prices cover (flat-to-6 + overage per current pricing) and fix the wording: "from ₹X · up to N guests".
4. **Prelude placement line.** One sentence stating where ₹5,900 applies, so it doesn't read as bait-and-switch against ₹8,900 venue floors.
5. **Decide: occasion packages in print?** Date Night (Classic/Deluxe) and Movie Night (Classic/Deluxe) exist in the system but are absent from the flyer. Include, or deliberately keep print to the universal ladder. (Open — user call.)
6. **Photo asset audit.** Resolved 2026-07-11: the high-quality PDF ("Packages (1).pdf", 43.7MB) embeds photos at ~200–490 ppi at its oversized 216×373mm page — extracting these (`pdfimages -all`) and placing them at A5 sizes yields ≥300dpi effective. Originals preferred if handy, but no longer a blocker. Never upscale — shrink the image box instead.

**Exit condition:** a frozen content sheet + approved photo list. No design work starts before this.

## Phase 1 — Copy pass (per design:ux-copy)

Element-by-element, preserving the existing warm boho voice:

- **Price lines:** standardize to "from ₹X · up to N guests" on every tier and venue card.
- **F&B disclaimer:** promote from micro-footer to a visible note near the prices. Reword: "Food & beverages not included unless listed." Clarify Fresh Fruits (included) vs cafe menu (not) — at a cafe, readers will assume food.
- **CTA:** one verb-first action per piece: "Scan to plan your picnic on WhatsApp." Per-city QR replaces the two raw phone numbers as the primary action (numbers stay in the footer).
- **Add-ons menu:** drop Hot Air Balloon + Polaroid. Add one qualifier line: "Some add-ons vary by venue — Skyshots and Movie Screening on request."
- **The Story inclusions:** align with DB (Photographer, Skyshots, Cold Pyros, Bouquet, Cake, Photo Printouts) using the resolved names.
- **Airbnb card:** stay-upsell framing — "You're already here. Add a picnic to your stay tonight." No venue directory (a guest seeing their own accommodation listed 'from ₹10,900' reads it as paying twice).
- **Cafe flyer:** 5-second hierarchy — one hero line, hero photo, 3-tier price ladder, QR. Nothing else.
- Keep: "Prices subject to confirmation" legal line, "subject to availability" tags, per-page contact footer (booklet).

## Phase 2 — Design spec (per design:design-critique)

- **Formats (ISO ratio, fixing the current 1:1.73 mobile-shaped pages):**
  - Booklet: A5 (148×210mm), saddle-stitch — page count must be a multiple of 4; target 8pp by merging the two theme pages.
  - Cafe flyer: A5, double-sided, 300gsm card.
  - Airbnb card: DL or A6, 350gsm or laminated.
- **Print specs:** +3mm bleed all sides, 5mm inner safe margin, images 300dpi at placed size, body text ≥9pt, CMYK-safe check on the palette (teal/gold/cream fine; verify the blush pinks don't shift).
- **QR/attribution matrix** (the piece is worthless untracked):
  | Piece | WhatsApp QR | Site QR |
  |---|---|---|
  | Cafe flyer | wa.me per city, prefilled "Hi! Saw your flyer at a cafe…" | `picnicstories.com/?utm_source=flyer-cafe` |
  | Airbnb card | wa.me Gurugram, prefilled "Hi! I'm staying at [property]…" | `?utm_source=flyer-airbnb` |
  | Booklet | wa.me per city, prefilled "Hi! Found your packages guide…" | `?utm_source=booklet` |
- **Hierarchy keeps what works:** tier ladder with The Moment as "Most Popular" anchor, brand doodles, theme palettes as social proof.

## Phase 3 — Build in Claude design

- Build all three pieces in Claude design from the frozen content sheet + Phase 1 copy + Phase 2 spec.
- **Two exports per piece:**
  - Print: bleed + crop marks, 300dpi, no interactive elements.
  - Digital (WhatsApp-shareable): RGB, compressed, tappable wa.me links — and selectable/searchable text, which the current PDF's garbled font embedding breaks.

## Phase 4 — Verification gate (before any print spend)

1. **Price proof:** re-run the Phase 0 SQL, cross-check every printed number and inclusion list. Any mismatch = fix and re-proof.
2. **Physical test print, one copy per piece, at final size:** legibility of 9pt text, photo sharpness, color shift.
3. **QR test from paper** at arm's length and in dim cafe lighting; confirm WhatsApp prefill text and that UTM visits land in PostHog with the right `utm_source`.
4. Fresh-eyes read of both disclaimers by someone who hasn't seen the drafts.

**Gate:** all four pass, or no volume printing.

## Phase 5 — Production & measurement

- **First run small:** ~100 cafe flyers, ~20 booklets, ~10 Airbnb cards. Reprint volume is a data decision, not an optimism decision.
- **Measure weekly in PostHog:** sessions by `utm_source`; WhatsApp messages self-identify source via prefill text. Success signal: any tracked scan→WhatsApp lead within 30 days of distribution.
- **Standing rule:** re-run the price proof (Phase 4.1) before every reprint — the DB drifts.

## Risks & mitigations

- **Prices change after printing** → keep the "subject to confirmation" line; keep the add-on table off the cafe flyer (tiers only; full menu lives behind the QR).
- **300dpi originals don't exist for some photos** → shrink image boxes or swap photos; never upscale.
- **Pyro/fireworks claims at venues that disallow them** → "at select venues" qualifier on Skyshots/Cold Pyros.
- **Booklet print cost balloons** → hard cap at 8pp; booklet is in-room only, never counter distribution.

## Open decisions (user)

1. Include Date Night / Movie Night occasion packages in print?
2. Airbnb card: plain pitch, or a guest-only rate/code (also gives clean attribution)?
3. Booklet trim to 8pp — which pages merge?
4. Confirm the Airbnb listing names guests actually see (drives the TerraCottage naming fix).
