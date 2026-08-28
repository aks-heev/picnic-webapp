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

## Latest Session Handoff — 2026-08-27 (Staff money row settles from the event log; dead Menu Link widget removed from admin; region-scoping Phase 1 schema+trigger live. All three deployed. 🔴 An admin reconcile money bug was FOUND and NOT fixed.)

The 2026-08-15 entry (notify-booking-confirmed v28) is now at the TOP of `docs/HANDOFFS.md`.

**SHIPPED — CONFIRMED LIVE (Vercel deploy state READY, checked 2026-08-27)**

- **Staff money row now settles from `booking_event_log`** — commit `9fb1e72`. New shared `moneyRowHtml()` in `staff.js` used by both `cardHtml()` and `stayCardHtml()`. 🔴 Root cause: `collect_on_arrival` / `balance_due` are computed in `staff_today` as `total_amount - advance_amount`, and `staff_log_step` deliberately never writes to `bookings` — so an amber "Collect on arrival ₹4,300" sat directly above "✓ Payment received ₹4,300" forever. **Part payments deliberately stay amber** and print the shortfall: `booking_event_log` has UNIQUE (booking_id, step), so no second `payment_received` row can ever arrive to correct it. Verified by 20 assertions against the real #100 (₹11,900/₹5,000/₹6,900) and #106 (₹6,300/₹2,000/₹4,300) shapes. **NOT eyeballed on a real phone.**
- **Dead Menu Link widget removed from admin booking cards** — commit `156131b4`. 26 lines of markup + two orphaned functions from `app.js`, 97 lines of `.adm-menu-*` CSS from `style.css`. 🔴 It was not merely dormant: **`.generate-menu-btn` / `.copy-menu-btn` had no click handler anywhere** — no listener, no `onclick`, no delegation, and neither function was exported to `window`. The button did nothing. `menu_links` and `orders` are **0 rows since inception**. **Deliberately left alone**: the standalone Menu Link admin tab (that one IS wired), the public `?menu=<token>` flow, `notify-menu-link`, `notify-order-received`, both tables.
- **Region scoping Phase 1** — commit `d8970d9`, migrations `region_scoping_phase1` + `region_scoping_phase1_revoke_trigger_fn`, repo file `supabase/migrations/20260827_region_scoping_phase1.sql`. Adds `venues.region` (NOT NULL, CHECK), `bookings.region` (nullable, CHECK, indexed) with a BEFORE INSERT/UPDATE trigger `set_booking_region`, and `staff_tokens.region` (nullable, CHECK). Backfill: **venues ncr=6 jaipur=19; bookings ncr=52 jaipur=6 (all 58); zero confirmed bookings with a NULL region**. Both tokens left `region = NULL` = all regions, so nothing about who-sees-what changed.
  - **Proof it is inert**: `staff_today` payload md5 (excluding `staff`, which carries a random `upload_prefix`, and `server_time`) was `7c546a97d4f65167bc00e2f62a7eb5c8` before the migration, reproduced twice, and **identical after**.
  - Six trigger branches passed in a rolled-back `DO $$`: NCR venue → `ncr`; **Delhi venue → `ncr`**; explicit region beats the venue's; `venue_id NULL` → stays NULL; venue move Gurugram→Jaipur → **re-derives**; unrelated UPDATE → untouched. CHECK rejects `'gurgaon'`. Residue zero (58 bookings, 2 tokens).
  - `bookings_set_region()` is SECURITY DEFINER **with EXECUTE revoked from public/anon/authenticated** — it must read `venues` whatever role inserts (including inactive legacy rows an RLS-filtered INVOKER read could miss), but must never be an RPC. `get_advisors` back to exactly the pre-existing warning set.

**Facts established by live probing — do not re-derive (all 2026-08-27)**

- 🔴 **`venues.city` has THREE values: `Gurugram`, `Delhi`, `Jaipur`.** The Sunroom (18, Palam Farms) is **Delhi**. Scoping staff access on `city = 'Gurugram'` would have hidden booking #100. Region (`ncr`/`jaipur`, matching `LOCATION` in `scripts/google-sheet-sync.gs`) is the only correct axis.
- 🔴 **The four staff id helpers select from `bookings` ONLY — no join to `venues`**, and all four filter `b.confirmed = true`. `staff_occupancy_upcoming` does join venues. `staff_log_step` gates writes through the same two `_active` helpers `staff_today` reads.
- 🔴 **Because the staff tool only reads confirmed rows, region only has to be correct at CONFIRMATION**, not at lead capture. `submit_booking_intent` (20 positional params) never needs touching, and the public booking flow never needs to change.
- 🔴 **`admin_add_manual_booking` and `admin_edit_booking` take jsonb payloads** — adding a region is a new key, NOT a signature change, NOT a PostgREST overload risk.
- Public custom bookings store **`venue_id IS NULL`** (`app.js`: `if (venue.type !== 'custom') lead.venue_id = venue.id`); the admin `abk` path sets `venue_id: v.id` → venue 5, which is `city = 'Jaipur'`. `app.js` resolves the custom venue twice with a singular `.find(v => v.type === 'custom')`, which rules out one-custom-venue-per-region.
- `staff_event_ids_active` has a **past-midnight grace window** (yesterday until 04:00 IST) — any region test must cover it.
- 🔴 **Correction to the 402/egress narrative**: `net._http_response` retained only 6 rows on 2026-08-23, **all `status_code` NULL with `error_msg` "Timeout of 5000 ms reached"**, all from `sync-ical-hourly`. These are **pg_net's 5-second client timeout on a slow sync-ical**, not 402s. No 402 was observed. Do not read "null status" as "quota outage".

**NOT done — owed**

- 🔴 **MONEY BUG, FOUND AND NOT FIXED.** `app.js:7133` (`stt` module) calls `sttApplyPayment(b.id, claimed)` where `claimed` is only what staff logged that day, and `admin_apply_staff_payment` does `set advance_amount = p_amount` — it **replaces, not adds**. **RESOLVED 2026-08-27**: `admin_apply_staff_payment` and the Record button were deleted outright (migration `20260827_drop_admin_apply_staff_payment.sql`); the Close Booking form now prefills its balance field from the staff-logged amount instead. #100 was closed at ₹5,000 against ₹6,900 collected and has since been corrected to ₹11,900; #106 is settled at ₹8,300/₹8,300. The `needsReconcile` test (`abs(advance - claimed) > 0.5`) also compares an incremental figure against a cumulative one and needs the same correction.
- **Region scoping Phases 2–5 NOT started** (verified via `pg_proc` 2026-08-27): all four id helpers still `pronargs = 0`; `staff_occupancy_upcoming` `pronargs = 0`; `staff_today`/`staff_log_step` contain no reference to `region`; `admin_issue_staff_token` still takes 1 arg; zero tokens carry a region. **Nothing is scoped yet — Sunny's link still returns both regions.** Plan: `docs/STAFF_ACCESS_BY_LOCATION_PLAN.md` (v3, live-verified).
- 🔴 **`set_booking_region` has never fired on a real booking.** Six branches passed, but only inside rolled-back transactions. The next genuine insert or admin edit is its first live exercise. Phase 2 assumes `bookings.region` is correct — let one real write prove it first.
- 🔴 **CORRECTION, same day — the Google Sheet sync is ALIVE and I said it was dead.** The live NCR workbook is **`1wOUzB2Y3HgQ3FnJrRmJrY7oB2zVDVeEhECjc8fjQipY`** (title `THEPIC~3`), last modified **2026-08-27 17:34Z**, holding **11 picnic bookings and 26 Airbnb stays** with a populated `_bkid` column (6, 60, 64, 65, 75, 92, 94, 100, 116 …), `Source = Website` rows carrying real Razorpay refs, and #100 already showing the corrected ₹11,900 / Completed. **How I got it wrong**: `docs/SHEET_SYNC_DEPLOY_2026-08-16.md` names two workbook IDs, I treated that doc as ground truth, and "verified" those two thoroughly — CLAUDE.md §2 exists precisely to stop this. `15DzEVgY…` is a **stale duplicate** carrying two sample rows (Garima, Rohan Mehta) that exist in no database; its 2026-06-23 timestamp is real and meaningless. Verify the object, not the doc's idea of the object.
- Neither `staff.js`'s money row nor the admin card change has been **eyeballed in a browser / on a real phone**.
- **Booking #61** (Maheep, House of Amer, Jaipur) still has `preferred_date = '0026-07-25'` — carried since 2026-08-11. It has never appeared in a "today" query and never will.
- Carried forward unchanged: 🔴 raise Airbnb nightly prices before **2026-09-15**; `guest_count` on ids 81–89; Jaipur workbook stale since 2026-06-24; commit `bb2a81f` (stay per-night pricing) still unreviewed against §7.

**Note on `app.js` mid-session**: `app.js` grew 528,298 → 535,760 bytes while this session was working, from `f5a06e9` ("Close booking: record money received"). The Menu Link removal was re-done against the fresh file, so nothing was clobbered; that commit is deployed.

**UNCOMMITTED (this rotation only — `git status` on the user's terminal is authoritative, the sandbox's is not)**: `CLAUDE.md`, `docs/HANDOFFS.md`. As of the last status seen (2026-08-27, before the user's three pushes), these were also pending and their fate is **unknown to Claude**: `.gitignore`, `scripts/google-sheet-sync.gs`, `BRUSHSCI.TTF`, `SpecialYou_Competitive_Analysis.md`, `docs/SHEET_SYNC_DEPLOY_2026-08-16.md`, `supabase/migrations/20260820_admin_add_manual_booking_skip_ical_echo.sql`, and a 0-byte stray file named `total`. Confirm before assuming.

```
git add CLAUDE.md docs/HANDOFFS.md
git commit -m "Handoff rotation 2026-08-27: staff money row, Menu Link removal, region scoping phase 1"
git push
```

CONTINUE FROM: **User** — (1) 🔴 decide on the `sttApplyPayment` money fix and do NOT tap Record on #106 meanwhile; (2) eyeball `/staff` on your phone (money row) and the admin booking card (Menu Link gone); (3) open Apps Script → Executions on either workbook and report what you see, so the sheet sync can be diagnosed; (4) carried forward — Airbnb prices before 2026-09-15, `guest_count` on 81–89, booking #61's date. **Claude** — (a) fix `sttApplyPayment` to `min(advance + claimed, total)` and the `needsReconcile` test, once the user says go; (b) region scoping Phase 2 in a FRESH session, re-probing F1–F9 in the plan first, and only after one real write has exercised `set_booking_region`; (c) review `bb2a81f` against §7.

*2026-07-18: CLAUDE.md restructured (rules made explicit, Definition of Done added); handoff history moved verbatim to `docs/HANDOFFS.md`.*
