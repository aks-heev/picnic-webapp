// razorpay-webhook
// Server-to-server backstop for booking confirmation. Razorpay calls this
// directly when a payment is captured, so confirmation no longer depends on the
// customer's browser surviving to run verify-payment. If the customer closes the
// tab on the success screen, this still confirms the booking and fires the
// confirmation email.
//
// Auth is by Razorpay's webhook signature (HMAC over the RAW body), NOT a
// Supabase JWT — so this function MUST be deployed with verify_jwt=false.
//
// Idempotency: both this and the client verify-payment PATCH with
// &confirmed=eq.false. Whichever arrives first flips the row (trigger fires once
// → one email); the second matches zero rows and no-ops. Order does not matter.
//
// Secrets: RAZORPAY_WEBHOOK_SECRET (new). SUPABASE_URL + SERVICE_ROLE_KEY injected.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

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

async function patchBooking(
  supabaseUrl: string,
  serviceKey: string,
  bookingId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}&confirmed=eq.false`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    },
  )
  if (!res.ok) {
    const txt = await res.text()
    console.error("razorpay-webhook: booking PATCH failed", res.status, txt)
    return
  }
  const rows = await res.json().catch(() => [])
  console.log(
    `razorpay-webhook: PATCH booking ${bookingId} matched ${Array.isArray(rows) ? rows.length : "?"} row(s)`,
    JSON.stringify(patch),
  )
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  // .trim() defensively — same trailing-newline gotcha that 401'd the key id.
  const webhookSecret = (Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "").trim()

  if (!webhookSecret) {
    console.error("razorpay-webhook: RAZORPAY_WEBHOOK_SECRET is not configured")
    return new Response(JSON.stringify({ ok: false, error: "Webhook is not configured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Read the RAW body — the signature is computed over the exact bytes, so we
  // must not JSON.parse-then-restringify before verifying.
  const rawBody = await req.text()
  const signature = req.headers.get("x-razorpay-signature") ?? ""

  const expected = await hmacSha256Hex(webhookSecret, rawBody)
  if (!signature || !timingSafeEqual(expected, signature)) {
    console.warn("razorpay-webhook: signature mismatch")
    return new Response(JSON.stringify({ ok: false, error: "Invalid signature" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  let parsed: any
  try {
    parsed = JSON.parse(rawBody)
  } catch (_err) {
    console.error("razorpay-webhook: body is not valid JSON")
    return new Response(JSON.stringify({ ok: false, error: "Bad JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const event = parsed?.event
  const entity = parsed?.payload?.payment?.entity ?? {}
  const bookingId = entity?.notes?.booking_id
  const orderId = entity?.order_id
  const paymentId = entity?.id

  try {
    if (event === "payment.captured") {
      if (!bookingId) {
        // Order created before notes were added, or a non-booking payment.
        // Nothing to map — acknowledge so Razorpay does not retry forever.
        console.warn("razorpay-webhook: payment.captured with no notes.booking_id; ignoring")
      } else {
        await patchBooking(supabaseUrl, serviceKey, String(bookingId), {
          confirmed: true,
          payment_status: "paid",
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
        })
      }
    } else if (event === "payment.failed") {
      if (bookingId) {
        await patchBooking(supabaseUrl, serviceKey, String(bookingId), {
          payment_status: "failed",
        })
      }
    } else {
      console.log("razorpay-webhook: ignoring event", event)
    }
  } catch (err) {
    // Even on internal error, return 200 below so Razorpay does not hammer
    // retries for a no-op; the error is logged for us to inspect.
    console.error("razorpay-webhook: handler error", err)
  }

  // Always 200 for an authenticated request — never make Razorpay retry a no-op.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
