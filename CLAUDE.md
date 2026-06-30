# The Picnic Stories — Claude Working Notes

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

## Session Handoff — 2026-06-14 (Razorpay webhook backstop + admin payment status — webhook LIVE & verified, frontend uncommitted)

• **Feature shipped & VERIFIED LIVE: server-to-server `payment.captured` backstop** so booking confirmation no longer depends on the customer's browser. Proof → booking **id=106**: `confirmed=true, payment_status=paid, razorpay_order_id/payment_id set, razorpay_signature=NULL`. The null signature is the tell — `verify-payment` always writes the signature, the webhook can't — so the webhook confirmed it after the user closed the tab mid-success. Logs: `razorpay-webhook 200` → `notify-booking-confirmed 200` ~1.5s later (trigger fired, one email, no duplicate). (Booking 104 = earlier normal completion, HAS signature; booking 105 = abandoned lead, correctly left unconfirmed.)

• **Edge fns DEPLOYED** (`evmftrogyzoudiccqkya`): `create-order` → **v6** (`verify_jwt=true`) now derives `bookingId = receipt.slice("booking_".length)` and sends `notes:{booking_id}` on the order so the payment entity carries it (response shape unchanged, no frontend change). `razorpay-webhook` → **v1, `verify_jwt=false`** (NEW, source at `supabase/functions/razorpay-webhook/index.ts`): reads RAW body, `HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)` vs `x-razorpay-signature` (timing-safe, helpers copied from verify-payment); on `payment.captured` PATCHes `bookings?id=eq.<entity.notes.booking_id>&confirmed=eq.false` → `{confirmed:true, payment_status:'paid', razorpay_order_id, razorpay_payment_id}` (no signature — acceptable); `payment.failed` → `{payment_status:'failed'}`; returns 200 for authed no-ops, 400 bad sig, 500 if secret unset. `&confirmed=eq.false` guard makes it idempotent vs client `verify-payment` — whoever arrives first flips the row, second no-ops, order irrelevant.

• **User config DONE** (webhook returned 200 not 400 ⇒ secret + dashboard are correct): `RAZORPAY_WEBHOOK_SECRET` set as Supabase fn secret; webhook added in Razorpay dashboard → URL `https://evmftrogyzoudiccqkya.supabase.co/functions/v1/razorpay-webhook`, events `payment.captured` + `payment.failed`.

• **Feature A — admin payment badges (frontend, LOCAL/uncommitted)**: new `paymentBadgeHtml(b)` helper in `app.js` just above `occasionBoardHtml` (~3238) → Paid/Pending/Failed pills + optional `razorpay_payment_id` `<code>` chip; rendered in `renderQueries` header-left (after "New" badge) and `renderBookings` header-right (before `adm-amount-badge`). `style.css`: `.adm-pay-badge` + `.adm-pay--paid/pending/failed` (reuse `--color-success/warning/error-rgb`) + `.adm-pay-id`, inserted just before `.adm-amount-badge`. `node --check` clean on app.js.

• **Commit status — NOT committed (user reviewing /git-commands)**. Recommended scoped commit: `git add app.js style.css supabase/functions/create-order supabase/functions/razorpay-webhook`. ⚠️ `app.js`/`style.css`/`index.html` carry MULTIPLE prior sessions' uncommitted work (app.js diff 156/172 lines) → committing drags it all along (unavoidable w/o `git add -p`). Entire `supabase/functions/` tree is untracked (verify-payment, `_shared`, notify-* never committed). JUNK — never `git add -A`: `index.html.bak`, `logo.png.png`, `logo3.png`, `~/`, `supabase/.temp/`, `.claude/settings.local.json`. `.env.example` is clean (placeholders only); `.env.local` correctly gitignored.

• **Caveats / standing rules**: `notes.booking_id` only rides orders created AFTER create-order v6 — a pre-v6 order captured later hits the webhook with no booking_id → logged & ignored (200), won't retro-confirm. Secrets need `.trim()` (trailing newline 401'd KEY_ID historically; set with `printf %s`). Bash sandbox serves TORN copies of `app.js`/`index.html` → `npm run build` fails on phantom EOF; **run build LOCALLY before deploy**. Edit `app.js` (6,200 lines) via file tools only, never bash. Edge-fn source of truth = deployed (`get_edge_function` before editing). Never commit/push without explicit user go-ahead.

## Session Handoff — 2026-06-15 (admin venue form fixes, multi-upload, menu strip)

• **All changes LOCAL, uncommitted** — `git add app.js admin.html style.css && git commit && git push` covers everything from today. Razorpay already committed (`cfe0d34`, `0f8f351`) — confirmed via `git log`.

• **Bug fixed — venue edit wiped fields**: `loadVenueManager()` `.select()` was missing `maps_url, setting, requires_confirmation, team_id` → they came back `undefined` → form cleared them → save wrote `null`. Fixed at `app.js` line ~4291.

• **Admin venue form additions**: Copy button on maps URL field (`admin.html` + `.vf-copy-btn`/`.vf-input-row` in `style.css`); shows ✓ for 1.2s on click.

• **Multi-file image upload** (`app.js`): "Add Images" / "Add Menu Pages" buttons are now `<label>` wrapping `<input type="file" multiple>` (`admin.html`). Handler `addVfImagesMulti(input, type)` pre-renders placeholder rows for all files then uploads in parallel via `Promise.all`. `{ url, alt, name }` — `name` field added to image objects, stored in `.vf-img-name` hidden input, shown below thumbnail as `.vf-img-filename` (10px muted, truncated, 64px wide). Filename written by multi-add and single-replace handlers; preserved through drag-reorder. Existing images without `name` show no label.

• **Menu section redesign** (`app.js` ~line 760): venue page now shows 3 preview thumbs in `.vd-menu-strip` (no wrap) + optional `+N more` tile (dashed rose border) → opens lightbox at page 4 + `"View full menu · N pages →"` text link below. Heading changed to "Our menu", subhead "Browse before you book · N pages". `style.css`: `.vd-menu-strip`, `.vd-menu-view-all`, `.vd-menu-thumb-more`, `.vd-menu-more-count/label` added; `flex-shrink:0` added to `.vd-menu-thumb`.

• **Bash sandbox stale-mount (standing caveat)**: `git diff` in sandbox shows phantom large deletions (truncated file view). Actual Windows files are intact — verified via Read tool. Always run git in Windows terminal, never bash sandbox. Edit `app.js` (6,378 lines) via file tools only.

## Session Handoff — 2026-06-15 (Terracottage venue rename)

• **Rename COMPLETE — DB live, code + docs updated**: The Gathering (id=15) → Terracottage Umber, The Nook (id=16) → Terracottage Ochre, The Reunion (id=17) → Terracottage Sienna. Terra cotta-themed stays branding; Ochre/Sienna/Umber chosen as coherent artist-pigment trio over Olla/Tinaja/Silt.

• **DB**: `UPDATE venues SET name = CASE id WHEN 15 THEN 'Terracottage Umber' WHEN 16 THEN 'Terracottage Ochre' WHEN 17 THEN 'Terracottage Sienna' END WHERE id IN (15,16,17)` — confirmed live.

• **Code**: `app.js:3196` combo floor note → "Terracottage Ochre + Terracottage Umber"; `supabase/functions/_shared/venue.ts:9` comment example updated.

• **Docs**: all old names replaced (replace_all) in `SPEC_parent_child_listings.md`, `SPEC_hold_action_and_admin_ui.md`, `LINKED_LISTING_PLAN.md`, `PLAN.md`, `STAGE0_ICAL_ROUNDTRIP.md`.

• **All changes LOCAL, uncommitted** — git commit block generated (covers 5+ sessions of accumulated work). ⚠️ Run from Windows terminal only — bash stale-mount shows phantom truncations in app.js/admin.html. Never `git add -A`; exclude: `~/`, `index.html.bak`, `logo.png.png`, `logo3.png`, `"ChatGPT Image..."`, `picnic-reel-gathering-15s.mp4`, `supabase/.temp/`, `.agents/`, `.claude/settings.local.json`.

## Session Handoff — 2026-06-20 (UX fixes + DB corrections)

• **Gurugram team filter (DB fix, live)** — all venues still had `team_id=1` (Jaipur) despite 06-13 handoff claiming it was fixed. Corrected: `UPDATE venues SET team_id = 2 WHERE id IN (14,15,16,17,18)` (Beige Cafe, Terracottage Umber/Ochre/Sienna, The Sunroom).

• **Cafe food/drink multipliers (DB fix, live)** — 6 cafe venues (IDs 14,18,19,20,21,24) had no `food_multiplier`/`drink_multiplier` in metadata → inclusion banner showed nothing. Fixed: `metadata || '{"food_multiplier":1.5,"drink_multiplier":1}'` for all cafe venues where missing. Formula: food = ceil(guests × 1.5), drinks = guests × 1.

• **`app.js` changes (LOCAL, commit prepared)**: (1) `renderSuccessPage` — success page contact number was hardcoded `+91 99999-99999`; now resolves via `venueTeamId` → `appState.teams.find(t => t.id === venueTeamId)?.phone`, fallback Jaipur `+91 92669-64666`. (2) My Bookings `💰` advance line — was showing on all bookings including unconfirmed queries; now conditional: `b.confirmed && b.advance_amount > 0` only. (3) Venue detail section order — "What's included" moved above "Our menu" (was below "The Property").

• **`index.html` (LOCAL, commit prepared)** — OG/Twitter share image updated from Unsplash stock (`photo-1530103862676`) to actual hero: `https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/site-images/hero/main.jpg`. Removed explicit `og:image:width/height`. WhatsApp caches aggressively — use Facebook Sharing Debugger to force refresh after push.

• **Commit prepared, not yet pushed**: `git add app.js index.html CLAUDE.md package-lock.json` — run from Windows terminal only.

## Session Handoff — 2026-06-20 (booking-log workbooks + Supabase→Sheets sync + total_amount backend)

• **Deliverables live in Cowork outputs, NOT the repo**: two location-scoped manual booking workbooks `The Picnic Stories - Jaipur.xlsx` + `The Picnic Stories - Gurugram & Delhi.xlsx` (tabs: Guide/Dashboard/Picnic Bookings/Airbnb Bookings/Expenses/Partner Ledger/hidden Lists), plus `BookingSync.gs` (Google Apps Script sync), `SETUP_google_sheet_sync.md`, `SCOPE_totals_and_addons_sync.md`. Generators: `outputs/build_final.py` (workbooks) → `outputs/post_fix.py` (Google-Sheets-safe add-on formula). Purpose: log direct/phone bookings manually + auto-pull website bookings. Bash sandbox FREEZES a .py mount after run+edit (serves torn/truncated copy) → always write a NEW filename for fresh reads.

• **Backend "Option B" SHIPPED LIVE** (migration `add_total_amount_and_pricing_total`): added `bookings.total_amount numeric` (nullable). New `compute_booking_total(p_venue_id,p_billing_guests,p_nights,p_addon_ids,p_time_slot)` returns full price (unrounded). `compute_booking_advance` REFACTORED to thin wrapper `round(coalesce(compute_booking_total(...),0)*0.5)` — advance output verified byte-identical to pre-change baseline across 15 bookings (live pricing unaffected). RPC `submit_booking_intent` now computes `v_total` + inserts `total_amount`. Backfilled `total_amount = advance_amount*2` for cafe/self_managed = 88/95 rows, 0 mismatch; 7 left null (5 query-leads adv=0, 2 legacy null-venue id 47/48) — correct.

• **Pricing/add-on facts**: advance = exactly half total for `cafe`(with time_slot) and `self_managed`(with nights); returns 0 for combo/partner_bnb/custom (manual query leads). Add-ons were ALREADY persisted in `booking_add_ons` (addon_id, price_at_booking) — never a gap (earlier "not stored" claim was wrong). Active add-on catalog has duplicate inactive ids; `BookingSync.gs ADDON_COL` maps BOTH old+new ids → the 16 picnic tick-columns.

• **Routing source of truth = `venues.city` + `venues.type`** (NOT the teams join — `venues.team_id=1` for ALL venues currently, observed live, contradicts 06-20 UX-fixes handoff above). city: Jaipur→jaipur sheet, Delhi/Gurugram/Noida/Faridabad→ncr sheet. type: cafe/custom=picnic tab; self_managed/partner_bnb/combo=stay tab; any `checkout_date`=stay. Active venues seeded in each Lists tab: JAI picnic=Castle Valley/House of Amer/Om Niwas Suite Hotel/Once Upon A Time At The Bagh/Your Own Space, JAI stays=House of Amer(Stay)/Om Niwas Stay; NCR picnic=Beige Cafe/The Sunroom, NCR(Gurugram) stays=Terracottage Umber/Ochre/Sienna+Countryside Offgrid. (Many old Jaipur venues are `is_active=false`.)

• **Sync mechanics** (`BookingSync.gs`): one-way Apps Script timer pull, confirmed/paid only (`or=(confirmed.eq.true,payment_status.eq.paid)`), per-sheet `LOCATION='jaipur'|'ncr'`. Writes INPUT cols only — sheet formulas compute Booking ID (`CODE-001` per venue via VLOOKUP Lists code table + COUNTIF), totals, balances, margin. Picnic: Base Package=total−addons + ticks add-on cols; Stay: Nightly Rate=round(total/nights). Dedup via hidden `_bkid` col the script self-creates. service_role key in Script Properties (`SUPABASE_SERVICE_KEY`).

• **Google-Sheets conversion gotcha (current blocker)**: an uploaded .xlsx opened in Drive Office-compat mode shows cached blank formula values and won't recalc on edit → user MUST do **File ▸ Save as Google Sheets** and work in the converted copy. Add-on total formula was changed from inline array constant `{500,500,…}` to price-range `Lists!$T$2:$AI$2` (16 prices written to Lists T2:AI2) for conversion safety. Grey/formula columns trigger on Customer Name (picnic) / Guest Name (stay) in col E. User had filled rows in the UN-converted file → those won't carry into the converted copy; offered to load their rows into the workbook before they convert.

• **Next**: user picks — re-enter rows in converted Sheet, or send filled rows/file for me to load pre-conversion. Then Google-side setup (import each workbook → convert → paste `BookingSync.gs` → set `LOCATION` → add service_role key → 15-min trigger). Optional follow-ons: surface `total_amount` in admin booking list + confirmation email; dry-run sync validation against real bookings (e.g. id 120/121).

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

## Session Handoff — 2026-06-30 (lock-but-unpaid email format — DEPLOYED v26)

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
