# Spec — Hold Action + Admin UI (Phase 4 addendum)

**Builds on:** `SPEC_parent_child_listings.md`. That spec made the Reunion the parent and added fanout-on-confirm. This adds the **Hold** state so you can block the singles and start Airbnb's sync clock *before* committing to the combo guest — shrinking the blast radius of the iCal propagation lag.

**Scope:** Hold is **combo-only**. The instant-book singles don't need it.

---

## State model

```
query   →  held            →  confirmed
(new)      (singles blocked,   (guest locked,
            guest NOT told,      payment taken)
            Airbnb syncing)
```

- **query:** `held_at IS NULL`, `confirmed = false` — what every booking starts as.
- **held:** `held_at IS NOT NULL`, `confirmed = false` — parent blocks written, Airbnb importing, guest not yet committed.
- **confirmed:** `confirmed = true` — moves to the Bookings tab.

A combo booking should normally go query → held → confirmed. Non-combo bookings keep the existing one-step Confirm.

---

## 1. Migration — `supabase/20260604_hold_action.sql`

```sql
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS held_at timestamptz;
```

That's it. "Held" is `held_at IS NOT NULL AND confirmed = false`; the parent blocks themselves already carry `booking_id` from the main spec.

---

## 2. `loadQueries` — select the new fields (`app.js` @2407)

Add `held_at` and confirm the venue join exposes `type` (it already does — `query.venues.type` is used in `renderQueries`):

```js
// in the .select(...) for queries, ensure these are present:
//   held_at, checkout_date, venue_id, venues ( id, name, type, area )
```

Keep `.eq('confirmed', false)` so both query and held bookings stay in this tab until confirmed.

---

## 3. `holdComboBooking` — new function (mirror of confirmBooking 4a+4b, without `confirmed`)

```js
async function holdComboBooking(queryId, venueId, preferredDate, checkoutDate) {
  if (!appState.session) return showToast('Admin login required', 'error')
  try {
    const { data: kids, error: kErr } = await supabase
      .from('venues').select('id').eq('parent_venue_id', venueId)
    if (kErr) throw kErr
    const childIds = (kids || []).map(k => k.id)

    // ── Conflict check: every child must be free for every requested night
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

    const s = new Date(preferredDate + 'T00:00:00')
    const e = checkoutDate ? new Date(checkoutDate + 'T00:00:00') : new Date(s.getTime() + 86400000)
    for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
      if (occupied.has(localDateStr(d))) {
        showToast(`Can't hold: ${localDateStr(d)} is already taken on a single inside the floor.`, 'error')
        return
      }
    }

    // ── Fanout: write parent blocks for every child × every night
    const rows = []
    for (const k of kids || []) {
      for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
        rows.push({ venue_id: k.id, date: localDateStr(d), status: 'blocked', source: 'parent', booking_id: queryId, time_slot: null })
      }
    }
    if (rows.length) {
      const { error: pErr } = await supabase.from('venue_availability').insert(rows)
      if (pErr) throw pErr
    }

    // ── Mark held (NOT confirmed)
    const { error: hErr } = await supabase.from('bookings').update({ held_at: new Date().toISOString() }).eq('id', queryId)
    if (hErr) throw hErr

    showToast('Floor held — singles blocked. Wait for Airbnb to sync before confirming.', 'success')
    loadQueries()
  } catch (err) {
    console.error(err)
    showToast('Failed to hold floor', 'error')
  }
}
```

---

## 4. `releaseHold` — new function (decline / let go)

```js
async function releaseHold(queryId) {
  if (!appState.session) return showToast('Admin login required', 'error')
  try {
    const { error: dErr } = await supabase.from('venue_availability')
      .delete().eq('source', 'parent').eq('booking_id', queryId)
    if (dErr) throw dErr
    const { error: uErr } = await supabase.from('bookings')
      .update({ held_at: null }).eq('id', queryId)
    if (uErr) throw uErr
    showToast('Hold released — singles re-opened.', 'success')
    loadQueries()
  } catch (err) {
    console.error(err)
    showToast('Failed to release hold', 'error')
  }
}
```

This is also the §5 cleanup from the main spec, now wired to a button.

---

## 5. `confirmBooking` — make the combo fanout idempotent (amends main spec §4b)

A held booking already has its parent blocks, so re-inserting on Confirm would hit `va_parent_unique`. Guard the §4b fanout: skip it if the blocks already exist.

```js
if (venueType === 'combo') {
  // already held? blocks exist — don't re-insert, just confirm.
  const { data: existing } = await supabase.from('venue_availability')
    .select('id').eq('source', 'parent').eq('booking_id', queryId).limit(1)
  if (!existing || existing.length === 0) {
    // ...the §4b fanout insert from the main spec...
  }
}
```

Also clear nothing else — `held_at` can stay set on a confirmed row (it's just a timestamp of when you held). Optionally `held_at: null` in the confirm update if you'd rather not keep it.

---

## 6. Query-card UI (`renderQueries` @2476)

Replace the single Confirm button in `.adm-card-footer` with state-aware actions. Compute per card:

```js
const isCombo = query.venues?.type === 'combo'
const isHeld  = !!query.held_at
const heldAgo = isHeld ? formatTimeAgo(new Date(query.held_at)) : ''
```

Footer logic:

```js
${isCombo && isHeld ? `
  <div class="adm-hold-banner">
    <span class="adm-hold-dot"></span>
    On hold · singles blocked ${escapeHtml(heldAgo)} — confirm once Airbnb has synced
  </div>` : ''}

<div class="adm-card-footer">
  ${isCombo && !isHeld ? `
    <button class="hold-booking-btn adm-hold-btn"
      data-id="${escapeHtml(query.id)}"
      data-venue-id="${escapeHtml(String(query.venue_id || ''))}"
      data-preferred-date="${escapeHtml(query.preferred_date || '')}"
      data-checkout-date="${escapeHtml(query.checkout_date || '')}">
      🔒 Hold Floor
    </button>` : ''}

  <div class="adm-advance-group">
    <span class="adm-advance-label">₹ Advance</span>
    <input class="adm-advance-input" type="number" id="advance-${escapeHtml(query.id)}" placeholder="0" min="0" step="1">
  </div>

  ${(!isCombo || isHeld) ? `
    <button class="confirm-booking-btn adm-confirm-btn"
      data-id="${escapeHtml(query.id)}"
      data-venue-id="${escapeHtml(String(query.venue_id || ''))}"
      data-venue-type="${escapeHtml(query.venues?.type || '')}"
      data-preferred-date="${escapeHtml(query.preferred_date || '')}"
      data-checkout-date="${escapeHtml(query.checkout_date || '')}"
      data-time-slot="${escapeHtml(query.time_slot || '')}"
      data-held-at="${escapeHtml(query.held_at || '')}">
      ✓ Confirm Booking
    </button>` : ''}

  ${isCombo && isHeld ? `
    <button class="release-hold-btn adm-release-btn" data-id="${escapeHtml(query.id)}">Release</button>` : ''}
</div>
```

Net effect: a combo query shows **Hold Floor** first; Confirm only appears once it's held. A single shows **Confirm** directly, as today.

---

## 7. Delegated handlers (`initAdminPage` @4742)

Extend the existing delegated click listener:

```js
const holdBtn = e.target.closest('.hold-booking-btn')
if (holdBtn) {
  holdComboBooking(holdBtn.dataset.id, holdBtn.dataset.venueId, holdBtn.dataset.preferredDate, holdBtn.dataset.checkoutDate)
  return
}
const releaseBtn = e.target.closest('.release-hold-btn')
if (releaseBtn) {
  if (confirm('Release this hold and re-open the singles?')) releaseHold(releaseBtn.dataset.id)
  return
}
```

### Optional: soft guard on confirming a too-fresh hold

In the existing `confirmBtn` handler, before calling `confirmBooking`, warn if the hold is younger than your sync interval (e.g. 60 min):

```js
const heldAt = confirmBtn.dataset.heldAt
if (heldAt) {
  const mins = (Date.now() - new Date(heldAt).getTime()) / 60000
  if (mins < 60 && !confirm(`Held only ${Math.round(mins)} min ago — Airbnb may not have synced the block yet. Confirm anyway?`)) return
}
```

---

## 8. Surface the parent-child relationship in the dashboard

So whoever staffs bookings can see the structure at a glance:

- **On the combo query card**, add a chip listing children: query the names once (or join) and render `🏠 Whole floor = Terracottage Ochre + Terracottage Umber`.
- **On a single's confirmed-booking card** (`renderBookings` @2560), if that date range overlaps an active `source='parent'` block, show a small tag `⛓ part of a floor booking` so it's obvious why the single is unavailable.
- **In the venue admin list**, show a `combo` badge and, for children, `child of: Terracottage Sienna`. Reuse `venueTypeBadgeClass` / `formatVenueType` (extend them to handle `'combo'`).

---

## 9. CSS — add to `style.css`

```css
.adm-hold-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px; font-weight: 600; cursor: pointer;
  background: var(--surface-2, #f3efe7); color: var(--text-strong, #3a342c);
  border: 1px solid var(--border, #d8cfc0);
}
.adm-hold-btn:hover { background: var(--surface-3, #e9e2d6); }

.adm-hold-banner {
  display: flex; align-items: center; gap: 8px;
  margin: 8px 0; padding: 8px 12px; border-radius: 8px; font-size: 0.85rem;
  background: rgba(214, 158, 46, 0.12); color: #8a6d1f;
  border: 1px solid rgba(214, 158, 46, 0.35);
}
.adm-hold-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #d69e2e;
  box-shadow: 0 0 0 0 rgba(214,158,46,.5); animation: holdPulse 1.8s infinite;
}
@keyframes holdPulse {
  0%   { box-shadow: 0 0 0 0 rgba(214,158,46,.5); }
  70%  { box-shadow: 0 0 0 6px rgba(214,158,46,0); }
  100% { box-shadow: 0 0 0 0 rgba(214,158,46,0); }
}
@media (prefers-reduced-motion: reduce) { .adm-hold-dot { animation: none; } }

.adm-release-btn {
  padding: 8px 12px; border-radius: 8px; cursor: pointer; font-weight: 500;
  background: transparent; color: var(--text-muted, #8a8275);
  border: 1px solid var(--border, #d8cfc0);
}
.adm-release-btn:hover { color: #b4452f; border-color: #b4452f; }
```

---

## Test checklist (additions)

1. Combo query shows **Hold Floor**, no Confirm. Press Hold → parent rows appear on both children, `held_at` set, card shows the pulsing on-hold banner + Confirm + Release.
2. Press Confirm on the held combo → `confirmed=true`, **no** duplicate parent rows (idempotency guard), card leaves the queries tab.
3. Press Release on a held combo → parent rows deleted, `held_at` cleared, singles re-open on the public calendar.
4. Try Hold on a floor whose child is already booked → blocked with the §3 toast, no rows written, `held_at` stays null.
5. Confirm a held-<60-min combo → soft warning fires; confirming an older hold → no warning.
6. A non-combo single still confirms in one step (no Hold button).
