// ingest-airbnb  (PROTECTED — verify_jwt = true; cron :10 hourly, same vault key as sync-ical)
//
// Airbnb reservation -> bookings row, with nobody typing it in.
//
// Every Airbnb host iCal event for a real reservation carries, in DESCRIPTION:
//   Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMXXXXXXXX
//   Phone Number (Last 4 Digits): 1234
// Host / linked-listing blocks ("Airbnb (Not available)") carry neither, so
// "has an HM code" is the filter — nothing else is ever ingested.
//
// This function is DELIBERATELY separate from sync-ical. sync-ical is the
// double-booking safety net (venue_availability) and is not modified; this
// one only writes bookings / airbnb_feed_state / airbnb_ingest_log through two
// service-role-only SQL functions (migration 20261027_airbnb_auto_ingest.sql):
//   airbnb_ingest_upsert       — create / update dates / flag review cases
//   airbnb_ingest_mark_missing — cancel a FUTURE reservation after it is absent
//                                from 2 consecutive successful fetches
//
// MODE: env AIRBNB_INGEST_MODE = "live" | "dry_run" | "off". Unset => dry_run.
// dry_run writes only the state + log tables (would_create, would_cancel, ...).
//
// Fail-safe rules:
//   * a feed that fails to fetch / isn't a VCALENDAR is skipped entirely —
//     no upserts, and NO missing-marking for that venue (no false cancels);
//   * a feed that parses to zero HM-bearing events while the venue has future
//     reservations on record is treated as suspect and skips missing-marking;
//   * an HM code appearing on two venues' feeds is not ingested (logged).

import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const FETCH_TIMEOUT_MS = 15000
const ADMIN_EMAIL = "aksheevs@gmail.com"

const HM_RE = /\/details\/(HM[A-Z0-9]{8,})/i
const LAST4_RE = /Last\s*4\s*Digits\)?\s*:\s*(\d{4})/i

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

interface Res { hm: string; start: string; end: string; last4: string | null }

function parseReservations(ics: string): Res[] {
  const out: Res[] = []
  let cur: { start?: string; end?: string; desc?: string; cancelled?: boolean } | null = null
  for (const line of unfold(ics)) {
    const upper = line.toUpperCase()
    if (upper === "BEGIN:VEVENT") cur = {}
    else if (upper === "END:VEVENT") {
      if (cur && !cur.cancelled && cur.start && cur.desc) {
        const desc = cur.desc.replace(/\\n/g, "\n").replace(/\\,/g, ",")
        const hm = desc.match(HM_RE)?.[1]?.toUpperCase()
        if (hm) {
          const end = cur.end && cur.end > cur.start ? cur.end : cur.start
          if (end > cur.start) out.push({ hm, start: cur.start, end, last4: desc.match(LAST4_RE)?.[1] ?? null })
        }
      }
      cur = null
    } else if (cur) {
      const i = line.indexOf(":")
      if (i === -1) continue
      const name = line.slice(0, i).toUpperCase()
      const val = line.slice(i + 1).trim()
      if (name.startsWith("DTSTART")) cur.start = toYMD(val) ?? undefined
      else if (name.startsWith("DTEND")) cur.end = toYMD(val) ?? undefined
      else if (name.startsWith("STATUS")) cur.cancelled = val.toUpperCase() === "CANCELLED"
      else if (name.startsWith("DESCRIPTION")) cur.desc = val
    }
  }
  return out
}

async function fetchICS(feedUrl: string): Promise<string> {
  if (!/^https:\/\//i.test(feedUrl)) throw new Error("feed url must be https")
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(feedUrl, { signal: ctrl.signal, headers: { Accept: "text/calendar" } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (!/BEGIN:VCALENDAR/i.test(text) || !/END:VCALENDAR/i.test(text)) throw new Error("not a complete VCALENDAR")
    return text
  } finally {
    clearTimeout(timer)
  }
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!))

async function sendAdminEmail(subject: string, html: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey) { console.warn("RESEND_API_KEY not set; skipping admin email"); return }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "The Picnic Stories <team@picnicstories.com>", to: ADMIN_EMAIL, subject, html }),
    })
    if (!res.ok) console.warn("Resend error", res.status, await res.text())
  } catch (e) {
    console.warn("sendAdminEmail failed:", e)
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

// Actions a human should see the same hour. Plain "created" is NOT here:
// the bookings INSERT trigger already emails the admin for every new row.
const ALERT = new Set([
  "created_with_conflict", "possible_duplicate", "venue_mismatch",
  "seen_but_cancelled", "dates_updated", "cancelled",
])

Deno.serve(async (_req) => {
  const raw = (Deno.env.get("AIRBNB_INGEST_MODE") || "dry_run").toLowerCase()
  if (raw === "off") return json({ ok: true, mode: "off" })
  const mode = raw === "live" ? "live" : "dry_run"

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: venues, error } = await supabase
    .from("venues").select("id, name, airbnb_ical_url")
    .not("airbnb_ical_url", "is", null).eq("is_active", true)
  if (error) return json({ ok: false, error: error.message }, 500)

  // 1. Fetch every feed first.
  const feeds = new Map<number, Res[]>()
  const venueName = new Map<number, string>()
  const fetchErrors: Array<{ venue_id: number; error: string }> = []
  for (const v of venues || []) {
    venueName.set(v.id as number, v.name as string)
    try {
      feeds.set(v.id as number, parseReservations(await fetchICS(v.airbnb_ical_url as string)))
    } catch (e) {
      fetchErrors.push({ venue_id: v.id as number, error: String(e).slice(0, 200) })
    }
  }

  // 2. An HM code on two feeds is ambiguous — never ingest it automatically.
  const owners = new Map<string, number[]>()
  for (const [vid, list] of feeds) for (const r of list) owners.set(r.hm, [...(owners.get(r.hm) || []), vid])
  const multi = new Set([...owners].filter(([, v]) => new Set(v).size > 1).map(([hm]) => hm))

  const results: Array<Record<string, unknown>> = []
  const alerts: Array<Record<string, unknown>> = []

  for (const [vid, list] of feeds) {
    const seen: string[] = []
    for (const r of list) {
      seen.push(r.hm)
      if (multi.has(r.hm)) {
        results.push({ venue_id: vid, hm: r.hm, action: "hm_multi_venue", venues: owners.get(r.hm) })
        continue
      }
      const { data, error: upErr } = await supabase.rpc("airbnb_ingest_upsert", {
        p_mode: mode, p_hm: r.hm, p_venue_id: vid, p_start: r.start, p_end: r.end, p_last4: r.last4,
      })
      if (upErr) { results.push({ venue_id: vid, hm: r.hm, action: "error", error: upErr.message }); continue }
      const row = { venue_id: vid, hm: r.hm, from: r.start, to: r.end, ...(data as Record<string, unknown>) }
      results.push(row)
      if (ALERT.has(String(row.action))) alerts.push(row)
    }

    // 3. Missing-marking only for a trustworthy feed.
    if (list.length === 0) {
      const { count } = await supabase.from("airbnb_feed_state").select("hm_code", { count: "exact", head: true })
        .eq("venue_id", vid).gt("start_date", new Date().toISOString().slice(0, 10))
      if ((count ?? 0) > 0) { results.push({ venue_id: vid, action: "empty_feed_skip_missing" }); continue }
    }
    const { data: missing, error: mmErr } = await supabase.rpc("airbnb_ingest_mark_missing", {
      p_mode: mode, p_venue_id: vid, p_seen: seen,
    })
    if (mmErr) results.push({ venue_id: vid, action: "mark_missing_error", error: mmErr.message })
    else for (const m of (missing as Array<Record<string, unknown>>) || []) {
      const row = { venue_id: vid, ...m }
      results.push(row)
      if (ALERT.has(String(row.action))) alerts.push(row)
    }
  }

  if (mode === "live" && alerts.length) {
    const rows = alerts.map((a) =>
      `<tr><td style="padding:6px;border:1px solid #ddd">${esc(venueName.get(a.venue_id as number) || a.venue_id)}</td>` +
      `<td style="padding:6px;border:1px solid #ddd">${esc(a.hm)}</td>` +
      `<td style="padding:6px;border:1px solid #ddd"><strong>${esc(a.action)}</strong></td>` +
      `<td style="padding:6px;border:1px solid #ddd">${esc(a.booking_id ?? "")}</td>` +
      `<td style="padding:6px;border:1px solid #ddd;font-size:12px">${esc(JSON.stringify(a.detail ?? {}))}</td></tr>`).join("")
    const hasConflict = alerts.some((a) => a.action === "created_with_conflict")
    await sendAdminEmail(
      `${hasConflict ? "⚠ Possible DOUBLE BOOKING — " : ""}Airbnb auto-ingest: ${alerts.length} item(s) to check`,
      `<div style="font-family:sans-serif;max-width:720px;color:#333">
        <h2 style="color:${hasConflict ? "#b4452f" : "#2d6a4f"}">Airbnb auto-ingest</h2>
        <table style="border-collapse:collapse;font-size:14px"><tr>
        <th style="padding:6px;border:1px solid #ddd">Venue</th><th style="padding:6px;border:1px solid #ddd">HM code</th>
        <th style="padding:6px;border:1px solid #ddd">What happened</th><th style="padding:6px;border:1px solid #ddd">Booking #</th>
        <th style="padding:6px;border:1px solid #ddd">Detail</th></tr>${rows}</table>
        <p style="font-size:13px;color:#666">created_with_conflict = Airbnb booking overlaps one of ours (row still created).
        possible_duplicate = a hand-entered Airbnb row already covers these dates (nothing created).
        cancelled = vanished from the feed on 2 consecutive hourly checks.</p>
      </div>`,
    )
  }

  return json({ ok: true, mode, feeds: feeds.size, fetch_errors: fetchErrors, alerts: alerts.length, results })
})
