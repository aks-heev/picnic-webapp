# Growth dashboard — PostHog + Search Console on picnic-dashboard

Written 2026-10-30. Status (2026-10-30): BUILT — tables, sync-posthog v1, sync-gsc v1, both crons and growth.html are live/written. Waiting on the two secrets (POSTHOG_API_KEY, GSC_SERVICE_ACCOUNT_JSON); until they're set every sync logs ok=false and the page shows red chips. Decisions taken: GSC key moves to Supabase; readers = Aksheev + partners on the shared login. Mockup (Claude design canvas, real 30-day numbers): "Growth Dashboard".

## 1. What it is for

One page, `/growth` on the `picnic-dashboard` Vercel project, that answers three questions once a week:

1. **Is demand growing?** Visitors, WhatsApp taps, Book-online taps, week over week.
2. **Which channel turns into bookings, per rupee?** Visitors by source (PostHog) beside confirmed bookings and revenue by `bookings.booking_source`, beside Meta spend.
3. **Where does it leak?** The brochure → WhatsApp / Book online → date picker → intent → paid path.

Done = Aksheev opens `/growth` on his phone on a Monday and can answer all three without opening PostHog, Search Console or Ads Manager, and every number on it matches its source query.

Not for: real-time visitors, person-level journeys, SEO deep-dives (the GSC weekly artifact stays the SEO tool; this page links to it).

## 2. Facts this plan rests on (probed live 2026-10-30)

- PostHog is installed and live (`analytics.js`, project 482400, key in prod bundle). 28 booking-path events in `app.js`, 7 more in `brochure.js`.
- 30 IST days, production hosts only: 1,690 visitors; `/brochure` 1,294 of them; 302 people tapped WhatsApp; 130 tapped Book online; 23 opened the date picker; 3 submitted; 1 paid.
- Bookings created in the same window, standing exclusions applied: 74 rows, 55 confirmed (35 picnic / 20 stay), 54 of the 55 entered by the team. Picnic revenue ₹4,91,695, stay ₹94,555 (`booking_revenue_split`). Meta spend ₹26,539.
- `bookings.booking_source` is filled on every row (`instagram_ad`, `whatsapp`, `airbnb`, `direct`, `referral`, `instagram_organic`, `website`). It is tagged by hand at entry, not tracked — it is the only channel signal on the booking side.
- Search Console: 101 clicks / 1,162 impressions for 2026-09-26 → 10-23. The key lives ONLY on Aksheev's PC (`.secrets/claude-seo-service-account.json`); a Monday scheduled task does the weekly pull.
- Vercel Web Analytics is NOT a source: `brochure.html` has no Vercel script, and its query API returns 404 for this project.
- 🔴 CLAUDE.md §1's "single-digit real leads per month" is stale — 55 confirmed bookings in 30 days. Update §1.

## 3. Architecture

Same shape as the Meta work (`sync-meta-ads` → `ad_insights` → `meta-dashboard.html`): sync daily into Supabase, page reads Supabase. No live calls to PostHog or Google from the browser, no third-party key anywhere but Supabase secrets.

Rejected alternatives (best-of-3 round):
- *Live proxy edge function per page load* (like `meta-live-snapshot`) — slow page, no history, every partner load spends PostHog query quota. Keep live proxies for data that only exists live.
- *PC scheduled task pushes everything to Supabase* — no key moves to the cloud, but the dashboard goes stale whenever the PC is off. Kept as the GSC fallback only (§5, Phase 3b).
- *A new view inside `views.html`* — one fewer page, but `views.html` is 90 KB and serves four routes; a mistake there breaks bookings/sales/stays/money. Separate file, one hub card.

### 3.1 Tables (one migration)

🔴 Unique visitors do not add across days: 30 daily visitor counts summed ≠ 30-day visitors. So daily rows carry trends, and window rows carry uniques.

| Table | Grain | Columns |
|---|---|---|
| `web_daily` | IST date | visitors, sessions, pageviews |
| `web_event_daily` | IST date × event | people, events |
| `web_window` | window_end × window_days (7/30/90) × kind (`overview`/`source`/`page`/`device`/`event`) × key | visitors (or people), events |
| `gsc_daily` | date | clicks, impressions, ctr, position |
| `gsc_page_window` | window_end × page | clicks, impressions, position |
| `web_sync_runs` | one per run | source (`posthog`/`gsc`), started_at, window, rows, ok, error |

RLS: SELECT for `auth.email() = 'aksh.eeev@gmail.com'` only — identical to `ad_insights`. No anon policy (see memory: hosted-dashboard-rls-constraint). Writes by service role only.

### 3.2 Edge functions

- **`sync-posthog`** — runs the HogQL queries already proven in `scripts/posthog-pull.py` (port them, don't re-invent; production hosts filter, IST windows). Upserts `web_daily`/`web_event_daily` for the last 3 days (late events) and recomputes `web_window` for windows ending yesterday. Secret `POSTHOG_API_KEY`: a NEW personal key, read-only, project 482400 only, named `supabase-sync` — separate from the local one so either can be revoked alone.
- **`sync-gsc`** — signs an RS256 JWT for the service account with WebCrypto, exchanges it for a token, calls `searchAnalytics/query` for the window ending 3 days back (Google's lag). Secret `GSC_SERVICE_ACCOUNT_JSON`. Reuses `gsc-pull.py`'s property and windowing.
- Both: `verify_jwt=false`, header contract copied from `lead-digest` (cron sends no Authorization — CLAUDE.md §2 landmine), reject anything but POST, write a `web_sync_runs` row on success AND failure.
- Cron: `sync-posthog-daily` `40 0 * * *` (06:10 IST), `sync-gsc-daily` `40 3 * * *` (09:10 IST).

### 3.3 Page

`hosted-dashboard/growth.html` → `/growth` (cleanUrls already on). Copy `meta-dashboard.html`'s auth snippet, dark theme and `Promise.allSettled` degrade-per-block pattern. Sections, top to bottom, as in the mockup: freshness chips → attention list → 5 headline numbers → demand path → channels table → top pages + devices → Google search (one panel, small: it's ~58 visitors vs 500+ from Instagram) → definitions footer. Range 7 / 30 / 90. Hub card in `index.html`.

Freshness: chip amber when a source's last OK run is >36 h old, red >72 h. A stale number never renders without its chip.

## 4. Definitions (printed in the page footer)

- Visitor = PostHog unique person, `$pageview`, `$host` in (picnicstories.com, www.picnicstories.com).
- Window = IST calendar days ending yesterday (today is partial).
- Demand-path counts = people who did the step at least once. NOT an ordered funnel until Phase 5 adds one.
- Booking = `confirmed = true`, from `booking_revenue_split`, `excluded_reason is null` (team phones, test names, duplicates already excluded there).
- Channel on the booking side = `bookings.booking_source` as tagged. Visitors and bookings sit side by side; never divide one by the other.
- Spend = `ad_insights.spend_inr`.

## 5. Phases — each ends with a check

| # | Work | Exit condition | Owner |
|---|---|---|---|
| 0 | Decide: move the GSC key into Supabase secrets? Create the `supabase-sync` PostHog key and set both secrets. | Both secrets set, or GSC → 3b. | Aksheev |
| 1 | Migration: 6 tables + RLS. Repo file + `apply_migration`. | `get_advisors` no new finding; a query as anon returns nothing. | Claude |
| 2 | `sync-posthog` + cron + 90-day backfill. | For 2026-10-01→10-29, every `web_window` number equals `posthog-pull.py` for the same window exactly (same HogQL). Failure run writes `ok=false`. | Claude |
| 3 | `sync-gsc` + cron + 16-month backfill (GSC's limit). Spike the WebCrypto JWT first, before anything else in this phase. | Totals equal `gsc-pull.py` for the same window exactly. | Claude |
| 3b | Fallback if Phase 0 says no: Monday task also upserts its pull into `gsc_*` with the service-role key. | Weekly rows land; chip shows the weekly age honestly. | Claude |
| 4 | `growth.html` + hub card + vercel.json untouched (cleanUrls covers it). | Aksheev opens it on an iPhone and on desktop; Claude spot-checks 5 numbers against SQL/HogQL. | both |
| 5 | Ordered funnel for Book online → date picker (Todoist p2 task already open). | Confirms the 130 → 23 drop is real, not a tracking gap. | Claude |

First action: Phase 0, Aksheev's two decisions. Phase 1 can start in parallel; it needs no secrets.

## 6. Risks

| Risk | What breaks | Guard |
|---|---|---|
| Summing daily uniques | Visitors inflated ~2–3× | `web_window` table; page never sums `visitors` across days |
| PostHog loads after idle | Undercounts quick bouncers (non-brochure: PostHog 721 vs Vercel 950) | Stated in footer; compare trends, not absolutes |
| `booking_source` is hand-tagged | Channel revenue only as good as the tagging | Label "as tagged"; Phase 6 idea below |
| GSC key leaves the PC | Wider blast radius if Supabase secrets leak | Aksheev's call in Phase 0; 3b keeps it local |
| Cron Authorization landmine | Every scheduled run 401s silently | Copy `lead-digest` contract; `web_sync_runs` + red chip make it visible |
| Anon read added later "to fix" a page | Customer PII public | RLS admin-only; never add anon SELECT |
| PostHog query limits | Sync fails on backfill | Backfill in 30-day chunks, sequential |

## 7. Parked — worth doing, not now

- **Ref code in the prefilled WhatsApp message** (e.g. `#B7K2` from the PostHog distinct id). The team copies it into the booking; then a WhatsApp tap can be joined to the booking it became. This is the only route to real per-visitor attribution and it would retire the hand-tagged `booking_source` for site traffic. Needs: brochure.js + app.js prefill change, an admin field, and a team habit.
- Adding Vercel's script to `brochure.html` (Todoist p3) — only matters if Vercel numbers are kept at all; this plan doesn't use them.

## 8. Optimizer trail

Rubric (weights): decision clarity 20 · data correctness and definitions 20 · credential safety 15 · feasibility and sequencing 15 · failure handling and freshness 10 · scope discipline 10 · specificity 10.

Scores: 66 (live proxy, GSC as an equal panel, no definitions) → 81 (daily sync to tables, reuse of the Meta pattern, GSC demoted) → 89 (uniques-not-additive fix, separate revocable PostHog key, exit conditions that compare against the existing pull scripts) → 92 (best-of-3: PC-push kept as GSC fallback, views.html rejected) → 92, stopped at plateau.
