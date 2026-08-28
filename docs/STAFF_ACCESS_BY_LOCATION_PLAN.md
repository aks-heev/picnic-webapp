# Staff Access Links — Location Scoping

**Written**: 2026-08-25 · **Status**: **Phases 1, 2 and 4 SHIPPED. Phase 3 shipped narrower than planned. Phase 5 half done.** See §0.1. · **Owner**: Aksheev (business calls, git) / Claude (implementation)
**Revision**: v3 — rewritten after live verification corrected three load-bearing claims in v2. See §10.

Extends `docs/STAFF_STATUS_TOOL_PLAN.md`; its "Settled, do not relitigate" still holds.

**Settled by Aksheev, 2026-08-25**: exactly **two** locations — **Jaipur** and **NCR**. Every booking belongs to one of them, custom-address bookings included. No third bucket, no "visible to everyone".

---

## 0.1 Status — as built (live-verified 2026-08-28)

Everything below §0.1 is the **plan as written on 2026-08-25**, kept verbatim for its reasoning. Where the build diverged, the phase's own status line says so. Trust this section and the live database over the phase text.

| Phase | Status | Live migration(s) |
|---|---|---|
| 1 — schema + trigger | ✅ **SHIPPED** 2026-08-27 | `20260827161542_region_scoping_phase1` + `20260827161711_region_scoping_phase1_revoke_trigger_fn` |
| 2 — scope the five helpers | ✅ **SHIPPED** 2026-08-28 | `20260828054442_region_scoping_phase2_scope_staff_helpers` |
| 3 — region required at confirmation | ⚠️ **PARTIAL — DB guard only** | `20260828055533_region_scoping_phase3_require_region_on_confirm` |
| 4 — token issuing + admin UI | ✅ **SHIPPED** 2026-08-28 | `20260828060038_region_scoping_phase4_issue_token_with_region` |
| 5 — cut over | ⚠️ **HALF DONE — the old all-access token is still live** | — |

**Live state, probed 2026-08-28**

- Five helpers, all `pronargs = 1` — no zero-arg variant survived. `admin_issue_staff_token` `pronargs = 2`, exactly one row.
- `staff_today` and `staff_log_step` both reference `region`; `admin_apply_staff_payment` no longer exists (dropped for unrelated reasons, `20260827171844`).
- `bookings`: 58 rows, `ncr` 52 / `jaipur` 6 / NULL 0. **`confirmed and region is null` = 0.**
- `staff_tokens`: `10 Sunny region NULL is_active true` · `26 Sunny ncr active` · `27 Adhiraj jaipur active`.

🔴 **Scoping is therefore built but not yet enforced.** Token 10 has no region, so it still returns every booking in the country. Phase 5 step 2 is the only thing standing between this plan and its stated goal, and it is Aksheev's call — deferred by him on 2026-08-28.

🔴 **What Phase 3 actually shipped.** Neither `admin_add_manual_booking` nor `admin_edit_booking` was touched — `pg_get_functiondef` on both contains no `region` at all — because both already `raise exception 'Venue is required'`. What shipped instead is a single branch inside `bookings_set_region()`: confirming a row with no venue **and** no region raises.

🔴 **The gap Phase 3 left was NOT what an earlier draft of this section claimed. Corrected 2026-08-28 after live probing; F4 in §1 is also wrong and is annotated there.**

- Public custom bookings do **not** store `venue_id IS NULL`. `app.js:4274` is the *main* booking form; custom picnics go through `handleCustomPicnicSubmit`, which sends `p_venue_id: customVenue.id`. Bookings with a NULL `venue_id`: **0**, ever.
- The admin lead-confirm path is `app.js:6829`, a **direct PostgREST `.update({confirmed:true, …})`** — not an RPC. `Venue is required` never runs there.
- The trigger's `confirmed and region is null` raise is therefore **unreachable** by any live path. Correct, but dead — and, as found on 2026-08-28, only half-built: it was guarded by `tg_op = 'UPDATE'`, so an INSERT carrying `confirmed = true` with no `venue_id` landed a region-less confirmed row **with no error at all**. Proven live in a rolled-back block. Widened to cover INSERT and UPDATE alike by migration `bookings_set_region_guard_insert` / `supabase/migrations/20260828_region_required_on_confirm_insert.sql`; repo file body is byte-identical to `prosrc` (md5 `e12bd66f0939961352d24a33a56cd5ef`). Unconfirmed venue-less enquiries still insert normally.
- **The real bug**: one custom venue row existed — id 5, city Jaipur, region `jaipur`. Both paths stored `venue_id = 5`, so **every custom booking silently derived `jaipur`**, NCR ones included. An NCR custom picnic would have surfaced on Adhiraj's link and been invisible on Sunny's. Not "cannot confirm" — "confirms fine, files wrong."

✅ **FIXED 2026-08-28** — migration `custom_venue_per_region`, repo file `supabase/migrations/20260828_custom_venue_per_region.sql`. One custom venue **per region**: venue 5 stays Jaipur, new **venue 26** is city `Gurugram` / region `ncr` / team 2 / sort_order 26. Region derives from the venue like every other booking. `app.js`: the public modal picks the custom row matching the `cpm-city` value it already collects, the `abk` venue fetch gained `region` to its narrow column list, and the `abk` dropdown labels custom options by region. Assertions A–E passed rolled-back (including venue-move 5 → 26 re-deriving to `ncr`); 58 existing bookings unchanged; `node --check` and `vite build` clean. **Rollback is `is_active = false`, never `DELETE` — `bookings_venue_id_fkey` is `ON DELETE SET NULL`.** The `abk` region control and the RPC jsonb key are now redundant, not owed.

---

## 0. Why, and how much it is worth

Every valid staff token currently sees **every** confirmed event in the country. `staff_today` filters on date and kind, never on place. Sunny's NCR link returns Jaipur guests' names, phone numbers and addresses, and `staff_log_step`'s write cap is day-scoped but not place-scoped — so a leaked NCR link can advance a Jaipur event.

| | |
|---|---|
| Confirmed bookings, NCR (Gurugram + Delhi) | **33** (33 in last 90d) |
| Confirmed bookings, Jaipur | **2** (1 in last 90d), both House of Amer (venue 24) |
| Active staff tokens | **1** — Sunny, `staff_tokens.id = 10` |
| Jaipur staff holding a token | none |

**This is a blast-radius fix, not a workflow win.** The operational gain today is one staffer no longer seeing two Jaipur bookings. Judge it on the leak-containment value, not on convenience.

---

## 1. Verified facts this plan rests on

All probed live against `evmftrogyzoudiccqkya` on 2026-08-25. Re-probe before building — CLAUDE.md §2.

| # | Fact | Why it matters |
|---|---|---|
| F1 | `venues.city` has **three** values: `Gurugram`, `Delhi`, `Jaipur`. The Sunroom (18) is **Delhi**. | Scoping on `city = 'Gurugram'` would have hidden booking #100 — the first event ever taken through a full spine. Region, not city. |
| F2 | The four id helpers (`staff_event_ids_active/upcoming`, `staff_stay_ids_active/upcoming`) are `LANGUAGE sql STABLE SECURITY DEFINER`, select **from `bookings` only** — **no join to `venues`**. | v2 claimed they joined venues. They don't. Any venue-derived filter needs a *new* join, and it must be a LEFT join (see F4) or bookings vanish. §3 avoids the join entirely. |
| F3 | All four helpers filter `b.confirmed = true`. `staff_occupancy_upcoming` joins `venues` and excludes `type = 'combo'`. | The staff tool never sees an unconfirmed lead. This is what lets §4 defer region assignment to confirmation time. |
| F4 | 🔴 **WRONG — disproved live 2026-08-28, see §0.1.** Public site: `if (venue.type !== 'custom') lead.venue_id = venue.id` — a public custom booking is stored with **`venue_id IS NULL`**. *(It is not: that line is the main booking form; the custom modal sends `p_venue_id: customVenue.id`, and zero NULL-venue bookings have ever existed.)* Admin `abk` sets `venue_id: v.id` → venue 5, which is `city = 'Jaipur'`. | There is no venue row to derive a region from on the public path, and a misleading one on the admin path. Region must live on the booking. |
| F5 | `admin_add_manual_booking(p_booking jsonb, p_add_ons jsonb)` and `admin_edit_booking(p_booking_id bigint, p_booking jsonb, p_add_ons jsonb)` take **jsonb payloads**. | Adding a region needs a new jsonb key, **not** a signature change. v2 wrongly costed these as drop-and-recreate. No PostgREST overload risk. |
| F6 | `submit_booking_intent` has **20 positional parameters**; the spare `p_advance_amount` is `numeric` and cannot carry a region string. | Changing it *would* be a real signature change. §4 avoids needing to. |
| F7 | `bookings` has three triggers, all **AFTER** (`on_booking_insert_notify`, `on_booking_insert_confirmed`, `on_booking_confirmed_notify`). No BEFORE trigger exists. | A BEFORE trigger to materialise region is unoccupied ground and runs ahead of all three. |
| F8 | `staff_event_ids_active` has a **past-midnight grace window**: yesterday's date counts until 04:00 IST. | Region tests must cover the grace path, or a 01:00 wrap-up is untested. |
| F9 | `app.js` resolves the custom venue twice with singular `.find(v => v.type === 'custom')`. | Rules out "one custom venue row per region" — a second row silently offers the wrong region on the public site. |

---

## 2. The seam

```
staff_today(p_token)                      staff_log_step(p_token, …)
  ├─ staff_event_ids_active()   ←──────────┤   (the write cap)
  ├─ staff_stay_ids_active()    ←──────────┘
  ├─ staff_event_ids_upcoming()
  ├─ staff_stay_ids_upcoming()
  └─ staff_occupancy_upcoming()
```

`staff_log_step` gates **writes** through the same two helpers `staff_today` **reads** from. Scope the helpers and both follow — with no change to `staff_today`'s hardcoded column allowlist and no change to `staff_log_step`'s step-ordering logic. The two riskiest pieces of the original build stay untouched, and neither PostgREST-facing signature changes, so `staff.js` needs no edit at all.

---

## 3. Data model — region is materialised, never derived at read time

### 3.1 `venues.region` — the default source

```sql
alter table public.venues add column region text;
update public.venues set region = case when city = 'Jaipur' then 'jaipur' else 'ncr' end;
alter table public.venues alter column region set not null;
alter table public.venues add constraint venues_region_chk check (region in ('ncr','jaipur'));
```

Values `ncr` / `jaipur` reuse the `LOCATION` vocabulary already in `scripts/google-sheet-sync.gs`. Venue 5 (`Your Own Space`) backfills to `jaipur` on its city — a default only, overridden per booking below.

### 3.2 `bookings.region` — materialised by trigger

```sql
alter table public.bookings add column region text
  check (region is null or region in ('ncr','jaipur'));
create index bookings_region_idx on public.bookings (region);
```

A `BEFORE INSERT OR UPDATE` trigger fills it from the venue when the row does not already carry one:

```sql
create function public.bookings_set_region() returns trigger
language plpgsql as $$
begin
  if new.region is null and new.venue_id is not null then
    select v.region into new.region from public.venues v where v.id = new.venue_id;
  end if;
  return new;
end $$;
```

**Why materialise instead of `coalesce(b.region, v.region)` at read time** — this is the change from v2, and it is the point of this revision:

- The four id helpers gain **one WHERE clause and no join** (F2). A `coalesce` design would need a LEFT JOIN added to each; get one of them wrong as an inner join and every public custom booking silently disappears from every staff phone. Materialising removes that whole class of bug.
- "Region-less confirmed booking" becomes a **constraint** you can assert, not an invisibility you have to remember to look for.
- One place holds the rule. Five helpers holding the same `coalesce` is five places to get it wrong.

Cost: a trigger on the busiest table in the system. It is BEFORE-scoped, sets one column, touches nothing else, and F7 confirms no other BEFORE trigger competes.

### 3.3 `staff_tokens.region`

```sql
alter table public.staff_tokens add column region text
  check (region is null or region in ('ncr','jaipur'));
```

**`NULL` = every region** (master/owner token). On deploy Sunny's token is NULL and behaves exactly as today. No flag day, no window where the field phone goes blank.

---

## 4. The scope collapse — region is required at *confirmation*, not at capture

F3: the staff tool only ever reads `confirmed = true` rows. A public custom booking arrives as an unconfirmed lead and becomes confirmed only through an admin action. Therefore **the region only has to be correct by the time a booking is confirmed.**

Consequences, and this is where v2 was overscoped:

- `submit_booking_intent` — **untouched**. No signature change (F6), no 20-parameter drop-and-recreate.
- The public booking flow in `app.js` — **untouched**. No prerender/build verification needed.
- Only the admin surfaces need a region control, and both take jsonb (F5) — **no signature change, no overload risk**.

v2 costed Phase 3 as "two admin RPCs + the public booking path + `app.js`, its own session". It is actually one admin form field and two jsonb keys.

---

## 5. Phases

### Phase 1 — Schema + trigger (additive; no read path changes)

> ✅ **SHIPPED 2026-08-27**, as planned. Backfill landed venues ncr=6/jaipur=19, bookings ncr=52/jaipur=6, zero confirmed rows with a NULL region. Inertness proved by `staff_today` payload md5 `7c546a97d4f65167bc00e2f62a7eb5c8` identical before and after. Six trigger branches passed in a rolled-back `DO $$`. One deviation: `bookings_set_region()` kept SECURITY DEFINER but needed `revoke all … from public, anon, authenticated` — `get_advisors` flagged it as PostgREST-reachable, which the plan had not anticipated.

§3.1, §3.2, §3.3, plus the venue backfill and this booking backfill:

```sql
update public.bookings b set region = v.region
  from public.venues v where v.id = b.venue_id and b.region is null;
```

**Exit**
- All three columns and CHECKs present in `information_schema`; trigger present in `pg_trigger`.
- `select region, count(*) from venues group by 1` matches F1 (resolve live; inactive ids 1–13 shift counts).
- **Zero confirmed bookings with a NULL region**: `select count(*) from bookings where confirmed and region is null` = 0. If non-zero, the rows are custom/NULL-venue — list them and assign by hand before proceeding.
- Trigger proven in a rolled-back `DO $$`: insert with a venue → region set; insert with an explicit region → **not** overwritten; insert with `venue_id NULL` and no region → region stays NULL.
- `staff_today` output for #100 and #106 **byte-identical** to a payload captured before the migration.
- `get_advisors` clean; migration file written to `supabase/migrations/`.

**Rollback**: drop the trigger, the function, and the three columns.

---

### Phase 2 — Scope the five helpers

> ✅ **SHIPPED 2026-08-28**, as planned, including the step-3 drop. Every exit assertion passed, The Sunroom (18, city `Delhi`) present for `ncr` among them. NULL-region payload md5 `f1096d54…` identical to the Phase 1 capture. `pg_proc` returns five rows, all `pronargs = 1`.

Four id helpers get exactly one clause, no join:

```sql
and (p_region is null or b.region = p_region)
```

`staff_occupancy_upcoming(p_region)` already joins `venues` (F1/F3) and filters `v.region` instead.

🔴 **Signature discipline (CLAUDE.md §4).** Postgres cannot `CREATE OR REPLACE` a zero-arg function into a one-arg one — it creates an overload. In one migration, in this order:

1. `CREATE` the five `(text)` variants.
2. `CREATE OR REPLACE staff_today` / `staff_log_step` to read `v_tok.region` and pass it down.
3. `DROP FUNCTION public.staff_event_ids_active();` + the other four zero-arg versions.

Step 3 is not optional. A surviving zero-arg helper silently bypasses scoping and **nothing errors**.

**Exit** — rolled-back `DO $$` blocks:

- NULL-region token → payload identical to the Phase 1 capture
- `ncr` token → **The Sunroom (18, city `Delhi`) is present.** The single most important assertion here
- `ncr` → House of Amer (24) absent; `jaipur` → the reverse
- synthetic custom booking, `venue_id NULL` + `region 'ncr'` → visible to `ncr`, absent for `jaipur`
- synthetic custom booking, `venue_id 5` (a Jaipur venue) + `region 'ncr'` → visible to `ncr`, **absent for `jaipur`** — proves the booking's region beats the venue's
- **grace-window case (F8)**: yesterday-dated NCR booking, simulated clock 01:00 IST → present for `ncr`, absent for `jaipur`
- `staff_log_step`, `jaipur` token against an NCR booking → `not_today`; and the reverse
- `select proname, pronargs from pg_proc where proname like 'staff\_%\_ids\_%'` → **five rows, all `pronargs = 1`** — proves the drop
- test rows + children deleted, `count(*) = 0` proven; `get_advisors` re-checked

**Rollback**: recreate the five zero-arg helpers and revert the two callers. Keep their current definitions verbatim in the migration as a comment block so rollback is copy-paste.

---

### Phase 3 — Admin: assign region, and make region-less confirmation impossible

> ⚠️ **SHIPPED NARROW, 2026-08-28.** Only the second half exists. The `raise` lives in `bookings_set_region()`, not in the two admin RPCs — both were left untouched because each already refuses a venue-less booking with `Venue is required`, so the extra jsonb key would have been unreachable. **The `abk` region control was NOT built**, and the `picnic-live-verify` backstop reads 0 but was added as a manual query, not wired into the skill. **The gap this left was misdiagnosed and is now FIXED** by the custom-venue-per-region split (migration `custom_venue_per_region`, 2026-08-28) — read §0.1, which corrects three claims that were wrong here.

- **`admin_add_manual_booking`** and **`admin_edit_booking`**: read `p_booking->>'region'`. Validate against `('ncr','jaipur')`. **Raise** if the resulting row would be `confirmed = true` with a NULL region. jsonb key only — no signature change (F5).
- **`abk` form**: a required NCR / Jaipur control, shown whenever the chosen venue is `type = 'custom'` or no venue is chosen. Pre-select from the venue's region otherwise, so normal bookings are unchanged.
- **Confirming a lead from the admin panel**: same gate — a custom lead cannot be confirmed until a region is chosen.

**Backstop, added to `picnic-live-verify`**: `select count(*) from bookings where confirmed and region is null` must be 0.

**Exit**: DO-block tests for the raise on each admin RPC; trusted-copy machine parse of `app.js`; one real custom booking created from the admin form in each region, then deleted with `count(*) = 0` proven.

---

### Phase 4 — Token issuing and admin UI

> ✅ **SHIPPED 2026-08-28**, as planned. `admin_issue_staff_token(text)` dropped, recreated as `(p_staff_name text, p_region text default null)` raising on anything outside `('ncr','jaipur')`. `stt` UI has the region select (defaulting to no selection), the per-row region pill with a distinct **All locations** badge, and a Location column. `staff_today` now returns `staff.region`, and `staff.js` prints it in the page header. Tokens 26 (Sunny/ncr) and 27 (Adhiraj/jaipur) were issued from the UI and both opened.

```sql
drop function public.admin_issue_staff_token(text);
create function public.admin_issue_staff_token(p_staff_name text, p_region text default null) …
```

Adding a defaulted parameter to a PostgREST-exposed function is exactly the ambiguous-overload §4 warns about — drop first. Validate `p_region` and **raise** on anything not in `('ncr','jaipur')` or NULL; a typo silently becoming an all-access token is the bug this plan exists to prevent.

UI, namespaced `stt`: a region select on the issue form defaulting to no selection so an all-access token is deliberate; a region pill per token row, NULL rendered as a distinct **All locations** badge, never an empty cell; and the region shown in the staff page header so a wrong link is obvious on sight.

🔴 `app.js` carries in-flight work from at least two other efforts. Diff against `git show HEAD:app.js` before handing over a git block.

**Exit**: machine parse; a token issued per region from the UI; `select proname, pronargs from pg_proc where proname='admin_issue_staff_token'` returns exactly one row.

---

### Phase 5 — Cut over

> ⚠️ **HALF DONE.** Step 1 is complete: tokens 26 and 27 are issued, sent and confirmed working. **Step 2 is not** — `staff_tokens.id = 10` is still `is_active = true`, so the all-access link keeps working and nothing is actually contained yet. Aksheev deferred this on 2026-08-28 ("will deactivate it later"). Until he runs it, this whole plan has shipped its machinery and none of its benefit.

1. Issue an `ncr` token for Sunny, send the link, confirm **on his actual phone** that it loads and shows today's NCR events.
2. Only then `update staff_tokens set is_active = false where id = 10`.

Never the reverse. A dead link on a Saturday morning costs an event.

---

## 6. Sequencing

Phases 1+2 are one session and deliver the entire security benefit for every non-custom booking — which is every confirmed booking that exists today. Phase 3 is a second session. Phase 4 a third, or folded into 3.

**If you want the smallest useful cut**: Phases 1–2 only. Zero confirmed bookings currently use the custom venue, so the Phase 3 gap is theoretical until someone books a custom address — and the Phase 1 exit assertion will tell you the moment one appears.

---

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Someone scopes on `city` and The Sunroom vanishes | **High** — the obvious wrong move | F1; the explicit Delhi assertion in Phase 2 |
| A zero-arg helper survives the drop, silently bypassing scoping | Medium / **severe** — nothing errors | Phase 2 step 3 + the `pg_proc` count assertion |
| A confirmed custom booking ends up region-less and invisible to every token | Medium | §3.2 materialisation + Phase 3's raise + the `picnic-live-verify` backstop |
| The BEFORE trigger interacts badly with the three AFTER triggers | Low | F7 — no BEFORE trigger exists; it sets one column and returns |
| The trigger overwrites a deliberately-set region on UPDATE | Medium | `if new.region is null` guard; explicitly tested in Phase 1 |
| Grace-window bookings behave differently from same-day ones | Low | F8 test in Phase 2 |
| Someone adds a second `type='custom'` venue row | Medium | F9 — add a comment at both `.find()` sites |
| Typo'd region becomes an all-access token | Medium | Validate and raise, never coerce |
| Collision with in-flight `app.js` work | Medium | `stt` namespace; diff against HEAD |

---

## 8. Open

- Keep NULL-region tokens supported as break-glass but issue none? Recommend yes.
- Should `bookings.region` eventually become NOT NULL? Only after Phase 3 has held for a while and the backstop reads 0 consistently.

---

## 9. Adjacent, found while planning

- **Booking #61 (Maheep, House of Amer, Jaipur) still has `preferred_date = '0026-07-25'`** — the year-0026 bug carried in handoffs since 2026-08-11. It has never appeared in a "today" query and never will. Fix independently.
- Jaipur has two active same-named venues, **House of Amer 23 (`partner_bnb`) and 24 (`cafe`)**. Both become `jaipur`. Per §6 of CLAUDE.md, never take either id from a doc.

---

## 10. What changed from v2, and why

Three v2 claims were wrong, found by probing the live function bodies:

1. **"The helpers join `venues`, so the filter is a one-line `coalesce`."** False (F2) — they select from `bookings` alone. A coalesce design would have required adding a LEFT JOIN to four functions, with an inner-join slip silently hiding every public custom booking. §3.2 materialises region instead so the filter needs no join at all.
2. **"Phase 3 needs signature changes on the admin RPCs."** False (F5) — both take jsonb. No overload risk, no drop-and-recreate.
3. **"The public booking path and `app.js` must change."** False, given F3 — the staff tool only reads confirmed rows, and confirmation is always an admin action. `submit_booking_intent`'s 20-parameter signature is never touched.

Net effect: the same security outcome, one fewer failure mode, and roughly a session less work.

---

## 11. First action

~~Settle §8, then Phase 1 only, under `picnic-backend-ship`. Re-probe F1–F9 before writing SQL. Do not start Phase 2 in the same session.~~ **Done 2026-08-27/28** — Phases 1, 2 and 4 as written, Phase 3 narrowed (§0.1).

**Next action, in this order:**

1. **Aksheev** — `update public.staff_tokens set is_active = false where id = 10;`. Nothing in this plan pays off until that runs. Tokens 26 and 27 have already been confirmed working on real phones, so the Phase 5 ordering rule has been satisfied.
2. ~~**Claude, when the first venue-less booking appears** — close the Phase 3 hole.~~ **Done 2026-08-28**, and the diagnosis behind it was wrong: there are no venue-less bookings and there never were. Fixed instead by splitting the custom venue per region (§0.1). The end-to-end acceptance test ran 2026-08-28 in a rolled-back transaction: one confirmed custom picnic per region, read back through the real `public.staff_today(token)` RPC with correctly hashed throwaway tokens — right booking present on its own link, wrong one absent, both directions; the region-less token saw both. Residue 0. **Still unverified: a real click on the deployed page.**
3. ~~**Either** — wire the `confirmed and region is null` backstop into `picnic-live-verify` properly rather than leaving it as a query in this document.~~ **Superseded 2026-08-28** — the invariant is now enforced by the trigger on both INSERT and UPDATE, so a monitoring query would only ever catch trigger drift (someone disabling `set_booking_region`, or a direct write with the trigger off). Worth one line in `picnic-live-verify` if that skill is edited for another reason; not worth a trip on its own.
4. **Aksheev** — one real custom-picnic submission on the deployed site with **Delhi NCR** selected, to close the last unverified link in the chain.
