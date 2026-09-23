# The Picnic Stories — Claude Working Notes

Read §1–§3 before doing anything. Then jump to the section matching your task. §11 (Definition of Done) gates every task — nothing is "done" until it passes. The full session history lives in `docs/HANDOFFS.md`; only the latest entry is kept at the bottom of this file.

---

## 1. Orientation — what this project is

**Business**: The Picnic Stories (www.picnicstories.com) sells curated picnic setups (time-slot bookings at partner cafes) and stay + celebration-setup bundles (TerraCottage homes) in Gurugram and Jaipur, India. Volume is tiny — single-digit real leads per month. One wrong price, double-booked slot, or broken email is a real business loss. **Correctness beats speed on every task. There is NO staging environment: every DB, RPC, and edge-function change is production the moment it lands.**

**Stack** (vanilla JS, no framework, no frontend TypeScript):

- Frontend: static SPA — `index.html` (public) + `admin.html` (admin panel) + `app.js` (~10,200 lines, ALL logic for both pages) + `style.css` (~250KB). Vite build; then `scripts/prerender-venues.mjs` post-build generates static SEO pages (venue pages, `/picnic-venues-gurugram`, `/picnic-venues-jaipur`, `/blog` + posts, sitemap) into `dist/`.
- Hosting: Vercel, `cleanUrls: true`. Team `team_dLDWAkARaohP22HGIl1DpNnj`, project `prj_WDxIggD0U392TpTM527qqKe9vui0`. Deploys ride on git push.
- Backend: Supabase project `evmftrogyzoudiccqkya` (ap-northeast-1) — Postgres + RLS + RPCs + 11 edge functions + pg_cron. Managed via the Supabase MCP tools (`execute_sql`, `apply_migration`, `get_edge_function`, `deploy_edge_function`, `get_logs`, `get_advisors`).
- Payments: Razorpay — **a single LIVE key pair, no test mode exists in this app** (see §7 red line).
- Email: Resend, sends from `team@picnicstories.com` (edge functions). Admin alerts go to team@ + the venue's team email.
- Analytics: PostHog project 482400 (US cloud); Meta Pixel `1366746648648321`, ad account `565789031303932`.
- Blog content: `content/blog/*.md`, each starting with an HTML-comment SEO SPEC block (title ≤60 / meta ≤155 / slug / published / hero). Parsed by `mdToHtml` in the prerender script — a deliberately constrained markdown subset (`#`–`####`, bold, italic, links, `-`/`1.` lists, `---`). Extend the parser BEFORE using fancier syntax in a post.
- `index.html` "From the blog" card list is HAND-MAINTAINED — update it when `content/blog/` changes.

**Roles**: Aksheev (user) = owner/operator — makes business calls, runs all git commands from his own terminal, eyeballs emails/UI. Claude = engineer — ships nothing without the verification in §11.

---

## 2. Trust order — read before acting on ANY prior claim

1. **Live systems** — SQL via `execute_sql`, `get_edge_function`, cache-busted fetch of the prod site, Vercel deploy list, `git log`. Live state wins every conflict.
2. **Code on disk**, read via the Read tool (never bash — see §3).
3. **This file, `docs/`, memory, handoffs** — hypotheses only. They rot fast, sometimes same-day. A prior session shipped on top of a handoff's false "already live" claims and lost half a day (see `docs/HANDOFFS.md`, 2026-07-14 correcting 2026-07-12).

**Mandatory**: before building on any claim (a fn is at vN, a column exists, a fix is deployed, a doc's status list), probe the live thing itself. Run the `picnic-live-verify` skill first in any session that builds on prior work. Concretely:

- Edge fn version/source → `list_edge_functions` / `get_edge_function` (never the local file).
- Schema/RPC → `execute_sql` against `information_schema` / `pg_proc` (`pg_get_functiondef` for bodies).
- Cron → `select jobname, schedule, active from cron.job;`
- Prod pages → fetch with `?cb=<timestamp>` appended; an un-busted fetch can serve stale cache and has produced a wrong diagnosis before.
- "Was it committed/pushed?" → `git log` (trustworthy) — NOT `git status`/`git diff` (§3).

---

## 3. Sandbox failure modes — why the file/git rules exist

The bash mount **tears large files**: reads of `app.js`, `style.css`, `CLAUDE.md`, and edge-fn `.ts` files can come back cut off mid-token or padded with trailing garbage. This corrupts everything downstream: `cat`, `wc`, `node --check`, esbuild-on-the-mount, `git status`, and `git diff` have ALL reported false results on this repo (both phantom changes and silent omissions).

Hard consequences — no exceptions:

1. **Read large files ONLY with the Read tool.** Never trust a bash read of app.js / style.css / edge `.ts` / CLAUDE.md.
2. **Never run `git add` / `git commit` / `git push`.** A commit from the sandbox could stage a torn file over good content. Always end the session by handing Aksheev a paste-ready git block (see §12). This holds even if he says "commit it" casually — the block runs on HIS terminal.
3. **Never trust `git status`/`git diff` on this repo.** To verify what actually changed: reconstruct a trusted copy of the file via the Read tool, then diff it against `git show HEAD:<file>` (the object store reads correctly even when the working-tree read tears).
4. **To syntax-check or bundle a large JS/TS file**: write a trusted copy (from Read-tool output or the live `get_edge_function` fetch) to `/tmp` inside the sandbox, and run `node --check` / esbuild THERE — never against the mount path.
5. `git status` shows 5 long-standing pending deletions + stray untracked folders (`hyperframes-reel-starter/`, `graphify-out/`, `sets/`, `_temp/`, `~/` …). These predate your session — leave them alone; cleanup is Aksheev's deferred call.

---

## 4. Backend changes (migrations, RPCs, edge functions)

Run the `picnic-backend-ship` skill for any `supabase/` change. The non-negotiable steps, inline in case the skill doesn't trigger:

**Migrations**
- Apply via `apply_migration` AND write the matching `supabase/migrations/YYYYMMDD_name.sql` repo file. Always both, same session.
- Note: only `supabase/migrations/` is the migration home. The loose `.sql` files at `supabase/` root are legacy — don't add there.

**RPC signature changes**
- Changing a signature? `DROP FUNCTION` the old overload explicitly — two overloads make PostgREST calls ambiguous and break the frontend. Prefer leaving an unused parameter in place over changing the signature at all (this is why `submit_booking_intent` still accepts a never-read `p_advance_amount`).
- New/changed RPCs follow house convention: `SECURITY INVOKER` where possible, explicit `SET search_path`, admin-gated ones check a hardcoded admin email from JWT claims. Run `get_advisors` after and explain any new warning.
- Test EVERY branch via a rolled-back `DO $$` block before calling it done:

```sql
DO $$
DECLARE v_result jsonb;
BEGIN
  -- simulate the caller; resolve the real admin email from the fn body via pg_get_functiondef, don't guess
  PERFORM set_config('request.jwt.claims', '{"email":"<admin-email>"}', true);
  SELECT to_jsonb(public.my_rpc(...)) INTO v_result;
  RAISE EXCEPTION 'RESULT %', v_result;  -- RAISE aborts the txn: assertions ride the error message, nothing persists
END $$;
```
- After the test, verify zero residue: `select count(*) from bookings where mobile_number = '<test-phone>';` must be 0.

**Edge functions**
1. Fetch the deployed source via `get_edge_function` FIRST — local files drift from deployed and have been broken-stale before. The live fetch is your editing base, not the repo file.
2. Bundle-check the edited source before deploying: copy to `/tmp` (§3.4), then `npx esbuild /tmp/<fn>/index.ts --bundle --platform=neutral --outfile=/dev/null`.
3. Deploy via `deploy_edge_function`, **preserving the fn's current `verify_jwt` flag**. Check it in `list_edge_functions` first. Trigger/cron-called fns MUST stay `verify_jwt=false` (currently: notify-booking-received, notify-booking-confirmed, notify-menu-link, notify-order-received, export-ical, razorpay-webhook, post-event-nudge, lead-digest). `create-order`, `verify-payment`, `sync-ical` are `verify_jwt=true`. Deploying with the wrong flag silently breaks DB-trigger email delivery.
4. After deploy: sync the local `supabase/functions/<fn>/` files to byte-match what you deployed, and check `get_logs` after the smoke test.
5. Layout quirk: local shared code lives at `supabase/functions/_shared/`; the deploy bundles it beside the entrypoint as `./_shared/*` — deployed import paths use `./_shared/`, local historical files sometimes `../_shared/`. Match the deployed form when deploying.

**The 11 edge functions** (roles): `notify-booking-received` (guest ack + admin alert on every bookings INSERT, via trigger `on_booking_insert_notify`), `notify-booking-confirmed` (confirmation email), `create-order`/`verify-payment`/`razorpay-webhook` (payment flow — create-order reads `bookings.advance_amount` from the DB and charges exactly that), `export-ical`/`sync-ical` (Airbnb availability round-trip), `post-event-nudge` (day+2 thank-you/review email, cron), `lead-digest` (daily 09:00 IST lead email, cron), `notify-menu-link`, `notify-order-received` (legacy order flow).

**Cron jobs** (resolve live before relying — `select * from cron.job`): `lead-digest-daily` 30 3 * * *, `post-event-nudge-daily` 30 4 * * *, `mark-abandoned-leads` 30 20 * * *, `sync-ical-hourly` 0 * * * * (all UTC; +5:30 for IST).

---

## 5. Smoke tests — after every backend deploy

Run the `picnic-smoke-test` skill. Inline essentials:

- Test emails: ALWAYS `aksheevs+<alias>@gmail.com` — never a real customer address, never bare team@ for the guest leg.
- Test rows: insert temp rows via the real path (RPC or trigger-bearing INSERT), verify the fn response/`get_logs`, then DELETE the rows AND all children — `booking_add_ons` and any `venue_availability` fanout rows — and prove it: `count(*) = 0` for the test phone/email. An interrupted cleanup (a 503 mid-delete has happened) must be retried and re-verified, not assumed.
- Admin-notice emails generated by tests land in the team@ inbox — tell Aksheev which ones to ignore.
- Anything user-facing that you can't render (email visuals, UI on a real phone) → verified-logic-but-not-eyeballed; list it as owed-by-user in the handoff.

🔴 **Razorpay red line: NEVER complete a real charge.** Single LIVE key pair; no test mode. UI payment testing stops at opening the checkout modal and dismissing it (dismiss → `ondismiss` → `finishBookingFlow`, which also fires the Meta Lead event). Delete the booking row after. The charge→webhook→`verify-payment` leg can only be proven by real money — that is always Aksheev's explicit call, never yours.

---

## 6. Data model — flag semantics (get these wrong and queries/emails lie)

`bookings` is both the lead table and the booking table. One row per lead/booking; the flags carry the meaning:

- `confirmed = true` — THE truth flag for a real booking. Every "is it booked" query, calendar block, and email eligibility check keys on this.
- `payment_status` — `'paid'` means Razorpay-verified ONLY. Admin-entered/offline-collected bookings stay `'pending'` forever BY DESIGN — never "fix" this, and never use `payment_status='paid'` as the real-booking filter (that bug silently excluded all manual bookings from post-event-nudge once; `confirmed=true` is the filter).
- `customer_intent` — `'query'` (enquiry; set on intent-screen render, before the user clicks anything) vs `'lock'` (chose to book).
- `lead_status` — funnel state: `pending` / `whatsapp_clicked` / `abandoned` (cron-marked) / `confirmed`.
- `entry_source` — `'site'` | `'admin'` (manual entry via admin + Add Booking tab). `send_guest_email=false` or null `email_address` suppresses guest emails (admin alert still sends).
- `checkout_date` present ⇒ stay (per-night occupancy, nudges fire after checkout); absent ⇒ picnic (slot-based on `preferred_date`).
- `package_key`/`package_name`/`package_tagline` — snapshot frozen at booking time, deliberately NO foreign key, so later renames never rewrite history. Old rows have null `package_key` → code paths must fall back gracefully. Never backfill.
- `followed_up_at`/`followup_reason` — lead-digest bookkeeping. "Mark lead #NN followed up" = `UPDATE bookings SET followed_up_at=now(), followup_reason='…' WHERE id=NN;`
- `external_booking_ref` — free-text attribution/reference (e.g. `IG-ad`, `IG-organic`, Airbnb ref).
- Legacy gap: rows before 2026-07-08 have no `total_amount`; email code reconstructs old totals as `advance × 2` (50% was the historical rate) — that fallback is intentional history, don't "fix" it to 30%.

**Venue types** (`venues.type`): `cafe` (picnics; slots checked against `max_concurrent_setups`), `self_managed` / `partner_bnb` (stays; per-night occupancy in `venue_availability`, some iCal-synced), `combo` (whole-home parent — booking it fans out blocks to child venues via `parent_venue_id` and vice versa; e.g. Sienna 17 = parent of Umber 15 + Ochre 16), `custom` (customer's own address).

**IDs are traps — resolve live, every time** (`select id, name, type, is_active from venues;` / same for `add_ons`): venue names have been renamed and duplicated (ids 1–13 are mostly inactive legacy; two "House of Amer" rows — 23 stay vs 24 cafe; two "Skyshots" add-ons — 27 active, 10 dead; a stale note once pointed at 29 which is actually Movie Screening). Never take a venue/add-on id from a doc, memory, or this file.

**Related tables**: `booking_add_ons` (children of bookings; `price_at_booking` snapshot), `venue_add_ons` (which add-ons a venue offers), `packages` + `package_add_ons` (tier definitions: `setting`/`moment`/`story` universal + occasion packages like `date_night_classic`), `venue_packages` (per-venue package pricing), `venue_availability` (nightly blocks; `source` = admin/ical/parent). Full schema: `docs/schema.md` (verify before relying).

---

## 7. Pricing — one source of truth

- The advance percentage lives ONLY in the `compute_booking_advance` RPC (currently 30%). Never hardcode a rate in frontend, emails, or another fn. History: a hardcoded 50% in `submit_booking_intent` silently overcharged every customer for weeks (fixed 2026-07-15) — this rule exists because of that.
- `compute_booking_total` is the total's single source (venue/package/guests/nights/add-ons). `create-order` charges whatever `bookings.advance_amount` says — so the stored value IS the money.
- Admin flows (`admin_add_manual_booking`, admin confirm-query) take admin-entered totals verbatim — no formula, don't add one.
- Any price shown in UI or email must be traceable to those RPCs or to a stored snapshot column — never re-derived with local arithmetic.

---

## 8. Funnel / lead queries

Run the `picnic-lead-ops` skill for lead/funnel/booking questions. Standing exclusions (apply to EVERY count, always):

- Team phones: `7742363777` (Aksheev), `7425055501` (Adhiraj).
- Names starting "Test".
- Phone+date duplicates of a confirmed row (same person re-entering; count once).
- n is tiny (~3–7 real leads/60d) — report every rate as directional with n stated, never as a KPI.

---

## 9. Frontend / build / verification of public pages

- Dev server `npm run dev` → `:5173` serves the SPA ONLY. Prerendered routes (`/blog`, city pages, venue pages) do NOT exist there — SPA fallback to the homepage is EXPECTED, not a bug. Verify prerendered output via `npm run build && npm run preview` → `:4173`, or on prod. (Sandbox can't run the real build — needs live creds; treat sandbox builds as untrusted anyway per §3.)
- Prod page checks: always cache-bust (`?cb=<ts>`). "Not visible on localhost" has twice been a stale build/cached page, not a code problem — hard-refresh and check 5173-vs-4173 before suspecting code.
- app.js edits: the file is one giant ESM module; admin form code is the `abk`-prefixed module; occasion deep-links validate against the `OCCASIONS` table in app.js. After editing, machine-parse a trusted copy (§3.4) — Read-tool review alone is not a parse.
- CSS: admin add-booking styles are the `.abk-` block in style.css; blog homepage cards use inline `bhs-` styles in index.html deliberately (don't migrate them into style.css without being asked).
- Mobile checks: Chrome-MCP `resize_window` does NOT actually resize (reports success, width unchanged) — use real-phone screenshots from Aksheev or CSS-source reading instead.

---

## 10. Skills — invoke automatically, don't wait to be asked

- Session builds on prior work / any doc-or-handoff claim is load-bearing → `picnic-live-verify` FIRST.
- Any change under `supabase/` → `picnic-backend-ship`.
- Right after any backend deploy, or "test it live / verify the email fires" → `picnic-smoke-test`.
- Leads, funnel, bookings, conversion, "mark lead #NN followed up" → `picnic-lead-ops`.
- Session wrapping up (user says done, or context running low) → `picnic-session-handoff` proactively.
- GSC / Search Console / impressions / clicks / positions / "how is SEO doing" → §10a below. 🔴 Do NOT invoke `claude-seo:seo-google` — its keywords match, but it wires the ephemeral cloud container and ends with the user re-uploading a private key.

If a skill fails to load, §4/§5/§8/§12 above carry the critical steps — follow them.

### 10a. Pulling Search Console data (set up 2026-09-09)

Run on the USER'S machine via `device_bash`, never in the cloud container:

```
python3 -m pip install --quiet google-auth      # ~20s, gone each session, just redo it
python3 scripts/gsc-pull.py --days 28 --dim query
```

Key lives at `.secrets/claude-seo-service-account.json` — gitignored, and `.githooks/pre-commit` blocks it by path AND by content. Never ask the user to upload it; the script finds it. Never move it, never print it, never stage it.

`--dim` takes `query|page|date|device|country` (comma-separate to cross). `--out docs/gsc/gsc-YYYY-MM-DD.json` saves a pull for later comparison. Window ends 3 days back by default (GSC reporting lag) so two runs are comparable.

A weekly scheduled task ("GSC weekly dashboard", Mondays 09:30 IST, bound to this computer) already does the pull, the rebuild and the republish. To do it by hand:

```
python3 scripts/gsc-dashboard.py                                               # standalone HTML
python3 scripts/gsc-dashboard.py --artifact --out docs/gsc/dashboard.artifact.html
```

🔴 The dashboard is ONE artifact — URL in `docs/gsc/ARTIFACT.md`. Always pass it as the Artifact tool's `url`; publishing without it forks the history into a second artifact.

🔴 Read output with `docs/SEO_PLAN_2026-09-08.md` §4 in hand: the scoreboard is non-brand non-venue clicks/28d, NOT site totals; never quote site-level average position (mix-shift artifact); always state the printed COVERAGE % before quoting any percentage split.

---

## 11. Definition of Done — no task is finished until this passes

Walk this list explicitly before reporting completion. Anything failing → the task is NOT done; label it honestly (see §12 labels).

**Every task**
1. The claim you're making was verified against the LIVE system this session (not inferred from docs/memory/earlier-in-session state).
2. Zero test residue: test rows + children deleted, `count(*)=0` proven; no stray files.
3. Repo synced to reality: migration files written, edge-fn local files match deployed, docs updated if your change falsified one of their claims.
4. UNCOMMITTED file list assembled + paste-ready git block handed over (you never run git).
5. Anything you couldn't verify (visual email polish, real-phone UI, a branch not exercised) is listed as owed-by-user — not silently dropped.

**Backend change** — additionally: esbuild bundle check passed (edge fn) or DO-block branch tests passed (RPC); `verify_jwt` preserved; smoke test through the REAL path (trigger/cron/RPC, not a shortcut) returned the predicted response; `get_logs` clean; `get_advisors` checked for new warnings.

**Frontend change** — additionally: trusted-copy machine parse passed; behavior confirmed on `:4173`/prod for prerendered routes (or explicitly handed to user as a browser-eyeball item).

**Data/funnel answer** — additionally: §8 exclusions applied; n stated.

---

## 12. Session handoffs

Run `picnic-session-handoff` at session end. Format contract:

- Absolute dates only ("2026-07-16", never "yesterday").
- Label EVERY claim: **SHIPPED-verified** (live-probed this session) / **built-unverified** (written but not proven live) / **NOT-done**. The 07-12→07-14 incident is what happens when this is fuzzed.
- End with: UNCOMMITTED file list, paste-ready `git add/commit/push` block, and a CONTINUE FROM line.
- Rotation: write the new entry as "Latest Session Handoff" below; move the previous latest to the TOP of `docs/HANDOFFS.md`. This file keeps exactly one handoff entry.

---

## 13. Todoist — every deferred item goes here, always

**Anything we decide not to do now goes into Todoist before the conversation moves on.** Not into prose, not into a handoff bullet, not into "worth doing later" in a chat message. Those die. Tasks don't.

This applies to work in progress too: track what we're doing, not only what we're deferring.

- **`Picnic Webapp`** (id `6hPG6cjHF8PHHWgG`) — dev + ops for this repo. Sections: `To Do` / `In Progress` / `Done`.
- **`Picnic Stories`** (id `6hPGH7jfr55GMH6J`) — business-wide (ops, marketing, SEO, bookings).

Write the description so it is actionable months later by someone with no memory of the session: what to change, which file and line, why it matters, and what breaks if it is skipped. A task that just says "fix images" is worthless. Include the numbers that justified the priority.

Useful labels so far: `egress`, `phase-c`, `monitoring`, `billing`, `cleanup`.

Priorities: `p1` = protects the live site or prevents a repeat outage; `p2` = verification with a deadline; `p3` = real but latent waste; `p4` = housekeeping.

---

## 14. Images — the sm/lg variant pipeline (set up 2026-09-07)

Storage serves **pre-encoded variants**, not originals. Do not point new code at an original path.

- `opt/sm/<name>.webp` — 800px longest edge, WebP q78, ~56KB average
- `opt/lg/<name>.webp` — 1600px longest edge, WebP q78, ~138KB average
- Originals are retained, untouched, at their original keys. They are the re-encode source and the rollback.
- All variants carry `cacheControl: 31536000`. The old `max-age=3600` default was making returning visitors re-download everything hourly.

**Where each size belongs:**

| Surface | Field | Variant |
| --- | --- | --- |
| Venue/package card carousels | `img.thumb \|\| img.url` | sm |
| Venue detail gallery thumbs | `img.thumb \|\| img.url` | sm |
| Venue detail hero, click-to-enlarge | `img.url` | lg |
| `add_ons.image_url` | single column | sm |

`venues.images` and `packages.images` carry both: `url` = lg, `thumb` = sm. `thumb` was added additively, so code that ignores it still works — **always fall back `img.thumb || img.url`**, because inactive-venue refs have no `thumb`.

**Do not revert `carouselSlidesHtml` / `hydrateCarouselSlides` to eager slides.** The carousel tracks are `display:flex` with each slide at `flex: 0 0 100%`, so every slide sits inside the browser's lazy-load margin — `loading="lazy"` is present and *inert* there. With the 4.5s auto-advance, eager slides pulled ~75 distinct images (~55MB) per 2-3 minute visit. Slides beyond index 0 carry `data-src` and hydrate through `*CarouselGoTo`, which every nav path (dots, arrows, swipe, auto-advance) routes through.

**Why this exists:** cached-egress overrun restricted the entire project on 2026-09-06 — HTTP 402 on storage, REST *and* auth for ~6 hours, with no warning email (the grace period was already spent). Measured result after the fix: a real phone session went from 55-62MB to **1.57MB**.

Pipeline: `scripts/upload-optimized-images.mjs` (env-var service key, dry-run by default) + `supabase/migrations/20260907_repoint_images_to_optimized_variants.sql` (rollback SQL in its header). Rollback table: `public.image_refs_backup_20260907`.

⚠️ **Enumerating images under the anon key silently misses rows.** `anon_select_add_ons` filters `is_active = true`, which is how add-on 31 got skipped. Use the service-role key for any pipeline re-run.

---

## Latest Session Handoff — 2026-09-23 (Hosted Meta Ads dashboard: Phases 1–3 now SHIPPED-verified and live-reconciled, not just built. City columns on `booking_revenue_split` live; `sync-meta-ads` v4 + `meta-live-snapshot` v3 deployed with a working Meta System User token, smoke-tested through the real invocation path, and cross-verified against the Meta Ads connector to an exact match. `hosted-dashboard/hub.html` + `ads.html` still written but never rendered in a browser by anyone.)

🔴 **Correction to two repeatedly-documented house claims, both proven stale by direct testing this session — update anywhere else they appear:**
1. **`deploy_edge_function` CAN be called from this Cowork session.** CLAUDE.md §4, `docs/HOSTED_DASHBOARD_PLAN.md`, and `docs/META_ADS_DASHBOARD_PLAN.md` all asserted it cannot (citing a 2026-09-03 schema/Zod validation failure). Attempted it live per §2's own verify-before-trusting-a-doc-claim rule — it worked, four times, including with `_shared/` files and both `verify_jwt` values. Do not defer future edge-function deploys to "needs the Dashboard" without re-testing first.
2. **A campaign's `optimization_goal` is NOT a valid field on the Graph API campaign node or `/campaigns` edge.** Requesting it returns 200 with the field silently absent (no error) on the edge, and an explicit `(#100) Tried accessing nonexisting field` error on a single campaign node. It only exists on **ad sets**. Any future Meta integration work that wants a campaign's optimization goal must roll it up from `act_<id>/adsets?fields=id,campaign_id,optimization_goal` — see `fetchCampaignGoals()` in both edge functions below. This caused a real shipped-but-silent bug this session (see below) — worth remembering before it recurs.

**SHIPPED-verified — confirmed live and reconciled this session**

- **Phase 1** — `booking_revenue_split` extended with `venue_city`/`city` (migration `20260923_booking_revenue_split_add_city.sql`). `get_advisors` clean.
- **Phase 2** — `sync-meta-ads` deployed and live (v4, `verify_jwt=false`), plus its cron (`sync-meta-ads-daily`, `20 5 * * *`, confirmed active via `cron.job`). Smoke-tested via the exact cron header shape (`Content-Type` only, no `Authorization`) — `{"ok":true,"rowsUpserted":30,"campaigns":36,"alarms":0}`. `ad_insights` and `ad_sync_runs` populated and correct.
- **Phase 3** — `meta-live-snapshot` deployed and live (v3, `verify_jwt=true`). Confirmed the platform-level JWT gate actually rejects unauthenticated calls (`401` with no Authorization header). Not yet called with a real session JWT — no authenticated smoke test performed, since that needs a live partner browser session (owed, see below).
- **The Meta token is live and working.** Aksheev generated a System User token (Business Manager `1549685876475913`, ad account `565789031303932`) with `ads_management`/`ads_read`/`business_management`, set it as the `META_ACCESS_TOKEN` secret (shared by both functions), and both are reading real data.
- **`get_advisors` (security) re-checked post-deploy: zero new findings.** All 20 existing findings predate this session (search_path, SECURITY DEFINER exposure, leaked-password-protection) and are unrelated to anything touched here.

**A real accuracy bug was found, root-caused, and fixed — two rounds**

The `results`/`result_indicator` field this build computes per campaign was initially wrong. Root cause, found by reconciling `ad_insights` against the Meta Ads connector's own `ads_get_ad_entities` (the account's true source of "Results" as shown in Ads Manager):

- **Round 1 (wrong assumption, shipped as v2/v1, self-caught before being reported as done):** `pickResult()` picked "the action_type with the highest raw count that day" — always `post_engagement`, since it has the biggest raw number. Wrong for CONVERSATIONS-goal campaigns; the connector's real indicator is `onsite_conversion.messaging_conversation_started_7d`.
- **Round 2 (the actual fix, v3/v2 → v4/v3):** First attempt added an `optimization_goal`-based lookup, but read the goal from the **campaign** edge — which silently drops that field (see the house-claim correction above), so `meta?.optimization_goal` was always `undefined` and the "fix" was a no-op; v3/v2 still showed the old wrong numbers when re-reconciled. Root-caused by testing the Graph API directly (`curl` against a single campaign node → explicit "nonexisting field" error; against the `/adsets` edge → works, both target campaigns' ad sets consistently report `CONVERSATIONS`). Real fix: `fetchCampaignGoals()` in both functions now reads `act_<id>/adsets?fields=id,campaign_id,optimization_goal` and rolls it up to a campaign_id → goal map, which is what actually gets passed into `pickResult()`.

**Final reconciliation (v4/v3, post-fix, re-synced and re-checked against the connector):**

| Campaign | Sync `results` | Connector `results` | Sync spend | Connector spend |
|---|---|---|---|---|
| F Jaipur | 292 (via `messaging_conversation_started_7d`, 8/9 days) | 292 | ₹4,151.96 | ₹4,151.96 |
| NCR (Claude - Proposals & Romance) | 730 (via `messaging_conversation_started_7d`, 18/21 days; 2 days fell to `total_messaging_connection`, 1 day to a max-count fallback — correct behavior on days that action didn't fire) | 728 | ₹11,950.85 | ₹11,950.87 |

Both match to the rupee (sub-paisa rounding only) and within 2 results out of 728–730 (accounted for by the fallback correctly firing on the handful of days the primary action type had zero events). This is now a trustworthy number, not the earlier silently-wrong one.

**NOT done — owed**

- 🔴 **`hosted-dashboard/hub.html` and `ads.html` have still never been opened in a browser by anyone.** Backend is now solid; the frontend is unverified per CLAUDE.md §9/§11.
- **`meta-live-snapshot` has no authenticated smoke test.** Confirmed the JWT gate rejects an unauthenticated call; have not yet confirmed a real session JWT gets a correct response — needs a real partner login via `ads.html` or a manually-obtained session token.
- **Phase 2b (90-day backfill)** — only the default trailing-30-day sync has run. `{"since":"2026-06-01","until":"today"}` POST body not yet tried.
- **Phase 2's regression replay (2026-07-24 → 2026-09-02, expected ₹0 throughout + alarm trigger)** not yet run.
- **Phase 5 (access lockdown)** and **Phase 6 (Morning-brief watchdog line, still blocked — no matching scheduled task found)** unchanged from before — still Aksheev's call / still blocked.
- Everything else carried forward from the original Phase 4 handoff (below, superseded in status but kept for full context) remains open: picnic_stay email rendering, `staff_today`, the cross-venue conflict question, TerraCottage picnic twins, Airbnb prices (now well overdue), Jaipur workbook, `#REF!` header, booking #61, `guest_count` on 81–89, `bb2a81f`, `_shared/venue.ts:29`.

**Facts established this session — do not re-derive**

- 🔴 **`optimization_goal` lives on ad sets, not campaigns — see house-claim correction above.** Any future code reading it from a campaign object will silently get `undefined`.
- **`deploy_edge_function` works from Cowork — see house-claim correction above.** Re-verify with a real attempt before writing "needs the Dashboard" into any future doc.
- **This account's two spending campaigns (NCR, F Jaipur) both optimize for CONVERSATIONS with a single consistent goal across all their ad sets** — confirmed live, not assumed. `fetchCampaignGoals()`'s "first goal seen" simplification is safe for this account today, though it would need revisiting if a campaign ever has genuinely mixed ad-set goals.
- **`ad_insights.results` sums by day/action_type as separate rows when the winning action type differs across days within a campaign** — this is expected and correct, not a bug; the leaderboard/KPI code on `ads.html` should sum `results` across all rows for a campaign, not assume one `result_indicator` per campaign.

**ADDENDUM — same session, after Aksheev pushed and opened `ads.html` in a real browser for the first time**

The push went through and the `picnic-dashboard` Vercel project (a **pre-existing project** at `picnic-dashboard-nu.vercel.app` I hadn't accounted for — its root directory is `hosted-dashboard/`, and it already had its own `index.html`, an unrelated occupancy dashboard predating this work; `/hub.html` and `/ads.html` are new sibling files, not at `/`) redeployed automatically. `hub.html`/`ads.html` render — but on `ads.html`, Pixel funnel / Ad sets / Audiences all showed **"Live Meta data unavailable: Failed to fetch."**

🔴 **Real, separate bug from the optimization_goal one — CORS was entirely missing from `meta-live-snapshot`.** No response, including the `OPTIONS` preflight, carried any `Access-Control-*` header. A browser blocks a cross-origin fetch whose preflight lacks `Access-Control-Allow-Origin`, and reports it to JS as a generic `TypeError: Failed to fetch` — which is exactly the stale placeholder error text the page showed, coincidentally pointing at the wrong cause (the function was deployed and the token was set; neither of the error message's two guesses was right). `curl` never showed this because `curl` doesn't enforce CORS.

**Worse, this doubled as a real data-exposure bug**: the function had no HTTP-method check at all, so the OPTIONS preflight — which browsers never send credentials on — ran the FULL business logic and returned live Meta data with a 200, unauthenticated. Confirmed live before fixing: `curl -X OPTIONS .../meta-live-snapshot?section=funnel` with no Authorization header returned real (if currently-empty) pixel data. `verify_jwt=true` exempts OPTIONS from its own JWT check (confirmed live too — that's a Supabase platform behavior, not a bug in this function), so nothing upstream was catching this.

**Fixed and deployed (v4):** `OPTIONS` now short-circuits to a bare `204` before any Meta call or token check; every real response carries `Access-Control-Allow-Origin: *` (deliberately wildcard — `verify_jwt=true` still gates the actual GET/POST at the platform level, so CORS here only controls what a browser will *read*, not what data is reachable; this is Supabase's own documented pattern). Re-verified live post-deploy: OPTIONS → clean `204` with CORS headers, no body; unauthenticated GET → correct `401` from the platform gate, now *with* CORS headers so the browser can actually see and report that 401 instead of swallowing it as an opaque failure.

**ADDENDUM 2 — `ads.html` rewritten as a port of the Cowork artifact (same session, 2026-09-23)**

Ask: "the meta ads dashboard exactly like the one in the artifact, same defaults and chart styles." `hosted-dashboard/ads.html` is now a line-for-line port of `C:\Users\akshe\OneDrive\Documents\Claude\Artifacts\meta-ads-dashboard\index.html`: same dark theme CSS, "Ad Pulse" masthead, attention list, overview cards, active campaigns + Lead gates, spend-vs-bookings with lag scan (defaults **Both cities · 30d**, ranges 30/60/90/All), blended efficiency MER + ads-off holdout, pixel funnel + attribution check, ad sets, audiences, sortable lifetime leaderboard, static revenue baseline. Hosted-only additions: sign-in screen (dark), a top nav (← Dashboards / sign out). Attention items from range-dependent blocks are re-raised on every toggle (the artifact only ever rendered its first view). Keep the two files visually in lockstep.

- **SHIPPED-verified — `meta-live-snapshot` v5**: new `campaigns` (ACTIVE, last_14d, with `leads` = the `lead` action) and `lifetime` (all 36 campaigns, date_preset=maximum, objective/created_time) sections; audiences now returned unfiltered (page applies the artifact's filter). Data logic run locally under Deno against the live Graph API before deploy — all 5 sections OK.
- 🔴 **SHIPPED-verified — real funnel bug fixed**: `/{pixel}/stats` returns hourly buckets with events nested one level down; v1–v4 read the top level and always returned `totals: {}`. Now 815 PageView / 1,292 ViewContent / 34 InitiateCheckout / 14 Contact / **0 Lead** (14d).
- 🔴 **SHIPPED-verified — real exposure closed**: `verify_jwt=true` only proves a validly-signed JWT, and the **public anon key is one** — v4 returned live audience data to `Bearer <anon key>`. v5 resolves the caller via `/auth/v1/user` and requires `aksh.eeev@gmail.com` (same email as RLS). Live: anon → 403, no auth → 401, OPTIONS → 204. **Lesson: `verify_jwt=true` is never an authorization check on its own in this project.** The admin-success branch is NOT exercised (needs Aksheev's session).
- **SHIPPED-verified — `sync-meta-ads` v5**: delivery-alarm guard — the alarm only runs when the run's window covers the completed days it checks. Without it, any historical backfill would have emailed team@ a false "₹0 spend" alarm for every ACTIVE campaign.
- **SHIPPED-verified — Phase 2b backfill + regression replay**: six 30-day chunks 2026-03-27 → 2026-09-23, 0 failed runs, 0 alarms. `ad_insights` = 179 rows / 12 campaigns / **₹71,523.10, exactly equal to Meta's account-level spend for the same window**. The 2026-07-25 → 08-24 chunk returned **0 rows** and there are 0 spend-days in 07-25 → 09-02 — the known dark window, reproduced.
- **built-unverified — `ads.html`**: `node --check` on the extracted script passes; rendered in jsdom with the real v5 response + synthetic daily rows: zero runtime errors, every section fills, toggles re-slice correctly. **Never opened in a real browser.** Lifetime `results` for engagement-goal campaigns come from goal-based `pickResult`, not the connector — unreconciled (Meta connector was disconnected by then). Todoist: "Eyeball hosted /ads.html against the Cowork Meta Ads artifact" (p2).
- **Live business finding — Todoist p1**: 0 pixel Lead events in 14 days against 34 InitiateCheckout. The Lead gates can never leave "Gathering n=0" until this is resolved.
- `hub.html` is still the light theme, so it now mismatches `ads.html`. Not asked; left alone.
- Deployed-vs-local byte match: both functions were deployed from content composed from the same text as the repo files, but **not re-diffed via `get_edge_function`** after deploy.

**Still not verified**: an actual authenticated call through a real browser session — I can 401-test and OPTIONS-test from curl, but confirming a logged-in `ads.html` session gets real funnel/adset/audience data back needs Aksheev to reload the page.

**UNCOMMITTED**: `CLAUDE.md`, plus the files already listed as uncommitted in the git block below (unchanged from before this update — the fixed `sync-meta-ads/index.ts` and `meta-live-snapshot/index.ts` are part of that same uncommitted set, now with both the goal-lookup fix and the CORS fix included; `meta-live-snapshot` is deployed at v4, one version ahead of what a fresh `git show HEAD:supabase/functions/meta-live-snapshot/index.ts` would show until this commit lands).

```
git add CLAUDE.md docs/HANDOFFS.md docs/HOSTED_DASHBOARD_PLAN.md docs/META_ADS_DASHBOARD_PLAN.md supabase/migrations/20260923_booking_revenue_split_add_city.sql supabase/migrations/20260923_sync_meta_ads_daily_cron.sql supabase/functions/sync-meta-ads/index.ts supabase/functions/meta-live-snapshot/index.ts hosted-dashboard/hub.html hosted-dashboard/ads.html
git commit -m "Hosted Meta Ads dashboard: sync-meta-ads + meta-live-snapshot deployed and reconciled (v4/v3), optimization_goal-from-adsets fix, city columns on booking_revenue_split (live)"
git push
```

CONTINUE FROM: **Aksheev** — (1) push this branch; (2) open `hub.html` → `ads.html` in an actual browser at a real screen width — nobody has seen either render, and `ads.html` reads from `ad_insights`/`ad_sync_runs` which are now populated with correct data, so this is the first real chance to see it work; (3) decide Phase 5 access model; (4) locate the real Morning-brief scheduled task or confirm it doesn't exist; (5) Airbnb prices still overdue. **Claude** — (a) once `ads.html` is opened, fix whatever it gets wrong on first real render; (b) run the Phase 2b 90-day backfill and the regression replay; (c) get an authenticated smoke test of `meta-live-snapshot` (via a real login through `ads.html`, once that's viewable); (d) picnic_stay email rendering and other pre-existing carry-forwards.

---

### Superseded — original Phase 4 handoff text (kept for the items above that are still open)

Hosted Meta Ads dashboard planned and built through Phase 4: city columns on `booking_revenue_split` shipped live; `sync-meta-ads` + `meta-live-snapshot` edge functions + the daily cron written and bundle-checked; `hosted-dashboard/hub.html` + `ads.html` written and syntax-checked. Also fixed the Cowork Meta Ads Dashboard artifact's spend=0 bug and added a city filter to it.

The 2026-09-14 entry (`picnic_stay` booking type shipped end-to-end) is now at the TOP of `docs/HANDOFFS.md`.

**Why this session happened**: the Cowork Meta Ads Dashboard artifact only works inside Cowork (`window.cowork.callMcpTool` has no equivalent in a browser), so it can't be handed to a partner. The ask was to get equivalent reporting onto a URL any partner can open. Separately, a pre-existing but never-built spend-control plan (`META_ADS_DASHBOARD_PLAN.md`, 2026-09-05: delivery alarm, runway, blocked on a Meta token) already covered half of the same ground — absorbing it rather than running two Meta-data efforts was an explicit decision (see `docs/HOSTED_DASHBOARD_PLAN.md`, written this session via the plan-optimizer loop, rubric→score 76→critique→91→critique→94→plateau→stop).

**Artifact fixes — SHIPPED-verified (Cowork artifact `meta-ads-dashboard`, not this repo)**

- **Ad spend was showing ₹0 everywhere.** `amount_spent` (and a few other money fields) come back from the Meta connector in two different shapes depending on the call — a plain string `"₹408.59 INR"` OR an object `{value:"9085.79", unit:"INR"}`. The artifact's `num()` helper only handled the string form; the object silently stringified to `"[object Object]"`, stripped to `""`, and read as 0. Every spend figure on the dashboard runs through this one function. Fixed by unwrapping `.value` recursively, same pattern `resultVal()` already used for `results`. Verified against live data (₹15,514 actual 30-day spend vs. 0 shown before the fix).
- **Added a Both cities / Gurugram / Jaipur toggle** to the Spend-vs-bookings block, defaulting to Both + 30 days, after confirming by reading the code that the chart previously blended both cities with no way to split them. Classification: campaign name regex `/jaipur/i` → jaipur else gurugram; bookings joined to `venues.city` the same way. Delhi's one lifetime booking folds into gurugram (the only NCR campaign targets both) — this convention is now also documented in the repo (see below).

**Repo work — built-unverified. Nothing in this list has been deployed or rendered.**

- **`public.booking_revenue_split` extended with `venue_city` + `city` columns** (migration `20260923_booking_revenue_split_add_city.sql`) — **SHIPPED-verified**, this one piece is actually live. Deviated from the plan doc's original wording (a separate `picnic_revenue_by_city_day` view) in favor of extending the existing canonical view in place — one `venues` join to keep in sync, not two. `get_advisors` shows no new finding; spot-check over the trailing 180 days: 22 Gurugram / 5 Jaipur confirmed bookings, ₹303,163 / ₹54,600 picnic revenue, right order of magnitude against the artifact's prior inline query. `security_invoker = true` preserved.
- **`supabase/functions/sync-meta-ads/index.ts`** — daily historical sync from the Graph API directly (never the MCP connector — its `amount_spent` is a formatted string, exactly the bug just fixed in the artifact). Pages `paging.next` to exhaustion (the plan's own flagged single-most-dangerous bug), upserts on `(campaign_id, date)`, runs the delivery alarm (ACTIVE + ₹0 spend across 2 completed days → email team@) using the same run's own data rather than a second fetch. `verify_jwt=false`, **no `CRON_SECRET`** — copies `lead-digest`'s exact header contract on purpose (see CLAUDE.md §2, the cron-sends-no-Authorization landmine). Bundle-checked against a `/tmp` mirror with `_shared/resend.ts` as a child (esbuild passed). **Not deployed** — `deploy_edge_function` still can't be called from Cowork; needs the Dashboard.
- **`supabase/functions/meta-live-snapshot/index.ts`** — new function, browser-facing, `verify_jwt=true`. Proxies the three live-only Meta reads the artifact already proved work (14-day pixel funnel via `{pixel}/stats`, ad-set frequency/fatigue for active campaigns, custom audience sizes), each cached in-memory ~7 minutes so simultaneous partner page-loads don't multiply Graph API hits. Exists specifically so the Meta token stays in exactly one place (Supabase secrets, shared with `sync-meta-ads`) and never gets duplicated into a Vercel env var — this was the credential-minimization fix made during the plan's own critique round. Bundle-checked, esbuild passed. **Not deployed.**
- **`supabase/migrations/20260923_sync_meta_ads_daily_cron.sql`** — **SHIPPED-verified**, the cron job itself is live (`select * from cron.job` confirms `sync-meta-ads-daily`, `20 5 * * *`, active). 🔴 It will 404/error on every fire until the function above is actually deployed — harmless (nothing downstream reads `ad_insights` yet outside this new build), but expect `cron.job_run_details` to show failures until Aksheev deploys.
- **`hosted-dashboard/hub.html`** — new shared-login homepage, reusing `index.html`'s exact auth snippet (same Supabase project, same anon key, same `ALLOWED = ['aksh.eeev@gmail.com']` gate — confirmed live via `pg_policies` that every table this build reads, `bookings`/`venues`/`expenses`/`ad_insights`/`ad_sync_runs`, is keyed to that same admin email). Two cards linking to `index.html` and `ads.html`. Does not touch `index.html`.
- **`hosted-dashboard/ads.html`** — new page: delivery-status band (ACTIVE campaigns with days-since-last-spend, colour-coded), last-synced badge from `ad_sync_runs`, 90-day spend-vs-bookings sparkline with the same city toggle as the artifact, an ads-on/ads-off behavioural split (explicitly labeled not-attribution, per `META_ADS_DASHBOARD_PLAN.md` §1's click-to-message finding), pixel funnel / ad-set fatigue / audiences via `meta-live-snapshot`, and a lifetime campaign leaderboard from `ad_insights`. 🔴 **Runway card intentionally omitted** — the plan's balance/`spend_cap` curl check was never run (no token available this session); adding it back needs that check first, per the plan's own "drop the card rather than fake a number" rule. Every live-data block degrades independently (`Promise.allSettled`-style) so a `meta-live-snapshot` failure doesn't blank the page — which matters today, since that function isn't deployed yet.
- Both new HTML files pass a Python HTML well-formedness check and a `node --check` on their extracted inline `<script>` blocks. **Neither has been opened in a browser by Claude or Aksheev** — CLAUDE.md §9/§11's own standing complaint ("every dashboard shipped here was never seen rendering") applies again until someone does.
- `docs/HOSTED_DASHBOARD_PLAN.md` updated in place with a phase-by-phase status table and the Phase 1 deviation note, rather than left as the original "not started" proposal.

**NOT done — owed**

- 🔴 **Nothing is deployed.** `sync-meta-ads` and `meta-live-snapshot` exist only as repo files until Aksheev deploys both via Supabase Dashboard → Edge Functions, **and** sets `META_ACCESS_TOKEN` / `META_AD_ACCOUNT_ID` (shared by both) / `META_PIXEL_ID` (optional, defaults to the live pixel) as secrets **before** anything reads them — the cron is already firing and will 500/404 until then. Phase 0's own blocking question — does a Meta System User token already exist in Business Manager `1549685876475913` — was asked twice this session and deferred twice ("Not sure / check for me later"). Without it, Phase 2/3 cannot be tested even after deploying.
- **Phase 5 (access lockdown)** — entirely Aksheev's call, deferred both times asked (custom domain + SSO-off, vs. Vercel team invites keeping SSO on). Until decided, `hub.html`/`ads.html` inherit whatever Vercel SSO setting `picnic-dashboard` already has, same as `index.html` today.
- 🔴 **Phase 6 (watchdog line in the Morning brief) is BLOCKED, not just undone.** Both this plan and the original `META_ADS_DASHBOARD_PLAN.md` name a scheduled task `trig_01GbrmkjMWdRDcPfW9GLXCm1`, weekdays 08:00 IST. `list_scheduled_tasks` in this session shows 10 tasks and **none of them match** — no ID like that, nothing named or described as a Morning brief. Per CLAUDE.md §2, did not chase this further on a stale doc claim; needs Aksheev to locate the actual task, if it exists on a different scheduling surface, before this phase can move.
- The Cowork artifact fixes (spend=0, city filter) are live in the artifact but **not reflected anywhere in this repo** — that's expected, the artifact and this repo are separate surfaces, noted only so a future session doesn't go looking for that diff here.
- Carried forward, untouched this session (see the 2026-09-14 entry now at the top of `docs/HANDOFFS.md` for full detail): picnic_stay rendering in `notify-booking-confirmed`/`notify-booking-received`; `staff_today` day-of view; the cross-venue conflict question for picnic_stay; TerraCottage picnic twins; Airbnb prices (overdue); Jaipur workbook; the `#REF!` Airbnb header; booking #61's bad date; `guest_count` on 81–89; `bb2a81f` unreviewed; `_shared/venue.ts:29`.

**Facts established this session — do not re-derive**

- 🔴 **`num()`-style money-field unwrapping is a recurring bug class, not a one-off.** Any Meta connector field that can return `{value, unit}` instead of a plain string will silently zero out through a helper that only expects strings. Worth an audit pass across the artifact for any other field touched this way, not just `amount_spent`.
- **`booking_revenue_split`'s admin-only RLS chain is confirmed identical everywhere it matters** — `bookings`, `venues`, `expenses`, `ad_insights`, `ad_sync_runs` are all gated on the single `auth.email() = 'aksh.eeev@gmail.com'` check (verified live via `pg_policies`, not assumed). This is what makes "one shared login" a correct architecture rather than a hope — every table the hosted dashboards touch already agrees on who the one admin is.
- **`ad_insights.results` has no native Graph API equivalent** — it's a UI-computed metric tied to a campaign's optimization goal. Both new functions proxy it as "the `actions` entry with the highest count that day," which is a reasonable default for this account's click-to-message campaigns but should be eyeballed against Ads Manager the first time real data flows (this is already Phase 2's own exit condition, not a new requirement).

**UNCOMMITTED**: everything below, this session's work. Nothing has been pushed.

```
git add CLAUDE.md docs/HANDOFFS.md docs/HOSTED_DASHBOARD_PLAN.md docs/META_ADS_DASHBOARD_PLAN.md supabase/migrations/20260923_booking_revenue_split_add_city.sql supabase/migrations/20260923_sync_meta_ads_daily_cron.sql supabase/functions/sync-meta-ads/index.ts supabase/functions/meta-live-snapshot/index.ts hosted-dashboard/hub.html hosted-dashboard/ads.html
git commit -m "Hosted Meta Ads dashboard: city columns on booking_revenue_split (live), sync-meta-ads + meta-live-snapshot functions and cron (not yet deployed), hub.html + ads.html (not yet rendered)"
git push
```

CONTINUE FROM: **Aksheev** — (1) 🔴 deploy `sync-meta-ads` and `meta-live-snapshot` via Supabase Dashboard, set `META_ACCESS_TOKEN`/`META_AD_ACCOUNT_ID` secrets **before** the cron's next fire; (2) say whether a Meta System User token already exists in Business Manager `1549685876475913`, or create one; (3) decide Phase 5 access (custom domain + SSO-off, vs. Vercel invites); (4) push this branch, then open `hub.html` → `ads.html` in an actual browser at a real screen width — nobody has seen either render; (5) locate the real Morning-brief scheduled task (or confirm it doesn't exist) so Phase 6 can proceed; (6) Airbnb prices are still overdue from 2026-09-14. **Claude** — (a) once deployed, run the Phase 2 exit conditions (3 spot-check dates, the Jul24–Sep2 known-bad regression replay, 90-day backfill via Phase 2b); (b) once a real page-load happens, fix whatever `ads.html` gets wrong — it has never been seen rendering; (c) picnic_stay email rendering and the other 2026-09-14 carry-forwards remain open.

The 2026-09-03 entry (sheet-formula fixes, expenses mirror, legacy backfill) is now at the TOP of `docs/HANDOFFS.md`.

**Why this existed**: ads run on picnic ONLY, never on stay. The Meta dashboard was computing picnic revenue as `checkout_date IS NULL`, which is wrong for `partner_bnb` venues — they carry a checkout date but their revenue is picnic. Real picnic sales were being discarded, and a combined picnic+stay booking had no representation at all.

**SHIPPED — CONFIRMED LIVE (probed 2026-09-14). All live in Supabase; repo now synced and pushed by Aksheev.**

- **`bookings.booking_kind`** (`picnic` | `stay` | `picnic_stay`) + **`picnic_amount`** / **`stay_amount`**, all nullable, with a CHECK on the kind and a non-negative CHECK on the amounts. Migration `20260914_add_booking_kind_and_split_amounts`.
  - 🔴 **NO constraint ties the components to `total_amount`, deliberately.** Totals are negotiated, so the components are a **RATIO**, not rupees. Never "fix" this by adding a sum constraint.
- **Backfill of all 84 rows** (`20260914_backfill_booking_kind`): picnic 43 / stay 40 / picnic_stay 1. **Zero NULL `booking_kind`, zero reconciliation failures.** Rules: `cafe`+`custom`→picnic, `partner_bnb`→picnic (stay booked off-platform), `self_managed`+`combo`→stay.
- **`venues.picnic_venue_id`** (`20260914_add_venues_picnic_venue_id`) — points a stay venue at the cafe twin its picnic is priced from: **22→27, 23→24, 25→20**. NULL = picnic_stay not offerable there.
  - 🔴 **Deliberately NOT `parent_venue_id`.** That models combo parent/child inventory (Sienna 17 → Umber 15 + Ochre 16) and drives the iCal availability fanout. Conflating the two would break Airbnb sync.
- **`compute_booking_total` picnic_stay branch** (`20260914_compute_booking_total_picnic_stay_branch`). Returns `nights × stay rate + picnic priced off the twin + add-ons`.
  - 🔴 **SIGNATURE UNCHANGED**, so no PostgREST overload and **no caller edits** to `admin_add_manual_booking` / `admin_edit_booking` / `submit_booking_intent`. This works because `p_nights` + `p_time_slot` already existed and **no previous branch handled BOTH being set** — stay branches ignored the slot, the cafe branch ignored nights. That unused combination is now the picnic_stay signal.
  - Resolved **before** package lookup, because on a picnic_stay the package belongs to the twin; resolving against the stay row raises `PACKAGE_NOT_AVAILABLE`. Add-ons charged once at the outer level and NOT passed down (no double-count). Zero nights passed down ⇒ cannot recurse.
  - **13 assertions passed**, incl. 8 regressions proving existing pricing byte-identical. New: CO 1n/2g+slot **15,800**; 2n **25,700**; +Setting **18,800**; advance **4,740**; +photographer **21,800**.
- **Venue 27 — "Countryside Offgrid" (type `cafe`, slug `countryside-offgrid-picnic`)**, base **5,900**, `free_guests_upto` 6, capacity 2–6, `requires_confirmation` true, `max_concurrent_setups` 1. **All 8 Beige Cafe packages mirrored**, prices verified identical. Activated manually by Aksheev.
  - 🔴 Slug is `-picnic`, NOT the house `-stay` convention, because venue 22 already holds the clean `countryside-offgrid` slug and is live. `venues_slug_key` is UNIQUE; renaming a live slug would break existing links.
- **`public.booking_revenue_split` view** (`20260914_booking_revenue_split_view`) — **the single definition of picnic revenue. Consumers must read it, never re-derive.** Add-ons carved to the picnic side FIRST (pass-through vendor cost, must not absorb a discount), then the remaining negotiated total split by the ratio. Standing exclusions live in the view as `excluded_reason`. **`security_invoker = true`** so it respects RLS on bookings; `get_advisors` identical before/after, no `security_definer_view` finding.
  - An unrecorded split returns **NULL, never a guess**, flagged `split_unknown` — a visible gap beats a wrong number nobody questions.
- **`trg_bookings_set_booking_kind`** (`20260914_bookings_default_booking_kind_trigger`) — defaults `booking_kind` on every write path. **Explicit always wins.** Derivation mirrors the pricing signal so classification and pricing cannot drift. Tested with a rolled-back `DO` block, 5 cases, **residue proven 0**.
  - 🔴 Chosen over editing the three RPCs (7–10k chars each) precisely because reassembling them from substrings is the §3 tearing risk. ~40 lines, covers every write path including unaudited ones.
- **`admin_set_booking_split(bigint, numeric, numeric)`** (`20260914_admin_set_booking_split`) — SECURITY INVOKER, explicit search_path, admin guard resolved from `admin_add_manual_booking`'s live body. Rolled-back test: admin wrote, non-admin got `Admin login required`, 165 unchanged after rollback.
  - 🔴 **This exists because both admin RPCs build their column lists EXPLICITLY and silently drop `picnic_amount`/`stay_amount` out of `p_booking`.** Without it the new form fields would look like they saved and do nothing.
- **Booking 165** (Countryside Offgrid, 20–21 Sep, ₹21,900) is the **only** picnic_stay in the table. Split from Aksheev: photographer add-on 6,000 + setup 8,900 + stay 7,000. → `picnic_amount 8900 / stay_amount 7000`, view yields **picnic_revenue 14,900 / stay_revenue 7,000**, reconciling exactly.
  - 🔴 **DO NOT derive a split from `compute_booking_total`.** It reproduced the TOTAL to within ₹100 (21,800 vs 21,900) but got the COMPONENTS wrong — it predicts 5,900/9,900, which would understate picnic revenue by ~3,000 and feed a wrong MER. **Hand-entered totals must have their split taken from whoever sold the booking.**
- **Meta ads dashboard artifact repointed** at `booking_revenue_split`. Old vs new over 180d: **20 bookings → 21**, same revenue (165's split was still unrecorded at the time). Confirmed picnic revenue now **₹2,76,652**.

**built but unverified — 🔴 `app.js` (committed and pushed)**

- Ten edits, **never machine-parsed**. §11 requires a trusted-copy `node --check`; the sandbox mount failed 4× (Windows update 2026-09-08 blocks the Plan9 share), so it was impossible this session. Aksheev ran `node --check` before pushing and reported "everything looks good", but **Claude has not seen the form render, nor a created picnic_stay booking**.
- Changes: third toggle (`abkSetType('picnic_stay')`); its dates block shows check-in/check-out **and** a setup slot (the pair the pricing + trigger key on — a two-way toggle structurally could not emit it); packages sourced from the **twin** via `abkPicnicTwin()`; `picnic_amount`/`stay_amount` inputs; `abkSaveSplit()` calls the new RPC after save and reports failure as *"booking saved, split didn't"*; `abkComputeTotal` mirrors the SQL branch; helpers `abkHasPicnic()`/`abkHasStay()`/`abkKindLabel()`.
- 🔴 **`picnic_venue_id` added to the Add-Booking venues `select`** — it was missing, so the twin filter would have silently fallen back to all stay venues.
- 🔴 **Bookings-list badge and the edit path now read `booking_kind`.** The old edit rule `!!b.checkout_date || ABK_STAY_TYPES.includes(v.type)` would open booking 165 as a plain **Stay** and **strip its picnic half on save**.

**NOT done — owed**

- 🔴 **Emails still render either a TIME row or nights, never both.** A picnic_stay confirmation is wrong today. `notify-booking-confirmed` v30 / `notify-booking-received` v32, both `verify_jwt=false` — **must stay false**. Blocked this session: §4 requires an esbuild bundle-check and the sandbox could not mount; and per 2026-09-03, `deploy_edge_function` cannot be called from Cowork at all. **Dashboard or CLI only.**
- **`staff_today` (8k chars)** — day-of view must show BOTH the arrival window and the setup slot for a picnic_stay. Same rewrite-risk problem; wants a targeted approach, not a blind `CREATE OR REPLACE`.
- 🔴 **CROSS-VENUE CONFLICT GAP — needs a BUSINESS DECISION, not code.** Conflict checks are **per `venue_id`**. Because the picnic twin is a separate venue, a picnic at 27 and a stay at 22 on the same night **cannot see each other**. Correct when the picnic buyer IS the guest staying; wrong when they are strangers. Same gap already exists for House of Amer and Om Niwas. **Should a picnic at the twin block a stay at the parent?**
- **TerraCottage Umber (15), Ochre (16), Sienna (17) have no picnic twin**, so picnic_stay is not offerable there — yet the original ask named them as first candidates. Needs cafe twins or a `picnic_venue_id` pointing at an existing NCR picnic rate.
- Carried forward unchanged: 🔴 Airbnb prices (was "before 2026-09-15" — **now overdue**); Jaipur workbook; `#REF!` in the Airbnb Balance Due header; booking **#61** `preferred_date = '0026-07-25'`; `guest_count` on 81–89; `bb2a81f` unreviewed against §7; `_shared/venue.ts:29`; hosted dashboard Phases 2–4; the triple-send to `gurkeerat45@gmail.com` on 2026-09-02.

**Facts established by live probing (2026-09-14) — do not re-derive**

- 🔴 **`checkout_date` says NOTHING about whether a stay was sold at a `partner_bnb` venue.** Booking 172 (5,900) was a picnic AT the property with **no stay sold**, carrying a checkout date only because venue 27 did not exist yet. Booking 165 carries one *with* a stay sold. **The shape cannot tell them apart — only `booking_kind` can.** This is the entire justification for the column.
- **`compute_booking_total` returns `v_picnic + v_addons` in every branch ⇒ ADD-ONS ARE ALREADY INSIDE `total_amount`.** Verified: booking 65, The Prelude, total 7,000 with a 1,100 Cake — not 8,100. Never add them again.
- 🔴 **`combo` is a PARENT-PROPERTY type, nothing to do with picnics.** Sienna 17 is the whole TerraCottage; Umber/Ochre point at it via `parent_venue_id`. `submit_booking_intent` forces combo venues to `confirmed=false, customer_intent='query'`; `staff_occupancy_upcoming` carries `v.type <> 'combo' -- trap 2: combo inherits its children`. **It is orthogonal to `booking_kind` — a Sienna booking can legitimately be picnic_stay. Do not merge or retire either.** Sienna has **0 bookings ever**.
- **`partner_bnb` pricing deliberately does NOT multiply by nights** ("guest books the stay on Airbnb directly; we only price the picnic setup"). 🔴 Countryside Offgrid now sometimes sells the stay too, so that branch **under-prices by the whole stay** if reached. It has never fired: across all 4 partner_bnb venues there is **1 booking ever and 0 self-serve** — every one was admin-entered with a manual total. Still live: 3 active partner_bnb venues are bookable.
- **Conflict checks for `self_managed`/`partner_bnb` query the BOOKINGS TABLE directly by date range**, not just `venue_availability`. With `max_concurrent_setups = 1` a second overlapping stay IS rejected.
  - 🔴 **CORRECTION of my own claim, made three times this session:** I said venue 22 had *no* double-booking protection, inferring it from empty `venue_availability` rows instead of reading the conflict logic. **That was wrong.** Read the function, not the absence of rows.
- **Stay revenue is NOT comparable across rows.** Many TerraCottage stays total ₹2,000–3,300 against a ₹9,800–10,900 nightly rate because they record only our cut of an Airbnb-originated stay (booking 90: *"Direct extension of Airbnb stay HM24QNCBZ8"*). Harmless for ad math (ads never touch stay) but do not sum `stay_amount` as gross revenue.
- **Only ONE venue-name pair uses the twin pattern with identical names** — House of Amer 23 (`house-of-amer-stay`) / 24 (`house-of-amer`). Om Niwas differentiates by name ("— Stay"). Cafe row gets the clean slug; stay row gets `-stay`.

**Process notes from this session**

- 🔴 **Two wrong picnic_stay identifications, both caught by Aksheev, both from inferring intent out of numbers.** Booking 153 (16,900 vs a 10,900 nightly) was flagged from a ₹6,000 price-gap heuristic — wrong, the gap is unexplained but is not a picnic. Booking 172 was briefly set to picnic_stay — wrong, no stay was sold. **A price gap is not evidence of what was sold. Ask the person who sold it.**
- **Predicting a correct TOTAL is not evidence of correct COMPONENTS.** The pricing model hit 165's total within ₹100 and still had the split badly wrong. Treating the total match as corroboration would have shipped a ~3,000 error straight into MER.
- **A trigger beat rewriting three big RPCs.** When the only change is "persist one more column", a ~40-line BEFORE trigger covers every write path, is independently testable, and avoids the §3 large-file tearing risk entirely.
- **`security_invoker = true` on any new view over `bookings`** — without it the view runs with owner rights and silently bypasses RLS. `get_advisors` catches it, but only if you look.

**ADDENDUM 2026-09-15 — SHIPPED, CONFIRMED LIVE**

- **`booking_revenue_split.booked_on` is now an IST date**, not UTC (`20260915_booking_revenue_split_ist_booked_on`). `created_at::date` meant anything booked between **00:00 and 05:30 IST** landed on the PREVIOUS day's bar, and disagreed with the Google Sheet sync, which already IST-shifts `Booked On` via `bookedOnDate()` — the sheet was right. Verified: daily series identical, 30-day picnic count still 12, booking 179 still on 2026-09-14, 0 reconciliation failures. **Exactly one row in the table changes bucket** — booking 15 (Tanu, unconfirmed, never reached the dashboard) — so zero current numbers moved. Forward-looking correctness only.
- 🔴 **False alarm worth remembering**: this was raised as *"a website booking this morning is missing from the chart"*. It was not missing. Booking **179** (DEV ARADHANA, Beige Cafe, ₹9,900, paid ₹2,970 = 30% ✓) was created **2026-09-14 18:07 UTC = 23:37 IST** — last night — and the admin card's relative **"8h ago"** label made it read as today. It was on the 14 Sept bar the whole time, and the chart's "12 picnic bookings" headline matched the live count exactly. **Before chasing a missing-row bug, check `created_at` in IST and compare the chart's own totals against a live count.** Also note the UTC date does not roll until 05:30 IST, so a "today" bar cannot exist before then.

**UNCOMMITTED**: `CLAUDE.md`, `docs/HANDOFFS.md` (the 09-14 rotation) and `supabase/migrations/20260915_booking_revenue_split_ist_booked_on.sql`. Everything else from 2026-09-14 (10 migrations + `app.js`) was already pushed.

```
git add CLAUDE.md docs/HANDOFFS.md supabase/migrations/20260915_booking_revenue_split_ist_booked_on.sql
git commit -m "Session handoff 2026-09-14 + IST booked_on fix for booking_revenue_split"
git push
```

CONTINUE FROM: **Aksheev** — (1) 🔴 create a real **Picnic + Stay** booking in the admin form and confirm it saves, prices at 15,800 for 1n/2g at Countryside Offgrid, and that the split persists — `app.js` was never parsed by Claude; (2) reopen booking **#165** in edit mode and confirm it loads as *Picnic + Stay*, not *Stay*; (3) **decide the cross-venue conflict question** above; (4) Airbnb prices are now **overdue**. **Claude** — (a) 🔴 render picnic_stay correctly in `notify-booking-confirmed` + `notify-booking-received` (needs a working sandbox for the bundle check, then Dashboard/CLI deploy); (b) `staff_today` day-of view; (c) picnic twins for the TerraCottage venues; (d) carried-forward items.

*2026-07-18: CLAUDE.md restructured (rules made explicit, Definition of Done added); handoff history moved verbatim to `docs/HANDOFFS.md`.*
