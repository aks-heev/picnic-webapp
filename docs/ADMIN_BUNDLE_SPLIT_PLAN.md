# Admin bundle split — plan (2026-10-17)

Status: Phase 0 DONE 2026-10-17 — verdict: PARK the split. Razorpay lazy-load SHIPPED 2026-10-17 (see results).
Written via plan-optimizer (61 → 82 → 90 → 91, plateau).

## Why
`index.html` and `admin.html` both load the same `app.js` (12,758 lines). Roughly lines
6,950–12,500 are admin-only (bcl, stt, rvw, Teams/Add-ons/Venue managers, Availability
Calendar, abk, embed mode, `initAdminPage`). Every public visitor downloads them:
last build (2026-09-08) `app-*.js` = 451 KB raw / 120 KB gzip.

Not a security fix. Security lives in RLS. The repo is public, so the admin source can be read
whatever we do.

## Live facts this plan rests on (probed 2026-10-17)
- The 2026-08-31 RLS write holes (`venue_packages`, `site_settings`, `teams`) are **already closed**:
  every write policy is admin-email gated. Memory/`docs/RBAC_PLAN.md` §0.1 are stale on this.
- Vite already builds separate entries (`main`, `admin`, `staff`, …) in `vite.config.mjs`.
- `initAdminPage()` (app.js:12295) runs on EVERY page from the shared DOMContentLoaded block.
- 115 top-level `window.X =` assignments, 82 of them in the admin region; admin.html has 19 distinct
  inline handlers, index.html 5. 29 top-level `let/const` in the admin region.
- `/admin` is framed by `picnic-dashboard-nu.vercel.app` (CSP `frame-ancestors` in vercel.json).

## Done =
1. Public JS gzip drops ≥ 35% vs. the Phase-0 baseline.
2. `grep` of the built public chunk finds 0 admin markers: `admin_add_manual_booking`,
   `admin_issue_staff_token`, `admin_set_booking_split`, `abkSetType`, `sttIstToday`.
3. Every admin tab loads and saves on :4173 and prod; the calendar iframe embed still works.
4. Public flows unchanged: home, venue page, /packages, booking up to the Razorpay modal → dismiss
   (never complete a charge, CLAUDE.md §5) → delete the test row, count(*)=0.

## Phase 0 — baseline (Claude, 15 min)
- `npm run build` on Aksheev's machine; record raw + gzip size of every `dist/assets/*.js`.
- PSI mobile for `/` (key + method in perf-monitoring notes). Record LCP/TBT.
Exit: numbers written into this file.

### Phase 0 results — 2026-10-17
Local build of the working tree (vite only, no prerender), gzip:
- `app-*.js` 98.7 KB · `setup-labels-*.js` (supabase-js etc.) 33.3 KB → **132 KB of first-party JS on every public page**.
- `module-*.js` 71.2 KB is PostHog, loaded lazily. admin.html loads the same app + setup-labels chunks.
- The public chunk contains admin code: `admin_add_manual_booking`, `admin_issue_staff_token`, `admin_set_booking_split`, `abkSetType`.
- Estimated admin share of app.js is ~43% of its lines, so **~40 KB gzip** is what the split would save.

PageSpeed (mobile, Lighthouse lab, cache-busted, against the deployed site):
| Page | Score | FCP | LCP | TBT | Weight | Images | Scripts |
|---|---|---|---|---|---|---|---|
| `/` | 58 (49 on 08-28) | 4.3 s | 6.2 s (15.2 s on 08-28) | 340 ms | 3.0 MB | 1.17 MB | 1.14 MB |
| `/venues/beige-cafe` | 49 | 2.9 s | 8.4 s | 840 ms | 3.3 MB | 1.66 MB | 1.08 MB |

The top opportunity on both pages is unused JavaScript (1.35 s / 1.5 s est. savings). Unused bytes by file (homepage):
| File | Transferred | Unused |
|---|---|---|
| Razorpay `checkout.js` → `v2-entry-app` (loaded on EVERY page, index.html:619) | 157 KB | **156 KB** |
| our `app-*.js` | 93 KB | 84 KB (admin + not-yet-run public code) |
| gtag | 193 KB | 77 KB |
| fbevents | 111 KB | 39 KB |
| PostHog | 71 KB | 37 KB |

**Verdict:** scripts now outweigh images, so the image work did its job. But the admin split removes only ~40 KB of ~1.1 MB of script.
Razorpay is ~4× that, and the fix is one tag plus a small on-demand loader, with no refactor:
`startRazorpayCheckout` (app.js ~4987) and the pay-link path (~5126) already handle `window.Razorpay` being undefined.
→ Do the Razorpay lazy-load first, re-measure, and revisit the split after peak season.

### After Razorpay lazy-load — live 2026-10-17 (commit 6b415f9)
| Page | Score | FCP | LCP | TBT | Weight | Scripts | Razorpay |
|---|---|---|---|---|---|---|---|
| `/` | 63 (58) | 4.6 s (4.3) | 6.2 s (6.2) | 190 ms (340) | 2.18 MB (3.0) | 670 KB (1,144) | 0 KB |
| `/venues/beige-cafe` | 50 (49) | 4.5 s (2.9) | 7.9 s (8.4) | 440 ms (840) | 2.53 MB (3.3) | 670 KB (1,077) | 0 KB |
Single lab runs, so the FCP/LCP moves are inside run-to-run noise. Script weight and blocking time are the real wins: Razorpay's full chain was ~470 KB, not the 157 KB its one chunk suggested.
The biggest unused-JS item is now our own app.js (~80 KB). That is the admin split's target, so revisit it after peak season.

## Phase 1 — inventory before moving anything (Claude, ~1 h)
Produce `docs/admin-split-inventory.md`:
- For each of the 29 admin-region top-level bindings: who reads it (admin only / both).
- For each public-region function the admin code calls (`loadTeams`, `loadPackages`,
  `loadVenues`, `appState`, the Supabase client, formatters): mark "shared".
- Every inline handler name in admin.html / index.html → which `window.X` provides it, and which
  file it will live in.
- 🔴 One Supabase client only. Two `createClient` calls = two auth listeners, and the admin
  session can desync. The client goes in the shared module.
Exit: every binding classified; zero "unknown".

## Phase 2 — mechanical extraction (Claude, ~2–3 h)
Target layout:
- `shared.js` — Supabase client, `appState`, loaders and helpers both pages use. `export`s them.
- `app.js` — public only. `import` from shared.js.
- `admin.js` — the admin region + `initAdminPage`, moved **verbatim**. `import` from shared.js.
- `admin.html`: `<script type="module" src="admin.js">`. index.html unchanged.
- The DOMContentLoaded block: `initAdminPage()` moves to admin.js. The shared pieces
  (navbar, `loadTeams`, `loadPackages`) run in both.

Rules:
- Moves only, no logic edits. Reviewing a diff that also changes behavior is how regressions hide.
- Do it with a line-range script run on Aksheev's machine, not by retyping (CLAUDE.md §3 tearing).
- 🔴 No-loss proof: the multiset of non-blank lines in old app.js equals the lines across the new
  `shared.js + app.js + admin.js`, minus the added `import`/`export` lines. Script it; must be exact.
- `node --check` on all three; `npm run build` must succeed with no Rollup "missing export" warnings.

Exit: no-loss check exact, build green, Done #1 and #2 measured.

## Phase 3 — verification (Claude on :4173, then Aksheev on prod)
- :4173 public: home, venue page, /packages, booking to the Razorpay modal → dismiss → delete the
  row, prove count(*)=0 for the test phone. Console clean.
- :4173 admin: sign in, open every tab (Bookings, Add Booking, Close Booking, Staff Ops, Reviews,
  Teams, Add-ons, Venues, Calendar), make one harmless save per editor and revert it.
  `admin.html#add-booking` deep link. `?embed` mode inside hosted-dashboard/calendar.html.
- /staff untouched (own entry), but load it once.
- Prod after push: same smoke checks, cache-busted. PSI re-run vs. Phase 0.
Owed to Aksheev: real-phone check of admin Add Booking; prod eyeball.

## Rollback
One commit. Vercel instant rollback to the prior deployment (seconds), then `git revert`.
No DB change is involved, so rollback is frontend-only and complete.

## Risks
| Risk | Mitigation |
|---|---|
| A shared binding is missed → admin tab throws at runtime, not build time | Phase 1 inventory + clicking every tab in Phase 3 |
| Inline `onclick` names stop resolving | Handler → `window.X` table in the inventory; grep built admin chunk for each name |
| Two Supabase clients | Single client in shared.js (Phase 1 rule) |
| Mid-season regression on the public booking flow | Ship on a quiet weekday; public flow smoke-tested before admin |
| Concurrent work in app.js (bcl/abk/stt) creates merge pain | Freeze other app.js edits until merged |

## Optional Phase 4 — consolidating admin into picnic-dashboard (decision gate)
Do only if, after Phase 3 has been stable for 2 weeks, one ops URL is still wanted.
Cheapest version: a link to `/admin` from the hub (`hosted-dashboard/index.html`). The calendar
iframe already embeds it. Moving the code means changing the `picnic-dashboard` root
(`hosted-dashboard/`, no Vite build) or adding a build there, plus Supabase Auth redirect URLs,
the `frame-ancestors` CSP and any edge function that checks the Origin header. That cost buys
nothing Phase 2 doesn't already give. Tracked in Todoist, not scheduled.
