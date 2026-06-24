// Triggered by: Database trigger on orders INSERT (on_order_insert_notify)
// Sends: T5 — alert email to admin when a customer submits their menu selection

import { sendEmail } from "../_shared/resend.ts"

const ADMIN_EMAIL = "aksheevs@gmail.com"
const APP_URL = Deno.env.get("APP_URL") ?? "https://picnicstories.com"

interface SelectedItem {
  name?: string
  quantity?: number
  category?: string
  price?: number
}

Deno.serve(async (req) => {
  try {
    const { record } = await req.json()

    // Look up the booking for customer context (orders carry only IDs).
    let booking: Record<string, unknown> | null = null
    if (record.booking_id) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      const res = await fetch(
        `${supabaseUrl}/rest/v1/bookings?id=eq.${record.booking_id}&select=full_name,email_address,mobile_number,preferred_date`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      )
      if (res.ok) booking = (await res.json())?.[0] ?? null
    }

    const items: SelectedItem[] = Array.isArray(record.selected_items)
      ? record.selected_items
      : []

    const itemRows = items
      .map(
        (i) => `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${i.name ?? "—"}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${i.category ?? ""}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">×${i.quantity ?? 1}</td>
          </tr>`,
      )
      .join("")

    const who = booking?.full_name
      ? `${booking.full_name}${booking.preferred_date ? ` (${booking.preferred_date})` : ""}`
      : `Booking #${record.booking_id ?? "?"}`

    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `Menu selection in — ${who}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2>🍽️ New menu selection #${record.id}</h2>
          <p><strong>${who}</strong> has submitted their menu.</p>

          ${booking
            ? `<p style="color:#555; font-size: 14px;">
                 ${booking.email_address ?? ""}${booking.mobile_number ? ` · ${booking.mobile_number}` : ""}
               </p>`
            : ""}

          <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
            <tr style="background:#f4f9f4;">
              <th style="padding: 8px; border: 1px solid #ddd; text-align:left;">Item</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align:left;">Category</th>
              <th style="padding: 8px; border: 1px solid #ddd;">Qty</th>
            </tr>
            ${itemRows || `<tr><td colspan="3" style="padding:8px; border:1px solid #ddd;">No items recorded</td></tr>`}
          </table>

          <p style="margin-top: 24px;">
            <a href="${APP_URL}#admin" style="background: #2d6a4f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Open Admin Dashboard</a>
          </p>
        </div>
      `,
    })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("notify-order-received error:", err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})
