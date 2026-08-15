# Stage 0 — iCal Round-Trip Validation Playbook

**Goal:** Prove the two-way Airbnb ↔ website sync works against a real Airbnb feed, before any ad spend or guest traffic.  
**Venue used for test:** Terracottage Umber — `venue_id = 15`  
**Airbnb listing:** Create as Terracottage Umber, **do not publish.**

---

## Pre-flight — verify the export endpoint

Open this URL in your browser:

```
https://evmftrogyzoudiccqkya.supabase.co/functions/v1/export-ical?venue_id=15
```

**Pass:** Browser returns a text/calendar response starting with `BEGIN:VCALENDAR`.  
**Fail:** 404, 500, or no response — stop and report the error before proceeding.

---

## Leg 1 — Website → Airbnb (export)

This proves: a confirmed site booking blocks the date on Airbnb.

### Step 1 — Insert a test booking

Run in **Supabase Dashboard → SQL Editor**. Pick a future date you won't actually sell (e.g. 3 months out):

```sql
INSERT INTO bookings (venue_id, preferred_date, checkout_date, confirmed, name, email, phone)
VALUES (15, '2026-09-10', '2026-09-12', true, 'Test Guest', 'test@example.com', '0000000000');
```

### Step 2 — Confirm the feed shows it

Re-fetch the export URL in your browser:

```
https://evmftrogyzoudiccqkya.supabase.co/functions/v1/export-ical?venue_id=15
```

You should see two VEVENT blocks (one per night, Sep 10 and Sep 11). If you don't, stop — the export logic has a bug.

### Step 3 — Create the unpublished Airbnb listing

1. Go to Airbnb → **Host → Listings → Create a new listing**.
2. Property type: Apartment. Address: your DLF Phase 2 address. Name: **Terracottage Umber**.
3. Fill in the minimum required fields to get past setup (don't need to price it yet).
4. **Do NOT publish.** Keep it in draft/unlisted state.

### Step 4 — Connect the export feed to Airbnb

In your draft listing:

1. Go to **Availability** (or **Calendar** → **Availability settings** → **Sync calendars**).
2. Click **Import calendar**.
3. Paste the export URL:  
   `https://evmftrogyzoudiccqkya.supabase.co/functions/v1/export-ical?venue_id=15`
4. Name it "Picnic Stories Website". Save.

Airbnb will fetch the feed immediately on save. Check the listing calendar — Sep 10–11 should show as blocked within a few minutes.

**Pass:** Sep 10–11 blocked on Airbnb listing calendar.  
**Fail:** Dates still open after 10 min — check Airbnb's sync log (the import entry shows a "last synced" timestamp and any error).

---

## Leg 2 — Airbnb → Website (import)

This proves: a block or booking on Airbnb flows back into your DB, so the website won't double-sell those dates.

### Step 5 — Get the Airbnb export URL

In the same listing calendar → **Sync calendars** → **Export calendar**. Copy the `.ics` URL (looks like `https://www.airbnb.com/calendar/ical/XXXXXXX.ics?s=YYYYY`).

### Step 6 — Wire it to venue 15 in the DB

```sql
UPDATE venues
SET airbnb_ical_url = 'PASTE_AIRBNB_ICS_URL_HERE'
WHERE id = 15;
```

### Step 7 — Block a different date on Airbnb

In the Airbnb listing calendar, manually block a date range, e.g. **Sep 20–22** (different from the test booking so you can tell them apart).

### Step 8 — Trigger sync-ical manually

You don't need the cron for this test. In Supabase Dashboard:

1. Go to **Edge Functions → sync-ical → Invoke**.
2. Body: `{"venue_id": 15}`
3. Add header: `Authorization: Bearer <your-service-role-key>`  
   (Service role key: Dashboard → **Project Settings → API → service_role**)
4. Click **Invoke**.

The function should return a 200 with a summary like `{"synced":1,"errors":0}`.

### Step 9 — Verify the blocks landed in the DB

```sql
SELECT venue_id, date, source, status
FROM venue_availability
WHERE venue_id = 15 AND source = 'ical'
ORDER BY date;
```

**Pass:** Rows for Sep 20, 21 (and Sep 10, 11 from the export-then-reimport loop — that's expected and harmless).  
**Fail:** No rows — check the sync-ical logs in Supabase → Logs → Edge Functions for the error.

---

## Leg 2b — Verify loop prevention

The Sep 10–11 booking you inserted should appear in `source='ical'` rows after the sync (Airbnb reflected your export back). This is fine — the export-ical function **excludes** `source='ical'` rows, so they won't be re-exported to Airbnb. Confirm:

```sql
-- This should return 0 — ical rows are never re-exported
SELECT count(*) FROM venue_availability
WHERE venue_id = 15 AND source = 'ical' AND date IN ('2026-09-10', '2026-09-11');
-- The above will actually return 2 (Airbnb mirrors back).
-- The important test: re-fetch the export URL and confirm Sep 10-11
-- still appear as VEVENT (from the bookings row, not from ical rows).
-- The count of VEVENTs should stay stable, not double.
```

---

## Clean up after the test

```sql
-- Remove the test booking
DELETE FROM bookings WHERE venue_id = 15 AND preferred_date = '2026-09-10';

-- Remove the ical blocks (next sync will clear them anyway, but do it now)
DELETE FROM venue_availability WHERE venue_id = 15 AND source = 'ical';
```

Remove the manual Airbnb block (Sep 20–22) from the listing calendar. Remove the imported calendar entry from Airbnb too.

---

## Set up the cron before Stage 1 launch

The manual invoke above is fine for testing. Before you launch, run the cron:

1. Go to **Supabase Dashboard → SQL Editor**.
2. Run `20260603_ical_cron_setup.sql` (already in the repo), replacing `PASTE_YOUR_SERVICE_ROLE_KEY_HERE` with your actual service_role key.
3. Verify it's scheduled:
   ```sql
   SELECT jobname, schedule, active FROM cron.job;
   ```
   Should return one row: `sync-ical-30min | */30 * * * * | true`

> The cron is a no-op until a venue has `airbnb_ical_url` set. Safe to schedule now or later.

---

## Round-trip pass criteria summary

| Check | Expected |
|---|---|
| export-ical URL returns valid iCal | `BEGIN:VCALENDAR` in browser |
| Test booking → VEVENT in feed | Sep 10–11 in export URL response |
| Feed imported by Airbnb | Sep 10–11 blocked on Airbnb calendar |
| Airbnb block → DB | `source='ical'` rows in `venue_availability` |
| No feedback loop | VEVENT count in feed stays stable after re-sync |

All five pass → the sync is real. Proceed to Stage 1.
