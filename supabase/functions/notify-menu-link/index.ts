// Triggered by: Database Webhook on menu_links INSERT
// Only fires when booking_id is present
// Sends: T4 — menu selection link to customer
//
// Changed 2026-10-05 (v19): SECURITY — the request body is no longer trusted.
// verify_jwt=false (the trigger sends no auth header), so anyone could POST a
// made-up {record} and email any booking's guest a menu link with arbitrary
// item limits. The payload's record.id is now only a pointer: the menu_links
// row is re-read from the DB, must exist, and must be < 30 minutes old (the
// trigger fires on INSERT, so a legitimate call is always seconds old).
// Do NOT add a CRON_SECRET/Authorization check — the trigger sends none.

import { sendEmail } from "../_shared/resend.ts"

const APP_URL = Deno.env.get("APP_URL") ?? "https://picnicstories.com"
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const MAX_AGE_MS = 30 * 60 * 1000

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => null)
    const id = Number(body?.record?.id)
    if (!Number.isInteger(id) || id <= 0) {
      return jsonResponse({ ok: false, error: "bad_request" }, 400)
    }

    const linkRes = await fetch(
      `${supabaseUrl}/rest/v1/menu_links?id=eq.${id}&select=id,booking_id,max_food_items,max_bev_items,created_at`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    )
    if (!linkRes.ok) throw new Error(`menu_links lookup failed: HTTP ${linkRes.status}`)
    const record = (await linkRes.json())?.[0]
    if (!record) {
      console.warn(`notify-menu-link: rejected — menu_link ${id} does not exist`)
      return jsonResponse({ ok: false, error: "unknown_menu_link" }, 404)
    }
    if (!(Date.now() - new Date(record.created_at).getTime() < MAX_AGE_MS)) {
      console.warn(`notify-menu-link: rejected — menu_link ${id} is not freshly inserted`)
      return jsonResponse({ ok: false, error: "stale" }, 403)
    }

    // Guard: only send when this link is tied to a booking
    if (!record.booking_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "no booking_id" }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    // Fetch the booking to get customer details
    const bookingRes = await fetch(
      `${supabaseUrl}/rest/v1/bookings?id=eq.${record.booking_id}&select=full_name,email_address,preferred_date`,
      {
        headers: {
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
        },
      }
    )
    const bookings = await bookingRes.json()
    const booking = bookings[0]

    if (!booking) {
      throw new Error(`Booking ${record.booking_id} not found`)
    }

    const menuUrl = `${APP_URL}?menu=${record.id}&booking=${record.booking_id}`

    await sendEmail({
      to: booking.email_address,
      subject: "Choose your picnic menu! 🍽️",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #2d6a4f;">Time to pick your menu, ${booking.full_name}! 🍽️</h2>
          <p>Your picnic on <strong>${booking.preferred_date}</strong> is coming up. We've put together a menu for you to choose from.</p>

          <div style="background: #f4f9f4; border-left: 4px solid #2d6a4f; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <p style="margin: 0 0 8px;">You can select up to <strong>${record.max_food_items} food items</strong> and <strong>${record.max_bev_items} beverages</strong>.</p>
          </div>

          <p style="text-align: center; margin: 32px 0;">
            <a href="${menuUrl}"
               style="background: #2d6a4f; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold;">
              🧺 Pick Your Menu
            </a>
          </p>

          <p style="color: #888; font-size: 13px;">This link is unique to your booking. Please don't share it.</p>
          <p>See you soon,<br/><strong>The Picnic Stories Team</strong> 🌿</p>
        </div>
      `,
    })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("notify-menu-link error:", err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})
