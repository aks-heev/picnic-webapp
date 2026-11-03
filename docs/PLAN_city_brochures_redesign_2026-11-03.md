# Plan: City brochures — redesign /brochure into Gurugram & Delhi NCR and Jaipur

Written 2026-11-03 with the plan-optimizer loop (rubric → draft → score → critique → rewrite; trajectory 66 → 79 → 86 → 91, then a best-of-3 round that did not beat 91, so stopped). Design-system audit done in the same session against `brochure.html` / `brochure.css` at HEAD. Status: **NOT started.** Todoist: "City brochures: /brochure/gurugram + /brochure/jaipur from one template" (Picnic Webapp, p2).

Every number below was probed live on 2026-11-03. Per CLAUDE.md §2, re-probe before building on any of them.

---

## 1. Why — the facts this plan rests on

**The brochure quotes Jaipur customers the wrong prices.** `brochure.js fillLivePrices()` takes the lowest price per package across *all* venues in *all* cities, so every "from" price is a Gurugram price.

| Package | Shown today | NCR real from (no food / with food) | Jaipur real from (no food / with food) |
|---|---|---|---|
| The Prelude | ₹5,900 / ₹7,399 (typo) | ₹5,900 / ₹7,400 | **₹7,400 / ₹10,400** |
| The Note | ₹7,400 / ₹8,900 | ₹7,400 / ₹8,900 | **₹8,900 / ₹11,900** |
| The Setting | ₹8,900 / ₹9,900 (stale) | ₹8,900 / ₹10,800 | **₹9,900 / ₹12,900** |
| The Moment | ₹12,900 / ₹13,900 (stale) | ₹12,900 / ₹14,800 | ₹12,900 / **₹15,900** |
| The Story | ₹24,900 / ₹25,900 (stale) | ₹24,900 / ₹26,800 | ₹24,900 / **₹27,900** |

(Static HTML fallbacks also drift from live: the with-food figures in `brochure.html` are out of date for 4 of 5 packages.)

**Price varies by venue inside a city too.** Jaipur Prelude: Castle Valley ₹7,400, House of Amer ₹7,400, **GARH ₹15,400, Satoria Villa ₹17,400, Padao Restaurant (Nahargarh, venue 67, added 2026-11-03 07:17 UTC) ₹29,900**. A single "from" number hides a 4× spread. The redesign has to show price *per venue*, not just per city. Padao, like GARH and Satoria, has `venue_packages` prices only (no `package_prices` rows) and offers 4 packages (no Story).

**Two price sources, one of which the brochure ignores.** `compute_booking_total` uses `package_prices` when a venue has rows there ("price table wins"), otherwise `venue_packages.price`. `package_price_grid` (what the brochure reads) only covers the first. **GARH (66) and Satoria Villa (65) have active `venue_packages` but zero `package_prices` rows**, so they are invisible to the grid today. Delhi (The Sunroom, 18) has `package_prices` split weekday/weekend, with food only, Setting only (₹13,900).

**The static venue list is stale.** `brochure.html` lists "Once Upon A Time at The Bagh" (no longer an active venue) and omits GARH, Satoria Villa, TerraCottage Boho and the Countryside cottages. Copy that lives in HTML rots; venues must come from `venues`.

**Add-ons**: one global price each (`add_ons.price`), no per-city price. Availability differs: Drone Photography is NCR-only (1 venue); Skyshots is at 3 of 5 Jaipur cafes.

**Volume** (confirmed bookings by venue region, last 60 days): NCR 129, Jaipur 10. NCR is ~93% of the business. Jaipur's page earns its keep as the link the Jaipur team sends in chat and the Jaipur Meta campaign points to, not as an SEO page.

**Booking step**: `/packages?tier=X` (app.js ~L3789) filters venues by exact `venues.city`. Passing `city=Gurugram` would hide The Sunroom (city `Delhi`). The NCR page needs a **region** filter, not a city filter.

**No bot dependency**: `picnic-bot` never links to /brochure. Inbound links: `index.html` (11), `app.js` (17), `scripts/prerender-venues.mjs` (9), 4 blog posts (6, all NCR topics).

**Traffic baseline**: Vercel Web Analytics is not enabled on this project (API 404). Baseline must come from PostHog (`brochure_viewed`, `brochure_book_online_click`, `brochure_whatsapp_click`).

---

## 2. Goal and definition of done

Two city brochures replace the one mixed page:

- `/brochure/gurugram` — "Gurugram & Delhi NCR" (region `ncr`)
- `/brochure/jaipur` — "Jaipur" (region `jaipur`)

Done means all of these pass on a Vercel preview, then again on prod:

1. **Every price on either page equals what `compute_booking_total` charges** for that venue + package + 2 guests, no food and with food, on the cheapest day type. Proven by a SQL assertion block (§5, Phase 1), not by eye.
2. A Jaipur visitor never sees an NCR price, venue, add-on or WhatsApp number, and vice versa.
3. "Book online" from a city page lands on the venue step showing only that region's venues.
4. Sharing either URL on WhatsApp shows a city-specific preview card (title, description with the city's "from" price, city hero image). WhatsApp's unfurler does not run JS, so this must be in the served HTML.
5. Every existing `/brochure` link still lands somewhere correct (verification table, §6).
6. Both pages pass the design-system checks in §4 (tokens only, AA contrast, 44px targets).
7. Meta ViewContent/Contact and PostHog events carry `city`.

Out of scope: dark mode, a new reel player, rewriting package copy, new photography shoots (Phase 4 uses existing Jaipur venue images), changes to `compute_booking_total`.

---

## 3. Decisions — defaults taken so the plan can move; Aksheev overrides any

| # | Question | Default in this plan | Why | Cost if wrong |
|---|---|---|---|---|
| D1 | What does bare `/brochure` do? | **City chooser**: two large tiles with each city's live "from" price, auto-forward when the city is already known (hero search `?city=`, or this tab's last search via `params.js currentSearch`). | A redirect to Gurugram would show old Jaipur links the cheaper NCR prices — the exact bug being fixed. One extra tap for an unknown-city visitor is cheaper than a wrong quote. | Low. Flip to a 307 → `/brochure/gurugram` with a city switcher, one line in `vercel.json`. |
| D2 | NCR slug | `/brochure/gurugram`, titled "Gurugram & Delhi NCR". `/brochure/delhi-ncr` 308s to it. | Gurugram is where nearly all NCR bookings and all 4 NCR blog posts point. | Low. Slug swap + redirect. |
| D3 | The Sunroom (Delhi, Setting with food only ₹13,900) | **On the NCR page** as a venue card that says "The Setting only · food included · from ₹13,900". Included in the Setting price matrix. Does not affect any "from" price (it is above the NCR minimum). | It is an active `ncr` venue with real bookings (2 in 90 days). | Low. Hide via one venue filter. |
| D4 | Package lineup per city | **Data-driven**: a package card appears on a city page only if ≥1 active venue in that region offers it. Today both cities get all five. | Lineups will diverge; a hand-kept list is the same rot as the venue list. | None. |
| D5 | Reels by city | Add nullable `reels.region` (`ncr` / `jaipur` / null = both). Backfill null. Admin "Brochure reels" gets a city select. | Most reels are NCR shoots; Jaipur needs its own as they're made. | Low. One column. |
| D6 | GARH / Satoria Villa | **Shown with their real venue_packages prices**, read through the new view (§5). Not hidden. | They are active and bookable; hiding them understates the range. Showing ₹15,400 next to ₹7,400 is honest. | Aksheev may want them priced in `package_prices` first — that is a pricing call, not a page call. |

---

## 4. Design system

### 4.1 Audit of the current brochure (HEAD, 2026-11-03)

**Summary**: 1 page, ~14 component patterns, 9 colour tokens + 2 font tokens. Score **58/100** — good visual base (the PDF look), weak system underneath.

| Category | Defined as tokens | Hardcoded outside `:root` |
|---|---|---|
| Colour | 9 (`--pk-paper` … `--pk-pill`) | **27 hex** (11× `#fff`, 3× `#fffdf9` duplicating `--pk-card`, `#0e564b` hover ×2, 3 theme colours ×2 each, `#2d1f14` ≈ `--pk-ink`), **12 rgba** |
| Type | 2 families | ~25 distinct px sizes (11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15 …) — no scale |
| Spacing | none | free px everywhere (4/6/8/10/12/14/16/18/20/22/24 …) |
| Radius | none | 9 distinct values (10, 12, 14, 16, 18, 20, 22, 28/14, 999) |
| Elevation | none | 1 shadow, inline |
| Motion | none | — |

**Contrast** (WCAG 2.x, computed):

| Pair | Ratio | Verdict |
|---|---|---|
| White on `#1f9e8f` (final CTA band body text, "Most popular" badge at 11px) | **3.31** | **Fails AA** for both |
| Ochre `#8a5a14` on paper | 5.49 | Pass |
| Muted `#6b5a4c` on paper | 6.11 | Pass |
| Teal `#126a5d` on paper | 6.01 | Pass |
| White on teal button | 6.47 | Pass |

**Component completeness**

| Component | States | Variants | Notes | Score |
|---|---|---|---|---|
| Button `.pk-btn` | hover, focus-visible | site, wa, final | no pressed/disabled; `.pk-cta-label` uses `!important` | 6/10 |
| Package card `.pk-card` | suggested, too-small, popular | — | price block hardwires "at Beige Cafe" | 5/10 |
| Price block `.pk-price` | — | — | one number; cannot express per-venue or per-city | 3/10 |
| Venue card `.pk-venue` | — | — | static copy, no link, no price | 3/10 |
| Add-on menu `.pk-menu` | — | — | no availability note per item | 6/10 |
| Reel tile / player | hover, focus | photo/plain, theme | solid; keep | 8/10 |
| Top bar `.pk-top` | — | — | no city context | 5/10 |
| Slots `.pk-slots` | — | — | copy disagrees with venue pages (open Todoist task) | 4/10 |

**Priority actions**: (1) a city token layer; (2) a price component that can say "from ₹X at Venue" and expand to every venue; (3) collapse the 25 font sizes and 9 radii into scales; (4) fix the 3.31 contrast.

### 4.2 Tokens — two layers

**Base layer** (shared, `:root`). Rename `--pk-*` → semantic names; keep values that already pass.

```css
:root {
  /* surface */
  --bg: #fbf6ee;            /* was --pk-paper */
  --surface: #fffdf9;       /* was --pk-card, and the 3 raw #fffdf9 */
  --line: #ece2d3;
  --line-strong: #cdbfa9;   /* was the raw dotted-leader colour */
  /* text */
  --ink: #2b1d14;           /* absorbs #2d1f14 */
  --ink-muted: #6b5a4c;
  --ink-on-accent: #ffffff;
  /* note pill */
  --note-bg: #fbe7b6;
  --note-line: #c79a3c;
  /* theme swatches (data, not UI) */
  --theme-pink: #b0476b; --theme-beige: #8a5a14; --theme-green: #4f6b45;
  /* type */
  --font-serif: "EB Garamond", Georgia, serif;
  --font-sans: "Be Vietnam Pro", system-ui, -apple-system, sans-serif;
  --fs-xs: 12px; --fs-sm: 13.5px; --fs-md: 15px; --fs-lg: 18px;
  --fs-xl: clamp(22px, 5.5vw, 28px); --fs-2xl: clamp(28px, 6vw, 38px); --fs-3xl: clamp(44px, 11vw, 64px);
  /* space (4px base) */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;
  /* radius */
  --r-sm: 10px; --r-md: 14px; --r-lg: 20px; --r-pill: 999px;
  /* elevation + motion */
  --shadow-1: 0 6px 24px rgba(43, 29, 20, 0.12);
  --dur: 160ms; --ease: cubic-bezier(.2,.7,.2,1);
}
```

**City layer** — the only thing that differs between the two pages. Set by `<html data-city="ncr|jaipur">` in the served HTML.

| Token | NCR (Aravalli) | Jaipur (Pink City) | Contrast checks |
|---|---|---|---|
| `--accent` | `#126a5d` teal | `#a8432f` terracotta | on bg 6.01 / 5.56; white on it 6.47 / 5.98 |
| `--accent-strong` (hover, CTA band) | `#0e564b` | `#8f3a2a` | white on it 8.1 / 7.48 |
| `--accent-soft` (tint fills) | `rgba(18,106,93,.08)` | `rgba(168,67,47,.08)` | decorative |
| `--kicker` (eyebrows, tiers, prices) | `#8a5a14` ochre | `#8a5a14` ochre | on bg 5.49 |
| `--bg` override | — | `#fbf3ee` (a touch pinker) | ink 14.3, ochre 5.2, muted 5.8 |

The final CTA band moves from `#1f9e8f` to `--accent-strong`, which fixes the 3.31 failure on both pages. The "Most popular" badge moves to `--accent` (≥5.98).

Rule: **no hex or rgba outside the two token blocks.** Checked in Phase 5 with `grep -nE '#[0-9a-fA-F]{3,6}|rgba\(' brochure.css` → only lines inside `:root` / `[data-city]`.

### 4.3 Components — new and changed

**Price block** (`.pk-price`) — replaces the hardcoded "at Beige Cafe".

| Property | Type | Description |
|---|---|---|
| `from` | ₹ | lowest no-food price for this package in this region |
| `fromVenue` | text | venue that holds that price ("at Castle Valley") |
| `withFood` | ₹ \| null | lowest with-food price in region; hidden when no venue offers food for it |
| `rows[]` | {venue, noFood, withFood, maxGuests} | every venue in the region offering the package, cheapest first |

States: *default* (from + venue + with-food line + "See price at each venue" toggle); *expanded* (a small table, one row per venue); *single venue* (no toggle); *loading* (static build-time price shown, no shimmer); *fetch failed* (static stays, toggle hidden).
Accessibility: toggle is a `<button aria-expanded aria-controls>`; table has a `<caption>` naming the package and city; prices are text, not images.
Do: say "from ₹7,400 at Castle Valley". Don't: show a bare "from" number without the venue when the in-city spread is >25%.

**Price-at-a-glance strip** (new, under the cover) — five rows: package, guests, from (no food), from (with food). Answers the price question in one phone screen; each row jumps to its card.

**City switch** (new, in the top bar) — a two-option segmented link (not a toggle button: each option is a real `<a href="/brochure/jaipur">`). Current city has `aria-current="page"`. 44px tall.

**Venue card** (rebuilt, data-driven) — type kicker, name, area, "Included in package price" / "Venue charge applies", packages offered with the venue's own lowest price, link to the venue page (`/<slug>`). Order: most booked first (confirmed bookings, last 180 days).

**Add-on row** — gains an availability note when an add-on is not at every venue in the region ("at 3 of 5 venues"). Hidden entirely if no venue in the region offers it (Drone Photography on Jaipur).

**Sticky action bar** (new, phones only, `max-width: 640px`) — appears after the cover scrolls out: "WhatsApp" (city number) + "Book online". 56px, safe-area padding.

**City chooser** (new, `/brochure` only) — two tiles: city name, hero crop, "from ₹X", one line of venue names.

Unchanged: reel tile, reel player, theme rows, note pill.

### 4.4 Page structure (both cities, same order)

1. Top bar — brand · city switch · jump links
2. Cover — city name (H1), occasions line, city hero, lede, **"Packages from ₹X"**, primary CTA (WhatsApp city), secondary (Book online)
3. Price at a glance
4. Package cards (ladder order: Prelude → Note → Setting → Moment → Story), each with the price block
5. Venues (data-driven, region only)
6. Add-ons (region availability)
7. Themes
8. Reels (region-tagged + untagged)
9. Time slots (single source, once the open slot-copy task is settled)
10. Final CTA band — one city number, Instagram, site
11. Footer

---

## 5. Phases

Each phase ships on its own and leaves prod correct. Aksheev runs every git command (CLAUDE.md §3).

### Phase 0 — Decisions and baseline (no code)
1. Aksheev confirms or overrides D1–D6.
2. Pull the PostHog baseline for the last 28 days: `brochure_viewed`, `brochure_book_online_click`, `brochure_whatsapp_click` split by `city` property (WhatsApp clicks already carry `city`).
3. Confirm the slot copy (open Todoist task "Brochure: fix time-slot copy").
**Exit**: decisions written into §3 of this doc; baseline numbers written into §7.

### Phase 1 — One price source for the brochure (backend; fixes nothing visible yet)
1. New view `public.brochure_city_prices` (`security_invoker = true`, anon `select`): one row per region × venue × package with `from_no_food`, `from_with_food`, `max_guests`, `price_source` (`package_prices` | `venue_packages`). Rule mirrors `compute_booking_total` exactly: if a venue has any active `package_prices` row for the package, use the minimum over those rows (weekday/weekend and guest bands); otherwise `venue_packages.price` (no food), with-food null. Exclude `date_night%` / `movie_night%` like the grid does.
2. Migration file `supabase/migrations/2026MMDD_brochure_city_prices_view.sql` + `apply_migration` (CLAUDE.md §4).
3. **Assertion block** (rolled-back `DO $$`): for every row, call `compute_booking_total` for that venue + package with 2 guests, no add-ons, on the next weekday and next weekend date, food off and on; assert the view's `from_*` equals the minimum returned. Any mismatch raises with the venue/package named.
4. `get_advisors` — no new finding.
**Exit**: assertion block passes on every row (expect ~29 rows: 5 Gurugram×2 venues, 1 Delhi, 5×2 Jaipur grid venues, 4×2 GARH/Satoria); advisors clean.
**Rollback**: `drop view brochure_city_prices;` — nothing reads it yet.

### Phase 2 — City-aware brochure on the existing URL (frontend; fixes the wrong Jaipur price)
1. `brochure.js` reads the city from `?city=` / hero search (already parsed by `params.js`) and maps it to a region (`Gurugram`, `Delhi` → `ncr`; `Jaipur` → `jaipur`). No city → today's behaviour (all regions) **but** the price block says "from ₹5,900 in Gurugram · ₹7,400 in Jaipur" instead of one blended number.
2. Switch `fillLivePrices` to `brochure_city_prices`. Render the new price block (§4.3) with per-venue rows.
3. Filter add-ons, WhatsApp buttons and reels (once D5 lands) by region.
4. Remove the hardcoded "at Beige Cafe" labels and the stale static with-food numbers; the static fallback becomes "Prices on WhatsApp" rather than a number that can go stale.
5. Fold in: `'at Beige Cafe' label` task and the Prelude ₹7,399 typo (both close).
**Exit**: on a preview, `/brochure?city=Jaipur` shows only Jaipur prices, matching the Phase 1 view row by row; `/brochure` shows both city minimums; trusted-copy `node --check` of `brochure.js` passes (§3.4).
**Rollback**: revert `brochure.js`.

### Phase 3 — Design system and redesigned page (frontend)
Build with the repo-scoped `frontend-design` and `taste-skill` skills, against §4.
1. Token refactor of `brochure.css` (base + `[data-city]` layers). No visual change intended for NCR apart from the contrast fixes — screenshot before/after.
2. New components: price-at-a-glance, city switch, data-driven venue cards, add-on availability, sticky action bar.
3. Venues section rendered from `venues` (region, `is_active`, types `cafe` / `partner_bnb` / `self_managed`, excluding `custom` and `combo` children rules as the homepage grid does). Delete the static venue HTML.
4. Jaipur hero and card photos: pick from existing Castle Valley / House of Amer `venues.images`, download the `opt/lg` variants once and commit them under `public/brochure/jaipur/` (CLAUDE.md §14 — static files cost no Supabase egress).
**Exit**: grep shows no hex/rgba outside token blocks; both `data-city` values render on a preview at 375px and 1280px (Aksheev's real-phone screenshots, since `resize_window` does not resize — CLAUDE.md §9); every interactive element ≥44px.
**Rollback**: revert `brochure.html` / `brochure.css` / `brochure.js`.

### Phase 4 — Two URLs, built per city (build + routing)
1. `scripts/prerender-venues.mjs` (already post-processes `dist/` and already reads Supabase at build) gains `buildCityBrochures()`: read `dist/brochure.html`, write `dist/brochure/gurugram.html` and `dist/brochure/jaipur.html` with per-city `<html data-city>`, `<title>`, meta description, canonical, `og:title`, `og:description` ("Picnic packages in Jaipur from ₹7,400"), `og:image` (city hero), and the **build-time prices baked in** from `brochure_city_prices`. Live JS still refreshes them.
2. `dist/brochure.html` becomes the city chooser (D1) with `noindex, follow` and canonical to itself.
3. `vercel.json`: 308 `/brochure/delhi-ncr` → `/brochure/gurugram`. Verify on preview that `cleanUrls` serves `/brochure/jaipur` from `dist/brochure/jaipur.html` alongside the existing `public/brochure/*.webp` assets in the same folder (untested combination — highest-risk step).
4. Sitemap: add both city URLs, drop `/brochure`.
5. Move the Offer JSON-LD (open Phase 3 item from the merge plan) onto each city page with that city's prices.
6. Analytics: `ViewContent` gets `content_category: '<city>'`; every `brochure_*` PostHog event gets `city`.
**Exit**: verification table §6 passes on the preview; WhatsApp preview checked by pasting both URLs into a WhatsApp chat (Aksheev, real phone).
**Rollback**: remove the redirect and the two generated files; `/brochure` reverts to Phase 3's single page.

### Phase 5 — Booking step scoped by region, links repointed
1. `app.js` venue step (~L3789): accept `region=ncr|jaipur` alongside `city`; when present, show only venues in that region and hide the city pills if only one city remains (NCR keeps "Gurugram / Delhi" pills). City brochure "Book online" links pass `region`.
2. Repoint inbound links: 4 NCR blog posts → `/brochure/gurugram`; prerender city pages (`/picnic-venues-gurugram` → gurugram, `/picnic-venues-jaipur` → jaipur); venue pages → their region's brochure; homepage pills keep `/brochure` (chooser) unless the hero search has a city.
3. Ops (Aksheev): update WhatsApp Business quick replies for each team to send their city's link; point the Jaipur Meta campaign's link (if any) at `/brochure/jaipur`.
4. Reels region column (D5) + admin select.
**Exit**: from `/brochure/jaipur`, "Book online" on every package shows Jaipur venues only; from `/brochure/gurugram`, Gurugram + Delhi only. Trusted-copy parse of `app.js` passes.

### Phase 6 — Measure (on or after 28 days live)
Compare against the Phase 0 baseline, stating n every time (CLAUDE.md §8):
- Book-online click-through per brochure view, per city.
- WhatsApp clicks per view, per city.
- Jaipur enquiries that mention a price lower than the city's real minimum (team reports) — should be zero.
- GSC impressions on `/brochure/gurugram` vs `/brochure`'s last 28 days.

---

## 6. Verification table (preview, then prod, cache-busted)

| Request | Expected |
|---|---|
| `/brochure` (no city known) | 200, city chooser, both "from" prices match the view |
| `/brochure?city=Jaipur` | forwards to `/brochure/jaipur` (query kept) |
| `/brochure/jaipur` view-source | `data-city="jaipur"`, Jaipur title/og, baked Prelude price ₹7,400 |
| `/brochure/jaipur` rendered | no Gurugram/Delhi venue, no NCR number, no Drone Photography |
| `/brochure/gurugram` rendered | Beige Cafe, Countryside, The Sunroom (Setting only), TerraCottages; Jaipur number absent |
| Expand "price at each venue" on Jaipur Prelude | Castle Valley 7,400 · House of Amer 7,400 · GARH 15,400 · Satoria 17,400 (re-probe first) |
| `/brochure/delhi-ncr` | 308 → `/brochure/gurugram` |
| "Book online" on `/brochure/jaipur` | `/packages?tier=…&region=jaipur`, only Jaipur venues |
| Blog post brochure link | `/brochure/gurugram`, no redirect hop |
| `/brochure/hero.webp` and other existing assets | still 200 (folder now shared with pages) |
| Meta Pixel Helper on each city page | PageView + ViewContent with `content_category` = city |

---

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Brochure price ≠ charged price for a venue that uses `venue_packages` fallback | Medium (it is exactly the GARH/Satoria case) | Phase 1 assertion block against `compute_booking_total`, row by row |
| `cleanUrls` + a `brochure/` folder holding both pages and images misroutes | Medium | Test on preview first; fallback URL shape `/jaipur-brochure` needs only a rename in the prerender step |
| Old WhatsApp links to `/brochure` now cost an extra tap | Certain, small | Auto-forward when city known; D1 is one line to flip |
| Static prices baked at build go stale between deploys | Medium | Live JS refresh always runs; static is only for link previews and no-JS |
| Jaipur photos pulled from Supabase Storage add egress | Low | Copied once into `/public` at build, never hot-linked |
| Removing static venue copy loses hand-written descriptions | Medium | Copy any description not already in `venues.description` into the DB before deleting the HTML |
| Visual regression on NCR, which carries 93% of bookings | Medium | Phase 3 before/after screenshots; NCR keeps today's teal/cream look |

---

## 8. What the optimizer loop changed (draft → final)

1. **Price correctness moved from "filter the grid by city" to a provable single source.** The first draft filtered `package_price_grid` by city and would have silently dropped GARH and Satoria (no `package_prices` rows) and shown Jaipur as uniformly ₹7,400. The final adds a view that mirrors `compute_booking_total`'s two-source rule, plus a row-by-row assertion.
2. **Per-venue price, not just per-city.** Probing showed a 2.3× spread inside Jaipur; the price block was redesigned to name the venue behind each "from" and expand to all venues.
3. **The booking step was a hidden dependency.** The venue step filters by `venues.city`, so an NCR link would have hidden Delhi; the plan adds a `region` parameter.
4. **Ship order changed so the wrong-price bug dies in Phase 2**, on the existing URL, before any routing or redesign risk.

Best-of-3 round (did not beat 91): (B) one URL with in-page city tabs — fails WhatsApp previews and gives Google one page for two cities; (C) fully static per-city pages rebuilt on price change — breaks the "live from the DB" rule and needs a rebuild hook. Kept (A), borrowing C's build-time baked prices for previews.

Final score 91: price correctness 19/20 · completeness 14/15 · sequencing 14/15 · design-system rigour 13/15 · goal clarity 9/10 · risks 9/10 · feasibility under repo rules 9/10 · metrics 4/5. Lowest marks: metrics (no traffic baseline exists yet) and design rigour (no rendered mockup — next step).
