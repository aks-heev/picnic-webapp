# Gurugram GBP Enrichment — Ready-to-Paste Content

Source plan: `docs/Google Business Profile Playbook.docx` §1. All prices below are pulled live from Supabase today (2026-07-16), not the playbook's draft numbers — **the playbook's "Proposal Picnic (from ₹9,900)" is stale and wrong**, see below. Do all edits logged in as the profile manager via Google Search → "The Picnic Stories" → Edit profile.

## 🔴 LIVE STATUS CHECK (2026-07-16) — most of this is already done

Checked the actual live profile via Google Search (already logged in as profile manager — read-only, nothing clicked into edit mode or saved). **The playbook and the 07-15 SEO plan both undersold how far along this profile already is:**

| Item | Playbook assumed | Actually found live | Status |
|---|---|---|---|
| Reviews | "1 review" (07-06 audit, repeated in 07-15 SEO plan) | **5.0★, 8 Google reviews** | ✅ well ahead — real progress happened, docs were stale |
| Category | "Events Venue" only, needs Event planner added as primary | **"Event planner in Haryana" already shown as the primary category** | ✅ done (couldn't check secondary categories — see below) |
| Description | Implied thin/needs work | Full quality copy already live: *"The Picnic Stories creates unforgettable luxury boho picnic experiences across Jaipur, Gurugram, Delhi, Goa and beyond..."* | ✅ already good, no action needed |
| Service areas | Empty, needs Gurugram/Delhi/Noida/Faridabad/Ghaziabad added | **Already set: Faridabad, Gurugram, Noida, Faridabad (duplicate), Delhi, New Delhi** | 🟡 mostly done — **Ghaziabad still missing**, and there's a **duplicate Faridabad entry** worth cleaning up |
| Weekly posting cadence | Not started | **Already active** — a real post ("Best Private Picnic Setups in Delhi NCR...") went up 2 days ago | ✅ already happening, no action needed |
| Hours | "Open 24 hours", needs 9AM–8PM | Still shows **"Open 24 hours"** | ❌ still open — do §4 below |
| WhatsApp | Not connected | 🔴 **CORRECTED after opening the actual Contact editor tab: already connected.** Chat → WhatsApp → `https://wa.me/919773703982`, marked PRIMARY. The sidebar's "Add WhatsApp" nudge card is a generic upsell prompt Google keeps showing regardless — don't trust it, check the editor directly. Worth confirming `9773703982` is a number your team actually monitors, since it's different from the listed phone number (`9266964666`). | ✅ already done, no action needed |
| Place phone number | Assumed fine (website/booking phone is correct) | Dashboard flags **"Add missing information → Add place's phone number"** as a distinct gap on the GBP place record itself | ❌ new finding, not in original playbook — worth fixing |
| Services list w/ prices | Not populated | Couldn't confirm — no public Services block rendered in this view, and I deliberately didn't open "Edit services" to check (risk of an accidental edit) | ❓ unconfirmed, treat §3 below as still needed until you check |
| Photos (10+) | ~1 photo | Couldn't get an exact count without opening the Photos manager (avoided for the same reason). Visual preview strip suggests still thin. DB confirms only 7 real Beige Cafe images exist site-wide either way | 🟡 likely still short — §5 below still applies |
| Secondary categories | Add Event management company, Wedding service | Not checkable without opening the categories editor — only the primary category shows in this view | ❓ unconfirmed |

**Net effect: skip §1 (service areas — just add Ghaziabad and dedupe Faridabad, not a full rebuild), skip the category primary-setting ask in §2, and skip the "fix description" framing entirely.** Sections 3 (Services), 4 (Hours), 5 (Photos), 6 (WhatsApp), and the new phone-number gap are still real. Revised sections below reflect this.

## 1. Service areas — mostly done, just clean up
Already live: Faridabad, Gurugram, Noida, Faridabad (dup), Delhi, New Delhi. Two small fixes only:
```
Add: Ghaziabad
Remove: the duplicate Faridabad entry
```

## 2. Categories — primary already correct
"Event planner" is already showing as the primary category — no change needed there. While you're in the categories editor for the service-area fix above, glance at the secondary category list and add **Event management company** / **Wedding service** if they're not already there (couldn't check this from outside the editor).

## 3. Services (with real prices)

🔴 **The playbook's draft prices are stale.** It was written 2026-07-06, before packages moved to stored per-venue pricing (2026-07-10) and before the advance-percentage fix (2026-07-15). Gurugram only has **one** packages-enabled picnic venue — **Beige Cafe** — so these are Beige's live prices, verified today:

| Occasion | Suggested service copy | From price | Source |
|---|---|---|---|
| Proposal Picnic | "A luxury boho picnic setup for the moment you've been planning — florals, styling, and privacy done right." | **from ₹8,900** | Setting tier (cheapest universal option; defaults to The Story at ₹25,000 if fully styled — mention range if GBP allows a max price) |
| Birthday Picnic | "Celebrate with a fully styled picnic — bouquet, cake, and printed memories included." | **from ₹8,900** | Setting tier (defaults to The Moment at ₹12,900) |
| Anniversary Setup | "Mark the milestone with a private, beautifully styled picnic setup." | **from ₹8,900** | Setting tier (defaults to The Story at ₹25,000) |
| Date Night Picnic | "Bouquet, bonfire, and a night that's just the two of you." | **from ₹10,900** | Date Night (occasion-locked package) |
| Movie Night Picnic | "A big-screen picnic setup, under the stars." | **from ₹13,900** | Movie Night (occasion-locked package) |
| Bridal/Baby Shower | "A dreamy styled picnic to celebrate the parent- or bride-to-be." | **from ₹8,900** | Setting tier (defaults to The Moment at ₹12,900) |

**Why "from ₹8,900" and not the higher default-tier price:** every universal occasion (Proposal, Birthday, Anniversary, Bridal/Baby Shower) can actually be booked at any of the three universal tiers (Setting/Moment/Story) — the site just *pre-selects* a pricier default per occasion. Listing the true floor price is the honest "from" figure and matches what a customer could actually pay; listing the default-tier price risks a bait-and-switch complaint if someone expects, say, ₹8,900 for a proposal and the site defaults them to a ₹25,000 tier. **Your call if you'd rather list the default-tier price instead** (more aspirational, less literal) — just don't reuse the playbook's ₹9,900 placeholder, it doesn't match anything live.

There's also **The Prelude** at ₹5,900 (Beige only, capped at 4 guests) — worth a mention only if you want an even lower entry point advertised; the existing packages doc flagged it needs a placement line so it doesn't read as bait against the ₹8,900 floor.

## 4. Hours
Replace "Open 24 hours" with:
```
9:00 AM – 8:00 PM, daily
```
Matches your real booking slots (morning 9–12, afternoon 1–4, evening 5–8).

## 5. Photos — gap flagged, not fully solvable from here

Playbook wants 10+ real setup photos. Beige Cafe (Gurugram's only picnic venue) has **only 7 images** in the system. To hit 10+ without a new shoot, supplement with the best occasion-representative shots from other cities' picnic setups (same brand, same styling language) — do **not** pull TerraCottage room/interior photos even though they share the DLF address; the playbook is explicit this profile should stay picnic/events-focused, not double as the BnB's listing.

Beige Cafe's 7 (use all):
```
https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/venue-images/venue-1780931565273-0.jpg
https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/venue-images/venue-1780931940010-4.jpg
https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/venue-images/venue-1780931628112-2.jpg
https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/venue-images/venue-1783144077034-0-Delhi__Gurugram__Date_night.webp
https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/venue-images/venue-1783144077036-1-Delhi__Gurugram__Date_night_1.webp
https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/venue-images/venue-1783144077036-2-Delhi__Gurugram__Date_night_3.webp
https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/venue-images/venue-1783144077036-3-Delhi__Gurugram__Date_night_2.webp
```
Castle Valley (Jaipur, 9 photos — same brand styling, pick 3–4 best for variety) and Sunroom (Delhi, 6 photos) are the next-richest galleries if you want more range; grab those from the admin panel image manager since URLs weren't pulled here to keep this doc short.

**Real gap worth flagging on its own:** 7 photos for your only Gurugram picnic venue is thin longer-term — this is the same "need a real decorated setup day" pattern already logged for TerraCottage's IG launch. Not blocking today's enrichment, but worth planning a proper shoot at Beige eventually.

## 6. WhatsApp
Dashboard shows an "Add WhatsApp" prompt on the profile — connect your business WhatsApp number. No content needed, just click through.

## 7. Small fills
- 🔴 **New finding, not in the original playbook:** the dashboard flags "Add place's phone number" under "Add missing information" — the GBP place record itself is missing a phone number even though the website/booking phone is correct elsewhere. Worth fixing alongside everything else.
- Website: `https://www.picnicstories.com`
- Opening date: your actual business start month/year
- Attributes: identifies-as options as applicable
- Amenities: whatever the picker offers that's true (outdoor seating, private setup, etc.)

## Do NOT do (carried from playbook, high consequence)
- Don't add city/keywords to the business name ("The Picnic Stories — Gurugram") — suspension risk.
- Don't create a duplicate profile for the same city.
- Don't let a cold-call/agency "verify" the listing — only your own login.
- Don't mark 24/7 or "temporarily closed" for off days.
- Don't post stock photos.

## What's left after this
Once this ships, the Jaipur profile creation (deferred by you earlier) and the review engine (`post-event-nudge` wiring, still on the backlog) are the two GBP-track items still open per `docs/SCOPE_AUDIT_2026-07-16.md`.
