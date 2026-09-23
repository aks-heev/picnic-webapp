# Hosted Dashboard Plan — Meta Ads Performance + Spend Control

**Supersedes `docs/META_ADS_DASHBOARD_PLAN.md` (2026-09-05).** That plan scoped a narrower
spend-control tool (delivery alarm, runway) as a second static page in the same Vercel
project. Its Phase 1 (tables) shipped and is reused here unchanged. Its Phases 2/2b/3
(sync function, backfill, the actual page) never happened — this plan absorbs them rather
than running two Meta-data efforts against the same project. `META_ADS_DASHBOARD_PLAN.md`
now carries a one-line pointer to this file; do not delete it, it still documents Phase 1.

Written 2026-09-23.

**Status as of 2026-09-23, same-day build session:**

| Phase | Status |
|---|---|
| 1 — city columns on `booking_revenue_split` | **SHIPPED-verified** — live, spot-checked |
| 2 — `sync-meta-ads` function + `sync-meta-ads-daily` cron | **built-unverified** — code + cron both live, function itself **not deployed** (needs Aksheev, Dashboard-only per §6); cron fires against a 404 until then, harmless |
| 3 — `meta-live-snapshot` function | **built-unverified** — same as above, not deployed |
| 4 — `hosted-dashboard/hub.html` + `ads.html` | **built-unverified** — bundle/syntax-checked only; never rendered in a browser, per CLAUDE.md §9 handed to Aksheev as the eyeball item |
| 5 — Access lockdown | **NOT-done** — Aksheev's call, deferred both times asked |
| 6 — Watchdog line in Morning brief | **NOT-done, blocked** — see note below |

🔴 **Phase 6 blocker:** this plan (and `META_ADS_DASHBOARD_PLAN.md` before it) names a
scheduled task `trig_01GbrmkjMWdRDcPfW9GLXCm1`. `list_scheduled_tasks` in this session
shows no task by that ID and nothing resembling a "Morning brief" among the 10 tasks that
do exist (daily-mails, groww-portfolio-refresh, weekly-review, groww-intel-refresh,
cas-dashboard-monthly-update, weekly-work-summary, picnic-stay-checkin-times-template,
airbnb-booking-digest, airbnb-monthly-reconcile, supabase-index-audit — none weekday
08:00 IST, none Meta-related). Per CLAUDE.md §2, a prior doc's claim does not override live
state — this is exactly the kind of stale reference §2 exists to catch. Not chasing this
further without Aksheev: either the task lives in a different scheduling surface than this
session can see, or it never existed and the plan's own §10 was itself unverified when
written. Needs Aksheev to locate the actual task (if it exists) before this phase can move.

---

## 1. Why this shape

Two things exist independently today and both read Meta Ads data for the same account
(565789031303932):

1. A rich **performance-analytics** dashboard, built this session as a Cowork artifact —
   spend-vs-bookings lag correlation, a Gurugram/Jaipur split, MER, an ads-on/ads-off
   natural holdout, a 14-day pixel funnel, ad-set fatigue, a lifetime leaderboard, and
   audience sizes. It only runs inside Cowork (`window.cowork.callMcpTool(...)` has no
   equivalent in a plain browser) and reads booking data from `public.booking_revenue_split`.
2. A **spend-control** dashboard, scoped but never built — a delivery-status alarm and
   runway estimate, backed by `public.ad_insights` (already live, still empty) and a sync
   function that was never written.

Decided 2026-09-23: build one dashboard that does both, in the existing
`picnic-dashboard` Vercel project (`prj_Gy59tojmaTgpOPNKd8A87QcpMBNE`, git-linked to
`aks-heev/picnic-webapp main`), reusing the same Supabase-Auth login `index.html` already
has rather than inventing per-partner accounts or a page password. A new hub page links
out to both dashboards (Business/Finance = existing `index.html`, Meta Ads = new).

## 2. Definition of Done

- [ ] A partner with the shared login, and no Vercel account, can reach the hub and open
      the Meta Ads dashboard from a plain browser (no SSO prompt in front of it).
- [ ] The Meta Ads dashboard shows, all backed by real data: delivery-status alarm per
      active campaign, runway estimate (or is honestly omitted — see §6), a 90-day spend
      sparkline with the city split, MER, the pixel funnel, ad-set fatigue, and the
      lifetime leaderboard.
- [ ] `ad_insights` has an unbroken daily row per active campaign, refreshed by a cron job
      that has actually fired (`ad_sync_runs` proves it, not an assumption).
- [ ] The Meta access token lives in exactly one place (Supabase Edge Function secrets),
      never in a Vercel env var, never in browser-reachable code.
- [ ] `META_ADS_DASHBOARD_PLAN.md` points here; no second, stale plan document survives.

## 3. Architecture — one login, one token

```
Partner's browser
   │  Supabase Auth (same login as index.html — no new accounts)
   ▼
hub.html ──► index.html (unchanged)
   └───────► ads.html
                │
                ├─ historical series (spend/results/status, 30–90d+) ──► Postgres,
                │  read directly via the authenticated Supabase client, RLS admin-only
                │  (ad_insights, booking_revenue_split — same pattern index.html uses)
                │
                └─ live snapshots (14d pixel funnel, ad-set frequency, audiences) ──►
                   edge function `meta-live-snapshot` (verify_jwt=true — only a logged-in
                   session can call it) ──► Graph API, using the SAME Meta token as the
                   cron sync function (one Supabase secret, read by two functions)
```

This resolves the access question and the RLS question at once: the shared login is a
genuine authenticated Postgres role, so nothing needs a new `anon` policy, and nothing
needs a second credential-storage location. Vercel never holds the Meta token.

**Rejected alternative:** a Vercel serverless function calling Meta directly with its own
copy of the token. Works, but doubles the places a token can leak or go stale, and
duplicates the pagination/rate-limit handling the sync function already has to get right.
Not worth it for the amount of "live" data involved (funnel, audiences, ad-set list — all
small, cacheable payloads).

---

## 4. Phase 0 — Blocking decisions · Aksheev, before anything else starts

Two things gate everything downstream. Resolve both first; do not let engineering start
against an assumption on either.

1. **Meta System User token.** Still unresolved as far as this session can tell — check
   Business Manager `1549685876475913` for an existing one before creating a new one.
   Blocks Phase 2 and Phase 3 entirely (nothing Meta-sourced can be built without it).
   Phases 1 (already done) and the booking-only parts of Phase 5 do not need it, so those
   can proceed in parallel if the token takes a few days.
2. **SSO vs custom domain.** Today, `picnic-dashboard`'s Vercel SSO gates every
   `*.vercel.app` URL *before* the Supabase login even loads — so "one shared login" is
   currently a second gate behind a first one only Aksheev can pass. **Recommendation:
   attach a custom domain and turn Vercel SSO off**, so the Supabase login becomes the
   *only* gate — it already does the access-control job, a second one adds friction with
   no added security (anyone with the domain link still hits a real login). If Aksheev
   wants Vercel SSO to stay on as a second layer, partners must additionally be invited to
   the Vercel team, and this should be stated to them explicitly rather than discovered
   when the link doesn't work.

**Exit condition:** both answered in writing (a line in this doc or a Todoist task), not
inferred from silence.

---

## 5. Phase 1 — Schema · SHIPPED-verified 2026-09-23

`public.ad_insights` and `public.ad_sync_runs` exist, RLS-locked, admin-only, currently
empty (verified live 2026-09-23). No new migration needed for the historical-series data.

**Deviation from the plan as originally written.** This section originally proposed a new
`public.picnic_revenue_by_city_day` view to promote the artifact's inline city-bucketed
SQL. Built instead: extended `public.booking_revenue_split` in place with two trailing
columns, `venue_city` (raw) and `city` (bucketed `gurugram`/`jaipur`, Delhi folded into
gurugram — the only NCR campaign targets both). Reasoning: `booking_revenue_split` already
joins `venues` for `venue_name`/`venue_type`, so a second view would mean a second `venues`
join to keep in sync with the first, for no benefit — one canonical booking-revenue
definition stays canonical, and every existing consumer gets the city columns for free
without a second query to write. Row-level, not pre-aggregated by day; callers group as
needed, same as every other consumer of this view already does.

Migration `20260923_booking_revenue_split_add_city.sql` — `security_invoker = true`
preserved (it was already on the view). Applied via `apply_migration` **and** written to
`supabase/migrations/`, same session.

**Exit condition — met:** `get_advisors` (security) shows no new finding —
`booking_revenue_split` doesn't appear in the diff; the listed warnings are all pre-existing
and unrelated. Spot-check over the trailing 180 days: 22 Gurugram / 5 Jaipur confirmed
bookings, ₹303,163 / ₹54,600 picnic revenue — orders of magnitude match the artifact's
prior inline-query totals for the same window.

**Rollback:** re-run the prior `CREATE OR REPLACE VIEW` (the 16-column version, dated
2026-09-15) to drop the two trailing columns. Nothing depends on them yet.

---

## 6. Phase 2 — `sync-meta-ads` + cron + 90-day backfill · Claude writes, Aksheev deploys

This is `META_ADS_DASHBOARD_PLAN.md` §4 verbatim in substance — nothing here changes it,
only restates the parts that matter for sequencing:

- Graph API directly, never the MCP connector (`amount_spent` comes back as a formatted
  string like `"₹0.00 INR"` from the connector; the Graph API's `/insights` gives a clean
  `"spend": "0"`).
- `/act_565789031303932/insights`, `level=campaign`, `time_increment=1`, **page through
  `paging.next` to exhaustion** — a truncated first page silently drops the actively-
  spending campaign, which is indistinguishable from it having gone dark. This is the one
  bug in this whole plan that would recreate the exact six-week blind spot the original
  plan exists to prevent.
- Trailing 30-day window, upsert `on conflict (campaign_id, date) do update` — Meta
  restates recent days as attribution settles.
- Alarm computed inside this function, not a separate job: `effective_status='ACTIVE'`
  AND ₹0 spend across 2 consecutive **completed** days → email via Resend to `team@`.
- `verify_jwt=false` (cron-called). Cron POSTs with `Content-Type` only — **no
  `Authorization` header, and no `CRON_SECRET` guard in the function.** A `CRON_SECRET`
  would silently 401 every run while `cron.job_run_details` keeps reporting `succeeded` —
  that exact blindness caused the original six-week outage.
- `_shared/` inside the deployed bundle is a sibling copy, already drifted from the repo's
  `_shared/`. Bundle-check on a `/tmp` layout that mirrors the deployed shape, not the
  repo tree.
- Balance/runway: `GET /act_565789031303932?fields=balance,spend_cap,amount_spent` — curl
  it once before building the runway card. **If it fails or the token lacks scope, drop
  the runway card rather than faking a number.** Delivery-status alarm does not depend on
  balance and should ship regardless.
- Cron `sync-meta-ads-daily` at `20 5 * * *` UTC (10:50 IST) — clear of the other five
  jobs' minutes (`15 3`, `30 3`, `30 4`, `0 *`, `30 20`).

**Deployment reality (unchanged from the original plan, re-verified applicable today):**
`deploy_edge_function` cannot be called from Cowork (schema validation rejects `verify_jwt`
and `files`), and the local Supabase CLI is logged into the wrong account. **Deploy through
the Supabase Dashboard**, same as `notify-booking-received` v32. Same for the
`META_ACCESS_TOKEN` / `META_AD_ACCOUNT_ID` secrets — set them under Dashboard → Edge
Functions → Secrets, **before** enabling the cron job, or every cron fire 500s while
`cron.job_run_details` reports success.

**Phase 2b — backfill:** invoke manually with `{"since":"2026-06-01","until":"today"}` in
the POST body (function defaults to trailing 30 days when the body is absent — this also
becomes the repair path for any future gap). Page in 30-day chunks if a 90-day window
truncates.

**Exit conditions:**
1. esbuild bundle check passes against the `/tmp` mirrored layout.
2. `list_edge_functions` confirms deployed + `verify_jwt: false`.
3. `get_logs` clean, `get_advisors` no new warning.
4. Three spot-check dates reconciled against Ads Manager by eye.
5. Regression test: replaying the known-bad window (2026-07-24 → 2026-09-02) reads ₹0
   throughout for the campaign that actually went dark then, and the alarm rule fires
   when replayed over it.
6. `select count(*), min(date), max(date) from ad_insights` covers the full backfill
   window with zero gaps.

**Rollback:** disable the cron job. Table keeps its last good rows; nothing else reads it
yet at this point in the sequence.

---

## 7. Phase 3 — `meta-live-snapshot` edge function · Claude writes, Aksheev deploys

New function, not in the original plan — covers what `ad_insights` never captured:
14-day pixel funnel (`dataset_stats`), ad-set frequency/CTR, and custom-audience sizes.
`verify_jwt=true` — this one is called from the browser by a logged-in partner, not by
cron, so it should reject anyone without a valid Supabase session outright rather than
relying on RLS (there's no table here for RLS to protect).

- Three thin proxied reads, same Graph API endpoints the Cowork artifact already proved
  work: pixel `dataset_stats` (14d), ad-set list with `frequency`/`cost_per_result`, custom
  audiences.
- **Cache each response 5–10 minutes** (in-memory or a small `pg` table keyed by endpoint)
  before adding a fourth data source. Without this, every partner's page load re-hits the
  Graph API directly — fine at low traffic, a real rate-limit and cost risk once "every
  partner" actually means several people checking it the same morning.
- Reuses the same `META_ACCESS_TOKEN` secret as `sync-meta-ads` — one token, read by two
  functions, never duplicated into Vercel.

**Exit conditions:** same bundle-check/deploy-log/advisor checklist as Phase 2. Additionally:
a second browser tab hitting the function within the cache window gets the cached response
(verify via `get_logs` timestamps, not by eyeballing the page).

**Rollback:** the three blocks on `ads.html` that depend on this function render an
explicit "unavailable" state rather than erroring the whole page — same failure-isolation
pattern the Cowork artifact already uses (`Promise.allSettled` per section).

---

## 8. Phase 4 — Hub homepage + `ads.html` · Claude writes, Aksheev pushes

- `hosted-dashboard/hub.html` — the shared login, then two cards linking to `index.html`
  and `ads.html`. Reuses `index.html`'s auth snippet verbatim; does not edit `index.html`
  itself (its money logic carries inline comments about traps it was written around —
  same rule as the original plan).
- `hosted-dashboard/ads.html` — combines both dashboards' content in this order, above the
  fold first:
  1. Delivery-status band (per active campaign, days since last non-zero spend; red past 1)
  2. Runway, if Phase 2's curl check succeeded — otherwise this card is omitted, not faked
  3. Last-synced badge from `ad_sync_runs` (red past 36h)
  4. 90-day spend sparkline with the Gurugram/Jaipur/Both toggle, sourced from `ad_insights`
     + `booking_revenue_split`'s `city` column (Phase 1)
  5. MER, ads-on/ads-off holdout, pixel funnel, ad-set fatigue, lifetime leaderboard,
     audiences — same content as the Cowork artifact, re-pointed at the two data paths
     from §3 instead of `window.cowork.callMcpTool`.

Aggregate in SQL, not in the browser — this is a handful of rows per load, not thousands,
but the principle from the original plan still holds: don't ship an N+1 query pattern to
partners just because Cowork's artifact could get away with client-side joins.

**Exit condition:** rendered and eyeballed at a real screen width, by a human, before
calling it done — the original plan's own postmortem on this point stands: every dashboard
shipped so far in this project was never actually seen rendering by Claude first. Don't
repeat that here either.

**Rollback:** revert the two new files; `index.html` and its login are untouched
throughout, so the existing Business dashboard is never at risk from this work.

---

## 9. Phase 5 — Access lockdown · Aksheev

Execute whatever Phase 0 decided. If custom domain + SSO-off: attach the domain, flip the
SSO toggle, and confirm from a signed-out browser (or ask a partner to try) that the
Supabase login is the *only* thing standing between a partner and the dashboard. If
SSO-stays-on: send Vercel team invites to every partner and say so explicitly, so "I can't
reach the link" isn't a surprise.

**Exit condition:** one partner, not Aksheev, confirms they can log in and see the
dashboard from their own device.

---

## 10. Phase 6 — External watchdog · Claude, 10 minutes

Same as the original plan §6: add one line to the existing Morning brief scheduled task
(`trig_01GbrmkjMWdRDcPfW9GLXCm1`, weekdays 08:00 IST) — it already has Supabase and Meta
connectors attached and runs outside Supabase, so it survives a gateway outage that would
silence Phase 2's own alarm.

> Read `public.ad_sync_runs` and report the age of the newest row. Flag if older than 36 hours.

---

## 11. Standing red lines (carried forward, still true)

- No staging. Every migration and function here is production the moment it lands.
- **Never add an `anon` SELECT policy** to `ad_insights` or `booking_revenue_split` — the
  shared-login architecture in §3 exists specifically so this is never necessary.
- `config.toml` is not the source of truth for anything deployed via the Dashboard;
  `list_edge_functions` is.
- The Meta token lives in exactly one place: Supabase Edge Function secrets, shared by
  `sync-meta-ads` and `meta-live-snapshot`. If a third consumer ever needs it, it goes
  through one of these two functions — it does not get a third copy.
- Claude never runs `git`. Every session touching this plan ends with a paste-ready block.

---

## 12. Rollback summary

| Phase | Rollback |
|---|---|
| 1 (view) | Re-apply the prior `CREATE OR REPLACE VIEW` (2026-09-15, 16 columns) to drop `venue_city`/`city` |
| 2 (sync) | Disable `sync-meta-ads-daily` cron job; `ad_insights` keeps last good rows |
| 3 (live proxy) | Affected `ads.html` sections show "unavailable"; rest of page unaffected |
| 4 (hub + ads.html) | Revert the two new files; `index.html` never touched |
| 5 (access) | Re-enable Vercel SSO / detach domain |
| 6 (watchdog) | Remove the one added line from the Morning brief task |

---

## 13. Open items carried forward, not resolved by this plan

- Meta System User token status (§4.1) — Aksheev to check/create.
- SSO vs custom domain (§4.2) — Aksheev to decide; §4 states the recommendation.
- Whether `balance` is readable at all with this token — one curl in Phase 2, before
  building the runway card, not after.
