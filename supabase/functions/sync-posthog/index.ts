/**
 * sync-posthog
 * Daily via pg_cron `sync-posthog-daily` at 00:40 UTC (06:10 IST).
 * Copies PostHog (project 482400, US cloud) numbers into Supabase for the hosted
 * Growth page (hosted-dashboard/growth.html). See docs/GROWTH_DASHBOARD_PLAN.md.
 *
 * Queries are ported from scripts/posthog-pull.py (proven 2026-10-30) — keep them in step.
 * Production hostnames only; every date is an IST calendar day.
 *
 * Writes:
 *   web_daily        — per IST day: visitors, sessions, pageviews   (trend lines only)
 *   web_event_daily  — per IST day × tracked event: people, events  (trend lines only)
 *   web_window       — 7/30/90-day windows ending YESTERDAY: overview, source, page,
 *                      device, event. 🔴 Unique people do NOT add across days, so window
 *                      totals are computed here, never by summing web_daily.
 *   web_sync_runs    — one row per run, ok or not.
 *
 * 🔴 verify_jwt MUST stay false: pg_cron posts with Content-Type only (same contract as
 * lead-digest / sync-meta-ads). POST only. Detail stays in web_sync_runs (admin RLS) and
 * logs, never in the response body.
 *
 * Manual run / backfill: POST {"days": 90} rewrites the last 90 daily rows (max 400).
 * Default: last 3 days (late-arriving events).
 *
 * Secrets: POSTHOG_API_KEY (personal key "supabase-sync", read-only, project 482400 only),
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (injected).
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const PH_KEY = Deno.env.get("POSTHOG_API_KEY")
const PH_PROJECT = 482400
const PH_API = `https://us.posthog.com/api/projects/${PH_PROJECT}/query/`

const HOSTS = "('picnicstories.com', 'www.picnicstories.com')"
const IST_DAY = "toDate(toTimeZone(timestamp, 'Asia/Kolkata'))"
const WINDOWS = [7, 30, 90]

// Must match track('…') names in app.js and brochure.js.
const EVENTS = [
  "$pageview",
  "venue_viewed",
  "packages_page_viewed",
  "check_dates_opened",
  "booking_intent_submitted",
  "intent_lead_captured",
  "intent_whatsapp_clicked",
  "payment_initiated",
  "payment_succeeded",
  "brochure_search_landed",
  "brochure_reel_open",
  "brochure_reel_click",
  "brochure_reel_book_click",
  "brochure_reel_instagram_click",
  "brochure_book_online_click",
  "brochure_whatsapp_click",
]
const EVENT_LIST = EVENTS.map((e) => `'${e}'`).join(", ")

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}

function daysBefore(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

async function hogql(query: string): Promise<unknown[][]> {
  const res = await fetch(PH_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${PH_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  })
  if (!res.ok) throw new Error(`PostHog ${res.status}: ${(await res.text()).slice(0, 400)}`)
  const body = await res.json()
  return (body.results ?? []) as unknown[][]
}

async function rest(path: string, method: string, body?: unknown, prefer?: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer ?? "return=minimal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

const upsert = (table: string, conflict: string, rows: unknown[]) =>
  rows.length ? rest(`${table}?on_conflict=${conflict}`, "POST", rows, "resolution=merge-duplicates,return=minimal") : Promise.resolve()

async function writeRun(start: string, end: string, rows: number, ok: boolean, error: string | null) {
  try {
    await rest("web_sync_runs", "POST", [{
      source: "posthog", window_start: start, window_end: end, rows_written: rows,
      ok, error, finished_at: new Date().toISOString(),
    }])
  } catch (e) {
    console.error("web_sync_runs insert failed:", String(e))
  }
}

const n = (v: unknown) => Math.round(Number(v ?? 0))

function windowRange(end: string, days: number) {
  return `${IST_DAY} >= toDate('${daysBefore(end, days - 1)}') and ${IST_DAY} <= toDate('${end}')`
}

async function syncWindow(end: string, days: number): Promise<number> {
  const W = `${windowRange(end, days)} and properties.$host in ${HOSTS}`
  const [overview, sources, pages, devices, events] = [
    await hogql(`select uniq(person_id), uniq(properties.$session_id), count()
                 from events where event = '$pageview' and ${W}`),
    // Referrer (or utm_source) of each session's FIRST pageview = how the visit arrived.
    await hogql(`select coalesce(nullIf(src, ''), '$direct') as source, uniq(pid) as visitors
                 from (
                   select properties.$session_id as sid, any(person_id) as pid,
                          argMin(coalesce(nullIf(properties.utm_source, ''), properties.$referring_domain), timestamp) as src
                   from events where event = '$pageview' and ${W}
                   group by sid)
                 group by source order by visitors desc limit 25`),
    await hogql(`select properties.$pathname as path, uniq(person_id) as visitors, count() as views
                 from events where event = '$pageview' and ${W}
                 group by path order by visitors desc limit 25`),
    await hogql(`select concat(coalesce(properties.$device_type, '?'), ' · ', coalesce(properties.$os, '?')) as dev,
                        uniq(person_id) as visitors
                 from events where event = '$pageview' and ${W}
                 group by dev order by visitors desc limit 15`),
    await hogql(`select event, uniq(person_id), count()
                 from events where event in (${EVENT_LIST}) and ${W}
                 group by event limit 100`),
  ]
  const o = overview[0] ?? [0, 0, 0]
  const rows = [
    { kind: "overview", key: "visitors", people: n(o[0]), count: n(o[2]) },
    { kind: "overview", key: "sessions", people: n(o[1]), count: null },
    ...sources.map((r) => ({ kind: "source", key: String(r[0] ?? "$direct"), people: n(r[1]), count: null })),
    ...pages.map((r) => ({ kind: "page", key: String(r[0] ?? "(none)"), people: n(r[1]), count: n(r[2]) })),
    ...devices.map((r) => ({ kind: "device", key: String(r[0]), people: n(r[1]), count: null })),
    ...events.map((r) => ({ kind: "event", key: String(r[0]), people: n(r[1]), count: n(r[2]) })),
  ].map((r) => ({ ...r, window_end: end, window_days: days }))

  // Replace this window wholesale so a key that fell out of the top-25 doesn't linger.
  await rest(`web_window?window_end=eq.${end}&window_days=eq.${days}`, "DELETE")
  await upsert("web_window", "window_end,window_days,kind,key", rows)
  return rows.length
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 })

  const yesterday = daysBefore(istToday(), 1)
  let days = 3
  try {
    const body = await req.json().catch(() => null)
    if (body?.days) days = Math.min(400, Math.max(1, Math.round(Number(body.days))))
  } catch { /* default */ }
  const start = daysBefore(yesterday, days - 1)

  if (!PH_KEY) {
    await writeRun(start, yesterday, 0, false, "POSTHOG_API_KEY secret is not set")
    return new Response(JSON.stringify({ ok: false, error: "not configured" }), { status: 500, headers: { "Content-Type": "application/json" } })
  }

  try {
    const D = `${IST_DAY} >= toDate('${start}') and ${IST_DAY} <= toDate('${yesterday}') and properties.$host in ${HOSTS}`
    const daily = await hogql(`select ${IST_DAY} as d, uniq(person_id), uniq(properties.$session_id), count()
                               from events where event = '$pageview' and ${D}
                               group by d order by d limit 1000`)
    const evDaily = await hogql(`select ${IST_DAY} as d, event, uniq(person_id), count()
                                 from events where event in (${EVENT_LIST}) and ${D}
                                 group by d, event order by d limit 20000`)

    // A day with no pageviews must still overwrite any older row with zeros.
    const byDay = new Map(daily.map((r) => [String(r[0]), r]))
    const dailyRows = Array.from({ length: days }, (_, i) => {
      const d = daysBefore(yesterday, days - 1 - i)
      const r = byDay.get(d)
      return { date: d, visitors: n(r?.[1]), sessions: n(r?.[2]), pageviews: n(r?.[3]), synced_at: new Date().toISOString() }
    })
    const eventRows = evDaily.map((r) => ({ date: String(r[0]), event: String(r[1]), people: n(r[2]), events: n(r[3]), synced_at: new Date().toISOString() }))

    // Guard: PostHog returning nothing at all for 3+ days means a broken query or key,
    // not a quiet site (the site has never had a zero-pageview day). Refuse to overwrite.
    if (days >= 3 && dailyRows.every((r) => r.visitors === 0)) {
      throw new Error(`PostHog returned 0 pageviews for every day ${start}..${yesterday} — refusing to overwrite web_daily`)
    }

    await upsert("web_daily", "date", dailyRows)
    await rest(`web_event_daily?date=gte.${start}&date=lte.${yesterday}`, "DELETE")
    await upsert("web_event_daily", "date,event", eventRows)

    let windowRows = 0
    for (const w of WINDOWS) windowRows += await syncWindow(yesterday, w)

    const total = dailyRows.length + eventRows.length + windowRows
    await writeRun(start, yesterday, total, true, null)
    console.log(`sync-posthog: ${start}..${yesterday} daily=${dailyRows.length} events=${eventRows.length} window=${windowRows}`)
    return new Response(JSON.stringify({ ok: true, start, end: yesterday, rows: total }), { headers: { "Content-Type": "application/json" } })
  } catch (err) {
    const msg = String(err)
    console.error("sync-posthog error:", msg)
    await writeRun(start, yesterday, 0, false, msg)
    return new Response(JSON.stringify({ ok: false, error: "sync failed — see web_sync_runs" }), { status: 500, headers: { "Content-Type": "application/json" } })
  }
})
