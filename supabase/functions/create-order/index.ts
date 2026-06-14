// create-order
// Browser-invoked (supabase.functions.invoke) from the booking flow.
// Creates a Razorpay order so the client can open Standard Checkout.
//
// Request  (JSON): { amount: number (paise), currency?: string, receipt?: string, booking_id?: number }
// Response (JSON): { order_id, amount, currency, key_id }
//
// Secrets required (set via `supabase secrets set` or the dashboard):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
//
// The KEY_SECRET never leaves this server. key_id is publishable and is
// returned so the client can initialise checkout without its own copy.

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
    // .trim() guards against a stray newline/space getting into the stored
    // secret (a malformed key id makes Razorpay reject Basic auth with 401).
    const keyId = (Deno.env.get("RAZORPAY_KEY_ID") ?? "").trim()
    const keySecret = (Deno.env.get("RAZORPAY_KEY_SECRET") ?? "").trim()
    if (!keyId || !keySecret) {
      console.error("create-order: Razorpay secrets are not configured")
      return json({ error: "Payment is not configured yet. Please try again later." }, 500)
    }

    const body = await req.json().catch(() => ({}))
    const amount = Number(body.amount)
    const currency = (body.currency ?? "INR").toString()
    const receipt = body.receipt ? String(body.receipt) : `rcpt_${Date.now()}`

    // Validate amount: integer paise, Razorpay minimum is 100 (= ₹1)
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 100) {
      return json({ error: "amount must be an integer of at least 100 paise" }, 400)
    }

    // Embed the booking id in the order's notes so the payment.captured webhook
    // can map a captured payment back to a booking row even when the client
    // verify-payment path never ran (in that exact failure case the booking row
    // has no razorpay_order_id to look up). Razorpay propagates notes onto the
    // payment entity, so the webhook reads notes.booking_id directly. The receipt
    // is "booking_<id>", so we derive the id here with no frontend change.
    const bookingId = receipt.startsWith("booking_")
      ? receipt.slice("booking_".length)
      : null

    const orderBody: Record<string, unknown> = { amount, currency, receipt, payment_capture: 1 }
    if (bookingId) orderBody.notes = { booking_id: bookingId }

    const auth = btoa(`${keyId}:${keySecret}`)
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderBody),
    })

    const data = await rzpRes.json().catch(() => ({}))

    if (!rzpRes.ok) {
      // 401 = bad credentials; surface as auth failure, everything else as 500
      const status = rzpRes.status === 401 ? 401 : 500
      console.error("create-order: Razorpay error", rzpRes.status, JSON.stringify(data))
      return json(
        { error: data?.error?.description || "Could not create the payment order." },
        status,
      )
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
