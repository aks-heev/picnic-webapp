// create-order
// Browser-invoked (supabase.functions.invoke) from the booking flow.
// Creates a Razorpay order so the client can open Standard Checkout.
//
// The charged amount is read server-side from the booking's stored
// `advance_amount` (which submit_booking_intent computes authoritatively via
// compute_booking_advance). Any `amount` in the request body is ignored. After
// the order is created its id is recorded on the booking so verify-payment can
// confirm ONLY the matching (order, booking) pair.
//
// Request  (JSON): { booking_id: number }  | or receipt: "booking_<id>"
// Response (JSON): { order_id, amount, currency, key_id }
//
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET. SUPABASE_URL + SERVICE_ROLE_KEY injected.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  try {
    // .trim() guards against a stray newline/space in the stored secret.
    const keyId = (Deno.env.get("RAZORPAY_KEY_ID") ?? "").trim()
    const keySecret = (Deno.env.get("RAZORPAY_KEY_SECRET") ?? "").trim()
    if (!keyId || !keySecret) {
      console.error("create-order: Razorpay secrets are not configured")
      return json({ error: "Payment is not configured yet. Please try again later." }, 500)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const body = await req.json().catch(() => ({}))
    const currency = (body.currency ?? "INR").toString()

    // Resolve the booking id from receipt "booking_<id>" or an explicit field.
    const receipt = body.receipt ? String(body.receipt) : ""
    let bookingId: string | null = null
    if (receipt.startsWith("booking_")) bookingId = receipt.slice("booking_".length)
    else if (body.booking_id != null) bookingId = String(body.booking_id)
    if (!bookingId || !/^\d+$/.test(bookingId)) {
      return json({ error: "A valid booking_id (or receipt 'booking_<id>') is required." }, 400)
    }

    // Authoritative amount: read the booking's advance server-side. The client
    // never decides what it pays — any `amount` in the request is ignored.
    const bRes = await fetch(
      `${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}&select=advance_amount,confirmed,payment_status`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    )
    if (!bRes.ok) {
      console.error("create-order: booking lookup failed", bRes.status, await bRes.text())
      return json({ error: "Could not load the booking." }, 500)
    }
    const booking = (await bRes.json())?.[0]
    if (!booking) return json({ error: "Booking not found." }, 404)
    if (booking.confirmed === true || booking.payment_status === "paid") {
      return json({ error: "This booking is already paid." }, 409)
    }

    const amount = Math.round(Number(booking.advance_amount) * 100)
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 100) {
      return json({ error: "This booking has no payable advance." }, 400)
    }

    // Receipt + notes carry the booking id so the webhook can map a captured
    // payment back to the booking even if the browser never reaches verify-payment.
    const realReceipt = `booking_${bookingId}`
    const orderBody: Record<string, unknown> = {
      amount,
      currency,
      receipt: realReceipt,
      payment_capture: 1,
      notes: { booking_id: bookingId },
    }

    const auth = btoa(`${keyId}:${keySecret}`)
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify(orderBody),
    })
    const data = await rzpRes.json().catch(() => ({}))
    if (!rzpRes.ok) {
      const status = rzpRes.status === 401 ? 401 : 500
      console.error("create-order: Razorpay error", rzpRes.status, JSON.stringify(data))
      return json({ error: data?.error?.description || "Could not create the payment order." }, status)
    }

    // Bind this order to the booking. verify-payment confirms ONLY when the
    // submitted order id equals the one stored here — so a payment made against
    // a different (cheaper) booking's order can't be replayed to confirm this one.
    // Guarded with confirmed=eq.false; fail-safe (if this PATCH fails the client
    // path rejects, and the webhook still confirms via notes.booking_id).
    const bindRes = await fetch(
      `${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}&confirmed=eq.false`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ razorpay_order_id: data.id }),
      },
    ).catch((e) => {
      console.error("create-order: order_id bind failed", e)
      return null
    })
    if (bindRes && !bindRes.ok) {
      console.error("create-order: order_id bind non-OK", bindRes.status, await bindRes.text())
    }

    return json({
      order_id: data.id,
      amount: data.amount,
      currency: data.currency,
      key_id: keyId,
    })
  } catch (err) {
    console.error("create-order: unexpected error", err)
    return json({ error: String(err) }, 500)
  }
})
