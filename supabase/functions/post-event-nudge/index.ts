/**
 * post-event-nudge
 * Called daily via pg_cron ~48h after a picnic/stay.
 * Sends a review-ask + rebook CTA to every confirmed paid booking
 * whose preferred_date was exactly 2 days ago.
 *
 * Required Supabase function secrets:
 *   RESEND_API_KEY         — already set (shared with notify-* functions)
 *   SUPABASE_URL           — injected automatically
 *   SUPABASE_SERVICE_ROLE_KEY — injected automatically
 *   CRON_SECRET            — optional; set to lock down the endpoint
 *   APP_URL                — optional; defaults to https://picnicstories.com
 *   GOOGLE_REVIEW_URL      — paste your Google Business review link here
 */

import { sendEmail } from "./_shared/resend.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const CRON_SECRET  = Deno.env.get("CRON_SECRET")
const APP_URL      = Deno.env.get("APP_URL") ?? "https://picnicstories.com"
const REVIEW_URL   = Deno.env.get("GOOGLE_REVIEW_URL") ?? "[GOOGLE_REVIEW_LINK]"

Deno.serve(async (req) => {
  try {
    // ── Auth: verify cron secret if set ──────────────────────────────
    if (CRON_SECRET) {
      const auth = req.headers.get("Authorization") ?? ""
      if (auth !== `Bearer ${CRON_SECRET}`) {
        console.warn("post-event-nudge: unauthorized call rejected")
        return new Response("Unauthorized", { status: 401 })
      }
    }

    // ── Target date: bookings whose preferred_date = today - 2 days ──
    const target = new Date()
    target.setDate(target.getDate() - 2)
    const dateStr = target.toISOString().split("T")[0]

    // ── Fetch confirmed paid bookings from that date ──────────────────
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings` +
      `?preferred_date=eq.${dateStr}` +
      `&confirmed=eq.true` +
      `&payment_status=eq.paid` +
      `&select=id,full_name,email_address,venues(name)`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    )
    if (!res.ok) throw new Error(`Bookings fetch error ${res.status}: ${await res.text()}`)

    const bookings: Array<{
      id: number
      full_name: string
      email_address: string
      venues: { name: string } | null
    }> = await res.json()

    let sent = 0
    for (const b of bookings) {
      const venueName = b.venues?.name ?? "your recent experience"
      await sendEmail({
        to: b.email_address,
        subject: `How was your experience at ${venueName}? 🌿`,
        html: buildEmail(b.full_name, venueName, b.id),
      })
      sent++
    }

    console.log(`post-event-nudge: ${dateStr} → sent ${sent}/${bookings.length} emails`)
    return new Response(
      JSON.stringify({ ok: true, date: dateStr, sent }),
      { headers: { "Content-Type": "application/json" } }
    )
  } catch (err) {
    console.error("post-event-nudge error:", err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})

function buildEmail(name: string, venueName: string, bookingId: number): string {
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

      <!-- Review CTA box -->
      <div style="background: #fff; border: 1px solid #f0d8d8; border-radius: 10px;
                  padding: 28px 24px; margin: 0 0 28px; text-align: center;">
        <p style="margin: 0 0 6px; font-size: 26px; letter-spacing: 5px; color: #e8a020;">★★★★★</p>
        <p style="margin: 0 0 20px; font-size: 14px; color: #666; font-family: sans-serif; line-height: 1.6;">
          A quick Google review takes 60 seconds and means the world<br>to a small team like ours.
        </p>
        <a href="${REVIEW_URL}" target="_blank" rel="noopener noreferrer"
           style="display: inline-block; background: #6b2d3e; color: #fff;
                  padding: 13px 30px; border-radius: 5px; text-decoration: none;
                  font-size: 15px; font-family: sans-serif; font-weight: 600;">
          Leave us a review →
        </a>
      </div>

      <!-- Soft rebook nudge -->
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
