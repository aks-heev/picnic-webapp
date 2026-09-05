# Meta Ads Spend-Control Dashboard — Build Plan

Written 2026-09-05. Status: **NOT STARTED** — nothing in this plan has been built.

---

## 1. Why

On 2026-07-24 the only active Meta campaign stopped delivering because the prepaid
balance ran out. Its status — and its ad sets' status — kept reading **Active**, with
zero delivery-blocking errors reported anywhere. Nobody noticed for **six weeks**,
until a ₹3,000 UPI top-up on 2026-09-03 resumed delivery within hours.

**The goal of this build is to never lose six weeks again.** It is a spend-control
tool, not a performance tool.

### Explicitly OUT of scope: ads → revenue attribution

Measured 2026-09-05 against `public.bookings`:

| Fact | Value |
|---|---|
| Confirmed bookings, all time | 46 |
| …with `entry_source = 'site'` | **2** |
| …with an ad-like `external_booking_ref` | **0** |

The ads are click-to-message: they drop the prospect into WhatsApp, which breaks the
pixel chain, and the booking is then hand-entered with no campaign identifier anywhere.
**"Which campaign made money" is not computable from today's data**, and no dashboard
changes that — it is a data-collection gap. The cheapest fix is to replace the admin
Add Booking free-text source field with a dropdown (Instagram ad / Instagram organic /
WhatsApp / Referral / Airbnb / Direct / Walk-in). Deferred by decision.

See `meta-ads-attribution-gap` in project memory for the full numbers and for the
Jul 24 – Sep 2 ads-off natural experiment.

---

## 2. Facts that shaped the architecture

All verified live 2026-09-05 — against the Meta connector, the Supabase project, and the
deployed `lead-digest` function.

1. **`balance` is NOT available through the Meta MCP connector.**
   `ads_get_field_context` returns it in `unknown_fields`, along with `account_status`.
   The Graph API exposes `balance` on the ad account node; the connector does not.

1b. **`timezone_name` IS available** at `level: ad_account`, and reads
   **`Asia/Kolkata`** — so no date-shift handling is needed (see §3).

2. **You do not need it.** `effective_status` and daily spend are both available at
   campaign level. **"effective_status = ACTIVE and ₹0 spend for 2 consecutive completed
   days"** is the same signal derived behaviourally, and it would have fired on day 2 of
   the six-week gap instead of day 42.

### Why the Graph API, not the MCP connector, inside the sync

The connector is built for conversation, not ETL. A live test returned:

```
"amount_spent": "₹0.00 INR"          <- formatted display string, not a number
"results":      {"value": "Not available"}     <- nested object, sentinel string
```

The Graph API `/insights` endpoint returns `"spend": "0"` — clean and parseable.
**Do not build an ETL on top of a display formatter.**

### Why pg_cron, not a Claude scheduled task

pg_cron is the right scheduler and matches the four jobs already running. Be precise
about the division of labour though:

- **pg_cron alone cannot call Meta and act on the answer.** `pg_net` is asynchronous —
  `net.http_post` returns a request id immediately and the response lands in
  `net._http_response` later, where it is retained only ~6 hours. Doing this purely in
  Postgres means a two-step cron (fire, then read + parse), plpgsql JSON parsing, and a
  separate path to send mail. That is *more* work than an edge function, not less.
- **So the pattern is: pg_cron triggers an edge function, the edge function does the
  work.** This is exactly what `lead-digest-daily` and `post-event-nudge-daily` already
  do — `net.http_post` to `/functions/v1/<fn>`.

🔴 **The one thing pg_cron cannot do: tell you that Supabase is down.** During the
2026-08-02 → 08-13 quota outage, `cron.job_run_details` reported `status = 'succeeded'`
for all five jobs while every edge function returned 402 at the gateway. An ads alarm
living entirely inside Supabase inherits that blind spot. Hence the external watchdog
in §6.

### Deployment reality — verified against the LIVE `lead-digest` function 2026-09-05

Four things that are not what the repo suggests. All confirmed via
`get_edge_function('lead-digest')` and `cron.job`.

1. 🔴 **`config.toml` is NOT the source of truth for Dashboard-deployed functions.**
   It has no `[functions.lead-digest]` block at all, yet the deployed function reports
   `verify_jwt: false`. The Dashboard toggle is what actually applies. Adding a
   `config.toml` entry is good hygiene for the repo but changes nothing at deploy time —
   **set the toggle in the Dashboard and then re-read `list_edge_functions` to confirm.**

2. 🔴 **The cron jobs send NO `Authorization` header.** Both `lead-digest-daily` and
   `post-event-nudge-daily` post with `headers := '{"Content-Type": "application/json"}'`
   and nothing else. So a cron-called function MUST be `verify_jwt = false`. (The
   `config.toml` comment on `sync-ical` claiming "the pg_cron caller passes the
   service-role key as a bearer token" is true for `sync-ical` only, not for these.)

3. 🔴 **LIVE LANDMINE — do not set a `CRON_SECRET` function secret.** `lead-digest` and
   `post-event-nudge` both contain:
   ```ts
   if (CRON_SECRET) {
     if (req.headers.get("Authorization") !== `Bearer ${CRON_SECRET}`) return 401
   }
   ```
   Since the cron sends no `Authorization` header, **setting that secret would silently
   401 both daily jobs**, and `cron.job_run_details` would keep reporting `succeeded` —
   the exact blindness documented in the August outage. The guard is dead code that only
   ever fires as a foot-gun. `sync-meta-ads` should NOT copy it.

4. 🔴 **`_shared/` is duplicated into each deployed bundle, and the copies have drifted.**
   `lead-digest/index.ts` imports `"./_shared/resend.ts"`, but in the repo `_shared/` is a
   **sibling** of `lead-digest/`, so that path is wrong on disk and correct only in the
   deployed bundle, which carries its own `_shared/resend.ts` file. The two copies are
   **not identical** — the repo version supports `cc?: string | string[]`, the deployed
   version does not.
   **Consequences for this build:** a local `deno check` or esbuild run against the repo
   file will fail on a *correct* function; bundle-check on a `/tmp` copy with `_shared/`
   placed as a child, mirroring the deployed layout. And when deploying, remember to
   attach `_shared/resend.ts` as a file inside the function's own bundle.

Useful to lift verbatim from `lead-digest`: `istToday()` —
`new Date(Date.now() + 5.5*3600*1000).toISOString().slice(0,10)` — and the `rest()`
service-role fetch helper.

---

## 3. Phase 1 — Tables (½ day) · Claude applies, Aksheev commits

**Prerequisite — RESOLVED 2026-09-05, no action needed.** The ad account's
`timezone_name` is **`Asia/Kolkata`** (read live via `ads_get_ad_entities` at
`level: ad_account`; the field exists in the connector catalog even though `balance` and
`account_status` do not). So Meta's daily buckets and
`(created_at at time zone 'Asia/Kolkata')::date` on `bookings` are the same calendar day.
**No date-shift correction is required anywhere in this build.** Store `date` as the
account-local date exactly as Meta returns it; do not re-cast it.

Migration `20260905_ad_insights.sql`, applied via `apply_migration` **and** written to
`supabase/migrations/` — both, same session.

`public.ad_insights`
```
account_id text, campaign_id text, campaign_name text, date date,
spend_inr numeric, impressions int, clicks int, reach int,
results int, result_indicator text, effective_status text,
synced_at timestamptz
PRIMARY KEY (campaign_id, date)
```

`public.ad_sync_runs`
```
id bigserial pk, run_at timestamptz, window_start date, window_end date,
rows_upserted int, ok boolean, error text
```
Written on **every** run, successes and failures alike. This is what the dashboard's
"last synced" badge reads, and what the §6 watchdog queries.

**RLS on BOTH tables** — `ad_insights` *and* `ad_sync_runs`: clone the
`public.expenses` policies exactly — four admin-only policies keyed on `auth.email()`.
🔴 **Zero anon policies, SELECT included.** `ad_sync_runs` is easy to forget because it
looks like plumbing; it leaks your spend cadence if left open.

**Exit condition:** RLS proven in a rolled-back transaction the way `expenses` was —
anon 0 · authenticated non-admin 0 · admin N. Zero test residue.

**Rollback:** `drop table` both. Nothing else references them.

---

## 4. Phase 2 — Sync function + cron + alarm (1 day) · Claude writes, **Aksheev deploys**

`supabase/functions/sync-meta-ads/index.ts`

- Calls the **Graph API** directly (see §2), not the MCP connector.
- `/act_565789031303932/insights`, `level=campaign`, `time_increment=1`.
- **Fetches a trailing 30-day window on every run** and upserts
  `on conflict (campaign_id, date) do update`. Meta restates recent days as attribution
  settles; writing only "yesterday" freezes numbers that later change, and no conflict
  key grows the table without bound.
- 🔴 **Page through `paging.next` until exhausted.** A live test with `limit: 10`
  silently returned only two campaigns and dropped the active one. **A truncated first
  page is indistinguishable from a campaign that stopped spending** — this is the single
  most dangerous bug this function can have.
- Also `GET /act_565789031303932?fields=balance,spend_cap,amount_spent` for the runway
  card. **Verify with one curl before building against it** — it is outside the
  connector's catalog and may need scope the token does not have. If it fails, drop the
  runway card rather than faking it.
- **The alarm lives here**, not in a separate job: after the upsert, any campaign with
  `effective_status = 'ACTIVE'` and ₹0 spend across 2 consecutive completed days →
  send via Resend to team@.
- `verify_jwt = false` (cron-called). `config.toml` already pins this for the `notify-*`
  functions; add this one.

**pg_cron job** `sync-meta-ads-daily` at **`20 5 * * *` UTC (10:50 IST)**.

⚠️ **Not `0 5`** — `sync-ical-hourly` runs at `0 * * * *`, so every `:00` minute is
already taken and `sync-ical` takes 5–8s. Minute 20 is clear of all five existing jobs
(`15 3`, `30 3`, `30 4`, `0 *`, `30 20`) and late enough that Meta's previous
Asia/Kolkata day has settled.

Copy the header shape from `lead-digest-daily` exactly — `Content-Type` only, no
`Authorization` (see §2.2), and no `CRON_SECRET` guard in the function (see §2.3).

### 🔴 Deployment constraints — read before starting

- **`deploy_edge_function` CANNOT be called from Cowork.** Its MCP schema is an untyped
  `{"type":"object"}`, so the harness stringifies `verify_jwt` and `files` and the
  server's Zod validation rejects both. Two attempts, identical failure, 2026-09-03.
- **The Supabase CLI is logged into the wrong account.** `supabase link --project-ref
  evmftrogyzoudiccqkya` returns *"Your account does not have the necessary privileges"*;
  the picker only offers `hzkrqpdoipkhfsewhpou` and `jizthenzqaonxcxncyvs`.
- **=> Deploy goes through the Supabase Dashboard**, as was done for
  `notify-booking-received` v32.
- 🔴 **The same applies to SECRETS.** `supabase secrets set` needs the same CLI login that
  is unavailable, so `META_ACCESS_TOKEN` (and `META_AD_ACCOUNT_ID`) must be added under
  **Dashboard → Edge Functions → Secrets** by Aksheev. A function deployed without its
  secret returns 500 on every cron fire while `cron.job_run_details` reports `succeeded`.
  Set the secret **before** enabling the cron job.

### Token

Create a **System User token** in Business Manager `1549685876475913` (Aura Events India
owns ad account 565789031303932 — confirmed 2026-09-05). System User tokens do not
expire.

Fallback if that cannot be created: a long-lived user token **plus a calendar reminder at
day 50**. These die at 60 days, and when one dies the dashboard keeps rendering stale
numbers confidently — the exact failure this whole project exists to prevent.

**Exit conditions:**
1. esbuild bundle check passes on a `/tmp` copy (never against the mount — see CLAUDE.md §3).
2. Deployed version and `verify_jwt: false` confirmed via `list_edge_functions` after deploy.
3. `get_logs` clean; `get_advisors` shows no new warning.
4. Three spot-check dates reconciled against Ads Manager by eye.
5. **Regression test:** after the 90-day backfill, the Jul 24 – Sep 2 window reads ₹0
   throughout and the alarm rule fires when replayed over it. Use the known-bad window
   rather than waiting for the next failure.

**Rollback:** disable the cron job. The table keeps its last good rows.

### Phase 2b — One-time 90-day backfill (30 min) · Claude

The daily job only ever fetches a trailing 30 days, so history has to be loaded once.
This step was referenced by the Phase 2 regression test but never specified — it is a
real step, not a side effect.

- Invoke the deployed function manually with an override window covering
  **2026-06-01 → today** (build it to accept `{"since":"...","until":"..."}` in the POST
  body, defaulting to the trailing 30 days when absent — this is also how you re-run a
  repair later without touching the cron).
- Meta caps `time_increment=1` requests; if a 90-day window errors or truncates, page it
  in 30-day chunks. The upsert makes re-runs free.

**Exit:** `select count(*), min(date), max(date) from ad_insights` covers the full window
with no gaps, **and** every date from 2026-07-24 to 2026-09-02 shows ₹0 for the active
campaign. That window is the known-bad ground truth — if it does not read ₹0, the sync is
wrong, not Meta.

---

## 5. Phase 3 — `ads.html` (1 day) · Claude writes, Aksheev pushes

A new page in the **existing `picnic-dashboard` Vercel project**
(`prj_Gy59tojmaTgpOPNKd8A87QcpMBNE`, live at `picnic-dashboard-nu.vercel.app`,
git-linked to `aks-heev/picnic-webapp` on `main` — a push redeploys it).

🔴 **Not** a new Vercel project, and **never** a route inside `picnic-webapp`.

🔴 **Cross-dependency — the page will be unreachable when it ships.** That project has
Vercel **SSO protection ON** (`ssoProtection.enabled: true`,
`deploymentType: all_except_custom_domains`), so every `*.vercel.app` URL demands a Vercel
login on Aksheev's team *before* the Supabase login screen renders. `ads.html` inherits
this. Either accept that only he can open it, or attach a custom domain — that setting
exempts custom domains, which is the intended fix for `index.html` too. Decide this once,
for both pages.

Share the auth snippet with `index.html` but do not edit that file — its money logic
carries inline comments about traps it was written around.

Above the fold, in this order:

1. **Delivery band** — per ACTIVE campaign, days since last non-zero spend. Red past 1.
2. **Runway** — balance ÷ trailing-7-day burn, in days. Omit entirely if `balance`
   proved unreadable in Phase 2.
3. **Last synced** — from `ad_sync_runs`. Red past 36h.

Below: 90-day spend sparkline, campaign table (spend, results, cost per result, status).

Aggregate in SQL (a view or RPC), not in the browser — 12 rows per page load, not 4,000.

**Exit condition:** rendered and eyeballed at a real screen width. Every dashboard
shipped here so far was never seen rendering by Claude. Do not repeat that.

---

## 6. External watchdog (10 minutes) · Claude

Add one line to the existing **Morning brief** scheduled task (`trig_01GbrmkjMWdRDcPfW9GLXCm1`,
`30 2 * * 1-5` UTC = 08:00 IST weekdays). It already has the Supabase and Meta connectors
attached and it runs **outside** Supabase, so it survives a 402 gateway outage that would
silence everything in §4.

> Read `public.ad_sync_runs` and report the age of the newest row. Flag if older than 36 hours.

⚠️ It is **weekdays only**, so a Friday-night failure surfaces Monday morning. Acceptable
for now; note it rather than forgetting it.

---

## 7. Standing red lines

- **There is no staging.** Every migration and function is production the moment it lands.
- 🔴 **Never add an `anon` SELECT policy to `ad_insights`** — the absence of one on
  `bookings` and `expenses` is the only reason a hosted dashboard URL is safe at all.
- **Storage is a non-issue.** DB is 17 MB of a 500 MB free tier; campaign-level daily rows
  are ~5 MB/year. The binding quota on this project is cached **egress**, driven by
  oversized site images, and it is still unaddressed. It caused an 11-day outage in August
  and will recur.
- **`config.toml` is not the source of truth** for anything deployed via the Dashboard;
  `list_edge_functions` is. Same class of drift as `edge-fn-drift` in project memory.
- **Alert recipient:** `team@picnicstories.com`, via the `TEAM_EMAIL` env with that value
  as the default — the same address `lead-digest` has been mailing daily, so the mailbox
  is known to accept mail. Reuse `_shared/resend.ts`'s `sendEmail`; do not invent a
  second sender path.
- Claude never runs `git`. Every session ends with a paste-ready block.

---

## 8. Open risk

Phase 2 depends on a System User token that cannot be created or verified from here. If
Business Manager access turns out to be the blocker, **Phases 1 and 3 still stand** — you
would have the table and the page, fed by a manual backfill, without the daily automation.
