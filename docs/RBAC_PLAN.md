# Role-Based Access for Employees — Plan

**Written**: 2026-08-31 · **Status**: **PLAN ONLY — nothing built** · **Owner**: Aksheev (business calls, git) / Claude (implementation)

**Trigger**: hiring a salesperson to work IG/WhatsApp leads and close bookings. They must be able to
enter and edit bookings. Today that is impossible without handing over the owner's own login.

Builds on `docs/STAFF_STATUS_TOOL_PLAN.md` and `docs/STAFF_ACCESS_BY_LOCATION_PLAN.md`; their
"settled, do not relitigate" sections still hold. This plan does **not** touch the staff token model.

---

## 0. What the audit found — live-probed 2026-08-31

Three findings. The one you asked about is the second.

### 0.1 🔴 Any signed-in customer can rewrite your prices. Live right now.

`venue_packages` carries three policies — `Authenticated insert`, `Authenticated update`,
`Authenticated delete` — every one of them `USING true WITH CHECK true`. No admin check at all.

`compute_booking_total()` is `SECURITY DEFINER` and reads `venue_packages.price` (confirmed by
reading its body). Customers sign in by phone OTP at `app.js:5228` and become `authenticated`.
The chain is complete:

```
PATCH /rest/v1/venue_packages?id=eq.N   {"price": 1}
  -> compute_booking_total() returns 1
  -> submit_booking_intent() stores total_amount = 1
  -> a 14,000 picnic is booked for 1 rupee
```

`auth.users` today: **10 accounts, 8 of them phone/customer, all signed in within 90 days.** The
publishable key is public by design, so nothing but these policies stands in the way. Not theoretical.

Two more of the same class:

| Table | Policy | Effect |
|---|---|---|
| `site_settings` | `Auth update site_settings` — UPDATE, `authenticated`, `USING true` / `WITH CHECK true` | Any customer edits site config |
| `teams` | `Teams editable by authenticated` — ALL, `USING true` | Any customer rewrites the phone/WhatsApp numbers the site shows to customers |

The `teams` one is a phishing vector, not vandalism: change the WhatsApp number and inbound leads
go to the attacker.

🔴 **Fix these three this week whether or not anyone is hired.** They are unrelated to the sales
hire and they are the highest-severity thing in this document.

### 0.2 The admin gate is one hardcoded email address, repeated in 50 places

`auth.email() = 'aksh.eeev@gmail.com'` appears in **33 RLS policies across 14 tables** (of 59 policies total) plus **5
RPCs** (`admin_add_manual_booking`, `admin_close_booking`, `admin_edit_booking`,
`admin_issue_staff_token`, `admin_resend_confirmation`). The frontend adds one more check of its own:
`app.js:36` reads `VITE_ADMIN_EMAIL` and `app.js:5439` compares `session.user.email` to it.

There is no role concept anywhere. An employee can only be given access by being given that
mailbox — at which point every action in the audit trail is attributed to you, and revoking them
means changing your own password.

### 0.3 Over-broad reads that are not holes today but will be once a second person logs in

`add_ons`, `packages`, `venues`, `venue_availability` and `package_add_ons` all grant blanket
`SELECT` to `authenticated` (and in two cases to `public`). Inactive rows, draft pricing and full
availability are visible to anyone with an account. Low severity while the only account holders are
customers and you; worth tightening in the same pass.

### 0.4 What already exists and should be reused, not rebuilt

- **Region scoping.** `bookings.region` and `venues.region` (`ncr` / `jaipur`), derived by the
  `bookings_set_region()` trigger; `staff_tokens.region`; five region-scoped `staff_*` helpers.
  A sales role can inherit this the day it is needed.
- **The staff token model** — hashed tokens, day-capped writes, reduced-column upcoming lists.
  It works and it suits field staff who should not have logins. **Leave it alone.**
- **`booking_costs` as a separate admin-only table**, because `bookings` RLS is row-level and a
  customer reading their own row reads every column. That constraint governs this plan too.
- 🔴 **Phase 5 of `STAFF_ACCESS_BY_LOCATION_PLAN.md` is still half done** — token 10 (Sunny) has
  `region = NULL` and therefore still returns every booking in the country. Unrelated to RBAC but
  it is an open access-control item and belongs on the same list.

---

## 1. The role model

Four roles. Three are new; the fourth is the existing token model, unchanged.

| Role | Who | Can | Cannot |
|---|---|---|---|
| `owner` | Aksheev | Everything. Identical to today's admin. | — |
| `sales` | The new hire | Read and write leads and bookings; quote; apply discounts (no enforced floor — see §5); confirm bookings; see customer name/phone/email; see `total_amount`, `advance_amount`, balance | See `booking_costs` (any cost, margin or net figure); edit venues, packages, add-ons or prices; issue or revoke staff tokens; edit `site_settings` or `teams`; delete anything |
| `viewer` | Optional — accountant, partner | Read bookings and costs | Write anything |
| field staff | Sunny, Adhiraj | Unchanged — token link, today's events, log steps | Unchanged |

**Settled by the constraint, not by preference:** `sales` must never hold SELECT on `booking_costs`.
That is where cost, margin and `close_notes` live, and it is the one table a salesperson with
discount authority has an incentive to read. **With no enforced floor (§5) this denial matters more,
not less** — a salesperson who can see the margin on a booking knows exactly how far down they can
push before it stops being worth doing, and that is your number to hold, not theirs.

**Deliberately not in v1:** per-region sales scoping. `bookings.region` already exists so it is a
one-line addition later, but with one salesperson and two regions it buys nothing today.

---

## 2. Where role membership lives

New table:

```sql
create table public.app_users (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('owner','sales','viewer')),
  display_name text not null,
  region       text null check (region in ('ncr','jaipur')),  -- reserved, unused in v1
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid null references auth.users(id)
);
```

RLS on. Only `owner` may read or write it. Anon revoked.

**Why a table and not JWT custom claims.** Claims are baked into the access token at sign-in and
survive until it refreshes — so revoking a fired employee leaves them working for up to an hour, and
a stolen token keeps its role for its full life. A table lookup is checked on every statement:
flipping `is_active = false` takes effect on their next request. For a business handing account
access to a new hire on a trial, instant revocation is worth more than the microseconds a claim saves.

## 3. Helper functions

All `security definer`, `stable`, `set search_path = public, pg_temp`, `execute` revoked from `anon`.

```sql
app_role()            -- returns the caller's role, or null; null for customers
is_admin()            -- app_role() = 'owner'  OR  auth.email() = 'aksh.eeev@gmail.com'
has_role(p text)      -- app_role() = p and the row is_active
can_write_bookings()  -- app_role() in ('owner','sales')
```

🔴 **`is_admin()` keeps the hardcoded email as a fallback for the whole migration.** That single
`OR` is what makes phases 2 and 3 unable to lock you out of your own panel. It comes out in phase 7,
last, once everything else is verified.

🔴 **Every policy must call these wrapped in a subselect** — `(select is_admin())`, never bare
`is_admin()`. Bare calls are re-evaluated per row; wrapped, Postgres hoists them to an InitPlan and
runs them once. There are already `auth_rls_initplan` advisor warnings on `staff_tokens` and
`booking_event_log` from the per-row `auth.email()` pattern; do not add 33 more.

## 4. Migration phases

Ordered so that no phase can lock the owner out, and each is independently revertible.

| Phase | What | Risk |
|---|---|---|
| **1** | `app_users` + helpers. Insert Aksheev as `owner`. Nothing else changes. | None — additive |
| **2** | Rewrite all 33 policies from `auth.email() = '…'` to `(select is_admin())` | None *semantically* — `is_admin()` still returns true for that email. Mechanical, wide, verify by count |
| **3** | Close the three holes in §0.1; tighten §0.3 reads | Medium — could break the public site if a read is over-tightened. Verify against the live booking flow |
| **4** | Add `sales`: policies + swap the RPC guards to `can_write_bookings()` (§5) | The real work |
| **5** | Audit trail (§6) | Additive |
| **6** | Frontend: role-aware admin panel, drop `VITE_ADMIN_EMAIL` (§7) | UI only — the DB is already the boundary by this point |
| **7** | Remove the email fallback from `is_admin()` | Do last. Requires Aksheev's `auth.users` row to be in `app_users` as `owner` and verified |

**Verification gate between phases 2 and 3**, run as Aksheev and as a throwaway `sales` account:

```sql
select tablename, policyname
from pg_policies
where schemaname='public' and (qual like '%aksh.eeev%' or with_check like '%aksh.eeev%');
-- expected after phase 2: 0 rows
```

Plus: the admin panel loads, bookings list renders, a booking can be added, edited and closed. If
any of those fail, phase 2 is revertible on its own — the policies are the only thing that changed.

## 5. Discounts

**Decided 2026-08-31 by Aksheev: no enforced floor.** `sales` can apply a discount at whatever
figure they agree with the customer.

What that changes in this plan:

- No `min_price` / `min_base_price` columns. Nothing new on `venues` or `venue_packages`.
- **No separate `sales_quote_booking` RPC.** Without a floor to enforce there is nothing a sales
  write path would do that `admin_edit_booking` and `admin_add_manual_booking` do not already do —
  so phase 4 becomes "swap the guard in those RPCs from `is_admin()` to `can_write_bookings()`",
  not "build a parallel RPC surface". This is a real reduction in scope.
- `discount_amount` keeps its existing meaning: signed reporting column, positive = discount,
  negative = on-site upsell. `total_amount` stays authoritative. Unchanged from
  `docs/close-booking-feature` behaviour.

🔴 **The audit log in §6 is now the only control on discounting.** With no floor, nothing prevents a
discount at the moment it is given — it is caught afterwards or not at all. That makes two things in
§6 non-optional rather than nice-to-have: every discount writes an audit row carrying the list total
and the agreed total, and somebody reads that log on a schedule. A log nobody opens is not a control.

The note requirement stays: `admin_close_booking` already refuses a changed total without
`close_notes`, and that rule is worth keeping on the sales path too — it costs one sentence typed and
it is the difference between "discount ₹3,000" and "discount ₹3,000, matched competitor quote".

## 6. Audit trail

Once someone other than you can move money, "who did this" stops being answerable by elimination.

`booking_event_log` already exists but is scoped to field-staff step logging. Rather than overload
it, add:

```sql
create table public.admin_audit_log (
  id          bigserial primary key,
  actor       uuid not null references auth.users(id),
  actor_role  text not null,        -- snapshotted; roles change, history should not
  action      text not null,        -- 'booking.confirm' | 'booking.discount' | 'booking.close' | ...
  booking_id  bigint null,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
```

Written from inside the admin/sales RPCs, never from the client. `owner` reads; nobody updates or
deletes — no policy for UPDATE or DELETE at all, so the log is append-only even for you.

Minimum set of logged actions for v1: booking confirmed, discount applied (carrying the list total
and the agreed total), total edited, booking closed or cancelled, payment recorded.

## 7. Frontend

`app.js:36` and `app.js:5439` currently decide "is admin" by comparing the session email to
`VITE_ADMIN_EMAIL`. Replace with a role fetched once on `onAuthStateChange` from `app_users`, held
in `appState`, and used to gate tab rendering.

Tabs to hide from `sales`: Staff Ops, Venues, Packages, Add-ons, Settings, Teams. The Close Booking
(`bcl`) modal keeps its Payment block but renders the cost fields only for `owner` — and since
`booking_costs` SELECT is denied to `sales` at the database, the embedded select returns nothing for
them anyway. **UI gating is cosmetic and must stay that way**: every hidden control must also be
denied in RLS or an RPC guard. If hiding it in JS is the only thing stopping the action, it is not
stopped.

Three namespaces in `app.js` must not share state — `stt` (staff ops), `bcl` (close booking), `abk`
(add booking). A role gate touches all three; keep the edits additive, as
`STAFF_STATUS_TOOL_PLAN.md` requires.

## 8. Out of scope

- Changing the field-staff token model. It works; a login for someone who does setups at a venue is
  a downgrade.
- Per-region sales scoping (column reserved, unused).
- Multiple owners. One `owner` row until there is a reason for two.
- Anything about how the salesperson actually sells. `docs/WHATSAPP_SALES_AUDIT_2026-07-06.md`
  already covers that and is the more valuable document of the two.

## 9. Verification checklist

Run every one of these as a throwaway `sales` account before the hire's first day, in a rolled-back
transaction where possible:

1. `select * from booking_costs` → **0 rows or permission denied**. This is the one that matters most.
2. `PATCH /rest/v1/venue_packages` with a new price → **denied**.
3. `PATCH /rest/v1/site_settings` → **denied**. Same for `teams`.
4. `select * from bookings` → returns bookings (this is intended).
5. `admin_edit_booking` applying a discount → accepted, **and an audit row is written carrying the
   list total, the agreed total and the note**. Confirm the row exists before trusting the path.
6. `admin_edit_booking` with a changed total and an empty note → **rejected**.
7. `admin_issue_staff_token` → **denied**.
8. Delete any booking → **denied**.
9. Set `is_active = false` on their `app_users` row → next request fails immediately, no wait for
   token refresh.
10. Then repeat 1–8 as Aksheev and confirm every one succeeds.

Test against a throwaway account, not production data, for the same reason the staff tool did:
inserting a confirmed booking fires `trigger_notify_booking_confirmed_on_insert` and emails a real
guest.

## 10. Open decisions for Aksheev

1. **Who reads the audit log, and how often?** With no floor (§5) this is the only discount
   control that exists. Weekly is the loosest cadence that still catches a pattern inside a month.
2. **Does `sales` get to see `advance_amount` and balance?** Yes in the table above, because they
   need it to chase payment. Say if not.
3. **Does `sales` get delete rights on leads?** Assumed no. Junk leads get a status, not a delete.
4. **`viewer` role — build it now or leave the check constraint room and add it later?** Assumed later.
5. **Phase 5 of the region plan** (token 10 still unscoped) — fold into phase 3 of this plan or
   leave it separate?

---

## Appendix — the 14 tables carrying the hardcoded email

`add_ons`, `booking_add_ons`, `booking_costs`, `booking_event_log`, `bookings`,
`ical_feed_snapshots`, `menu_links`, `orders`, `package_add_ons`, `packages`, `staff_tokens`,
`venue_add_ons`, `venue_availability`, `venues`.

Plus 5 RPCs: `admin_add_manual_booking`, `admin_close_booking`, `admin_edit_booking`,
`admin_issue_staff_token`, `admin_resend_confirmation`.
