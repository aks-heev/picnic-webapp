# My Bookings — Phone OTP (Twilio) Setup & Handoff

Switches the "My Bookings" lookup from email magic-link (which sent a broken
`localhost` link) to **phone-number OTP over SMS via Twilio**, using Supabase
Auth's native phone provider. Phone-only, no email fallback.

## What changed in code (already done)

- **DB:** `public.get_my_bookings()` — `SECURITY DEFINER` RPC. Reads the phone
  from the verified session JWT (never a parameter, so a user can only ever see
  their own bookings), normalises both the JWT phone and `bookings.mobile_number`
  to their **last 10 digits**, and returns bookings with venue nested.
  *Why last-10:* stored numbers are inconsistent (`+917742363777`,
  `7742363777`, `+91 88888 11111`); a plain equality match would hide the
  ~8 bare-format rows. Verified: matches all 55 rows for the one real number,
  vs 47 with naive equality.
- **`app.js`:** the whole My Bookings flow now uses
  `signInWithOtp({ phone })` / `verifyOtp({ phone, token, type: 'sms' })` and
  `supabase.rpc('get_my_bookings')`. Added `toE164India()` /
  `isValidIndiaMobile()` helpers (input → `+91XXXXXXXXXX`).
- **`app.js`:** `?view=mybookings` deep-link routing added.
- **`notify-booking-confirmed/index.ts`:** the dead "View Booking Details"
  button (`href="${APP_URL}"` → homepage) now points at
  `${APP_URL}/?view=mybookings`. **NOT yet deployed — see below.**

## You must do this (gates the whole feature)

### 1. Enable phone auth + wire Twilio in Supabase
Dashboard → **Authentication → Sign In / Providers → Phone**:
- Enable the **Phone** provider.
- SMS provider: **Twilio** (or Twilio Verify). Paste **Account SID**, **Auth
  Token**, and your **Message Service SID / from number** from the existing
  paid Twilio account.
- Leave "Enable phone confirmations" on.

Without this, `signInWithOtp({ phone })` returns an error and nothing sends.

### 2. Confirm +91 deliverability (the real risk)
A paid Twilio account does **not** guarantee SMS to Indian (+91) numbers.
India requires **DLT registration** of the sender/template. Before relying on
this:
- Check whether that earlier Twilio project actually sent SMS to **+91**
  numbers. If yes → you're clear.
- If it only sent to non-Indian numbers, you may hit **silent delivery
  failures** on +91. Register on DLT (or use Twilio's India onboarding) first.
- Test end-to-end with a real Indian number before announcing the feature.

### 3. Redeploy `notify-booking-confirmed` (button fix + pink email)
The button fix and the pink theme both go live only when this function is
redeployed. The repo file is already pink (`#c4607a`) with the fixed button —
just deploy it:

```
supabase functions deploy notify-booking-confirmed
```

`config.toml` now pins all four `notify-*` functions to **`verify_jwt = false`**
(added in this change). This matters: the DB trigger (`call_edge_function`)
sends **no Authorization header**, so a deploy that defaults `verify_jwt` to
`true` would 401 every confirmation email. The pin makes a plain
`supabase functions deploy` safe.

Context: the previously-live v9 was taupe (`#7a6a55`); the repo is pink, which
is what you want. Deploying the repo file is the intended change, not a
regression.

## Test checklist
- [ ] Enter a 10-digit number with bookings → receive SMS code → see bookings.
- [ ] Enter a number stored in bare format (e.g. `7742363777`) → bookings still
      resolve (proves normalisation).
- [ ] Enter a number with no bookings → "No bookings found".
- [ ] Confirmation email → "View Booking Details" opens the My Bookings page.
- [ ] Verify a customer phone session does **not** unlock the admin dashboard
      (the `applyAuthState` admin-email check already guards this).

## Notes
- Phone OTP creates an `auth.users` row per verified number (`shouldCreateUser`
  defaults true). Harmless — it's just the verification gate.
- OTP expiry text in the UI is generic ("expires shortly"); set the actual
  window under Authentication → providers if you want a specific value.
