// Triggered by: Database trigger on bookings UPDATE (on_booking_confirmed_notify)
// and bookings INSERT when confirmed=true (on_booking_insert_confirmed — admin manual entries)
// Only fires when confirmed flips false → true (guard enforced in trigger WHEN clause)
// Sends: T3 — booking confirmation email to customer
// Skips the guest email when send_guest_email=false or the row has no email
// (admin manual entries may suppress it / have no email at all).
//
// Changed 2026-07-20 (v22–v25): stay-aware guest copy via isStay branches; hero image
// swapped to the Supabase-hosted sunburst (DSC03089.JPG, uploaded by the user at full
// size — see docs/HANDOFFS.md 2026-07-20); optional top-level `cc` field for manual
// resends (the DB trigger only ever sends {record, old_record}, so cc is always
// undefined on the automatic path); Resend response logging in _shared/resend.ts.
//
// Changed 2026-07-20 (v26): split the single isStay-branching template into two
// genuinely separate builders — buildPicnicEmail() and buildStayEmail() — per user
// request, so the two emails can diverge freely without threading conditionals
// through one shared HTML string. Deliberately a MECHANICAL split: rendered output
// is identical to v25 for both booking types up to insignificant inter-tag
// whitespace/HTML-comment differences (verified pre-deploy by a whitespace-
// normalized diff of generated HTML against the v25 builder across picnic/stay
// sample records — subjects compared byte-exact).
// Both templates share the same sunburst hero image by explicit user choice —
// stays span six venues (TerraCottage ×3, Countryside Offgrid, House of Amer,
// Om Niwas), so a hardcoded property photo would show the wrong building.
// Low-level helpers (formatDate, esc, reservationRow, extrasSection, directionsRow,
// occasionHeading) stay shared; everything template-shaped lives per-builder.
//
// Changed 2026-07-24 (v27): every guest confirmation now CCs team@picnicstories.com
// (standing user rule) so the team sees exactly what the customer received. A manual
// resend's payload `cc` values are merged in after the team CC and deduped. Skip
// paths (send_guest_email=false / no email) are unchanged — no guest send, no CC.
//
// Changed 2026-08-15 (v28): admin can now override the TIME row and the INCLUDED
// row per booking (see migration 20260815_booking_food_inclusions_and_slot_times +
// the admin Add Booking form's new "Start & end time" / "Includes food" fields).
// record.slot_start_time/slot_end_time, when both set, replace the hardcoded
// TIME_SLOTS lookup for the picnic template. record.includes_food, when true,
// replaces the venue-multiplier getInclusionText() computation with the admin's
// own food_items_count/beverage_items_count — this takes priority over BOTH the
// multiplier path and the package-suppresses-inclusions rule, since it's an
// explicit fact about this specific booking rather than a computed default. The
// "Inclusions are based on the number of adults" footnote only renders for the
// multiplier-computed case (inclusionIsAdultScaled) — the admin override is a
// flat per-booking count, not adult-scaled, so the old footnote would be wrong.
// Both the override fields and the fallback path are exercised identically in
// buildPicnicEmail and buildStayEmail (a stay can carry includes_food too, e.g.
// a catered TerraCottage booking — it just never has slot times).

import { sendEmail } from "./_shared/resend.ts"
import { getVenueInfo } from "./_shared/venue.ts"
import { getAddOns, type AddOn } from "./_shared/addons.ts"

const APP_URL = Deno.env.get("APP_URL") || "https://picnicstories.com"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const LOGO_URL =
  "https://cdn-reach.hostinger.com/settings/0a27628d960484a8a3d2b3e50518a32b/307542/logo_1780982818.png"
const HERO_IMG =
  "https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/images/DSC03089.JPG"

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

function occasionHeading(occasion: unknown, fallback: string): string {
  if (!occasion || typeof occasion !== "string") return fallback
  return OCCASION_HEADINGS[occasion] ?? fallback
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—"
  const dt = new Date(d + "T00:00:00")
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
}

// Formats a Postgres `time` value ("HH:MM:SS", as PostgREST/pg_net serialise it
// in the trigger payload) as "9:00 AM". Deliberately tolerant of a missing
// seconds/minutes component — better a slightly-off render than a thrown error
// in an email send.
function formatTime(t: string): string {
  const [hStr, mStr] = t.split(":")
  let h = Number(hStr)
  if (!Number.isFinite(h)) return t
  const m = (mStr ?? "00").padStart(2, "0")
  const ampm = h >= 12 ? "PM" : "AM"
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${m} ${ampm}`
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

// Cafe food & drink inclusions, scaled to adults only (children are free and
// order à la carte). Empty string for venues without multipliers. Superseded
// per-booking by the admin's includes_food override — see buildInclusion below.
async function getInclusionText(venueId: number | null | undefined, adults: number): Promise<string> {
  if (!venueId || adults <= 0) return ""
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${venueId}&select=metadata`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
    if (!res.ok) return ""
    const m = (await res.json())?.[0]?.metadata ?? {}
    const fm = Number(m.food_multiplier), dm = Number(m.drink_multiplier)
    if (!fm && !dm) return ""
    const food = Math.ceil(adults * (fm || 0)), drinks = Math.ceil(adults * (dm || 0))
    return `${food} food item${food !== 1 ? "s" : ""} · ${drinks} beverage${drinks !== 1 ? "s" : ""}`
  } catch (_err) { return "" }
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

interface EmailContent { subject: string; html: string }

// ---------------------------------------------------------------------------
// PICNIC template — slot-based bookings (no checkout_date).
// Owns its full HTML document end-to-end; edit freely without touching stays.
// ---------------------------------------------------------------------------
function buildPicnicEmail(record: Record<string, unknown>, venueLabel: string | null, directionsUrl: string | null, addons: AddOn[], inclusionText: string, inclusionIsAdultScaled: boolean): EmailContent {
  const name      = record.full_name as string
  const firstName = String(record.full_name ?? "").split(" ")[0] || "there"
  const date      = formatDate(record.preferred_date as string)
  const slot      = record.time_slot as string | null
  const overrideStart = record.slot_start_time as string | null | undefined
  const overrideEnd   = record.slot_end_time as string | null | undefined
  const time      = (overrideStart && overrideEnd)
    ? `${formatTime(String(overrideStart))} – ${formatTime(String(overrideEnd))}`
    : (slot && TIME_SLOTS[slot]) ? TIME_SLOTS[slot] : "—"
  const location  = venueLabel ?? (record.venue_address as string | null) ?? "To be confirmed"
  const kidsCount = Number(record.children_count || 0)
  const guests    = kidsCount
    ? `${Number(record.guest_count) - kidsCount} Adults · ${kidsCount} Child${kidsCount !== 1 ? "ren" : ""} (free)`
    : `${record.guest_count} ${Number(record.guest_count) === 1 ? "Person" : "Persons"}`
  const advAmt    = Number(record.advance_amount || 0)
  // Prefer the stored total (site checkouts write it; admin manual entries may
  // carry a negotiated total). Legacy rows without one: advance was always 50%.
  const totalFromDB = Number(record.total_amount || 0)
  const totalAmt  = totalFromDB > 0 ? totalFromDB : advAmt * 2
  const remainAmt = Math.max(0, totalAmt - advAmt)
  const packageName = typeof record.package_name === "string" && record.package_name ? record.package_name : null
  const occasionRowHtml = record.occasion ? reservationRow("OCCASION", esc(record.occasion)) : ""
  const packageRowHtml  = packageName ? reservationRow("PACKAGE", esc(packageName)) : ""
  const boardRowHtml    = boardText(record.board) ? reservationRow("BOARD", boardText(record.board)) : ""
  const inclusionRowHtml = inclusionText ? reservationRow("INCLUDED", inclusionText) : ""
  const heroSub = `${name.split(" ")[0]}, your luxury picnic is officially on the calendar. We are curating the magic — you just bring the memories.`

  const subject = `You're confirmed, ${firstName} — picnic on ${formatDate(record.preferred_date as string)}`

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta content="text/html; charset=utf-8"/>
  <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
  <title>Booking Confirmed</title>
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
                  <h2 style="margin: 0; font-family: Garamond, 'Times New Roman', serif; font-size: 48px; color: #2D1F14; font-weight: normal; line-height: 1.1; text-transform: uppercase;">${occasionHeading(record.occasion, "IT'S A DATE")}</h2>
                  <p style="margin: 20px 0 32px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 20px; color: #c4607a; line-height: 1.4;">
                    ${heroSub}
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
                  <img alt="The Picnic Stories" src="${HERO_IMG}"
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
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>TIME</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${time}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>LOCATION</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${location}</td>
                      </tr>
                      ${occasionRowHtml}
                      ${packageRowHtml}
                      ${boardRowHtml}
                      ${inclusionRowHtml}
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>GUESTS</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${guests}</td>
                      </tr>
                      ${totalAmt > 0 ? `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>TOTAL</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">₹${totalAmt.toLocaleString("en-IN")}</td>
                      </tr>
                      ${advAmt > 0 ? `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #c4607a;"><strong>ADVANCE PAID</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #c4607a;">₹${advAmt.toLocaleString("en-IN")}</td>
                      </tr>` : ""}
                      <tr>
                        <td style="padding: 8px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>DUE ON THE DAY</strong></td>
                        <td align="right" style="padding: 8px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">₹${remainAmt.toLocaleString("en-IN")}</td>
                      </tr>` : ""}
                    </tbody>
                  </table>
                  ${inclusionIsAdultScaled ? `<p style="margin: 14px 0 0 0; font-family: Garamond, 'Times New Roman', serif; font-size: 14px; color: #c4607a; font-style: italic;">Inclusions are based on the number of adults. Children are welcome — order anything extra à la carte.</p>` : ""}
                </td>
              </tr>

              <!-- DIRECTIONS BUTTON -->
              ${directionsRow(directionsUrl)}

              <!-- CURATED EXTRAS (only if add-ons exist) -->
              ${extrasSection(addons)}

              <!-- DIVIDER -->
              <tr>
                <td align="center" style="padding: 20px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="60%">
                    <tbody><tr><td bgcolor="#e8d5c4" height="1" style="font-size: 0; line-height: 0;"></td></tr></tbody>
                  </table>
                </td>
              </tr>
              <!-- GOOD TO KNOW -->
              <tr>
                <td align="left" style="padding: 8px 32px 32px; word-wrap: break-word; overflow-wrap: break-word;">
                  <h3 style="margin: 0 0 16px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 20px; color: #2D1F14; font-weight: normal; text-transform: uppercase; letter-spacing: 2px;">Good to Know</h3>

        <p style="margin: 0 0 10px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 15px; color: #5c4a3a; line-height: 1.7;">• Your slot starts and ends at the booked time. Delays don't extend your slot — any time beyond it attracts extra-hour charges.</p>
        <p style="margin: 0 0 10px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 15px; color: #5c4a3a; line-height: 1.7;">• The advance payment is non-refundable in case of cancellation.</p>
        <p style="margin: 0; font-family: Garamond, 'Times New Roman', serif; font-size: 15px; color: #5c4a3a; line-height: 1.7;">• Need to reschedule? Let us know at least 3 days before your picnic date and we'll do our best to accommodate.</p>
                </td>
              </tr>

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

  return { subject, html }
}

// ---------------------------------------------------------------------------
// STAY template — bookings with a checkout_date (TerraCottage / partner BnBs).
// Owns its full HTML document end-to-end; edit freely without touching picnics.
// ---------------------------------------------------------------------------
function buildStayEmail(record: Record<string, unknown>, venueLabel: string | null, directionsUrl: string | null, addons: AddOn[], inclusionText: string, inclusionIsAdultScaled: boolean): EmailContent {
  const name      = record.full_name as string
  const firstName = String(record.full_name ?? "").split(" ")[0] || "there"
  const date      = formatDate(record.preferred_date as string)
  const stayRange = `${formatDate(record.preferred_date as string)} → ${formatDate(record.checkout_date as string)}`
  const location  = venueLabel ?? (record.venue_address as string | null) ?? "To be confirmed"
  const kidsCount = Number(record.children_count || 0)
  const guests    = kidsCount
    ? `${Number(record.guest_count) - kidsCount} Adults · ${kidsCount} Child${kidsCount !== 1 ? "ren" : ""} (free)`
    : `${record.guest_count} ${Number(record.guest_count) === 1 ? "Person" : "Persons"}`
  const advAmt    = Number(record.advance_amount || 0)
  // Prefer the stored total (site checkouts write it; admin manual entries may
  // carry a negotiated total). Legacy rows without one: advance was always 50%.
  const totalFromDB = Number(record.total_amount || 0)
  const totalAmt  = totalFromDB > 0 ? totalFromDB : advAmt * 2
  const remainAmt = Math.max(0, totalAmt - advAmt)
  const packageName = typeof record.package_name === "string" && record.package_name ? record.package_name : null
  const occasionRowHtml = record.occasion ? reservationRow("OCCASION", esc(record.occasion)) : ""
  const packageRowHtml  = packageName ? reservationRow("PACKAGE", esc(packageName)) : ""
  const boardRowHtml    = boardText(record.board) ? reservationRow("BOARD", boardText(record.board)) : ""
  const inclusionRowHtml = inclusionText ? reservationRow("INCLUDED", inclusionText) : ""
  const heroSub = `${name.split(" ")[0]}, your stay is officially on the calendar. Settle in, relax, and let us take care of the rest.`

  const subject = `You're confirmed, ${firstName} — stay from ${formatDate(record.preferred_date as string)} to ${formatDate(record.checkout_date as string)}`

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta content="text/html; charset=utf-8"/>
  <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
  <title>Booking Confirmed</title>
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
                  <h2 style="margin: 0; font-family: Garamond, 'Times New Roman', serif; font-size: 48px; color: #2D1F14; font-weight: normal; line-height: 1.1; text-transform: uppercase;">${occasionHeading(record.occasion, "YOUR STAY AWAITS")}</h2>
                  <p style="margin: 20px 0 32px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 20px; color: #c4607a; line-height: 1.4;">
                    ${heroSub}
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
                  <img alt="The Picnic Stories" src="${HERO_IMG}"
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
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>STAY</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${stayRange}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>LOCATION</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${location}</td>
                      </tr>
                      ${occasionRowHtml}
                      ${packageRowHtml}
                      ${boardRowHtml}
                      ${inclusionRowHtml}
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>GUESTS</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">${guests}</td>
                      </tr>
                      ${totalAmt > 0 ? `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>TOTAL</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">₹${totalAmt.toLocaleString("en-IN")}</td>
                      </tr>
                      ${advAmt > 0 ? `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #c4607a;"><strong>ADVANCE PAID</strong></td>
                        <td align="right" style="padding: 8px 0; border-bottom: 1px solid #c4607a; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #c4607a;">₹${advAmt.toLocaleString("en-IN")}</td>
                      </tr>` : ""}
                      <tr>
                        <td style="padding: 8px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;"><strong>DUE ON THE DAY</strong></td>
                        <td align="right" style="padding: 8px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #2D1F14;">₹${remainAmt.toLocaleString("en-IN")}</td>
                      </tr>` : ""}
                    </tbody>
                  </table>
                  ${inclusionIsAdultScaled ? `<p style="margin: 14px 0 0 0; font-family: Garamond, 'Times New Roman', serif; font-size: 14px; color: #c4607a; font-style: italic;">Inclusions are based on the number of adults. Children are welcome — order anything extra à la carte.</p>` : ""}
                </td>
              </tr>

              <!-- DIRECTIONS BUTTON -->
              ${directionsRow(directionsUrl)}

              <!-- CURATED EXTRAS (only if add-ons exist) -->
              ${extrasSection(addons)}

              <!-- DIVIDER -->
              <tr>
                <td align="center" style="padding: 20px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="60%">
                    <tbody><tr><td bgcolor="#e8d5c4" height="1" style="font-size: 0; line-height: 0;"></td></tr></tbody>
                  </table>
                </td>
              </tr>
              <!-- GOOD TO KNOW -->
              <tr>
                <td align="left" style="padding: 8px 32px 32px; word-wrap: break-word; overflow-wrap: break-word;">
                  <h3 style="margin: 0 0 16px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 20px; color: #2D1F14; font-weight: normal; text-transform: uppercase; letter-spacing: 2px;">Good to Know</h3>

        <p style="margin: 0 0 10px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 15px; color: #5c4a3a; line-height: 1.7;">• Check-in and checkout timings will be confirmed with you closer to your stay.</p>
        <p style="margin: 0 0 10px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 15px; color: #5c4a3a; line-height: 1.7;">• The advance payment is non-refundable in case of cancellation.</p>
        <p style="margin: 0; font-family: Garamond, 'Times New Roman', serif; font-size: 15px; color: #5c4a3a; line-height: 1.7;">• Need to reschedule? Let us know at least 3 days before check-in and we'll do our best to accommodate.</p>
                </td>
              </tr>

              <!-- CONTACT SUPPORT -->
              <tr>
                <td align="center" style="padding: 32px; word-wrap: break-word; overflow-wrap: break-word;">
                  <p style="margin: 0 0 32px 0; font-family: Garamond, 'Times New Roman', serif; font-size: 18px; color: #c4607a; font-style: italic;">
                    Have questions or need to make adjustments to your stay?
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

  return { subject, html }
}

Deno.serve(async (req) => {
  try {
    const { record, old_record, cc } = await req.json()

    if (!record.confirmed || old_record?.confirmed === true) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    // Admin manual entries can suppress the guest email; offline bookings may
    // have no email address at all. Skip the guest send in both cases.
    if (record.send_guest_email === false || !record.email_address) {
      console.log(`notify-booking-confirmed: guest email skipped for booking ${record.id} (send_guest_email=${record.send_guest_email ?? true}, email=${record.email_address ? "present" : "missing"})`)
      return new Response(JSON.stringify({ ok: true, skipped: "guest_email_suppressed" }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    const { label: venueLabel, directionsUrl } = await getVenueInfo(record.venue_id, record.venue_address)
    const addons = await getAddOns(record.id)
    const kids = Number(record.children_count || 0)
    const adults = Number(record.guest_count || 0) - kids

    // Admin-entered food/beverage counts (see migration
    // 20260815_booking_food_inclusions_and_slot_times) are an explicit fact
    // about THIS booking and take priority over everything else. Package
    // inclusions still supersede the legacy venue food/drink multipliers
    // when neither override applies. Only the multiplier path is
    // adult-scaled — the admin override is a flat per-booking count — so the
    // "based on the number of adults" footnote is gated separately.
    let inclusionText = ""
    let inclusionIsAdultScaled = false
    if (record.includes_food) {
      const foodCt = Number(record.food_items_count || 0)
      const bevCt = Number(record.beverage_items_count || 0)
      if (foodCt || bevCt) {
        inclusionText = `${foodCt} food item${foodCt !== 1 ? "s" : ""} · ${bevCt} beverage${bevCt !== 1 ? "s" : ""}`
      }
    } else if (!record.package_key) {
      inclusionText = await getInclusionText(record.venue_id, adults)
      inclusionIsAdultScaled = Boolean(inclusionText)
    }

    const isStay = Boolean(record.checkout_date)
    const { subject, html } = isStay
      ? buildStayEmail(record, venueLabel, directionsUrl, addons, inclusionText, inclusionIsAdultScaled)
      : buildPicnicEmail(record, venueLabel, directionsUrl, addons, inclusionText, inclusionIsAdultScaled)

    // Standing rule (2026-07-24): CC the team inbox on every guest confirmation.
    // Manual-resend cc values are appended after it, deduped.
    const TEAM_CC = "team@picnicstories.com"
    const extraCc = (cc ? (Array.isArray(cc) ? cc : [cc]) : [])
      .filter((e: unknown): e is string => typeof e === "string" && e !== TEAM_CC)
    const ccList = [TEAM_CC, ...extraCc]

    await sendEmail({
      to: record.email_address,
      subject,
      html,
      cc: ccList,
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
