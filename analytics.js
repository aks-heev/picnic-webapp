/**
 * analytics.js — PostHog wrapper
 *
 * Usage:
 *   import { track, identifyUser, resetUser } from './analytics.js'
 *   track('venue_viewed', { venue_id: 5, venue_name: 'Castle Valley' })
 *
 * Set VITE_POSTHOG_KEY in .env.local to activate.
 * If the key is absent (e.g. local dev without a key) all calls are no-ops.
 */

import posthog from 'posthog-js'

const KEY  = import.meta.env.VITE_POSTHOG_KEY
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com'

let initialised = false

if (KEY) {
  posthog.init(KEY, {
    api_host:              HOST,
    capture_pageview:      'history_change',  // SPA-aware $pageview on route changes (needed for Web Analytics / bounce rate)
    capture_pageleave:     true,
    autocapture:           false,  // Explicit events only — avoids noise
    session_recording:     { maskAllInputs: true },
    persistence:           'localStorage+cookie',
    loaded: () => { initialised = true },
  })
}

/**
 * Fire an analytics event.
 * @param {string} event  - snake_case event name
 * @param {object} [props] - flat key/value properties
 */
export function track(event, props = {}) {
  if (!KEY || !initialised) return
  posthog.capture(event, props)
}

/**
 * Associate the current anonymous user with a known identity
 * (e.g. after they enter their phone / name in the booking form).
 * @param {string} distinctId - unique identifier (phone, email, etc.)
 * @param {object} [traits]
 */
export function identifyUser(distinctId, traits = {}) {
  if (!KEY || !initialised) return
  posthog.identify(distinctId, traits)
}

/** Call on logout / new session to detach identity. */
export function resetUser() {
  if (!KEY || !initialised) return
  posthog.reset()
}

export default posthog
