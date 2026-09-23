/**
 * meta-live-snapshot
 * Browser-facing proxy for every live Meta read `hosted-dashboard/ads.html` needs —
 * the page is a port of the Cowork "Meta Ads Dashboard" artifact, which reads all of
 * this live through the Meta Ads MCP connector. A Vercel page has no MCP bridge, so the
 * same reads are reimplemented here against the raw Graph API. Sections:
 *   campaigns — ACTIVE campaigns, last_14d: spend/impressions/clicks/ctr/results/leads/objective
 *   lifetime  — every campaign ever run, date_preset=maximum, plus status/objective/created_time
 *   adsets    — ad sets under ACTIVE campaigns, last_14d, with frequency (fatigue)
 *   funnel    — pixel event totals, trailing 14 days
 *   audiences — all custom/lookalike audiences, unfiltered (the page applies the artifact's filter)
 * Query param `section` = one of the above, or `all` (default).
 *
 * 🔴 AUTH — verify_jwt=true is NOT enough on its own, and must not be relied on alone.
 * verify_jwt only proves the bearer is a validly-signed project JWT, and the public anon
 * key (embedded in every page's source) IS one. Verified live 2026-09-23: v4 returned live
 * audience data to `Authorization: Bearer <anon key>`. So this function additionally
 * resolves the caller via /auth/v1/user and requires the admin email — the same single
 * email every RLS policy on bookings/venues/ad_insights/ad_sync_runs is gated on. Keep
 * verify_jwt=true as well (it rejects unsigned garbage before any code runs).
 *
 * 🔴 CORS — this is called cross-origin from picnic-dashboard-nu.vercel.app. OPTIONS must
 * short-circuit before the auth check (browsers never send credentials on a preflight)
 * and every response must carry CORS headers, or the browser reports an opaque
 * "Failed to fetch". Found 2026-09-23 on first real browser load.
 *
 * results/resultIndicator: resolved via each campaign's optimization_goal, read from the
 * /adsets edge — the campaign edge silently drops that field. See sync-meta-ads/index.ts.
 *
 * Funnel: /{pixel}/stats?aggregation=event returns HOURLY buckets, each carrying its own
 * nested `data: [{value: <event>, count}]`. The first version read the top level and
 * always returned `totals: {}` — fixed 2026-09-23.
 *
 * Caching: each section is cached in-memory per isolate for CACHE_TTL_MS so several
 * partners loading at once don't multiply Graph API calls. Best-effort, not shared
 * across cold starts.
 *
 * Secrets: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID (shared with sync-meta-ads), META_PIXEL_ID
 * (defaults to 1366746648648321). SUPABASE_URL / SUPABASE_ANON_KEY are platform-injected.
 */

const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN")
const AD_ACCOUNT_ID = Deno.env.get("META_AD_ACCOUNT_ID") ?? "565789031303932"
const PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? "1366746648648321"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://evmftrogyzoudiccqkya.supabase.co"
const GRAPH_VERSION = "v21.0"
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

// Same single admin email every RLS policy on the dashboard tables checks.
const ALLOWED_EMAILS = ["aksh.eeev@gmail.com"]

const CACHE_TTL_MS = 7 * 60 * 1000
const FATIGUE_FREQUENCY = 3.5

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

type Action = { action_type: string; value: string }

type CacheEntry = { data: unknown; expiresAt: number }
const cache = new Map<string, CacheEntry>()

async function cached<T>(key: string, fn: () => Promise<T>): Promise<{ data: T; cached: boolean }> {
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return { data: hit.data as T, cached: true }
  const data = await fn()
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return { data, cached: false }
}

async function fetchAllPages<T>(url: string): Promise<T[]> {
  const out: T[] = []
  let next: string | undefined = url
  let pages = 0
  while (next) {
    const res = await fetch(next)
    if (!res.ok) throw new Error(`Graph API ${res.status} on page ${pages + 1}: ${await res.text()}`)
    const body = await res.json()
    if (Array.isArray(body.data)) out.push(...body.data)
    next = body.paging?.next
    pages++
    if (pages > 50) throw new Error("fetchAllPages: exceeded 50 pages — aborting")
  }
  return out
}

const OPTIMIZATION_GOAL_ACTION_PREFIXES: Record<string, string[]> = {
  CONVERSATIONS: [
    "onsite_conversion.messaging_conversation_started_7d",
    "onsite_conversion.messaging_conversation_started_1d",
    "onsite_conversion.total_messaging_connection",
  ],
  LEAD_GENERATION: ["onsite_conversion.lead_grouped", "leadgen.other", "lead"],
  QUALITY_LEAD: ["onsite_conversion.lead_grouped", "leadgen.other", "lead"],
  OFFSITE_CONVERSIONS: ["offsite_conversion.fb_pixel_purchase", "offsite_conversion.fb_pixel_lead"],
  LINK_CLICKS: ["link_click"],
  POST_ENGAGEMENT: ["post_engagement"],
  PAGE_LIKES: ["like"],
}

function pickResult(actions: Action[] | undefined, optimizationGoal?: string): { results: number; indicator: string | null } {
  if (!actions || actions.length === 0) return { results: 0, indicator: null }
  const preferred = optimizationGoal ? OPTIMIZATION_GOAL_ACTION_PREFIXES[optimizationGoal] : undefined
  if (preferred) {
    for (const wanted of preferred) {
      const match = actions.find((a) => a.action_type === wanted)
      if (match) {
        const n = Math.round(Number(match.value))
        if (Number.isFinite(n)) return { results: n, indicator: match.action_type }
      }
    }
  }
  let best = actions[0]
  for (const a of actions) if (Number(a.value) > Number(best.value)) best = a
  const n = Math.round(Number(best.value))
  return { results: Number.isFinite(n) ? n : 0, indicator: best.action_type }
}

/** The connector's `lead` field — Meta's aggregate "lead" action (verified present in this
 *  account's lifetime insights alongside onsite_conversion.lead_grouped, same count). */
function leadCount(actions: Action[] | undefined): number {
  const a = (actions || []).find((x) => x.action_type === "lead")
  const n = a ? Number(a.value) : 0
  return Number.isFinite(n) ? n : 0
}

const num = (s: unknown): number => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** campaign_id → optimization_goal, rolled up from ad sets (first goal seen). */
async function loadGoals(): Promise<Map<string, string>> {
  const { data } = await cached("goals", async () => {
    const rows = await fetchAllPages<{ campaign_id?: string; optimization_goal?: string }>(
      `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/adsets?fields=id,campaign_id,optimization_goal&limit=200&access_token=${META_TOKEN}`,
    )
    const m: Record<string, string> = {}
    for (const r of rows) if (r.campaign_id && r.optimization_goal && !m[r.campaign_id]) m[r.campaign_id] = r.optimization_goal
    return m
  })
  return new Map(Object.entries(data))
}

interface CampaignNode { id: string; name: string; status: string; effective_status: string; objective?: string; created_time?: string }

async function loadCampaignNodes(): Promise<CampaignNode[]> {
  const { data } = await cached("campaign-nodes", () =>
    fetchAllPages<CampaignNode>(
      `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/campaigns?fields=id,name,status,effective_status,objective,created_time&limit=200&access_token=${META_TOKEN}`,
    ))
  return data
}

interface InsightRow {
  campaign_id: string; spend?: string; impressions?: string; reach?: string; clicks?: string; ctr?: string; actions?: Action[]
}

/** ACTIVE campaigns, last_14d — the artifact's loadActive(). Campaigns with no delivery in
 *  the window still appear, with zeros, exactly as the connector returns them. */
async function loadCampaigns() {
  const [nodes, goals] = await Promise.all([loadCampaignNodes(), loadGoals()])
  const active = nodes.filter((c) => c.effective_status === "ACTIVE")
  if (active.length === 0) return { campaigns: [] }
  const filtering = encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: active.map((c) => c.id) }]))
  const rows = await fetchAllPages<InsightRow>(
    `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/insights?level=campaign&date_preset=last_14d&filtering=${filtering}` +
      `&fields=campaign_id,spend,impressions,reach,clicks,ctr,actions&limit=100&access_token=${META_TOKEN}`,
  )
  const byId = new Map(rows.map((r) => [r.campaign_id, r]))
  return {
    campaigns: active.map((c) => {
      const r = byId.get(c.id)
      const spend = num(r?.spend)
      const { results, indicator } = pickResult(r?.actions, goals.get(c.id))
      return {
        id: c.id, name: c.name, status: c.status, objective: c.objective ?? null,
        spend, impressions: num(r?.impressions), reach: num(r?.reach), clicks: num(r?.clicks),
        ctr: r?.ctr != null ? Number(r.ctr) : null,
        results, resultIndicator: indicator, costPerResult: results > 0 ? spend / results : null,
        leads: leadCount(r?.actions),
      }
    }),
  }
}

/** Every campaign ever run, date_preset=maximum — the artifact's loadLifetime(). */
async function loadLifetime() {
  const [nodes, goals] = await Promise.all([loadCampaignNodes(), loadGoals()])
  const rows = await fetchAllPages<InsightRow>(
    `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/insights?level=campaign&date_preset=maximum` +
      `&fields=campaign_id,spend,actions&limit=100&access_token=${META_TOKEN}`,
  )
  const byId = new Map(rows.map((r) => [r.campaign_id, r]))
  return {
    campaigns: nodes.map((c) => {
      const r = byId.get(c.id)
      const spend = num(r?.spend)
      const { results } = pickResult(r?.actions, goals.get(c.id))
      return {
        id: c.id, name: c.name, status: c.status, objective: c.objective ?? null, created: c.created_time ?? null,
        spend, results, costPerResult: results > 0 ? spend / results : null, leads: leadCount(r?.actions),
      }
    }),
  }
}

/** Ad sets under ACTIVE campaigns, last_14d — the artifact's loadAdsets(). */
async function loadAdsets() {
  const [nodes, goals] = await Promise.all([loadCampaignNodes(), loadGoals()])
  const activeIds = nodes.filter((c) => c.effective_status === "ACTIVE").map((c) => c.id)
  if (activeIds.length === 0) return { campaigns: 0, adsets: [] }
  const filtering = encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: activeIds }]))
  const rows = await fetchAllPages<{
    adset_id: string; adset_name: string; campaign_id?: string; spend?: string; impressions?: string
    clicks?: string; ctr?: string; frequency?: string; actions?: Action[]
  }>(
    `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/insights?level=adset&date_preset=last_14d&filtering=${filtering}` +
      `&fields=adset_id,adset_name,campaign_id,spend,impressions,clicks,ctr,frequency,actions&limit=100&access_token=${META_TOKEN}`,
  )
  return {
    campaigns: activeIds.length,
    adsets: rows.map((r) => {
      const { results, indicator } = pickResult(r.actions, r.campaign_id ? goals.get(r.campaign_id) : undefined)
      const spend = num(r.spend)
      const frequency = r.frequency != null ? Number(r.frequency) : null
      return {
        id: r.adset_id, name: r.adset_name, spend,
        impressions: num(r.impressions), clicks: num(r.clicks),
        ctr: r.ctr != null ? Number(r.ctr) : null, frequency,
        results, resultIndicator: indicator, costPerResult: results > 0 ? spend / results : null,
        fatigued: frequency != null && frequency > FATIGUE_FREQUENCY,
      }
    }),
  }
}

/** Pixel event totals, trailing 14 days. Response is hourly buckets with nested data. */
async function loadFunnel() {
  const nowSec = Math.floor(Date.now() / 1000)
  const startSec = nowSec - 14 * 86400
  const buckets = await fetchAllPages<{ data?: Array<{ value?: string; count?: number }> }>(
    `${GRAPH_BASE}/${PIXEL_ID}/stats?aggregation=event&start_time=${startSec}&end_time=${nowSec}&access_token=${META_TOKEN}`,
  )
  const totals: Record<string, number> = {}
  for (const b of buckets) {
    for (const d of b.data ?? []) {
      if (!d.value) continue
      totals[d.value] = (totals[d.value] ?? 0) + num(d.count)
    }
  }
  return { windowDays: 14, buckets: buckets.length, totals }
}

/** All audiences, unfiltered. delivery_status.code 200 = "ready for use" (the connector's ACTIVE). */
async function loadAudiences() {
  const rows = await fetchAllPages<{
    name: string; subtype: string
    approximate_count_lower_bound?: number; approximate_count_upper_bound?: number
    delivery_status?: { code?: number; description?: string }
  }>(
    `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/customaudiences` +
      `?fields=name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status&limit=100&access_token=${META_TOKEN}`,
  )
  return {
    audiences: rows.map((a) => ({
      name: a.name, subtype: a.subtype,
      sizeLow: a.approximate_count_lower_bound ?? null, sizeHigh: a.approximate_count_upper_bound ?? null,
      active: a.delivery_status?.code === 200,
      statusCode: a.delivery_status?.code ?? null, statusText: a.delivery_status?.description ?? null,
    })),
  }
}

/** Resolve the bearer to a real signed-in user and require the admin email. */
async function callerIsAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? ""
  if (!auth.startsWith("Bearer ")) return false
  const apikey = Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? ""
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey } })
  if (!res.ok) return false
  const user = await res.json().catch(() => null)
  const email = String(user?.email ?? "").trim().toLowerCase()
  return email !== "" && ALLOWED_EMAILS.includes(email)
}

const SECTIONS: Record<string, () => Promise<unknown>> = {
  campaigns: loadCampaigns,
  lifetime: loadLifetime,
  adsets: loadAdsets,
  funnel: loadFunnel,
  audiences: loadAudiences,
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS })

  const jsonHeaders = { "Content-Type": "application/json", ...CORS_HEADERS }
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders })

  if (!(await callerIsAdmin(req))) return reply({ error: "forbidden — admin sign-in required" }, 403)
  if (!META_TOKEN) return reply({ error: "META_ACCESS_TOKEN secret is not set" }, 500)

  const section = new URL(req.url).searchParams.get("section") ?? "all"

  try {
    if (section !== "all") {
      const fn = SECTIONS[section]
      if (!fn) return reply({ error: `unknown section: ${section}` }, 400)
      const { data, cached: hit } = await cached(section, fn)
      return reply({ ok: true, section, cached: hit, data })
    }

    // allSettled — one broken section must not fail the others (same isolation as the artifact).
    const names = Object.keys(SECTIONS)
    const settled = await Promise.allSettled(names.map((n) => cached(n, SECTIONS[n])))
    const out: Record<string, unknown> = { ok: true }
    settled.forEach((r, i) => {
      out[names[i]] = r.status === "fulfilled"
        ? { ok: true, cached: r.value.cached, data: r.value.data }
        : { ok: false, error: String(r.reason) }
    })
    return reply(out)
  } catch (err) {
    console.error("meta-live-snapshot error:", err)
    return reply({ error: String(err) }, 500)
  }
})
