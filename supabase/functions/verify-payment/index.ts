// verify-payment
// Browser-invoked after Razorpay Checkout succeeds. Authoritatively verifies
// the payment signature and, only on a match, marks the booking paid+confirmed.
// `confirmed` is NEVER trusted from the client.
//
// booking_id is required, AND the submitted order must equal the order
// create-order minted for THIS booking (bookings.razorpay_order_id). Without
// this binding a customer could pay for a cheap booking's order and then pass a
// different (expensive) booking_id here to confirm it for the cheap price.
//
// Signature: HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, KEY_SECRET)
// Secrets: RAZORPAY_KEY_SECRET (SUPABASE_URL + SERVICE_ROLE_KEY injected).

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

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

async function markFailed(supabaseUrl: string, serviceKey: string, bookingId: unknown) {
  if (!bookingId) return
  try {
    await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}&confirmed=eq.false`, {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payment_status: "failed" }),
    })
  } catch (err) {
    console.error("verify-payment: markFailed error", err)
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  try {
    const keySecret = (Deno.env.get("RAZORPAY_KEY_SECRET") ?? "").trim()
    if (!keySecret) {
      console.error("verify-payment: RAZORPAY_KEY_SECRET is not configured")
      return json({ ok: false, error: "Payment verification is not configured." }, 500)
    }

    const body = await req.json().catch(() => ({}))
    const bookingId = body.booking_id
    const orderId = body.razorpay_order_id
    const paymentId = body.razorpay_payment_id
    const signature = body.razorpay_signature

    if (!bookingId) {
      return json({ ok: false, error: "Missing booking_id" }, 400)
    }
    if (!orderId || !paymentId || !signature) {
      return json(
        { ok: false, error: "Missing razorpay_order_id, razorpay_payment_id or razorpay_signature" },
        400,
      )
    }

    // 1) Signature must be genuine (proves the payment, not the booking link).
    const expected = await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`)
    if (!timingSafeEqual(expected, String(signature))) {
      console.warn("verify-payment: signature mismatch for order", orderId)
      await markFailed(supabaseUrl, serviceKey, bookingId)
      return json({ ok: false, error: "Payment signature verification failed" }, 400)
    }

    // 2) Binding: the order must be the one create-order minted for THIS booking.
    const bRes = await fetch(
      `${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}&select=razorpay_order_id,confirmed`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    )
    if (!bRes.ok) {
      console.error("verify-payment: booking lookup failed", bRes.status, await bRes.text())
      return json({ ok: false, error: "Could not verify the booking." }, 500)
    }
    const booking = (await bRes.json())?.[0]
    if (!booking) return json({ ok: false, error: "Booking not found." }, 404)

    // Already confirmed for this same order (e.g. the webhook won the race) → ok.
    if (booking.confirmed === true && booking.razorpay_order_id === orderId) {
      return json({ ok: true, booking_id: bookingId })
    }
    if (booking.razorpay_order_id !== orderId) {
      console.warn("verify-payment: order/booking mismatch", {
        bookingId,
        orderId,
        stored: booking.razorpay_order_id,
      })
      return json({ ok: false, error: "Payment does not match this booking." }, 400)
    }

    // 3) Verified + bound → record payment and confirm. Guarded with
    //    confirmed=eq.false so a replay (or the webhook) can't re-fire triggers.
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}&confirmed=eq.false`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          confirmed: true,
          payment_status: "paid",
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: signature,
          lead_status: "confirmed",
          lead_status_updated_at: new Date().toISOString(),
        }),
      },
    )
    if (!patchRes.ok) {
      const txt = await patchRes.text()
      console.error("verify-payment: booking update failed", patchRes.status, txt)
      return json({ ok: false, error: "Payment verified but booking update failed." }, 500)
    }

    return json({ ok: true, booking_id: bookingId })
  } catch (err) {
    console.error("verify-payment: unexpected error", err)
    return json({ ok: false, error: String(err) }, 500)
  }
})
