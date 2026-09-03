/***********************************************************************
 * The Picnic Stories — Booking Sync (Supabase -> Google Sheet)
 * One-way pull, on a timer. Confirmed/paid bookings only.
 *
 * VERSION-CONTROLLED COPY. The live code lives in each workbook's
 * Apps Script editor (Extensions > Apps Script). This file is the source
 * of truth — paste it into BOTH workbooks and set LOCATION per workbook.
 *
 * 2026-07-24 change (edit-propagation fix):
 *   The old `known` branch only refreshed Booking Status + Payment Status,
 *   so admin edits to date / venue / guests / add-ons / price never reached
 *   the Sheet. This version does a FULL-ROW UPSERT and also handles two
 *   migrations an edit can cause:
 *     (a) region change  -> a booking that no longer belongs to this
 *         workbook's LOCATION has its stale row removed here.
 *     (b) picnic<->stay   -> a booking that switched type is moved to the
 *         correct tab (removed from the old tab, written to the new one).
 *   Row deletes are collected and applied last (bottom-up) so row numbers
 *   captured for in-place updates stay valid during the pass.
 *
 * 2026-08-16 change (Close Booking):
 *   - Pulls the new `booking_costs` table (per-booking direct costs, written
 *     by the admin panel's Close Booking form) and stamps the five
 *     `Cost: * (₹)` cells, plus `Closed On` / `Close Notes`.
 *     COST CELLS ARE ONLY WRITTEN WHEN A booking_costs ROW EXISTS, so
 *     hand-entered costs on a not-yet-closed booking are never blanked.
 *     `Total Cost`, `Net Profit` and `Margin %` stay SHEET FORMULAS — the
 *     sync deliberately does not write them.
 *   - Pulls `bookings.booking_status` and honours the terminal states.
 *     'Cancelled' is written through as-is. 'Closed' is written as
 *     'Completed' because the sheet's Booking Status dropdown has no
 *     'Closed' entry; the `Closed On` column is what marks it reconciled.
 *   - Cancelled bookings are now included in the fetch (they have
 *     confirmed=false, so the old filter dropped them and left a stale
 *     "Confirmed" row on the sheet forever).
 *   - `Base Package (₹)` = total - add-ons + discount, i.e. the LIST base
 *     before add-ons and before any discount / on-day extra. The sheet does
 *         Total Amount = Base Package + Add-ons Total - Discount Applied
 *     so the discount is supplied once by its own column and must NOT also be
 *     baked into Base.
 *     REVERTED (2026-08-24): an earlier "fix" changed this to (total - add-ons),
 *     on the mistaken belief that the sheet's total was just Base + Add-ons.
 *     It is not — it subtracts Discount Applied as well. That change left the
 *     extra inside Base AND added it again via the column, overstating booking
 *     #60 as ₹20,804 against a true ₹17,852. Keep the `+ discount`.
 *   - BUG FIX: `Nightly Rate (₹)` is no longer rounded to whole rupees. The
 *     sheet derives a stay's Total Amount as Nightly Rate x Nights, so rounding
 *     the rate first made that total miss the real one by up to ₹5.27, with the
 *     error growing on longer stays. 14 confirmed stays were affected. Only
 *     stays had this problem — the picnic branch writes `Base Package (₹)` from
 *     the real total and never round-trips through a per-night figure.
 *     If the column now shows long decimals, fix it with cell number formatting
 *     (Format > Number), NOT by re-rounding here — the precision is the fix.
 *
 * SETUP (see SETUP_google_sheet_sync.md):
 *   1. Extensions > Apps Script, paste this file, Save.
 *   2. Project Settings > Script properties: SUPABASE_SERVICE_KEY = <service_role key>.
 *   3. Set LOCATION below: 'jaipur' in the Jaipur sheet, 'ncr' in the Gurugram & Delhi sheet.
 *   4. Run ensureSheetColumns() ONCE per workbook (adds the new columns).
 *   5. Run syncBookings once to authorize, then add a 30-min time trigger.
 ***********************************************************************/

const SUPABASE_URL  = 'https://evmftrogyzoudiccqkya.supabase.co';
const LOCATION      = 'ncr';          // <-- 'jaipur' OR 'ncr' (must match this workbook)
const LOOKBACK_DAYS = 90;               // only fetch bookings with preferred_date >= today minus this
const NCR_CITIES    = ['Delhi', 'Gurugram', 'Noida', 'Faridabad'];
const STAY_TYPES    = ['self_managed', 'partner_bnb', 'combo'];  // else (cafe/custom) = picnic
const PICNIC_TAB    = 'Picnic Bookings';
const AIRBNB_TAB    = 'Airbnb Bookings';
const EXPENSES_TAB  = 'Expenses';
const BKID_HEADER   = '_bkid';

// booking_costs column -> sheet header. Same five on both tabs.
const COST_COL = {
  cost_food:         'Cost: Food (₹)',
  cost_fruits:       'Cost: Fruits (₹)',
  cost_flowers:      'Cost: Flowers (₹)',
  cost_decor_other:  'Cost: Decor/Other (₹)',
  cost_vendor_photo: 'Cost: Vendor/Photo (₹)'
};

// addon_id -> picnic sheet column (short header, before the "\n₹price"). Covers old + current catalog ids.
const ADDON_COL = {
  1:'Printout', 17:'Printout', 2:'Ex.Flowers', 20:'Ex.Flowers', 3:'Ex.Candles', 21:'Ex.Candles',
  4:'Cake', 24:'Cake', 5:'Bouquet', 22:'Bouquet', 6:'Sip & Paint', 28:'Sip & Paint',
  7:'Photog.', 19:'Photog.', 8:'Bonfire', 26:'Bonfire', 9:'Cold Pyros', 23:'Cold Pyros',
  10:'Skyshots', 27:'Skyshots', 11:'Ex.Hour', 32:'Ex.Hour', 12:'Movie', 29:'Movie',
  13:'Polaroid', 18:'Polaroid', 14:'BBQ', 25:'BBQ', 15:'Live Music', 30:'Live Music',
  16:'Balloon', 31:'Balloon'
};
// Unique add-on column headers — used to clear a picnic row's add-on cells before
// re-stamping the current selection, so a removed add-on's "Y" is cleared on edit.
const ADDON_COLS_UNIQUE = Array.from(new Set(Object.values(ADDON_COL)));

/** Returns an ISO date string (YYYY-MM-DD) for LOOKBACK_DAYS ago. */
function getCutoffDate() {
  const d = new Date();
  d.setDate(d.getDate() - LOOKBACK_DAYS);
  return d.toISOString().slice(0, 10);
}

function syncBookings() {
  const key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_KEY in Script properties.');
  const H = { apikey: key, Authorization: 'Bearer ' + key };

  // Venues (small table, no date filter needed)
  const venues = {};
  JSON.parse(get(`${SUPABASE_URL}/rest/v1/venues?select=id,name,city,type`, H))
    .forEach(v => venues[v.id] = v);

  // Bookings within the lookback window, with add-ons and costs embedded —
  // one request, no full-table scan. booking_costs is admin-only under RLS, but
  // this script authenticates with the service_role key, which bypasses RLS.
  const cutoff = getCutoffDate();
  const select = [
    'id', 'full_name', 'mobile_number', 'email_address', 'guest_count', 'children_count',
    'preferred_date', 'checkout_date', 'time_slot', 'occasion', 'board', 'special_requirements',
    'advance_amount', 'total_amount', 'discount_amount', 'payment_status', 'razorpay_payment_id',
    'confirmed', 'booking_status', 'venue_id', 'created_at',
    'booking_add_ons(addon_id,price_at_booking)',   // embedded — scoped to this booking set only
    'booking_costs(cost_food,cost_fruits,cost_flowers,cost_decor_other,cost_vendor_photo,close_notes,closed_at)'
  ].join(',');
  const rows = JSON.parse(get(
    `${SUPABASE_URL}/rest/v1/bookings` +
    `?select=${select}` +
    // Cancelled bookings have confirmed=false. Without the third clause they drop
    // out of the fetch and their sheet row is left saying "Confirmed" forever.
    `&or=(confirmed.eq.true,payment_status.eq.paid,booking_status.eq.Cancelled)` +
    `&preferred_date=gte.${cutoff}` +
    `&order=id.asc`, H));

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const picnic = prep(ss.getSheetByName(PICNIC_TAB));
  const airbnb = prep(ss.getSheetByName(AIRBNB_TAB));

  // Row numbers to delete once the update/append pass is done (applied bottom-up).
  const del = { picnic: new Set(), airbnb: new Set() };

  let added = 0, updated = 0, moved = 0, removed = 0, skipped = 0, closed = 0;

  rows.forEach(b => {
    const v = venues[b.venue_id];
    const pRow = picnic.idIndex[b.id];   // existing picnic-tab row (or undefined)
    const aRow = airbnb.idIndex[b.id];   // existing airbnb-tab row (or undefined)

    // (a) Region change / unknown venue: this booking no longer belongs in THIS
    // workbook. Remove any stale rows it left behind here.
    if (!v || locationOf(v.city) !== LOCATION) {
      if (pRow) { del.picnic.add(pRow); removed++; }
      if (aRow) { del.airbnb.add(aRow); removed++; }
      skipped++;
      return;
    }

    const isStay    = !!b.checkout_date || STAY_TYPES.indexOf(v.type) !== -1;
    const target    = isStay ? airbnb : picnic;
    const targetRow = isStay ? aRow : pRow;
    const otherRow  = isStay ? pRow : aRow;

    // (b) Tab change: a stale row on the opposite tab must be removed.
    if (otherRow) { (isStay ? del.picnic : del.airbnb).add(otherRow); moved++; }

    // Add-ons come embedded in the row — no separate fetch, no stale data.
    const adItems = b.booking_add_ons || [];
    const ad = {
      sum: adItems.reduce((s, a) => s + (Number(a.price_at_booking) || 0), 0),
      ids: adItems.map(a => a.addon_id)
    };

    const cost = costsOf(b);
    if (cost) closed++;

    const values = buildRowValues(b, v, isStay, ad, cost);

    if (targetRow) {
      // FULL-ROW UPDATE in place (row number unchanged by writes).
      writeRow(target, targetRow, values);
      if (!isStay) applyPicnicAddons(target, targetRow, ad.ids);
      updated++;
    } else {
      // New row for this tab.
      const r = target.nextRow++;
      writeRow(target, r, values);
      if (!isStay) applyPicnicAddons(target, r, ad.ids);
      target.sheet.getRange(r, target.col[BKID_HEADER]).setValue(b.id);
      target.idIndex[b.id] = r;
      added++;
    }
  });

  // Apply deletes last, bottom-up per tab, so earlier in-place row numbers held.
  applyDeletes(picnic.sheet, del.picnic);
  applyDeletes(airbnb.sheet, del.airbnb);

  Logger.log(
    `Sync ${LOCATION} (from ${cutoff}): +${added} new, ${updated} updated, ` +
    `${moved} moved-tab, ${removed} removed, ${skipped} other-region, ` +
    `${closed} with costs, ${rows.length} candidates.`);

  // Mirror the Expenses tab into Supabase for the hosted dashboard. DELIBERATELY
  // LAST and DELIBERATELY WRAPPED: the booking sync above is load-bearing and runs
  // every 30 minutes. If this push fails — network blip, schema drift, a malformed
  // row — it must log and move on, never abort the sheet writes that already
  // succeeded. A broken dashboard is an inconvenience; a stalled booking sync is a
  // double-booked venue.
  try {
    pushExpenses(H);
  } catch (err) {
    Logger.log('Expenses push FAILED (booking sync above was unaffected): ' + err);
  }
}

/* ---- expenses mirror ----------------------------------------------------
 * The dashboard needs one thing that exists only in this workbook: the Expenses
 * tab. Bookings, venues and per-booking costs are already in Supabase, so
 * mirroring expenses lets a dashboard hosted outside Cowork read a SINGLE source
 * under RLS — no service key in a browser, no serverless proxy.
 *
 * Upserts on sheet_row_key so a re-run updates in place. Without that key every
 * 30-minute run would append another copy of the rent line and the P&L would
 * drift upward forever.
 * ----------------------------------------------------------------------- */
function expenseRowKey(parts) {
  const raw = parts.join('|');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b & 0xFF) + 0x100).toString(16).slice(1)).join('').slice(0, 32);
}

function pushExpenses(H) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EXPENSES_TAB);
  if (!sheet) { Logger.log('Expenses: tab not found, skipped.'); return; }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) { Logger.log('Expenses: nothing to push.'); return; }

  // Locate the header by content — the tab has spacer rows above it, exactly like
  // the booking tabs, so row 0 is not reliably the header.
  let h = -1;
  for (let i = 0; i < Math.min(values.length, 12); i++) {
    const row = values[i].map(c => String(c).toLowerCase().trim());
    if (row.indexOf('description') !== -1 && row.indexOf('category') !== -1 && row.indexOf('amount (₹)') !== -1) { h = i; break; }
  }
  if (h === -1) { Logger.log('Expenses: header row not found, skipped.'); return; }

  const head = values[h].map(c => String(c).trim());
  const ix = name => head.findIndex(c => c.toLowerCase().indexOf(name.toLowerCase()) === 0);
  const cDate = ix('Date'), cBiz = ix('Business'), cCity = ix('City'),
        cCat = ix('Category'), cDesc = ix('Description'), cAmt = ix('Amount'),
        cPaid = ix('Paid By'), cNotes = ix('Notes');

  const payload = [];
  const seen = {};
  for (let r = h + 1; r < values.length; r++) {
    const row = values[r];
    const amount = Number(String(row[cAmt]).replace(/[₹,\s]/g, ''));
    if (!(amount > 0)) continue;                     // skip the workbook's blank/zero spacer rows

    const d = row[cDate];
    const iso = (d instanceof Date && !isNaN(d.getTime()))
      ? Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd')
      : (String(d).trim() ? String(d).trim() : null);

    const desc = String(row[cDesc] || '').trim();
    const biz  = String(row[cBiz]  || '').trim();
    const cat  = String(row[cCat]  || '').trim();
    let key = expenseRowKey([iso, biz, cat, desc, amount]);
    // Two identical spends on the same day (same category, same description, same
    // amount) are legitimate — suffix the key so the second is not swallowed by the
    // first's upsert.
    if (seen[key]) { key = expenseRowKey([iso, biz, cat, desc, amount, ++seen[key]]); } else { seen[key] = 1; }

    payload.push({
      spend_date: iso, business: biz || null, city: String(row[cCity] || '').trim() || null,
      category: cat || null, description: desc || null, amount: amount,
      paid_by: cPaid !== -1 ? (String(row[cPaid] || '').trim() || null) : null,
      notes:  cNotes !== -1 ? (String(row[cNotes] || '').trim() || null) : null,
      sheet_row_key: key, synced_at: new Date().toISOString()
    });
  }

  if (!payload.length) { Logger.log('Expenses: no priced rows to push.'); return; }

  const res = UrlFetchApp.fetch(`${SUPABASE_URL}/rest/v1/expenses?on_conflict=sheet_row_key`, {
    method: 'post',
    contentType: 'application/json',
    headers: Object.assign({}, H, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('expenses upsert ' + code + ': ' + res.getContentText());

  // Rows deleted from the sheet should disappear from the mirror too, or the P&L
  // keeps subtracting a spend that no longer exists. Scoped to keys we just sent.
  const keys = payload.map(p => '"' + p.sheet_row_key + '"').join(',');
  const cleanup = UrlFetchApp.fetch(
    `${SUPABASE_URL}/rest/v1/expenses?sheet_row_key=not.in.(${keys})`,
    { method: 'delete', headers: Object.assign({}, H, { Prefer: 'return=minimal' }), muteHttpExceptions: true });
  const cc = cleanup.getResponseCode();
  Logger.log(`Expenses: upserted ${payload.length} row(s); stale-row cleanup HTTP ${cc}.`);
}

/* ---- row construction ---- */

// PostgREST returns a one-to-one embed as an object; some versions return a
// single-element array. Accept either, and treat "no row" as not-yet-closed.
function costsOf(b) {
  const raw = b && b.booking_costs;
  if (!raw) return null;
  const row = Object.prototype.toString.call(raw) === '[object Array]' ? (raw[0] || null) : raw;
  return row || null;
}

// Build the full column->value object for a booking row (picnic or stay).
// Add-on "Y" cells are handled separately by applyPicnicAddons so removals can
// be cleared on update.
//
// KEYS ABSENT FROM THIS OBJECT ARE NEVER WRITTEN (see writeRow), which is how
// the cost cells are left alone for a booking that has not been closed yet.
function buildRowValues(b, v, isStay, ad, cost) {
  const total    = (b.total_amount == null) ? null : Number(b.total_amount);
  const discount = Number(b.discount_amount) || 0;
  const common = {
    'Mobile': b.mobile_number || '', 'Email': b.email_address || '',
    'City': v.city || '', 'Payment Status': payStatus(b),
    'Discount Applied (₹)': discount ? discount : ''
  };

  // Costs: only stamped once the booking has actually been closed in the admin
  // panel. A null cost field clears its cell — the close form always submits all
  // five, so "null" there means "cleared", not "unknown".
  if (cost) {
    Object.keys(COST_COL).forEach(k => {
      common[COST_COL[k]] = (cost[k] == null) ? '' : Number(cost[k]);
    });
    common['Closed On']   = cost.closed_at ? String(cost.closed_at).slice(0, 10) : '';
    common['Close Notes'] = cost.close_notes || '';
  }

  if (isStay) {
    const nights = nightsBetween(b.preferred_date, b.checkout_date);
    return Object.assign(common, {
      'Channel': 'Airbnb', 'Property': v.name, 'Guest Name': b.full_name || '',
      'Check-in': b.preferred_date || '', 'Check-out': b.checkout_date || '',
      'Guests': b.guest_count || '',
      // Full precision, deliberately NOT rounded. The sheet derives a stay's
      // Total Amount as Nightly Rate x Nights, so a rounded rate multiplied back
      // up drifts away from the real total — and the error scales with the number
      // of nights (#86, 15 nights: +₹5.27; #115, 7 nights: −₹3.00). Cell
      // number-formatting controls how many decimals are DISPLAYED; the stored
      // value stays exact so the derived total lands on total_amount.
      'Nightly Rate (₹)': (total != null && nights > 0) ? (total / nights) : '',
      'Advance / Prepaid (₹)': b.advance_amount || '',
      'Booked On': bookedOnDate(b.created_at),
      'Booking Status': bookingStatus(b),
      'Notes': b.special_requirements || ''
    });
  }

  const board = b.board || {};
  return Object.assign(common, {
    'Source': 'Website', 'Venue': v.name, 'Customer Name': b.full_name || '',
    'Booking Date': b.preferred_date || '', 'Time Slot': b.time_slot || '',
    'Adults': b.guest_count || '', 'Children': b.children_count || 0,
    'Occasion': b.occasion || '', 'Board Type': capit(board.type) || 'None',
    'Board Message': board.message || '', 'Special Requirements': b.special_requirements || '',
    // Base Package is the LIST base — the setup price before add-ons and before
    // any discount/on-day extra. The sheet reconstructs the booking as
    //     Total Amount = Base Package + Add-ons Total - Discount Applied
    // so the discount must be backed OUT here and supplied exactly once by the
    // `Discount Applied (₹)` column. Since total_amount already includes the
    // extra, backing it out means `+ discount` (discount is negative for an extra).
    //
    // Worked example, booking #60 (Harshit): total 17852, add-ons 6000,
    // discount -2952  ->  Base = 17852 - 6000 + (-2952) = 8900, which matches
    // compute_booking_total(venue 14, 2 guests, evening, no add-ons) = 8900.
    // Sheet then shows 8900 + 6000 - (-2952) = 17852. Correct.
    //
    // Do NOT "simplify" this to (total - ad.sum). That yields 11852, which still
    // contains the extra, and the sheet's formula then adds it a second time —
    // that is exactly the 20804 regression this line was reverted to fix.
    'Base Package (₹)': (total != null) ? (total - ad.sum + discount) : '',
    'Advance Received (₹)': b.advance_amount || '', 'Payment Ref': b.razorpay_payment_id || '',
    'Booked On': bookedOnDate(b.created_at),
    'Booking Status': bookingStatus(b)
  });
}

// Clear all add-on columns on a picnic row, then stamp 'Y' on the selected ones.
// The clear step is what makes a REMOVED add-on disappear on an edit.
function applyPicnicAddons(t, r, addonIds) {
  ADDON_COLS_UNIQUE.forEach(h => { if (t.col[h]) t.sheet.getRange(r, t.col[h]).setValue(''); });
  addonIds.forEach(id => {
    const c = ADDON_COL[id];
    if (c && t.col[c]) t.sheet.getRange(r, t.col[c]).setValue('Y');
  });
}

// Delete the given row numbers from a sheet, bottom-up so indices don't shift.
function applyDeletes(sheet, rowSet) {
  Array.from(rowSet).sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
}

/* ---- one-time column setup ---------------------------------------------
 * Run this ONCE per workbook after pasting, before the first sync. Safe to
 * re-run: it only ever adds headers that are missing.
 *
 * On the Airbnb tab the four missing cost columns are INSERTED just before
 * 'Cost: Vendor/Photo (₹)' so they sit together as a cost block. Apps Script
 * shifts existing formula references automatically on insert — but it does NOT
 * widen them, so the tab's 'Net Profit (₹)' formula still subtracts only
 * Cost: Vendor/Photo. Update that one formula by hand afterwards.
 * ----------------------------------------------------------------------- */
function ensureSheetColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = [];

  const picnic = ss.getSheetByName(PICNIC_TAB);
  if (!picnic) throw new Error('Tab not found: ' + PICNIC_TAB);
  ['Discount Applied (₹)', 'Closed On', 'Close Notes', 'Booked On'].forEach(h => {
    if (appendHeader(picnic, h)) log.push(PICNIC_TAB + ': +' + h);
  });

  const airbnb = ss.getSheetByName(AIRBNB_TAB);
  if (!airbnb) throw new Error('Tab not found: ' + AIRBNB_TAB);
  ['Cost: Food (₹)', 'Cost: Fruits (₹)', 'Cost: Flowers (₹)', 'Cost: Decor/Other (₹)']
    .forEach(h => {
      if (insertHeaderBefore(airbnb, h, 'Cost: Vendor/Photo (₹)')) log.push(AIRBNB_TAB + ': +' + h);
    });
  ['Discount Applied (₹)', 'Closed On', 'Close Notes', 'Booked On'].forEach(h => {
    if (appendHeader(airbnb, h)) log.push(AIRBNB_TAB + ': +' + h);
  });

  Logger.log(log.length ? log.join('\n') : 'Nothing to add — all columns already present.');
}

function headerIndex(sheet) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = {};
  head.forEach((h, i) => { if (h !== '') col[String(h).split('\n')[0].trim()] = i + 1; });
  return col;
}

// Appends a header at the far right. The hidden _bkid column is kept last.
function appendHeader(sheet, header) {
  const col = headerIndex(sheet);
  if (col[header]) return false;
  const at = col[BKID_HEADER] ? col[BKID_HEADER] : sheet.getLastColumn() + 1;
  if (col[BKID_HEADER]) sheet.insertColumnBefore(at);
  sheet.getRange(1, at).setValue(header);
  return true;
}

function insertHeaderBefore(sheet, header, beforeHeader) {
  const col = headerIndex(sheet);
  if (col[header]) return false;
  if (!col[beforeHeader]) return appendHeader(sheet, header);
  sheet.insertColumnBefore(col[beforeHeader]);
  sheet.getRange(1, col[beforeHeader]).setValue(header);
  return true;
}

/* ---- helpers ---- */
function get(url, headers) {
  const res = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error(res.getResponseCode() + ': ' + res.getContentText());
  return res.getContentText();
}
function locationOf(city) {
  if (city === 'Jaipur') return 'jaipur';
  if (NCR_CITIES.indexOf(city) !== -1) return 'ncr';
  return null;
}
/* `Booked On` — the date the booking was CREATED, as opposed to the date the
   event happens. Lets a report separate cash-basis (when revenue was committed)
   from accrual (when it is delivered): an Airbnb stay booked in August for
   September belongs to August on one basis and September on the other.
   created_at is a UTC timestamptz; shift to IST before taking the date, or
   anything created after 18:30 UTC files under the wrong day. */
function bookedOnDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
function nightsBetween(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
}
function prep(sheet) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = {};
  head.forEach((h, i) => { if (h !== '') col[String(h).split('\n')[0].trim()] = i + 1; });
  if (!col[BKID_HEADER]) {
    const c = sheet.getLastColumn() + 1;
    sheet.getRange(1, c).setValue(BKID_HEADER); sheet.hideColumns(c); col[BKID_HEADER] = c;
  }
  const nameCol = col['Customer Name'] || col['Guest Name'];
  const last = Math.max(sheet.getLastRow(), 1);
  const idIndex = {}; let nextRow = 2;
  if (last >= 2) {
    const ids   = sheet.getRange(2, col[BKID_HEADER], last - 1, 1).getValues();
    const names = sheet.getRange(2, nameCol, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0]   !== '') idIndex[ids[i][0]] = i + 2;
      if (names[i][0] !== '') nextRow = i + 3;
    }
  }
  return { sheet, col, idIndex, nextRow };
}
function writeRow(t, r, obj) { Object.keys(obj).forEach(k => { if (t.col[k]) t.sheet.getRange(r, t.col[k]).setValue(obj[k]); }); }
function setVal(t, r, header, val) { if (t.col[header]) t.sheet.getRange(r, t.col[header]).setValue(val); }
// Only two payment states by design:
//   "Paid"         — the advance already covers the whole total (fully settled).
//   "Advance Paid" — a deposit is in, balance still due at the event (everything else).
// Every booking the sync writes is confirmed/paid, i.e. at least the advance is in hand,
// so there is deliberately no "Pending"/"Failed" here. Keeping this to two values means the
// sheet's =IF(status="Paid",0,Total−Advance) balance formula zeroes out only on full
// settlement. Takes the whole booking so it can compare advance vs total.
function payStatus(b) {
  const total = Number(b && b.total_amount) || 0;
  const adv   = Number(b && b.advance_amount) || 0;
  return (total > 0 && adv >= total) ? 'Paid' : 'Advance Paid';
}
// Booking Status the sheet should show.
//
// Terminal states now live in the DB (bookings.booking_status, written only by
// admin_close_booking) and win outright:
//   'Cancelled' -> 'Cancelled'  (already in the sheet's dropdown)
//   'Closed'    -> 'Completed'  (the dropdown has no 'Closed'; the Closed On
//                                column is what marks a booking reconciled)
// Everything else stays derived so it self-maintains on every sync: Enquiry
// until confirmed; once confirmed, a PAST event auto-reads Completed (picnic:
// the day is over; stay: guest has checked out), otherwise Confirmed.
function bookingStatus(b) {
  if (b.booking_status === 'Cancelled') return 'Cancelled';
  if (b.booking_status === 'Closed')    return 'Completed';
  if (!b.confirmed) return 'Enquiry';
  var eventEnd = b.checkout_date || b.preferred_date;   // stay ends at checkout; picnic is the day
  var todayIso = new Date().toISOString().slice(0, 10);
  if (eventEnd && String(eventEnd).slice(0, 10) < todayIso) return 'Completed';
  return 'Confirmed';
}
function capit(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }
