# SPEC — Razorpay Webhook Backstop + Admin Payment Status

**Status:** ✅ SHIPPED (verified live 2026-07-06 — `razorpay-webhook` deployed v4, `create-order` v10, `verify-payment` v8; admin payment badges in app.js). Kept for reference.
**Author:** handoff continuation, 2026-06-14
**Project:** evmftrogyzoudiccqkya (Picnic Stories)
**Depends on:** Razorpay Standard Checkout integration (already LIVE — `create-order` v5, `verify-payment` v4)

---

## 1. Background & problem

Razorpay Standard Checkout is live and working. Booking confirmation currently
depends **entirely on the customer's browser**:

```
Razorpay modal success
  → handler fires verifyAndFinish()        [runs in customer's tab]
  → calls verify-payment edge fn           [runs in customer's tab]
  → server recomputes HMAC, on match PATCHes booking confirmed=true, payment_status=paid
  → on_booking_confirmed_notify trigger fires → confirmation email
```

**Failure mode:** if the customer closes the tab on the success screen, loses
connection, the browser crashes, or `verifyAndFinish` throws, then Razorpay has
**captured the money** but the booking stays `confirmed=false,
payment_status=pending`, the trigger never fires, and **no confirmation email is
sent**. Result: a paying customer who believes they're booked while the system
shows nothing.

Separately, the admin bookings/queries UI does not surface `payment_status` or
the `razorpay_*` ids, so there is **no way to spot** a paid-but-unconfirmed (or
failed) booking from inside the app — you'd have to cross-reference the Razorpay
dashboard.

This spec covers two complementary changes:

- **Feature A — Admin payment status display** (frontend only): see payment state at a glance. Cheap. Lets you *catch* the gap manually.
- **Feature B — `payment.captured` webhook** (backend): server-to-server backstop that confirms the booking independent of the customer's browser. The actual *fix*.

They are independent and can ship separately. Recommended order: A first (it is also the tool you use to observe whether B is needed), then B.

---

## 2. Current state (verified from live code)

- `create-order` (v5, `verify_jwt=true`): receives `{ amount, currency, receipt }`, creates a Razorpay order with `payment_capture: 1`, returns `{ order_id, amount, currency, key_id }`. Body sent to Razorpay is `{ amount, currency, receipt, payment_capture: 1 }` — **no `notes`**. `receipt` is `booking_<id>` (set by the client).
- `verify-payment` (v4, `verify_jwt=true`): HMAC-verifies `order_id|payment_id`, on match PATCHes booking `confirmed=true, payment_status=paid` + razorpay ids, guarded with `&confirmed=eq.false`. **This is the only place `razorpay_order_id` gets written to the booking row.**
- `bookings` columns (live): `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature` (text, nullable), `payment_status` (text, default `'pending'`, check `pending|paid|failed`).
- Admin fetch is already `select('*, venues(...)')` → `payment_status` + `razorpay_*` already arrive on each booking object, just unrendered.
- `app.js` render functions: `renderBookings` (~3252), `renderQueries` (~3098), shared `occasionBoardHtml` (~3238).

### ⚠️ Mapping wrinkle (critical for Feature B)

The webhook must map an incoming Razorpay payment back to a booking row.
Because the booking's `razorpay_order_id` is **only written by `verify-payment`**
(the client path the webhook is meant to compensate for), in the exact failure
case the row has **no order id to match against**. The webhook therefore cannot
look up the booking by `razorpay_order_id`.

**Resolution:** embed the booking id in the Razorpay order's `notes` at
`create-order` time. Razorpay propagates `notes` onto the payment entity, so the
webhook reads `payload.payment.entity.notes.booking_id` directly. This is
backend-only — `create-order` already has `receipt = booking_<id>`, so it can
derive `booking_id` itself with no frontend change.

---

## 3. Feature A — Admin payment status display

### Scope
Frontend only. No DB, no edge functions, no migration.

### Changes

**`app.js` — `renderBookings` (~3252)**
Add a payment badge to the card header (`adm-card-header-right`, near the
`adm-amount-badge` / "Confirmed" badge). Render from `booking.payment_status`:

| value     | label        | class                 |
|-----------|--------------|-----------------------|
| `paid`    | Paid         | `adm-pay--paid`       |
| `pending` | Payment pending | `adm-pay--pending` |
| `failed`  | Payment failed | `adm-pay--failed`   |
| null/other| (omit)       | —                     |

Optionally render `razorpay_payment_id` as a `<code>` chip for reconciliation
(only when present). Use the existing `escapeHtml` helper.

**`app.js` — `renderQueries` (~3098)**
Add the same badge. Queries are now where abandoned/failed-payment leads land
(the new flow inserts `confirmed=false` first), so `payment_status=failed` here
is the "tried to pay, didn't complete" signal — high value.

**`style.css`**
Add `.adm-pay--paid` (green), `.adm-pay--pending` (amber), `.adm-pay--failed`
(red) pill styles, matching existing `.adm-badge` sizing.

### Acceptance
- A `paid` booking shows a green "Paid" badge.
- A `pending`/`failed` query shows the corresponding badge.
- A booking with null `payment_status` (e.g. legacy admin-confirmed) shows no payment badge and does not error.
- No console errors; `escapeHtml` used on all dynamic values.

### Effort / risk
~20 min. Pure frontend. Ships with a normal commit + push. Lowest risk.

---

## 4. Feature B — `payment.captured` webhook backstop

### Scope
- New edge function `razorpay-webhook` (**`verify_jwt=false`**).
- Edit `create-order` → add `notes` (redeploy v6).
- New secret `RAZORPAY_WEBHOOK_SECRET`.
- Manual Razorpay dashboard config (user action).

### 4.1 Edit `create-order` (→ v6)
Derive `booking_id` from `receipt` and pass `notes` to the Razorpay order:

```ts
const bookingId = receipt.startsWith("booking_") ? receipt.slice("booking_".length) : null
// ...
body: JSON.stringify({
  amount, currency, receipt, payment_capture: 1,
  notes: bookingId ? { booking_id: bookingId } : undefined,
}),
```

No change to the function's response shape; no frontend change.

### 4.2 New function `razorpay-webhook` (verify_jwt = false)

Authentication is by Razorpay's webhook signature, **not** a Supabase JWT — so
this function MUST be deployed public (`verify_jwt=false`).

Logic:
1. Read the **raw** request body as text (do not `JSON.parse` first).
2. Compute `HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)` hex; compare (timing-safe) against the `x-razorpay-signature` header. On mismatch → 400, log, stop.
3. `JSON.parse` the raw body. Read `event`.
4. On `payment.captured`:
   - `entity = payload.payment.entity`
   - `bookingId = entity.notes?.booking_id`
   - `orderId = entity.order_id`, `paymentId = entity.id`
   - PATCH `bookings?id=eq.<bookingId>&confirmed=eq.false` (service role) →
     `{ confirmed: true, payment_status: "paid", razorpay_order_id: orderId, razorpay_payment_id: paymentId }`.
     (Note: webhook has no `razorpay_signature` — leave it; the client path sets it when it also runs. Acceptable.)
   - The `&confirmed=eq.false` guard makes this idempotent with the client path: whichever arrives first wins, the second no-ops.
5. On `payment.failed` (optional): PATCH same guard → `{ payment_status: "failed" }`.
6. Unknown event / missing booking id → log, **return 200** anyway (never make Razorpay retry a no-op).
7. Always respond fast. Reuse the HMAC + timing-safe helpers verbatim from `verify-payment`.

Secrets used: `RAZORPAY_WEBHOOK_SECRET` (new), `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (auto-injected).

### 4.3 New secret
```
supabase secrets set RAZORPAY_WEBHOOK_SECRET=<the secret you set in the dashboard>
```
Set it cleanly (no trailing newline — same gotcha that caused the KEY_ID 401;
the function should still `.trim()` defensively).

### 4.4 Razorpay dashboard config (manual — cannot be automated)
1. Dashboard → Settings → Webhooks → Add New Webhook.
2. URL: `https://evmftrogyzoudiccqkya.supabase.co/functions/v1/razorpay-webhook`
3. Secret: choose one, use the same value for `RAZORPAY_WEBHOOK_SECRET`.
4. Active events: `payment.captured` (and `payment.failed` if implementing 4.2).
5. Save. Use the dashboard's webhook test/replay to fire a sample event.

### Acceptance
- Valid signature + `payment.captured` for a booking that is still `confirmed=false` → booking becomes `confirmed=true, payment_status=paid`; confirmation email sent once (trigger fires).
- Same event delivered twice → second is a no-op (guard); no duplicate email.
- Client `verify-payment` already confirmed the booking → later webhook is a no-op.
- Invalid/missing signature → 400, no DB change.
- Unknown booking id → 200, logged, no DB change.
- `RAZORPAY_WEBHOOK_SECRET` unset → function logs misconfig and returns 500 (does not silently accept).

### Effort / risk
~1–1.5 hrs including testing. All backend. Testing is the tedious part: trigger
a real captured test payment and either close the tab before `verify-payment`
runs (to simulate the race) or use dashboard webhook replay. Medium risk,
contained to new/edited functions.

---

## 5. Idempotency & ordering summary

Two independent writers (client `verify-payment`, server webhook) may confirm the
same booking. Both PATCH with `&confirmed=eq.false`. Therefore:
- First writer flips `confirmed` → trigger fires once → one email.
- Second writer matches zero rows → no-op → no second email.
- Order of arrival does not matter.

This invariant is the safety property; do not remove the `&confirmed=eq.false`
guard from either path.

---

## 6. Files touched

| File | Feature | Change |
|------|---------|--------|
| `app.js` (`renderBookings` ~3252) | A | payment badge in card header |
| `app.js` (`renderQueries` ~3098) | A | payment badge |
| `style.css` | A | `.adm-pay--paid/pending/failed` pills |
| `supabase/functions/create-order/index.ts` | B | add `notes: { booking_id }`; redeploy v6 |
| `supabase/functions/razorpay-webhook/index.ts` | B | **new** function, `verify_jwt=false` |
| Supabase secrets | B | `RAZORPAY_WEBHOOK_SECRET` |
| Razorpay dashboard | B | new webhook (manual) |

No DB migration required (columns already exist).

---

## 7. Rollout order

1. **Feature A** — edit `app.js` + `style.css`, `npm run build` locally, commit + push (Vercel).
2. **Feature B** —
   a. Deploy `create-order` v6 (notes).
   b. Deploy `razorpay-webhook` with `verify_jwt=false`.
   c. Set `RAZORPAY_WEBHOOK_SECRET`.
   d. Configure webhook in Razorpay dashboard.
   e. Test: dashboard replay + a real tab-close-before-verify run.
   f. Commit the new/edited function source.

---

## 8. Notes / standing rules (from CLAUDE.md)

- `app.js` is 6,100+ lines — edit via file tools only, never bash.
- Edge-fn source of truth = deployed version — `get_edge_function` before editing.
- Never commit/push without explicit user go-ahead.
- Run `npm run build` locally before any deploy (bash sandbox serves torn copies of `app.js`/`index.html`).
- Set secrets without trailing newlines (`printf %s`); functions `.trim()` defensively.
