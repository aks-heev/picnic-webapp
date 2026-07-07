# Global Pending Items — All Plans, Ranked

**Generated:** 2026-07-06. Compiled from every plan/spec in `docs/` + CLAUDE.md session handoffs, then **verified against the live codebase and Supabase** (greps of app.js / index.html / analytics.js / prerender script; SQL against venues, venue_add_ons, bookings columns; deployed edge-function list and source).

Priority key: **P0** = live-impact / blocking, do now · **P1** = high impact, this week · **P2** = medium, next 2–4 weeks · **P3** = backlog / hygiene.

---

## P0 — Live impact, do first

### 1. ~~Commit + deploy the perf Phase 2 fixes~~ ✅ DONE 2026-07-06 — verify exit metrics
- Deployed: commit `28e029d` (Phase 2 A/B/D′) live on Vercel production, on top of `105c17f` (Phase 1 CLS fix).
- **Still open:** confirm PostHog home-bucket p75 CLS < 0.1 and INP < 200ms after ~24h of traffic; Vercel Speed score back toward 90+.

### 2. ~~Confirm the iCal loop has drained~~ ✅ DONE 2026-07-06
- Loop confirmed dead: Sienna fanout `0 reserved`, zero `parent` rows on 15/16; Jul 7–9 + 2027-07-01..04 phantoms cleared. Ochre Jul 2–9 and Umber Jul 6 rows are genuine Airbnb reservations.
- **Still open (1 min):** eyeball **2027-07-06** on Umber's Airbnb calendar — unexplained; fine if it's a deliberate host block, flag if not.

---

## P1 — High impact, this week

### 3. Create Google Business Profiles (Jaipur + Gurugram)
- **Source:** `SEO_FIX_PLAN.md` (open since 06-23), `SEO_GROWTH_PLAN.md` Phase 0, product diagnostic
- The single highest-leverage ₹0 acquisition action; appears in three separate plans and has never been started. Local-pack visibility for "picnic venue Jaipur" queries. User task (business.google.com); verification in India can take weeks — start now.

### 4. Kill the duplicate-content defect in prerendered venue pages — ✅ CODE DONE 2026-07-06
- `slimHomeShell()` in `prerender-venues.mjs` replaces `#home-page` with an empty stub on all venue + /packages pages (fail-safe if markers move); `__PR_SLIM__` flag + `showPage()` guard makes "go home" a real navigation there. All homepage renderers verified null-guarded (admin.html shares the bundle). 16/16 harness assertions pass.
- **Gate before deploy:** run `npm run build && npm run preview` on Windows, view-source a venue page (homepage text gone, venue block + meta present), click "Home" from a venue page (full reload to a working homepage). After deploy: GSC URL-inspect one venue page.

### 5. Image LCP fixes (perf Phase 3) — ½ DONE 2026-07-06
- ✅ `fetchpriority="high"` + `decoding="async"` on the venue hero (app.js) and homepage hero (index.html); per-venue hero `<link rel="preload">` injected into each prerendered page's head.
- ⬜ Still open (needs a decision): serve **resized** images — Supabase Storage image transformation requires the Pro-plan feature (confirm it's enabled before building URLs around it) or an alternative (upload-time resize / Vercel image opt). Also confirm webp variants are referenced, not the 6–8MB PNGs. Re-measure mobile venue LCP after.

### 6. Decide + finish Phase 0 package pricing (bases and overage)
- **Source:** `SPEC_packages_mvp.md` Phase 0, `SEO_GROWTH_PLAN.md` Phase 4
- **Verified partially done — docs are stale here:** all 6 cafes now have `free_guests_upto=6` (flat-to-6 is live everywhere). But the −₹1,000 food-removal base cut was applied **only to Beige** (8900); Sunroom/Castle Valley/Om Niwas/Once Upon A Time/House of Amer still carry their original bases, and `overage_per_person` is 2000/2500 vs the plan's 1000.
- **Action:** decision needed — either confirm current bases/overages as intentional (then close the plan item) or enter the reduced bases per the runbook. This also sets the honest "From ₹X" anchors on /packages and the homepage.

### 7. Verify email deliverability end to end
- **Source:** `NOTIFICATIONS_PLAN.md`, product diagnostic RC-2
- **Verified:** deployed `notify-*` functions now send from `The Picnic Stories <team@picnicstories.com>` — the test-sender problem in the docs is fixed in code. **Unverified:** that the domain is actually verified in Resend and mail lands in inboxes (if unverified, Resend rejects sends silently from the customer's perspective). Check Resend dashboard → domain status + recent delivery logs, and send a test booking confirmation to a Gmail address.

### 8. Mobile + fallback verification pass on /packages
- **Source:** PHASE2 plan Phase D + 07-03/07-04 handoffs (repeatedly deferred on tooling gaps)
- Never verified: real-mobile arch hero layout (photo-first, ≤860px), the no-photo hero fallback branch, and the venue-first tier step after the shared-CSS changes. Needs a real phone or DevTools device emulation — the session tooling could not resize the viewport.

---

## P2 — Medium, next 2–4 weeks

### 9. Defer Meta Pixel init (perf Phase 2C) — ✅ CODE DONE 2026-07-06
- fbq stub + event queue stay synchronous (all `fbq()` calls queue in order); only the `fbevents.js` download is deferred to first interaction / idle (4s cap). Verified on dev: script still loads, `fbq` functional.
- **Gate after deploy:** Meta Events Manager → Test Events — confirm PageView, ViewContent, Contact, InitiateCheckout, Lead all still land. If anything is missing, revert this one index.html block.

### 10. Perf guardrails (Phase 4) — ½ DONE 2026-07-06
- ✅ PostHog dashboard "Web Vitals Guardrail — daily p75" (id 1803479, pinned): site-wide daily p75 line + 7-day by-page table. Check after every deploy.
- ⬜ Still open: pre-deploy Lighthouse mobile check on `/`, `/packages`, one venue page (fail on CLS > 0.1 / perf < 85).

### 11. SEO content engine (occasion pages + venue FAQs)
- **Source:** `SEO_GROWTH_PLAN.md` Phase 2 — **verified zero built** (no occasion pages in the prerender script). Build in order: `/proposal-picnic-jaipur`, `/birthday-picnic-jaipur`, `/date-night-picnic-jaipur`, `/candlelight-dinner-gurugram`, `/corporate-picnic-gurugram`, "best picnic spots in Jaipur" listicle. Plus per-venue FAQs (source for FAQPage schema). Cap 2 pages/week; ≥500 words of genuinely specific content each. Site cannot grow past ~16 URLs of demand without this.

### 12. Review engine + citations (SEO Phase 3)
- Day-after-event WhatsApp message with the GBP review link (depends on item 3); JustDial/Sulekha/WedMeGood citations; embed real reviews on venue pages. `post-event-nudge` edge function already exists — wire the review link into it once GBPs are live.

### 13. Packages AOV measurement window
- **Source:** `SPEC_packages_mvp.md` definition of done — the entire point of the packages build. Run the 2–3-week PostHog comparison: AOV + booking-form completion vs pre-launch baseline; watch the >15% completion-drop rollback guardrail. Funnels exist (`packages_*` events verified landing); nobody has run the analysis.

### 14. Venue 21 missing Skyshots add-on
- **Verified still missing:** no `venue_add_ons` row (21, 27). Story tier silently short one item / Movie-Night-style gating hides packages there. One SQL insert (₹4,000 elsewhere) — or confirm the venue genuinely can't serve fireworks and leave the gap flag as-is.

### 15. ~~Stale /packages prerender meta title~~ ✅ DONE 2026-07-06
- Title now "Picnic Packages — Date Night, Movie Night & More"; description/cards were already DB-driven and self-update. Goes live on next deploy.

### 16. Admin packages tab: add/delete/reorder UI
- **Verified absent** (no add/delete package handlers in app.js). Was deferred in the admin-panel session, then promoted to "required" by Phase 2.5 — occasion packages shipped anyway via SQL seed. Needed before ops can manage occasion packages without migrations.

### 17. Untested packages surfaces
- Admin carousel image **upload button** never tested end to end (blocked twice on tooling; it's a near-1:1 port of the proven venue-image path, but unproven). Touch-swipe on card carousels untested on a real device. Real `npm run build && npm run preview` check of prerendered `/packages` (crawlable content pre-JS) never run.

### 18. Social proof at the decision point
- **Source:** product diagnostic RC-4. Venue cards/detail pages still show no ratings, booking counts, or testimonial snippets. High-trust ₹8k–25k purchases with the evidence buried on the homepage. Pairs with item 12 (real GBP reviews → embeddable).

---

## P3 — Backlog / hygiene

### 19. WhatsApp Cloud API channel (notifications Phase 2)
- Not started (no WA edge function deployed). Prereqs: Meta Business verification (slow — start early), fresh number vs migrating the Business-app number, template approvals, E.164 normalization. Also **`marketing_opt_in` column verified absent** — required before any marketing sends (Phase 0 of the notifications plan).

### 20. Day-before event reminders (T6)
- Not built. `pg_cron` + a clone of the notify functions; best on WhatsApp (depends on item 19) but could ship as email-only sooner.

### 21. Phone OTP go-live checklist
- **Source:** `MY_BOOKINGS_PHONE_OTP.md`. Code is done; the gating user tasks were never confirmed: Supabase phone provider + Twilio credentials wired, +91/DLT deliverability tested, and the 5-point test checklist (none ticked). Verify or the My Bookings flow is dead in prod.

### 22. `venue_add_ons` cleanup + hardening
- **Verified:** `add_ons.available_for` still exists (read-path is junction-based; column is vestigial — drop it and `requires_confirmation_for` in a cleanup migration). Optional hardening: `submit_booking_intent` still inserts client-submitted add-ons without checking they're mapped to the venue.

### 23. `OCCASION_DEFAULT_TIER` still hardcoded
- **Verified** (app.js L2045). Phase 2.5 item 5: move per-occasion default tier to data now that occasions have their own packages.

### 24. ~~`schema.md` is stale~~ ✅ DONE 2026-07-06
- Regenerated from the live DB (all 12 tables, RPCs, edge-fn versions, buckets).

### 25. Linked-listing standing items
- Form C / foreign-guest ID capture process (legal, pre-international-guest). Tripwire monitoring: any lost race / host-cancellation → switch singles to Hospitable. Booking.com/MMT deferred deliberately. export-ical v11 trade-off: a manual host block on a child's Airbnb calendar no longer reaches the parent via us — revisit only if a child ever gets a non-Airbnb OTA feed.

### 26. Minor /packages leftovers
- `?occasion=Just+Because` deep links still validate (universal ladder, no active chip); an admin-assigned 'Just Because' package would have no chip to surface it. Both flagged and accepted 07-03.

### 28. Lead-status funnel consumption (added 2026-07-07)
- Backend + client SHIPPED 07-07 (both phases): `bookings.lead_status` funnel + `update_lead_status` RPC + nightly abandoned sweep + `verify-payment` v9 / `razorpay-webhook` v5; **intent-screen lead capture** (row created the moment "You're almost there!" renders — abandoners are now real leads) + WhatsApp CTA replacing "call me" (E2E-verified on dev) + success-page CTA. **Still open:** prod smoke test after deploy; Meta Pixel Contact on the intent CTA unverified in Events Manager; then build the consumption side — admin/ops follow-up queue over `lead_status` (feeds the 3h/24h/72h cadence in `WHATSAPP_SALES_AUDIT_2026-07-06.md` §G). Also flagged 07-07: pre-existing client-vs-server pricing mismatch (client total 12,000/30% advance vs `compute_booking_total` 13,000/50%) — decide which is right.

### 27. Durable booking→tier attribution
- `bookings.selected_package` **verified absent** — deliberate PostHog-first decision. Add the column only if event-based attribution proves insufficient during item 13.

---

## Stale docs — ✅ all marked done in-place 2026-07-06

Verified against deployed functions / live code; status headers added to each doc:

| Doc | Claims | Reality |
|---|---|---|
| `META_PIXEL_IMPLEMENTATION.md` | Lead/Contact/InitiateCheckout/ViewContent "not implemented" | All four live in app.js (L425/2140/4388/9099/9152) |
| `SPEC_razorpay_webhook_and_admin_payment_status.md` | "Draft / not started" | `razorpay-webhook` deployed (v4); `create-order` v10 / `verify-payment` v8 |
| `PAYMENT_SECURITY_FIX_PLAN.md` | Layers drafted, not deployed | `compute_booking_advance` live in DB; patched functions deployed; sender fixed |
| `ICAL_SYNC_PLAN.md` "Remaining" list | Cron/listing wiring pending | All live (cron running, listings wired, sync at v10/v11) |
| `SPEC_packages_mvp.md` Phase 0 table | 5 venues "pending" flat pricing | All 6 have `free_guests_upto=6`; only bases/overage differ from plan (see item 6) |
| `SEO_GROWTH_PLAN.md` "PostHog dead in prod" | 0 events/30d | PostHog live (web vitals + packages events verified landing) |

---

## Suggested attack order (1-line version)

**Today:** 1 (commit/deploy perf) → 2 (Airbnb refresh). **This week:** 3 (GBP) → 7 (email check) → 6 (pricing decision) → 4 (duplicate content) → 5 (LCP) → 8 (mobile pass). **Then:** 9–13 in order; everything else opportunistically.
