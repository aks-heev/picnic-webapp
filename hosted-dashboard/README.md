# Hosted business dashboard

A standalone, single-file dashboard for the Gurugram & Delhi book. It is **not**
part of the picnic-webapp site and must never become a route inside it — it ships
as its own Vercel project so a mistake here can never take down picnicstories.com.

## What it reads

Supabase only (`evmftrogyzoudiccqkya`), via `supabase-js` from the browser:

| Table | Used for |
|---|---|
| `bookings` (+ embedded `venues`) | every confirmed Gurugram/Delhi booking |
| `booking_costs` | per-booking cost, and therefore profit |
| `booking_add_ons` | add-on lines in the detail view |
| `expenses` | the operating-expense panel |
| `monthly_occupancy_self_managed` | the occupancy section (`revenue-dashboard.html`) |
| `venues` | calendar only: setup capacity (`max_concurrent_setups`) and combo parent/child links |
| `venue_availability` (`source` = `ical`, `admin`) | calendar only: Airbnb nights with no booking row, and admin blocks |

`venues` and `venue_availability` are readable by any signed-in user (the public
site's availability calendar reads them) and hold no customer data. If either
read fails, the calendar still shows bookings and says what is missing.

## Pages

| Route | File | What |
|---|---|---|
| `/` | `index.html` | hub: one sign-in, a card per dashboard |
| `/revenue-dashboard` | `revenue-dashboard.html` | revenue, P&L, occupancy, bookings table |
| `/meta-dashboard` | `meta-dashboard.html` | Meta ads |
| `/calendar` | `calendar.html` | bookings calendar (below) |

## Calendar (`calendar.html`, 2026-09-28)

Two tabs: **Picnics** (month grid, guest name then venue and slot, "Full" when a
multi-setup venue reaches `max_concurrent_setups`) and **Airbnb & stays** (one
row per TerraCottage unit across 28 nights, plus a derived whole-home row that
is sellable only when every unit is free, and a list of open nights). Clicking a
day, a stay or a gap opens a dialog with the booking details. The revenue
dashboard's Next up card links here; the calendar code lives only in this file.

**Adding a booking.** The page itself never writes to the database. *Add
booking* opens the admin panel's own form inside a dialog —
`https://www.picnicstories.com/admin?embed=1#add-booking?type=…&venue=…&date=…`
(or `…&checkin=…&checkout=…`). `abkApplyPrefill` in `app.js` validates every
pre-filled value; `embed=1` hides the admin chrome (`admin.html`) and, after a
new booking saves, `app.js` posts `{type: 'tps:booking-saved', id, date,
checkout, kind}` to this page, which closes the dialog, reloads and opens the
new booking. Pricing, the conflict check, add-ons, the board message, the staff
checklist, the picnic/stay split and the emails all stay in that one form.

- 🔴 Do not add a second booking form to this project. The database function
  (`admin_add_manual_booking`) protects conflicts and money, but the admin form
  also carries add-on prices, the white-arch board message, checklist extras
  and the split — a copy would drift and save incomplete bookings.
- 🔴 The admin page may be framed only by origins in the `frame-ancestors`
  header for `/admin` in the repo-root `vercel.json`. A new dashboard domain
  must be added there AND to `ADMIN_EMBED_PARENTS` in `app.js`, or the dialog
  shows a refused frame (and the save message is never delivered).
- The embedded form has its own login: browsers keep an embedded site's
  storage separate, so the first use on each device asks for the admin
  password inside the dialog. "Open in new tab" in the dialog is the fallback.

The Cowork version of this dashboard read the Google Sheet as its book of record
and used the database only to cross-check it. A browser cannot read a Drive
document without Google OAuth, so this build inverts that and reads the database
alone. That became safe on 2026-09-03, when the four sheet-only bookings were
backfilled (rows 150–153), costs moved into `booking_costs`, and the workbook's
Expenses tab began mirroring into `public.expenses`.

Verified equal to the workbook's own Dashboard tab before the rewrite shipped:

```
picnic  13 bookings   revenue 193,014   cost 56,918   profit 136,096   outstanding 23,400
stay    28 bookings   revenue 302,842   cost  1,855   profit 300,987   outstanding 15,200
```

## Security

The anon key in `index.html` is public by design — it is the browser's ticket to
the API, not a credential. **All protection comes from RLS.** Verified live
against the REST endpoint and by simulating a session in Postgres:

| Caller | bookings | expenses | booking_costs |
|---|---|---|---|
| anon (not signed in) | 0 | 0 | 0 (403) |
| authenticated, non-admin | own rows only | 0 | 0 |
| authenticated, admin | all | all | all |

Read access is `auth.email() = 'aksh.eeev@gmail.com'`.

> 🔴 Adding an `anon` SELECT policy to `bookings` or `expenses` would make
> customer names, phones, emails and revenue readable by anyone with this URL.
> The sign-in screen is a front door, not the lock.

### Partner logins are not just an account

Handing a partner their own login will **not** work on its own — a non-admin
authenticated user reads zero rows. It needs an RLS change first: either widen
the policies to an allow-list of partner emails, or add a `partners` table and
key the policies off membership. Decide the access scope before creating any
account.

## Deploying

Static; no build step, nothing to install. From **this directory**:

```
cd hosted-dashboard
vercel --prod
```

Answer "no" when it offers to link to an existing project, and give it a new name
(e.g. `picnic-dashboard`). Do **not** add it to the `picnic-webapp` project — that
project builds the public site from the repo root and this must stay separate.

Vercel's own SSO/password protection is a second lock on top of the login screen.
Turning it on is reasonable while you are the only user; it has to come off before
a partner outside the Vercel team can open the link.

### Known follow-up: SRI on the Supabase script

Chart.js is loaded with a Subresource Integrity hash; `supabase-js` is not — it is
only version-pinned. Pinning stops a silent upgrade but not a compromised CDN
response. To close it:

```
curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

then add `integrity="sha384-<output>"` to that `<script>` tag.

## Editing

One self-contained file. The load path is `boot() → load() → render()`; the
money and reporting-basis logic carries inline comments explaining the traps it
was written around — read those before changing an amount, a channel test, or
the `paid` rule.
