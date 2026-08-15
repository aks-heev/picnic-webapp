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
 * SETUP (see SETUP_google_sheet_sync.md):
 *   1. Extensions > Apps Script, paste this file, Save.
 *   2. Project Settings > Script properties: SUPABASE_SERVICE_KEY = <service_role key>.
 *   3. Set LOCATION below: 'jaipur' in the Jaipur sheet, 'ncr' in the Gurugram & Delhi sheet.
 *   4. Run syncBookings once to authorize, then add a 30-min time trigger.
 ***********************************************************************/

const SUPABASE_URL  = 'https://evmftrogyzoudiccqkya.supabase.co';
const LOCATION      = 'ncr';          // <-- 'jaipur' OR 'ncr' (must match this workbook)
const LOOKBACK_DAYS = 90;               // only fetch bookings with preferred_date >= today minus this
const NCR_CITIES    = ['Delhi', 'Gurugram', 'Noida', 'Faridabad'];
const STAY_TYPES    = ['self_managed', 'partner_bnb', 'combo'];  // else (cafe/custom) = picnic
const PICNIC_TAB    = 'Picnic Bookings';
const AIRBNB_TAB    = 'Airbnb Bookings';
const BKID_HEADER   = '_bkid';

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

  // Bookings within the lookback window, with add-ons embedded — one request, no full-table scan.
  const cutoff = getCutoffDate();
  const select = [
    'id', 'full_name', 'mobile_number', 'email_address', 'guest_count', 'children_count',
    'preferred_date', 'checkout_date', 'time_slot', 'occasion', 'board', 'special_requirements',
    'advance_amount', 'total_amount', 'discount_amount', 'payment_status', 'razorpay_payment_id', 'confirmed', 'venue_id',
    'booking_add_ons(addon_id,price_at_booking)'   // embedded — scoped to this booking set only
  ].join(',');
  const rows = JSON.parse(get(
    `${SUPABASE_URL}/rest/v1/bookings` +
    `?select=${select}` +
    `&or=(confirmed.eq.true,payment_status.eq.paid)` +
    `&preferred_date=gte.${cutoff}` +
    `&order=id.asc`, H));

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const picnic = prep(ss.getSheetByName(PICNIC_TAB));
  const airbnb = prep(ss.getSheetByName(AIRBNB_TAB));

  // Row numbers to delete once the update/append pass is done (applied bottom-up).
  const del = { picnic: new Set(), airbnb: new Set() };

  let added = 0, updated = 0, moved = 0, removed = 0, skipped = 0;

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

    const values = buildRowValues(b, v, isStay, ad);

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
    `${moved} moved-tab, ${removed} removed, ${skipped} other-region, ${rows.length} candidates.`);
}

/* ---- row construction ---- */

// Build the full column->value object for a booking row (picnic or stay).
// Mirrors the historical inline objects exactly; add-on "Y" cells are handled
// separately by applyPicnicAddons so removals can be cleared on update.
function buildRowValues(b, v, isStay, ad) {
  const total  = (b.total_amount == null) ? null : Number(b.total_amount);
  // Signed adjustment: + = discount that lowered the total, - = on-site extra that
  // raised it. total_amount already includes it, so back it out of the base:
  //   base = total - add-ons + discount  (mirrors the sheet's Total = Base + Add-ons - Discount).
  const discount = Number(b.discount_amount) || 0;
  const common = {
    'Mobile': b.mobile_number || '', 'Email': b.email_address || '',
    'City': v.city || '', 'Payment Status': payStatus(b)
  };
  if (isStay) {
    const nights = nightsBetween(b.preferred_date, b.checkout_date);
    return Object.assign(common, {
      'Channel': 'Airbnb', 'Property': v.name, 'Guest Name': b.full_name || '',
      'Check-in': b.preferred_date || '', 'Check-out': b.checkout_date || '',
      'Guests': b.guest_count || '',
      'Nightly Rate (₹)': (total != null && nights > 0) ? Math.round(total / nights) : '',
      'Advance / Prepaid (₹)': b.advance_amount || '',
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
    'Base Package (₹)': (total != null) ? (total - ad.sum + discount) : '',
    'Discount (₹)': discount ? discount : '',
    'Advance Received (₹)': b.advance_amount || '', 'Payment Ref': b.razorpay_payment_id || '',
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
// Booking Status the sheet should show. Enquiry until confirmed; once confirmed, a
// PAST event auto-reads Completed (picnic: the day is over; stay: guest has checked
// out), otherwise Confirmed. Date-based so it self-maintains on every sync — no manual
// re-marking. NOTE: the DB has no Cancelled state, so a cancelled booking must be
// un-confirmed (-> Enquiry) or removed; it can't be represented as "Cancelled" here.
function bookingStatus(b) {
  if (!b.confirmed) return 'Enquiry';
  var eventEnd = b.checkout_date || b.preferred_date;   // stay ends at checkout; picnic is the day
  var todayIso = new Date().toISOString().slice(0, 10);
  if (eventEnd && String(eventEnd).slice(0, 10) < todayIso) return 'Completed';
  return 'Confirmed';
}
function capit(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }
