// sync-ical  (PROTECTED — verify_jwt = true)
// Airbnb -> site. For each active venue with airbnb_ical_url, fetch the
// .ics, parse reserved dates, reconcile source='ical' rows via the atomic
// replace_ical_blocks(). Failure-safe: validate feed BEFORE any DB write;
// skip venue on any error so existing blocks are never wiped.
//
// PHASE 2 (after import): reconcile held floors. For every combo booking
// still on hold, re-test its nights against the freshly-imported child data
// (excluding the hold's own parent blocks) and stamp a verdict:
//   conflict — a child night is now taken (likely a direct Airbnb booking)
//   ripe     — clear and past one sync cycle; safe to confirm (manually)
//   clear    — clear but still inside the buffer window
// Emails the admin ONLY on a transition into conflict/ripe. Confirmation is
// never automated — that stays a human + payment decision.

import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const FETCH_TIMEOUT_MS = 15000

const ADMIN_EMAIL = "aksheevs@gmail.com"
const RIPE_MIN_AGE_MS = 60 * 60 * 1000 // a hold is "ripe" once it's at least one sync cycle old

const pad = (n: number) => String(n).padStart(2, "0")

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

function unfold(ics: string): string[] {
  const lines = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  const out: string[] = []
  for (const ln of lines) {
    if ((ln.startsWith(" ") || ln.startsWith("\t")) && out.length) out[out.length - 1] += ln.slice(1)
    else out.push(ln)
  }
  return out
}

function toYMD(value: string): string | null {
  const m = value.match(/(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

interface VEvent { start?: string; end?: string; cancelled?: boolean }

function parseEvents(ics: string): VEvent[] {
  const events: VEvent[] = []
  let cur: VEvent | null = null
  for (const line of unfold(ics)) {
    const upper = line.toUpperCase()
    if (upper === "BEGIN:VEVENT") cur = {}
    else if (upper === "END:VEVENT") { if (cur) events.push(cur); cur = null }
    else if (cur) {
      const i = line.indexOf(":")
      if (i === -1) continue
      const name = line.slice(0, i).toUpperCase()
      const val = line.slice(i + 1).trim()
      if (name.startsWith("DTSTART")) cur.start = toYMD(val) ?? undefined
      else if (name.startsWith("DTEND")) cur.end = toYMD(val) ?? undefined
      else if (name.startsWith("STATUS")) cur.cancelled = val.toUpperCase() === "CANCELLED"
    }
  }
  return events
}

function busyDates(events: VEvent[]): string[] {
  const set = new Set<string>()
  for (const ev of events) {
    if (ev.cancelled || !ev.start) continue
    const start = ev.start
    const end = ev.end && ev.end > start ? ev.end : addDays(start, 1)
    for (let d = start; d < end; d = addDays(d, 1)) set.add(d)
  }
  return [...set].sort()
}

async function fetchICS(feedUrl: string): Promise<string> {
  if (!/^https:\/\//i.test(feedUrl)) throw new Error("feed url must be https")
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(feedUrl, { signal: ctrl.signal, headers: { Accept: "text/calendar" } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

// ── Phase 2 helpers ───────────────────────────────────────────────

// Inlined so this function stays a single deployable file (no cross-function
// _shared import). Best-effort: a mail failure must never break the sync.
async function sendAdminEmail(subject: string, html: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey) { console.warn("RESEND_API_KEY not set; skipping admin email"); return }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "The Picnic Stories <team@picnicstories.com>",
        to: ADMIN_EMAIL, subject, html,
      }),
    })
    if (!res.ok) console.warn("Resend error", res.status, await res.text())
  } catch (e) {
    console.warn("sendAdminEmail failed:", e)
  }
}

// Expand a [start, checkout) night range into YMD strings (checkout exclusive).
function expandNights(start: string, end: string | null): string[] {
  const out: string[] = []
  const last = end && end > start ? end : addDays(start, 1)
  for (let d = start; d < last; d = addDays(d, 1)) out.push(d)
  return out
}

// deno-lint-ignore no-explicit-any
async function reconcileHolds(supabase: any): Promise<Array<Record<string, unknown>>> {
  const { data: holds, error } = await supabase
    .from("bookings")
    .select("id, venue_id, preferred_date, checkout_date, held_at, full_name, hold_status, venues ( type, name )")
    .not("held_at", "is", null)
    .eq("confirmed", false)
  if (error) { console.warn("reconcileHolds: load error", error); return [] }

  const out: Array<Record<string, unknown>> = []
  for (const h of holds || []) {
    if (h.venues?.type !== "combo") continue // held_at is combo-only, but be safe

    const { data: kids } = await supabase.from("venues").select("id").eq("parent_venue_id", h.venue_id)
    // deno-lint-ignore no-explicit-any
    const childIds = (kids || []).map((k: any) => k.id)

    const occupied = new Set<string>()
    if (childIds.length) {
      const [blkRes, bkRes] = await Promise.all([
        supabase.from("venue_availability").select("date, source, booking_id")
          .in("venue_id", childIds).in("source", ["admin", "ical", "parent"]),
        supabase.from("bookings").select("preferred_date, checkout_date")
          .in("venue_id", childIds).eq("confirmed", true),
      ])
      for (const r of blkRes.data || []) {
        if (r.source === "parent" && String(r.booking_id) === String(h.id)) continue // exclude own hold
        occupied.add(r.date as string)
      }
      for (const b of bkRes.data || []) {
        for (const d of expandNights(b.preferred_date as string, b.checkout_date as string | null)) occupied.add(d)
      }
    }

    const nights = expandNights(h.preferred_date as string, h.checkout_date as string | null)
    const clashes = nights.filter((n) => occupied.has(n))
    const ageMs = Date.now() - new Date(h.held_at as string).getTime()

    const status = clashes.length ? "conflict" : (ageMs >= RIPE_MIN_AGE_MS ? "ripe" : "clear")
    const prev = h.hold_status as string | null

    await supabase.from("bookings").update({
      hold_status: status,
      hold_checked_at: new Date().toISOString(),
      hold_conflict_dates: clashes.length ? clashes : null,
    }).eq("id", h.id)

    // Notify only on a transition INTO conflict/ripe (avoids hourly spam).
    if (status !== prev && (status === "conflict" || status === "ripe")) {
      const floor = (h.venues?.name as string) || `Floor #${h.venue_id}`
      if (status === "conflict") {
        await sendAdminEmail(
          `⚠ Hold conflict — ${floor} (${h.preferred_date})`,
          `<div style="font-family:sans-serif;max-width:600px;color:#333">
            <h2 style="color:#b4452f">Hold conflict on ${floor}</h2>
            <p>Booking <strong>#${h.id}</strong> (${h.full_name || "guest"}) is on hold, but one or more nights are now taken on a single unit — most likely a direct Airbnb booking:</p>
            <p style="font-size:18px"><strong>${clashes.join(", ")}</strong></p>
            <p><strong>Release this hold</strong> — do not confirm. The whole floor can't be delivered for these dates.</p>
          </div>`,
        )
      } else {
        await sendAdminEmail(
          `✓ Hold ready to confirm — ${floor} (${h.preferred_date})`,
          `<div style="font-family:sans-serif;max-width:600px;color:#333">
            <h2 style="color:#2d6a4f">Hold is clear on ${floor}</h2>
            <p>Booking <strong>#${h.id}</strong> (${h.full_name || "guest"}) for <strong>${h.preferred_date}</strong> has been on hold past a full sync cycle with no conflict. It's safe to confirm once the guest pays.</p>
            <p>Confirmation stays manual — take the advance, then Confirm in the dashboard.</p>
          </div>`,
        )
      }
    }
    out.push({ booking_id: h.id, status, clashes })
  }
  return out
}

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  const url = new URL(req.url)
  let onlyVenue = url.searchParams.get("venue_id")
  if (!onlyVenue && req.method === "POST") {
    try { const b = await req.json(); if (b?.venue_id) onlyVenue = String(b.venue_id) } catch { /* no body */ }
  }

  let q = supabase.from("venues").select("id, airbnb_ical_url")
    .not("airbnb_ical_url", "is", null).eq("is_active", true)
  if (onlyVenue) q = q.eq("id", onlyVenue)
  const { data: venues, error } = await q
  if (error) return json({ error: error.message }, 500)

  const results: Array<Record<string, unknown>> = []

  for (const v of venues || []) {
    try {
      const ics = await fetchICS(v.airbnb_ical_url as string)
      if (!/BEGIN:VCALENDAR/i.test(ics)) throw new Error("response is not a VCALENDAR feed")

      const dates = busyDates(parseEvents(ics))

      const { error: rpcErr } = await supabase.rpc("replace_ical_blocks", {
        p_venue_id: v.id,
        p_dates: dates,
      })
      if (rpcErr) throw rpcErr

      await supabase.from("venues").update({
        last_ical_sync_at: new Date().toISOString(),
        last_ical_sync_status: `ok — ${dates.length} date(s)`,
      }).eq("id", v.id)

      results.push({ venue_id: v.id, ok: true, dates: dates.length })
    } catch (err) {
      await supabase.from("venues").update({
        last_ical_sync_status: `error — ${String(err).slice(0, 200)}`,
      }).eq("id", v.id)
      results.push({ venue_id: v.id, ok: false, error: String(err) })
    }
  }

  // Phase 2: reconcile held floors against the freshly-imported data. Runs
  // unconditionally (even with zero feeds) so the age-based "ripe" signal and
  // site-side conflicts are still caught. Never blocks the import response.
  let holds: Array<Record<string, unknown>> = []
  try { holds = await reconcileHolds(supabase) } catch (e) { console.error("reconcileHolds failed:", e) }

  return json({ ok: true, count: results.length, results, holds })
})
