/**
 * sync-gsc
 * Daily via pg_cron `sync-gsc-daily` at 03:40 UTC (09:10 IST).
 * Copies Google Search Console data for sc-domain:picnicstories.com into Supabase for the
 * hosted Growth page. See docs/GROWTH_DASHBOARD_PLAN.md. Request shape mirrors
 * scripts/gsc-pull.py (type "web") — keep them in step.
 *
 * Writes:
 *   gsc_daily         — per day: clicks, impressions, ctr, position (clicks/impressions DO
 *                       add across days; position does not — never average it naively).
 *   gsc_page_window   — top pages for 7/28/90-day windows ending at the latest data day.
 *   gsc_query_window  — top queries, same windows. Query rows cover only part of all clicks
 *                       (GSC hides anonymised queries): the page must show coverage.
 *   web_sync_runs     — one row per run (source 'gsc').
 *
 * Window end = today IST − 3 days (Google's reporting lag), same default as gsc-pull.py.
 * Default daily rewrite: last 10 days (Google revises recent days). Backfill: POST {"days": 480}.
 *
 * Auth: service-account JWT (RS256) signed with WebCrypto, exchanged at oauth2.googleapis.com.
 * 🔴 verify_jwt MUST stay false (cron, Content-Type only — lead-digest contract). POST only.
 *
 * Secrets: GSC_SERVICE_ACCOUNT_JSON (the whole service-account JSON), SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY (injected).
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SA_RAW = Deno.env.get("GSC_SERVICE_ACCOUNT_JSON")

const PROPERTY = "sc-domain:picnicstories.com"
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
const API = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`
const LAG_DAYS = 3
const WINDOWS = [7, 28, 90]
const TOP_ROWS = 250

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}

function daysBefore(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function getToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  )
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }))}`
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)))
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  })
  if (!res.ok) throw new Error(`Google token ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()).access_token
}

interface GscRow { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }

async function gsc(token: string, start: string, end: string, dimensions: string[], rowLimit: number): Promise<GscRow[]> {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions, rowLimit, type: "web" }),
  })
  if (!res.ok) throw new Error(`GSC ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return ((await res.json()).rows ?? []) as GscRow[]
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
      source: "gsc", window_start: start, window_end: end, rows_written: rows,
      ok, error, finished_at: new Date().toISOString(),
    }])
  } catch (e) {
    console.error("web_sync_runs insert failed:", String(e))
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 })

  const end = daysBefore(istToday(), LAG_DAYS)
  let days = 10
  try {
    const body = await req.json().catch(() => null)
    if (body?.days) days = Math.min(480, Math.max(1, Math.round(Number(body.days))))
  } catch { /* default */ }
  const start = daysBefore(end, days - 1)

  if (!SA_RAW) {
    await writeRun(start, end, 0, false, "GSC_SERVICE_ACCOUNT_JSON secret is not set")
    return new Response(JSON.stringify({ ok: false, error: "not configured" }), { status: 500, headers: { "Content-Type": "application/json" } })
  }

  try {
    const sa = JSON.parse(SA_RAW)
    if (sa.type !== "service_account" || !sa.private_key || !sa.client_email) {
      throw new Error("GSC_SERVICE_ACCOUNT_JSON is not a service-account key")
    }
    const token = await getToken(sa)
    const now = new Date().toISOString()

    const daily = await gsc(token, start, end, ["date"], 25000)
    const dailyRows = daily.map((r) => ({
      date: r.keys![0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions),
      ctr: r.ctr, position: r.position, synced_at: now,
    }))
    await upsert("gsc_daily", "date", dailyRows)

    let windowRows = 0
    for (const w of WINDOWS) {
      const ws = daysBefore(end, w - 1)
      const [pages, queries] = [await gsc(token, ws, end, ["page"], TOP_ROWS), await gsc(token, ws, end, ["query"], TOP_ROWS)]
      const pageRows = pages.map((r) => ({
        window_end: end, window_days: w, page: r.keys![0], clicks: Math.round(r.clicks),
        impressions: Math.round(r.impressions), position: r.position, synced_at: now,
      }))
      const queryRows = queries.map((r) => ({
        window_end: end, window_days: w, query: r.keys![0], clicks: Math.round(r.clicks),
        impressions: Math.round(r.impressions), position: r.position, synced_at: now,
      }))
      await rest(`gsc_page_window?window_end=eq.${end}&window_days=eq.${w}`, "DELETE")
      await upsert("gsc_page_window", "window_end,window_days,page", pageRows)
      await rest(`gsc_query_window?window_end=eq.${end}&window_days=eq.${w}`, "DELETE")
      await upsert("gsc_query_window", "window_end,window_days,query", queryRows)
      windowRows += pageRows.length + queryRows.length
    }

    const total = dailyRows.length + windowRows
    await writeRun(start, end, total, true, null)
    console.log(`sync-gsc: ${start}..${end} daily=${dailyRows.length} window=${windowRows}`)
    return new Response(JSON.stringify({ ok: true, start, end, rows: total }), { headers: { "Content-Type": "application/json" } })
  } catch (err) {
    const msg = String(err)
    console.error("sync-gsc error:", msg)
    await writeRun(start, end, 0, false, msg)
    return new Response(JSON.stringify({ ok: false, error: "sync failed — see web_sync_runs" }), { status: 500, headers: { "Content-Type": "application/json" } })
  }
})
