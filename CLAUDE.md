# The Picnic Stories — Claude Working Notes

## Session Handoff — 2026-06-09 (earlier)

• **Project**: Vanilla-JS Vite SPA (`D:\Projects\picnic-webapp`), multi-page build (`index.html` + `admin.html`), deployed on Vercel. Supabase project `evmftrogyzoudiccqkya` (ap-northeast-1). Site live at `picnicstories.com`.

• **CRITICAL — file editing rule**: `app.js` is 5,335+ lines; bash sandbox shows a stale/truncated version (~5,304 lines). **Never edit `app.js` or run builds via bash** — always use Read/Edit/Write file tools. File tools are source of truth.

• **ES module exports**: functions in `app.js` are not auto-global. Any function called via inline `onclick` must be explicitly assigned: `window.fnName = fnName` in the exports block (~line 5127). Missing exports = silent `ReferenceError` in browser.

• **Completed this session** (all committed + pushed):
  - Domain: all URLs/canonical/JSON-LD updated to `picnicstories.com`; `team@picnicstories.com` in footer + JSON-LD
  - Venue admin: active-first ordering + drag-to-reorder (`sort_order int4` column added to `venues` table); `renderVenueList` + `saveVenueOrder` in `app.js`
  - Window exports added: `handleNavigation`, `copyMenuLink`, `customerSignOut`
  - CSP fixed in both HTML files: `ws://localhost:* wss://localhost:*` added to `connect-src`
  - All 4 edge functions redeployed: sender = `The Picnic Stories <team@picnicstories.com>`, APP_URL fallback = `https://picnicstories.com`; "Picnic Story" typo fixed in `notify-menu-link`
  - Resend domain verified for `picnicstories.com`; Vercel domain live
  - `children_count integer NOT NULL DEFAULT 0` added to bookings table
  - `free_children_count: 2` added to all venue metadata
  - `notify-booking-received` + `notify-booking-confirmed` show "X adults · Y children (first 2 free)" — both deployed as v9 (ACTIVE)

• **Venue IDs**: Gathering=15, Nook=16, Reunion=17 (handoff doc had Nook/Gathering swapped — trust these IDs)

• **Edge functions** (`supabase/functions/`): each has its own copy of `_shared/resend.ts`, `_shared/venue.ts`, `_shared/addons.ts`. Changes to shared files must be redeployed to all 4 functions: `notify-booking-received`, `notify-booking-confirmed`, `notify-menu-link`, `notify-order-received`.

## Session Handoff — 2026-06-09 (latest)

• **Pricing fix — code done, commit blocked**: `getPicnicPrice(venue, adults, children)` written at app.js ~line 149. Replaces `calcBillingGuests`. Tier price based on adults only; each paid child (3rd+) adds `overage_per_person × 0.5`. All 5 call sites updated to `const picnicPrice = getPicnicPrice(venue, appState.adults, appState.children)`.

• **To unblock commit**: delete `D:\Projects\picnic-webapp\.git\index.lock` (Windows side — sandbox can't remove it), then: `git add app.js && git commit -m "fix: price paid children at overage_per_person x0.5" && git push`. Vercel auto-deploys on push.

• **Pricing logic**: `getPicnicPrice` = `getVenuePrice(venue, adults)` (integer tier lookup) + `max(0, children - free_children_count) * overage_per_person * 0.5`. Sunroom example (overage=₹2,000): 2A+3C → ₹11,900 + ₹1,000 = **₹12,900** (was ₹14,900 full tier jump). Monotonically increasing, no inversions.

## Session Handoff — 2026-06-09 (Indoor/Outdoor venue split)

• **Feature**: Home gallery (`#venues-grid`) now groups active venues into Outdoor → Indoor sections + a standalone custom CTA. Driven by a new `setting` column, **decoupled from `type`** (type = ownership/booking model; setting = physical location — orthogonal axes, do not conflate). Status: **all edits LOCAL, not committed/pushed/deployed** (note: `.git\index.lock` may block commit per the pricing handoff above).

• **DB migration** `add_venue_setting_column` (applied to `evmftrogyzoudiccqkya`): `venues.setting text` nullable, `CHECK (setting in ('indoor','outdoor'))` (null allowed). Backfill: `cafe→outdoor`, `self_managed/partner_bnb/combo→indoor`, `custom→null`. Active venues+settings: Beige Cafe(14)=outdoor, Sunroom(18)=outdoor, Gathering(15)=indoor, Nook(16)=indoor, Reunion(17)=indoor, Your Own Space(5)=null → **2 outdoor, 3 indoor, 1 CTA**.

• **`app.js`**: rewrote `renderVenueGallery` → added `venueSetting(venue)` (prefers `setting` col, falls back to type — the ONE place the type→setting assumption lives) + `venueCardHtml(venue)`. Empty sections suppressed. Custom rendered as `.venue-custom-cta` band carrying `data-venue-id` → reuses existing `#venues-grid` click+keydown delegation (~line 5360), so **no new handler/window export needed**.

• **`style.css`**: `.venues-grid` repurposed to `flex-direction:column`; card grid moved to new `.venue-grid` (+ 900/580px media queries). Added `.venue-section-*` (outdoor dot `--boho-accent-sage`, indoor dot `--venue-primary`, EB Garamond title) and `.venue-custom-cta*` band.

• **Admin form**: `vf-setting` `<select>` (Auto=`''` / outdoor / indoor) added in `admin.html` beside Type (`vf-type`). Wired into payload (`setting: ...value || null`), `clearVenueForm` (reset `''`), `populateVenueForm` (from `venue.setting`). Editing preserves backfilled values; custom-type venues ignore setting (gallery filters `type!=='custom'` before reading setting).

• **Copy** (`/design:ux-copy`): Outdoor sub "Open-air settings, under the sky"; Indoor sub "Cosy, weatherproof spaces for any season"; CTA "Have your own spot in mind?" / "A backyard, rooftop, or a place that means something — we'll bring the picnic to you." / button "Plan a custom picnic"; empty state "No spaces open just now. We add venues often — check back soon."

• **Verification gap**: DB backfill verified via SQL + code review only — **not browser-rendered** (stale sandbox blocks build check). Next: commit+push (Vercel auto-deploy) and/or load in Chrome to confirm home sections + admin Setting field.

## Session Handoff — 2026-06-10 (code review + design critique)

• **Repo state correction vs the two 06-09 handoffs above**: pricing fix (`getPicnicPrice`) AND venue indoor/outdoor split are **committed & pushed** (`35b2fc1` "major changes", `cf9927d` phone-OTP); `main` == `origin/main`, `.git/index.lock` gone, live site renders the split correctly (verified in Chrome). Bash sandbox app.js no longer stale (5,534 lines, matches HEAD). Uncommitted working tree: index.html (+9 footer legal nav), style.css (+160 legal-page styles), brand rename "Picnic Story→Stories" in docs/preview/migration comments, + 4 untracked legal pages (privacy/terms/cancellation/disclaimer.html).

• **🔴 Blocker #1 — legal pages will 404 in prod**: `vite.config.mjs` `rollupOptions.input` only has `main`+`admin`; the 4 legal pages won't be emitted to dist. Fix: add `privacy/terms/cancellation/disclaimer: resolve(here, '<page>.html')` entries. `public/` copy won't work (pages link raw `style.css`, which Vite hashes).

• **🔴 Blocker #2 — 12 unfilled `legal-placeholder` spans** across legal pages (`[Insert Date]` ×8, `[Insert Business/Registered Address]` ×3, `[Insert Name/Designation]` ×1), yellow-highlighted, pages are `robots: index,follow`. Fill before committing. Footer nav + CSS + legal pages + vite config must ship as **one commit**.

• **Missed in email-sender cleanup**: `supabase/functions/sync-ical/index.ts:109` still `"The Picnic Story <onboarding@resend.dev>"` (old brand + Resend test sender → only delivers to account owner). The "all 4 functions" pass missed this 5th function. Hygiene: `.gitignore` exists locally but is itself untracked (remote has none); `dist/` is tracked → `git rm -r --cached dist` after committing .gitignore; junk in root: `~/`, `index.html.bak`, `logo.png.png`; "Stories's"→"Stories'" ×3 in `docs/venue-booking-flow-spec.md`.

• **Design critique (live, desktop 1440)**: top fix = **The Nook & The Reunion venue cards have no photos** (empty beige boxes — 2 of 3 indoor venues); contradictory checkout copy "Instant confirmation on advance payment" vs "Final total confirmed after we review your requirements"; Romantic Picnics occasion card ~250px dead space; "CAFÉ" hero badge + "My Booking" pill over hero image = contrast fails; add-on label "Photo Printouts(10 Colored Photos)" missing space; `.footer-legal` 13px @ 0.65 white-on-green ≈ 4:1 (below 4.5:1). Mobile untested (Chrome window wouldn't resize in session) — manual ~390px QA needed. Booking-flow UX (date→slot→guests→form, self-relabeling CTA) is solid — keep.

• **Next**: add legal pages to vite inputs → fill placeholders → single commit+push (footer/CSS/pages/config) → fix sync-ical sender → source Nook/Reunion photos.

## Session Handoff — 2026-06-11 (occasion + board fields, children_count fix, dropdown restyle)

• **Feature — Occasion + Board on bookings**: `bookings.occasion text` (nullable) + `bookings.board jsonb` (nullable, lowercase `{"type":"black"|"white","message":"..."}`) added via migration `add_occasion_and_board_to_bookings`. Board is optional; occasion is a dropdown+Other. **All DB + edge-fn changes are LIVE; `app.js` + `style.css` changes are LOCAL only → need commit+push for Vercel.**

• **RPC `submit_booking_intent`** recreated (drop+create) — final trailing params: `..., p_add_ons jsonb, p_occasion text DEFAULT null, p_board jsonb DEFAULT null, p_children_count integer DEFAULT 0`. Inserts `occasion` (`nullif(btrim(p_occasion),'')`), `board`, and `children_count` (`coalesce(p_children_count,0)`; guard `0 ≤ children ≤ guests`). **`children_count` was a pre-existing bug — RPC never inserted it (always 0); now fixed.** Grants re-granted to `anon, authenticated, service_role` after each drop.

• **`app.js` form** (~line 1713, inside `renderBookingView` inline form): occasion `<select class="vd-bf-input vd-bf-select" name="occasion">` (Birthday/Anniversary/Proposal/Baby Shower/Bridal Shower/Date Night/Graduation/Just Because/Other) with inline `onchange` revealing `#occasion-other-wrap` (`name="occasion-other"`); board `<select name="board-type">` (No board/black/white) revealing `#board-message-wrap` (`name="board-message"` maxlength 120). `special-requirements` placeholder de-duped (removed "Occasion"). Submit handler `handleInlineBookingSubmit` (~1985-2005): builds `lead.occasion` (Other→free text else dropdown, `||null`) + `lead.board` (`boardType ? {type,message} : null`). RPC call (~2151) passes `p_occasion`, `p_board`, `p_children_count: lead.children_count ?? 0`.

• **Admin display**: `occasionBoardHtml(b)` helper (declared just before `renderBookings` ~2893, hoisted) renders 🎉 Occasion + 🪧 Board detail rows; called in BOTH `renderQueries` (`occasionBoardHtml(query)`) and `renderBookings` (`occasionBoardHtml(booking)`) right after `${reqHtml}`. Admin fetch already `select('*, venues(...)')` so new cols auto-flow.

• **Edge functions DEPLOYED via MCP** (occasion/board rows + `esc()`/`boardText()` helpers, guest text HTML-escaped): `notify-booking-received` → **v10**, `notify-booking-confirmed` → **v11** (added OCCASION/BOARD reservation rows via `reservationRow()`). Both get full `record` from trigger so `record.occasion`/`record.board` are free. **⚠️ DRIFT: deployed `notify-booking-received` is GREEN-theme + imports `./_shared/`; local repo file is an untracked PINK redesign + `../_shared/` that was NEVER deployed — I patched the LIVE GREEN source, did NOT push the local pink draft. `notify-booking-confirmed` deployed==local (pink Garamond).** Rule: edge-fn source of truth = deployed; always `get_edge_function` before editing.

• **Dropdown restyle** (`style.css` after `.vd-bf-textarea` ~4082): new `.vd-bf-select` — `appearance:none`, custom rose chevron data-URI, focus ring `box-shadow 0 0 0 3px rgba(196,96,122,.13)`, hover tint, padding `12px 44px 12px 14px`, `:has(option[value=""]:checked)` mutes placeholder text. User chose **polished-native (closed control only)** over a custom component — open option list stays OS-native by design. Applied to both occasion + board selects.

• **Next**: `git add app.js style.css && commit && push` to deploy the form fields + dropdown styling + children_count frontend wiring (DB/RPC/emails already live). Until push, live site won't show occasion/board form and saves children_count=0.
