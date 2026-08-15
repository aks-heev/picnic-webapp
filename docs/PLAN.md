# The Picnic Stories — Linked-Listing Plan & Operating Order

**Property:** Full floor, DLF Phase 2, Gurugram — a 2BHK + 1RK that can combine into a 3BHK whole-floor + terrace.
**Date:** 2026-06-04
**Companion docs:** `SPEC_parent_child_listings.md` (data model + blocking), `SPEC_hold_action_and_admin_ui.md` (Hold flow + UI). This file is the master narrative; those two are the build detail.

---

## Decisions (final)

- **Configuration:** Flexible / linked listings.
- **Naming (guest-intent):** *Terracottage Ochre* (1RK) · *Terracottage Umber* (2BHK) · *Terracottage Sienna* (full floor + terrace).
- **Singles (Nook, Gathering):** sold on **both** Airbnb (instant-book) **and** the website (direct, Meta-ads-driven). Dual-channel.
- **Floor (Reunion):** **direct-only**, confirmation-required, with the Hold step. Never instant-bookable, never listed on Airbnb.
- **Build approach:** extend the existing app (the two-way iCal sync is already built and dormant). Buy nothing yet — see the tripwire below for when that changes.
- **Channels now:** Airbnb + direct. Booking.com / MMT deferred.

---

## How it works (the mental model)

The database is the source of truth for which nights are blocked, per room. Two directions of blocking, by two mechanisms:

- **Floor booked → singles close:** *stored* blocks written onto each single, which ride the existing `export-ical` feed out to Airbnb. Stored because Airbnb has to be told.
- **A single booked → floor closes:** *computed* at read time as the intersection of the singles' availability. Computed because the floor is direct-only and never has to tell Airbnb anything.

Calendars sync at three very different speeds: website ↔ database is **instant**; Airbnb → database (import) runs every **30 minutes** via your cron; database → Airbnb (export) happens only when **Airbnb polls your feed — hours**, and you can't speed it up. That export lag is where all real risk lives.

---

## Rollout sequence — the operating order

Launch revenue before building the hard part. Stages 1–2 need **no new code** — only configuring venues and switching on the already-built sync. The parent-child + Hold build is pulled in only at Stage 3, when the floor goes live.

### Stage 0 — Before any launch or ad spend (no code)
- Society/RWA short-stay permission **in writing**.
- Photography + decor finished *for the camera* (terrace is the hero of the Reunion).
- Pricing set (singles for occupancy; Reunion priced above Nook + Gathering sold separately).
- **Stand up one *unpublished* Airbnb listing and run a live iCal round-trip** through the existing export/import. The sync has never seen a real Airbnb feed — prove it here before depending on it. This is the single most important de-risking step.

### Stage 1 — Launch *Terracottage Umber* (2BHK) alone
- Configure as a `self_managed` venue; run the dormant cron (`20260603_ical_cron_setup.sql`); paste export/import URLs into Airbnb.
- Sell on Airbnb (instant-book, Firm policy) **and** website (Meta ads, non-refundable advance).
- Run the block-on-email process by hand (below).
- Target: ~10 reviews, proven turnover ops, a real feel for the manual race at low volume.

### Stage 2 — Add *Terracottage Ochre* (1RK)
- Same setup. Now two dual-channel singles running concurrently — the true test of the manual-blocking burden at ad volume.

### Stage 3 — Build parent-child + Hold, turn on *Terracottage Sienna* (direct-only)
- Implement `SPEC_parent_child_listings.md` and `SPEC_hold_action_and_admin_ui.md`.
- Floor goes live last, once singles have review velocity and the SOP is trusted.

**Do not build the parent-child/Hold code before Stage 3.** It's effort spent on the floor while the rooms that fund this sit empty.

---

## Channel & cancellation policy

- **Airbnb singles:** Instant Book ON. Target ≥97% acceptance, ≥90% response. Cancellation policy = **Firm** (Strict was retired Oct 2025 and is unavailable to new listings). Note the **mandatory 24-hour grace period**: any stay under 28 nights booked >7 days out can be cancelled within 24h of booking for a full refund, regardless of policy. You cannot run "no cancellations" on Airbnb.
- **Website (all units):** non-refundable, enforced by the advance payment. Your platform, your rules.
- **Why this matters for the race:** a host-initiated cancellation for a **double-booking** is treated as preventable — fee of ~$50–$1,000 (10% >30 days out, 25% inside 30 days, 50% inside 48h), forfeited/clawed-back payout, plus ranking and Superhost damage. Every lost race has a real price tag.

---

## The race and how we handle it

Because singles are dual-channel, a website booking must close that single on Airbnb before someone instant-books it there — but the export feed is hours slow. Mitigation, day one:

1. **Instant email on booking** — already built (`notify-booking-received` / `notify-booking-confirmed`).
2. **Manually block the dates on Airbnb** within minutes of the email.
3. **iCal export feed as the backup** for anything you miss (slow, but it's the safety net).
4. **Floor uses Hold, not manual blocking** — Hold blocks the singles *before* you commit to the guest, which is strictly safer for the high-value floor.

Operational gotcha: a **manual Airbnb block does not auto-clear** when a booking is cancelled. Every manual block needs a manual release, or the date stays stuck-closed and re-imports as an `ical` block. Bake this into the SOP.

### The tripwire (pre-decided)
Track direct single-booking volume and any missed race / host-cancellation incident from Stage 1 on. When manual blocking starts failing — a race lost overnight, or volume high enough that expected Airbnb cancellation penalties exceed a Hospitable subscription — **switch the singles to Airbnb's real-time API (via Hospitable)**, which eliminates the export lag entirely. Build-your-own is right for launch; it has a known expiry tied to ad success. Decide the number now so the upgrade is planned, not a scramble.

---

## Build components (detail lives in the spec files)

- **Data model + blocking** (`SPEC_parent_child_listings.md`): `parent_venue_id` column, `'combo'` venue type, `'parent'` availability source + unique index; `export-ical` widened to carry parent blocks; `fetchBookedData` combo branch (intersection) + child query updated; `confirmBooking` fanout; cancellation cleanup; conflict-check hardening.
- **Hold + admin UI** (`SPEC_hold_action_and_admin_ui.md`): `held_at` column; three-state query → held → confirmed; `holdComboBooking` / `releaseHold`; idempotent confirm; state-aware query-card UI; parent-child surfacing; CSS.

All of this is Stage 3 work.

---

## Riskiest assumption & cheapest test

**Assumption:** the iCal sync behaves correctly against a real Airbnb feed, and Airbnb polls it fast enough for the manual+feed combo to hold.
**Test:** Stage 0's unpublished-listing round-trip, before a rupee of ad spend. Everything else in the plan is recoverable; this is the one to prove first.

---

## Open items

- Booking.com / MMT deferred. MMT needs a separate India-capable channel manager (neither your app nor Hospitable solves it) — revisit only after the floor is cash-flowing.
- `max_concurrent_setups` is 1 for all units; the multi-setup path stays correct by construction but unexercised.
- `schema.md` is stale (omits `checkout_date`); update it during Stage 3.
- Form C / foreign-guest ID capture process for any international guests.
