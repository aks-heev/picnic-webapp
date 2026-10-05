// Triggered by: Database trigger on orders INSERT (on_order_insert_notify)
// Sends: T5 — alert email to team when a customer submits their menu selection
//
// Changed 2026-10-05 (v19): SECURITY — the request body is no longer trusted.
// verify_jwt=false (the trigger sends no auth header), so anyone could POST a
// made-up {record} and put arbitrary HTML (fake "menu items") into an email to
// the team inbox. The payload's record.id is now only a pointer: the orders
// row is re-read from the DB, must exist, and must be < 30 minutes old; item
// names/categories are HTML-escaped (they come from a customer-submitted form).
// Do NOT add a CRON_SECRET/Authorization check — the trigger sends none.

import { sendEmail } from "../_shared/resend.ts"

const APP_URL = Deno.env.get("APP_URL") ?? "https://picnicstories.com"
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const MAX_AGE_MS = 30 * 60 * 1000

interface SelectedItem {
  name?: string
  quantity?: number
  category?: string
  price?: number
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

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

    const orderRes = await fetch(
      `${supabaseUrl}/rest/v1/orders?id=eq.${id}&select=id,booking_id,selected_items,created_at`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    )
    if (!orderRes.ok) throw new Error(`orders lookup failed: HTTP ${orderRes.status}`)
    const record = (await orderRes.json())?.[0]
    if (!record) {
      console.warn(`notify-order-received: rejected — order ${id} does not exist`)
      return jsonResponse({ ok: false, error: "unknown_order" }, 404)
    }
    if (!(Date.now() - new Date(record.created_at).getTime() < MAX_AGE_MS)) {
      console.warn(`notify-order-received: rejected — order ${id} is not freshly inserted`)
      return jsonResponse({ ok: false, error: "stale" }, 403)
    }

    let booking: Record<string, unknown> | null = null
    let teamEmail: string | null = null

    if (record.booking_id) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/bookings?id=eq.${record.booking_id}&select=full_name,email_address,mobile_number,preferred_date,venues(teams(contact_email))`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      )
      if (res.ok) {
        const rows = await res.json()
        booking = rows?.[0] ?? null
        teamEmail = (booking as any)?.venues?.teams?.contact_email ?? null
      }
    }

    const items: SelectedItem[] = Array.isArray(record.selected_items)
      ? record.selected_items
      : []

    const itemRows = items
      .map(
        (i) => `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${esc(i.name ?? "—")}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${esc(i.category ?? "")}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">×${esc(i.quantity ?? 1)}</td>
          </tr>`,
      )
      .join("")

    const who = booking?.full_name
      ? `${booking.full_name}${booking.preferred_date ? ` (${booking.preferred_date})` : ""}`
      : `Booking #${record.booking_id ?? "?"}`

    const adminTo = teamEmail ? [teamEmail, "team@picnicstories.com"] : "team@picnicstories.com"

    await sendEmail({
      to: adminTo,
      subject: `Menu selection in — ${who}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2>🍽️ New menu selection #${record.id}</h2>
          <p><strong>${esc(who)}</strong> has submitted their menu.</p>

          ${booking
            ? `<p style="color:#555; font-size: 14px;">${esc(booking.email_address ?? "")}${booking.mobile_number ? ` · ${esc(booking.mobile_number)}` : ""}</p>`
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
