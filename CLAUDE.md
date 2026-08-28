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

If a skill fails to load, §4/§5/§8/§12 above carry the critical steps — follow them.

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

## Latest Session Handoff — 2026-08-28 (Region scoping Phases 2–4 live: staff links are now location-scoped by token — but the all-access token is still active, so nothing is contained yet. `admin_apply_staff_payment` deleted outright, replaced by a Close-modal prefill, to Aksheev's design. Booking-id badges on admin cards. 🔴 The 08-27 claim that the Google Sheet sync was dead was WRONG — corrected.)

The 2026-08-27 entry (staff money row, Menu Link removal, region scoping Phase 1) is now at the TOP of `docs/HANDOFFS.md`.

**SHIPPED-verified (live-probed 2026-08-28)**

- **Region scoping Phase 2 — the five staff helpers are scoped.** Migration `20260828054442_region_scoping_phase2_scope_staff_helpers`, repo file `supabase/migrations/20260828_region_scoping_phase2.sql`, deploy `83233c4`. Four id helpers each gained exactly one clause, `and (p_region is null or b.region = p_region)`, no join; `staff_occupancy_upcoming(p_region)` filters `v.region` on the join it already had. `staff_today` and `staff_log_step` were patched **in place** via `pg_get_functiondef` + an asserted single-match `replace()` + `EXECUTE`, so their security-critical bodies were never retyped. All five zero-arg variants dropped in the same migration. **`select proname, pronargs from pg_proc where proname like 'staff\_%\_ids\_%'` → five rows, all `pronargs = 1`, re-confirmed 2026-08-28.** Every planned exit assertion passed, including the one that mattered: **The Sunroom (18, city `Delhi`) is present for an `ncr` token**; House of Amer (24) absent for `ncr` and present for `jaipur`; a synthetic custom booking on Jaipur venue 5 but `region = 'ncr'` was visible to `ncr` and invisible to `jaipur`, proving the booking's region beats the venue's; the F8 grace-window case held; `staff_log_step` cross-region returned `not_today` both ways. NULL-region payload md5 `f1096d54…` identical to the Phase 1 capture — an unscoped token still sees exactly what it saw.
- **Region scoping Phase 3 — shipped, but NARROWER than the plan.** Migration `20260828055533_region_scoping_phase3_require_region_on_confirm`, repo file `supabase/migrations/20260828_region_required_on_confirm.sql`. 🔴 **Neither admin RPC was touched.** `pg_get_functiondef` on `admin_add_manual_booking` and `admin_edit_booking` contains no `region` at all, re-confirmed 2026-08-28 — because both already `raise exception 'Venue is required'`, which makes a venue-less booking unconfirmable through them anyway, so the planned jsonb key would have been dead code. What shipped is one branch inside `bookings_set_region()`: on UPDATE, `new.confirmed and not old.confirmed and new.region is null` raises with a message naming both fixes. 🔴 **The reason recorded here on 2026-08-28 was WRONG and is corrected below** — see the custom-venue entry.
- **Region scoping Phase 4 — tokens carry a region, admin and staff UI show it.** Migration `20260828060038_region_scoping_phase4_issue_token_with_region`, repo file `supabase/migrations/20260828_region_scoping_phase4.sql`, deploy `b2085ee`. `admin_issue_staff_token(text)` was **dropped first** then recreated as `(p_staff_name text, p_region text default null)` — the §4 overload rule, and `pg_proc` confirms **exactly one row, `pronargs = 2`**. It raises on any `p_region` outside `('ncr','jaipur')`; a typo can never silently mint an all-access token. `staff_today` now returns `region` inside its `staff` object. UI: `stt` issue form has a region select defaulting to no selection (so all-access is deliberate), a per-row region pill rendering NULL as a distinct **All locations** badge, and a Location column; `staff.js` prints the region in the page header (`REGION_LABEL = { ncr: 'Gurugram + Delhi', jaipur: 'Jaipur' }`) so a wrong link is obvious on sight.
- **Live token state, 2026-08-28**: `10 Sunny region NULL active` · `26 Sunny ncr active` · `27 Adhiraj jaipur active` (9 is inactive). Tokens 26 and 27 were issued from the real UI and both opened successfully.
- **Data state, 2026-08-28**: 58 bookings, `ncr` 52 / `jaipur` 6 / NULL 0. **`select count(*) from bookings where confirmed and region is null` = 0.**
- **`admin_apply_staff_payment` is gone.** Migration `20260827171844_drop_admin_apply_staff_payment`, repo file `supabase/migrations/20260827_drop_admin_apply_staff_payment.sql`. `pg_proc` confirms it no longer exists. 🔴 **The design is Aksheev's, and it is better than the fix I proposed.** I had costed `set advance_amount = p_amount` → `min(advance + claimed, total)`. He rejected the whole arithmetic: *staff should only report that they captured the payment; we do no arithmetic on it and leave the booking amounts alone; when admin closes the booking, he puts the final amounts.* That deletes an entire class of double-count bug instead of correcting one instance. `sttApplyPayment`, the Record button, `needsReconcile` and its markup all came out of `app.js` with it.
- **Close Booking modal now prefills from the staff log** in place of the deleted Record path. `bclOpen` reads the `payment_received` row and computes `staffPrefill = staffLogged > 0 && owedNow > 0 ? min(staffLogged, owedNow) : 0`. 🔴 **The "Balance received" field is a DELTA, not a total** — I told Aksheev to enter 11,900 on #100 and the form correctly rejected it as "₹5,000 more than the booking total"; the right entry was 6,900, or the "Received in full" button. Margin display is now gated on `anyCost` so a zero-cost booking no longer shows a fake 100% margin.
- **Booking-id badges on admin cards** — `.adm-id` pills added in three places in `app.js`, deploy `c848ffd`. Requested because there was no way to name a booking out loud.
- 🔴 **CORRECTION carried into this entry — the Google Sheet sync is ALIVE.** The live NCR workbook is **`1wOUzB2Y3HgQ3FnJrRmJrY7oB2zVDVeEhECjc8fjQipY`** (title `THEPIC~3`), holding 11 picnic + 26 Airbnb rows with a populated `_bkid`. `15DzEVgY…`, named in `docs/SHEET_SYNC_DEPLOY_2026-08-16.md`, is a **stale duplicate** with two sample rows that exist in no database. I declared the sync dead for 65 days because I verified the two IDs *the doc named* instead of the workbook Aksheev actually uses; he pushed back twice before I checked. **§2 exists for exactly this. Verify the object, not the doc's idea of the object.** `docs/SHEET_SYNC_DEPLOY_2026-08-16.md` has been corrected (deploy `2440537`).
- **Documentation rotated this session**: `docs/STAFF_ACCESS_BY_LOCATION_PLAN.md` gained a **§0.1 Status — as built** table plus a status line on each of the five phases (its "plan only, nothing built" header was 4 phases out of date); `docs/STAFF_PAYMENT_RECONCILE_FIX_PLAN.md` was replaced with a SUPERSEDED tombstone (the device shell cannot delete, so it stays as a file); this rotation.

**NOT-done — owed**

- 🔴 **`staff_tokens.id = 10` is still `is_active = true`.** It has no region, so it still returns every booking in the country. **Four phases of work are built and none of the benefit is realised until this one UPDATE runs.** Aksheev deferred it on 2026-08-28 ("will deactivate it later"). Phase 5's ordering rule is already satisfied — 26 and 27 are confirmed working on real phones — so there is nothing left to wait for. One statement: `update public.staff_tokens set is_active = false where id = 10;`
- 🔴 **CORRECTION, same day — the "Phase 3 hole" written above was wrong in three ways, and the real bug was worse.** Probed live before fixing:
  - **"Public custom bookings store `venue_id IS NULL`" — false.** `app.js:4274` is the *main venue booking form*. Custom picnics go through a different function, `handleCustomPicnicSubmit`, which sends `p_venue_id: customVenue.id`. **Bookings with a NULL `venue_id`: 0.** No path has ever produced one.
  - **"Both admin RPCs refuse it before the trigger's raise" — false.** Admin lead-confirm is `app.js:6829`, a direct `.update({ confirmed: true, advance_amount })` against PostgREST. It is not an RPC; `Venue is required` never runs on that path.
  - **The trigger's `confirmed and region is null` raise is therefore UNREACHABLE.** Nothing can produce a NULL region. It is a correct but dead backstop.
  - 🔴 **The real bug**: exactly one custom venue row existed — id 5, `Your Own Space`, city Jaipur, **region `jaipur`**. Both paths stored `venue_id = 5`, so **every custom booking, NCR ones included, silently derived `region = 'jaipur'`.** Nothing errored. An NCR custom picnic would have appeared on Adhiraj's Jaipur link and been invisible on Sunny's NCR link. Not "cannot confirm" — "confirms fine, files wrong."
- **FIXED, 2026-08-28** — migration `custom_venue_per_region`, repo file `supabase/migrations/20260828_custom_venue_per_region.sql`. One custom venue **per region**: venue 5 stays Jaipur, new **venue 26** is `Your Own Space` / city `Gurugram` / region `ncr` / team 2 / sort_order 26. Region now derives from the venue exactly as it does for the other 58 bookings — no RPC change, no jsonb key, no touch to `submit_booking_intent`. Three values are load-bearing: **city `Gurugram`** (the sheet sync routes on venue *city* via `locationOf()`, `NCR_CITIES = Delhi/Gurugram/Noida/Faridabad`), **team_id 2**, and **sort_order 26 > venue 5's 13** (the public fetch orders `sort_order asc, id asc`, so the pre-deploy `.find()` kept returning venue 5 and the public site was unchanged for the whole deploy window). Both rows keep the name `Your Own Space` on purpose — `_shared/venue.ts` builds the guest-facing label as `[name, area, city].join(', ')`, so a distinct name would leak "Your Own Space (NCR)" into confirmation emails; the admin dropdown carries the region instead.
  - **Exit assertions A–E passed** in a rolled-back `DO $$`: two custom venues, one per region; new row's city in `NCR_CITIES`, team 2, sort_order above venue 5's, active; trigger derives `ncr` on venue 26 and `jaipur` on venue 5; **venue-move 5 → 26 re-derives to `ncr`** (so a mis-filed booking is fixable from the admin edit form); the 58 pre-existing bookings unchanged at `ncr 52 / jaipur 6 / null 0`. Residue 0. `get_advisors` unchanged.
  - `app.js`, three edits, all asserted single-match and applied in one pass: the public modal picks the custom row matching the already-collected `cpm-city` value (a `required` select whose values are literally `jaipur`/`ncr`); the `abk` venue fetch gained `region` to its **narrow** column list (without it the next edit renders `undefined`); the `abk` dropdown labels custom options by region via `STT_REGION_LABEL`, leaving all other venues' labels untouched. `node --check` clean; `vite build` clean, 88 modules.
  - **Rollback is `update public.venues set is_active = false where slug = 'your-own-space-ncr';` — never `DELETE`.** `bookings_venue_id_fkey` is `ON DELETE SET NULL`, so deleting the row silently orphans any booking on it into exactly the NULL-venue/stale-region state this whole effort exists to prevent.
  - **No SEO impact, verified at the object level**: `scripts/prerender-venues.mjs` fetches `.neq('type','custom')` (line 1131) and `PICNIC_TYPES = new Set(['cafe'])`, so the new row produces no prerendered page, no city-hub entry, no homepage link.
- **Still NOT built, and no longer urgent**: the `abk` region control and the `region` jsonb key on the two admin RPCs. The venue dropdown is now the region control, so these are redundant rather than owed.
- **The `confirmed and region is null` backstop is not wired into `picnic-live-verify`.** It reads 0 today, but only because I ran the query by hand. Phase 3 called for it to be part of the skill.
- **Not eyeballed**: the Staff Ops panel's new region pills / Location column, and the Close modal's prefill, have not been looked at in a browser by me. Tokens 26/27 opening is the only real-world confirmation.
- **Whether the Phase 3 migration file is committed is unknown to Claude.** All four repo files are present on disk (`20260827_region_scoping_phase1.sql`, `20260827_drop_admin_apply_staff_payment.sql`, `20260828_region_scoping_phase2.sql`, `20260828_region_required_on_confirm.sql`, `20260828_region_scoping_phase4.sql`), but of the four READY Vercel deploys (`b2085ee` Phase 4, `83233c4` Phase 2, `2440537` sheet-doc correction, `c848ffd` close-booking polish) **no commit message mentions Phase 3's migration**. A migration applied live but absent from git is the §4 failure mode. Check before assuming.
- **Jaipur workbook (`THEPIC~2`) untouched since 2026-06-24** — and this now matters more than it did: Adhiraj holds a live Jaipur link, so Jaipur has an operator whose bookings are not reaching a sheet.
- **`#REF!` in the live NCR workbook's Airbnb "Balance Due" header.**
- **Booking #61** (Maheep, House of Amer, Jaipur) still `preferred_date = '0026-07-25'` — carried since 2026-08-11, has never appeared in a "today" query and never will.
- Carried forward unchanged: 🔴 raise Airbnb nightly prices before **2026-09-15**; `guest_count` on ids 81–89 (all still `2`); commit **`bb2a81f`** (stay per-night pricing) still unreviewed against §7.

**Facts established by live probing this session — do not re-derive (2026-08-28)**

- **`admin_add_manual_booking` and `admin_edit_booking` both already raise `Venue is required`.** This is why Phase 3 collapsed to a trigger branch. 🔴 It is **not** why the custom-booking bug existed — that was venue 5's region, and the admin lead-confirm path (`app.js:6829`) is a direct PostgREST update that never reaches either RPC. Do not reason about the confirm path as if it goes through an RPC.
- **`abk` sends `venue_id: v.id` for custom bookings too** (`app.js:10571` sets only `venue_address` differently). There is no path in the codebase that writes a booking with a NULL `venue_id`.
- **The `abk` venue fetch (`app.js:10102`) selects a NARROW column list**, not `*`. Any new admin-form field that reads a venue column must be added there first or it silently renders `undefined`. The public fetch (line 466) does use `.select('*')`.
- **`scripts/google-sheet-sync.gs` routes bookings to a workbook by venue `city`, not `region`** — `locationOf()` against `NCR_CITIES = ['Delhi','Gurugram','Noida','Faridabad']`. A venue whose city is outside that list and is not `Jaipur` reaches **no** workbook.
- **`bookings_venue_id_fkey` is `ON DELETE SET NULL`.** Deleting a venue row does not fail — it silently orphans its bookings into the invisible NULL-region state. Deactivate venues, never delete them.
- **The Close modal's "Balance received" is incremental.** `bclReceivedNow()` is the running total; the field adds to it. Any future instruction to "enter the full amount" is wrong.
- **`pg_get_functiondef` + an asserted `replace()` + `EXECUTE` is the right way to patch a SECURITY DEFINER body.** Used for both `staff_today` and `staff_log_step` in Phase 2 with zero retyping. Adopt it as the default for in-place RPC surgery.
- **`bookings_set_region()` must stay SECURITY DEFINER with EXECUTE revoked** from `public, anon, authenticated`. It reads `venues` rows an RLS-filtered INVOKER read would miss, but it must never be reachable as an RPC — `get_advisors` flags it the moment the revoke is missing.

**Process notes from this session**

- **The stale-working-copy failure hit twice.** A `cp` from an older staged path silently overwrote my edited `app.js`. Both times the exact-match assertion (`assert s.count(old) == 1`) caught it and nothing was written. **Re-stage from the device before every edit round** — the assertion is the only thing standing between this and a silent half-revert.
- A patch script **partially applied** once: the `staff.js` edit failed on `·` vs a literal `·` and `style.css` was never reached. Multi-file scripts must assert every match up front, before writing any file.
- My own assertion tripped on my own replacement comment (`assert 'admin_apply_staff_payment' not in a` failed because the comment names the dropped RPC). Assert on the **call site** (`"supabase.rpc('admin_apply_staff_payment'"`), not the bare name.

**UNCOMMITTED (this rotation only — `git status` on Aksheev's terminal is authoritative, the sandbox's is not)**: `CLAUDE.md`, `docs/HANDOFFS.md`, `docs/STAFF_ACCESS_BY_LOCATION_PLAN.md`, `docs/STAFF_PAYMENT_RECONCILE_FIX_PLAN.md`. Also possibly still pending, fate **unknown to Claude**: `.gitignore`, `scripts/google-sheet-sync.gs`, `BRUSHSCI.TTF`, `SpecialYou_Competitive_Analysis.md`, the 0-byte stray file named `total`, and `supabase/migrations/20260828_region_required_on_confirm.sql` (see NOT-done). Confirm before assuming.

```
git add app.js supabase/migrations/20260828_custom_venue_per_region.sql CLAUDE.md docs/HANDOFFS.md docs/STAFF_ACCESS_BY_LOCATION_PLAN.md docs/STAFF_PAYMENT_RECONCILE_FIX_PLAN.md
git commit -m "Custom picnics file by region: split Your Own Space into NCR + Jaipur venue rows; docs"
git push
```

**Acceptance test, after the deploy reports READY** — column values are not the deliverable, the staff link is, and the staff helpers filter `b.confirmed = true` so an enquiry alone proves nothing:

1. Public custom picnic modal → city **Delhi NCR** → submit. Assert `region = 'ncr'`.
2. Confirm it from admin with the guest email off, or against `aksheevs+customncr@gmail.com` — never a real customer address.
3. Sunny's `ncr` link: present. Adhiraj's `jaipur` link: absent.
4. Repeat with city **Jaipur**, reversed.
5. Delete both rows and children, prove `count(*) = 0`.

Then, separately, if `git status` shows it untracked:

```
git add supabase/migrations/20260828_region_required_on_confirm.sql
git commit -m "Region scoping phase 3: require region on confirm (migration file, applied live 2026-08-28)"
git push
```

CONTINUE FROM: **Aksheev** — (1) 🔴 `update public.staff_tokens set is_active = false where id = 10;` — until this runs, none of this session's work does anything; (2) check whether `20260828_region_required_on_confirm.sql` is committed; (3) eyeball the Staff Ops panel (region pills, Location column) and the Close modal prefill; (4) carried forward — Airbnb prices before 2026-09-15, `guest_count` on 81–89, booking #61's date, the Jaipur workbook. **Claude** — (a) ~~close the Phase 3 hole~~ **done 2026-08-28** via the custom-venue split; what remains is the end-to-end acceptance test below; (b) wire the `confirmed and region is null` backstop into `picnic-live-verify`; (c) diagnose the Jaipur workbook now that Jaipur has a live operator; (d) review `bb2a81f` against §7.

*2026-07-18: CLAUDE.md restructured (rules made explicit, Definition of Done added); handoff history moved verbatim to `docs/HANDOFFS.md`.*
