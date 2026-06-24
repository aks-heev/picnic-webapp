// Shared helper: fetch a booking's add-ons and render the cost breakdown for emails.
// Add-ons live in booking_add_ons (name, price_at_booking, requires_confirmation),
// written inside submit_booking_intent (same transaction as the booking) so they
// exist when the insert-trigger notification fires.
//
// advance_amount on the booking is the FULL total (stay + picnic + add-ons), so the
// "Stay + Picnic setup" subtotal is derived as advance_amount − sum(add-ons).

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

export interface AddOn {
  name: string | null
  price_at_booking: number | null
  requires_confirmation: boolean | null
}

export async function getAddOns(
  bookingId: number | null | undefined,
): Promise<AddOn[]> {
  if (!bookingId) return []
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/booking_add_ons?booking_id=eq.${bookingId}&select=name,price_at_booking,requires_confirmation&order=name`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    )
    if (res.ok) {
      const rows = await res.json()
      if (Array.isArray(rows)) return rows
    }
  } catch (_err) {
    // fall through to empty
  }
  return []
}

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`

// Full cost breakdown: one combined "Stay + Picnic setup" row, then each add-on,
// then a bold Total. Returns "" when there's no price to show (advanceAmount <= 0).
//   advanceAmount: the booking's full total (stay + picnic + add-ons)
//   setupLabel:    "Stay + Picnic setup" (stays) or "Picnic setup" (cafe)
export function costBreakdownBlock(
  advanceAmount: number | null | undefined,
  addons: AddOn[],
  setupLabel = "Picnic setup",
): string {
  const total = Number(advanceAmount || 0)
  if (total <= 0) return ""

  const addonsTotal = addons.reduce((s, a) => s + Number(a.price_at_booking || 0), 0)
  const setupBase = Math.max(0, total - addonsTotal)

  const setupRow = `
        <tr>
          <td style="padding: 6px 8px;">${setupLabel}</td>
          <td style="padding: 6px 8px; text-align: right; white-space: nowrap;">${inr(setupBase)}</td>
        </tr>`

  const addonRows = addons
    .map((a) => {
      const tag = a.requires_confirmation
        ? ` <span style="color:#b8860b; font-size: 12px;">(on request)</span>`
        : ""
      return `
        <tr>
          <td style="padding: 6px 8px;">${a.name ?? "Add-on"}${tag}</td>
          <td style="padding: 6px 8px; text-align: right; white-space: nowrap;">+${inr(a.price_at_booking || 0)}</td>
        </tr>`
    })
    .join("")

  return `
    <div style="margin: 24px 0;">
      <table style="border-collapse: collapse; width: 100%; font-size: 15px;">
        ${setupRow}
        ${addonRows}
        <tr><td colspan="2" style="border-top: 1px solid #ddd; padding: 0;"></td></tr>
        <tr>
          <td style="padding: 8px; font-weight: bold; font-size: 16px;">Total</td>
          <td style="padding: 8px; text-align: right; font-weight: bold; font-size: 16px; white-space: nowrap;">${inr(total)}</td>
        </tr>
      </table>
      ${addons.some((a) => a.requires_confirmation)
        ? `<p style="color:#888; font-size: 12px; margin: 6px 0 0;">"On request" items are subject to host confirmation.</p>`
        : ""}
    </div>`
}
