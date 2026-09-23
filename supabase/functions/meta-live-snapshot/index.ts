/**
 * meta-live-snapshot
 * Browser-facing proxy for the three Meta reads that `ad_insights` never captures:
 * the 14-day pixel funnel, ad-set frequency/fatigue for active campaigns, and custom
 * audience sizes. Called from `hosted-dashboard/ads.html` by a logged-in partner — never
 * by cron. Same Graph API endpoints the Cowork Meta Ads Dashboard artifact already
 * proved work (see its `loadFunnel` / `loadAdsets` / `loadAudiences`), reimplemented here
 * against the raw Graph API instead of the MCP connector because a Cowork artifact only
 * runs inside Cowork — a Vercel-hosted page has no MCP bridge to call.
 *
 * 🔴 verify_jwt MUST stay true. This is the credential-minimization point of the whole
 * hosted-dashboard build (docs/HOSTED_DASHBOARD_PLAN.md §3): the Meta token lives ONLY in
 * this function's secrets and `sync-meta-ads`'s, never in a Vercel env var. verify_jwt=true
 * makes Supabase itself reject any caller without a valid session before this code even
 * runs — there is no table here for RLS to protect, so the platform-level JWT check is the
 * only gate. Do not weaken this to verify_jwt=false "to make testing easier."
 *
 * Caching: each section's response is cached in-memory per Deno isolate for
 * CACHE_TTL_MS. This is a real rate-limit/cost guard, not a nicety — "every partner"
 * loading the page at once should not mean N simultaneous Graph API hits. Isolates are
 * not shared across cold starts, so this is best-effort, not a strict guarantee; that is
 * an acceptable trade for the complexity a Postgres-backed cache would add here.
 *
 * Query param `section` selects the payload: `funnel` | `adsets` | `audiences` | `all`
 * (default `all`). GET or POST both work; nothing is written anywhere by this function.
 *
 * Required function secrets: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID (shared with
 * sync-meta-ads — same secrets, do not duplicate into a second name), META_PIXEL_ID
 * (defaults to 1366746648648321, the pixel already live on the site).
 *
 * NOT YET DEPLOYED as of writing (2026-09-23) — built-unverified per CLAUDE.md §11.
 * Deploy through the Supabase Dashboard, same constraints as sync-meta-ads.
 */

const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN")
const AD_ACCOUNT_ID = Deno.env.get("META_AD_ACCOUNT_ID") ?? "565789031303932"
const PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? "1366746648648321"
const GRAPH_VERSION = "v21.0"
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

const CACHE_TTL_MS = 7 * 60 * 1000 // 7 minutes — middle of the plan's 5-10 min guidance
const FATIGUE_FREQUENCY = 3.5

type CacheEntry = { data: unknown; expiresAt: number }
const cache = new Map<string, CacheEntry>()

async function cached<T>(key: string, fn: () => Promise<T>): Promise<{ data: T; cached: boolean }> {
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) {
    return { data: hit.data as T, cached: true }
  }
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
    if (pages > 20) throw new Error("fetchAllPages: exceeded 20 pages — aborting")
  }
  return out
}

// Same mapping as sync-meta-ads, verified 2026-09-23 against the Meta Ads connector's
// own results field for this account — see that file's comment for the full reconciliation.
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

function pickResult(
  actions: Array<{ action_type: string; value: string }> | undefined,
  optimizationGoal?: string,
): { results: number; indicator: string | null } {
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

/** `optimization_goal` is NOT a valid field on the campaign node/edge — Meta silently
 *  drops it (verified live 2026-09-23), so the original version of this function always
 *  passed `undefined` through to pickResult(), a no-op "fix". The goal lives on ad sets;
 *  pulled from the account's /adsets edge and rolled up per campaign_id (first goal seen
 *  — verified live that this account's active campaigns each have one consistent goal
 *  across their ad sets). See sync-meta-ads/index.ts's fetchCampaignGoals() for the same
 *  fix and fuller explanation. */
async function fetchCampaignGoals(): Promise<Map<string, string>> {
  const url =
    `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/adsets` +
    `?fields=id,campaign_id,optimization_goal&limit=200&access_token=${META_TOKEN}`
  const rows = await fetchAllPages<{ id: string; campaign_id?: string; optimization_goal?: string }>(url)
  const map = new Map<string, string>()
  for (const r of rows) {
    if (r.campaign_id && r.optimization_goal && !map.has(r.campaign_id)) {
      map.set(r.campaign_id, r.optimization_goal)
    }
  }
  return map
}

async function activeCampaignIds(): Promise<Array<{ id: string; name: string; optimization_goal?: string }>> {
  const [campaignsUrl, goals] = [
    `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/campaigns?fields=id,name,effective_status&limit=200&access_token=${META_TOKEN}`,
    await fetchCampaignGoals(),
  ]
  const rows = await fetchAllPages<{ id: string; name: string; effective_status: string }>(campaignsUrl)
  return rows.filter((c) => c.effective_status === "ACTIVE").map((c) => ({ id: c.id, name: c.name, optimization_goal: goals.get(c.id) }))
}

/** 14-day pixel event funnel — matches the campaign KPI window so the two are
 *  comparable. `dataset_stats` is the Graph node for a Pixel's event counts. */
async function loadFunnel() {
  const nowSec = Math.floor(Date.now() / 1000)
  const startSec = nowSec - 14 * 86400
  const url = `${GRAPH_BASE}/${PIXEL_ID}/stats?aggregation=event&start_time=${startSec}&end_time=${nowSec}&access_token=${META_TOKEN}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`pixel stats ${res.status}: ${await res.text()}`)
  const body = await res.json()
  // Graph returns {data: [{event: "Lead", count: N, ...}, ...]} shape for aggregation=event.
  const totals: Record<string, number> = {}
  for (const row of body.data ?? []) {
    const name = row.event ?? row.name
    if (!name) continue
    totals[name] = (totals[name] ?? 0) + Number(row.count ?? row.value ?? 0)
  }
  return { windowDays: 14, totals }
}

/** Ad sets under currently-active campaigns, 14-day trailing spend + frequency, for
 *  fatigue detection (frequency > FATIGUE_FREQUENCY = "the same people keep seeing it"). */
async function loadAdsets() {
  const campaigns = await activeCampaignIds()
  if (campaigns.length === 0) return { campaigns: 0, adsets: [] }

  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - 14 * 86400 * 1000).toISOString().slice(0, 10)
  const timeRange = encodeURIComponent(JSON.stringify({ since, until: today }))
  const filtering = encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaigns.map((c) => c.id) }]))
  const url =
    `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/insights` +
    `?level=adset&time_range=${timeRange}&filtering=${filtering}` +
    `&fields=adset_id,adset_name,campaign_id,spend,impressions,clicks,ctr,frequency,actions` +
    `&limit=100&access_token=${META_TOKEN}`
  const rows = await fetchAllPages<{
    adset_id: string; adset_name: string; campaign_id?: string; spend?: string; impressions?: string
    clicks?: string; ctr?: string; frequency?: string
    actions?: Array<{ action_type: string; value: string }>
  }>(url)

  const goalByCampaign = new Map(campaigns.map((c) => [c.id, c.optimization_goal]))

  const adsets = rows.map((r) => {
    const { results, indicator } = pickResult(r.actions, r.campaign_id ? goalByCampaign.get(r.campaign_id) : undefined)
    const spend = Number(r.spend ?? 0)
    const frequency = r.frequency != null ? Number(r.frequency) : null
    return {
      id: r.adset_id,
      name: r.adset_name,
      spend,
      impressions: r.impressions != null ? Math.round(Number(r.impressions)) : null,
      clicks: r.clicks != null ? Math.round(Number(r.clicks)) : null,
      ctr: r.ctr != null ? Number(r.ctr) : null,
      frequency,
      results,
      resultIndicator: indicator,
      costPerResult: results > 0 ? spend / results : null,
      fatigued: frequency != null && frequency > FATIGUE_FREQUENCY,
    }
  })
  return { campaigns: campaigns.length, adsets }
}

/** Custom + lookalike audiences — sizes only, no PII. Lookalikes churn constantly so
 *  all are shown regardless of delivery_status; other audiences only if ACTIVE. */
async function loadAudiences() {
  const url =
    `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/customaudiences` +
    `?fields=name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status` +
    `&limit=25&access_token=${META_TOKEN}`
  const rows = await fetchAllPages<{
    name: string; subtype: string
    approximate_count_lower_bound?: number; approximate_count_upper_bound?: number
    delivery_status?: { code?: number; description?: string }
  }>(url)
  const audiences = rows
    .filter((a) => a.subtype === "LOOKALIKE" || a.delivery_status?.description === "Active")
    .map((a) => ({
      name: a.name,
      subtype: a.subtype,
      sizeLow: a.approximate_count_lower_bound ?? null,
      sizeHigh: a.approximate_count_upper_bound ?? null,
      status: a.delivery_status?.description ?? null,
    }))
  return { audiences }
}

Deno.serve(async (req) => {
  if (!META_TOKEN) {
    return new Response(JSON.stringify({ error: "META_ACCESS_TOKEN secret is not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const url = new URL(req.url)
  const section = url.searchParams.get("section") ?? "all"

  try {
    const sections: Record<string, () => Promise<unknown>> = {
      funnel: loadFunnel,
      adsets: loadAdsets,
      audiences: loadAudiences,
    }

    if (section !== "all") {
      const fn = sections[section]
      if (!fn) return new Response(JSON.stringify({ error: `unknown section: ${section}` }), { status: 400 })
      const { data, cached: hit } = await cached(section, fn)
      return new Response(JSON.stringify({ ok: true, section, cached: hit, data }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    // Promise.allSettled — one slow/broken section must not fail the other two. Matches
    // the Cowork artifact's own per-section failure isolation.
    const [funnel, adsets, audiences] = await Promise.allSettled([
      cached("funnel", loadFunnel),
      cached("adsets", loadAdsets),
      cached("audiences", loadAudiences),
    ])

    const unwrap = (r: PromiseSettledResult<{ data: unknown; cached: boolean }>) =>
      r.status === "fulfilled" ? { ok: true, cached: r.value.cached, data: r.value.data } : { ok: false, error: String(r.reason) }

    return new Response(
      JSON.stringify({ ok: true, funnel: unwrap(funnel), adsets: unwrap(adsets), audiences: unwrap(audiences) }),
      { headers: { "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("meta-live-snapshot error:", err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})
