# iCal Sync — End-to-End Audit, 2026-07-27

**Scope**: Airbnb ⇄ site calendar sync for TerraCottage Umber (15), Ochre (16), Sienna (17).
**Status**: ANALYSIS ONLY — nothing changed. No DB writes, no deploys, no Airbnb settings touched.
**Method**: live probes only — deployed edge-fn source, live SQL, raw Airbnb `.ics` feeds, live `export-ical` output, Read-tool `app.js`, **and the Airbnb host UI via the Chrome extension**. All figures pulled 07:00–08:00 UTC, 2026-07-27.

> **Revision note**: an earlier draft of this file inferred Airbnb-side state from the `.ics` feeds alone and got §2 wrong. The Airbnb UI check corrected it. See §1.

---

## 0. Live state as probed

| Thing | Probe | Result |
|---|---|---|
| `sync-ical` deployed version | `get_edge_function` | **v13**, deployed 2026-07-26 (`verify_jwt=true`). Not in any handoff — CLAUDE.md's latest entry stops at 2026-07-24. |
| `export-ical` deployed version | `get_edge_function` | v11, 2026-07-04 (`verify_jwt=false`) |
| `sync-ical-hourly` cron | `cron.job` / `job_run_details` | active, `0 * * * *`, 72/72 succeeded in 3 days, last 07:00:00 |
| Umber `airbnb_ical_url` | `venues` | **STILL SET**, synced 07:00:03 today, `ok — 15 date(s)` |
| Ochre | `venues` | set, `ok — 15 date(s), 1 sibling echo(es) ignored` |
| Sienna | `venues` | set, `ok — 190 date(s), 0 reserved → 2 floor(s)` |
| `venue_availability` ical rows | SQL | 15 → 15 rows (07-16…07-30); 16 → 15 rows (07-20…08-14); **17 → 190 rows (2026-07-31…2027-07-27)** |
| Overlap protection in DB | `pg_constraint` on `bookings` | **none** — no exclusion constraint, no availability trigger |

### Airbnb host UI — verified 2026-07-27

| Listing | Availability window | Connected calendar | Linked Airbnb listings |
|---|---|---|---|
| Umber `1700764232488317603` | 12 months (requests allowed beyond) | **NONE** — panel offers "Connect to another website" only | not configured |
| Ochre `1713473341201785526` | 12 months (requests allowed beyond) | "picnic website" → `export-ical?venue_id=16`, last updated 27 Jul 11:30 IST | not configured |
| Sienna `1720049229921991894` | **6 months** | "Picnic Stories Website" → `export-ical?venue_id=17`, last updated 27 Jul 11:31 IST | **not configured** — panel lists only our feed |

### Raw Airbnb feeds (fetched directly)

```
UMBER   2026-07-16 → 07-31   SUMMARY:Reserved            (real guest, HMYSNH229H)
        2026-07-31 → 10-01   SUMMARY:Airbnb (Not available)

OCHRE   2026-07-20 → 07-27   SUMMARY:Reserved            (real guest, HMH4X8EWTR)
        2026-08-14 → 08-15   SUMMARY:Reserved            (real guest, HMNMNEPKEJ)
        2026-07-27 → 08-04   SUMMARY:Airbnb (Not available)

SIENNA  2026-07-31 → 08-04   SUMMARY:Airbnb (Not available)
        2027-01-23 → 07-28   SUMMARY:Airbnb (Not available)   ← 186 nights
```

### Live export-ical output (site → Airbnb)

| Venue | Events | Range |
|---|---|---|
| 15 Umber | 66 | 4 June admin blocks + 2026-07-31…09-30 (booking #72) |
| 16 Ochre | 7 | 2026-07-27…08-02 (booking #54) |
| 17 Sienna | 70 | June admin + 2026-07-27…09-30 (inherited from both floors) |

### Relevant bookings

| # | Venue | Dates | Confirmed | Source | Created |
|---|---|---|---|---|---|
| 72 | 15 Umber | 2026-07-31 → **2026-10-01** (62 nights) | ✅ | admin | 2026-07-27 05:39 |
| 71 | 15 Umber | 2026-08-01 → 08-20 | ❌ lead | site | 2026-07-26 |
| 54 | 16 Ochre | 2026-07-27 → 08-03 | ✅ | admin | 2026-07-20 |

---

## 1. Two corrections before the findings

**(a) The sync is not "off" for Umber.** Removing the external calendar URL **from the Airbnb listing** kills the *site → Airbnb* leg only. Our DB still holds Umber's `airbnb_ical_url` and pulled its feed at 07:00 today. Current state:

- Airbnb → site: **working for all three.**
- site → Airbnb: **working for Ochre and Sienna, dead for Umber.**

**(b) Airbnb does not re-export imported-calendar blocks in its own `.ics`.** This is why Sienna's feed looks nearly empty while its UI calendar is heavily blocked. Any conclusion drawn from the feed alone about what Airbnb *knows* will be wrong. Verified: Sienna's UI shows 27 Jul – 30 Sep unavailable (exactly our venue-17 export), none of which appears in its feed.

Practical consequence: **the feeds are safe to import** (no self-echo from our own export), but they are **useless as a check on whether Airbnb received our blocks.** Only the UI or a booking attempt tells you that.

---

## 2. LEAK #1 — an Airbnb booking on a floor leaves the whole cottage sellable on Airbnb

**Proven, with a case that already happened.**

Ochre had a genuine paying Airbnb guest 2026-07-20 → 07-27 (reservation HMH4X8EWTR). During those exact nights the **Sienna whole-home listing was open for booking on Airbnb** — 20–26 July show live nightly prices and are not struck through, while 27–31 July are. If anyone had booked the whole cottage for 22 July, we would have owed two parties the same floor.

Mechanism, all three links verified:

1. **No Airbnb listing linking exists.** Sienna's Connect-calendars panel lists exactly one entry — our website feed. There is no listing group. The `sync-ical` and `export-ical` headers both assume "Airbnb's linked-listing feature ALREADY blocks the whole-home listing when a child room is booked." **That premise is false for this account.**
2. **`export-ical` v11 deliberately excludes child `ical` rows** from the combo parent's feed (the 2026-07-04 loop fix), precisely *because* it assumed Airbnb linking covered it. So a child's Airbnb-origin booking is never published to the Sienna listing.
3. Nothing else fills the gap. Sienna's feed import is inbound-only.

So the v11 loop fix traded a feedback loop for an open double-booking hole on the **highest-value listing in the portfolio.**

Note the asymmetry — this is Airbnb-side only:

- **Our own site is correct.** `fetchBookedData`'s combo branch reads child rows with `source IN ('admin','ical','parent')`, so Sienna is properly blocked on picnicstories.com when a floor has an Airbnb guest.
- **Site → Airbnb is correct.** Sienna's UI is blocked 27 Jul – 30 Sep, inherited from bookings #72 and #54 via our venue-17 export.

The hole is exactly one direction: *Airbnb floor booking → Airbnb whole-home listing.*

---

## 3. LEAK #2 — Sienna self-blocked for 6 months of 2027 by a settings mismatch

**Confirmed in the UI.** Sienna's availability window is **6 months in advance**. Umber and Ochre are both **12 months, with requests allowed beyond**.

Consequence: 186 of Sienna's 190 imported blocks are one event, `2027-01-23 → 2027-07-28` — day 180 to day 366 from today. Airbnb publishes everything past the booking window as `Airbnb (Not available)`; `sync-ical` imports it as a hard block.

**Sienna is unbookable on picnicstories.com for 2027-01-23 → 2027-07-27**, and the wall rolls forward one day every day. It costs bookings silently rather than failing loudly, which is why it survived. Nothing about it is a real constraint — it's one dropdown on one listing, imported as truth.

---

## 4. LEAK #3 — the sibling-echo rule can discard your manual Umber blocks

**Confirmed armed.** Umber has **no connected calendar** in Airbnb, and its August dates read **"Blocked by you"** — manual host blocks. Manual blocking is now the only thing protecting Umber's Airbnb listing from a site booking.

`sync-ical` v13 drops a child floor's `Airbnb (Not available)` dates when the sibling floor is occupied and this floor isn't. Its own header admits it cannot distinguish a linked-listing echo from a deliberate host block. Those manual Umber blocks are `Airbnb (Not available)` — the exact shape it discards.

Today they survive only because booking #72 covers the same nights (`occ.self` protects them). Delete or un-confirm #72 while Ochre stays booked and the overlap silently reopens on the site. The rule is live: Ochre's sync today reports `1 sibling echo(es) ignored` (2026-08-03).

The workaround and the sync logic are working against each other.

---

## 5. LEAK #4 — silent staleness has no alarm anywhere

Highest-probability failure, zero detection:

- If a feed 404s or Airbnb rotates the `?t=` token, `sync-ical` throws for that venue, **keeps every existing block**, and writes the error into `venues.last_ical_sync_status`. Nothing emails, nothing surfaces in the admin panel. A real Airbnb reservation made after the break never reaches the site, and the site keeps selling.
- If `airbnb_ical_url` is set to NULL, the venue is filtered out of the sync query (`.not("airbnb_ical_url","is",null)`) — **its existing `ical` rows freeze forever** with no way to clear them. Umber holds 15 such rows today; NULLing its URL would strand them permanently.
- `reconcileHolds` already emails on hold conflicts, so the plumbing exists. Feed health just isn't wired into it.

---

## 6. LEAK #5 — nothing in the database enforces availability

No exclusion constraint on `bookings`, no availability trigger. All enforcement is client-side `app.js`. Gaps in the submit-time freshness re-check (~line 4463–4520):

| Venue type | Submit-time re-check |
|---|---|
| `cafe` | admin blocks + slot capacity — OK |
| `self_managed` | checks `source IN ('admin','ical')` — **omits `'parent'`**, so a whole-home site booking doesn't block a floor booking here |
| `combo` | **no branch at all** |
| `partner_bnb` | **no branch at all** |

Plus `fetchBookedData`'s catch block (app.js:2849) returns empty sets on any query failure — the calendar **fails open**, showing everything as available.

---

## 7. Latent traps (not firing today)

1. **`partner_bnb` reads the wrong branch.** `fetchBookedData` routes `partner_bnb` through the cafe/slot path (app.js:2746), reading only `source='admin'` and ignoring `checkout_date`. Attach an Airbnb feed to House of Amer / Countryside Offgrid / Om Niwas and **its imported blocks will be invisible on the public calendar.** Separately, multi-night stays at those venues already only block their first night.
2. **`export-ical` emits `SUMMARY:Reserved`** and `sync-ical` classifies genuine reservations with `/reserved/i` on SUMMARY. Safe today only because Airbnb doesn't re-export imported events at all (§1b). If that ever changes, our own output reads back as a genuine whole-home reservation and fans out onto both floors.
3. **`va_parent_unique` collision.** `confirmBooking` / `holdComboBooking` plain-`.insert()` `source='parent'` rows (app.js:6411, 6474). If `sync-ical`'s parent fanout already wrote a `booking_id IS NULL` parent row on one of those dates, the insert violates the partial unique index and the confirm/hold fails with a generic "Failed to confirm booking". Dormant only because Sienna currently has 0 `Reserved` dates.
4. **60-minute cron window.** Irreducible race between an Airbnb booking and our next pull. Least of the problems at current volume.

---

## 8. Ranked

| # | Leak | Direction | Live? | Money risk |
|---|---|---|---|---|
| 1 | Airbnb floor booking leaves Sienna sellable on Airbnb | double-book | **YES — already occurred 20–26 Jul** | High — whole-cottage guest arriving to an occupied floor |
| 2 | Sienna blocked 2027-01-23 → 07-27 by its 6-month window | over-block | **YES, today** | Medium — 6 months of silent lost inventory, rolling |
| 3 | Manual Umber blocks discarded by the sibling rule | double-book | Armed by the workaround | High if it fires |
| 4 | No alerting on feed break; rows stranded on URL removal | both | Latent, high probability | High |
| 5 | No DB enforcement; submit-guard gaps for combo/parent/partner_bnb | double-book | Latent | Medium |
| 6 | `partner_bnb` ignores ical/parent rows and `checkout_date` | over-sell | Latent | Medium |

---

## 9. Questions from the previous draft — now answered

1. ~~Is our export URL imported into Sienna?~~ **Yes**, `venue_id=17`, refreshing hourly.
2. ~~Is listing-linking on?~~ **No.** Not configured on any of the three. This is the root cause of Leak #1.
3. ~~What is Sienna's booking window?~~ **6 months**, vs 12 on both floors. Root cause of Leak #2.
4. ~~Was Umber's 07-31 → 10-01 block manual?~~ **Yes — "Blocked by you".** Umber has no connected calendar at all.
5. ~~Is booking #72's 62-night span real?~~ **Yes — confirmed real long stay by Aksheev, 2026-07-27.** Umber is legitimately out of inventory 2026-07-31 → 10-01, and Sienna's Aug/Sep block is the correct consequence.

All open questions are now closed.

### What #72 being real does to the Leak #1 exposure window

Umber cannot take a new Airbnb booking until 2026-10-01, so **Ochre is the only floor that can trigger Leak #1 right now.** An Airbnb booking on Ochre leaves Sienna sellable on Airbnb for any night in:

- **2026-10-01 → 2027-01-22** — the span where Sienna is neither blocked by #72's export nor cut off by its own 6-month booking window.

Before 10-01, Sienna is already blocked by our export, and after 2027-01-22 it's blocked by Leak #2. So Leaks #1 and #2 are currently masking each other — fixing the 6-month window (which you should) *widens* the Leak #1 exposure to the full 12 months. **Fix the export-side gap first, or at the same time.**

---

## 10. Not done / owed

- No fix applied, by request.
- No Airbnb settings were changed; the UI was read only.
- Sienna's `2026-07-31 → 08-04` feed event still has no confirmed origin. It does not affect any finding — Sienna's real blocking comes from our imported feed, which Airbnb does not re-export.
