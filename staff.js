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

const SPINE = ['reached', 'setup_done', 'payment_received', 'wrapped']
const CHIPS = ['guests_arrived', 'guests_left']

const STEP_LABEL = {
  reached:          'Reached venue',
  setup_done:       'Setup done',
  payment_received: 'Payment received',
  wrapped:          'Wrap-up done',
  guests_arrived:   'Guests arrived',
  guests_left:      'Guests left'
}

const ACTION_LABEL = {
  reached:          'Mark reached',
  setup_done:       'Setup done',
  payment_received: 'Payment received',
  wrapped:          'Wrap-up done'
}

// Errors that will never succeed on retry — drop these from the queue instead
// of spinning forever. Anything else (network, 5xx) stays queued.
const TERMINAL_ERRORS = new Set(['unknown_step', 'not_today', 'bad_amount', 'out_of_order', 'invalid_token'])

const ERROR_TEXT = {
  invalid_token: 'This link is no longer valid.',
  unknown_step:  'Unknown step — reload the page.',
  not_today:     'That booking is not on today’s list any more.',
  bad_amount:    'Amount cannot be negative.',
  out_of_order:  'Do the previous step first.'
}

/* -------------------------------------------------------------------- state */

let token = null
let payload = null            // last staff_today response
let queue = load(LS_QUEUE, [])
let flushing = false
let refreshTimer = null

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
  payCancel: $('stf-pay-cancel')
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
    if (q.booking_id === ev.id && !have.has(q.step)) {
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
  if (!ev) return
  ev.log = log
  save(LS_CACHE, payload)
}

function nextSpineStep (ev) {
  const done = doneSteps(ev)
  return SPINE.find(s => !done.has(s)) || null
}

/* -------------------------------------------------------------------- render */

function render () {
  if (!payload) return
  const events = payload.events || []
  const staffName = payload.staff && payload.staff.name ? payload.staff.name : ''
  const dateText = payload.date
    ? new Date(payload.date + 'T00:00:00').toLocaleDateString('en-IN',
        { weekday: 'short', day: 'numeric', month: 'short' })
    : ''
  el.subtitle.textContent = [staffName, dateText].filter(Boolean).join(' · ')

  const todayHtml = events.length
    ? events.map(cardHtml).join('')
    : '<div class="stf-empty">' +
      '<p class="stf-empty-title">No events today</p>' +
      '<p>Nothing is scheduled. Tap refresh if you were expecting something.</p>' +
      '</div>'

  el.main.innerHTML = todayHtml + upcomingHtml(payload.upcoming || [])
  wireCards()
}

function cardHtml (ev) {
  const log = mergedLog(ev)
  const done = new Set(log.map(r => r.step))
  const next = nextSpineStep(ev)
  const allDone = !next

  const guests = ev.guests + ' guests' + (ev.children ? ` · ${ev.children} kids` : '')
  const venueBits = [ev.venue && ev.venue.name, ev.venue && ev.venue.area].filter(Boolean).join(', ')
  const mapsUrl = ev.venue && ev.venue.maps_url

  const tags = []
  if (ev.package_name) tags.push(esc(ev.package_name))
  if (ev.occasion) tags.push(esc(ev.occasion))
  if (ev.includes_food) {
    const f = []
    if (ev.food_items_count) f.push(`${ev.food_items_count} food`)
    if (ev.beverage_items_count) f.push(`${ev.beverage_items_count} drinks`)
    tags.push(f.length ? esc(f.join(' + ')) : 'Food included')
  }
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
    <div class="stf-money">
      <div>
        <div class="stf-money-label">Balance to collect</div>
        <div class="stf-money-value" data-zero="${balance > 0 ? '0' : '1'}">${
          balance > 0 ? esc(money(balance)) : 'Fully paid'
        }</div>
      </div>
      ${ev.mobile ? `<a class="stf-call" href="tel:${esc(ev.mobile)}">Call</a>` : ''}
    </div>
    ${log.length ? `<ul class="stf-timeline">${timeline}</ul>` : ''}
    ${action}
    <div class="stf-chips">${chips}</div>
  </article>`
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
      if (ev.includes_food) bits.push('Food')
      if (ev.occasion) bits.push(esc(ev.occasion))
      const guests = ev.guests + ' guests' + (ev.children ? ` · ${ev.children} kids` : '')
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
}

/* ------------------------------------------------------------- payment sheet */

let paying = null

function openPaySheet (bookingId) {
  const ev = (payload.events || []).find(e => e.id === bookingId)
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

async function flush () {
  if (flushing || !queue.length || !token) return
  flushing = true
  try {
    while (queue.length) {
      const job = queue[0]
      let data
      try {
        data = await rpc('staff_log_step', {
          p_token: token,
          p_booking_id: job.booking_id,
          p_step: job.step,
          p_note: job.note,
          p_amount: job.amount
        }) || {}
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
        applyServerLog(job.booking_id, data.log)
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
    const data = await rpc('staff_today', { p_token: token })
    if (!data || !data.ok) {
      if (data && data.error === 'invalid_token') { showNoAccess(); return }
      throw new Error('bad payload')
    }
    payload = data
    save(LS_CACHE, data)
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

/* ---------------------------------------------------------------------- boot */

el.refresh.addEventListener('click', () => { refresh(false); flush() })

// Coming back to the tab is the most common "is it still accurate?" moment.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { refresh(true); flush() }
})
window.addEventListener('online', () => { paintPip(); flush(); refresh(true) })
window.addEventListener('offline', paintPip)

token = resolveToken()
if (!token) {
  showNoAccess()
} else {
  const cached = load(LS_CACHE, null)
  if (cached) { payload = cached; render() }      // paint instantly, then update
  refresh(true)
  flush()
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh(true)
  }, 90000)
}
paintPip()
