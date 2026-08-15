# Scope Audit — Planned vs. Executed vs. Remaining (2026-07-16)

**Method:** every plan/spec in `docs/` read and cross-checked against live state today — git log (HEAD `bb09da8`), Supabase (edge fn versions, cron jobs, schema, bookings data via SQL), and prior verified handoffs. Claims marked ⚠ were not re-verifiable today.
**Prioritized backlog run through plan-optimizer: 80 → 88 → 91 (plateau).** Key upgrades across rounds: owner + first-action added per item, the TerraCottage-vs-funnel capacity conflict surfaced as the top strategic call, review-dependent items chained into one gated workstream, explicit "not now" list added.

---

## Part 1 — Doc-by-doc status matrix

### ✅ Fully executed (verified live)

| Doc | Evidence today |
|---|---|
| `ROUTE_BASED_SEO_PLAN` + `PRERENDER_SPEC` | 12 venue pages + city pages + sitemap live; slim-shell shipped `9538fa7` |
| `SEO_FIX_PLAN` (2026-06-23) | All items done except GBP → carried into SEO_PLAN_2026-07-15 Track 2 |
| `ICAL_SYNC_PLAN` + `STAGE0_ICAL_ROUNDTRIP` + `SPEC_parent_child_listings` | export v11 / sync v10 live; `sync-ical-hourly` cron running; loop fix confirmed |
| `PAYMENT_SECURITY_FIX_PLAN` | `compute_booking_advance` in DB; create-order v10 / verify-payment v9 live |
| `SPEC_razorpay_webhook_and_admin_payment_status` | razorpay-webhook v5 live |
| `META_PIXEL_IMPLEMENTATION` | All 5 events in code; **Events Manager verification still owed** (→ P1-6) |
| `SPEC_venue_addon_mapping` | Junction live; leftover hardening → P3 |
| `SPEC_packages_mvp` / `SPEC_occasion_packages` / `PHASE2_PACKAGES_FIRST_PLAN` | Shipped through commits `9569c49`…`2cfe1ee`; AOV measurement never run (→ P2-12) |
| `SPEC_stored_package_pricing_2026-07-10` | Shipped `5b2dc7a` |
| `ADMIN_MANUAL_BOOKING_PLAN_2026-07-11` | Live in prod 07-14; smoke test passed. Parked: save-as-query, edit-after-save (→ P3) |
| `BLOG_SEO_PLAN_2026-07-11` | 4 posts live + `/blog` + prerender infra. Remaining absorbed into SEO_PLAN Tracks 1 |
| `SPEED_REGRESSION_2026-07-04` | Phases 1–2 shipped; CLS fix confirmed. Image-resize decision open (→ P2-13) |
| Advance-% bug fix (07-15) | `20260715_fix_advance_percentage.sql` applied; notify v31; **committed & pushed** (`bb09da8`). E2E UI test NOT done — SQL shows **zero bookings created since 07-15** (→ P0-1) |
| Homepage venue-grid GSC fix | Confirmed live 07-15 (server-rendered `<a href="/venues/...">`) |

### 🟡 Partially executed

| Doc | Done | Remaining |
|---|---|---|
| `SEO_PLAN_2026-07-15` (current master) | Track 3 item 1 (pricing fix); sticky-sidebar confirmed fixed | Everything else — GSC resubmission, Jaipur GBP, Jaipur content ×3, digest, review engine, trust-bar fix, mobile pass |
| `NOTIFICATIONS_PLAN` | Transactional email pipeline fully live | WA Cloud API channel (Phase 2), T6 day-before reminders, `marketing_opt_in` column (verified absent today) |
| `MY_BOOKINGS_PHONE_OTP` | Code shipped | ⚠ Go-live checklist never confirmed (Twilio creds, DLT deliverability, 5-point test). **Flow may be silently dead in prod** |
| `WHATSAPP_SALES_AUDIT_2026-07-06` | Reply pack written; intent-screen WA CTA shipped | §G follow-up cadence not operationalized — no digest cron exists (verified today) |
| `PDF_REDESIGN_PLAN_2026-07-11` | Phase 0–1 drafted (`PDF_CONTENT_SHEET` + `PDF_COPY` exist) | Phases 2–5 (design build, print verification gate, production). 4 open user decisions block Phase 2 |
| TerraCottage IG (`TERRACOTTAGE_IG_PLAN` + `CONTENT_30DAY` + `FOOTAGE_AUDIT`) | Plan, 30-day content pack, brand avatar, footage audit done | **The setup shoot day** (gates 6/8 reels + 3 seed posts), exterior shots, Room-B angles, founder frame, 22 unpulled frames, profile launch, 4 open business items (margins, WA number owner, picnic IG handle, ₹3k advance) |
| `PLAN.md` / `LINKED_LISTING_PLAN` (Stages 0–3) | Stages 0–2 done; Stage 3 parent-child shipped | Hold flow (below); tripwire monitoring informal; Form C process; Umber 2027-07-06 ical residue never eyeballed |

### 🔴 Not started

| Doc | Status |
|---|---|
| `SPEC_hold_action_and_admin_ui` | Nothing built. Sienna went live via manual-booking RPC + confirm-fanout instead; Hold's race-window protection never shipped. At current combo volume (~0), cost of absence ≈ 0 (→ P3) |

### ⬛ Superseded (do not treat as open)

`SEO_GROWTH_PLAN` → SEO_PLAN_2026-07-15 · `SPEC_occasion_packages` → SPEC_packages_mvp · original bases/overage table in SPEC_packages_mvp → live pricing (user decision 07-08) · `LINKED_LISTING_PLAN` → PLAN.md · FAQPage-schema-as-success-gate → dropped (Google 2023 restriction).

**Score: of ~27 plan docs, 14 fully executed, 7 partial, 1 untouched, 5 superseded.** Execution rate on committed scopes is high; the persistent gaps are almost all *operational/user-action* items (GBP, GSC, verification passes, print, shoots) rather than code.

---

## Part 2 — Prioritized backlog (optimizer final, 91/100)

**Strategic call first (blocks nothing, decides everything):** picnic-funnel conversion and the TerraCottage IG launch compete for the same operator hours. This backlog assumes **funnel first, TerraCottage second** — the picnic funnel has live paying traffic leaking today; TerraCottage has zero distribution yet and its critical path (setup shoot day) needs a booked stay anyway. If Aksheev disagrees, P2-17 moves up, not sideways.

Effort: S = short session · M = full session · L = multi-session. Owner: **A** = Aksheev (user-only), **C** = Claude session, **A+C** = joint.

### P0 — this week (money-path correctness + start-and-wait clocks)

| # | Item | Why now | Owner | Effort | First action / exit |
|---|---|---|---|---|---|
| 1 | **E2E test booking through real UI + Razorpay** | 30% fix verified only at RPC layer; zero bookings since fix. Every rupee charged flows through this path | A+C | S | Book Beige+Moment on prod, pay, verify quoted = stored = charged = 30% to the rupee; delete row. Exit: amounts match |
| 2 | **Re-submit 13 GSC URLs** (Request Indexing) | Root-cause fix confirmed live 07-15; the clock only starts when submitted. Rate-limited → ~2 days | A | S | GSC URL Inspection, batch 1 today. Exit: all 13 submitted; re-pull report in 2 weeks |
| 3 | **Create Jaipur GBP** | Oldest untouched P1 in the repo (3 docs since 06-23); Indian verification takes weeks — the wait dominates | A | S | business.google.com, categories per Gurugram profile; prep video-verification evidence. Exit: verification pending |
| 4 | **Daily lead digest + reason-capture follow-up** | 5/7 leads abandoned, 0 followed up; verified no digest cron exists. Converts traffic already paid for | C | M | pg_cron + email-pipeline reuse: daily list of pending/wa_clicked/abandoned w/ age+phone+total; WA follow-up script asks *why*; log reason on booking row. Exit: digest lands daily, first 5 reasons logged |

### P1 — next 2 weeks

| # | Item | Why | Owner | Effort |
|---|---|---|---|---|
| 5 | **My Bookings OTP go-live check** | Feature may be silently dead in prod; 10-min check vs. dead public flow | A+C | S |
| 6 | **Meta Events Manager verification** | Pixel init was deferred for perf 07-06; the "revert if events missing" gate was never checked — ad optimization runs blind if broken | A | S |
| 7 | **Enrich Gurugram GBP** per playbook | Thin profile undercuts the only live local-SEO asset | A | M |
| 8 | **Review engine**: wire GBP link into `post-event-nudge` (still v1, unwired) + manually ask past confirmed guests | First 3 reviews matter more than the engine; gates P2-18 | C then A | M |
| 9 | **Mobile pass**: /packages + Add-Booking form on a real phone | Most traffic is mobile; repeatedly deferred since 07-03 | A | S |
| 10 | **Jaipur content** (2 occasion posts + listicle, approved voice) | Zero Jaipur occasion content; SERP has no direct competitor | C | M×3 |
| 11 | **Trust-bar decision**: real numbers or remove "4.9 / 200+" | Fabricated claims next to a 0-review reality; day-45 rule from SEO plan | A+C | S |

### P2 — weeks 3–6

| # | Item | Notes | Owner | Effort |
|---|---|---|---|---|
| 12 | Packages AOV measurement window | The packages build's own definition of done; never run | C | M |
| 13 | Image-resize decision (Supabase Transform vs. alternative) | Open since 07-06; mobile LCP still carries full-size images | A+C | S decide, M build |
| 14 | Corporate/offsite page + per-venue FAQs | Weekday inventory + AI-citability; after Jaipur content | C | M+L |
| 15 | Admin packages: delete/reorder UI (creation shipped `8a8e583`) | Ops still needs SQL for reorder/retire | C | M |
| 16 | PDF redesign Phases 2–5 | Blocked on 4 user decisions (occasion pkgs in print? Airbnb-card rate code? 8pp merge? listing names) — decide, then build | A then C | L |
| 17 | **TerraCottage: decorated-setup shoot day** | Gates 6/8 reels + 3 seed posts; batch R1/R3/R7 on one booking's prep. Meanwhile launch profile + post the 3 ready-now assets (Umber tour, amenities, candle stories) | A | L |
| 18 | Social proof at decision point | Strictly gated on P1-8 producing real reviews | C | M |
| 19 | Lighthouse pre-deploy gate | Last perf-guardrail half | C | S |
| 20 | Repo hygiene: commit ~25 untracked docs, 5 stale deletions, stray folders | `git status` debt compounds confusion every session | A | S |

### P3 — backlog (do not schedule)

WA Cloud API channel + `marketing_opt_in` (verified absent) · T6 day-before reminders · Hold-action spec (build only if combo volume materializes) · `venue_add_ons` hardening + vestigial column drop · `OCCASION_DEFAULT_TIER` to data · save-as-query + edit for manual bookings · durable booking→tier attribution column · Form C process · Umber 2027-07-06 ical residue eyeball · Booking.com/MMT (deliberately deferred).

### Explicitly NOT now

- No new content beyond the Jaipur set until the post-performance loop shows the first 4 posts earning impressions.
- No admin follow-up UI — the digest replaces it at n≈7 leads/60d.
- No GEO/AI-search work until the funnel stops losing 5 of 7 arrivals.
- No print run (PDF Phase 5) before the Phase 4 verification gate passes.

### Weekly review (15 min, Mondays — carry-over from SEO plan, now covering this whole backlog)

GSC not-indexed count · funnel SQL row (leads/confirmed/abandoned/followed-up-with-reason) · GBP verification + review counts · one line in this doc's changelog. Two consecutive weeks against target → that item's contingency fires.

---

## Optimizer trace

Rubric (weights): status accuracy 25 · impact ordering 20 · completeness 15 · actionability 15 · sequencing 10 · capacity realism 10 · measurability 5.
Trajectory: **80 → 88 → 91** (plateau; round 4 produced formatting-only changes, discarded).
Biggest changes across rounds: (1) TerraCottage/funnel capacity conflict promoted from footnote to the governing strategic call; (2) reviews chained as one gated workstream (engine → first 3 reviews → trust bar → social proof) instead of three scattered items; (3) every P0/P1 item got owner + first action + exit condition; unverifiable claims (⚠) separated from verified ones.
