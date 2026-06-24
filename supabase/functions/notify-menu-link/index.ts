// Triggered by: Database Webhook on menu_links INSERT
// Only fires when booking_id is present (i.e. linked to a real booking)
// Sends: T4 — menu selection link to customer

import { sendEmail } from "../_shared/resend.ts"

const APP_URL = Deno.env.get("APP_URL") ?? "https://picnicstories.com"

Deno.serve(async (req) => {
  try {
    const { record } = await req.json()

    // Guard: only send when this link is tied to a booking
    if (!record.booking_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "no booking_id" }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    // Fetch the booking to get customer details
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

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
          <h2 style="color: #c4607a;">Time to pick your menu, ${booking.full_name}! 🍽️</h2>
          <p>Your picnic on <strong>${booking.preferred_date}</strong> is coming up. We've put together a menu for you to choose from.</p>

          <div style="background: #fbeef2; border-left: 4px solid #c4607a; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <p style="margin: 0 0 8px;">You can select up to <strong>${record.max_food_items} food items</strong> and <strong>${record.max_bev_items} beverages</strong>.</p>
          </div>

          <p style="text-align: center; margin: 32px 0;">
            <a href="${menuUrl}"
               style="background: #c4607a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold;">
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
