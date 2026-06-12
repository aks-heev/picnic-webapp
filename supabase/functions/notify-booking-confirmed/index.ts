// Triggered by: Database trigger on bookings UPDATE (on_booking_confirmed_notify)
// Only fires when confirmed flips false → true (guard enforced in trigger WHEN clause)
// Sends: T3 — booking confirmation email to customer

import { sendEmail } from "../_shared/resend.ts"
import { getVenueInfo } from "../_shared/venue.ts"
import { getAddOns, type AddOn } from "../_shared/addons.ts"

const APP_URL = Deno.env.get("APP_URL") || "https://picnicstories.com"

const LOGO_URL =
  "https://cdn-reach.hostinger.com/settings/0a27628d960484a8a3d2b3e50518a32b/307542/logo_1780982818.png"
const HERO_IMG =
  "https://images.hostinger.com/94826b0b-025f-4661-94d7-3e767b98d39d.png"

const TIME_SLOTS: Record<string, string> = {
  morning:   "9 AM – 12 PM",
  afternoon: "1 PM – 4 PM",
  evening:   "5 PM – 8 PM",
}

const OCCASION_HEADINGS: Record<string, string> = {
  "Birthday":      "MAKE A WISH",
  "Anniversary":   "HERE'S TO YOU TWO",
  "Proposal":      "THE MOMENT IS ALMOST HERE",
  "Baby Shower":   "BABY IS ON THE WAY",
  "Bridal Shower": "TO THE BRIDE-TO-BE",
  "Date Night":    "IT'S A DATE",
  "Graduation":    "YOU DID IT",
  "Just Because":  "BECAUSE TODAY IS ENOUGH",
}

function occasionHeading(occasion: unknown): string {
  if (!occasion || typeof occasion !== "string") return "IT'S A DATE"
  return OCCASION_HEADINGS[occasion] ?? "IT'S A DATE"
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—"
  const dt = new Date(d + "T00:00:00")
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
}

function timeRow(record: Record<string, unknown>): string {
  if (record.checkout_date) {
    return `${formatDate(record.preferred_date as string)} → ${formatDate(record.checkout_date as string)}`
  }
  const slot = record.time_slot as string | null
  return (slot && TIME_SLOTS[slot]) ? TIME_SLOTS[slot] : "—"
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// "Black board — “message”" from the board jsonb, or "" if no board.
function boardText(board: unknown): string {
  if (!board || typeof board !== "object") return ""
  const b = board as { type?: string; message?: string }
  if (!b.type && !b.message) return ""
  const type = b.type ? b.type.charAt(0).toUpperCase() + b.type.slice(1) + " board" : "Board"
  return b.message ? `${esc(type)} — “${esc(b.message)}”` : esc(type)
}

function reservationRow(label: string, value: string): string {
  return `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>${label}</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${value}</td>
                      </tr>`
}

function extrasSection(addons: AddOn[]): string {
  if (!addons.length) return ""
  const bullets = addons
    .map((a) => {
      const tag = a.requires_confirmation
        ? ` <span style="font-size: 13px; color: #b8860b;">(on request)</span>`
        : ""
      return `<p style="margin: 0 0 12px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 16px; color: #2D1F14;">• ${a.name ?? "Add-on"}${tag}</p>`
    })
    .join("")

  return `
    <!-- DIVIDER -->
    <tr>
      <td align="center" style="padding: 20px;">
        <table border="0" cellpadding="0" cellspacing="0" width="60%">
          <tbody><tr><td bgcolor="#c4607a" height="4" style="font-size: 0; line-height: 0;"></td></tr></tbody>
        </table>
      </td>
    </tr>
    <!-- CURATED EXTRAS -->
    <tr>
      <td align="left" style="padding: 32px; word-wrap: break-word; overflow-wrap: break-word;">
        <h3 style="margin: 0 0 20px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 26px; color: #2D1F14; font-weight: normal;">Curated Extras</h3>
        ${bullets}
      </td>
    </tr>`
}

function directionsRow(url: string | null): string {
  if (!url) return ""
  return `
    <tr>
      <td align="center" style="padding: 8px 32px 32px;">
        <a href="${url}"
           style="display: inline-block; padding: 16px 28px; border: 1px solid #c4607a; color: #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 15px; text-decoration: none; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px;"
           target="_blank">Get Directions</a>
      </td>
    </tr>`
}

function buildHtml(record: Record<string, unknown>, venueLabel: string | null, directionsUrl: string | null, addons: AddOn[]): string {
  const name      = record.full_name as string
  const date      = formatDate(record.preferred_date as string)
  const time      = timeRow(record)
  const location  = venueLabel ?? (record.venue_address as string | null) ?? "To be confirmed"
  const kidsCount = Number(record.children_count || 0)
  const guests    = kidsCount
    ? `${Number(record.guest_count) - kidsCount} Adults · ${kidsCount} Child${kidsCount !== 1 ? "ren" : ""} (first 2 free)`
    : `${record.guest_count} ${Number(record.guest_count) === 1 ? "Person" : "Persons"}`
  const advAmt    = Number(record.advance_amount || 0)
  const setupLabel = record.checkout_date ? "Stay + Picnic setup" : "Picnic setup"
  const occasionRowHtml = record.occasion ? reservationRow("OCCASION", esc(record.occasion)) : ""
  const boardRowHtml    = boardText(record.board) ? reservationRow("BOARD", boardText(record.board)) : ""

  return `<!DOCTYPE html>
<html>
<head>
  <meta content="text/html; charset=utf-8"/>
  <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
  <title>Luxury Booking Confirmation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #FFF8F5; text-size-adjust: 100%;">
  <table bgcolor="#FFF8F5" border="0" cellpadding="0" cellspacing="0" style="table-layout: fixed;" width="100%">
    <tbody>
      <tr>
        <td align="center" style="padding: 0;">
          <table border="0" cellpadding="0" cellspacing="0" style="max-width: 640px; width: 100%;" width="100%">
            <tbody>

              <!-- HEADER -->
              <tr>
                <td align="center" style="padding: 32px; word-wrap: break-word; overflow-wrap: break-word;">
                  <img alt="The Picnic Stories" height="80" src="${LOGO_URL}"
                    style="display: block; width: 80px; height: 80px; margin-bottom: 20px;" width="80"/>
                  <h1 style="margin: 0; font-family: Garamond, 'Times New Roman', serif; font-size: 24px; color: #2D1F14; text-transform: uppercase; letter-spacing: 8px; font-weight: normal; line-height: 1.2;">THE PICNIC STORIES</h1>
                  <p style="margin: 12px 0 0 0; font-family: Garamond, 'Times New Roman', serif; font-size: 12px; color: #c4607a; letter-spacing: 2px; text-transform: uppercase;">Luxury Boho Experiences</p>
                </td>
              </tr>

              <!-- DIVIDER -->
              <tr>
                <td align="center" style="padding: 20px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="40%">
                    <tbody><tr><td bgcolor="#c4607a" height="4" style="font-size: 0; line-height: 0;"></td></tr></tbody>
                  </table>
                </td>
              </tr>

              <!-- HERO -->
              <tr>
                <td align="center" style="padding: 32px; word-wrap: break-word; overflow-wrap: break-word;">
                  <h2 style="margin: 0; font-family: Garamond, 'Times New Roman', serif; font-size: 48px; color: #2D1F14; font-weight: normal; line-height: 1.1; text-transform: uppercase;">${occasionHeading(record.occasion)}</h2>
                  <p style="margin: 20px 0 32px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 20px; color: #c4607a; line-height: 1.4;">
                    ${name.split(" ")[0]}, your luxury picnic is officially on the calendar. We are curating the magic — you just bring the memories.
                  </p>
                  <table border="0" cellpadding="0" cellspacing="0">
                    <tbody>
                      <tr>
                        <td align="center">
                          <a href="${APP_URL}/?view=mybookings"
                             style="display: inline-block; padding: 20px 32px; background-color: #c4607a; color: #FFFFFF; font-family: Garamond, 'Times New Roman', serif; font-size: 16px; text-decoration: none; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px;"
                             target="_blank">View Booking Details</a>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>

              <!-- HERO IMAGE -->
              <tr>
                <td align="center" style="padding: 20px;">
                  <img alt="Luxury Picnic Setup" src="${HERO_IMG}"
                    style="width: 100%; max-width: 100%; height: auto; display: block; border-radius: 20px;"/>
                </td>
              </tr>

              <!-- RESERVATION DETAILS -->
              <tr>
                <td align="left" style="padding: 32px; word-wrap: break-word; overflow-wrap: break-word;">
                  <h3 style="margin: 0 0 24px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 28px; color: #2D1F14; font-weight: normal; text-transform: uppercase;">The Reservation</h3>
                  <table border="0" cellpadding="0" cellspacing="0" width="100%">
                    <tbody>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>DATE</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${date}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>${record.checkout_date ? "STAY" : "TIME"}</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${time}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>LOCATION</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${location}</td>
                      </tr>
                      ${occasionRowHtml}
                      ${boardRowHtml}
                      <tr>
                        <td style="padding: 8px 0; ${advAmt > 0 ? "border-bottom: 1px solid #c4607a;" : ""} font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>GUESTS</strong></td>
                        <td align="right" style="padding: 8px 0; ${advAmt > 0 ? "border-bottom: 1px solid #c4607a;" : ""} font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${guests}</td>
                      </tr>
                      ${advAmt > 0 ? `
                      <tr>
                        <td style="padding: 8px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>TOTAL</strong></td>
                        <td align="right" style="padding: 8px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">₹${Number(advAmt).toLocaleString("en-IN")}</td>
                      </tr>` : ""}
                    </tbody>
                  </table>
                </td>
              </tr>

              <!-- DIRECTIONS BUTTON -->
              ${directionsRow(directionsUrl)}

              <!-- CURATED EXTRAS (only if add-ons exist) -->
              ${extrasSection(addons)}

              <!-- CONTACT SUPPORT -->
              <tr>
                <td align="center" style="padding: 32px; word-wrap: break-word; overflow-wrap: break-word;">
                  <p style="margin: 0 0 32px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #c4607a; font-style: italic;">
                    Have questions or need to make adjustments to your picnic?
                  </p>
                  <table border="0" cellpadding="0" cellspacing="0">
                    <tbody>
                      <tr>
                        <td align="center">
                          <a href="mailto:team@picnicstories.com"
                             style="display: inline-block; padding: 20px 32px; border: 1px solid #c4607a; color: #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 16px; text-decoration: none; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px;"
                             target="_blank">Contact Support</a>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>

              <!-- FOOTER -->
              <tr>
                <td align="center" style="padding: 32px; word-wrap: break-word; overflow-wrap: break-word;">
                  <table border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                    <tbody>
                      <tr>
                        <td style="padding: 0 8px;">
                          <a href="https://www.instagram.com/the.picnic.stories/" target="_blank">
                            <img alt="Instagram" height="24" src="https://cdn.simpleicons.org/instagram/c4607a"
                              style="display: block; border: 0;" width="24"/>
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p style="margin: 0 0 4px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 12px; color: #c4607a; text-transform: uppercase; letter-spacing: 1px;">The Picnic Stories</p>
                  <p style="margin: 0 0 4px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 12px; color: #c4607a;">team@picnicstories.com</p>
                  <p style="margin: 0; font-family: Garamond, 'Times New Roman', serif; font-size: 11px; color: #aaa;">Booking #${record.id}</p>
                </td>
              </tr>

            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`
}

Deno.serve(async (req) => {
  try {
    const { record, old_record } = await req.json()

    // Guard: only send when confirmed changes from false → true
    if (!record.confirmed || old_record?.confirmed === true) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    const { label: venueLabel, directionsUrl } = await getVenueInfo(record.venue_id, record.venue_address)
    const addons = await getAddOns(record.id)

    await sendEmail({
      to: record.email_address,
      subject: "Luxury Booking Confirmation",
      html: buildHtml(record, venueLabel, directionsUrl, addons),
    })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("notify-booking-confirmed error:", err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})
