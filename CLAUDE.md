# The Picnic Stories — Claude Working Notes

## Session Handoff — 2026-07-01 (packages: per-venue DB toggle replaces session flag)

• **Discoverability gap closed properly.** After a first pass added a venue-card badge, user corrected the actual ask: a real `venues.packages_enabled` DB column, admin-editable, as the production source of truth — not a URL/session flag. Implemented as directed; `?packages=1|0` kept as a QA override layered on top (per user's explicit choice), not removed.

• **DB migration `add_packages_enabled_to_venues` APPLIED LIVE**: `venues.packages_enabled boolean NOT NULL DEFAULT false`. RLS checked first (`admin_update_venues` is row-level only, gated by `auth.email()='aksh.eeev@gmail.com'`, no column restrictions) — no policy changes needed. `get_advisors` (security) run post-migration: zero new findings, all warnings pre-existing.

• **`app.js` flag mechanism replaced**: old `packagesEnabled()`/`PACKAGES_FLAG_DEFAULT` removed entirely (verified via grep, no remaining refs). New `packagesOverride()` reads `?packages=1|0` → persists sticky `localStorage['ps_packages']`, returns `true`/`false`/`null`. New `packageFlowActive(venue)` = `venue.type==='cafe'` gate → override if set → else `!!venue.packages_enabled`. All call sites updated (click-delegation routing handler, venue card badge, etc.) to call `packageFlowActive(venue)` instead of the old global check.

• **Admin form wired end-to-end**: `admin.html` — new `.vf-toggle-label.vf-cafe-only` checkbox `#vf-packages-enabled` next to the existing Active/Requires-confirmation toggles (hidden by default, same pattern as `.vf-partner-only`). `app.js`: `updateVfTypeVisibility()` now toggles `.vf-cafe-only` (visible only when `type==='cafe'`); `clearVenueForm()` resets it to unchecked; `populateVenueForm()` sets it from `!!venue.packages_enabled`; `handleVenueFormSubmit()` payload adds `packages_enabled` as a **top-level column** (not inside `metadata`, per user's explicit choice over the alternative of a metadata key).

• **`loadVenues()` confirmed** already `select('*')` — new column reaches the storefront/`packageFlowActive()` with no further changes needed.

• **Uncommitted this session** (rides with all prior-session local `app.js`/`style.css` packages work, see 2026-07-01 Phase 1 entry below): `app.js`, `admin.html`. Not yet browser-verified (no working sandbox browser render — see standing limitation below). Standing rules unchanged: never `git add -A`; no commit without explicit go-ahead; build/commit on Windows terminal.

## Session Handoff — 2026-06-23 (admin query pipeline: status + filter/sort + edit modal)

• **Goal**: tame the cluttered admin queries list + stop leads getting lost. Shipped admin-side lead pipeline. Customer self-confirm/self-edit was explicitly CUT (out of scope, all the risk lived there). DB migration LIVE; `app.js`/`admin.html`/`style.css` LOCAL, uncommitted.

• **DB migration `add_query_status_to_bookings` APPLIED LIVE**: `bookings.query_status text NOT NULL DEFAULT 'new'` + check constraint `IN ('new','in_talk','quoted','no_reply','lost')`. NOT-NULL-default backfilled all existing rows to `new` (4 unconfirmed + 1 confirmed). Status is ignored once `confirmed=true` (those move to bookings tab). Sort order top→bottom = new, in_talk, quoted, no_reply, lost. Status set chosen by user over a 6th "cost issue" value (kept stage-based; cost-issue is a reason, belongs in notes).

• **`app.js` (~line 3265, before `renderQueries`)**: new block — `QUERY_STATUSES`/`QUERY_STATUS_META`/`QUERY_STATUS_ORDER`, `adminQueryStatusFilter` state, `setQueryStatusFilter`, `normalizedQueryStatus`, `queryStatusSelectHtml` (inline `<select onchange=updateQueryStatus>`), `updateQueryStatus` (PATCH bookings.query_status via admin client), and the edit modal: `openQueryEdit`/`closeQueryEdit`/`saveQueryEdit` + module var `queryEditState`. `renderQueries` body now: team filter → status filter → sort by status priority then created_at desc; empty-state is filter-aware. Card header: hardcoded New dot/badge REPLACED with `queryStatusSelectHtml`. Footer: new `.adm-edit-btn`. All new fns exposed via `window.fn = fn` (module, like `setAdminTeamFilter`).

• **Edit modal** (self-contained overlay injected into `document.body`, removed on close — not a `.modal`/`.hidden` element): edits full_name, mobile (10-digit guard), email, guest_count, children_count, preferred_date, checkout_date (stays only), time_slot (cafe only, from `CAFE_SLOTS`), occasion (preset dropdown mirroring storefront + free-text "Other" fallback), celebration board (type select black/white + message → jsonb `{type,message}`, same shape as `submitBookingIntent`), special_requirements → single UPDATE on bookings. Add-ons: loads `loadVenueAddOns(venue_id)` catalog ∪ currently-attached, checkbox diff → delete removed `booking_add_ons` rows by id + insert added (price_at_booking/name/requires_confirmation from catalog). Does NOT touch `confirmed` or recompute advance (admin still types advance at confirm). RLS verified: `admin_update_bookings` + `admin_all_booking_add_ons` cover all writes.

• **Query card pricing**: header-right shows auto-computed `total_amount` + suggested 50% `advance_amount` as `.adm-price-badge--total`/`--adv` (0 → hidden for combo/partner/custom leads). Shown on ALL screens (was briefly desktop-only; user wanted it everywhere — mobile just shrinks the badge). Query card header wrapped in `.adm-card-header-right` (mirrors bookings card). Admin still types the real advance in the footer input at confirm.

• **Edit modal RE-COMPUTES pricing on save**: after the add-on diff, `saveQueryEdit` calls `supabase.rpc('compute_booking_total', {p_venue_id, p_billing_guests, p_nights, p_addon_ids, p_time_slot})` then writes `total_amount` + `advance_amount = round(total*0.5)` in the same bookings UPDATE — so editing guests/dates/slot/add-ons keeps the card price in sync (this fixed the "add-on change didn't update total/advance" bug). Param mapping MIRRORS `submit_booking_intent`: billing guests = `guests − children`, nights = `checkout − preferred` (0 if no checkout), addon_ids = final checked set. `compute_booking_total` is EXECUTE-granted to authenticated (verified); `compute_booking_advance` is NOT (don't call it — compute advance in JS). Verified live: RPC reproduces stored totals exactly for unedited bookings (ids 4,7).

• **`admin.html`**: added `.adm-status-filters` pill row (All/New/In talk/Quoted/No reply/Lost) under the team pills in the queries tab only. **`style.css`** (after `.adm-team-pill.active`): `.adm-status-filters`/`-pill`, `.adm-status-select` + `.adm-qs--*` color variants, `.adm-edit-btn`, full `.qedit-*` modal styles; `.adm-price-badge--total/--adv` (after `.adm-amount-badge`).

• **Verify done**: `node --check` clean; no smart-quote delimiters (the recurring crash); live-data check confirms cafe/custom/stay field branches. **NOT browser-tested on localhost** (needs admin login). Run `npm run build` on Windows before deploy (sandbox esbuild crashes / torn mounts). **Commit (on user go-ahead, Windows terminal, never `git add -A`)**: `git add app.js admin.html style.css CLAUDE.md && git commit -m "feat: admin query pipeline — status, filter/sort, edit modal" && git push`.

## Session Handoff — 2026-06-23 (SEO fixes: www canonical + LocalBusiness JSON-LD)

• **All changes LOCAL, uncommitted** — add these two files to the city-pages commit: `index.html`, `scripts/prerender-venues.mjs`.

• **Fix 1 (canonical www) — DONE**: `scripts/prerender-venues.mjs` line 11 fallback changed from `'https://picnicstories.com'` → `'https://www.picnicstories.com'`. All prerendered venue + city page canonicals/OG URLs will now use www on next build. Also add `SITE_URL=https://www.picnicstories.com` to Vercel env vars (user task — Settings → Environment Variables). `index.html` canonical/og:url were already www; no change needed there.

• **Fix 4 (schema swap) — ALREADY DONE**: `venueJsonLd()` in `prerender-venues.mjs` already used `'TouristAttraction'`; no change needed.

• **Fix 6 (LocalBusiness JSON-LD) — DONE**: `index.html` existing block rewritten. Was: single `LocalBusiness` with non-www url, Unsplash placeholder image, one telephone, empty sameAs, TODO comment. Now: `@graph` array with two `LocalBusiness` nodes (Jaipur + Gurugram), each with `www` url, actual hero image from Supabase storage, correct per-city telephone (`+91-92669-64666` / `+91-97737-03982`).

• **Remaining open fixes**: Fix 3 — Google Business Profile × 2 (user's manual task); Fix 7 — bundle split 525KB (Month 2).

• **Commit command** (run from Windows terminal, after prior city-pages files are staged):
  ```
  git add index.html scripts/prerender-venues.mjs docs/SEO_FIX_PLAN.md && git commit -m "feat: city landing pages + SEO fixes (www canonical, LocalBusiness schema)" && git push
  ```
  Never `git add -A`. Never commit without explicit user go-ahead.

## Session Handoff — 2026-06-22 (route-based /venues/<slug> URLs for SEO + deep links)

• **Goal = route-based venue URLs for SEO + ad/share deep links.** Chosen: build-time PRERENDER (postbuild Node script). Rejected: Next/Astro rewrite (too risky for 6,600-line vanilla app) and client-only pretty URLs (social scrapers see empty shell). Pre-existing `?venue=ID` History routing was client-only → useless for SEO. Plan/spec docs (committed): `docs/ROUTE_BASED_SEO_PLAN.md`, `docs/PRERENDER_SPEC.md`.

• **DB migration `add_venue_slug_for_routing` APPLIED LIVE**: `venues.slug text` + unique index `venues_slug_key`; backfilled from name; **collision fix** — id24 (cafe)=`house-of-amer` vs id23 (partner_bnb)=`house-of-amer-stay`; inactive dups got `-<id>`; BEFORE INSERT trigger `trg_set_venue_slug`→`set_venue_slug()` auto-slugs new venues. Admin form does NOT yet edit slug (follow-up). Active slugs: beige-cafe(14), terracottage-umber(15)/ochre(16)/sienna(17 combo), the-sunroom(18), castle-valley(19), om-niwas-suite-hotel(20), once-upon-a-time-at-the-bagh(21), countryside-offgrid(22), house-of-amer-stay(23), house-of-amer(24), om-niwas-suite-hotel-stay(25). custom your-own-space(5) excluded from prerender. `loadVenues()` is `select('*')` so slug auto-flows to storefront.

• **`app.js` routing changes**: `venueCardHtml` (~505) `<div role=button>`→`<a href="/venues/${escapeHtml(venue.slug||'')}">`; `showVenuePage` pushState `/venues/${venue.slug||venueId}` (~596); DOMContentLoaded bootstrap parses `location.pathname` `/^\/venues\/([^/]+)\/?$/`→slug lookup (~6539); legacy `?venue=ID`→`showVenuePage`+`replaceState` to slug; `popstate` resolves by slug + resets `document.title='The Picnic Stories'` on home (~6484); click delegation now modifier/middle-click aware (new-tab/copy-link work), custom CTA stays `<div>`+keydown. `style.css` `.venue-card` += `display:block;text-decoration:none;color:inherit` (anchor reset).

• **🔴→✅ app.js parse CRASH fixed (pre-existing, NOT from routing)**: smart/curly quotes (U+2018/U+2019) used as STRING DELIMITERS in Razorpay block ~2515-2569 (`rzp.on('payment.failed'…)`, `track('…')`, showToast) broke the ENTIRE app.js parse → venues/addons/testimonials/stats ALL blank on localhost (live unaffected — committed bundle had straight quotes). Fix: curly delimiters → straight `'` (kept curly apostrophes INSIDE strings like "We've" — valid). `grep \x{2018}` finds recurrences. Diagnosed via Chrome MCP console `SyntaxError @ app.js:2514`.

• **Prerender pipeline (committed)**: `scripts/prerender-venues.mjs` (NEW) postbuild — fetches active non-custom venues (`@supabase/supabase-js` + `loadEnv` from vite reusing `VITE_SUPABASE_URL`/`ANON_KEY`); clones `dist/index.html`→`dist/venues/<slug>.html` with per-venue title/desc/canonical/OG/Twitter/Product-JSON-LD (single-regex head swaps — Vite leaves those tags verbatim, verified) + injects crawlable `#venue-detail-content` block & flips active page; writes `sitemap.xml`+`robots.txt`. `package.json` build = `vite build && node scripts/prerender-venues.mjs`. `vercel.json` += `cleanUrls:true,trailingSlash:false` (kept `/admin` rewrite). `vite.config.mjs` UNCHANGED (venues dynamic → can't be rollup inputs).

• **Client routing VERIFIED on localhost:5173 (Chrome MCP)**: 12 cards = anchors w/ 12 distinct hrefs; House-of-Amer split resolves to DIFFERENT venues (Café id24 vs Partner Airbnb id23); deep links set `<title>`; `?venue=19`→rewrites to `/venues/castle-valley`; unknown slug→home fallback; click nav (no reload) + back button work. **Prerender step NOT yet verified in prod** (sandbox `vite build` crashes on esbuild).

• **🔴 CURRENT BLOCKER — Vercel build FAILED on commit `9c830cd`**: `Could not resolve "./analytics.js" from "app.js"` — `analytics.js` (PostHog wrapper, key from `VITE_POSTHOG_KEY`, NO secret) was untracked, wrongly excluded. **FIX GIVEN, not yet confirmed run**: `git add analytics.js && git commit && git push`. `app.js`'s only local import is `./analytics.js` (no other missing module — verified). After it lands: vite build resolves → prerender runs (watch log for `[prerender] wrote N venue pages`). Standing: never `git add -A` (junk: `~/`,`index.html.bak`,`logo*.png`,`.claude/`,`supabase/.temp/`,reel mp4); app.js/style.css/index.html carry prior-session work that rides along; run git/build on Windows (sandbox torn mounts + esbuild crash); Supabase project `evmftrogyzoudiccqkya`.

## Session Handoff — 2026-06-23 (SEO city pages + FOUC fix)

• **City landing pages IMPLEMENTED, LOCAL** — `/picnic-venues-jaipur` and `/picnic-venues-gurugram` generated by `scripts/prerender-venues.mjs` via new `buildCityPages()` function + `CITY_CONFIG` constant. Not static HTML — prerender script fetches live Supabase data and writes to `dist/` after Vite build. `docs/SEO_FIX_PLAN.md` updated (Fix 5 = Done). Only files changed: `scripts/prerender-venues.mjs` + `docs/SEO_FIX_PLAN.md`.

• **CSS class collision fix** — site's compiled `style.css` defines `.hero`, `.venue-card`, `.venue-section` for the SPA; city pages loading the same CSS inherited those styles, causing the hero to appear as a ~80vh empty block on mobile. Fix: all city page classes renamed with `city-` prefix (`.city-hero`, `.city-card`, `.city-section`, `.city-section--alt`, `.city-breadcrumb`, `.city-jump-btn`). Explicit `min-height:0;height:auto;display:block` on `.city-hero`.

• **FOUC fix — loading overlay on prerendered venue pages** — navigating from a city page to `/venues/<slug>` = full browser navigation; raw SEO `<h1>/<p>` content showed for 1–2s while 525KB app.js downloaded. Fix: `buildPage()` in prerender injects `#pr-loader` overlay (logo + progress bar, `position:fixed;inset:0;z-index:99999`). MutationObserver watches for first `[class*="vd-"]` element (app.js's venue detail output) → fades out in 280ms. Fallbacks: `window.load+300ms`, 6s hard cap. Prefetch: `buildCityPages()` extracts hashed app.js src from template and adds `<link rel="prefetch">` to each city page `<head>`.

• **Localhost vs prod caveat** — `npm run dev` serves SPA with history fallback so city page URLs 404 locally. Only testable via `npm run build && npm run preview`. City pages exist only in `dist/` post-build. Sitemap now emits 15 URLs (1 home + 12 venue + 2 city).

• **Commit needed** — `git add scripts/prerender-venues.mjs docs/SEO_FIX_PLAN.md && git commit -m "feat: city landing pages (Jaipur/Gurugram) + venue page loading overlay" && git push` — never without explicit user go-ahead. Run from Windows terminal only.

## Session Handoff — 2026-06-23 (SEO plan audit)

• **SEO plan audited via session transcripts** (`docs/SEO_FIX_PLAN.md` updated as source of truth). Fix 2 (GSC sitemap) confirmed ✅ done in prior session — user submitted `https://www.picnicstories.com/sitemap.xml` (non-www returns "Couldn't fetch" on GSC — don't use it). Fix 5 (city pages) ✅ code done, LOCAL. Analytics.js blocker from 06-22 confirmed resolved (user: "i've pushed the changes, and it went through fine").

• **Remaining SEO fixes:**
  - Fix 1 — Canonical www: `index.html` line 18 + og:url line 25 → `https://www.picnicstories.com/`; Vercel env `SITE_URL=https://www.picnicstories.com` (fixes all prerendered canonicals). 10 min.
  - Fix 3 — Google Business Profile × 2 (Jaipur + Gurugram) — user's manual task. Highest local search impact.
  - Fix 4 — Venue JSON-LD: swap `'@type': 'Product'` → `'TouristAttraction'` in `venueJsonLd()` in `scripts/prerender-venues.mjs`.
  - Fix 6 — `LocalBusiness` JSON-LD block in `index.html` before `</head>`.
  - Fix 7 — Bundle size 525KB (Month 2).

• **LOCAL uncommitted** — `scripts/prerender-venues.mjs`, `docs/SEO_FIX_PLAN.md`. Fixes 1 + 4 + 6 can all ride the same commit as the city pages. Standing rules: never `git add -A`; run git from Windows terminal; never commit without explicit user go-ahead.

## Session Handoff — 2026-06-29 (packages spec — SPEC_occasion_packages.md created, not yet implemented)

• **`docs/SPEC_occasion_packages.md` created** — two-part spec: (1) homepage package tiers from dev Google Doc (https://docs.google.com/document/d/1evdirE6EPEbGczo4GHhdhP1aH-NkUsA4FQnK3ubaujk); (2) occasion-based add-on pre-fill (Proposal/Birthday) from historical session analysis. NEITHER feature is built yet. Key insight from historical data: ₹180k+ of extras sold offline last year — this is a capture problem, not a demand problem.

• **Three homepage package tiers — flat rate up to 6 guests, +₹1,500/person from 7th:**
  - The Setting: setup only (teepee/flowers/candles/speaker/board/cutlery), ₹8,900, pre-fill `[]`
  - The Moment ⭐ (default): + Bouquet(22) + Cake(24) + Prints(17), ₹12,900, pre-fill `[22, 24, 17]`
  - The Story: + Photographer(19) + Skyshots(27) + Cold Pyros(23) + Bouquet + Cake + Prints, ₹24,900, pre-fill `[19, 27, 23, 22, 24, 17]` — all instant-confirm

• **UI (from dev spec)**: new "Our Packages" section on homepage between "Choose Your Venue" and "Make it Yours"; 3 horizontal cards → single column mobile; The Moment gets 2px accent-blue border + "Most popular" badge; single "Book Now →" CTA opens booking form with package pre-fill via `PACKAGE_PREFILL` JS map

• **Booking form**: `PACKAGE_PREFILL = { setting: [], moment: [22,24,17], story: [19,27,23,22,24,17] }` → `applyPackagePrefill(packageKey)` pre-ticks add-ons; occasion pre-fill runs after and can override; `compute_booking_total` RPC needs no changes. Never auto-select IDs 29/30/32 (requires_confirmation=true).

• **Open question before build**: package flat pricing (₹8,900/12,900/24,900) vs existing per-guest `compute_booking_total` model — need to decide how to reconcile. Photographer (id:19) is `requires_confirmation=false` in DB — verify operationally before The Story goes live as instantly confirmed.

• **Commit status**: `docs/SPEC_occasion_packages.md` is new/untracked. Add to next commit alongside other pending local files.

## Session Handoff — 2026-06-30 (packages feature — design locked: universal tiers + venue-page pricing; nothing built)

• **Goal = raise AOV.** Decided: packages are a **front door on the existing booking engine**, NOT a pipeline replacement (user floated ditching the pipeline; rejected — would discard availability logic, Razorpay+webhook, SEO `/venues/<slug>` pages, admin tooling to solve a curation/attach problem). Top AOV lever = defaulting **Photographer (id 19, ₹6,000)** ON for proposals (sold 11× offline, ~never online, 4× next add-on; proposals = 28% of bookings).

• **Pricing RESOLVED — no price matrix.** A tier = a curated add-on preset; per-combo price = existing `compute_booking_total(p_venue_id,p_billing_guests,p_nights,p_addon_ids,p_time_slot)` which already returns a unique price per venue+add-on set. "From ₹X" = min across venues at base guests. Spec's flat ₹8,900/12,900/24,900 are **fictional** — ₹8,900 is below the real ₹9,900 floor (cheapest venue base @2 guests: Beige(14)/Castle Valley(19)/House of Amer(24)). Live cafe/self_managed bases: Beige 9900, Sunroom(18) 13900, Om Niwas(20) 12900, Once Upon A Time(21) 15900, TerraCottage Umber(15) 10900/Ochre(16) 7900; per-guest `metadata.tiers`.

• **Tier model RESOLVED → fixed universal `Setting/Moment/Story`** (NOT bespoke per-occasion Capture/Party). Forced by deciding to **show tier prices on the venue detail page**: prices are stable only if tier contents are occasion-independent. Sets: `setting:[]`, `moment:[22,24,17]`, `story:[19,27,23,22,24,17]`. Corrected "from": Setting ₹9,900 · Moment ~₹13,500 · Story ~₹26,000 (@2 guests; firm up after guest selection like the existing "starting price"). Occasion demoted to a **default-biasing nudge** (Proposal→default Story/ensure Photographer; Birthday→default Moment), not a tier system. Tradeoff accepted: loses bespoke curation story for stable pricing + one vocabulary + path consistency.

• **Two converging paths.** Home: "Our Venues" + "Our Packages". Packages-first: occasion → tier(from ₹X) → venue(price firms) → form. Venue-first: venue page shows 3 tiers w/ this-venue prices → tier → form. **Keystone:** `appState.selectedPackage = {occasion,tierKey,addonIds}`; booking form reads ONLY this; both paths write it (prevents drift). Add-ons venue-scoped (`loadVenueAddOns`) → pre-tick = tier IDs ∩ venue's available add-ons. All universal-tier IDs verified `requires_confirmation=false`; never pre-fill 29/30/32.

• **Hardened plan (plan-optimizer 87/100, `64→78→85→87→87`). NOTHING BUILT.** Phase 1 = venue-first tier selector in booking form (occasion `<select>` at app.js ~L2008 currently only toggles "Other" → upgrade to render tier cards + pre-fill via `.bv-addon-check[data-addon-id]`, `updateBookingSummaryPrice()`); reuses live form+RPC, no new nav, ships AOV lever fastest. Phase 2 = "Our Packages" front door (index.html between "Choose Your Venue" L223 and addons-strip L241; CSS `pkg-` prefix vs SPA collision). Phase 3 = verify + PostHog (`package_tier_selected`,`addon_attach`,`zero_addon_booking`). Standing rules: never `git add -A`; build on Windows (sandbox esbuild crash/torn mounts); U+2018/U+2019 as string delimiters crash app.js (recurring); edit app.js via file tools only. **NEXT:** get explicit go-ahead to lock universal tiers + venue-page pricing, update `docs/SPEC_occasion_packages.md`, start Phase 1.

## Session Handoff — 2026-06-30 (lock-but-unpaid email format — DEPLOYED v27)

• **Copy correction (v27)**: investigated whether an unpaid `lock` blocks the date — it does NOT. `get_booked_dates` and the submit-time freshness check both filter `confirmed = true` only; `confirmed` flips true only on payment (verify-payment / razorpay-webhook `payment.captured`) or admin confirm. So payment IS the lock — the system already only reserves on paid. The earlier lock-email lines implied a hold-that-gets-released (false). Fixed the two lock-variant lines to state the real rule: heroSub → "your date isn't reserved until payment is complete — pay the advance below to secure it now"; payCaption → "Your date isn't held until payment is complete. Pay now to lock it in before someone else does." (Honest + real first-to-pay-wins urgency.) DECISION: do NOT build a real hold/expiry — it would reserve dates for non-payers (the risk we were avoiding). Current no-hold-until-paid behavior is correct.
• **PARKED bug**: payment confirm (verify-payment / webhook) flips `confirmed=true` WITHOUT re-checking availability → two guests could both pay the same date = double-booking. Rare at current volume; real risk, separate from copy.



• **Problem**: a lock-intent lead that hasn't paid (`customer_intent='lock' && confirmed=false`, e.g. booking #14 Samradh Sharma) got the generic QUERY guest email, and the admin email labelled it `New 🔒 Booking` — looked confirmed though unpaid. Fixed by adding a dedicated lock-but-unpaid format for both guest + admin.

• **`notify-booking-received` → v26 DEPLOYED LIVE** (`verify_jwt=false` preserved; webhook-triggered). Source of truth = deployed; local `supabase/functions/notify-booking-received/index.ts` matches (uncommitted). Changes:
  - Three-way state at INSERT: `adminState = confirmed ? 'booking' : isLock ? 'lock_unpaid' : 'query'`.
  - Guest email: old `buildQueryHtml` → parametrized `buildGuestHtml(record, …, variant)`. `variant='lock'` → subject "You're almost booked — pay to confirm 🧺", hero "you're almost booked… pay soon to avoid losing your slot", heading "Your Booking", pay-first "What happens next" steps, pay button caption in accent rose with soft-urgency line. `variant='query'` = unchanged enquiry ack (keeps the earlier optional pay button when advance>0). Pay button shows when `advance>0` (was the prior uncommitted edit, now folded in).
  - Admin email: `lock_unpaid` → amber banner ("Guest chose to lock this date but hasn't paid… slot is NOT held until paid"), heading "⏳ Lock — PAYMENT PENDING #id", subject "⚠️ Unpaid lock from NAME — date · ₹X pending". `booking` (paid) → "🔒 Booking (paid)". `query` → "📋 Query". 

• **User-chosen copy**: framing = "almost there, pay to confirm now" (no claim the date is held); soft urgency "pay soon to avoid losing your slot" (no hard 24h deadline).

• **Validation**: bash mount serves a TORN/truncated copy of this file (stops ~line 419) → `deno check` over the mount falsely reports "Unexpected eof". Real file (file tool) is 455 lines & complete. Validated by reconstructing in `/tmp/fn/` (head -419 of mount + verified tail + the 3 `_shared` deps) → `deno check` clean, no smart-quote delimiters. Deployed bytes re-fetched & confirmed correct.

• **Commit (user go-ahead given)** — run from Windows terminal, never `git add -A`:
  `git add supabase/functions/notify-booking-received/index.ts CLAUDE.md && git commit -m "feat: lock-but-unpaid email format (guest + admin) in notify-booking-received" && git push`
  ⚠️ `index.ts` was already modified pre-session (the pay-button edit) — it's all in this one file now, so this commit captures both. `supabase/functions/` is largely untracked (verify-payment, `_shared`, notify-* never committed) — the scoped path above only stages this one file.

## Session Handoff — 2026-06-30 (packages plan from scratch + Phase 0 pricing/food groundwork)

• **Packages re-planned from scratch** (user: "truly start over"). Grounding reality from live DB: only 12 leads / 1 confirmed sale over 7 days → AOV lift is an explicit faith bet, NOT data-proven (the old `SPEC_occasion_packages.md` leaned on offline numbers + fictional flat pricing — both contradicted by live data). New spec: `docs/SPEC_packages_mvp.md` (LOCAL, untracked; supersedes the old one). Plan-optimizer hardened `64→78→85→87`.

• **Locked design:** themed tiers `setting:[]` / `moment:[22,24,17]` / `story:[19,27,23,22,24,17]` (occasion = label + default-nudge: Proposal/Anniversary→story, Birthday/DateNight→moment, else setting). Cafe-only scope (kills cross-type + cafe-only-add-on breakage; cafe-only add-ons = 23,25,26,27,30,32). Locked bundles (booking form: drop occasion field, show package summary, hide included add-ons, show only remaining). ALL add-ons allowed, no approval (gated 29/30/32 still auto-confirm; admin gets a loud flag). BOTH flows Phase 1: venue-first AND homepage packages-first, both reordered → venue+occasion+guests known → tier(priced) → form. Deep-link/SEO entries (`/venues/<slug>`, `?venue=ID`) fall back to The Setting/no occasion + venue page surfaces tiers.

• **Pricing model decided (NOT applied — user's MANUAL admin task):** setup-only base flat for 1–6 guests (Beige=₹8,900 confirmed; others per-venue, differ), +₹3,000 per 3 beyond 6 (flat across venues), food/drinks removed→offline. DATA-ONLY: `compute_booking_total` prices entirely off `metadata.tiers` (food_multiplier doesn't affect price). Per-venue runbook in spec: base_price=BASE, tier rows `6→BASE, 9→+3000, 12→+6000, 15→+9000, 18→+12000`, overage `1000`. Active cafe venues: 14,18,19,20,21,24. ⚠️ re-prices live bookings instantly per venue on save; reversible by re-entering old tiers. After user enters a venue → verify `compute_booking_total(id,2/6/7/9/12,0,'{}','<slot>')`.

• **3 fixes DONE this session — app.js LOCAL/uncommitted + 1 SQL LIVE; `node --check` clean:**
  - `getInclusions` (~169): added `if (m?.food_offline) return null` — hides inclusion banner reversibly, multipliers retained.
  - `handleVenueFormSubmit` (~5623): `const originalMeta = (id ? venueManagerState.venues.find(v=>v.id===parseInt(id,10))?.metadata : null) || {}; let metadata = {...originalMeta, tiers, overage_per_person:overage, includes:splitCsv('vf-includes')}` — admin save now MERGES (was destructive replace that wiped unmanaged metadata keys; latent bug, now fixed). Preserves food_multiplier/drink_multiplier/food_offline across admin saves.
  - SQL LIVE: `food_offline:true` set on venues 14,18,19,20,21,24 (food_mult 1.5 / drink 1 retained — user wants re-enable-later).

• **Live-state caveat:** `food_offline` flag is LIVE in DB but the banner-hide code is LOCAL → inclusion banner still shows on the live site until build+deploy. No breakage in between. Uncommitted files this session: `app.js`, `docs/SPEC_packages_mvp.md`. Standing rules unchanged: never `git add -A`; build/commit on Windows (sandbox esbuild crash/torn mounts); no commit without go-ahead; U+2018/U+2019 as string delimiters crash app.js; project `evmftrogyzoudiccqkya`. **NEXT:** user enters tier rows/base prices in admin → I verify; Phase 1 build starts by verifying app.js anchors (occasion select, `.bv-addon-check[data-addon-id]`, `updateBookingSummaryPrice`, `showVenuePage`, `venueCardHtml`).

## Session Handoff — 2026-07-01 (packages Phase 1 venue-first slice — BUILT + browser-verified, uncommitted)

• **Phase 1 venue-first packages BUILT + browser-verified** working on localhost (The Sunroom). LOCAL/uncommitted: `app.js`, `style.css` (+ prior-session uncommitted `app.js`/`docs` rides along). Scope decided this session with user: **venue-first ONLY, behind a flag** (NOT both flows — 12 leads/1 sale = unproven bet, keep live-flow change minimal). Also decided: build UI now; prices self-correct once Phase 0 pricing entered.

• **Flow (cafe + flag only):** venue → calendar (date+slot) → guest step (NEW occasion `<select>` → `window.setBookingOccasion` → `appState.bookingOccasion`) → `showPackageStep` (3 priced tier cards) → `showBookingForm` (locked bundle). Non-cafe / flag-off = existing flow untouched. **Packages are NOT on the venue landing** (user's "I don't see packages" = they appear only after 2× Book Now). Routing hook = click handler guests-branch: `if (packagesEnabled() && venue.type==='cafe') showPackageStep(venue) else showBookingForm(venue)`.

• **Feature flag:** `PACKAGES_FLAG_DEFAULT=false` (live unchanged on deploy). `packagesEnabled()` reads `?packages=1|0` → persists `localStorage['ps_packages']`, sticky. Test `…/venues/<slug>?packages=1`. Config block placed BEFORE `CAFE_SLOTS`: `PACKAGE_TIERS {setting:[], moment:[22,24,17], story:[19,27,23,22,24,17]}`, `PACKAGE_TIER_ORDER`, `OCCASION_DEFAULT_TIER` (Proposal/Anniversary→story; Birthday/DateNight/Bridal/Baby→moment; else setting), `defaultTierForOccasion()`.

• **Load-bearing impl (regression ≈ zero):** tier's included add-ons render as REAL `checked` `.bv-addon-check` inputs (CSS-hidden `.pkg-locked-check`, shown read-only in `.pkg-included-*` section) → existing `updateBookingSummaryPrice` + `handleInlineBookingSubmit` count/persist them with ZERO logic change. Occasion → `<input type=hidden name=occasion>` when package (submit path unchanged). Accordion filters out `lockedIds`. `appState.selectedPackage={occasion,tierKey,addonIds}` + `bookingOccasion`; reset in `showVenuePage`. Window exposures: `setBookingOccasion`, `showPackageBack`, `selectPackageTier`. ⚠️ `appState` NOT on window (ES module) — inline handlers MUST call window fns. Tier card price computed CLIENT-SIDE = `getPicnicPrice(adults) + Σ tier add-on catalog prices` (matches form total exactly; RPC not used for display).

• **Pricing verified live:** `compute_booking_total(venue,billing_guests,nights,addon_ids[],slot)` returns 0 unless slot ∈ {morning,afternoon,evening}; Beige(14)/Castle(19) @2/4/6 = 9900/12900/15900, Moment +3100, Story +16100 (flat across guests). ⚠️ **Phase 0 pricing NOT applied** — tiers still food-inflated stepping (every 2g +3000, cap 6–8g); `food_offline:true` set on 14,18,19,20,21,24 but base tiers unchanged. Cards show current prices, self-correct after user's manual admin Phase-0 entry. Browser-verified on The Sunroom: cards ₹13,900/17,000/30,000, badges (Most picked / Suggested), occasion capture, locked total ₹17,000, +Photographer extra=₹23,000. `node --check` clean, no U+2018/U+2019 delimiters. Fixed sidebar 3-across overflow → `.pkg-cards` single column.

• **NOT built (deferred):** homepage packages-first entry; admin loud-flag for gated add-ons 29/30/32; surfacing tiers on venue detail page for deep-links. **CONTINUE FROM:** slice done+verified, flag OFF, nothing committed — user decides: commit `app.js`+`style.css` (+pending prior files, never `git add -A`, Windows terminal, go-ahead required), OR add prominence (tiers on venue detail page / full-width), OR do Phase 0 manual admin pricing then re-verify `compute_booking_total`.
