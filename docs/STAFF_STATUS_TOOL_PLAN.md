# Staff Live Event-Status Tool — Build Plan

**Written**: 2026-08-20 · **Status**: plan only, nothing built · **Owner**: Aksheev (business calls, git, eyeballs) / Claude (implementation)

Scope decided in the 2026-08-20 brainstorm. Design decisions are settled — see "Settled, do not relitigate" at the bottom before proposing changes.

---

## 0. What this is

A phone-first page for field staff to advance an event through its day-of lifecycle, so the owner can see progress without asking on WhatsApp.

**Six steps.** Four are an ordered *spine*; two are non-blocking *chips* that can be tapped any time and never gate progress.

```
SPINE  reached ──▶ setup_done ──▶ payment_received ──▶ wrapped
CHIPS         guests_arrived        guests_left        (tap any time, order-free)
```

**Not in scope for v1**: lateness alerts, photos, stays/turnover workflow, any change to existing RLS or existing RPCs.

---

## 1. Non-negotiable constraints this plan is built around

| # | Constraint | Consequence for the design |
|---|---|---|
| C1 | `bookings` carries `customer_select_own_bookings USING (email_address = auth.email())`. RLS is row-level — a signed-in customer reads **every column**. | Status never becomes a column on `bookings`. It lives in a new table. |
| C2 | Authorization in this DB is the hardcoded string `aksh.eeev@gmail.com` in **~24 policies** (verified live 2026-08-20 via `pg_policies`). | No Supabase accounts for staff. No policy rewrite. Access flows through two `SECURITY DEFINER` RPCs with an explicit column allowlist. |
| C3 | No staging environment. Every migration is production the moment it lands. | Every phase is additive-only and independently reversible. Nothing existing is altered. |
| C4 | All five Storage buckets are **public** (verified live 2026-08-20). | The optional setup photo cannot ship in v1 without either a public bucket (guest privacy leak) or an unauthenticated write path (abuse + egress risk on a project with recent quota trouble). Photo is deferred to Phase 5 with a specific design. |
| C5 | Postgres `current_date` is UTC. Business runs in IST (UTC+5:30). | "Today" is always `(now() AT TIME ZONE 'Asia/Kolkata')::date`. Never bare `current_date`. |
| C6 | `app.js` is ~514 KB and shared by public site + admin. It also carries **uncommitted** `bcl` (Close Booking) and `abk` (Add Booking) work. | The staff page gets its own tiny entry (`staff.js`), not `app.js`. Avoids shipping admin code to a field phone and avoids colliding with in-flight uncommitted work. |
| C7 | Sandbox tears large file reads; Claude never runs git. | Read `app.js`/`style.css` only via the Read tool; machine-parse a trusted `/tmp` copy; hand over a paste-ready git block. |

**Quota note (probed 2026-08-20)**: `net._http_response` retains only a short window (pg_net prunes), and within it there are **three `200`s today and zero `402`s** — the egress outage appears to have cleared, but 5 null-status rows show something is still erroring. v1 deliberately uses **no edge functions**, so it works either way. Re-probe before Phase 6.

---

## 2. Phases

Each phase is independently shippable, independently reversible, and has an explicit exit condition. Do not start a phase until the previous one's exit condition is met.

### Phase 1 — Schema (additive only)

Two new tables. Nothing existing is touched.

**`public.staff_tokens`**

| column | type | notes |
|---|---|---|
| `id` | `bigint` GENERATED ALWAYS AS IDENTITY PK | |
| `staff_name` | `text NOT NULL` | shown in the admin timeline as "who" |
| `token_hash` | `text NOT NULL UNIQUE` | `encode(extensions.digest(token, 'sha256'), 'hex')`. **Plaintext token is never stored.** |
| `upload_prefix` | `uuid NOT NULL DEFAULT gen_random_uuid()` | non-secret; reserved for the Phase 5 photo path |
| `is_active` | `boolean NOT NULL DEFAULT true` | revocation = one UPDATE |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `last_used_at` | `timestamptz` | written by `staff_today`; cheap liveness signal |

**`public.booking_event_log`** — append-only

| column | type | notes |
|---|---|---|
| `id` | `bigint` GENERATED ALWAYS AS IDENTITY PK | |
| `booking_id` | `bigint NOT NULL REFERENCES bookings(id) ON DELETE CASCADE` | cascade matters: smoke-test cleanup already deletes booking rows |
| `step` | `text NOT NULL` | CHECK in (`reached`,`setup_done`,`payment_received`,`wrapped`,`guests_arrived`,`guests_left`) |
| `at` | `timestamptz NOT NULL DEFAULT now()` | |
| `staff_token_id` | `bigint REFERENCES staff_tokens(id)` | nullable so admin can log a step manually |
| `by_name` | `text NOT NULL` | denormalised snapshot — survives token deletion |
| `note` | `text` | |
| `amount` | `numeric` | only meaningful on `payment_received` |
| `photo_url` | `text` | null until Phase 5 |

**Idempotency**: `CREATE UNIQUE INDEX booking_event_log_step_once ON booking_event_log (booking_id, step);`

A double-tap on a bad connection is the single most likely field failure. The unique index makes every step write naturally idempotent — `staff_log_step` uses `ON CONFLICT DO NOTHING` and returns the existing row. Re-tapping is a no-op, not a duplicate.

**RLS**: enabled on both. Four admin policies each, gated on `auth.email() = 'aksh.eeev@gmail.com'` (mirrors the `booking_costs` pattern). `REVOKE ALL ... FROM anon, authenticated` on both tables — staff never touch the tables directly, only the two RPCs.

**Repo file**: `supabase/migrations/20260820_staff_tokens_and_booking_event_log.sql`, written in the same session as `apply_migration` (§4).

**Exit condition**: `information_schema` confirms both tables, the CHECK, the unique index and the FK; `pg_policies` shows 8 new policies and nothing changed on `bookings`; `get_advisors` shows no new warnings; migration file exists in the repo.

**Rollback**: `DROP TABLE booking_event_log, staff_tokens;` — nothing else in the system references them.

---

### Phase 2 — The two RPCs

Both are `SECURITY DEFINER` with `SET search_path = public, extensions`, `EXECUTE` granted to `anon` and `authenticated`.

> **Deliberate house-convention exception.** CLAUDE.md §4 prefers `SECURITY INVOKER`. These two must be `DEFINER` — that is the entire mechanism by which an unauthenticated staff phone reads a narrow slice of `bookings` without any RLS change. The safety comes from the hardcoded column allowlist inside the function body, not from the caller's identity. Both functions must be reviewed line by line for anything that could return an unlisted column, and `get_advisors` run after deploy.

**`staff_today(p_token text) RETURNS jsonb`**

Returns today's events for a valid, active token. Column allowlist — **exactly these, nothing else**:

```
booking:  id, full_name, mobile_number, guest_count, children_count,
          preferred_date, time_slot, slot_start_time, slot_end_time,
          occasion, package_name, special_requirements,
          includes_food, food_items_count, beverage_items_count,
          total_amount, advance_amount, discount_amount   -- to compute balance due
venue:    name, area, city, venue_address, maps_url
add-ons:  booking_add_ons.name, price_at_booking
log:      every booking_event_log row for the booking
```

🔴 **Never returned**: anything from `booking_costs`, `email_address`, razorpay identifiers, `board`, lead/funnel columns.

Row filter:

```sql
WHERE b.confirmed = true
  AND coalesce(b.booking_status, '') <> 'Cancelled'   -- do not send staff to a cancelled event
  AND b.checkout_date IS NULL                          -- picnics only in v1
  AND b.preferred_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
ORDER BY b.slot_start_time NULLS LAST, b.id
```

Side effect: `UPDATE staff_tokens SET last_used_at = now()` on a valid token.

Invalid/inactive token → return `jsonb_build_object('ok', false, 'error', 'invalid_token')`. Never raise, never distinguish "wrong token" from "inactive token" in the message.

**`staff_log_step(p_token text, p_booking_id bigint, p_step text, p_note text DEFAULT NULL, p_amount numeric DEFAULT NULL) RETURNS jsonb`**

1. Resolve + validate token → else `invalid_token`.
2. Confirm `p_booking_id` is in *today's* set for that token. **A valid token can only write to today's events** — this caps the damage of a leaked link to one day's bookings.
3. Validate `p_step` against the allowed six.
4. Spine ordering: `setup_done` requires `reached` logged; `payment_received` requires `setup_done`; `wrapped` requires `payment_received`. Chips (`guests_arrived`, `guests_left`) have **no prerequisite** and never block the spine.
5. `INSERT ... ON CONFLICT (booking_id, step) DO NOTHING`, then return the effective row and the full updated log.

🔴 **`staff_log_step` writes to `booking_event_log` and nothing else. It must never UPDATE `bookings`** — not `advance_amount`, not `payment_status`, not `booking_status`. `payment_received` records *what staff says they collected* in `amount`; reconciling that into `bookings.advance_amount` stays a deliberate admin action in the admin panel. An unauthenticated token surface does not get to move money.

**Token generation**: not an RPC. Admin-only helper `admin_issue_staff_token(p_staff_name text) RETURNS text` (admin-gated the usual way), returns the plaintext token **once** and stores only the hash. 32 bytes from `extensions.gen_random_bytes(32)`, base64url. Brute-forcing that over PostgREST is not a realistic threat; the day-scoped write cap in step 2 is the second layer.

**Repo file**: `supabase/migrations/20260820_staff_rpcs.sql`.

**Exit condition** — every branch tested in a **rolled-back `DO $$` block** per §4, using the real admin email `aksh.eeev@gmail.com`:

- valid token, zero events today → `ok:true`, empty array
- valid token, one event today → correct payload, **and an explicit assertion that no disallowed key is present**
- invalid token → `invalid_token`, both functions
- inactive token → `invalid_token`
- booking not in today's set → rejected
- unknown step → rejected
- `setup_done` before `reached` → rejected
- `wrapped` before `payment_received` → rejected
- chip with no prerequisites → accepted
- same step twice → second call is a no-op, one row exists
- cancelled booking → absent from `staff_today`, rejected by `staff_log_step`

Then: `select count(*) from bookings where mobile_number = '<test-phone>'` = 0, and `select count(*) from booking_event_log` back to its pre-test value. `get_advisors` re-checked.

**Rollback**: `DROP FUNCTION staff_today(text), staff_log_step(text,bigint,text,text,numeric), admin_issue_staff_token(text);`

---

### Phase 3 — Staff page

New Vite entry — **not** part of `app.js`.

- `staff.html` + `staff.js` (target: under 30 KB gzipped, `@supabase/supabase-js` aside) + a small `staff.css` or a scoped `.stf-` block.
- `vite.config.mjs`: add `staff: resolve(here, 'staff.html')` to `rollupOptions.input`.
- `vercel.json`: add `{ "source": "/staff", "destination": "/staff.html" }`.
- `<meta name="robots" content="noindex,nofollow">` and a `Disallow: /staff` in robots.
- Verify `scripts/prerender-venues.mjs` ignores the new entry and the sitemap does not pick it up.

**Interaction model**

- Token from `?t=…` in the URL, cached in `localStorage` so the bookmark survives a share-sheet mangling the query string. Header shows the staff name and a "not you? clear" link.
- One card per event, ordered by slot time. Card shows: guest name, venue + `maps_url` link, slot time, guest/children count, package, add-ons, special requirements, food inclusions, and **balance due** = `total_amount - advance_amount`.
- **One large primary button per card** showing only the next spine action ("Mark reached" → "Setup done" → "Payment ₹4,200 received" → "Wrap up done"). Below it, two small chips for guests arrived / guests left. Completed steps collapse into a timestamped strip.
- `payment_received` opens a small numeric input pre-filled with the balance due, so a part payment is recordable.
- **Optimistic UI + retry queue.** Tap marks the step done locally immediately and queues the RPC. On failure it retries with backoff and shows an amber "not synced" pip. Because writes are idempotent (Phase 1's unique index), replaying the queue is always safe. This is the difference between a tool that works in a cafe basement and one that doesn't.
- Empty state: "No events today" plus the next upcoming date, so staff can tell "nothing on" from "the tool is broken".

**Exit condition**: trusted-copy machine parse of the new files (`node --check`); `npm run build && npm run preview` on `:4173` with `/staff?t=…` loading and advancing a **real test booking**; verified on a real phone by Aksheev (Claude cannot eyeball this — listed as owed-by-user); test booking and all children deleted with `count(*) = 0` proven.

---

### Phase 4 — Admin view

A **Today** tab in `admin.html` listing today's events with their timeline strip and last-updated time.

Written as a new `stt`-prefixed module in `app.js`, deliberately namespaced away from the uncommitted `bcl` and `abk` work (same defensive convention Phase 3 of Close Booking used).

Reads `booking_event_log` directly under the existing admin RLS — the admin does not go through the token RPCs.

Also: a small **Staff access** panel — issue a token (shows plaintext once, with a copy button), list tokens with `last_used_at`, deactivate.

**Exit condition**: machine parse; the timeline for the Phase 3 test booking renders correctly; `git show HEAD:app.js` diff reviewed so no unrelated in-flight work is disturbed.

---

### Phase 5 — Optional setup photo (deferred, not v1)

Blocked on C4 — all buckets are public. Design when it ships:

- New **private** bucket `staff-photos`.
- Storage RLS policy allowing `anon` INSERT only when `(storage.foldername(name))[1]` matches an `upload_prefix` of an **active** row in `staff_tokens`. The prefix is non-secret and returned by `staff_today`, so it identifies the uploader without exposing the token.
- Path: `<upload_prefix>/<booking_id>/<uuid>.jpg`; client-side downscale to ~1600px before upload (quota discipline).
- Admin view renders via short-lived signed URLs.

Do not build this before Phase 4 is live and being used.

---

### Phase 6 — Lateness alerts (deferred)

The thing that actually kills the checking loop: expected timeline per event, ping the owner only when a step is overdue. Needs an edge function + `pg_cron`, so it is exposed to the egress-quota failure mode. **Re-probe `net._http_response` across a fresh window before promising anything here.**

---

## 3. Rollout

1. Issue **one** token for the current staff member. Nothing else changes.
2. Run it **alongside** WhatsApp for the first 3 events — do not switch off the existing habit until the tool has survived a real Saturday.
3. Do a **dry run on a real booking before a real event** (Phase 3 exit already requires a test row; do one more on a genuine booking with the guest none the wiser — the RPCs write nothing customer-visible and send no email).
4. **No email fires from any of this.** The only UPDATE trigger on `bookings` is `on_booking_confirmed_notify WHEN (old.confirmed = false AND new.confirmed = true)`, and nothing here touches `confirmed`. Verify that assumption live before Phase 3 rather than trusting this line.

**Adoption tripwire — decide this now, not after.** If, after 8 events, fewer than 6 have a complete spine (`reached` → `wrapped`), the problem is the input habit, not the software. Stop adding features and either move to a 4:30 phone call or a second person. The `last_used_at` column and the log itself give you this number without any extra work; check it at 8 events and write down what you find.

---

## 4. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Staff doesn't tap anything | **High** | Tripwire above. The zero-code WhatsApp test (3 fixed messages for 8 events) still costs nothing and can run in parallel. |
| Token link leaks (forwarded, phone lost) | Medium | Day-scoped writes; no cost/margin data; deactivate in one UPDATE; `last_used_at` shows unexpected use. |
| Double-tap / flaky signal creates duplicates | Medium | Unique index + `ON CONFLICT DO NOTHING` + client retry queue. Structurally impossible rather than handled. |
| `SECURITY DEFINER` returns a column it shouldn't | Low / **severe** | Hardcoded allowlist, explicit DO-block assertion that no disallowed key appears, line-by-line review, `get_advisors`. |
| IST/UTC date boundary shows the wrong day | Medium | C5. Pin `AT TIME ZONE 'Asia/Kolkata'` everywhere, and assert it in the DO block with a simulated late-evening timestamp. |
| Merge collision with uncommitted `bcl`/`abk` work in `app.js` | Medium | New `stt` namespace; diff against `git show HEAD:app.js`; ideally get the existing uncommitted trio pushed first. |
| Peak season arrives before this is used | Medium | Phases 1–4 are ~a session each and independently useful. Ship 1–3 and stop if it isn't being used. |

---

## 5. Settled, do not relitigate

- Status is a **table, not a column on `bookings`** (C1).
- **No Supabase auth for staff, no RLS rewrite** — tokens + two definer RPCs (C2).
- **Six steps**: 4-step spine + 2 non-blocking chips. Claude argued for four; Aksheev overrode; chips are the agreed mitigation.
- **One primary button per card**, not six buttons.
- **Photo optional**, and deferred to Phase 5 for the bucket-privacy reason in C4.
- **Picnics only in v1.** Stays/turnover is a larger workload (~10/month × 2 touches) and a separate design.

## 6. Open

- Where the owner watches: Phase 4 assumes a Today tab in `admin.html`. Alternative — fold it into the existing Cowork ops dashboard artifact — not decided.
- Multi-person: design supports N tokens; only one gets issued now.
- No un-tap path. A wrongly tapped step needs an admin delete from `booking_event_log`. Acceptable for v1; revisit if it bites.

---

## 7. First action

Phase 1, in a fresh session, under the `picnic-backend-ship` skill: write and apply `20260820_staff_tokens_and_booking_event_log.sql`, write the matching repo file, run `get_advisors`, and stop there. Do not start Phase 2 in the same session.
