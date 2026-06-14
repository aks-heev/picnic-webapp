# The Picnic Stories — Claude Working Notes

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

## Session Handoff — 2026-06-13 (Teams feature: Jaipur/Gurugram)

• **Teams feature: ALL code LOCAL, not committed/pushed** — DB + edge functions are live. One `git add -A && git commit && git push` will deploy everything to Vercel.

• **DB state (live)**: `teams` table — Jaipur (id=1, city='jaipur', whatsapp='919266964666', phone='+91 92669-64666', contact_email='thepicnicstories@outlook.com'), Gurugram (id=2, city='gurugram', whatsapp='919773703982', phone='+91 97737-03982', contact_email='aksh.eeev@gmail.com'). `venues.team_id` FK live. **Correct team_id assignments**: Jaipur = IDs 5,19,20,21; Gurugram = IDs 14,15,16,17,18 (original backfill set all to 1 — fixed this session via SQL UPDATE).

• **Edge functions deployed**: `notify-booking-received` → v12, `notify-order-received` → v3 — both route admin email to `[team.contact_email, "team@picnicstories.com"]` via nested join `bookings→venues→teams`. `_shared/resend.ts` `to` field is now `string | string[]`.

• **`app.js` changes (LOCAL)**: `loadTeams()` called before the `if (!document.getElementById('home-page')) return` guard so it runs on admin too (was after guard = bug — filter was always no-op); `appState.teams[]` + `loadedQueries`/`loadedBookings`/`adminTeamFilter` module-level vars; `renderFooterTeams()` builds `#footer-teams` div; floating WA button appended to `#venue-detail-page` in `renderVenueDetail`; `loadTeamsManager`/`renderTeamsManager`/`saveTeam`/`setAdminTeamFilter` admin functions; venue form `vf-team` select populated from `appState.teams` in `openVenueForm`, cleared in `clearVenueForm`, populated in `populateVenueForm`, saved as `team_id` in payload; `window.saveTeam` + `window.setAdminTeamFilter` exported.

• **`index.html`/`admin.html`/`style.css` changes (LOCAL)**: footer phones replaced with `<div id="footer-teams">`. Admin: Teams tab button + `#teams-tab` panel + `#teams-manager-container`; team filter pills (All/Jaipur/Gurugram) in both Queries and Bookings tabs; `vf-team` select in venue form row. CSS: `.footer-teams`, `.footer-team-card`, `.vd-wa-float` (fixed bottom-left, green `#25D366`), `.adm-team-pill/.adm-team-pills`, `.tm-card` and related admin team manager styles.

• **CRITICAL — file editing rule**: `app.js` is 6,100+ lines. Never edit via bash — always use Read/Edit/Write file tools. Edge-fn source of truth = deployed version; always `get_edge_function` before editing.

## Session Handoff — 2026-06-13 (UI/UX batch: overnight stays, menu viewer, booking UX — COMMITTED)

• **All changes committed and pushed** — Vercel auto-deploying. Committed files: `app.js`, `style.css`, `index.html`, `admin.html`, `homepage-preview.html`, `docs/venue-booking-flow-spec.md`, `supabase/migrations/20260525_*.sql` + `20260526_venues.sql`, deleted `"The Picnic Story - Web Application Analysis.md"`.

• **What shipped**: Services grid → Overnight Stays as twin primary card alongside Romantic Picnics; `goToVenueSection('outdoor'|'indoor')` scrolls to `#outdoor-venues`/`#indoor-venues`. Menu viewer: `.vd-menu-thumb*` thumbnails (120×160px) + full `.menu-viewer` lightbox CSS (was entirely missing). Change-mode pattern: `appState.changeMode`/`appState.changeModeData` — `goBackToVenueDetail('intent')` fast-resumes from intent screen, `goBackToVenueDetail('form')` saves DOM values and pre-fills form on return. What's Included: type-aware (cafes get Food & Beverages, stays don't), SVG tent icon. Phone field: numeric-only 10-digit (triple guard). Intent card: chips-wrap flex row (`justify-content:space-between`) so "Change date & time" sits right of chips; advance amount uses `var(--boho-accent-pink)` (was `--boho-rose` = near-white = invisible); price badge `var(--boho-accent-rose, #a84d66)` + `rgba(196,96,122,0.15)` bg.

• **Remaining known issues**: The Nook (id=16) + The Reunion (id=17) have no photos (empty beige boxes). Legal pages (privacy/terms/cancellation/disclaimer.html) untracked, 12 unfilled `legal-placeholder` spans, not in `vite.config.mjs` `rollupOptions.input` → will 404 in prod. `sync-ical` function still has old sender `"The Picnic Story <onboarding@resend.dev>"`. `"Stories's"` → `"Stories'"` typo ×3 still in `docs/venue-booking-flow-spec.md`.

• **CRITICAL — file editing rule**: `app.js` is 6,100+ lines. Never edit via bash — file tools only. Edge-fn source of truth = deployed; always `get_edge_function` before editing. Never commit without explicit user go-ahead.
