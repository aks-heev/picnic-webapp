# The Picnic Stories — Linked-Listing Implementation Plan

**Property:** Full floor, DLF Phase 2, Gurugram (2BHK + 1RK, combinable into a 3BHK whole-floor + terrace)
**Date:** 2026-06-04
**Status:** Planning

---

## Locked decisions

- **Build approach:** Extend the existing app. Do **not** buy Hospitable. The two-way Airbnb iCal sync (`export-ical` + `sync-ical` + 30-min cron) is already built, deployed, and verified — dormant until a live listing exists. For three units on one floor, that is enough.
- **Configuration:** Flexible / linked listings.
- **Naming (guest-intent system):** *Terracottage Ochre* (1RK) · *Terracottage Umber* (2BHK) · *Terracottage Sienna* (full floor + terrace).
- **Channel policy:** Singles on Airbnb with **Instant Book ON**. Terracottage Sienna is **direct-only, confirmation-required**. Airbnb + direct site only for now (Booking.com / MMT deferred).

---

## The core idea in one paragraph

The two singles never overlap each other, so on Airbnb they run as clean, independent, instant-book listings — full ranking, no arbitration. Terracottage Sienna is not a fourth apartment; it is the *parent* of the two singles. It is sold only on your own site with manual confirmation. The hard problem — making a Reunion booking block the singles on Airbnb — is solved by your existing iCal export, **plus** the manual confirmation window, which deliberately acts as the buffer that absorbs Airbnb's slow iCal polling before you finalize the guest. Nothing about this needs a paid PMS.

---

## The one new concept: parent-child venues with *asymmetric* blocking

Today the schema has `max_concurrent_setups` (concurrency *within* one venue) but **no relationship between venues**. That is the only real gap. We add a parent-child link between *Terracottage Sienna* (parent) and *Terracottage Ochre* + *Terracottage Umber* (children), and we block in **two directions, by two different mechanisms**:

- **Parent → child (stored blocks):** When a Reunion booking is confirmed, write date blocks onto both children. These must reach Airbnb, so they ride the existing `export-ical` feed. *Stored*, because Airbnb needs to see them.
- **Child → parent (computed):** When either single is booked, the Reunion is no longer sellable for those nights. Because the Reunion is direct-only (never on Airbnb, no export needed), this needs no stored block — compute the Reunion's availability as the *intersection* of its children's availability, in-app, at read time.

This asymmetry is the whole design. It keeps the export feed honest and avoids reconciliation headaches on the child→parent side.

---

## Phase 0 — Listing & content prerequisites (parallel, non-engineering)

These gate revenue more than the code does.

1. **Confirm short-stay permission in writing** from the society/RWA (you said it's allowed — get it on paper before furnishing spend).
2. **Decor + setup** scoped *for the camera*. The terrace is the hero of *Terracottage Sienna* — shoot it at golden hour.
3. **Professional photography** — the single biggest conversion lever. Separate photo sets for Nook, Gathering, and the combined Reunion (incl. terrace).
4. **Create the two Airbnb listings** (Nook, Gathering) as *unpublished* drafts to obtain real export/import URLs for round-trip testing. Do **not** create an Airbnb listing for the Reunion.
5. **Form C / guest ID capture** plan for any foreign guests (legal requirement in India).

---

## Phase 1 — Data model: parent-child relationship

1. Migration: add `parent_venue_id int8 NULL REFERENCES venues(id)` to `venues` (the two singles point at the Reunion), **or** a `venue_links` join table if you want many-to-many later. Start with the column; it's simpler.
2. Add a venue role flag so the app can branch: extend `venues.type` CHECK to include `'combo'` (the Reunion), or add `is_combo bool`. The combo is direct-only and never gets an `airbnb_ical_url`.
3. Seed the three venue rows: Nook + Gathering (`self_managed`, each with its own `airbnb_ical_url`), Reunion (`combo`, `parent` of both, no Airbnb URL).
4. Decide the block source tag for parent→child fanout. **Recommended:** a new `source='parent'` value plus a `blocked_by_booking_id` reference column on `venue_availability`, so the blocks are cleanly reversible on cancellation and visibly distinct from manual `admin` blocks. (Reusing `'admin'` works but muddies reconciliation.)

---

## Phase 2 — Blocking logic

**Parent → child fanout (on Reunion confirm):**

1. On confirmation of a `combo` booking, expand its nights `[preferred_date, checkout_date)` and upsert `venue_availability` rows (`source='parent'`, `blocked_by_booking_id=<id>`) on **both** child venues.
2. On Reunion cancellation, delete the rows keyed by `blocked_by_booking_id`.
3. Update `export-ical` to include `source='parent'` rows in the busy set (it currently exports `source='admin'` + confirmed bookings, excludes `'ical'`). One line in the query.
4. The public calendar + conflict check (`app.js` self_managed branch, ~line 871) already counts `['admin','ical']` — add `'parent'` so children correctly show as blocked on the site too.

**Child → parent computed availability:**

5. For the Reunion venue, compute availability as: a night is available **only if every child venue is free that night** (no admin/ical/parent block, and below `max_concurrent_setups` confirmed bookings). Implement as a dedicated branch in the availability function; do not store these.

---

## Phase 3 — Go live the dormant sync

The sync is built and tested; it just needs switching on per the `ICAL_SYNC_PLAN.md` "Remaining" list.

1. Run `supabase/20260603_ical_cron_setup.sql` once (pastes service-role key into Vault, enables `pg_cron`, schedules the 30-min import). No-op until a venue has an `airbnb_ical_url`, so safe to run now.
2. For Nook and Gathering: set each venue's Airbnb iCal **import** URL in the admin venue form, and paste each `export-ical?venue_id=X` URL into Airbnb → Availability → Import calendar.
3. Terracottage Sienna gets **no** iCal wiring (direct-only).

---

## Phase 4 — Admin SOP: the hold-then-confirm buffer (this is what makes it safe)

The residual risk is the lag between confirming a Reunion booking and Airbnb re-polling your export feed. The manual confirmation window is the mitigation — bake it into the workflow:

1. Reunion request lands on the site as **unconfirmed** (your existing model already inserts every booking unconfirmed; admin confirms via the SECURITY DEFINER RPC).
2. **Hold first:** admin action writes the parent→child blocks *immediately* on receipt (before confirming the guest). This starts Airbnb's import clock right away.
3. **Wait out the lag:** hold the guest's confirmation for a safe interval (e.g., until the next cron + Airbnb poll cycle, or a fixed buffer you set in the confirm copy — "we'll confirm within X hours").
4. **Confirm:** once the singles are blocked everywhere, confirm the Reunion guest and take payment.
5. On decline/expiry, release the held child blocks.

Document this as a one-page runbook for whoever staffs bookings.

---

## Phase 5 — Channel policies

1. **Airbnb (singles):** Instant Book ON for both Nook and Gathering. Target ≥97% acceptance, ≥90% response rate. Do not run request-to-book on the singles.
2. **Direct site (Reunion):** confirmation-required flow per Phase 4. Lead with the terrace + whole-floor framing; this captures the group/event demand that books direct anyway and dodges OTA fees.
3. **Pricing:** singles priced for occupancy; Reunion priced at a premium that exceeds Nook + Gathering sold separately (the whole-floor + terrace justifies it). Consider a dynamic-pricing tool later.

---

## Phase 6 — Test & verification

1. **Synthetic:** unit-test the parent→child fanout (nights expansion, exclusive checkout, cancellation cleanup) and the child→parent intersection logic. Reuse the existing `.ics` parser fixtures.
2. **Live single-listing round-trip:** with one unpublished Airbnb listing, verify export busy-set == SQL-computed busy-set (the existing 14/14 round-trip check), now including `source='parent'` rows.
3. **End-to-end dry run:** create a fake Reunion booking → confirm → assert both children show blocked on the public site, in the conflict check, and in each child's `export-ical` output.
4. **Failure mode:** confirm a 404/empty Airbnb feed does not wipe existing blocks (already verified for `ical`; re-verify after adding `'parent'`).

---

## Sequencing recommendation

Don't launch three cold listings at once. **Launch *Terracottage Umber* (2BHK) first** — best rate-to-frequency balance, fastest path to ~10 reviews and Airbnb ranking. Add *Terracottage Ochre* once turnover ops are proven. Switch on the Reunion (direct + parent-child blocking) last, once the singles have review velocity and you trust the SOP. Flexible is the destination, not the launch state.

---

## Risks & open items

- **iCal propagation lag** is real but contained to the Reunion→singles path and covered by the Phase 4 buffer. If you ever make the Reunion instant-bookable, this mitigation breaks — don't.
- **`max_concurrent_setups`** is 1 for all units; the multi-setup export path stays correct by construction but remains unexercised.
- **Booking.com / MMT** deferred. MMT in particular needs a separate India-capable channel manager — neither your app nor Hospitable solves it. Revisit only after the floor is cash-flowing.
- **`schema.md` is stale** (omits `checkout_date`); update it as part of Phase 1.
