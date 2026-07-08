// Shared helper: fetch a booking's add-ons and render the cost breakdown for emails.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

export interface AddOn {
  addon_id: number | null
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
      `${supabaseUrl}/rest/v1/booking_add_ons?booking_id=eq.${bookingId}&select=addon_id,name,price_at_booking,requires_confirmation&order=name`,
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
