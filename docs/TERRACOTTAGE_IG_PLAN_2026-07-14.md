# TerraCottage Instagram — 90-Day Direct Bookings Plan
**Date:** 2026-07-14 · **Status:** Final (plan-optimizer, score 86/100, trajectory 63 → 76 → 84 → 86 → 86)

## 0. What we're selling (and why this isn't channel-shift)
The IG product is **stay + celebration setup** — a bundle Airbnb cannot list. Base stays: Ochre ₹2,500–3,000, Umber ₹3,000–3,500/night. With setups: Ochre up to ~₹10,000, Umber ₹16,000–18,000. Every setup booking is incremental high-margin revenue, not a fee-savings play. Sienna (whole home) is the natural group/party upsell.

**Objective:** 4–6 IG-attributed stay+setup bookings/month by day 90, at CAC ≤ ₹2,000/booking.

## 1. Economics
- Blended AOV assumption: ₹9,000–13,000 (mix of Ochre setups + occasional Umber premium).
- Ad budget ₹10k/mo (midpoint of ₹5–15k): break-even ≈ 1 booking/mo on revenue; realistic target 3–8 CTWA conversations/day → 3–6 bookings/mo once the funnel is tuned.
- CAC ladder: ≤₹3,500 acceptable in month 1 (learning), ≤₹2,000 by day 90 (scale trigger).
- **Inventory ceiling:** 2 rooms ≈ 60 room-nights/mo, but setup demand is weekend-skewed ≈ ~26 premium (Fri–Sun) room-nights/mo. Current occupancy 8–15 nights/mo → real headroom ≈ 10–18 premium nights. Past ~20 premium nights/mo, stop scaling ads and raise prices instead.
- **Open input (owner):** setup cost per tier (decor is largely reusable, so margin should be high — confirm).

## 2. Phase 0 — Launch gates (Week 1–2, no ad spend until all done)
1. **Handle: `terracottage.ggn` (confirmed 2026-07-14).** Register it before anything else.
2. **Brand assets:** pick logo direction (current front-runner: variant 6 — two-line TERRACOTTAGE / STAYS lockup). Additionally produce: (a) **icon-only avatar** (arch + vases, no text, high-contrast solid background — the beige-paper texture fails at 110px), (b) reel watermark PNG, (c) story highlight covers in the terracotta palette.
3. **Productize the setup menu:** 3 named tiers per room mapped to occasions (birthday / anniversary / proposal / date night). One highlight + one PDF/image card with inclusions. Price anchors: Ochre from ₹6–7k → ₹10k, Umber from ₹10k → ₹16–18k. Without this, ads sell a vague promise and WhatsApp closes slowly.
4. **Page setup:** IG professional account linked to the FB page + ad account. Bio: "Private cottage stays + celebration setups · Gurugram · By The Picnic Stories · Book direct ↓". Link: wa.me deep link with pre-filled text (primary) — site stay page as secondary via link-in-bio. Highlights: Rooms · Setups · Reviews · How to book.
5. **Seed grid:** 9–12 posts live BEFORE any ad runs (rooms, 2–3 setup transformations, guest photos, one transparent-pricing card). Ad-clickers who land on a 3-post page bounce.
6. **WhatsApp Business:** greeting message, quick replies for the qualification script (§5), catalog with setup tiers. Use the existing site number (keeps history + trust; avoid new-number spam risk).
7. **Attribution backbone:** every IG-origin booking is logged via the admin **+ Add Booking** tab with `external_booking_ref = "IG-organic" / "IG-ad" / "IG-story"`. This is the only reliable CAC denominator — decide it now, not after the first booking.
8. **Pixel check (already owed):** eyeball Events Manager for PageView/ViewContent/Contact/InitiateCheckout/Lead firing — needed for site-retargeting audiences and any future conversion campaigns.

## 3. Phase 1 — Organic engine (Week 2–12, 1–2 reels/wk)
**Every reel posts as an Instagram Collab with the Picnic Stories page.** This is the cold-start killer: one upload, both grids, pooled engagement, and the proven picnic audience sees every stay reel. Follower growth on terracottage compounds from the main page's reach.

Three rotating formats (reuse the proven playbook: bold sans top-captions, hard cuts, dark→bright arc):
1. **Setup transformation** — empty room → full birthday/anniversary setup, timelapse or hard-cut before/after. This is the core format; it *is* the product demo.
2. **Bridge remake** — "You loved our picnics → now stay the night." Proven formula, adapted: picnic footage cold-open → cottage interior + setup reveal.
3. **Occasion POV** — "POV: he booked the entire cottage for your birthday." Sells the occasion, not the room. The ₹16–18k buyer is buying a moment, not accommodation.

CTA convention: caption + pinned comment → "DM 'BIRTHDAY'" or wa.me link in bio. Stories 3–4/wk: setup prep BTS, guest reactions/reviews, "this weekend is open" scarcity posts.

Cadence guard: 1 reel/wk sustained beats 3/wk for two weeks then silence. Batch-shoot on setup days — every real booking's setup is a content shoot.

## 4. Phase 2 — Paid (start Week 3, only after Phase 0 gates pass)
**One campaign. Click-to-WhatsApp objective. ₹300–400/day.** At this budget, fragmentation across campaigns/ad sets destroys learning — resist adding more.

- **Ad set A — Warm (launch first):** union of Picnic Stories IG engagers 365d + terracottage engagers + customer list (bookings-table phones/emails) + site visitors 180d. Pooled into ONE ad set — individually these audiences are too small for stable delivery (~250 site visitors/mo; the IG engager pool is the only one with real scale).
- **Ad set B — Cold (week 5+, only if A saturates or under-delivers):** Delhi NCR, 24–40, anniversary/birthday/gifting/couples interests, ~25km radius covering Gurugram + South Delhi.
- **Creatives:** top 2 organic reels (Collab posts double as creative testing) + 1 static price-anchor card. Hero = Umber premium setup (highest AOV; Ochre is the downsell in the WA script, not the ad). Refresh every 2–3 weeks.
- Boost button: only deliberately, ≤₹1k/mo, to grow the engagement retargeting pool — never for booking goals (boost optimizes engagement, not conversations).

## 5. Conversion ops — where bookings are actually won
- **SLA: first WhatsApp reply <15 min, 10:00–22:00.** Ad-driven conversations decay by the hour. Name who owns the phone.
- Script: occasion? → date + guests? → room reco → setup tier pitch **with photos** (highest-tier first) → advance to lock (₹3,000 via Razorpay link/UPI) → confirm → log in admin + Add Booking (send_guest_email ON when email captured; ref per §2.7).
- Direct bookings auto-block Airbnb via existing iCal sync — zero double-booking risk, already live.
- Weekend setup slots: block a shared calendar so stay setups don't collide with picnic ops crew.

## 6. Measurement — weekly 30-min scorecard (fixed day)
| Metric | Source |
|---|---|
| Reel reach + profile visits + follows | IG insights |
| WA conversations started (per ad) | Ads Manager |
| Qualified leads (occasion + date given) | WA count |
| Bookings + revenue (by IG-ref) | admin bookings tab |
| CAC = spend ÷ IG-ad-ref bookings | computed |
| Stay-page traffic from IG | PostHog (utm on bio secondary link) |

Attribution rule: a booking counts as IG if the WA thread originated from an ad/bio link, or the guest says they found us on IG. Logged in the booking ref — no guessing later.

## 7. Kill / scale criteria
- **Kill (week 6):** <10 qualified WA leads per ₹5k spent → pause spend, rework creative + offer first (not targeting).
- **Scale:** CAC <₹2,000 for 2 consecutive weeks → raise budget toward ₹15k/mo.
- **Stop scaling:** ~20 premium nights/mo booked → raise prices / push Sienna whole-home instead of more spend.
- **Founding offer (lever, hold in reserve):** if week-4 conversion is weak, "first 10 direct bookings get a free tier upgrade" — upgrade, never discount; protects the price anchor.

## 8. Risks
- **Monsoon (now–Sept):** default all setups indoor; never advertise outdoor visuals you can't deliver in rain. Shoot creative indoors.
- **Thin-page trust gap:** mitigated by seed grid, review highlight, "By The Picnic Stories" in bio, Collab posts showing the established page.
- **WA number health:** no broadcast blasts from the business number; template discipline.
- **Ops clash:** weekend setups vs picnic crew — shared calendar (§5).
- **Grid dilution on Picnic Stories:** cap Collabs to stays-relevant aesthetics; if the picnic grid suffers, switch some reels to terracottage-only + boost instead.

## 9. 30/60/90 targets
- **Day 30:** page live, 12+ grid posts, 6–8 Collab reels, first ~15 WA leads, ≥1 booking, avatar/handle/setup-menu done.
- **Day 60:** 2–3 bookings/mo pace, CAC measured (not guessed), top 2 creatives identified, cold ad set live if warranted.
- **Day 90:** 4–6 IG-attributed bookings/mo, ₹50–90k/mo attributed revenue, scale/hold decision per §7.

## Open inputs owed by owner
1. ~~Handle spelling~~ — RESOLVED: `terracottage.ggn` (availability check still owed at registration).
2. Setup cost/margin per tier (validates CAC ladder).
3. Who owns the WhatsApp phone + SLA commitment.
4. Advance policy confirmation (₹3,000 to lock?).
5. ~~Icon-only avatar~~ — RESOLVED 2026-07-14: two circle-safe variants delivered (terracotta-on-cream + cream-on-terracotta, SVG + 1000px PNG). Final call: pick one as the avatar; the other works as a story-highlight cover base.
