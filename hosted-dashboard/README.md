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
