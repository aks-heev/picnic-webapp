# Splitting the revenue dashboard — plan (2026-10-10)

Status: **P1 + P2 built 2026-10-11, built-unverified (not yet seen in a real signed-in browser).** Built as a NEW file `hosted-dashboard/views.html` (per Aksheev: leave `revenue-dashboard.html` untouched), routed by `vercel.json` rewrites `/bookings` `/sales` `/stays` `/money` → `/views.html`; hub has a card per view. jsdom render on real data: all four views render with zero errors and every headline figure matches the original for Oct 2026 (owed ₹1.2L, revenue ₹2.4L, picnics ₹1.6L, stays ₹78.5k, profit ₹2.2L). P1 decision (booking_kind) NOT applied: views keep the original's checkout_date classification so the numbers match; it's in Todoist.

Original status: proposed. Written with the plan-optimizer loop (rubric → score → critique → rewrite). Trajectory 61 → 78 → 87 → 93 (best-of-3 restructure) → 93 plateau.

## Problem

`hosted-dashboard/revenue-dashboard.html` (≈78 KB, one `render()`) answers five different questions on one scroll: what's due this week, is picnic demand growing, are the TerraCottage units full, did we make money, and look up a booking. Each visit needs one of these, but the page draws all of them.

## Decision: four views in ONE file, each with its own URL

Not four separate HTML files. All four views need the same Supabase reads, the same record mapping (channel parsing, payment truth via money columns, IST booked-on, stay prorating) and the same filters. Copying that into four files means four copies of the riskiest code in the project, which will drift apart. One file with a view router gives the same experience (one question per page, own link, own hub card) at a fraction of the risk.

| Route | View | Question it answers | Cadence |
|---|---|---|---|
| `/bookings` (default) | **Bookings** | What's happening and what's owed? | daily |
| `/sales` | **Picnic sales** | Is picnic demand growing, and what sells? | weekly |
| `/stays` | **Stays** | Are the units full, and at what rate? | weekly |
| `/money` | **Money** | Did we make money this month? | monthly close |

The calendar (`/calendar`) and Meta ads (`/meta-dashboard`) stay as they are. The hub (`/`) gets one card per view.

## Where every current element goes

| Current element | View |
|---|---|
| Hero: Outstanding (owed) + owed table | Bookings |
| Hero: Next up | Bookings |
| Health strip (unprotected dates, duplicates) | Bookings |
| KPI: Awaiting balance, Unprotected dates | Bookings |
| Filters: type / venue / channel / status / search | Bookings (venue also on Sales and Stays) |
| Bookings table | Bookings |
| Revenue by month (picnic vs stay stack) | Money (combined); Sales gets picnic-only, Stays gets stay-only |
| By venue | Sales (picnic venues), Stays (stay venues) |
| KPI: Picnics; Avg picnic booking; Median lead time | Sales |
| Packages & sources | Sales |
| KPI: Stays, nights | Stays |
| Occupancy chart + per-venue table | Stays |
| Hero: Revenue (collected, picnic/stay split) | Money |
| Hero: Booking profit, P&L table, Expenses by category | Money |
| Expense line items (detail only) | Money (detail only) |
| Basis + Period | **Global**: shown on every view, carried in the URL (`?month=2026-10&basis=event`) so switching views keeps context |
| Show detail toggle | Kept; affects only Bookings and Money |

Nothing is dropped in this pass. Cutting things is Phase 3, based on what actually gets used.

## Phases

**P0 — Parity baseline (Claude, ~30 min).** Before touching code, record from SQL the expected numbers for three periods (All, Sep 2026, Oct 2026): revenue, picnic revenue, stay revenue, owed, booking profit, picnic count, stay nights, occupancy % per venue. Save as an appendix to this file.
*Exit:* the table exists and matches the current live page for one period (Aksheev eyeballs).

**P1 — View router (Claude, ~2–3 h).**
- `revenue-dashboard.html`: a top tab bar, plus `S.view` read from the path. `render()` draws only the active view's sections; charts are created only for visible canvases (a hidden canvas draws at 0 width).
- `vercel.json`: rewrites `/bookings`, `/sales`, `/stays`, `/money` → `/revenue-dashboard`. `/revenue-dashboard` itself keeps working and opens Bookings.
- No changes to data loading or the record mapping, except the decision below.
- *Exit:* every P0 number matches on its new view for all three periods; old bookmarks still load; `node --check` passes.

**P1 decision (Aksheev).** Fix picnic vs stay classification (`booking_kind`, Todoist task in Picnic Webapp) **before** Sales goes live? Recommended: yes. Otherwise the Sales view understates picnic revenue by about ₹24.8k (two picnic + stay bookings at Countryside Offgrid counted as stays), and a page called "Picnic sales" makes that error more visible than it is today. If yes, P0's expected picnic and stay numbers come from `booking_revenue_split`.

**P2 — Hub (Claude, ~1 h).** `index.html`: replace the single Revenue card with Bookings / Picnic sales / Stays / Money, each with a one-line description of the question it answers. Calendar and Meta cards unchanged.
*Exit:* every card lands on the right view, signed in once.

**P3 — Prune (Aksheev + Claude, two weeks after launch).** Ask which views you actually opened and which cards you never looked at. Drop or move those. Only consider separate files if the single file passes ~120 KB or a partner needs access to one view only (which RLS can't separate today anyway: every table is gated on the one admin email).

## Verification and rollout

- **Preview first.** Push to a branch (e.g. `dash-views`). Vercel builds a preview URL for `picnic-dashboard`; check P0 parity there before merging to `main`. Previews sit behind Vercel's deployment protection, so the sign-in still applies.
- Aksheev checks each view at laptop width and on his phone (the tab bar must not overflow at 360 px). Claude can't sign in, so the rendered result is owed by the user.
- Rollback = revert the merge commit. There's no database change in P1 or P2; the P1 decision is front-end only (it reads an existing view).

## Risks

| Risk | Mitigation |
|---|---|
| A number changes when sections move (prorating, owed being period-independent) | P0 parity table, checked per view on the preview |
| Charts blank on first switch | Create charts in the view's draw step, never for hidden views |
| Context lost when switching views | Period and basis in the URL, plus a period chip on every view |
| Old links break | `/revenue-dashboard` still works and lands on Bookings |
| Splitting picnic and stay makes the misclassification visible | P1 decision above |

## Out of scope

New metrics, data-model changes, separate access per partner, the SEO dashboard (Todoist, Picnic Stories).
