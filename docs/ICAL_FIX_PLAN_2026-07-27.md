# iCal Sync — Remediation Plan

**Created**: 2026-07-27. **Source of findings**: `docs/ICAL_AUDIT_2026-07-27.md`.
**Status**: PLAN ONLY — nothing executed.

**Decisions taken by Aksheev, 2026-07-27:**
1. Reconnect our export feed to Umber's Airbnb listing once the underlying bug is fixed.
2. On ambiguous Airbnb blocks, **over-block** — never double-book, accept the occasional lost night.
3. Full scope: all six leaks plus the four latent traps, including DB-level enforcement.
4. **Blast radius is the TerraCottage venues only** — `self_managed` (Umber 15, Ochre 16) and `combo` (Sienna 17). The `partner_bnb` venues (Countryside Offgrid 22, House of Amer 23, Om Niwas 25) are **out of scope: no behaviour change, no read-path change, no enforcement**. See "Deferred" for the one guard this requires.

---

## The one invariant that governs the whole order

> **Never widen exposure before its guard is live.**

Two concrete instances, both already true today:

- Opening Sienna's 6-month booking window (Leak #2) **widens** the Leak #1 hole from ~4 months to 12. Leak #1 must be closed first.
- Flipping to over-block (Leak #3) is only safe if cross-floor echoes are genuinely gone. If they are not, Umber goes unbookable whenever Ochre is booked — the exact 2026-07 bug. Evidence gate before flipping.

Every phase below has an **entry gate**, a **rollback**, and a **break signal**. No phase starts until the previous phase's acceptance test passes on live systems.

---

## Phase 0 — Evidence & instrumentation (no behaviour change)

**Why first.** The plan's two riskiest steps (Phase 1's loop-safety, Phase 3's posture flip) both rest on assumptions I verified once, at one moment, from outside. They need to hold across a cycle before code depends on them.

Also: `sync-ical` v13's header describes a cross-floor echo ("Airbnb blocks a floor's listing whenever its sibling is unavailable"). **The 2026-07-27 evidence contradicts that** — Ochre has a real Airbnb guest on 2026-08-14 and neither Umber's nor Sienna's feed shows 08-14 blocked, and no listing linking is configured. The suppression logic may be defending against a mechanism that no longer exists, while itself causing Leak #3. That must be settled with data, not argument.

| # | Step | Owner |
|---|---|---|
| 0.1 | Add table `ical_feed_snapshots` (`venue_id`, `fetched_at`, `event_count`, `events jsonb`, `raw_sha256`). Migration applied via `apply_migration` **and** written to `supabase/migrations/`. | Claude |
| 0.2 | `sync-ical` v14a: write one snapshot row per venue per run, before any reconciliation. Pure addition — no logic change. Retain 30 days. | Claude |
| 0.3 | Add an admin-panel read-only "Calendar health" strip: per stay venue, `last_ical_sync_at`, `last_ical_sync_status`, event count, and a red badge if `last_ical_sync_at < now() - 3 hours`. | Claude |
| 0.4 | Let it run ≥24h (24 sync cycles) untouched. | — |

**Acceptance test (the gate for Phase 3, not Phase 1):**

```sql
-- Over the observation window, did any child floor's feed carry a date that is
-- occupied ONLY on its sibling? If zero, cross-floor echo is dead.
-- Run against ical_feed_snapshots joined to bookings + venue_availability.
```

- **Result A — zero cross-floor echoes** → Phase 3 proceeds as a straight removal of the suppression logic.
- **Result B — echoes still occur** → STOP and re-plan Phase 3. The over-block posture then requires a different implementation (per-date provenance, not sibling inference). Do not flip blind.

**Rollback**: drop the table and redeploy v13. Zero user-visible surface.
**Break signal**: any change in `sync-ical` response shape or a `get_logs` error — snapshot writing must never fail the sync (wrap in try/catch, log and continue).

---

## Phase 1 — Close Leak #1: parent inherits child Airbnb bookings

**The money leak.** Ochre had a paying Airbnb guest 20–26 Jul while Sienna sat bookable on Airbnb for those exact nights.

**Entry gate**: none — this is independent of Phase 0's outcome and is the highest-value change. Ship it first.

**Change**: `export-ical` v12. In the combo-parent child query, stop excluding child `ical` rows:

```
// current
.or("source.eq.admin,and(source.eq.parent,booking_id.not.is.null)")
// v12
.or("source.eq.admin,source.eq.ical,and(source.eq.parent,booking_id.not.is.null)")
```

The parent's **own** `ical` rows stay excluded (that self-echo exclusion is correct and unchanged).

**Why the v11 loop cannot fire — both verified 2026-07-27, both must be re-stated in the fn header as standing assumptions:**

1. **Airbnb does not re-export imported-calendar blocks in its own `.ics`.** Proven: Sienna's UI shows 27 Jul–30 Sep unavailable (our venue-17 export); its feed contains none of it. So a block we publish cannot come back to us.
2. **No Airbnb listing linking is configured** on any of the three listings. So a block Airbnb receives on the parent cannot be pushed down to the children.

The v11 exclusion was introduced *because* it assumed (2) was false. It isn't. Header comment must record that if either assumption changes, this exclusion has to come back.

**Acceptance test (live, checkable in minutes):**

```
curl -s "https://evmftrogyzoudiccqkya.supabase.co/functions/v1/export-ical?venue_id=17" | grep 20260814
```
must return a VEVENT — 2026-08-14 is Ochre's genuine Airbnb reservation (HMNMNEPKEJ) and today is absent from the Sienna feed. Also assert 20260720–20260726 present.

**Pre-deploy** (CLAUDE.md §4): fetch deployed source via `get_edge_function` as the editing base; esbuild bundle-check a `/tmp` copy; deploy preserving `verify_jwt=false`; sync `supabase/functions/export-ical/` to byte-match; check `get_logs`.

**Rollback**: redeploy v11 (one-line revert). Blast radius is one outbound feed; worst case is Sienna over-blocks on Airbnb, which is the safe direction.
**Break signal**: Sienna's Airbnb calendar showing blocks it shouldn't — visible in the host UI within one Airbnb refresh (~hourly).

---

## Phase 2 — Reconnect Umber, then open Sienna's window

**Entry gate**: Phase 1 acceptance test passed AND Sienna's Airbnb UI confirms 14 Aug flipped to unavailable after Airbnb's next refresh. That flip is the end-to-end proof that site→Airbnb inheritance now works.

Order within the phase matters — reconnect before widening.

| # | Step | Owner |
|---|---|---|
| 2.1 | In Airbnb → Umber listing → Availability → Connect calendars, add `https://evmftrogyzoudiccqkya.supabase.co/functions/v1/export-ical?venue_id=15`. **Verify the URL reads `venue_id=15`** — a wrong id here is a plausible origin of the 2026-07 echo bug and is trivially avoidable. | Aksheev |
| 2.2 | Confirm Umber's Airbnb calendar shows 31 Jul–30 Sep unavailable from the feed, then **remove the manual "Blocked by you" blocks** for that range so the automated source is the only one. Leave them until the feed block is visibly present. | Aksheev |
| 2.3 | Only then: Sienna listing → Availability window **6 months → 12 months**, matching both floors. | Aksheev |
| 2.4 | Next hourly sync clears Sienna's 186 stale 2027 `ical` rows automatically (`replace_ical_blocks` deletes rows absent from the new feed). Verify: `select count(*) from venue_availability where venue_id=17 and source='ical' and date >= '2027-01-23';` → 0. | Claude |

**Known cosmetic side effect of 2.1**: Umber's own site bookings will round-trip back as `ical` rows (redundant with the booking, harmless — `export-ical` already excludes a venue's own `ical` rows, so no loop). On cancellation those rows persist until Airbnb drops the imported event, up to ~1 hour. Acceptable; note in the fn header.

**Rollback**: disconnect the Umber calendar and set Sienna's window back to 6 months. Both are one-click, no code.
**Break signal**: Umber showing unavailable on dates with no booking → disconnect immediately and return to Phase 0 analysis.

---

## Phase 3 — Flip to over-block on ambiguity

**Entry gate**: Phase 0 returned **Result A** (zero cross-floor echoes) and Phase 2 is stable for ≥48h. On Result B, this phase is re-planned, not attempted.

**Change**: `sync-ical` v14 — remove the `occupancyContext` sibling-suppression path. Import every non-cancelled busy date from a floor's own feed. Keep the `Reserved`-only filter on the **parent→child fanout** (that one is correct: a whole-home *block* should not take both floors off sale, only a whole-home *reservation* should).

**The mitigation that makes over-blocking cheap.** Over-blocking only costs money when a block is wrong. So give deliberate blocks a channel the sync never touches:

- Deliberate unavailability (maintenance, personal use, held dates) goes in the **admin panel** → `source='admin'`, which `replace_ical_blocks` never deletes and `export-ical` publishes outward.
- Airbnb's calendar becomes an *input only* for genuine Airbnb demand. Document this as the house rule; add a one-line hint in the admin block UI.

This is the same posture chosen in the decision above, implemented so that the over-block rarely bites.

**Acceptance test**: with Ochre occupied and Umber free, Umber's site calendar must remain **open** — because with linking off, Ochre's occupancy never appears on Umber's feed. If Umber closes, echoes exist after all → immediate rollback to v13 and reopen Phase 0.

**Rollback**: redeploy v13. Single function, no schema change.
**Break signal**: any stay venue's `ical` row count jumping by more than the feed's own event count — surfaced by the Phase 0.3 health strip.

---

## Phase 4 — Staleness, alerting, and the stranded-rows trap

**Entry gate**: Phase 3 stable ≥24h. Independent of Phases 5–6 — can run in parallel with them if desired.

| # | Step | Owner |
|---|---|---|
| 4.1 | `sync-ical`: on a venue's **second consecutive** failure, send an admin email (reuse the existing inlined `sendAdminEmail`, same pattern as `reconcileHolds`). Second-consecutive, not first — avoids paging on a transient Airbnb 503. Track via a `ical_fail_streak` int column on `venues`. | Claude |
| 4.2 | Fix the stranded-rows trap: when `airbnb_ical_url` is NULL/empty for an active `self_managed`/`combo` venue, call `replace_ical_blocks(venue_id, '{}')` to clear its `ical` rows instead of skipping the venue entirely. Removing a URL should release its blocks, not freeze them. | Claude |
| 4.5 | Venue-type guard: `sync-ical` skips any venue whose type is not `self_managed` or `combo`, recording `last_ical_sync_status = 'skipped — type not supported by sync'` and emailing once. Keeps the deferred `partner_bnb` trap from ever arming silently (see "Deferred"). No effect on how partner_bnbs are sold. | Claude |
| 4.3 | Tighten the race: `sync-ical-hourly` `0 * * * *` → `*/15 * * * *`. Cuts the worst-case window 4×; cost is 4× feed fetches on 3 feeds — negligible. | Claude |
| 4.4 | Add feed health to the daily `lead-digest` email: one line per stay venue with last sync time and status. Passive daily confirmation that the pipe is alive. | Claude |

**Acceptance test**: temporarily point a scratch venue's `airbnb_ical_url` at a 404 URL, confirm two failures produce exactly one email, then restore. Confirm `cron.job` shows `*/15` and a run lands within 15 min.
**Rollback**: revert cron schedule with one `cron.alter_job`; redeploy prior fn version; the `ical_fail_streak` column is additive and can stay.
**Break signal**: alert-email volume >1/day for a healthy feed = threshold wrong.

---

## Phase 5 — Read/write path hardening (client-side)

**Entry gate**: none — independent of the sync work, but ship after Phase 1 so attention isn't split during the money fix.

| # | Step | Detail |
|---|---|---|
| 5.1 | Submit-guard: `self_managed` branch → add `'parent'` to the `source` filter (currently `['admin','ical']`, so a whole-home booking doesn't block a floor booking). | app.js ~4493 |
| 5.2 | Submit-guard: add a `combo` branch (re-check every child for every night). Currently `combo` has no server-side freshness check at all. **`partner_bnb` is deliberately left alone** — adding a night-based guard there would change how those venues are sold. | app.js ~4487 |
| 5.3 | Submit-guard: **fail closed**. The guard currently destructures `{ data }` without checking `error`; a failed query silently passes. Throw on error. Applies to the `cafe`, `self_managed` and new `combo` branches only. | app.js ~4468 |
| 5.4 | `fetchBookedData` catch block returns empty sets → calendar shows everything available on any query failure. Change to surface an explicit "couldn't load availability" state rather than a falsely-open calendar. This is in the shared `catch`, so it does affect `partner_bnb` — but only by replacing a false "everything is free" with an honest error. That is a strict safety improvement with no change to booking semantics, and is the sole permitted touch. | app.js:2849 |
| ~~5.5~~ | ~~Trap #1 — `partner_bnb` read path~~ **REMOVED FROM SCOPE** per Aksheev 2026-07-27. See "Deferred". | — |

**Verification** (CLAUDE.md §3/§9): write a trusted Read-tool copy to `/tmp`, machine-parse there — never `node --check` on the mount. Confirm behaviour on `:4173` or prod with a cache-buster, not `:5173`.
**Rollback**: git revert of the app.js hunks (Aksheev runs it).
**Break signal**: legitimate bookings being rejected at submit — watch for a drop in `submit_booking_intent` success in PostHog over the following week.

---

## Phase 6 — Server-side enforcement and the remaining traps

**Entry gate**: Phases 1–5 stable ≥1 week. This is the largest change on a production-only database; it goes last deliberately.

| # | Step | Detail |
|---|---|---|
| 6.1 | **Trap #2** — `export-ical` emits `SUMMARY:Reserved`, and `sync-ical` classifies genuine reservations with `/reserved/i`. Change our export's SUMMARY to `Booked — picnicstories.com` and tighten the classifier so our own string can never be read as an Airbnb reservation. Removes a latent fanout bug for the cost of one string. | export-ical + sync-ical |
| 6.2 | **Trap #3** — `confirmBooking` / `holdComboBooking` plain-`.insert()` `source='parent'` rows; a pre-existing `booking_id IS NULL` fanout row on the same date violates `va_parent_unique` and the confirm fails with a generic error. Move the fanout into a `SECURITY DEFINER` RPC using `ON CONFLICT DO NOTHING`, mirroring `replace_parent_ical_blocks`. | app.js:6411/6474 + new RPC |
| 6.3 | Trigger `bookings_prevent_overbook` — `BEFORE INSERT OR UPDATE`, fires only when `confirmed` becomes true **and the venue's type is `self_managed` or `combo`**. Raises if any night conflicts with other confirmed bookings beyond `max_concurrent_setups`, with `venue_availability` rows (`admin`/`ical`/`parent`), or — for combo — with any child occupancy. The type check is an explicit allow-list, not a `type <> 'cafe'` exclusion: a future venue type must opt in, never inherit enforcement by accident. | new migration |
| 6.4 | **Override hatch.** Admin sometimes legitimately needs to force a booking. Use a session GUC: the trigger skips when `current_setting('app.allow_overbook', true) = 'on'`, and the admin panel sets it explicitly on a "force" action. **Do not** add a parameter to `admin_add_manual_booking` — a new overload makes the PostgREST call ambiguous (CLAUDE.md §4). | same migration |

**Verification**: every branch exercised via rolled-back `DO $$` blocks per CLAUDE.md §4 — clean insert passes; overlapping insert raises; combo child conflict raises; override GUC bypasses; `UPDATE` that doesn't touch `confirmed` is unaffected; **and a conflicting `partner_bnb` insert passes untouched** (proves the allow-list holds). Then `select count(*) ... where mobile_number='<test>'` → 0. Run `get_advisors` and explain any new warning.

**Rollback**: `DROP TRIGGER bookings_prevent_overbook ON bookings;` — instant, and the system returns to exactly today's behaviour.
**Break signal**: any "Failed to confirm booking" report from Aksheev. Given single-digit monthly volume, a single false rejection is a meaningful signal — treat the first one as a rollback trigger, not a data point to accumulate.

---

## Success metrics

| Signal | Target | How checked |
|---|---|---|
| Sienna sellable while a floor is occupied | 0 nights | Weekly SQL: any date bookable on Sienna that is occupied on venue 15 or 16 |
| Stale future blocks on Sienna | 0 rows ≥ 2027-01-23 | `venue_availability` count after Phase 2 |
| Feed sync health | 100% `ok` daily | `venues.last_ical_sync_status` in the lead-digest line |
| Double-booking incidents | 0 | Aksheev; any occurrence = post-mortem before further phases |
| False rejections at submit | 0 | PostHog `submit_booking_intent` failures + Aksheev reports |
| Manual Airbnb blocking effort | → 0 after Phase 2 | Umber requires no hand-blocking |

---

## Ownership

- **Aksheev**: all Airbnb UI changes (2.1–2.3), all `git add/commit/push` (Claude never runs git — CLAUDE.md §3), the partner_bnb slots-vs-nights answer (5.5), eyeball checks on emails and the admin health strip.
- **Claude**: migrations, RPCs, edge functions, app.js, DO-block and smoke tests, live verification, per-phase acceptance tests.

## Deferred, explicitly

- **`partner_bnb` venues are out of scope entirely** (Aksheev, 2026-07-27). No read-path change, no submit guard, no enforcement trigger. They keep today's behaviour exactly.

  **The one thing this requires.** Trap #1 stays live but disarmed by circumstance: `fetchBookedData` routes `partner_bnb` through the cafe/slot branch, which reads only `source='admin'` and ignores `ical`/`parent` rows. Harmless today because **no `partner_bnb` venue has an `airbnb_ical_url`** (verified 2026-07-27). It arms the moment one does — imported Airbnb blocks would be silently invisible on the public calendar and the venue would be sold over.

  Guard, in Phase 4 (cheap, no partner_bnb behaviour change): `sync-ical` refuses to process a venue whose type is not `self_managed` or `combo`, writing `last_ical_sync_status = 'skipped — type not supported by sync'` and emailing once. A feed attached to the wrong venue type then fails loudly instead of silently. **Trap #1 must be reopened and fixed properly before any `partner_bnb` gets a calendar feed** — record that as the condition, not a vague "someday".

- **The 60-minute → 15-minute race is narrowed, not eliminated.** A true zero-race design needs a webhook Airbnb does not offer. Accepted at this volume.
- **`sync-ical`'s `verify_jwt=true` + vault `ical_service_key`** stays as-is. It works and is not implicated in any leak.
- **Sienna's `2026-07-31 → 08-04` feed event** still has no confirmed origin. It affects nothing (Sienna's real blocking comes from our imported feed) and Phase 0 snapshots will likely explain it. Not gating anything.

## First action

Phase 0.1 — write and apply the `ical_feed_snapshots` migration. It is additive, reversible, blocks nothing, and starts the 24h clock that gates Phase 3. Phase 1 can be built in parallel the same session, since it does not depend on Phase 0's result.
