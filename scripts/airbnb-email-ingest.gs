/***********************************************************************
 * The Picnic Stories — Airbnb confirmation email -> Supabase booking
 *
 * Phase 2 of Airbnb auto-ingest. The hourly ingest-airbnb edge function
 * creates the booking row from the Airbnb iCal feed (dates, venue, HM code,
 * phone last-4). This script fills in what only the "Reservation confirmed"
 * email carries: guest name, adults/children, payout.
 *
 * LIVES IN THE NCR WORKBOOK'S APPS SCRIPT PROJECT, AS ITS OWN FILE
 * (Extensions > Apps Script > + > Script, name it airbnb-email-ingest).
 * It does not touch syncBookings and shares nothing with it except the
 * SUPABASE_SERVICE_KEY script property and the SUPABASE_URL constant.
 *
 * What it does every 15 minutes:
 *   0. CANCELLATIONS FIRST. "Cancelled: Reservation HMXXXX for …" emails call
 *      airbnb_ingest_cancel, which records the HM code and cancels the matching
 *      row (auto-ingested or hand-entered). A cancelled code is never created
 *      again by either path. Running these first means a backfill that sees both
 *      the confirmation and the cancellation never creates the booking at all
 *      (the 2026-10-27 #329 Tanushree incident).
 *   1. Gmail search: from:automated@airbnb.com subject:"Reservation confirmed"
 *      without the label airbnb-ingested / airbnb-ingest-failed, last 14 days.
 *   2. Parses HM code, guest name (from the subject), Airbnb room id, check-in,
 *      checkout, adults, children, N-night room fee, YOU EARN.
 *   3. Calls the service-role-only RPC airbnb_ingest_email. That RPC resolves
 *      the venue from the room id, computes total_amount = YOU EARN − 0.1% TDS,
 *      creates the row if the email beat the feed, and only ever fills rows
 *      still flagged airbnb_details_pending (a human-entered row is never
 *      overwritten).
 *   4. Labels the thread airbnb-ingested on success, airbnb-ingest-failed if the
 *      email can't be parsed or the RPC errors. Failed rows stay
 *      "details pending" and the daily watchdog flags them.
 *
 * SETUP (once):
 *   1. Paste this file as a new script file in the NCR workbook project, Save.
 *   2. Run ingestAirbnbEmails once from the editor and approve the new Gmail
 *      permission (it reads and labels mail).
 *   3. Triggers > Add trigger > ingestAirbnbEmails > Time-driven > Minutes timer
 *      > Every 15 minutes. Failure notifications: "Notify me daily".
 *   4. Optional: run testParseAirbnb() to see what it extracts from the latest
 *      confirmation email without writing anything.
 ***********************************************************************/

const AIRBNB_INGEST_QUERY =
  'from:automated@airbnb.com subject:"Reservation confirmed" ' +
  '-label:airbnb-ingested -label:airbnb-ingest-failed newer_than:14d';
const AIRBNB_CANCEL_QUERY =
  'from:automated@airbnb.com subject:"Cancelled: Reservation" ' +
  '-label:airbnb-ingested -label:airbnb-ingest-failed newer_than:14d';
const AIRBNB_LABEL_OK   = 'airbnb-ingested';
const AIRBNB_LABEL_FAIL = 'airbnb-ingest-failed';
// SUPABASE_URL is declared in google-sheet-sync.gs (same project, shared scope).

function ingestAirbnbEmails() {
  const key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_KEY in Script properties.');
  const okLabel   = GmailApp.getUserLabelByName(AIRBNB_LABEL_OK)   || GmailApp.createLabel(AIRBNB_LABEL_OK);
  const failLabel = GmailApp.getUserLabelByName(AIRBNB_LABEL_FAIL) || GmailApp.createLabel(AIRBNB_LABEL_FAIL);

  let ok = 0, failed = 0;
  const errors = [];
  const rpc = (fn, body) => UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'post', contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ p: body }), muteHttpExceptions: true
  });

  // 0. Cancellations first (see header).
  GmailApp.search(AIRBNB_CANCEL_QUERY, 0, 25).forEach(thread => {
    const m = thread.getMessages()[0];
    let c;
    try { c = parseAirbnbCancellation(m.getSubject(), m.getPlainBody(), m.getDate()); }
    catch (e) { thread.addLabel(failLabel); failed++; errors.push(m.getSubject() + ' -> ' + e.message); return; }
    const res = rpc('airbnb_ingest_cancel', c);
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) { thread.addLabel(okLabel); ok++; Logger.log('CANCEL ' + c.hm + ' -> ' + res.getContentText()); }
    else { thread.addLabel(failLabel); failed++; errors.push('CANCEL ' + c.hm + ' -> HTTP ' + code + ': ' + res.getContentText().slice(0, 300)); }
  });

  // 1. Confirmations.
  const threads = GmailApp.search(AIRBNB_INGEST_QUERY, 0, 25);

  threads.forEach(thread => {
    // A confirmation thread normally has one message; take the first that parses.
    let parsed = null, why = 'no message parsed';
    thread.getMessages().some(m => {
      try { parsed = parseAirbnbConfirmation(m.getSubject(), m.getPlainBody(), m.getDate()); return true; }
      catch (e) { why = String(e.message || e); return false; }
    });
    if (!parsed) {
      thread.addLabel(failLabel); failed++;
      errors.push(thread.getFirstMessageSubject() + ' -> ' + why);
      return;
    }
    const res = rpc('airbnb_ingest_email', parsed);
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      thread.addLabel(okLabel); ok++;
      Logger.log(parsed.hm + ' -> ' + res.getContentText());
    } else {
      thread.addLabel(failLabel); failed++;
      errors.push(parsed.hm + ' -> HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
    }
  });

  Logger.log('ingestAirbnbEmails: ' + ok + ' ok, ' + failed + ' failed.');
  // Throwing makes Apps Script's failure email name the problem.
  if (errors.length) throw new Error('Airbnb email ingest failures:\n' + errors.join('\n'));
}

/** "Cancelled: Reservation HMMJQCJA2Z for 19–20 October" (+ body for listing / who). */
function parseAirbnbCancellation(subject, body, receivedAt) {
  const text = String(body || '');
  const hmM = String(subject || '').match(/\b(HM[A-Z0-9]{8,})\b/) || text.match(/reservations\/details\/(HM[A-Z0-9]{8,})/i);
  if (!hmM) throw new Error('HM code not found in cancellation');
  const listM = text.match(/Listing\s*#\s*(\d{6,})/i) || text.match(/airbnb\.[a-z.]+\/rooms\/(\d{6,})/i);
  const byGuest = /your guest .+? (?:had to )?cancel/i.test(text);
  return {
    hm: hmM[1].toUpperCase(),
    room_id: listM ? listM[1] : null,
    cancelled_by: byGuest ? 'guest' : 'unknown',
    subject: String(subject || ''),
    email_date: receivedAt ? new Date(receivedAt).toISOString() : null
  };
}

const MONTHS_ = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

/** Pure parser. Throws with a reason if a required field is missing. */
function parseAirbnbConfirmation(subject, body, receivedAt) {
  const text = String(body || '').replace(/\r/g, '');

  const nameM = String(subject || '').match(/Reservation confirmed\s*[-–—]\s*(.+?)\s+arrives\b/i);
  if (!nameM) throw new Error('guest name not in subject');

  const hmM = text.match(/CONFIRMATION CODE\s+(HM[A-Z0-9]{8,})/i) || text.match(/reservations\/details\/(HM[A-Z0-9]{8,})/i);
  if (!hmM) throw new Error('confirmation code not found');

  const roomM = text.match(/airbnb\.[a-z.]+\/rooms\/(\d{6,})/i);
  if (!roomM) throw new Error('room id not found');

  // "Check-in Checkout\n\nSat, 31 Oct Sun, 1 Nov" — no year in the email.
  const datesM = text.match(/Check-in\s+Checkout\s+[A-Za-z]{3},\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+[A-Za-z]{3},\s*(\d{1,2})\s+([A-Za-z]{3})/);
  if (!datesM) throw new Error('check-in/checkout not found');
  const recv = receivedAt ? new Date(receivedAt) : new Date();
  const checkin  = inferDate_(Number(datesM[1]), datesM[2], recv);
  let checkout   = inferDate_(Number(datesM[3]), datesM[4], recv);
  if (checkout <= checkin) checkout = new Date(Date.UTC(checkout.getUTCFullYear() + 1, checkout.getUTCMonth(), checkout.getUTCDate()));

  const guestsBlock = (text.match(/GUESTS\s+([^\n]+)/i) || [])[1] || '';
  const adultsM = guestsBlock.match(/(\d+)\s+adults?/i);
  if (!adultsM) throw new Error('adults not found');
  const kidsM = guestsBlock.match(/(\d+)\s+child(?:ren)?/i);

  const feeM = text.match(/\d+-nights?\s+room fee\s+₹\s*([\d,]+(?:\.\d+)?)/i);
  if (!feeM) throw new Error('room fee not found');
  const earnM = text.match(/YOU EARN\s+₹\s*([\d,]+(?:\.\d+)?)/i);
  if (!earnM) throw new Error('YOU EARN not found');

  return {
    hm: hmM[1].toUpperCase(),
    room_id: roomM[1],
    name: nameM[1].trim(),
    adults: Number(adultsM[1]),
    children: kidsM ? Number(kidsM[1]) : 0,
    room_fee: feeM[1].replace(/,/g, ''),
    you_earn: earnM[1].replace(/,/g, ''),
    checkin: ymd_(checkin),
    checkout: ymd_(checkout)
  };
}

// Day + month with no year: use the year that puts the date on/after the email
// (2 days of slack for time zones). A December email for a January stay rolls over.
function inferDate_(day, mon, recv) {
  const m = MONTHS_[String(mon).slice(0, 3).toLowerCase()];
  if (m === undefined) throw new Error('bad month ' + mon);
  let y = recv.getUTCFullYear();
  let d = new Date(Date.UTC(y, m, day));
  if (d.getTime() < recv.getTime() - 2 * 86400000) d = new Date(Date.UTC(y + 1, m, day));
  return d;
}
function ymd_(d) { return d.toISOString().slice(0, 10); }

/** Dry check from the editor: parses the newest confirmation email, writes nothing. */
function testParseAirbnb() {
  const t = GmailApp.search('from:automated@airbnb.com subject:"Reservation confirmed"', 0, 1)[0];
  if (!t) { Logger.log('No confirmation email found.'); return; }
  const m = t.getMessages()[0];
  Logger.log(JSON.stringify(parseAirbnbConfirmation(m.getSubject(), m.getPlainBody(), m.getDate()), null, 2));
}
