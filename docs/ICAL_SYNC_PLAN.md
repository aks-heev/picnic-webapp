# Airbnb ↔ Website iCal Sync — Implementation Plan

**Status:** BUILT & verified on the live project (2026-06-03); dormant until a listing exists. Supersedes the earlier `partner_bnb`-focused handoff.
**Last updated:** 2026-06-03

## Build status (2026-06-03)

**Done & deployed on project `evmftrogyzoudiccqkya`:**
- Migration `20260603_ical_sync.sql` applied: `venues.airbnb_ical_url` / `last_ical_sync_at` / `last_ical_sync_status`; `source` CHECK widened to `('admin','booking','ical')`; partial unique `va_ical_unique`; `SECURITY DEFINER replace_ical_blocks()` (granted to `service_role` only).
- Edge functions deployed: **`export-ical`** (public, `verify_jwt=false`) and **`sync-ical`** (protected, `verify_jwt=true`). `supabase/config.toml` pins both.
- Frontend (`app.js` / `index.html` / `style.css`): public calendar read (`app.js:872`) and self_managed conflict check now count `ical`; admin availability tab fetches + renders imported blocks read-only (badge "Airbnb"); venue form has the Airbnb iCal URL field; availability tab shows the copyable export URL, last-sync status, and a "Sync now" button. Production build passes.
- **Verified:** 10/10 parser unit tests (exclusive DTEND, CANCELLED, multi-day, folded lines, datetime form, round-trip parity); live `export-ical` output exactly matched the SQL-computed busy set with zero PII; live round-trip import (triggered via `pg_net`, anon bearer) reproduced the export set exactly (14/14, no drift); failure test confirmed a 404 feed does **not** wipe existing `ical` rows (status flips to error, rows survive).

> **✅ FULLY LIVE (2026-07-06):** every "Remaining" item below is done — cron running, listings
> wired (Umber/Ochre/Sienna), sync at v10 / export at v11 after the July linked-listing loop fixes.
> See CLAUDE.md handoffs 2026-07-02/05 for the loop post-mortem. Kept for reference.

**Remaining (need credentials or a live listing — cannot be automated here):**
1. Run `supabase/20260603_ical_cron_setup.sql` once — pastes your `service_role` key into Vault, enables `pg_cron`, schedules the 30-min sync. No-op until a venue has `airbnb_ical_url`, so safe to run now or at go-live.
2. Per listing: set the venue's Airbnb iCal URL (admin venue form), then paste this site's `export-ical?venue_id=X` URL into Airbnb → Availability → Import calendar.
3. `max_concurrent_setups > 1` path is correct by construction but unexercised (every self_managed venue is 1; no multi-setup venue exists to test against).

---

## Scope correction (read this first)

The original handoff scoped iCal sync to **`partner_bnb`** venues. That is wrong. The
venues that need two-way Airbnb sync are **`self_managed`**:

- **`self_managed`** — dual-listed on the website *and* Airbnb, and take real date-range
  stay bookings on **both** platforms. These are the only venues that can double-book, so
  these are what we keep in sync.
- **`partner_bnb`** — **out of scope.** The guest books the stay on Airbnb, then books
  picnic *services* on our site. We never hold the BnB calendar, so there is no collision
  to reconcile.

The engine is driven off **`venues.airbnb_ical_url IS NOT NULL`**, not off venue type. You
enable sync per venue by setting that column (you'll set it on self_managed listings). This
keeps the engine type-agnostic and lets `partner_bnb` opt in later if that ever changes.

`self_managed` already has everything the old plan was missing for `partner_bnb`: a public
availability calendar, `checkout_date`, the full booking flow, and `max_concurrent_setups`.

---

## Current-state facts (grounded in code — trust these)

- **`venue_availability` is NOT a full source of truth anymore.** The
  `20260603_concurrent_setups.sql` migration ran `DELETE FROM venue_availability WHERE
  source='booking'`. It now holds **`source='admin'` rows only**.
- **self_managed availability** (`app.js:868–893`, the non-café branch) is computed as:
  admin blocks (`source='admin'`) **∪** confirmed `bookings` expanded over
  `preferred_date … checkout_date`, with per-date occupancy counted against
  `venues.max_concurrent_setups` (default 1).
- **`checkout_date` exists** on `bookings` and is used throughout (`app.js:873`, `884`, etc.).
  self_managed bookings store real date ranges. (Note: `schema.md` is stale and omits it.)
- **No `supabase/config.toml` exists** → edge functions deploy with `verify_jwt = true` by
  default. A public endpoint must explicitly opt out.
- **Unique constraints on `venue_availability`:** the original global
  `UNIQUE(venue_id, date, source)` was **dropped** in `20260603_venue_availability_slots.sql`
  and replaced with two partial unique indexes scoped to `source='admin'`. There is currently
  **no uniqueness for `source='ical'` rows** — we add one.
- **Existing edge-function pattern:** `supabase/functions/<name>/index.ts`, `Deno.serve`,
  shared helpers in `_shared/` (e.g. `resend.ts`), `Deno.env.get(...)`. Existing functions are
  triggered by **DB webhooks**; none use the service-role key or cron yet. iCal is plain text,
  so no new Deno packages are needed.

---

## Operating constraints (as of 2026-06-03)

- **No property is listed on Airbnb yet.** The feature is **dormant until** (a) a listing
  exists, (b) its Airbnb export URL is set on `venues.airbnb_ical_url`, and (c) the
  `export-ical` URL is imported into Airbnb. Neither direction can be integration-tested
  end-to-end until at least one listing exists. Until then, validate with synthetic `.ics`
  fixtures (parser) and by inspecting `export-ical` output. **Real round-trip validation is
  gated on a live listing** — stand up even one unpublished listing to get a real export URL
  and feed before go-live. The import side (which writes/reconciles availability) is the
  higher-risk half and the one with no live feed to test against right now.
- **All self_managed BnBs run `max_concurrent_setups = 1`.** The capacity-aware export
  threshold (`count >= max_concurrent_setups`) therefore collapses to "any confirmed booking
  blocks the date." Keep the column reference so the logic stays correct if that ever changes,
  but the multi-setup path won't be exercised by real data.

---

## Core model

A self_managed date is **unavailable** when any of these hold:

1. Admin block — `venue_availability` row with `source='admin'`, `time_slot IS NULL`
2. Imported Airbnb block — `venue_availability` row with `source='ical'`
3. Confirmed site bookings on that date reaching `max_concurrent_setups`

- The **website shows** that union.
- **Export pushes** that union to Airbnb **minus the `ical` part**.

**Loop-prevention rule:** export must never include `source='ical'` rows. Re-exporting
Airbnb's own imported reservations back to Airbnb is the classic two-way-sync feedback loop.
Export only website-origin unavailability (admin blocks + confirmed site bookings).

---

## Build steps (in order)

### 1. DB migration — `supabase/20260603_ical_sync.sql`
- `ALTER TABLE venues` add: `airbnb_ical_url text`, `last_ical_sync_at timestamptz`,
  `last_ical_sync_status text`.
- Update the `venue_availability.source` CHECK constraint to
  `CHECK (source IN ('admin','booking','ical'))`.
- Add a partial unique index so the importer is idempotent:
  `CREATE UNIQUE INDEX va_ical_unique ON venue_availability (venue_id, date)
   WHERE source='ical' AND time_slot IS NULL;`
- Add the reconcile function used by step 2 (atomic swap):
  `replace_ical_blocks(p_venue_id bigint, p_dates date[])` — in one transaction, delete
  `source='ical'` rows for the venue **not in** `p_dates`, and insert the missing ones.
  `SECURITY DEFINER`.

### 2. Edge function `sync-ical` (Airbnb → site) — failure-safe
- Service-role client (bypasses RLS). Loop over venues where
  `airbnb_ical_url IS NOT NULL AND is_active`, **each in its own try/catch** so one bad feed
  doesn't abort the batch.
- Per venue: fetch the `.ics` (with timeout), **verify it parses as a VCALENDAR before
  touching the DB.** Parse VEVENTs:
  - **`DTEND` is exclusive** — block `[DTSTART, DTEND)`. Mirror `app.js:887` (`d < end`) and
    the `… - interval '1 day'` convention in `20260530_venue_availability.sql`. Getting this
    wrong over-blocks every reservation by one night.
  - Skip `STATUS:CANCELLED`. Dedup repeated events.
  - **Operate on `YYYY-MM-DD` strings, not `Date` objects.** The function runs in UTC and
    Airbnb all-day dates are floating; `Date` arithmetic introduces off-by-one shifts.
- **Reconcile atomically** by calling `replace_ical_blocks(venue_id, dates[])`. Never
  delete-then-insert as separate steps — if the fetch returns empty/garbage after a delete,
  the venue shows fully open and gets double-booked.
- Update `last_ical_sync_at` / `last_ical_sync_status` **only on success.**
- Return a per-venue summary.

### 3. Edge function `export-ical` (site → Airbnb) — public
- `GET /functions/v1/export-ical?venue_id=X`.
- **Deploy public:** add `supabase/config.toml` with `[functions.export-ical] verify_jwt = false`
  (or deploy `--no-verify-jwt`). Otherwise Airbnb's anonymous fetch gets a 401 and the import
  silently fails.
- Build the busy set:
  - Admin full-day blocks (`source='admin'`, `time_slot IS NULL`).
  - Confirmed bookings expanded over `preferred_date … checkout_date`, emitting a date only
    where `count >= max_concurrent_setups` (**capacity-aware** — don't mark a 2-setup venue
    full after one booking).
  - **Exclude `source='ical'`** (loop prevention).
- Emit a valid `VCALENDAR`: all-day VEVENTs, **`DTEND` exclusive** (`date d` → `DTSTART d`,
  `DTEND d+1`; optionally merge consecutive dates into ranges), stable `UID`s, `DTSTAMP`,
  `PRODID`, `SUMMARY:Reserved`. **No guest PII** — no names, emails, or `external_booking_ref`.
- `Content-Type: text/calendar`.

### 4. Scheduler
- Enable **both `pg_cron` and `pg_net`** extensions (the original plan named only `pg_cron`;
  `pg_net`/`net.http_post` is what actually makes the HTTP call from Postgres).
- Store the service-role key in **Supabase Vault**.
- Cron every 30 min:
  `select net.http_post(url := '<project>/functions/v1/sync-ical',
   headers := jsonb_build_object('Authorization','Bearer '||<service_key>,
   'Content-Type','application/json'));`
- `sync-ical` stays **JWT-protected** (the service-role bearer passes default
  `verify_jwt=true`). Only `export-ical` is public.

### 5. Surface imported blocks on existing calendars
This is the gap that otherwise makes `ical` rows invisible. Widen the self_managed read paths
from `.eq('source','admin')` to `.in('source', ['admin','ical'])`:
- Public booking calendar — `app.js:872`.
- Admin availability tab — `app.js:3681+` (full-day block fetch).
- Verify the pre-submit conflict check (`app.js:1803–1856`) counts `ical` rows so a synced
  date actually rejects a booking.
- Render `ical` blocks as read-only "From Airbnb" so the owner can't hand-delete a synced
  block (sync owns those rows).

### 6. Admin UI (`app.js`)
- `airbnb_ical_url` input in the venue edit form for self_managed.
- In the availability tab: copyable **export URL** (`/functions/v1/export-ical?venue_id=X`) to
  paste into Airbnb, `last_ical_sync_at` + status display, and a **"Sync now"** button (admin
  is authenticated and can invoke `sync-ical` directly).

### 7. Verification
**Until a property is actually listed on Airbnb, both directions can only be tested against
synthetic fixtures — real end-to-end round-trip validation is gated on a live listing.**
- Parser unit tests against a **sample Airbnb `.ics` fixture**: exclusive DTEND, multi-day
  stays, `CANCELLED`, all-day vs datetime VEVENTs.
- **Failure test:** point sync at an empty/garbage URL → confirm existing `ical` rows survive
  (no wipe).
- **Capacity test:** `max_concurrent_setups=2` → export keeps the date open after one booking,
  closes it after two.
- **Round-trip:** block a date on the site → `export-ical` shows the VEVENT with correct
  exclusive DTEND. Import a sample Airbnb ICS → site calendar blocks the date and rejects a
  booking on it.

---

## External / manual setup (not codeable)

1. **Airbnb export URL** per self_managed listing: Airbnb Hosting → [Listing] → Availability →
   Export Calendar. Paste into `venues.airbnb_ical_url` via the admin UI.
2. **Service-role key in Supabase Vault** (for the cron → `sync-ical` call).
3. **Enable `pg_cron` and `pg_net`** extensions (Supabase → Database → Extensions).
4. **Airbnb import URL:** after `export-ical` is deployed, paste its endpoint into
   Airbnb → Availability → Sync calendars → Import calendar, per listing.

---

## Residual risk (cannot be engineered away)

Airbnb polls imported calendars on **its own cadence (often hours, not minutes)**, and fetches
our export on its own schedule too. A booking on either side can still collide inside the
propagation lag. 30-minute sync shrinks the window; it never closes it. For high-demand dates
where that window is unacceptable, the only real fix is not dual-listing those dates.
