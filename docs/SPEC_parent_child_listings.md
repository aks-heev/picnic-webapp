# Spec — Parent-Child Linked Listings (Phases 1-2)

**Goal:** Make *Terracottage Sienna* (full-floor combo) the parent of *Terracottage Ochre* + *Terracottage Umber*, so that confirming a Reunion booking blocks both singles (and propagates to Airbnb via the existing `export-ical`), while any single booking makes the Reunion unavailable.

**Grounding:** All references are to the current code — `venues` / `venue_availability` schema, `app.js` (`fetchBookedData` @829, `confirmBooking` @2715), and `supabase/functions/export-ical/index.ts`.

---

## Design summary (the asymmetry)

| Direction | Mechanism | Why |
|---|---|---|
| Reunion booked → block Nook + Gathering | **Stored** `source='parent'` rows on each child | Children are on Airbnb; blocks must ride `export-ical` out to Airbnb |
| Nook/Gathering booked → block Reunion | **Computed** at read time (intersection of children) | Reunion is direct-only, never exported; no need to store |

`venue_availability.booking_id` already has `ON DELETE CASCADE`, so deleting a combo booking auto-removes its parent blocks. Un-confirming (without delete) requires a manual cleanup (below).

---

## 1. Migration — `supabase/20260604_parent_child.sql`

```sql
-- ============================================================
-- Migration: parent-child linked listings (combo venue)
-- Additive / safe. Adds combo venue type, parent link, and the
-- 'parent' availability source used to block children when the
-- whole floor is booked.
-- ============================================================

-- 1. Parent link: a child single points at its combo parent.
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS parent_venue_id bigint
    REFERENCES venues (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS venues_parent_idx ON venues (parent_venue_id);

-- 2. Allow the 'combo' venue type (direct-only whole-floor unit).
--    Inline CHECK from 20260526_venues.sql is auto-named venues_type_check.
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_type_check;
ALTER TABLE venues ADD CONSTRAINT venues_type_check
  CHECK (type IN ('self_managed','partner_bnb','custom','combo'));

-- 3. Allow source='parent' on venue_availability (combo-origin child blocks).
ALTER TABLE venue_availability DROP CONSTRAINT IF EXISTS venue_availability_source_check;
ALTER TABLE venue_availability ADD CONSTRAINT venue_availability_source_check
  CHECK (source IN ('admin','booking','ical','parent'));

-- 4. One parent block per child venue+date (mirrors va_ical_unique).
--    booking_id ties each block to the combo booking that created it.
CREATE UNIQUE INDEX IF NOT EXISTS va_parent_unique
  ON venue_availability (venue_id, date)
  WHERE source = 'parent' AND time_slot IS NULL;
```

### Wire the three venues (run once, adjust names to your real rows)

```sql
-- Reunion = combo parent (direct-only, no Airbnb feed)
UPDATE venues SET type = 'combo', airbnb_ical_url = NULL
  WHERE name = 'Terracottage Sienna';

-- Nook + Gathering point at the Reunion as their parent
UPDATE venues SET parent_venue_id = (SELECT id FROM venues WHERE name = 'Terracottage Sienna')
  WHERE name IN ('Terracottage Ochre', 'Terracottage Umber');
```

RLS needs no change: `anon` already has SELECT on `venue_availability` (public calendar) and the admin `authenticated` role already has full write (used by `confirmBooking`).

---

## 2. `export-ical` — include parent blocks

**File:** `supabase/functions/export-ical/index.ts`. The busy-set query currently pulls only `source='admin'` full-day rows. Widen it so combo-origin child blocks are exported to Airbnb.

```ts
// BEFORE
supabase.from("venue_availability").select("date")
  .eq("venue_id", venueId).eq("source", "admin").is("time_slot", null),

// AFTER  — parent blocks are full-day, no PII, must reach Airbnb
supabase.from("venue_availability").select("date")
  .eq("venue_id", venueId).in("source", ["admin", "parent"]).is("time_slot", null),
```

The downstream loop `for (const r of adminRes.data || []) busy.add(r.date)` already absorbs the extra rows. Update the header comment's "Busy set" line to read `admin + parent full-day blocks UNION confirmed site bookings…`. Loop-prevention is unaffected (`ical` is still excluded).

---

## 3. `fetchBookedData` — two changes (`app.js` @829)

### 3a. Children count parent blocks (self_managed branch, ~line 872)

```js
// BEFORE
supabase.from('venue_availability').select('date').eq('venue_id', venueId).in('source', ['admin', 'ical']),

// AFTER
supabase.from('venue_availability').select('date').eq('venue_id', venueId).in('source', ['admin', 'ical', 'parent']),
```

This makes the public site + conflict check show a single as blocked when the whole floor is booked.

### 3b. New `combo` branch (Reunion availability = intersection of children)

Add before the closing of `fetchBookedData`, as a new `else if`:

```js
} else if (venueType === 'combo') {
  // Reunion is unavailable on any night where ANY child is occupied,
  // plus the combo's own admin blocks. Children's confirmed combo
  // bookings already appear as source='parent' rows, so they're counted here.
  const { data: kids, error: kErr } = await supabase
    .from('venues').select('id').eq('parent_venue_id', venueId)
  if (kErr) throw kErr
  const childIds = (kids || []).map(k => k.id)

  const [ownBlocks, childBlocks, childBookings] = await Promise.all([
    supabase.from('venue_availability').select('date')
      .eq('venue_id', venueId).in('source', ['admin', 'ical', 'parent']),
    childIds.length
      ? supabase.from('venue_availability').select('date')
          .in('venue_id', childIds).in('source', ['admin', 'ical', 'parent'])
      : Promise.resolve({ data: [] }),
    childIds.length
      ? supabase.from('bookings').select('preferred_date, checkout_date')
          .in('venue_id', childIds).eq('confirmed', true)
      : Promise.resolve({ data: [] }),
  ])

  const blocked = new Set()
  for (const r of ownBlocks.data || [])   blocked.add(r.date)
  for (const r of childBlocks.data || []) blocked.add(r.date)
  // any confirmed child stay night blocks the whole floor, regardless of child capacity
  for (const b of childBookings.data || []) {
    const s = new Date(b.preferred_date + 'T00:00:00')
    const e = b.checkout_date
      ? new Date(b.checkout_date + 'T00:00:00')
      : new Date(s.getTime() + 86400000)
    for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) blocked.add(localDateStr(d))
  }

  // Reuse the self_managed return shape: everything is binary-blocked, capacity 1.
  return { venueType: 'combo', adminBlockedDates: blocked, bookingCountMap: new Map(), maxConcurrentSetups: 1 }
}
```

The calendar renderer already treats `adminBlockedDates` as unavailable, so no render-side change is needed.

---

## 4. `confirmBooking` — combo conflict check + fanout (`app.js` @2715)

Two additions. Compute the requested night range once near the top of the `try` (the self_managed branch already builds `reqStart`/`reqEnd` locally — lift them so the combo branch can reuse them, or recompute identically).

### 4a. Conflict check before confirming a combo

Add a branch alongside the existing `cafe` / `self_managed` checks:

```js
} else if (venueType === 'combo' && preferredDate) {
  const { data: kids, error: kErr } = await supabase
    .from('venues').select('id').eq('parent_venue_id', venueId)
  if (kErr) throw kErr
  const childIds = (kids || []).map(k => k.id)

  const [blk, bk] = await Promise.all([
    childIds.length
      ? supabase.from('venue_availability').select('date')
          .in('venue_id', childIds).in('source', ['admin', 'ical', 'parent'])
      : Promise.resolve({ data: [] }),
    childIds.length
      ? supabase.from('bookings').select('preferred_date, checkout_date')
          .in('venue_id', childIds).eq('confirmed', true)
      : Promise.resolve({ data: [] }),
  ])

  const occupied = new Set((blk.data || []).map(r => r.date))
  for (const b of bk.data || []) {
    const s = new Date(b.preferred_date + 'T00:00:00')
    const e = b.checkout_date ? new Date(b.checkout_date + 'T00:00:00') : new Date(s.getTime() + 86400000)
    for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) occupied.add(localDateStr(d))
  }

  const reqStart = new Date(preferredDate + 'T00:00:00')
  const reqEnd   = checkoutDate ? new Date(checkoutDate + 'T00:00:00') : new Date(reqStart.getTime() + 86400000)
  for (let d = new Date(reqStart); d < reqEnd; d.setDate(d.getDate() + 1)) {
    const ds = localDateStr(d)
    if (occupied.has(ds)) {
      showToast(`Cannot confirm: ${ds} is already taken on a single unit inside the floor.`, 'error')
      return
    }
  }
}
```

### 4b. Fanout after the confirm `UPDATE`

Right after the existing `.update({ confirmed: true, advance_amount: advanceAmount })` succeeds:

```js
if (venueType === 'combo') {
  const { data: kids } = await supabase
    .from('venues').select('id').eq('parent_venue_id', venueId)
  const rows = []
  const s = new Date(preferredDate + 'T00:00:00')
  const e = checkoutDate ? new Date(checkoutDate + 'T00:00:00') : new Date(s.getTime() + 86400000)
  for (const k of kids || []) {
    for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
      rows.push({
        venue_id: k.id, date: localDateStr(d),
        status: 'blocked', source: 'parent', booking_id: queryId, time_slot: null,
      })
    }
  }
  if (rows.length) {
    const { error: pErr } = await supabase.from('venue_availability').insert(rows)
    if (pErr) throw pErr   // unique index prevents partial double-block; surface and stop
  }
}
```

Pass `venueType` through to `confirmBooking` for combo rows the same way it's already passed for cafe/self_managed (the admin bookings list renderer @4745 already supplies `venueType`).

---

## 5. Cancellation / un-confirm cleanup

- **Delete booking:** handled automatically — `venue_availability.booking_id` is `ON DELETE CASCADE`, so parent blocks vanish with the combo booking.
- **Un-confirm (set `confirmed=false`) without delete:** add explicit cleanup wherever that action lives:

```js
await supabase.from('venue_availability')
  .delete().eq('source', 'parent').eq('booking_id', bookingId)
```

Put this in the same handler that flips `confirmed` back to false so the singles re-open.

---

## 6. Hardening (recommended, low effort)

The existing `self_managed` conflict check in `confirmBooking` (@2753) counts only the `bookings` table — it does **not** look at `venue_availability` blocks. A child single could therefore be confirmed on a night that's `parent`-blocked. Add a block check to that branch:

```js
const { data: vaBlocks } = await supabase.from('venue_availability')
  .select('date').eq('venue_id', venueId).in('source', ['admin', 'ical', 'parent'])
const blockedSet = new Set((vaBlocks || []).map(r => r.date))
// inside the per-night loop, also: if (blockedSet.has(ds)) { showToast(...); return }
```

This closes the admin-side path; the customer-facing calendar already hides these dates via 3a.

---

## 7. The lag buffer (operational, ties to Phase 4 SOP)

Fanout in 4b writes child blocks the instant you confirm — which starts Airbnb's import clock immediately. But Airbnb polls `export-ical` on its own schedule (hours), so do **not** promise the Reunion guest instantly. Sequence: receive request → confirm (writes blocks) → wait one cron + Airbnb poll cycle → then tell the guest it's locked. Optional enhancement: a separate "Hold" admin button that runs only the 4b fanout (without `confirmed=true`) to start the clock before you commit to the guest; release on decline via the §5 cleanup.

---

## Test checklist

1. Migration applies cleanly; `va_parent_unique` and the widened CHECKs exist.
2. Confirm a fake Reunion booking → both children show `source='parent'` rows for every night; both children's `export-ical?venue_id=X` output includes those dates; public calendar shows both singles blocked.
3. Confirm a single on a date → Reunion calendar (combo branch) shows that date blocked.
4. Attempt to confirm a Reunion over a night a single already holds → blocked with the §4a toast.
5. Delete the combo booking → parent rows gone (CASCADE). Un-confirm it → parent rows gone (§5).
6. Re-run the existing 14/14 export round-trip with `source='parent'` rows present; confirm a 404 Airbnb feed still doesn't wipe blocks.
