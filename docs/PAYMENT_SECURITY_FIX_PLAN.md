# Payment trust-boundary fixes — plan

> **✅ SHIPPED (verified live 2026-07-06):** `compute_booking_advance` exists in the DB and
> `create-order` (v10) / `verify-payment` (v8) are deployed past the patched versions; the
> notify functions now send from `team@picnicstories.com`. Nothing below is pending; kept for reference.

Three findings from the review, in priority order. The root cause is the same:
**nothing on the server decides what a customer pays or which booking a payment
confirms — the browser does.** The fix is three layers; do them in order. Layers
A1+A2 are drafted as code; Layer B is drafted as SQL below.

---

## The attack today (why this matters)

1. The browser computes `advance_amount` (`getVenuePrice` + add-ons, ÷2) and the
   RPC inserts it verbatim — a tampered client can store any advance (e.g. ₹1).
2. `create-order` charges the `amount` the browser sends (only checks ≥ ₹1).
3. `verify-payment` confirms a booking from a valid signature + a **client-supplied
   `booking_id`**, with no link between the paid order and that booking.

Net: a customer can confirm a real booking for ₹1 — by lowballing the advance, by
overriding the create-order amount, or by paying for a cheap order and replaying a
different booking id into verify-payment.

---

## Layer A1 — `create-order`: charge the booking's stored advance, not the client's

Drafted: `supabase/functions/create-order/index.ts` → see `index.patched.ts`.

- Resolve `booking_id` from the receipt (`booking_<id>`) or body.
- Read `advance_amount`, `confirmed`, `payment_status` server-side (service role).
- Use `round(advance_amount × 100)` as the order amount; the request `amount` is ignored.
- Reject already-paid bookings (409) and zero-advance bookings (400).
- After creating the order, write `razorpay_order_id` onto the booking (guarded
  `confirmed=eq.false`) so verify-payment can bind to it.

## Layer A2 — `verify-payment`: confirm only the order that belongs to the booking

Drafted: `supabase/functions/verify-payment/index.ts` → see `index.patched.ts`.

- Require `booking_id` (was optional).
- After the signature check, load the booking and require
  `booking.razorpay_order_id === razorpay_order_id`. Mismatch → 400, no confirm.
- Idempotent with the webhook: if already confirmed for the same order, return ok.

> A1 + A2 together close the order-swap and the create-order amount tamper. They are
> only fully authoritative once the **stored** advance is trustworthy — that's Layer B.

### Deploy A (after `npm run build` passes locally)
1. Review the two `index.patched.ts` files; replace the matching `index.ts`.
2. Confirm `bookings.razorpay_order_id` exists (it does — added in
   `add_razorpay_payment_columns_to_bookings`).
3. Redeploy `create-order` and `verify-payment` (keep `verify_jwt=true`).
4. Smoke test: a normal domestic-card payment still confirms; a verify-payment call
   with a mismatched `booking_id` returns `Payment does not match this booking.`

---

## Layer B — recompute the advance server-side (the real fix for finding #1)

Make the database the single source of truth for price. Add a pricing function and
call it inside `submit_booking_intent`, ignoring the client's `p_advance_amount`.

> ⚠️ The LIVE `submit_booking_intent` has extra params (`p_occasion`, `p_board`,
> `p_children_count`) not in the local migration file. Fetch the live definition
> first (`select pg_get_functiondef('public.submit_booking_intent'::regproc);`) and
> splice the call below into it — do not replace it from the old migration.

### Draft pricing function (mirrors `getVenuePrice` in app.js)

```sql
-- Server-authoritative advance. Mirrors getVenuePrice():
--   picnic = first tier whose up_to >= billing_guests, else
--            last_tier.price + overage_per_person * (billing_guests - last.up_to),
--            else venues.base_price when no tiers.
--   stay   = nights * metadata.stay_price_per_night   (0 for cafe)
--   addons = sum(add_ons.price) for active selected add-ons (looked up, NOT trusted)
--   advance = round((picnic + stay + addons) * 0.5)
create or replace function public.compute_booking_advance(
  p_venue_id       bigint,
  p_billing_guests integer,          -- adults only (guest_count - children_count)
  p_nights         integer,          -- 0 for cafe; (checkout - preferred) for stays
  p_addon_ids      integer[]         -- add_ons.id of the selected add-ons
) returns numeric
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_meta        jsonb;
  v_base        numeric;
  v_stay_rate   numeric;
  v_overage     numeric;
  v_picnic      numeric := 0;
  v_addons      numeric := 0;
  v_last_up_to  integer;
  v_last_price  numeric;
begin
  select base_price, metadata into v_base, v_meta
  from venues where id = p_venue_id;

  if not found then
    raise exception 'Unknown venue %', p_venue_id;
  end if;

  -- Picnic price from tiers, else base_price.
  if v_meta ? 'tiers' and jsonb_array_length(v_meta->'tiers') > 0 then
    select (t->>'price')::numeric into v_picnic
    from jsonb_array_elements(v_meta->'tiers') t
    where (t->>'up_to')::int >= greatest(p_billing_guests, 0)
    order by (t->>'up_to')::int asc
    limit 1;

    if v_picnic is null then          -- beyond the last tier → overage
      select (t->>'up_to')::int, (t->>'price')::numeric
        into v_last_up_to, v_last_price
      from jsonb_array_elements(v_meta->'tiers') t
      order by (t->>'up_to')::int desc
      limit 1;
      v_overage := coalesce((v_meta->>'overage_per_person')::numeric, 0);
      v_picnic  := v_last_price + (greatest(p_billing_guests,0) - v_last_up_to) * v_overage;
    end if;
  else
    v_picnic := coalesce(v_base, 0);
  end if;

  -- Add-ons: authoritative price from the catalog, active only.
  if p_addon_ids is not null and array_length(p_addon_ids, 1) > 0 then
    select coalesce(sum(price), 0) into v_addons
    from add_ons
    where id = any(p_addon_ids) and is_active = true;
  end if;

  -- Stay nights.
  v_stay_rate := coalesce((v_meta->>'stay_price_per_night')::numeric, 0);

  return round((v_picnic + coalesce(p_nights,0) * v_stay_rate + v_addons) * 0.5);
end;
$$;

grant execute on function public.compute_booking_advance(bigint, integer, integer, integer[])
  to anon, authenticated, service_role;
```

### Wire it into `submit_booking_intent`

Inside the live function, just before the `insert into bookings`, derive the advance
and use it instead of `p_advance_amount`:

```sql
  v_advance := public.compute_booking_advance(
    p_venue_id,
    greatest(p_guest_count - coalesce(p_children_count, 0), 0),
    case
      when p_checkout_date is not null and p_preferred_date is not null
        then greatest((p_checkout_date - p_preferred_date), 0)
      else 0
    end,
    (
      select array_agg(nullif(e->>'addon_id','')::int)
      from jsonb_array_elements(coalesce(p_add_ons, '[]'::jsonb)) e
      where nullif(e->>'addon_id','') is not null
    )
  );
  -- ... INSERT ... advance_amount = v_advance  (NOT p_advance_amount)
```

Also stop trusting `price_at_booking` from the client when inserting
`booking_add_ons`: look each price up from `add_ons` by `addon_id` instead of taking
`e->>'price_at_booking'`.

### Notes / things to verify before shipping Layer B
- Confirm the metadata keys actually used in prod: `tiers` (`up_to`, `price`),
  `overage_per_person`, `stay_price_per_night`. The SQL assumes those names from
  `getVenuePrice`; spot-check one café and one stay venue's `metadata`.
- Decide what to do if the client's `p_advance_amount` disagrees with the computed
  value — recommended: ignore it silently (server wins). Optionally log the delta.
- `combo` venues are already forced to query-only, so they never hit payment.
- Keep the client-side price display as-is (it's only an estimate now); the server
  number is the one that gets charged.

---

## Finding #3 (separate, low effort) — `sync-ical` test sender
`supabase/functions/sync-ical/index.ts:109` still sends from
`The Picnic Story <onboarding@resend.dev>` (test address → only delivers to the
account owner; old brand). Route it through `_shared/resend.ts` like the other
notify-* functions, or change the literal to
`The Picnic Stories <team@picnicstories.com>`. Then redeploy `sync-ical`.

---

## Suggested order of work
1. **Layer B** first (server-authoritative advance) — it's the root cause.
2. **A1 + A2** — they assume the stored advance is trustworthy, which B guarantees.
3. **#3** sync-ical sender — independent, ship anytime.
4. `npm run build` locally before each edge-function deploy (bash sandbox can't build).
5. Nothing here is committed or deployed yet — your call.
```
