/* ===========================================================================
   Staff live event-status tool — page controller.
   Plan: docs/STAFF_STATUS_TOOL_PLAN.md   Phase 3.

   Own Vite entry on purpose. This does NOT import app.js (514 KB, and carries
   admin-only code that has no business on a field phone).

   Two behaviours carry the whole design:

   1. OPTIMISTIC + QUEUED WRITES. A tap updates the screen immediately and
      enqueues the RPC. Failures retry with backoff. This is only safe because
      booking_event_log has UNIQUE (booking_id, step) and staff_log_step uses
      ON CONFLICT DO NOTHING — replaying the queue can never duplicate a step.
      If that index is ever dropped, this file becomes unsafe.

   2. CACHED LAST VIEW. The last successful staff_today payload is kept in
      localStorage so an event card is still readable in a cafe basement with
      no signal.
   =========================================================================== */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[staff] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.')
}

/* @supabase/supabase-js is deliberately NOT imported here. It is ~58 KB gzipped
   of auth, realtime and storage machinery, and this page makes exactly two
   unauthenticated RPC calls. Hitting PostgREST directly keeps the whole page
   near 4 KB gzipped, which matters on a field phone with one bar of signal.
   The page is never signed in, so there is no session to manage. */
function rpc (fn, body, timeoutMs = 12000) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: ctl.signal
  }).then(async res => {
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`rpc ${fn} ${res.status}`)
      err.status = res.status
      err.body = text
      throw err
    }
    return res.json()
  }).finally(() => clearTimeout(timer))
}

/* ---------------------------------------------------------------- constants */

const LS_TOKEN = 'pst_staff_token'
const LS_CACHE = 'pst_staff_cache'
const LS_QUEUE = 'pst_staff_queue'
const LS_TAB   = 'pst_staff_tab'
// Guest-review mode. Persisted so a reload / pull-to-refresh while the guest
// holds the phone lands back on the review screen, never on the list.
const LS_GUEST = 'pst_staff_guest'

const SPINE = ['reached', 'setup_done', 'payment_received', 'wrapped']
const CHIPS = ['guests_arrived', 'guests_left']
// Stays have their own spine. payment_received is the only shared step, and it
// appears only when the server says money is actually outstanding
// (collect_on_arrival). That flag is derived from total - advance, NOT from the
// channel: external_booking_ref is free text ('WhatsApp', 'direct-extension',
// real HM… codes) and must never gate a money decision.
const STAY_SPINE = ['checked_in', 'payment_received', 'checked_out']

// A token with no region sees every location; only a scoped one names itself.
const REGION_LABEL = { ncr: 'Gurugram + Delhi', jaipur: 'Jaipur' }

const STEP_LABEL = {
  reached:          'Reached venue',
  setup_done:       'Setup done',
  payment_received: 'Payment received',
  wrapped:          'Wrap-up done',
  guests_arrived:   'Guests arrived',
  guests_left:      'Guests left',
  checked_in:       'Guest checked in',
  checked_out:      'Guest checked out'
}

const ACTION_LABEL = {
  reached:          'Mark reached',
  setup_done:       'Setup done',
  payment_received: 'Payment received',
  wrapped:          'Wrap-up done',
  checked_in:       'Guest checked in',
  checked_out:      'Guest checked out'
}

// Errors that will never succeed on retry — drop these from the queue instead
// of spinning forever. Anything else (network, 5xx) stays queued.
const TERMINAL_ERRORS = new Set(['unknown_step', 'not_today', 'bad_amount', 'out_of_order', 'invalid_token', 'wrong_kind', 'unknown_item',
                                 'bad_rating', 'too_long'])

const ERROR_TEXT = {
  invalid_token: 'This link is no longer valid.',
  unknown_step:  'Unknown step — reload the page.',
  not_today:     'That booking is not on today’s list any more.',
  bad_amount:    'Amount cannot be negative.',
  out_of_order:  'Do the previous step first.',
  wrong_kind:    'That step does not apply to this booking.',
  unknown_item:  'That checklist item changed — reloading.',
  bad_rating:    'Review not saved: rating missing.',
  too_long:      'Review not saved: text too long.'
}

/* -------------------------------------------------------------------- state */

let token = null
let payload = null            // last staff_today response
let queue = load(LS_QUEUE, [])
let flushing = false
let refreshTimer = null
let tab = load(LS_TAB, 'picnic')   // 'picnic' | 'airbnb'
let reviewedIds = new Set()   // today's bookings that already have a review on the server
// False when the server has no staff_reviewed_ids RPC yet (migration not
// applied) — the review button is hidden rather than offered and failing.
let reviewsEnabled = true
let guest = load(LS_GUEST, null)  // { booking_id, venue, name, submitted } while the guest holds the phone (name = display preview only)

/* --------------------------------------------------------------- dom lookup */

const $ = id => document.getElementById(id)
const el = {
  main:      $('stf-main'),
  subtitle:  $('stf-subtitle'),
  refresh:   $('stf-refresh'),
  pip:       $('stf-sync-pip'),
  syncNote:  $('stf-sync-note'),
  noaccess:  $('stf-noaccess'),
  toast:     $('stf-toast'),
  payWrap:   $('stf-pay-overlay'),
  payGuest:  $('stf-pay-guest'),
  payAmount: $('stf-pay-amount'),
  payOk:     $('stf-pay-confirm'),
  payCancel: $('stf-pay-cancel'),
  waWrap:    $('stf-wa-overlay'),
  waGuest:   $('stf-wa-guest'),
  waChips:   $('stf-wa-chips'),
  waText:    $('stf-wa-text'),
  waSend:    $('stf-wa-send'),
  waCancel:  $('stf-wa-cancel'),
  header:      document.querySelector('.stf-header'),
  guestWrap:   $('stf-guest'),
  guestForm:   $('stf-guest-form'),
  guestVenue:  $('stf-guest-venue'),
  guestText:   $('stf-guest-text'),
  guestPriv:   $('stf-guest-private'),
  guestNotice: $('stf-guest-notice'),
  guestSubmit: $('stf-guest-submit'),
  guestErr:    $('stf-guest-err'),
  guestThanks: $('stf-guest-thanks'),
  guestDone:   $('stf-guest-done'),
  guestCancel: $('stf-guest-cancel')
}

/* ----------------------------------------------------------------- storage */

function load (key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}
function save (key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}
function saveQueue () { save(LS_QUEUE, queue); paintPip() }

/* -------------------------------------------------------------------- utils */

function esc (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function money (n) {
  const v = Number(n || 0)
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

// '17:00:00' -> '5:00 PM'
function hhmm (t) {
  if (!t) return null
  const [hRaw, m] = String(t).split(':')
  let h = parseInt(hRaw, 10)
  if (Number.isNaN(h)) return null
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ap}`
}

function clockOf (iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
    })
  } catch { return '' }
}

function slotText (ev) {
  const a = hhmm(ev.slot_start), b = hhmm(ev.slot_end)
  if (a && b) return `${a} – ${b}`
  if (a) return a
  if (ev.time_slot) return String(ev.time_slot).replace(/^\w/, c => c.toUpperCase())
  return 'Time not set'
}

let toastTimer = null
function toast (msg, type) {
  el.toast.textContent = msg
  el.toast.dataset.type = type || 'info'
  el.toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.toast.hidden = true }, 3600)
}

/* --------------------------------------------------------------- token init */

function resolveToken () {
  const url = new URL(window.location.href)
  const fromUrl = url.searchParams.get('t')
  if (fromUrl) {
    save(LS_TOKEN, fromUrl)
    // Strip the token from the address bar so it does not end up in a
    // screenshot, a shared link, or the browser's suggestion list.
    url.searchParams.delete('t')
    window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash)
    return fromUrl
  }
  return load(LS_TOKEN, null)
}

function showNoAccess () {
  el.main.hidden = true
  el.noaccess.hidden = false
  el.subtitle.textContent = 'No access'
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
}

/* ------------------------------------------------------------- merged state */

/* The log the UI renders = server rows + anything still sitting in the queue,
   so a tap looks done the instant it happens even with no signal. */
function mergedLog (ev) {
  const rows = (ev.log || []).map(r => ({ ...r, pending: false }))
  const have = new Set(rows.map(r => r.step))
  for (const q of queue) {
    if (q.step && q.booking_id === ev.id && !have.has(q.step)) {   // tick jobs carry no step
      rows.push({ step: q.step, at: q.at, by: null, note: q.note, amount: q.amount, pending: true })
      have.add(q.step)
    }
  }
  rows.sort((a, b) => new Date(a.at) - new Date(b.at))
  return rows
}

function doneSteps (ev) { return new Set(mergedLog(ev).map(r => r.step)) }

/* Write an authoritative server log back into the cached payload, so the
   rendered state survives a queue entry being cleared. */
function applyServerLog (bookingId, log) {
  if (!payload || !Array.isArray(log)) return
  const ev = (payload.events || []).find(e => e.id === bookingId)
          || (payload.stays || []).find(e => e.id === bookingId)
  if (!ev) return
  ev.log = log
  save(LS_CACHE, payload)
}

/* ---------------------------------------------------------------- checklist */

/* Carry-fresh checklist (staff_checklist_for on the server): fixed items +
   package/booked add-ons + admin extras, one flat list. A tick job is SET-STATE
   ({ref, checked}), never a toggle, so replaying the queue is always safe — the
   last queued state for an item wins, on screen and on the server. */
function mergedChecklist (ev) {
  const items = (ev.checklist || []).map(i => ({ ...i, pending: false }))
  for (const q of queue) {
    if (!q.ref || q.booking_id !== ev.id) continue
    const it = items.find(i => i.ref === q.ref)
    if (it) { it.done = q.checked; it.pending = true }
  }
  return items
}

function itemText (i) {
  if (i.qty_unknown) return `${i.label} · 1 per guest (guest count missing)`
  return i.qty != null ? `${i.label} × ${i.qty}` : i.label
}

// Today's cards: tickable. Upcoming: read-only — staff_set_checklist_tick only
// accepts today's picnics, same day-cap as staff_log_step.
function checklistHtml (ev, editable) {
  const items = editable ? mergedChecklist(ev) : (ev.checklist || [])
  if (!items.length) return ''
  const rows = items.map(i => editable
    ? `<li><label class="stf-cl-item" data-done="${i.done ? '1' : '0'}" data-pending="${i.pending ? '1' : '0'}">
         <input type="checkbox" data-act="tick" data-id="${ev.id}" data-ref="${esc(i.ref)}" ${i.done ? 'checked' : ''}>
         <span>${esc(itemText(i))}</span></label></li>`
    : `<li>${esc(itemText(i))}</li>`).join('')
  return `<div class="stf-cl${editable ? '' : ' stf-cl--ro'}">
      <div class="stf-cl-title">Checklist</div>
      <ul>${rows}</ul>
    </div>`
}

function applyServerChecklist (bookingId, checklist) {
  if (!payload || !Array.isArray(checklist)) return
  const ev = (payload.events || []).find(e => e.id === bookingId)
  if (!ev) return
  ev.checklist = checklist
  save(LS_CACHE, payload)
}

function nextSpineStep (ev) {
  const done = doneSteps(ev)
  return SPINE.find(s => !done.has(s)) || null
}

/* Stay spine. payment_received is skipped entirely unless this is a direct
   booking with money still owed — an Airbnb guest has already paid Airbnb, and
   showing staff a "collect payment" button there would be actively wrong. */
function nextStayStep (st) {
  const done = doneSteps(st)
  const steps = st.collect_on_arrival ? STAY_SPINE : STAY_SPINE.filter(x => x !== 'payment_received')
  return steps.find(x => !done.has(x)) || null
}

/* -------------------------------------------------------------------- render */

function render () {
  if (!payload) return
  // 🔴 While a guest holds the phone, never paint the list — it carries every
  // guest's name and phone number for today.
  if (guest) return
  const events = payload.events || []
  const staffName = payload.staff && payload.staff.name ? payload.staff.name : ''
  const dateText = payload.date
    ? new Date(payload.date + 'T00:00:00').toLocaleDateString('en-IN',
        { weekday: 'short', day: 'numeric', month: 'short' })
    : ''
  // Region in the header so a wrong link is obvious on sight, rather than after
  // someone has driven to the wrong city's event.
  const regionCode = payload.staff && payload.staff.region
  const regionText = regionCode ? (REGION_LABEL[regionCode] || regionCode) : ''
  el.subtitle.textContent = [staffName, regionText, dateText].filter(Boolean).join(' · ')

  paintTabs()
  el.main.innerHTML = tab === 'airbnb' ? airbnbTabHtml() : picnicTabHtml()
  wireCards()
}

/* Food & drinks get their own row rather than a grey tag among the add-ons.
   It is the thing staff most need to know before they leave — whether the
   hamper has to be picked up at all, and how many items are in it. Always
   rendered, including the negative case, so silence never means "maybe". */
/* Black chalkboard message — staff write it by hand on site. Today's cards
   only: staff_today puts board_message in events[], never in upcoming[]. */
function boardHtml (ev) {
  if (!ev.board_message) return ''
  return '<div class="stf-board">' +
         '<span class="stf-board-label">Black board message</span>' +
         `<p class="stf-board-msg">${esc(ev.board_message)}</p></div>`
}

function foodHtml (ev) {
  if (!ev.includes_food) {
    return '<div class="stf-food stf-food--none">' +
           '<span class="stf-food-icon" aria-hidden="true">\u2715</span>' +
           '<span><strong>No food or drinks</strong> included</span></div>'
  }
  const f = Number(ev.food_items_count || 0)
  const b = Number(ev.beverage_items_count || 0)
  const parts = []
  if (f) parts.push(`${f} food item${f === 1 ? '' : 's'}`)
  if (b) parts.push(`${b} drink${b === 1 ? '' : 's'}`)
  const detail = parts.length
    ? parts.join(' + ')
    : 'count not recorded'          // includes_food true but no counts entered
  return '<div class="stf-food stf-food--yes">' +
         '<span class="stf-food-icon" aria-hidden="true">\u2713</span>' +
         `<span><strong>Food &amp; drinks included</strong> \u00b7 ${esc(detail)}</span></div>`
}

/* --------------------------------------------------------------- money row */

/* The money figures come from `bookings` (total − advance), and staff_log_step
   deliberately never writes back to `bookings` — a token surface does not move
   money. So `balance_due` / `collect_on_arrival` read exactly the same after
   cash is taken as before it, and the card used to show an amber "collect this"
   instruction sitting directly on top of its own "✓ Payment received" line.
   The log is the only record that money changed hands, so the row settles from
   the log rather than from the balance.

   Partial payments deliberately stay unsettled: booking_event_log has UNIQUE
   (booking_id, step), so a second payment_received row can never arrive, and
   showing a bare "Collected" would hide a real shortfall. */
function moneyRowHtml (ev, log, opts) {
  const due  = Number(opts.due || 0)
  const tel  = ev.mobile ? `<a class="stf-call" href="tel:${esc(ev.mobile)}">Call</a>` : ''
  // WhatsApp only where the caller asks for it (picnic cards) AND the stored
  // number is a real one — stay rows can hold 'AIRBNB-HM…' codes, not numbers.
  const wa   = opts.whatsapp && waNumber(ev.mobile)
    ? `<button class="stf-call stf-wa" type="button" data-act="wa" data-id="${ev.id}" data-sent="${waSentAt(ev.id) ? '1' : '0'}">WhatsApp</button>`
    : ''
  const call = (tel || wa) ? `<div class="stf-contact">${wa}${tel}</div>` : ''

  // Nothing was ever owed here — no log entry can change that.
  if (due <= 0) {
    return `<div class="stf-money">
      <div>
        <div class="stf-money-label">${esc(opts.zeroLabel)}</div>
        <div class="stf-money-value" data-zero="1">${esc(opts.zeroValue)}</div>
      </div>
      ${call}
    </div>`
  }

  const paid = log.find(r => r.step === 'payment_received')
  if (!paid) {
    return `<div class="stf-money${opts.dueClass ? ' ' + opts.dueClass : ''}">
      <div>
        <div class="stf-money-label">${esc(opts.dueLabel)}</div>
        <div class="stf-money-value">${esc(money(due))}</div>
      </div>
      ${call}
    </div>`
  }

  const got   = Number(paid.amount || 0)
  const short = Math.max(due - got, 0)
  return `<div class="stf-money stf-money--paid" data-short="${short > 0 ? '1' : '0'}">
      <div>
        <div class="stf-money-label">Collected${paid.pending ? ' \u00b7 syncing\u2026' : ''}</div>
        <div class="stf-money-value">${esc(money(got))}</div>
        ${short > 0 ? `<div class="stf-money-short">${esc(money(short))} still to collect</div>` : ''}
      </div>
      ${call}
    </div>`
}

function cardHtml (ev) {
  const log = mergedLog(ev)
  const done = new Set(log.map(r => r.step))
  const next = nextSpineStep(ev)
  const allDone = !next

  const guests = ev.guests + ' guests' + (ev.children ? ` \u00b7 ${ev.children} kid${ev.children === 1 ? '' : 's'}` : '')
  const venueBits = [ev.venue && ev.venue.name, ev.venue && ev.venue.area].filter(Boolean).join(', ')
  const mapsUrl = ev.venue && ev.venue.maps_url

  const tags = []
  if (ev.package_name) tags.push(esc(ev.package_name))
  if (ev.occasion) tags.push(esc(ev.occasion))
  for (const a of (ev.add_ons || [])) tags.push(esc(a.name))

  const balance = Number(ev.balance_due || 0)

  const timeline = log.map(r => `
      <li data-pending="${r.pending ? '1' : '0'}">
        <span class="stf-tick">${r.pending ? '○' : '✓'}</span>
        <span class="stf-step-name">${esc(STEP_LABEL[r.step] || r.step)}${
          r.step === 'payment_received' && Number(r.amount) > 0 ? ' · ' + esc(money(r.amount)) : ''
        }</span>
        <span class="stf-step-time">${r.pending ? 'syncing…' : esc(clockOf(r.at))}</span>
      </li>`).join('')

  const action = allDone
    ? '<div class="stf-alldone">All done ✓</div>'
    : `<button class="stf-btn stf-btn--primary" data-act="step" data-id="${ev.id}" data-step="${next}">${
        next === 'payment_received' && balance > 0
          ? `Payment ${esc(money(balance))} received`
          : esc(ACTION_LABEL[next])
      }</button>`

  const chips = CHIPS.map(c => `
      <button class="stf-chip" data-act="step" data-id="${ev.id}" data-step="${c}"
              data-on="${done.has(c) ? '1' : '0'}" ${done.has(c) ? 'disabled' : ''}>
        ${done.has(c) ? '✓ ' : ''}${esc(STEP_LABEL[c])}
      </button>`).join('')

  return `
  <article class="stf-card" data-done="${allDone ? '1' : '0'}" data-id="${ev.id}">
    <div class="stf-card-top">
      <span class="stf-time">${esc(slotText(ev))}</span>
      <span class="stf-guests">${esc(guests)}</span>
    </div>
    <h2 class="stf-name">${esc(ev.guest_name)}</h2>
    <p class="stf-venue">${esc(venueBits || 'Venue not set')}${
      mapsUrl ? ` · <a href="${esc(mapsUrl)}" target="_blank" rel="noopener">Directions</a>` : ''
    }</p>
    ${tags.length ? `<div class="stf-meta">${tags.map(t => `<span class="stf-tag">${t}</span>`).join('')}</div>` : ''}
    ${ev.special_requirements ? `<div class="stf-meta"><span class="stf-tag stf-tag--note">Note: ${esc(ev.special_requirements)}</span></div>` : ''}
    ${boardHtml(ev)}
    ${foodHtml(ev)}
    ${checklistHtml(ev, true)}
    ${moneyRowHtml(ev, log, {
      due:        balance,
      dueLabel:   'Balance to collect',
      zeroLabel:  'Balance to collect',
      zeroValue:  'Fully paid',
      whatsapp:   true
    })}
    ${log.length ? `<ul class="stf-timeline">${timeline}</ul>` : ''}
    ${action}
    <div class="stf-chips">${chips}</div>
    ${reviewRowHtml(ev, done)}
  </article>`
}

/* Guest review entry point. Offered once setup is done — guests are usually
   gone before wrap-up, so gating on 'wrapped' would miss them. Picnic cards
   only (stays are out of scope by the owner's call, 2026-10-11). */
function isReviewed (id) {
  return reviewedIds.has(id) || queue.some(q => q.review && q.booking_id === id)
}

function reviewRowHtml (ev, done) {
  if (!reviewsEnabled) return ''
  if (isReviewed(ev.id)) return '<div class="stf-review-done">\u2713 Guest review collected</div>'
  if (!done.has('setup_done')) return ''
  return `<button class="stf-btn stf-btn--ghost stf-review-btn" data-act="review" data-id="${ev.id}">Guest review</button>`
}

/* --------------------------------------------------------------------- tabs */

function paintTabs () {
  const p = (payload.events || []).length
  const a = (payload.stays || []).length
  const setBtn = (id, active, count) => {
    const b = document.getElementById(id)
    if (!b) return
    b.setAttribute('aria-selected', active ? 'true' : 'false')
    b.dataset.on = active ? '1' : '0'
    const badge = b.querySelector('.stf-tabcount')
    if (badge) { badge.textContent = count; badge.hidden = !count }
  }
  setBtn('stf-tab-picnic', tab !== 'airbnb', p)
  setBtn('stf-tab-airbnb', tab === 'airbnb', a)
}

function switchTab (next) {
  if (tab === next) return
  tab = next
  save(LS_TAB, tab)
  render()
  window.scrollTo({ top: 0 })
}

function picnicTabHtml () {
  const events = payload.events || []
  const todayHtml = events.length
    ? events.map(cardHtml).join('')
    : '<div class="stf-empty">' +
      '<p class="stf-empty-title">No picnics today</p>' +
      '<p>Nothing is scheduled. Tap refresh if you were expecting something.</p>' +
      '</div>'
  return todayHtml + upcomingHtml(payload.upcoming || [])
}

function airbnbTabHtml () {
  const stays = payload.stays || []
  const todayHtml = stays.length
    ? stays.map(stayCardHtml).join('')
    : '<div class="stf-empty">' +
      '<p class="stf-empty-title">Nobody staying today</p>' +
      '<p>No check-ins, check-outs or guests in house.</p>' +
      '</div>'
  return todayHtml + stayUpcomingHtml(payload.stays_upcoming || []) + occupancyHtml(payload.occupancy || [])
}

/* ------------------------------------------------------------- stay cards */

const PHASE_LABEL = { arriving: 'Arriving today', departing: 'Leaving today', in_house: 'In house' }

function stayCardHtml (st) {
  const log = mergedLog(st)
  const next = nextStayStep(st)
  const allDone = !next

  const nights = Number(st.nights || 0)
  const guests = st.guests + ' guests' + (st.children ? ` \u00b7 ${st.children} kid${st.children === 1 ? '' : 's'}` : '')
  const venueBits = [st.venue && st.venue.name, st.venue && st.venue.area].filter(Boolean).join(', ')

  const timeline = log.map(r => `
      <li data-pending="${r.pending ? '1' : '0'}">
        <span class="stf-tick">${r.pending ? '\u25cb' : '\u2713'}</span>
        <span class="stf-step-name">${esc(STEP_LABEL[r.step] || r.step)}${
          r.step === 'payment_received' && Number(r.amount) > 0 ? ' \u00b7 ' + esc(money(r.amount)) : ''
        }</span>
        <span class="stf-step-time">${r.pending ? 'syncing\u2026' : esc(clockOf(r.at))}</span>
      </li>`).join('')

  /* Money on a stay is not the picnic case. The server sends balance_due only
     for a direct booking; an Airbnb reservation is paid through Airbnb and must
     never show staff an amount to collect. */
  const moneyRow = moneyRowHtml(st, log, {
    due:       st.collect_on_arrival ? st.balance_due : 0,
    dueLabel:  'Collect on arrival',
    dueClass:  'stf-money--due',
    zeroLabel: 'Payment',
    zeroValue: st.source === 'airbnb' ? 'Paid via Airbnb' : 'Fully paid'
  })

  const action = allDone
    ? '<div class="stf-alldone">All done \u2713</div>'
    : `<button class="stf-btn stf-btn--primary" data-act="step" data-id="${st.id}" data-step="${next}"
               data-kind="stay">${
         next === 'payment_received'
           ? `Payment ${esc(money(st.balance_due))} received`
           : esc(ACTION_LABEL[next])
       }</button>`

  return `
  <article class="stf-card" data-done="${allDone ? '1' : '0'}" data-id="${st.id}" data-kind="stay">
    <div class="stf-card-top">
      <span class="stf-phase stf-phase--${esc(st.phase)}">${esc(PHASE_LABEL[st.phase] || st.phase)}</span>
      <span class="stf-guests">${esc(guests)}</span>
    </div>
    <h2 class="stf-name">${esc(st.guest_name)}</h2>
    <p class="stf-venue">${esc(venueBits || 'Venue not set')}</p>
    <div class="stf-stayline">
      ${esc(dayShort(st.check_in))} \u2192 ${esc(dayShort(st.check_out))}
      <span class="stf-nights">${nights} night${nights === 1 ? '' : 's'}</span>
      <span class="stf-src stf-src--${esc(st.source)}">${st.source === 'airbnb' ? 'Airbnb' : 'Direct'}</span>
    </div>
    ${st.special_requirements ? `<div class="stf-meta"><span class="stf-tag stf-tag--note">Note: ${esc(st.special_requirements)}</span></div>` : ''}
    ${moneyRow}
    ${log.length ? `<ul class="stf-timeline">${timeline}</ul>` : ''}
    ${action}
  </article>`
}

function dayShort (d) {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  } catch { return d }
}

function stayUpcomingHtml (list) {
  if (!list.length) return ''
  const rows = list.map(st => `
      <li class="stf-up-row">
        <div class="stf-up-line">
          <span class="stf-up-time">${esc(dayShort(st.check_in))} \u2192 ${esc(dayShort(st.check_out))}</span>
          <span class="stf-up-guests">${esc(st.guests + ' guests')}</span>
        </div>
        <div class="stf-up-name">${esc(st.guest_name)}</div>
        <div class="stf-up-venue">${esc((st.venue && st.venue.name) || 'Venue not set')}</div>
        <div class="stf-up-bits">${st.nights} night${st.nights === 1 ? '' : 's'} \u00b7 ${
          st.source === 'airbnb' ? 'Airbnb' : 'Direct'}</div>
        ${st.will_collect ? '<div class="stf-up-due">Balance due on arrival</div>' : ''}
        ${st.special_requirements ? `<div class="stf-up-note">Note: ${esc(st.special_requirements)}</div>` : ''}
      </li>`).join('')
  return `<section class="stf-upcoming">
      <h2 class="stf-section-title">Coming up <span class="stf-count">${list.length}</span></h2>
      <ul class="stf-up-list">${rows}</ul>
    </section>`
}

/* Nights Airbnb has blocked that have no booking row here — i.e. someone IS
   staying and the details were never entered. Read-only by necessity: with no
   booking_id there is nothing to log a step against. Shown rather than hidden
   because a silently short list is worse than an honest gap. */
function occupancyHtml (list) {
  if (!list.length) return ''
  const rows = list.map(o => `
      <li class="stf-up-row stf-occ-row">
        <div class="stf-up-line">
          <span class="stf-up-time">${esc(dayShort(o.from_date))} \u2013 ${esc(dayShort(o.to_date))}</span>
          <span class="stf-up-guests">${o.nights} night${o.nights === 1 ? '' : 's'}</span>
        </div>
        <div class="stf-up-name">${esc(o.venue_name)}</div>
        <div class="stf-up-note">Blocked on Airbnb \u2014 no guest details entered</div>
      </li>`).join('')
  return `<section class="stf-upcoming">
      <h2 class="stf-section-title">Booked, details missing <span class="stf-count">${list.length}</span></h2>
      <ul class="stf-up-list">${rows}</ul>
    </section>`
}

/* Read-only planning list. Deliberately has no buttons: staff_log_step only
   accepts today's events (plus the pre-04:00 grace window), so a tappable
   future card could only ever produce a `not_today` error. The server also
   withholds mobile / balance / totals on these rows — see the second allowlist
   in staff_today. Do not add contact or money fields to this view. */
function upcomingHtml (list) {
  if (!list.length) return ''

  const byDay = new Map()
  for (const ev of list) {
    if (!byDay.has(ev.date)) byDay.set(ev.date, [])
    byDay.get(ev.date).push(ev)
  }

  const days = [...byDay.entries()].map(([date, evs]) => {
    const rows = evs.map(ev => {
      const bits = []
      if (ev.package_name) bits.push(esc(ev.package_name))
      for (const a of (ev.add_ons || [])) bits.push(esc(a.name))
      if (ev.includes_food) {
        const ff = Number(ev.food_items_count || 0), bb = Number(ev.beverage_items_count || 0)
        bits.push(ff || bb ? `Food ${ff}+${bb}` : 'Food incl.')
      } else bits.push('No food')
      if (ev.occasion) bits.push(esc(ev.occasion))
      const guests = ev.guests + ' guests' + (ev.children ? ` · ${ev.children} kid${ev.children === 1 ? '' : 's'}` : '')
      return `
        <li class="stf-up-row">
          <div class="stf-up-line">
            <span class="stf-up-time">${esc(slotText(ev))}</span>
            <span class="stf-up-guests">${esc(guests)}</span>
          </div>
          <div class="stf-up-name">${esc(ev.guest_name)}</div>
          <div class="stf-up-venue">${esc((ev.venue && ev.venue.name) || 'Venue not set')}${
            ev.venue && ev.venue.area ? ', ' + esc(ev.venue.area) : ''
          }</div>
          ${bits.length ? `<div class="stf-up-bits">${bits.join(' · ')}</div>` : ''}
          ${ev.special_requirements ? `<div class="stf-up-note">Note: ${esc(ev.special_requirements)}</div>` : ''}
          ${checklistHtml(ev, false)}
        </li>`
    }).join('')
    return `<div class="stf-up-day"><h3>${esc(dayLabel(date))}</h3><ul class="stf-up-list">${rows}</ul></div>`
  }).join('')

  return `<section class="stf-upcoming">
      <h2 class="stf-section-title">Coming up <span class="stf-count">${list.length}</span></h2>
      ${days}
    </section>`
}

function dayLabel (date) {
  try {
    const d = new Date(date + 'T00:00:00')
    const today = new Date((payload && payload.date ? payload.date : date) + 'T00:00:00')
    const days = Math.round((d - today) / 86400000)
    const nice = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
    if (days === 1) return 'Tomorrow · ' + nice
    if (days > 1 && days < 7) return nice
    return nice + (d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : '')
  } catch { return date }
}

function wireCards () {
  el.main.querySelectorAll('[data-act="step"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id)
      const step = btn.dataset.step
      if (step === 'payment_received') openPaySheet(id)
      else enqueue(id, step, null, null)
    })
  })
  el.main.querySelectorAll('[data-act="wa"]').forEach(btn => {
    btn.addEventListener('click', () => openWaSheet(Number(btn.dataset.id)))
  })
  el.main.querySelectorAll('[data-act="review"]').forEach(btn => {
    btn.addEventListener('click', () => startGuestReview(Number(btn.dataset.id)))
  })
  el.main.querySelectorAll('[data-act="tick"]').forEach(box => {
    box.addEventListener('change', () => enqueueTick(Number(box.dataset.id), box.dataset.ref, box.checked))
  })
}

/* ------------------------------------------------------------- payment sheet */

let paying = null

function openPaySheet (bookingId) {
  // Must search stays as well as picnics — a direct stay can carry a balance
  // collected at check-in, and it uses the same sheet.
  const ev = (payload.events || []).find(e => e.id === bookingId)
          || (payload.stays || []).find(e => e.id === bookingId)
  if (!ev) return
  paying = bookingId
  el.payGuest.textContent = `${ev.guest_name} · balance ${money(ev.balance_due)}`
  el.payAmount.value = Number(ev.balance_due || 0)
  el.payWrap.hidden = false
  setTimeout(() => { el.payAmount.focus(); el.payAmount.select() }, 50)
}

function closePaySheet () { el.payWrap.hidden = true; paying = null }

el.payCancel.addEventListener('click', closePaySheet)
el.payWrap.addEventListener('click', e => { if (e.target === el.payWrap) closePaySheet() })
el.payOk.addEventListener('click', () => {
  const amount = Number(el.payAmount.value)
  if (!Number.isFinite(amount) || amount < 0) { toast('Enter a valid amount', 'error'); return }
  const id = paying
  closePaySheet()
  enqueue(id, 'payment_received', null, amount)
})

/* ----------------------------------------------------------- WhatsApp sheet */

/* Opens WhatsApp on the staff member's own phone with a pre-filled message.
   Nothing is sent from here and nothing is written to the server: the guest
   only gets a message if staff tap Send inside WhatsApp. "Opened" is
   remembered on this phone only (LS_WA), as a nudge against double-messaging. */

const LS_WA = 'pst_staff_wa'
let waSent = load(LS_WA, {})   // { [bookingId]: iso } — opened, not proven sent
let waBooking = null

/* bookings.mobile_number is mostly a bare 10-digit Indian number (143/161
   rows, 2026-10-17), but also holds 'AIRBNB-HM…' codes and a few malformed
   values. Returns a wa.me-ready number, or null so the button never renders
   for something WhatsApp would reject. */
function waNumber (raw) {
  const d = String(raw || '').replace(/\D/g, '')
  if (/^[6-9]\d{9}$/.test(d)) return '91' + d
  if (/^0[6-9]\d{9}$/.test(d)) return '91' + d.slice(1)
  if (/^91[6-9]\d{9}$/.test(d)) return d
  return null
}

function waSentAt (id) { return waSent[id] || null }

function firstName (full) {
  return String(full || '').trim().split(/\s+/)[0] || 'there'
}

/* Wording agreed with the owner 2026-10-17. Deliberately no "arrive early",
   no food/outside-food line. */
function waTemplates (ev) {
  const hi    = `Hi ${firstName(ev.guest_name)}`
  const staff = payload && payload.staff && payload.staff.name
  const from  = staff ? `${staff} from The Picnic Stories` : 'the team at The Picnic Stories'
  const venue = (ev.venue && ev.venue.name) || 'the venue'
  const maps  = ev.venue && ev.venue.maps_url
  const time  = slotText(ev)
  const when  = time === 'Time not set' ? 'today' : time
  const start = hhmm(ev.slot_start) || when
  const hasPhoto = (ev.add_ons || []).some(a => /photo/i.test(a.name || ''))

  const list = [
    { key: 'intro', label: 'Intro',
      text: `${hi}! 😊 This is ${from}. Your setup at ${venue} is all set for ${when}` +
            (maps ? `, and here's the location: ${maps}` : '') + `. Can't wait to host you! ✨` },
    { key: 'surprise', label: 'Surprise-safe',
      text: `${hi}, ${staff ? staff + ' here' : 'this is the team'} from The Picnic Stories. Everything is on track for this evening. ` +
            `If any part of it is a surprise, just tell me what to keep quiet about 🤫` },
    { key: 'ready', label: 'Setup ready',
      text: `${hi}, your setup at ${venue} is ready ✨` + (staff ? ` Ask for ${staff} when you arrive.` : '') },
    { key: 'eta', label: 'Ask ETA',
      text: `${hi}, ${from}. Could you share your ETA for ${venue}? Just so we have everything perfect when you arrive 😊` },
    { key: 'late', label: 'Running late',
      text: `${hi}, ${from}. We're running about 15 mins behind on setup. Really sorry, it'll be ready before you are.` }
  ]
  // Only when a photographer is actually booked — asking about shots otherwise
  // promises something the guest didn't buy.
  if (hasPhoto) {
    list.splice(2, 0, { key: 'photo', label: 'Photographer',
      text: `${hi}, our photographer will be at ${venue} from ${start}. Any shots you'd specially like, or a moment you'd like captured?` })
  }
  return list
}

function waHref (num, text) {
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`
}

function openWaSheet (bookingId) {
  const ev = (payload && payload.events || []).find(e => e.id === bookingId)
  const num = ev && waNumber(ev.mobile)
  if (!ev || !num) { toast('No valid WhatsApp number on this booking', 'error'); return }
  waBooking = { id: bookingId, num, templates: waTemplates(ev) }

  const sent = waSentAt(bookingId)
  el.waGuest.textContent = `${ev.guest_name}` +
    (sent ? ` · WhatsApp opened at ${clockOf(sent)} on this phone` : '')
  el.waChips.innerHTML = waBooking.templates.map((t, i) =>
    `<button type="button" class="stf-chip" data-i="${i}" data-on="${i === 0 ? '1' : '0'}">${esc(t.label)}</button>`
  ).join('')
  el.waChips.querySelectorAll('[data-i]').forEach(b => {
    b.addEventListener('click', () => pickWaTemplate(Number(b.dataset.i)))
  })
  pickWaTemplate(0)
  el.waWrap.hidden = false
}

function pickWaTemplate (i) {
  if (!waBooking) return
  el.waChips.querySelectorAll('[data-i]').forEach(b => { b.dataset.on = Number(b.dataset.i) === i ? '1' : '0' })
  el.waText.value = waBooking.templates[i].text
  syncWaLink()
}

function syncWaLink () {
  if (!waBooking) return
  const text = el.waText.value.trim()
  el.waSend.href = waHref(waBooking.num, text)
  el.waSend.setAttribute('aria-disabled', text ? 'false' : 'true')
}

function closeWaSheet () { el.waWrap.hidden = true; waBooking = null }

el.waText.addEventListener('input', syncWaLink)
el.waCancel.addEventListener('click', closeWaSheet)
el.waWrap.addEventListener('click', e => { if (e.target === el.waWrap) closeWaSheet() })
el.waSend.addEventListener('click', e => {
  if (!waBooking || !el.waText.value.trim()) { e.preventDefault(); return }
  // Let the link navigate (it opens WhatsApp); record + close right after.
  waSent[waBooking.id] = new Date().toISOString()
  save(LS_WA, waSent)
  setTimeout(() => { closeWaSheet(); render() }, 0)
})

/* -------------------------------------------------------------- write queue */

function enqueue (bookingId, step, note, amount) {
  if (queue.some(q => q.booking_id === bookingId && q.step === step)) return
  queue.push({
    booking_id: bookingId,
    step,
    note: note || null,
    amount: amount == null ? null : amount,
    at: new Date().toISOString(),
    tries: 0
  })
  saveQueue()
  render()            // optimistic: the tap shows as done immediately
  flush()
}

function enqueueTick (bookingId, ref, checked) {
  // Drop older queued states for this item — except the head job if it is
  // already in flight; the new job lands after it, so the latest state wins.
  queue = queue.filter((q, i) => !(q.ref === ref && q.booking_id === bookingId && !(flushing && i === 0)))
  queue.push({ booking_id: bookingId, ref, checked, at: new Date().toISOString(), tries: 0 })
  saveQueue()
  render()
  flush()
}

async function flush () {
  if (flushing || !queue.length || !token) return
  flushing = true
  try {
    while (queue.length) {
      const job = queue[0]
      let data
      try {
        data = (job.review
          ? await rpc('staff_submit_review', {
              p_token: token,
              p_booking_id: job.booking_id,
              p_rating: job.review.rating,
              p_review_text: job.review.text,
              p_private_feedback: job.review.private,
              p_publish_consent: job.review.consent
            })
          : job.ref
          ? await rpc('staff_set_checklist_tick', {
              p_token: token,
              p_booking_id: job.booking_id,
              p_item_ref: job.ref,
              p_checked: job.checked
            })
          : await rpc('staff_log_step', {
              p_token: token,
              p_booking_id: job.booking_id,
              p_step: job.step,
              p_note: job.note,
              p_amount: job.amount
            })) || {}
      } catch (err) {
        // Network / HTTP failure: keep the job, back off, try again later.
        // Business-rule rejections come back as HTTP 200 with {ok:false}.
        job.tries++
        saveQueue()
        scheduleRetry(job.tries)
        break
      }

      if (data.ok) {
        // 🔴 Fold the authoritative log back into `payload` BEFORE dropping the
        // queue entry. The rendered log is (server rows + queued rows); if the
        // queue entry disappears while payload still holds the pre-tap log, the
        // tick vanishes and the button reverts — the staff member sees their tap
        // undo itself. Caught in the Phase 3 browser test.
        if (job.review) markReviewed(job.booking_id)
        else if (job.ref) applyServerChecklist(job.booking_id, data.checklist)
        else applyServerLog(job.booking_id, data.log)
        queue.shift()
        saveQueue()
        render()
        continue
      }

      // Business-rule rejection.
      if (TERMINAL_ERRORS.has(data.error)) {
        queue.shift()
        saveQueue()
        if (data.error === 'invalid_token') { showNoAccess(); break }
        toast(ERROR_TEXT[data.error] || 'Could not save that step', 'error')
        await refresh(true)      // resync so the UI stops showing a false tick
        continue
      }

      job.tries++
      saveQueue()
      scheduleRetry(job.tries)
      break
    }
  } finally {
    flushing = false
    paintPip()
  }
}

let retryTimer = null
function scheduleRetry (tries) {
  clearTimeout(retryTimer)
  const wait = Math.min(30000, 2000 * Math.pow(2, Math.min(tries, 4)))  // 2s → 32s cap
  retryTimer = setTimeout(flush, wait)
}

function paintPip () {
  const state = !navigator.onLine ? 'offline' : (queue.length ? 'pending' : 'idle')
  el.pip.dataset.state = state
  if (queue.length) {
    el.syncNote.textContent = `${queue.length} update${queue.length > 1 ? 's' : ''} waiting to sync…`
    el.syncNote.hidden = false
  } else if (!navigator.onLine) {
    el.syncNote.textContent = 'Offline — your taps are saved and will sync.'
    el.syncNote.hidden = false
  } else {
    el.syncNote.hidden = true
  }
}

/* ------------------------------------------------------------------- refresh */

async function refresh (quiet) {
  if (!token) { showNoAccess(); return }
  if (!quiet) el.refresh.dataset.busy = '1'
  try {
    const [data] = await Promise.all([
      rpc('staff_today', { p_token: token }),
      loadReviewedIds()
    ])
    if (!data || !data.ok) {
      if (data && data.error === 'invalid_token') { showNoAccess(); return }
      throw new Error('bad payload')
    }
    payload = data
    payload.reviewed_ids = [...reviewedIds]
    save(LS_CACHE, payload)
    el.main.hidden = false
    el.noaccess.hidden = true
    render()
  } catch (err) {
    console.warn('[staff] refresh failed', err)
    if (!payload) {
      const cached = load(LS_CACHE, null)
      if (cached) {
        payload = cached
        render()
        toast('Showing last saved view — no connection', 'error')
      } else {
        el.main.innerHTML =
          '<div class="stf-empty"><p class="stf-empty-title">Can’t connect</p>' +
          '<p>Check your signal and tap refresh.</p></div>'
      }
    }
  } finally {
    delete el.refresh.dataset.busy
    paintPip()
  }
}

/* ------------------------------------------------------------ guest review */

/* Which of today's bookings already have a review. Kept out of staff_today on
   purpose (that payload has two allowlists and is load-bearing); this returns
   booking ids only. A 404 means the migration has not been applied yet: turn
   the feature off quietly instead of showing a button that cannot work. */
async function loadReviewedIds () {
  try {
    const r = await rpc('staff_reviewed_ids', { p_token: token })
    if (r && r.ok && Array.isArray(r.ids)) {
      reviewedIds = new Set(r.ids.map(Number))
      reviewsEnabled = true
    }
  } catch (err) {
    if (err && err.status === 404) reviewsEnabled = false
    // network errors: keep whatever we knew
  }
}

function markReviewed (bookingId) {
  reviewedIds.add(bookingId)
  if (payload) { payload.reviewed_ids = [...reviewedIds]; save(LS_CACHE, payload) }
}

// 'Riya Sharma' -> 'Riya S.'   'Riya' -> 'Riya'
// Preview only — the published name is derived server-side by
// review_display_name(bookings.full_name). Keep the two rules in step.
function shortName (full) {
  const parts = String(full || '').trim().replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '').split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Guest'
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
  if (parts.length === 1) return first.slice(0, 40)
  return (first + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.').slice(0, 40)
}

// No unlock code (owner's call, 2026-10-11: "we trust our guests"). The list is
// still removed from the DOM while the guest holds the phone, because the risk
// is an accidental back-swipe onto other guests' phone numbers, not intent.
function startGuestReview (bookingId) {
  const ev = (payload.events || []).find(e => e.id === bookingId)
  if (!ev || isReviewed(bookingId)) return
  guest = {
    booking_id: bookingId,
    venue: (ev.venue && ev.venue.name) || '',
    name: shortName(ev.guest_name),
    submitted: false
  }
  save(LS_GUEST, guest)
  resetGuestForm()
  enterGuestMode()
}

let rating = 0

function resetGuestForm () {
  rating = 0
  paintStars()
  el.guestText.value = ''
  el.guestPriv.value = ''
  el.guestErr.hidden = true
  syncSubmit()
}

function paintStars () {
  el.guestWrap.querySelectorAll('.stf-star').forEach(b => {
    const v = Number(b.dataset.v)
    b.dataset.on = v <= rating ? '1' : '0'
    b.setAttribute('aria-checked', v === rating ? 'true' : 'false')
  })
}

function syncSubmit () {
  el.guestSubmit.disabled = !(rating >= 1)
}

function enterGuestMode () {
  // Strip every trace of today's list from the DOM, not just cover it.
  el.main.innerHTML = ''
  el.main.hidden = true
  el.header.hidden = true
  el.payWrap.hidden = true
  closeWaSheet()      // the sheet carries a guest's number in its link
  document.body.dataset.guest = '1'
  el.guestVenue.textContent = guest.venue ? `at ${guest.venue}` : ''
  el.guestForm.hidden = !!guest.submitted
  el.guestThanks.hidden = !guest.submitted
  el.guestCancel.hidden = !!guest.submitted
  el.guestNotice.textContent = `Your review may appear on picnicstories.com as \u201c${guest.name || 'Guest'}\u201d.`
  syncSubmit()
  el.guestWrap.hidden = false
  el.guestWrap.scrollTop = 0
  // Swallow the back gesture / button while the guest has the phone.
  history.pushState({ stfGuest: 1 }, '', location.href)
}

function exitGuestMode () {
  guest = null
  save(LS_GUEST, null)
  try { localStorage.removeItem(LS_GUEST) } catch { /* ignore */ }
  el.guestWrap.hidden = true
  delete document.body.dataset.guest
  el.header.hidden = false
  el.main.hidden = false
  resetGuestForm()
  render()
  window.scrollTo({ top: 0 })
}

window.addEventListener('popstate', () => {
  if (guest) history.pushState({ stfGuest: 1 }, '', location.href)
})

el.guestWrap.querySelectorAll('.stf-star').forEach(b => {
  b.addEventListener('click', () => { rating = Number(b.dataset.v); paintStars(); syncSubmit() })
})

el.guestForm.addEventListener('submit', e => {
  e.preventDefault()
  if (!guest || guest.submitted) return
  if (rating < 1) { syncSubmit(); return }
  const bookingId = guest.booking_id
  if (!queue.some(q => q.review && q.booking_id === bookingId)) {
    queue.push({
      booking_id: bookingId,
      review: {
        rating,
        text: el.guestText.value.trim() || null,
        private: el.guestPriv.value.trim() || null,
        consent: true   // shown a publish notice on the form; no tick-box by owner's call
      },
      at: new Date().toISOString(),
      tries: 0
    })
    saveQueue()
  }
  guest.submitted = true
  save(LS_GUEST, guest)
  el.guestForm.hidden = true
  el.guestThanks.hidden = false
  el.guestCancel.hidden = true
  el.guestWrap.scrollTop = 0
  // Offline is fine: the job sits in the same retry queue as step taps and
  // staff_submit_review is idempotent per booking (ON CONFLICT DO NOTHING).
  flush()
})

el.guestDone.addEventListener('click', () => {
  exitGuestMode()
  toast('Review saved \u2014 thank you')
})
el.guestCancel.addEventListener('click', () => {
  exitGuestMode()
})

/* ---------------------------------------------------------------------- boot */

el.refresh.addEventListener('click', () => { refresh(false); flush() })
const tabPicnic = $('stf-tab-picnic'), tabAirbnb = $('stf-tab-airbnb')
if (tabPicnic) tabPicnic.addEventListener('click', () => switchTab('picnic'))
if (tabAirbnb) tabAirbnb.addEventListener('click', () => switchTab('airbnb'))

// Coming back to the tab is the most common "is it still accurate?" moment.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { refresh(true); flush() }
})
window.addEventListener('online', () => { paintPip(); flush(); refresh(true) })
window.addEventListener('offline', paintPip)

token = resolveToken()
if (guest) enterGuestMode()          // locked before anything else can paint
if (!token) {
  showNoAccess()
} else {
  const cached = load(LS_CACHE, null)
  if (cached) {                                   // paint instantly, then update
    payload = cached
    reviewedIds = new Set(cached.reviewed_ids || [])
    render()
  }
  refresh(true)
  flush()
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh(true)
  }, 90000)
}
paintPip()
