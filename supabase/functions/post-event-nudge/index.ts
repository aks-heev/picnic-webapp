/**
 * post-event-nudge
 * Called daily via pg_cron ~48h after a picnic/stay ends.
 * Sends a review-ask + rebook CTA to every confirmed booking whose
 * experience ended exactly 2 days ago.
 *
 * Changed 2026-07-16 (review-engine wiring, P1 from docs/SCOPE_AUDIT_2026-07-16.md):
 *  1. Eligibility widened from `payment_status=eq.paid` to `confirmed=eq.true`.
 *     Admin-entered bookings (offline-collected advance) stay payment_status='pending'
 *     forever even when confirmed=true (see admin_add_manual_booking) — the old filter
 *     silently excluded every manually confirmed booking from ever getting a review ask.
 *     `confirmed` is the actual "this happened" flag used everywhere else in the app.
 *  2. "Experience end date" now uses checkout_date when present (stays), falling back
 *     to preferred_date (picnics / check-in). The old version only checked preferred_date,
 *     which would have fired the nudge on check-in day for a multi-night stay instead of
 *     after checkout.
 *  3. Review link is now per-city, sourced from CITY_REVIEW_LINKS below, and the review
 *     CTA box is only rendered for cities with a real link. Gurugram's real link was
 *     pulled live from the GBP dashboard's "Get more reviews" panel today
 *     (https://g.page/r/CcWNZdFawDgHEAI/review) — the old GOOGLE_REVIEW_URL env var
 *     fallback was the literal placeholder string "[GOOGLE_REVIEW_LINK]", which would
 *     have shipped a broken link in every email if the secret was never actually set
 *     (no way to verify from here whether it ever was). Jaipur has no GBP profile yet
 *     (deliberately deferred by the user) — Jaipur/Delhi bookings still get the
 *     thank-you + rebook email, just without a review box, rather than a wrong-city or
 *     broken review link.
 *
 * Required Supabase function secrets:
 *   RESEND_API_KEY            — already set (shared with notify-* functions)
 *   SUPABASE_URL               — injected automatically
 *   SUPABASE_SERVICE_ROLE_KEY  — injected automatically
 *   CRON_SECRET                — optional; set to lock down the endpoint
 *   APP_URL                    — optional; defaults to https://picnicstories.com
 *   GOOGLE_REVIEW_URL_GURUGRAM — optional override for the Gurugram link below
 *   GOOGLE_REVIEW_URL_JAIPUR   — set this once the Jaipur GBP profile exists
 */

import { sendEmail } from "./_shared/resend.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const CRON_SECRET  = Deno.env.get("CRON_SECRET")
const APP_URL       = Deno.env.get("APP_URL") ?? "https://picnicstories.com"

// Per-city Google review links. Env var override wins if set (lets a real secret
// replace this without a redeploy); otherwise falls back to the confirmed-live link.
const CITY_REVIEW_LINKS: Record<string, string | undefined> = {
  Gurugram: Deno.env.get("GOOGLE_REVIEW_URL_GURUGRAM") ?? "https://g.page/r/CcWNZdFawDgHEAI/review",
  Jaipur: Deno.env.get("GOOGLE_REVIEW_URL_JAIPUR"), // undefined until that GBP profile exists
  Delhi: Deno.env.get("GOOGLE_REVIEW_URL_GURUGRAM") ?? "https://g.page/r/CcWNZdFawDgHEAI/review", // Delhi shares the Gurugram-area profile for now
}

interface EligibleBooking {
  id: number
  full_name: string
  email_address: string | null
  preferred_date: string
  checkout_date: string | null
  venues: { name: string; city: string | null } | null
}

Deno.serve(async (req) => {
  try {
    if (CRON_SECRET) {
      const auth = req.headers.get("Authorization") ?? ""
      if (auth !== `Bearer ${CRON_SECRET}`) {
        console.warn("post-event-nudge: unauthorized call rejected")
        return new Response("Unauthorized", { status: 401 })
      }
    }

    const target = new Date()
    target.setDate(target.getDate() - 2)
    const dateStr = target.toISOString().split("T")[0]

    // Two eligibility passes: picnics/check-ins with no checkout_date whose
    // preferred_date was 2 days ago, OR stays whose checkout_date was 2 days ago.
    const [picnicRes, stayRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/bookings` +
        `?preferred_date=eq.${dateStr}` +
        `&checkout_date=is.null` +
        `&confirmed=eq.true` +
        `&select=id,full_name,email_address,preferred_date,checkout_date,venues(name,city)`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/bookings` +
        `?checkout_date=eq.${dateStr}` +
        `&confirmed=eq.true` +
        `&select=id,full_name,email_address,preferred_date,checkout_date,venues(name,city)`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
      ),
    ])
    if (!picnicRes.ok) throw new Error(`Picnic bookings fetch error ${picnicRes.status}: ${await picnicRes.text()}`)
    if (!stayRes.ok) throw new Error(`Stay bookings fetch error ${stayRes.status}: ${await stayRes.text()}`)

    const picnics: EligibleBooking[] = await picnicRes.json()
    const stays: EligibleBooking[] = await stayRes.json()
    const bookings = [...picnics, ...stays]

    let sent = 0
    let skippedNoEmail = 0
    for (const b of bookings) {
      if (!b.email_address) {
        skippedNoEmail++
        continue
      }
      const venueName = b.venues?.name ?? "your recent experience"
      const city = b.venues?.city ?? ""
      const reviewUrl = CITY_REVIEW_LINKS[city]
      await sendEmail({
        to: b.email_address,
        subject: `How was your experience at ${venueName}? 🌿`,
        html: buildEmail(b.full_name, venueName, b.id, reviewUrl),
      })
      sent++
    }

    console.log(
      `post-event-nudge: ${dateStr} → sent ${sent}/${bookings.length} emails ` +
      `(${picnics.length} picnic, ${stays.length} stay, ${skippedNoEmail} skipped no-email)`,
    )
    return new Response(
      JSON.stringify({ ok: true, date: dateStr, sent, picnics: picnics.length, stays: stays.length, skippedNoEmail }),
      { headers: { "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("post-event-nudge error:", err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})

function buildEmail(name: string, venueName: string, bookingId: number, reviewUrl: string | undefined): string {
  const reviewBlock = reviewUrl
    ? `
      <div style="background: #fff; border: 1px solid #f0d8d8; border-radius: 10px;
                  padding: 28px 24px; margin: 0 0 28px; text-align: center;">
        <p style="margin: 0 0 6px; font-size: 26px; letter-spacing: 5px; color: #e8a020;">★★★★★</p>
        <p style="margin: 0 0 20px; font-size: 14px; color: #666; font-family: sans-serif; line-height: 1.6;">
          A quick Google review takes 60 seconds and means the world<br>to a small team like ours.
        </p>
        <a href="${reviewUrl}" target="_blank" rel="noopener noreferrer"
           style="display: inline-block; background: #6b2d3e; color: #fff;
                  padding: 13px 30px; border-radius: 5px; text-decoration: none;
                  font-size: 15px; font-family: sans-serif; font-weight: 600;">
          Leave us a review →
        </a>
      </div>`
    : `
      <div style="background: #fff; border: 1px solid #f0d8d8; border-radius: 10px;
                  padding: 22px 24px; margin: 0 0 28px; text-align: center;">
        <p style="margin: 0; font-size: 14px; color: #666; font-family: sans-serif; line-height: 1.6;">
          We'd love to hear how it went — just reply to this email and let us know!
        </p>
      </div>`

  return `
    <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 580px; margin: 0 auto;
                color: #333; background: #fffbf7; padding: 48px 36px; border-radius: 10px;">

      <p style="font-size: 13px; color: #aaa; text-transform: uppercase; letter-spacing: 2px;
                margin: 0 0 20px; font-family: sans-serif;">The Picnic Stories</p>

      <h1 style="font-size: 24px; color: #6b2d3e; margin: 0 0 6px; font-weight: normal;">
        Hi ${esc(name)} 🌸
      </h1>
      <p style="font-size: 15px; color: #888; margin: 0 0 28px; font-family: sans-serif;">
        We hope it was everything you dreamed of.
      </p>

      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 24px;">
        It was our pleasure hosting you at <strong>${esc(venueName)}</strong>. Our team puts their
        heart into every setup, and we'd genuinely love to know how we did.
      </p>

      ${reviewBlock}

      <p style="font-size: 14px; line-height: 1.75; color: #666; margin: 0 0 10px; font-family: sans-serif;">
        Already thinking about the next occasion? Dates fill up fast — especially around festivals and long weekends.
      </p>
      <p style="margin: 0 0 36px; font-family: sans-serif;">
        <a href="${APP_URL}" style="color: #6b2d3e; font-size: 14px; font-weight: 600;">
          Browse our venues →
        </a>
      </p>

      <p style="font-size: 14px; line-height: 1.7; color: #888; margin: 0 0 4px; font-family: sans-serif;">
        With love,
      </p>
      <p style="font-size: 15px; color: #555; margin: 0; font-weight: 600;">
        The Picnic Stories Team 🌿
      </p>

      <p style="margin-top: 36px; color: #ccc; font-size: 11px; font-family: sans-serif;">
        Booking ref #${bookingId}
      </p>
    </div>
  `
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
