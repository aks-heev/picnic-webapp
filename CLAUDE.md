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

## Latest Session Handoff — 2026-09-03 (Two sheet-formula bugs fixed and a third prevented; `public.expenses` mirror live so a dashboard can be hosted outside Cowork; four legacy bookings backfilled with zero emails; admin form no longer silently reprices a stay on a date edit. 🔴 Food/slot-time fields are live in DB + form; a PARALLEL session shipped them into `notify-booking-confirmed` v28–v30 the same night — `notify-booking-received` still renders neither.)

The 2026-08-28 entry (region scoping Phases 2–4, `admin_apply_staff_payment` removal, custom-venue-per-region) is now at the TOP of `docs/HANDOFFS.md`.

**SHIPPED-verified (live-probed 2026-09-03)**

- **`admin_edit_booking` no longer blocks an edit on nights the booking already holds.** Migration `20260815_admin_edit_booking_skip_own_footprint`, repo file of the same name. All three conflict branches (cafe/custom, self_managed/partner_bnb, combo) now compute `v_was_mine` from the OLD row and skip the checks for any `(venue, night)` already occupied. 🔴 **Root cause worth keeping**: Airbnb re-exports the blocks we publish, and `sync-ical` imports them back as `venue_availability` rows with `source='ical'` and **`booking_id = NULL`** — so the pre-existing `booking_id is distinct from p_booking_id` filter could not recognise them as the booking's own footprint. Booking #91 (Umber, 2026-08-15→31) was permanently uneditable with *"2026-08-15 is blocked (admin block, Airbnb booking, or whole-floor booking)"*. Any stay blocked by hand on Airbnb would have hit this. Three rolled-back `DO $$` tests passed: unchanged-dates edit succeeds; moving onto genuinely blocked 2026-08-13 still raises the original message; non-admin still gets `Admin login required`. `pg_proc` → **one signature, SECURITY INVOKER, `search_path` set**; `get_advisors` unchanged.
- **Food + slot-time fields, DB and admin form.** Migration `20260815_booking_food_inclusions_and_slot_times` added `includes_food`, `food_items_count`, `beverage_items_count`, `slot_start_time`, `slot_end_time` plus two CHECK constraints (non-negative counts; end > start). Both admin RPCs read them out of the **existing `p_booking` jsonb — NO signature change**, confirmed `admin_add_manual_booking/2`, `admin_edit_booking/3`. Four rolled-back branch tests passed, including that unticking the box wipes the counts and that removing the slot clears the times, so a row can never hold orphaned values. `app.js` has the `Includes food` checkbox with conditional Food/Beverage inputs and a start/end time pair prefilled from `ABK_SLOT_TIMES` (mirrors `TIME_SLOTS` in the notify fns).
  - 🔴 **These are OVERRIDES of values the emails already compute, not new fields.** `notify-booking-confirmed` has `getInclusionText()` rendering *"3 food items · 2 beverages"* from `venues.metadata.food_multiplier`/`drink_multiplier` × adults, and the TIME row is a hardcoded `TIME_SLOTS` lookup. The manual values are meant to win when set and leave the computed path untouched when not. Counts are **totals for the booking, not per guest** — matching what the computed row already displays.
- **Sheet sync bug 1 — `Base Package (₹)` REVERTED to `total - ad.sum + discount`.** 🔴 An earlier session's "BUG FIX" removed the `+ discount` on the belief that the sheet computes `Total = Base + Add-ons`. **It also subtracts the `Discount` column**, so removing it left the on-day extra inside Base *and* applied it again — booking #60 (Harshit) read **₹20,804 against a true ₹17,852**. Base must be the LIST base: `compute_booking_total(14, 2 guests, evening, no add-ons)` = **₹8,900**, which is exactly what the restored formula writes. Confirmed live in the sheet after re-paste: Base ₹8,900 + add-ons ₹6,000 − (₹2,952) = **₹17,852**. A worked example of #60 is now in the file so nobody re-simplifies it.
- **Sheet sync bug 2 — `Nightly Rate (₹)` no longer rounded.** The sheet derives a stay's Gross as `rate × nights`, and the sync stored `Math.round(total/nights)`, so the reconstructed total drifted — worst case **+₹5.27** on #86 (15 nights). **14 confirmed stays were affected.** Only stays: the picnic branch writes `Base Package` from the real total. Worst drift now **9.09 × 10⁻¹³**. Confirmed live: Amy 7n reads ₹22,200 (was ₹22,197), 15n reads ₹47,500 (was ₹47,505), Tushar ₹11,329.
- **`Booked On` column live on both tabs**, written from `bookings.created_at` **IST-shifted** (`bookedOnDate()`), added by `ensureSheetColumns()`. 🔴 Rows entered by hand have no `_bkid` and therefore no `Booked On` — any booked-on report must fall back, not drop them.
- **`public.expenses` mirror is live and self-maintaining.** Migration `20260902_expenses_table_for_hosted_dashboard` (🔴 **filename says 09-02; it was actually applied 2026-09-03** — left as-is because it is already applied). **6 rows / ₹5,72,474**, matching the workbook exactly. RLS proven with a seeded row in a rolled-back txn: **anon 0 · non-admin authenticated 0 · admin 1**. `pushExpenses()` runs **LAST inside `syncBookings` in its own try/catch** — vindicated on its first real run, when it failed while all 41 bookings synced untouched. Cleanup deletes on a **`synced_at` watermark**, not a key list; the first version built `not.in.("a","b",…)` which `UrlFetchApp` rejects (a double quote is not a legal URL character) and which would have outgrown the URL limit anyway.
- **Four legacy sheet-only bookings backfilled: `150` Danyela, `151` Aman, `152` Harshit Agarwal, `153` Siddhart Kanungoo.** ₹62,000 revenue / ₹43,991 profit that existed only in the workbook. Inserted by direct SQL with **`on_booking_insert_notify` and `on_booking_insert_confirmed` disabled inside the transaction** (`set_booking_region` deliberately left ON so region derived) → **zero emails sent**. All four triggers verified back to `enabled` afterwards. 5 `booking_add_ons` rows (₹10,800) and 3 `booking_costs` rows added. Confirmed NCR bookings **37 → 41**; `confirmed and region is null` = **0**.
- **Booking #97 (Anil Kumar) corrected to ₹16,000** — 8 nights × ₹2,000, advance ₹8,000, 2026-09-01→09. Sheet and live agree.
- **`app.js`: editing a stay's dates no longer discards its stored total.** Both `abk-checkin` and `abk-checkout` switched from `abkChanged()` (which sets `totalTouched = false`, forcing a reprice) to `abkChangedKeepTotal()`. 🔴 **This is what silently repriced #97 from ₹8,000 to ₹78,400** when its checkout moved by four nights — `compute_booking_total(Ochre, 8n, 2 guests)` at list price. The picnic date input already used the safe variant; only the two stay inputs were wrong. Committed in `4e69969`.
- **Bookings dashboard artifact rebuilt for partners** (`picnic-bookings-dashboard`). Hero band leads with Owed to me / Booking profit / Revenue (each with a month-on-month chip) plus the next five bookings; presentation mode hides phone numbers, sync badges, mismatch tags and expense line items by default with a *Show detail* toggle; reconciliation alerts collapse to a one-line Data health strip. Added a **reporting basis switch** — event date (stays split **per night** across the months they cover) vs booked-on — and the Owed card splits picnic/stay and opens an all-periods Awaiting-payment view. Muted-text contrast raised 3.88:1 → **5.45:1**.

**built-unverified**

- The redesigned artifact and every change to it are **shipped but never seen rendering by Claude** — `verify_artifact` showed no load entry after the final publishes. Layout at real screen widths is unconfirmed.
- The `Owed to me` card, basis switch and per-night split are logic-tested (unit tests on real rows) but not eyeballed in a browser.

**NOT-done — owed**

- 🔴 **CORRECTION, same night:** the line above originally read *"the food and slot-time fields render in NO email"*. That was true of `notify-booking-confirmed` **v27**, which is what I had fetched. A PARALLEL SESSION shipped **v28 → v29 → v30** while this session was running, and `list_edge_functions` caught it before I deployed over their work. What is actually live:
  - **v28** — `slot_start_time`/`slot_end_time` override the picnic TIME row via a new `formatTime()` helper; `includes_food` + counts override the INCLUDED row, taking priority over both the multiplier path and the package-suppresses-inclusions rule; the adult-scaled footnote renders only for the computed case. Applied in **both** builders (a stay can carry `includes_food`, it just never has slot times).
  - **v29** — FIX: `includes_food=false` was ignored because the v28 else-branch only checked `!record.package_key`, so an explicit untick still inherited the venue multiplier (booking #145, venue 24, `food_multiplier` 1.5 → *"3 food items · 2 beverages"* against `includes_food=false`).
  - **v30** — the venue food/drink multiplier fallback is **GONE ENTIRELY**, per Aksheev 2026-09-02: *"venues do not include food or beverages, the booking does."* v29 only suppressed the fallback on an explicit `false`, leaving NULL open — and `submit_booking_intent` never sets `includes_food`, so every public-site booking is NULL and would still have inherited the venue default. 🔴 **Do not reintroduce a venue-metadata default without changing that business rule first.** `app.js getInclusions()` already bailed on `metadata.food_offline` (true on all six active multiplier venues), so the website had been showing no inclusions for exactly the venues the email advertised food for.
- **`notify-booking-received` v32 SHIPPED and smoke-tested 2026-09-03** (deployed by Aksheev via the Dashboard). Live-probed after deploy: **version 32, `verify_jwt: false` preserved, sha `a64e5190…` → `cab4efa5…`**, and the new code is present in the deployed source. Adds a `TIME_SLOTS` constant and `formatTime()` copied verbatim from notify-booking-confirmed v28; `slotTimeText()` (booking's own start/end wins, else the slot's default window, else omit the row); `inclusionText()` mirroring v30 exactly — no venue-multiplier fallback, `false` and `null` both render nothing. TIME + INCLUDED rows on the guest ack; Time + Includes rows on the admin alert.
  - **Smoke test through the real trigger path**: temp unconfirmed row #154 (Beige Cafe, evening, `slot 17:30–20:30`, `includes_food` 4/2) → **both legs delivered, no duplicates**; row + children deleted, residue proven **0** across bookings / booking_add_ons / venue_availability / booking_costs; confirmed NCR count unchanged at 41. Rendered email not eyeballed by Claude.
  - 🔴 **`deploy_edge_function` CANNOT be called from Cowork.** Its MCP schema is an untyped `{"type":"object"}`, so the harness stringifies `verify_jwt` and `files` and the server's Zod validation rejects both (`expected boolean, received string` / `expected array, received string`). Two attempts, identical failure. **Every future edge-fn deploy must go through the Dashboard or the CLI.**
  - 🔴 **The CLI is logged into the WRONG Supabase account.** `supabase link --project-ref evmftrogyzoudiccqkya` returns *"Your account does not have the necessary privileges"*, and the project picker only offers `hzkrqpdoipkhfsewhpou` (aks-heev's Project) and `jizthenzqaonxcxncyvs` (fresh-squeeze-prod), both org `focjdxkstsnnqcfbyrac` / `ap-south-1`. Picnic Stories is `ap-northeast-1` and is not in that org. Fix is `supabase login` with the owning account — nothing in the repo is at fault.
  - 🔴 **CORRECTION (same session): I claimed `config.toml` pins no `project_id`. That was FALSE — Aksheev checked and it is on line 5.** `config.toml` also pins `verify_jwt = false` for all four `notify-*` functions (lines 20–34) with the reasoning inline, so a plain `supabase functions deploy` already preserves the flag and the `--no-verify-jwt` I advised was redundant. The CLI showed a project picker *only* because the logged-in account lacks privileges on the pinned project, not because the pin was missing. **Read the file before asserting what is in it** — §2 applies to repo files, not just live systems.
- 🔴 **`gurkeerat45@gmail.com` received the same confirmation THREE times on 2026-09-02** (04:28, 04:29, 05:13 UTC) during that parallel session's testing. Matches the double-send flagged in memory. Unexplained — worth checking whether v28–v30 testing resent deliberately or the double-send bug is live.
- **Hosted dashboard Phases 2–4 not started.** Phase 1 (the data layer) is complete. Remaining: swap the two `callMcpTool` calls for `supabase-js` + a login gate, deploy as a **separate** Vercel project (never a route inside picnic-webapp), and decide partner access via the RLS policy.
- Carried forward unchanged: 🔴 **raise Airbnb nightly prices before 2026-09-15**; Jaipur workbook untouched since 2026-06-24 while Adhiraj holds a live Jaipur staff link; `#REF!` in the Airbnb tab's Balance Due header; booking **#61** still `preferred_date = '0026-07-25'`; `guest_count` on ids 81–89 all still `2`; commit `bb2a81f` unreviewed against §7; `supabase/functions/_shared/venue.ts:29` still shows *Your Own Space* instead of the guest's `venue_address` in custom-booking confirmations.

**Facts established by live probing this session — do not re-derive (2026-09-03)**

- 🔴 **There is NO `anon` SELECT policy on `bookings`.** Anon can INSERT only. This single fact is the only reason a publicly-reachable dashboard can be safe — **adding one would silently make customer names, phones, emails and revenue world-readable.** The same rule now applies to `expenses`.
- **`admin_select_bookings` grants `authenticated` where `auth.email() = 'aksh.eeev@gmail.com'`.** So a logged-in browser reads everything through RLS — **Supabase Auth is the auth mechanism for any hosted build; no service key belongs in a browser bundle.**
- **`post-event-nudge` matches `preferred_date`/`checkout_date` with `eq.` on exactly today−2, not a range.** Past-dated backfills can therefore never trigger it. It skips rows with no email. Review links are per city: Gurugram and Delhi share `g.page/r/CcWNZdFawDgHEAI`; **Jaipur has none** and gets a reply-to-us box until `GOOGLE_REVIEW_URL_JAIPUR` is set.
- **`booking_costs.total_cost` is a GENERATED column** — inserting into it errors `428C9`.
- 🔴 **The sync's `LOOKBACK_DAYS = 90`.** Backfilling a booking whose `preferred_date` falls inside that window makes the next sync **append a duplicate sheet row**, because it matches on `_bkid`. Either pre-seed `_bkid` before inserting, or set `created_at`/dates outside the window. This cost a duplicate-row cleanup tonight.
- **`_bkid` is a HIDDEN column** — last in both tabs, after `Booked On` (picnic **BE**, airbnb **AH**). `Booking ID` (SUN-001 etc.) is a FORMULA column and must never be typed into.
- **`add_ons` has live duplicate names** — Cake 4/24, Bouquet 5/22, Photographer 7/19, Extra Hour 11/32 (second of each is active). `ADDON_COL` in the sync maps **both generations** to the same sheet column, so either stamps correctly. Never take an add-on id from memory.
- **Vercel project `prj_WDxIggD0U392TpTM527qqKe9vui0`: SSO protection ENABLED, `all_except_custom_domains`.** That is why preview URLs 302 to `vercel.com/sso-api`. Password protection is off.
- **Cowork artifacts cannot be published publicly on any plan** — sharing is Team/Enterprise, org-internal only. The `claude.ai/code/artifact/…` links Aksheev has are regular chat artifacts, a different system.

**Process notes from this session**

- 🔴 **I misdiagnosed booking #60 twice by reasoning about what the code *should* produce instead of reading the sheet.** First I blamed the dashboard, then I told Aksheev to strip the discount term from the sheet's own formula — which would have broken the `Discount Applied` column for every future discount. Only reading the actual `Base Package` value settled it. §2 exists for exactly this; the object beats the doc, and beats my model of the code.
- **Suppressing DB triggers inside a transaction is the right tool for a backfill** — `alter table ... disable trigger` is transactional, so an exception restores them. Far better than accepting email spam or hand-entering rows.
- **`node --check` on a `/tmp` copy caught nothing here; the arithmetic tests did.** Every real bug this session (discount double-count, nightly rounding, `not.in.` URL) was found by replaying the formula against real rows in Node, not by syntax checking.

**UNCOMMITTED (verified 2026-09-03 by hashing each candidate against `git show HEAD:<file>`; HEAD = `439a07a`)**: `CLAUDE.md` and `docs/HANDOFFS.md` — this rotation only. Everything else from this session is already pushed: `app.js` in `4e69969`, and `scripts/google-sheet-sync.gs` plus both migration files in `439a07a`.

```
git add CLAUDE.md docs/HANDOFFS.md
git commit -m "Session handoff 2026-09-03: expenses mirror, sheet formula fixes, legacy backfill, admin form stay-date fix"
git push
```

CONTINUE FROM: **Aksheev** — (1) set a **Supabase Auth password for `aksh.eeev@gmail.com`** (RLS keys on that exact address; Claude cannot create accounts); (2) say yes/no to a **Vercel deploy** of the hosted dashboard as a separate project; (3) eyeball the redesigned dashboard artifact — nothing in it has been seen rendering; (4) carried forward — Airbnb prices before 2026-09-15, the Jaipur workbook, booking #61's date, `guest_count` on 81–89. **Claude** — (a) 🔴 **render the food/slot-time fields in `notify-booking-confirmed` and `notify-booking-received`** — highest priority, the fields are live and collecting data that nothing displays; (b) hosted dashboard Phases 2–4 once (1) and (2) land; (c) review `bb2a81f` against §7; (d) fix `_shared/venue.ts:29`.

*2026-07-18: CLAUDE.md restructured (rules made explicit, Definition of Done added); handoff history moved verbatim to `docs/HANDOFFS.md`.*
