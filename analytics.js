/**
 * analytics.js — PostHog wrapper (lazy-loaded)
 *
 * Usage:
 *   import { track, identifyUser, resetUser } from './analytics.js'
 *   track('venue_viewed', { venue_id: 5, venue_name: 'Castle Valley' })
 *
 * Set VITE_POSTHOG_KEY in .env.local to activate.
 * If the key is absent (e.g. local dev without a key) all calls are no-ops.
 *
 * PERF (2026-07-04): posthog-js (~55KB gzip — the single largest chunk of the
 * public bundle) is now DYNAMIC-imported after first paint, so it stays off the
 * initial critical path instead of being statically bundled into app.js. Calls
 * to track()/identifyUser() made before it finishes loading are queued and
 * flushed on init, so no early events are lost. Session recording is sampled
 * (~20%) because rrweb is the biggest main-thread INP cost.
 */

const KEY  = import.meta.env.VITE_POSTHOG_KEY
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com'

// ~20% of page loads record a session replay. Keeps a representative sample for
// UX debugging while removing rrweb from the other ~80% of sessions. For
// per-session (not per-load) consistency, also set the sample rate in the
// PostHog project settings → Session Replay; this client gate is belt-and-braces.
const RECORD_THIS_SESSION = Math.random() < 0.2

let ph = null      // posthog instance, once the dynamic import resolves
let ready = false  // true after posthog.init's loaded callback fires
const queue = []   // events fired before load: ['capture'|'identify'|'reset', a, b]

function flushQueue() {
  if (!ph || !ready) return
  while (queue.length) {
    const [op, a, b] = queue.shift()
    try {
      if (op === 'capture') ph.capture(a, b)
      else if (op === 'identify') ph.identify(a, b)
      else if (op === 'reset') ph.reset()
    } catch (_) { /* never let analytics break the app */ }
  }
}

async function loadPostHog() {
  if (!KEY || ph) return
  try {
    const mod = await import('posthog-js')
    ph = mod.default
    ph.init(KEY, {
      api_host:                  HOST,
      capture_pageview:          'history_change', // SPA-aware $pageview on route changes
      capture_pageleave:         true,
      autocapture:               false,            // explicit events only
      session_recording:         { maskAllInputs: true },
      disable_session_recording: !RECORD_THIS_SESSION, // ~20% sampling (see above)
      persistence:               'localStorage+cookie',
      loaded: () => { ready = true; flushQueue() },
    })
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[analytics] PostHog failed to load', err)
  }
}

// Kick the load off once the page is interactive — off the critical path.
if (KEY && typeof window !== 'undefined') {
  const start = () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(loadPostHog, { timeout: 4000 })
    else setTimeout(loadPostHog, 1)
  }
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

/**
 * Fire an analytics event. Safe to call before PostHog has loaded — the event
 * is queued and flushed on init.
 * @param {string} event  - snake_case event name
 * @param {object} [props] - flat key/value properties
 */
export function track(event, props = {}) {
  if (!KEY) return
  if (ph && ready) { try { ph.capture(event, props) } catch (_) {} }
  else queue.push(['capture', event, props])
}

/**
 * Associate the current anonymous user with a known identity
 * (e.g. after they enter their phone / name in the booking form).
 * @param {string} distinctId - unique identifier (phone, email, etc.)
 * @param {object} [traits]
 */
export function identifyUser(distinctId, traits = {}) {
  if (!KEY) return
  if (ph && ready) { try { ph.identify(distinctId, traits) } catch (_) {} }
  else queue.push(['identify', distinctId, traits])
}

/** Call on logout / new session to detach identity. */
export function resetUser() {
  if (!KEY) return
  if (ph && ready) { try { ph.reset() } catch (_) {} }
  else queue.push(['reset'])
}
