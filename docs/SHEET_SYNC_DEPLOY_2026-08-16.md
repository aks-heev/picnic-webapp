# Google Sheet sync — deploy & repair, 2026-08-16

`git push` does **not** deploy `scripts/google-sheet-sync.gs`. The live code lives inside each
workbook's Apps Script editor. This file is the source of truth and has to be pasted in by hand,
into **both** workbooks, with `LOCATION` set differently in each.

| Workbook | `LOCATION` | ID |
|---|---|---|
| The_Picnic_Stories_-_Jaipur | `'jaipur'` | `12y1-Y_F6KsiypdWzvFyAu_B3N8L24I_UNzXTN2io-kM` *(unverified — see below)* |
| NCR — live, titled `THEPIC~3` | `'ncr'` | `1wOUzB2Y3HgQ3FnJrRmJrY7oB2zVDVeEhECjc8fjQipY` |

🔴 **Corrected 2026-08-27.** The NCR id previously recorded here, `15DzEVgYaeDoeDvxDQA_V3HClCvn9mfS7ryLIvOPXrgE`, is a **stale duplicate**: it holds two sample rows (Garima, Rohan Mehta) that exist in no database, and has not been touched since 2026-06-23. The live workbook is the one above — 11 picnic bookings and 26 Airbnb stays as of 2026-08-27, `_bkid` populated, `Source = Website` rows carrying Razorpay refs.

A full session was spent on 2026-08-27 concluding "the sync is dead" from the stale copy's Drive timestamp. **Resolve the workbook by opening it and looking for a populated `_bkid` column — never by trusting an id written in a doc, this one included.** The Jaipur id above has NOT been re-checked and may be stale in the same way.

The repo copy ships with `LOCATION = 'ncr'`. Change it to `'jaipur'` in the Jaipur workbook after
pasting — this is the single easiest thing to get wrong, and getting it wrong means each workbook
deletes the other region's rows on the next run.

---

## 0. Historical: the 2026-08-16 "sync is dead" diagnosis (superseded)

🔴 The section below was written against the stale duplicate workbook and its
conclusion does not hold. As of 2026-08-27 the live NCR workbook is syncing. Keep
the troubleshooting table — it is still the right decision tree if the sync DOES
stop — but do not treat "both workbooks last modified 2026-06-23" as a finding.

Both workbooks were last modified **2026-06-23**. The earliest booking inside the script's 90-day
lookback window is **2026-06-25** — i.e. every booking created since the last successful run is
missing from the sheets.

What was ruled out by checking production directly:

- Every column in the script's `select` list exists on `bookings`. No 400 from PostgREST.
- **26 bookings** currently match `confirmed=true OR payment_status='paid'` inside the window.

So the query is valid and would return rows. The script is not running, or is throwing before its
first write. That is an Apps Script–side problem, not a Supabase one.

Also worth knowing: the `.gs` header documents an edit-propagation fix dated **2026-07-24**, which
is *after* the workbooks were last touched. That version was almost certainly never pasted in — so
whatever is live today is the pre-2026-07-24 code regardless.

**Settle it in 30 seconds:** Apps Script editor → **Executions** in the left rail.

| What you see | Cause | Fix |
|---|---|---|
| No executions since 2026-06-23 | The time trigger was deleted or never created | Add it again (step 4 below) |
| Failed runs, `Missing SUPABASE_SERVICE_KEY` | Script property gone | Re-add it (step 2) |
| Failed runs, `401`/`Invalid API key` | `service_role` key rotated | Paste the current one (step 2) |
| Failed runs, authorization errors | OAuth grant revoked | Re-run `syncBookings` manually and re-authorize |

---

## 1. Paste the script

Extensions → Apps Script → select all → paste the contents of `scripts/google-sheet-sync.gs` → Save.
Set `LOCATION` per the table above. Repeat in the second workbook.

## 2. Script property

Project Settings → Script properties → `SUPABASE_SERVICE_KEY` = the **service_role** key from
Supabase → Project Settings → API Keys.

`booking_costs` is admin-only under RLS. `service_role` bypasses RLS, which is why the sync can
read it and the anon key could not.

## 3. Add the new columns — run `ensureSheetColumns()` once per workbook

Pick `ensureSheetColumns` from the function dropdown and Run. It is idempotent; re-running adds
nothing. It does two different things:

**Picnic Bookings** — appends `Discount Applied (₹)`, `Closed On`, `Close Notes` at the right
edge (before the hidden `_bkid` column). The five `Cost: * (₹)` columns already exist there.

**Airbnb Bookings** — *inserts* `Cost: Food (₹)`, `Cost: Fruits (₹)`, `Cost: Flowers (₹)`,
`Cost: Decor/Other (₹)` immediately before the existing `Cost: Vendor/Photo (₹)`, so the five sit
together as a block; then appends the same three trailing columns.

> ### ⚠️ One formula you must fix by hand
>
> Apps Script shifts existing formula *references* when a column is inserted, but it does not
> *widen* a range. The Airbnb tab's **`Net Profit (₹)`** formula subtracts only
> `Cost: Vendor/Photo (₹)`. After the insert it still subtracts only that one column, silently
> ignoring the four new ones.
>
> Widen it to span the whole cost block. Nothing on the Picnic tab needs touching — its
> `Total Cost (₹)` / `Net Profit (₹)` / `Margin %` formulas are untouched by an append.

## 4. Run and schedule

Run `syncBookings` manually once (authorize when prompted), check the Execution log line, then
Triggers → Add Trigger → `syncBookings`, time-driven, every 30 minutes.

---

## What changed in the script

### Costs are only written for bookings that have actually been closed

`booking_costs` rows only exist once the booking is closed in the admin panel. If the sync wrote
cost cells unconditionally it would blank the hand-entered costs on rows like `BEIGE-001`
(₹1,782 food + ₹640 flowers, typed in by hand). It doesn't: cost keys are omitted from the row
object entirely when there is no `booking_costs` row, and `writeRow` never writes a key it wasn't
given.

`Total Cost (₹)`, `Net Profit (₹)` and `Margin %` stay **sheet formulas**. The sync deliberately
does not write them — the maths stays defined in one place.

### Booking Status now honours the DB's terminal states

`bookings.booking_status` is written only by `admin_close_booking`, and only ever `Closed` or
`Cancelled`. Mapping into the sheet:

- `Cancelled` → **Cancelled** (already in the Lists dropdown)
- `Closed` → **Completed**, because the dropdown has no `Closed` entry. The `Closed On` column is
  what actually marks a booking reconciled.

Everything else stays derived from `confirmed` + event date exactly as before, so it self-maintains.

> If you'd rather see a literal **Closed** in that column, add `Closed` to the `BookStatus` list on
> the hidden **Lists** tab, extend the Booking Status data-validation range, and change the one line
> in `bookingStatus()`. Left alone by default because it means editing validation rules on a live
> sheet.

### Cancelled bookings no longer go stale

Cancelling sets `confirmed=false`, so a cancelled booking fell out of the old
`or=(confirmed.eq.true,payment_status.eq.paid)` filter — and because the delete path only fires on
a region/venue mismatch, its row just sat there reading "Confirmed" forever. The filter now also
matches `booking_status.eq.Cancelled`.

(Right now zero bookings would have been missed by the old filter, since the ones that exist are
all `payment_status='paid'`. It's a latent bug, not an active one.)

### 🔴 Bug fix: the sheet's Total Amount was overstated on every discounted booking

The old `buildRowValues` emitted a `'Discount (₹)'` key — but **no such column exists in either
workbook**, so `writeRow` silently dropped it. Meanwhile `Base Package (₹)` was computed as
`total - add-ons + discount`.

The sheet computes `Total Amount = Base Package + Add-ons Total`. So:

```
sheet total = (total − add-ons + discount) + add-ons = total + discount
```

Every discounted booking showed a total inflated by exactly the discount — and `Balance Due`,
`Total revenue` on the Dashboard, and `Net Profit` all inherit from it.

Fixed by computing `Base Package (₹) = total − add-ons`, full stop. `total_amount` is already net
of the discount, so the sheet's total now equals the DB's exactly. The discount is reported
separately in the new `Discount Applied (₹)` column, which is informational — nothing subtracts it,
because it has already been subtracted.

> The alternative — keep Base at list price and rewrite `Total Amount` to
> `Base + Add-ons − Discount` — is more faithful to how a quote reads, but it means editing a
> formula that `Balance Due`, the Dashboard rollups and `Net Profit` all depend on. Not worth the
> blast radius for a cosmetic gain.

---

## Verification after the first successful run

1. Execution log reads something like `Sync ncr (from …): +N new, M updated, … K with costs`.
2. Pick a discounted booking and check `Total Amount (₹)` on the sheet equals `total_amount` in
   the DB. It should now match to the rupee.
3. `BEIGE-001`'s hand-entered ₹1,782 / ₹640 costs are still there (it has no `booking_costs` row,
   so the sync must have left those cells alone).
4. Close a booking in the admin panel, wait for the next run, and confirm `Closed On` fills and
   `Total Cost (₹)` recalculates from its formula.
