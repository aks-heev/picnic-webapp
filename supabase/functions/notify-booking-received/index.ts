// Triggered by: Database trigger on bookings INSERT (on_booking_insert_notify)
// Sends: T1 — acknowledgement email to customer (branded, matches confirmation email design)
//        T2 — alert email to admin

import { sendEmail } from "./_shared/resend.ts"
import { getVenueInfo } from "./_shared/venue.ts"
import { getAddOns, type AddOn } from "./_shared/addons.ts"

const APP_URL = Deno.env.get("APP_URL") ?? "https://picnicstories.com"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const LOGO_URL =
  "https://cdn-reach.hostinger.com/settings/0a27628d960484a8a3d2b3e50518a32b/307542/logo_1780982818.png"
const HERO_IMG =
  "https://images.hostinger.com/94826b0b-025f-4661-94d7-3e767b98d39d.png"

const QUERY_HEADINGS: Record<string, string> = {
  "Birthday":      "ALMOST TIME TO CELEBRATE",
  "Anniversary":   "HERE'S TO YOU TWO",
  "Proposal":      "THE MOMENT IS ALMOST HERE",
  "Baby Shower":   "BABY IS ON THE WAY",
  "Bridal Shower": "TO THE BRIDE-TO-BE",
  "Date Night":    "A DATE TO LOOK FORWARD TO",
  "Graduation":    "YOU DID IT",
  "Just Because":  "BECAUSE TODAY IS ENOUGH",
}

function queryHeading(occasion: unknown): string {
  if (!occasion || typeof occasion !== "string") return "YOUR PICNIC AWAITS"
  return QUERY_HEADINGS[occasion] ?? "YOUR PICNIC AWAITS"
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—"
  const dt = new Date(d + "T00:00:00")
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function boardText(board: unknown): string {
  if (!board || typeof board !== "object") return ""
  const b = board as { type?: string; message?: string }
  if (!b.type && !b.message) return ""
  const type = b.type ? b.type.charAt(0).toUpperCase() + b.type.slice(1) + " board" : "Board"
  return b.message ? `${esc(type)} — "${esc(b.message)}"` : esc(type)
}

function reservationRow(label: string, value: string): string {
  return `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>${label}</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${value}</td>
                      </tr>`
}

async function getInclusionText(venueId: number | null | undefined, adults: number): Promise<string> {
  if (!venueId || adults <= 0) return ""
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${venueId}&select=metadata`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (!res.ok) return ""
    const m = (await res.json())?.[0]?.metadata ?? {}
    const fm = Number(m.food_multiplier), dm = Number(m.drink_multiplier)
    if (!fm && !dm) return ""
    const food = Math.ceil(adults * (fm || 0)), drinks = Math.ceil(adults * (dm || 0))
    return `${food} food item${food !== 1 ? "s" : ""} · ${drinks} beverage${drinks !== 1 ? "s" : ""}`
  } catch (_err) { return "" }
}

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`

function adminCostBlock(record: Record<string, unknown>, addons: AddOn[], setupLabel = "Picnic setup"): string {
  const advance     = Number(record.advance_amount || 0)
  const totalFromDB = Number(record.total_amount || 0)
  const addonsTotal = addons.reduce((s, a) => s + Number(a.price_at_booking || 0), 0)
  const pkgTotal    = totalFromDB > 0 ? totalFromDB : advance > 0 ? advance * 2 : 0
  if (pkgTotal <= 0 && !addons.length) return ""

  const setupBase = Math.max(0, pkgTotal - addonsTotal)
  const dueOnDay  = Math.max(0, pkgTotal - advance)
  const status    = String(record.payment_status || "pending")
  const statusBadge = status === "paid"
    ? `<span style="background:#d4edda;color:#155724;padding:2px 8px;border-radius:4px;font-size:12px;">✅ Paid</span>`
    : status === "failed"
    ? `<span style="background:#f8d7da;color:#721c24;padding:2px 8px;border-radius:4px;font-size:12px;">❌ Failed</span>`
    : `<span style="background:#fff3cd;color:#856404;padding:2px 8px;border-radius:4px;font-size:12px;">⏳ Pending</span>`

  const setupRow   = setupBase > 0
    ? `<tr><td style="padding:6px 8px;">${setupLabel}</td><td style="padding:6px 8px;text-align:right;">${inr(setupBase)}</td></tr>`
    : ""
  const addonRows  = addons.map((a) => {
    const tag = a.requires_confirmation ? ` <span style="color:#b8860b;font-size:11px;">(on request)</span>` : ""
    return `<tr><td style="padding:6px 8px;">${a.name ?? "Add-on"}${tag}</td><td style="padding:6px 8px;text-align:right;">+${inr(a.price_at_booking || 0)}</td></tr>`
  }).join("")
  const pidRow     = record.razorpay_payment_id
    ? `<tr><td colspan="2" style="padding:4px 8px;font-size:12px;color:#888;">Payment ID: <code>${record.razorpay_payment_id}</code></td></tr>`
    : ""

  return `<div style="margin:24px 0;">
    <table style="border-collapse:collapse;width:100%;font-size:15px;">
      ${setupRow}${addonRows}
      <tr><td colspan="2" style="border-top:1px solid #ddd;padding:0;"></td></tr>
      <tr>
        <td style="padding:8px;font-weight:bold;font-size:16px;">Package Total</td>
        <td style="padding:8px;text-align:right;font-weight:bold;font-size:16px;">${inr(pkgTotal)}</td>
      </tr>
      ${advance > 0 ? `
      <tr>
        <td style="padding:6px 8px;">Advance Paid &nbsp;${statusBadge}</td>
        <td style="padding:6px 8px;text-align:right;color:#2d6a4f;font-weight:bold;">${inr(advance)}</td>
      </tr>
      <tr>
        <td style="padding:6px 8px;color:#666;">Due on Day</td>
        <td style="padding:6px 8px;text-align:right;color:#666;">${inr(dueOnDay)}</td>
      </tr>
      ${pidRow}` : `
      <tr>
        <td style="padding:6px 8px;color:#666;">Advance required (50%)</td>
        <td style="padding:6px 8px;text-align:right;color:#666;">${inr(Math.round(pkgTotal * 0.5))}</td>
      </tr>`}
    </table>
    ${addons.some((a) => a.requires_confirmation) ? `<p style="color:#888;font-size:12px;margin:6px 0 0;">"On request" items are subject to host confirmation.</p>` : ""}
  </div>`
}

function extrasSection(addons: AddOn[]): string {
  if (!addons.length) return ""
  const bullets = addons
    .map((a) => {
      const price = a.price_at_booking ? ` <span style="color: #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 16px;">+${inr(a.price_at_booking)}</span>` : ""
      const tag = a.requires_confirmation
        ? ` <span style="font-size: 13px; color: #b8860b;">(on request)</span>`
        : ""
      return `<p style="margin: 0 0 12px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 16px; color: #2D1F14;">• ${a.name ?? "Add-on"}${price}${tag}</p>`
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
                  ${addons.some((a) => a.requires_confirmation) ? `<p style="color:#888; font-family: Garamond, 'Times New Roman', serif; font-size: 13px; margin: 8px 0 0;">"On request" items are subject to host confirmation.</p>` : ""}
                </td>
              </tr>`
}

function buildQueryHtml(
  record: Record<string, unknown>,
  venueLabel: string | null,
  inclusionText: string,
  addons: AddOn[],
): string {
  const firstName  = String(record.full_name ?? "").split(" ")[0] || "there"
  const date       = formatDate(record.preferred_date as string)
  const location   = venueLabel ?? (record.venue_address as string | null) ?? "To be confirmed"
  const kidsCount  = Number(record.children_count || 0)
  const guestCount = Number(record.guest_count || 0)
  const adults     = guestCount - kidsCount
  const guests     = kidsCount
    ? `${adults} Adults · ${kidsCount} Child${kidsCount !== 1 ? "ren" : ""} (free)`
    : `${guestCount} ${guestCount === 1 ? "Person" : "Persons"}`

  return `<!DOCTYPE html>
<html>
<head>
  <meta content="text/html; charset=utf-8"/>
  <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
  <title>We've received your request</title>
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
                  <h2 style="margin: 0; font-family: Garamond, 'Times New Roman', serif; font-size: 48px; color: #2D1F14; font-weight: normal; line-height: 1.1; text-transform: uppercase;">${queryHeading(record.occasion)}</h2>
                  <p style="margin: 20px 0 0 0; font-family: Garamond, 'Times New Roman', serif; font-size: 20px; color: #c4607a; line-height: 1.4;">
                    ${firstName}, we've received your picnic request and we're already looking forward to it. We'll confirm your date shortly — hold tight.
                  </p>
                </td>
              </tr>

              <!-- HERO IMAGE -->
              <tr>
                <td align="center" style="padding: 20px;">
                  <img alt="Luxury Picnic Setup" src="${HERO_IMG}"
                    style="width: 100%; max-width: 100%; height: auto; display: block; border-radius: 20px;"/>
                </td>
              </tr>

              <!-- REQUEST DETAILS -->
              <tr>
                <td align="left" style="padding: 32px; word-wrap: break-word; overflow-wrap: break-word;">
                  <h3 style="margin: 0 0 24px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 28px; color: #2D1F14; font-weight: normal; text-transform: uppercase;">Your Request</h3>
                  <table border="0" cellpadding="0" cellspacing="0" width="100%">
                    <tbody>
                      ${reservationRow("DATE", date)}
                      ${reservationRow("GUESTS", guests)}
                      ${inclusionText ? reservationRow("INCLUDED", inclusionText) : ""}
                      ${reservationRow("LOCATION", location)}
                      ${record.occasion ? reservationRow("OCCASION", esc(record.occasion)) : ""}
                      ${boardText(record.board) ? reservationRow("BOARD", boardText(record.board)) : ""}
                      ${record.special_requirements ? reservationRow("SPECIAL REQUESTS", esc(record.special_requirements as string)) : ""}
                    </tbody>
                  </table>
                  ${inclusionText ? `<p style="margin: 14px 0 0 0; font-family: Garamond, 'Times New Roman', serif; font-size: 14px; color: #c4607a; font-style: italic;">Inclusions are based on the number of adults. Children are welcome — order anything extra à la carte.</p>` : ""}
                </td>
              </tr>

              ${extrasSection(addons)}

              <!-- WHAT HAPPENS NEXT -->
              <tr>
                <td align="center" style="padding: 20px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="60%">
                    <tbody><tr><td bgcolor="#e8d5c4" height="1" style="font-size: 0; line-height: 0;"></td></tr></tbody>
                  </table>
                </td>
              </tr>
              <tr>
                <td align="left" style="padding: 8px 32px 32px; word-wrap: break-word; overflow-wrap: break-word;">
                  <h3 style="margin: 0 0 20px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 20px; color: #2D1F14; font-weight: normal; text-transform: uppercase; letter-spacing: 2px;">What Happens Next</h3>
                  <p style="margin: 0 0 12px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 16px; color: #5c4a3a; line-height: 1.7;">1 · We review your request and check availability for your date.</p>
                  <p style="margin: 0 0 12px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 16px; color: #5c4a3a; line-height: 1.7;">2 · You'll hear from us shortly to confirm — usually within a few hours.</p>
                  <p style="margin: 0; font-family: Garamond, 'Times New Roman', serif; font-size: 16px; color: #5c4a3a; line-height: 1.7;">3 · Pay the advance to lock in your date, and we'll handle the rest.</p>
                </td>
              </tr>

              <!-- CONTACT -->
              <tr>
                <td align="center" style="padding: 32px; word-wrap: break-word; overflow-wrap: break-word;">
                  <p style="margin: 0 0 32px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #c4607a; font-style: italic;">
                    Questions in the meantime? We're just an email away.
                  </p>
                  <table border="0" cellpadding="0" cellspacing="0">
                    <tbody>
                      <tr>
                        <td align="center">
                          <a href="mailto:team@picnicstories.com"
                             style="display: inline-block; padding: 16px 28px; border: 1px solid #c4607a; color: #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 15px; text-decoration: none; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px;"
                             target="_blank">Get in Touch</a>
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
                  <p style="margin: 0; font-family: Garamond, 'Times New Roman', serif; font-size: 11px; color: #aaa;">Reference #${record.id}</p>
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
    const { record } = await req.json()
    const kind = record.customer_intent === "lock" ? "booking" : "query"
    const { label: venueLabel, teamEmail } = await getVenueInfo(record.venue_id, record.venue_address)
    const addons = await getAddOns(record.id)

    const kids = Number(record.children_count || 0)
    const adults = Number(record.guest_count || 0) - kids
    const guestStr = kids
      ? `${adults} adults · ${kids} child${kids !== 1 ? "ren" : ""} (free)`
      : `${record.guest_count} guest${Number(record.guest_count) !== 1 ? "s" : ""}`
    const inclusionText = await getInclusionText(record.venue_id, adults)

    // T1: Customer acknowledgement — only for unconfirmed queries.
    // Lock requests (confirmed=true) get the confirmation email (T3) instead.
    if (!record.confirmed) {
      await sendEmail({
        to: record.email_address,
        subject: "We've received your picnic request! 🧺",
        html: buildQueryHtml(record, venueLabel, inclusionText, addons),
      })
    }

    // T2: Admin alert (plain functional, unchanged)
    const adminTo = teamEmail ? [teamEmail, "team@picnicstories.com"] : "team@picnicstories.com"

    await sendEmail({
      to: adminTo,
      subject: `New ${kind === "booking" ? "Booking" : "Query"} from ${record.full_name} — ${record.preferred_date}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2>New ${kind === "booking" ? "🔒 Booking" : "📋 Query"} #${record.id}</h2>
          <table style="border-collapse: collapse; width: 100%;">
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Name</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${record.full_name}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Email</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${record.email_address}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Phone</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${record.mobile_number}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Date</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${record.preferred_date}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Guests</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${guestStr}</td></tr>
            ${inclusionText ? `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Included</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${inclusionText}</td></tr>` : ""}
            ${venueLabel ? `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Location</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${venueLabel}</td></tr>` : ""}
            ${record.occasion ? `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Occasion</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${esc(record.occasion)}</td></tr>` : ""}
            ${boardText(record.board) ? `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Board</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${boardText(record.board)}</td></tr>` : ""}
            ${record.special_requirements ? `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Special req.</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${record.special_requirements}</td></tr>` : ""}
          </table>
          ${adminCostBlock(record, addons, record.checkout_date ? "Stay + Picnic setup" : "Picnic setup")}
          <p style="margin-top: 24px;">
            <a href="${APP_URL}#admin" style="background: #2d6a4f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Open Admin Dashboard</a>
          </p>
        </div>`,
    })

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } })
  } catch (err) {
    console.error("notify-booking-received error:", err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } })
  }
})
