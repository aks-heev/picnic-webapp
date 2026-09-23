/**
 * sync-meta-ads
 * Called daily via pg_cron at 05:20 UTC (10:50 IST) — job `sync-meta-ads-daily`.
 * Pulls trailing daily campaign spend from the Meta Graph API directly (never the MCP
 * connector — its `amount_spent` field is a formatted display string like "₹0.00 INR",
 * not a number) and upserts it into `public.ad_insights`. Also runs the delivery alarm:
 * any campaign that is effective_status=ACTIVE with ₹0 spend across the last 2 completed
 * days gets an email to team@. This exists because on 2026-07-24 the account's only
 * active campaign silently stopped delivering (prepaid balance ran out) and nobody
 * noticed for six weeks — see docs/META_ADS_DASHBOARD_PLAN.md §1.
 *
 * 🔴 verify_jwt MUST stay false. This is cron-called; both `lead-digest-daily` and
 * `post-event-nudge-daily` POST with `Content-Type` only, no `Authorization` header, so a
 * verify_jwt=true or CRON_SECRET-guarded function silently 401s every cron fire while
 * `cron.job_run_details` keeps reporting `succeeded` — the exact blindness that caused the
 * six-week gap in the first place. Do NOT add a CRON_SECRET check here. See
 * docs/HOSTED_DASHBOARD_PLAN.md §6 / META_ADS_DASHBOARD_PLAN.md §2.
 *
 * 🔴 Pagination: `paging.next` on the /insights call MUST be followed to exhaustion. A
 * truncated first page silently drops an actively-spending campaign — indistinguishable
 * from that campaign having gone dark. This is the single most dangerous bug this
 * function can have.
 *
 * Invoke manually with a POST body `{"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}` to
 * backfill or repair a gap — defaults to the trailing 30 days when the body is absent or
 * empty. Meta may truncate very wide `time_increment=1` windows; page in ~30-day chunks
 * from the caller if a single backfill call errors or looks short.
 *
 * Required function secrets: META_ACCESS_TOKEN (System User token, Business Manager
 * 1549685876475913 — see docs/HOSTED_DASHBOARD_PLAN.md §4), META_AD_ACCOUNT_ID (defaults
 * to 565789031303932 if unset), RESEND_API_KEY (shared), SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY (injected), TEAM_EMAIL (optional, defaults to team@).
 *
 * Deployed 2026-09-23 (v5, via deploy_edge_function from Cowork — that works; the older
 * "Dashboard only" note was stale). results/result_indicator resolve via a per-campaign
 * optimization_goal pulled from the account's /adsets edge — NOT from the campaign edge,
 * which silently drops that field. v5 adds the backfill-safe alarm guard below.
 */

import { sendEmail } from "./_shared/resend.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const TEAM_EMAIL = Deno.env.get("TEAM_EMAIL") ?? "team@picnicstories.com"

const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN")
const AD_ACCOUNT_ID = Deno.env.get("META_AD_ACCOUNT_ID") ?? "565789031303932"
const GRAPH_VERSION = "v21.0"
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

const DEFAULT_WINDOW_DAYS = 30
const ALARM_COMPLETED_DAYS = 2

interface CampaignMeta {
  id: string
  name: string
  effective_status: string
}

// Verified 2026-09-23 by reconciling against the Meta Ads connector's own `results`
// field for this account's live campaigns: the old "pick the action with the highest
// raw count that day" heuristic picked post_engagement (always the biggest raw number)
// instead of the campaign's actual optimization goal — for this account, CONVERSATIONS
// (onsite_conversion.messaging_conversation_started_*, matching the connector's
// "actions:onsite_conversion.messaging_conversation_started_7d" indicator exactly).
// Not exhaustive — only the goals this account has actually used are mapped with
// confidence. Anything else falls back to the old max-count heuristic.
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

interface InsightRow {
  campaign_id: string
  campaign_name?: string
  date_start: string
  spend?: string
  impressions?: string
  clicks?: string
  reach?: string
  actions?: Array<{ action_type: string; value: string }>
}

interface AdInsightsUpsertRow {
  account_id: string
  campaign_id: string
  campaign_name: string | null
  date: string
  spend_inr: number
  impressions: number | null
  clicks: number | null
  reach: number | null
  results: number | null
  result_indicator: string | null
  effective_status_at_sync: string | null
}

/** Today's date string in IST. Meta's ad-account timezone is Asia/Kolkata (verified
 *  live 2026-09-05 via ads_get_ad_entities at level:ad_account) so this matches Meta's
 *  own daily buckets with no shift correction needed. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}

function daysBefore(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Follows Meta's `paging.next` cursor to exhaustion. See file-header warning — a
 *  truncated page here is the one bug that recreates the original six-week blind spot. */
async function fetchAllPages<T>(url: string): Promise<T[]> {
  const out: T[] = []
  let next: string | undefined = url
  let pages = 0
  while (next) {
    const res = await fetch(next)
    if (!res.ok) {
      throw new Error(`Graph API ${res.status} on page ${pages + 1}: ${await res.text()}`)
    }
    const body = await res.json()
    if (Array.isArray(body.data)) out.push(...body.data)
    next = body.paging?.next
    pages++
    if (pages > 50) throw new Error("fetchAllPages: exceeded 50 pages — possible infinite loop, aborting")
  }
  return out
}

async function fetchCampaigns(): Promise<Map<string, CampaignMeta>> {
  const url =
    `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/campaigns` +
    `?fields=id,name,effective_status&limit=200&access_token=${META_TOKEN}`
  const rows = await fetchAllPages<CampaignMeta>(url)
  return new Map(rows.map((c) => [c.id, c]))
}

/** `optimization_goal` is NOT a valid field on the campaign node/edge — Meta silently
 *  drops it with no error (verified live 2026-09-23: `.../campaigns?fields=...,optimization_goal`
 *  returns 200 with the field simply absent, so a lookup against it is always `undefined`
 *  and pickResult() below falls through to the old wrong max-count heuristic every time
 *  — this was the actual bug in the first "fix", which shipped a no-op). The goal lives
 *  on ad sets. Pulled from the account's /adsets edge (not per-campaign) and rolled up:
 *  verified live that both this account's active campaigns have a single consistent goal
 *  across all their ad sets (CONVERSATIONS for both NCR and F Jaipur), so "first goal seen"
 *  is safe here — if a campaign ever has genuinely mixed ad-set goals this map will just
 *  pick one of them, which is still strictly better than the old always-undefined lookup. */
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

async function fetchInsights(since: string, until: string): Promise<InsightRow[]> {
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }))
  const url =
    `${GRAPH_BASE}/act_${AD_ACCOUNT_ID}/insights` +
    `?level=campaign&time_increment=1&time_range=${timeRange}` +
    `&fields=campaign_id,campaign_name,spend,impressions,clicks,reach,actions` +
    `&limit=100&access_token=${META_TOKEN}`
  return await fetchAllPages<InsightRow>(url)
}

/** Meta's insights don't return a single "results" number — that's a UI-computed metric
 *  keyed to the campaign's chosen optimization goal. Reconciled 2026-09-23 against the
 *  Meta Ads connector's own results field: prefer the action_type matching the
 *  campaign's optimization_goal (see OPTIMIZATION_GOAL_ACTION_PREFIXES above); only fall
 *  back to "highest raw count that day" when the goal is unmapped or that action_type
 *  didn't fire that day. The fallback alone was verified WRONG for this account's actual
 *  CONVERSATIONS-optimized campaigns — it picked post_engagement instead. */
function pickResult(
  actions: Array<{ action_type: string; value: string }> | undefined,
  optimizationGoal?: string,
): { results: number | null; indicator: string | null } {
  if (!actions || actions.length === 0) return { results: null, indicator: null }

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
  for (const a of actions) {
    if (Number(a.value) > Number(best.value)) best = a
  }
  const n = Math.round(Number(best.value))
  return { results: Number.isFinite(n) ? n : null, indicator: best.action_type }
}

async function upsertInsights(rows: AdInsightsUpsertRow[]): Promise<void> {
  if (rows.length === 0) return
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ad_insights?on_conflict=campaign_id,date`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`ad_insights upsert ${res.status}: ${await res.text()}`)
}

async function writeSyncRun(windowStart: string, windowEnd: string, rowsUpserted: number, ok: boolean, error: string | null): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ad_sync_runs`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify([{ window_start: windowStart, window_end: windowEnd, rows_upserted: rowsUpserted, ok, error }]),
  })
  // Best-effort — a failure to log the run must never mask the original error.
  if (!res.ok) console.error(`ad_sync_runs insert failed: ${res.status} ${await res.text()}`)
}

Deno.serve(async (req) => {
  const today = istToday()
  let since = daysBefore(today, DEFAULT_WINDOW_DAYS - 1)
  let until = today

  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => null)
      if (body?.since) since = body.since
      if (body?.until) until = body.until
    } catch {
      // malformed body → fall through to default trailing-30-day window
    }
  }

  if (!META_TOKEN) {
    const msg = "META_ACCESS_TOKEN secret is not set"
    console.error(`sync-meta-ads: ${msg}`)
    await writeSyncRun(since, until, 0, false, msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "Content-Type": "application/json" } })
  }

  try {
    const [campaigns, insights, goals] = await Promise.all([fetchCampaigns(), fetchInsights(since, until), fetchCampaignGoals()])

    const rows: AdInsightsUpsertRow[] = insights.map((r) => {
      const meta = campaigns.get(r.campaign_id)
      const { results, indicator } = pickResult(r.actions, goals.get(r.campaign_id))
      const status = meta?.effective_status ?? null
      return {
        account_id: AD_ACCOUNT_ID,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name ?? campaigns.get(r.campaign_id)?.name ?? null,
        date: r.date_start,
        spend_inr: Number(r.spend ?? 0),
        impressions: r.impressions != null ? Math.round(Number(r.impressions)) : null,
        clicks: r.clicks != null ? Math.round(Number(r.clicks)) : null,
        reach: r.reach != null ? Math.round(Number(r.reach)) : null,
        results,
        result_indicator: indicator,
        effective_status_at_sync: status,
      }
    })

    await upsertInsights(rows)
    await writeSyncRun(since, until, rows.length, true, null)

    // ── Delivery alarm ────────────────────────────────────────────────
    // ACTIVE campaign + ₹0 spend across the last 2 *completed* days (excludes today,
    // which is always partial). Computed from this run's own data — no extra fetch.
    const completedDates = Array.from({ length: ALARM_COMPLETED_DAYS }, (_, i) => daysBefore(today, i + 1))
    const spendByCampaignDate = new Map<string, number>()
    for (const r of rows) spendByCampaignDate.set(`${r.campaign_id}|${r.date}`, r.spend_inr)

    // 🔴 Only alarm when THIS run's window actually covers the completed dates being
    // checked. A historical backfill (e.g. {since:"2026-04-01",until:"2026-04-30"}) has no
    // rows for yesterday, so every ACTIVE campaign would read as ₹0 and the alarm would
    // email team@ a false "delivery stopped" for each one. Found before the first
    // 180-day backfill on 2026-09-23.
    const windowCoversAlarm = since <= completedDates[completedDates.length - 1] && until >= completedDates[0]
    const silentActive: CampaignMeta[] = []
    for (const c of campaigns.values()) {
      if (!windowCoversAlarm) break
      if (c.effective_status !== "ACTIVE") continue
      const allZero = completedDates.every((d) => (spendByCampaignDate.get(`${c.id}|${d}`) ?? 0) === 0)
      if (allZero) silentActive.push(c)
    }

    if (silentActive.length > 0) {
      const list = silentActive.map((c) => `<li><strong>${esc(c.name)}</strong> (id ${esc(c.id)})</li>`).join("")
      await sendEmail({
        to: TEAM_EMAIL,
        subject: `🔴 Meta ads: ${silentActive.length} active campaign${silentActive.length === 1 ? "" : "s"} showing ₹0 spend for ${ALARM_COMPLETED_DAYS} days`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#333;">
            <h2 style="color:#b4452f;">Ad delivery may have stopped</h2>
            <p>Status reads ACTIVE but spend has been ₹0 for the last ${ALARM_COMPLETED_DAYS} completed days
               (${completedDates.slice().reverse().join(" → ")}):</p>
            <ul>${list}</ul>
            <p>Common causes: prepaid balance ran out (this happened 2026-07-24 and went
               unnoticed for 6 weeks — that's why this email exists), a payment method
               declined, or a policy rejection that doesn't change the status label.
               Check Ads Manager directly.</p>
          </div>`,
      })
      console.warn(`sync-meta-ads ${today}: alarm sent for ${silentActive.length} campaign(s) — ${silentActive.map((c) => c.name).join(", ")}`)
    }

    console.log(`sync-meta-ads ${today}: synced ${rows.length} rows for ${since}..${until}, ${campaigns.size} campaigns, ${silentActive.length} alarms`)
    return new Response(
      JSON.stringify({ ok: true, since, until, rowsUpserted: rows.length, campaigns: campaigns.size, alarms: silentActive.length }),
      { headers: { "Content-Type": "application/json" } },
    )
  } catch (err) {
    const msg = String(err)
    console.error("sync-meta-ads error:", msg)
    await writeSyncRun(since, until, 0, false, msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "Content-Type": "application/json" } })
  }
})

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
