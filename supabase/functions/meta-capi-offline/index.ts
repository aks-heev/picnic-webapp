/**
 * meta-capi-offline
 * Sends admin-entered, confirmed PICNIC bookings to Meta as server-side Purchase
 * events (Conversions API). Exists because 45 of 53 non-team September 2026 bookings
 * were closed on WhatsApp and entered via admin — invisible to the browser pixel.
 * Plan: project doc claude/meta-capi-plan-2026-09-29.md (Phase 1).
 *
 * Called hourly by pg_cron job `meta-capi-offline-hourly` via pg_net with
 * `Content-Type` only, no Authorization header.
 * 🔴 verify_jwt MUST stay false (same cron contract as lead-digest / sync-meta-ads).
 *
 * MODE (secret META_CAPI_MODE) — fails safe:
 *   'live'  → real events; successful sends recorded in meta_capi_events (idempotency).
 *   'test'  → sent with test_event_code (secret META_TEST_EVENT_CODE, or body), visible
 *             only in Events Manager → Test Events. Never recorded as sent.
 *   unset / anything else → 'dry_run': builds the payload, calls nothing, writes nothing.
 * A POST body may DOWNGRADE the mode ({"mode":"dry_run"} or {"mode":"test",
 * "test_event_code":"TEST123"}) but can never escalate to live.
 *
 * Eligibility (all must hold):
 *   bookings.confirmed = true, entry_source = 'admin' (site payments are already sent
 *   by razorpay-webhook), created within the last 7 days minus 2h (CAPI rejects > 7 days),
 *   booking_revenue_split.excluded_reason IS NULL (team phones / Test names),
 *   picnic_revenue > 0 and split known (ads run on picnics only — stays are never sent),
 *   booking_source <> 'airbnb' and external_booking_ref not an Airbnb HM code,
 *   no prior live 'sent' row in meta_capi_events.
 *
 * Deliberately does NOT write to bookings: any UPDATE there fires set_booking_region
 * and is seen by the Google Sheet sync. The ledger is meta_capi_events.
 *
 * Secrets: META_ACCESS_TOKEN (shared with sync-meta-ads), META_PIXEL_ID (default
 * 1366746648648321), META_CAPI_MODE, META_TEST_EVENT_CODE; SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY (injected).
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN")
const PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? "1366746648648321"
const ENV_MODE = (Deno.env.get("META_CAPI_MODE") ?? "").trim().toLowerCase()
const ENV_TEST_CODE = Deno.env.get("META_TEST_EVENT_CODE") ?? ""
const GRAPH_VERSION = "v21.0" // keep in step with sync-meta-ads
const META_MAX_AGE_DAYS = 7
// Send anything younger than 7 days minus a 2h safety margin (Meta rejects event_time
// older than 7 days; the margin covers cron jitter and clock skew).
const LOOKBACK_MS = META_MAX_AGE_DAYS * 86400_000 - 2 * 3600_000
const EVENT_NAME = "Purchase"

type Mode = "dry_run" | "test" | "live"

interface SplitRow {
  id: number
  created_at: string
  confirmed: boolean
  booking_kind: string | null
  picnic_revenue: string | number | null
  split_unknown: boolean | null
  excluded_reason: string | null
}
interface BookingRow {
  id: number
  entry_source: string | null
  booking_source: string | null
  external_booking_ref: string | null
  mobile_number: string | null
  email_address: string | null
}

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })

async function restJson<T>(path: string): Promise<T> {
  const res = await rest(path)
  if (!res.ok) throw new Error(`REST ${path.split("?")[0]} ${res.status}: ${await res.text()}`)
  return await res.json() as T
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** Meta wants digits only, with country code. Indian numbers only in this business. */
export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null
  let d = raw.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1)
  if (d.length === 10) d = "91" + d
  if (d.length === 12 && d.startsWith("91")) return d
  return null // anything else is not a number we can vouch for — send no phone rather than a wrong one
}

export function normalizeEmail(raw: string | null): string | null {
  if (!raw) return null
  const e = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}

const HM_REF = /^HM[A-Z0-9]{8}$/

async function insertLedger(rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return
  const res = await rest("meta_capi_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) })
  // Best-effort for error/rejected rows; for live 'sent' rows a failure is surfaced by the caller.
  if (!res.ok) throw new Error(`meta_capi_events insert ${res.status}: ${await res.text()}`)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

Deno.serve(async (req) => {
  // Resolve mode: env sets the ceiling, body may only downgrade.
  let mode: Mode = ENV_MODE === "live" ? "live" : ENV_MODE === "test" ? "test" : "dry_run"
  let testCode = ENV_TEST_CODE
  if (req.method === "POST") {
    const body = await req.json().catch(() => null)
    if (body?.mode === "dry_run") mode = "dry_run"
    else if (body?.mode === "test") mode = "test"
    if (typeof body?.test_event_code === "string" && body.test_event_code) testCode = body.test_event_code
  }
  if (mode === "test" && !testCode) {
    return json({ ok: false, mode, error: "test mode needs META_TEST_EVENT_CODE secret or body.test_event_code" }, 400)
  }
  if (mode !== "dry_run" && !META_TOKEN) {
    return json({ ok: false, mode, error: "META_ACCESS_TOKEN secret is not set" }, 500)
  }

  try {
    const now = Date.now()
    const since = new Date(now - LOOKBACK_MS).toISOString()
    const ageOutFrom = new Date(now - META_MAX_AGE_DAYS * 86400_000).toISOString()

    // 1) Candidate rows from the canonical revenue view (single source for value).
    const splits = await restJson<SplitRow[]>(
      `booking_revenue_split?select=id,created_at,confirmed,booking_kind,picnic_revenue,split_unknown,excluded_reason` +
        `&confirmed=is.true&excluded_reason=is.null&created_at=gte.${encodeURIComponent(ageOutFrom)}`,
    )
    const ids = splits.map((s) => s.id)
    if (ids.length === 0) return json({ ok: true, mode, eligible: 0, sent: 0 })

    const [bookings, alreadyLive, alreadyFlagged] = await Promise.all([
      restJson<BookingRow[]>(
        `bookings?select=id,entry_source,booking_source,external_booking_ref,mobile_number,email_address&id=in.(${ids.join(",")})`,
      ),
      restJson<{ booking_id: number }[]>(
        `meta_capi_events?select=booking_id&mode=eq.live&status=eq.sent&event_name=eq.${EVENT_NAME}&booking_id=in.(${ids.join(",")})`,
      ),
      restJson<{ booking_id: number }[]>(
        `meta_capi_events?select=booking_id&mode=eq.live&status=eq.rejected&booking_id=in.(${ids.join(",")})`,
      ),
    ])
    const bById = new Map(bookings.map((b) => [b.id, b]))
    const sentLive = new Set(alreadyLive.map((r) => r.booking_id))
    const flagged = new Set(alreadyFlagged.map((r) => r.booking_id))

    const skipped: Record<string, number> = {}
    const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1 }
    const eligible: { s: SplitRow; b: BookingRow; value: number }[] = []
    const agedOut: number[] = []

    for (const s of splits) {
      const b = bById.get(s.id)
      if (!b) { skip("booking_missing"); continue }
      if (b.entry_source !== "admin") { skip("not_admin"); continue }
      if (b.booking_source === "airbnb" || (b.external_booking_ref && HM_REF.test(b.external_booking_ref.trim()))) { skip("airbnb"); continue }
      if (s.split_unknown) { skip("split_unknown"); continue }
      const value = Number(s.picnic_revenue ?? 0)
      if (!(value > 0)) { skip("no_picnic_revenue"); continue }
      if (sentLive.has(s.id)) { skip("already_sent"); continue }
      if (s.created_at < since) { agedOut.push(s.id); continue } // in the last 2h before Meta's 7-day cutoff, never sent
      eligible.push({ s, b, value })
    }

    // Rows that aged past the lookback without a live send: flag once, visibly.
    if (mode === "live") {
      const newlyAged = agedOut.filter((id) => !flagged.has(id))
      await insertLedger(newlyAged.map((id) => ({
        mode, booking_id: id, event_name: EVENT_NAME, event_id: `admin_purchase_${id}`,
        status: "rejected", detail: "aged out: reached Meta's 7-day limit without a live send",
      })))
    }

    // 2) Build events.
    const events = []
    for (const { s, b, value } of eligible) {
      const ph = normalizePhone(b.mobile_number)
      const em = normalizeEmail(b.email_address)
      if (!ph && !em) { skip("no_match_keys"); continue }
      const user_data: Record<string, string[]> = { country: [await sha256("in")] }
      if (ph) user_data.ph = [await sha256(ph)]
      if (em) user_data.em = [await sha256(em)]
      events.push({
        event_name: EVENT_NAME,
        event_time: Math.floor(new Date(s.created_at).getTime() / 1000),
        event_id: `admin_purchase_${s.id}`,
        action_source: "chat", // closed over WhatsApp, entered by admin
        user_data,
        custom_data: {
          currency: "INR",
          value,
          content_type: "product",
          content_category: s.booking_kind ?? "picnic",
          booking_source: b.booking_source ?? "unknown",
        },
        _booking_id: s.id,
      })
    }

    const publicEvents = events.map(({ _booking_id, ...e }) => e)
    if (events.length === 0) return json({ ok: true, mode, eligible: 0, sent: 0, skipped, aged_out: agedOut })

    if (mode === "dry_run") {
      return json({ ok: true, mode, eligible: events.length, sent: 0, skipped, aged_out: agedOut, preview: publicEvents })
    }

    // 3) Send one batch.
    const payload: Record<string, unknown> = { data: publicEvents }
    if (mode === "test") payload.test_event_code = testCode
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${META_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(text) } catch { /* non-JSON error */ }
    const received = Number(body.events_received ?? 0)
    const ok = res.ok && received === events.length

    const ledger = events.map((e) => ({
      mode,
      booking_id: e._booking_id,
      event_name: EVENT_NAME,
      event_id: e.event_id,
      status: ok ? "sent" : "error",
      value_inr: e.custom_data.value,
      detail: ok ? `fbtrace_id=${body.fbtrace_id ?? ""}` : `HTTP ${res.status}: ${text.slice(0, 500)}`,
    }))
    await insertLedger(ledger)

    const out = { ok, mode, eligible: events.length, events_received: received, fbtrace_id: body.fbtrace_id ?? null, skipped, aged_out: agedOut }
    if (ok) console.log(`meta-capi-offline: ${mode} sent ${received}`, JSON.stringify(out))
    else console.error(`meta-capi-offline: ${mode} FAILED`, res.status, text.slice(0, 500))
    return json(ok ? out : { ...out, error: text.slice(0, 500) }, ok ? 200 : 502)
  } catch (err) {
    console.error("meta-capi-offline error:", String(err))
    return json({ ok: false, mode, error: String(err) }, 500)
  }
})
