# Spec — Cafe Food & Drink Inclusions

**Status:** Approved, ready to build
**Date:** 2026-06-11
**Scope:** Display-only. No billing changes.

## Problem

Cafe-venue bookings include a set number of food items and beverages in the tier price, scaled to group size (e.g. 2 adults → 3 food + 2 drinks). Today nothing communicates this to the customer. They can't see what's included, so the inclusion has zero conversion value and creates "what do I actually get?" confusion. Customers order anything beyond the inclusions à la carte (a separate, existing flow).

## Goals

- Show each cafe booking how many food items and beverages are included, scaled to the number of adults.
- Make the inclusion visible on the venue detail page, in the booking-flow summary, and in confirmation emails.
- Keep it purely informational — no effect on price or the à la carte order flow.

## Non-Goals

- No item selection. Customers do **not** pick which food/drinks are included (that's a possible future phase).
- No deduction of inclusions from à la carte orders. Inclusions are bundled; à la carte is fully separate and additive.
- No billing or invoice changes of any kind.
- No admin UI for editing multipliers (set via SQL on two rows).

## Decisions

### Inclusion math
```
food   = ceil(adults × food_multiplier)
drinks = ceil(adults × drink_multiplier)
```
- Rounding is **ceiling** (3 adults × 1.5 = 4.5 → 5 food, 3 drinks).
- Multipliers live in `venue.metadata`: `food_multiplier`, `drink_multiplier`.
- Same values for all cafes: **food 1.5, drink 1.0** (Beige id 14, Sunroom id 18).
- A venue without these keys shows **no** inclusion line (non-cafe venues are unaffected).
- Inclusions are computed on **adults only** — children are excluded entirely.

### Children policy change (under-10 free)
- Children **under 10** are free: they do **not** affect price, inclusions, or capacity.
- The booking "children" field is redefined to mean *children under 10*. Anyone 10+ counts as an adult. No per-child ages are collected — honest count, same as today.
- This **retires** the prior half-price-children logic. `getPicnicPrice` drops the `free_children_count` + `paidKids × overage × 0.5` term. Price keys off adults only:
  ```
  picnicPrice = getVenuePrice(venue, adults)
  ```
- `free_children_count` and `getFreeKids()` become dead and are removed.

### Capacity
- No change. Per product decision, child count does not gate tiers or availability.

## Risks

- **Copy is the load-bearing part.** Inclusions are adult-sized; a parent who brought kids may expect them fed by the inclusion. Every surface that shows the inclusion must also say inclusions are based on adults and children order à la carte. This is the main support-complaint risk and is amplified by the free-kids policy.
- **Email source-of-truth drift.** Deployed edge functions differ from the local repo copies. Emails must be patched against the **deployed** source (`get_edge_function` first), not the repo files. The current deployed copy says "first 2 children free," which is now false and must become "children free."

## Implementation

1. **Metadata** — SQL: add `food_multiplier: 1.5`, `drink_multiplier: 1` to venues 14 and 18.
2. **Pricing** — rewrite `getPicnicPrice(venue, adults)` to adults-only; remove `getFreeKids`; update 5 call sites (drop the `children` arg).
3. **Inclusion helper** — `getInclusions(venue, adults)` → `{food, drinks}` using ceiling math; returns null/empty when multipliers absent.
4. **Display** — render inclusion line on cafe venue detail page and live in the booking-flow summary as adults change; add the "based on adults, kids order à la carte" note.
5. **Form copy** — relabel children field "Children under 10 (free)".
6. **Emails** — patch deployed `notify-booking-received` (v10) and `notify-booking-confirmed` (v11): add inclusion line, fix the children copy.
7. **Verify** — boundary cases (1/2/3 adults, with and without kids), browser-check display, commit + push.

## Acceptance criteria

- A 2-adult cafe booking shows "3 food items, 2 beverages" on venue page, booking summary, and both emails.
- 3 adults shows "5 food items, 3 beverages."
- Adding children under 10 changes neither the price nor the inclusion counts.
- A booking with N children under 10 and M adults is priced exactly as M adults.
- Non-cafe venues show no inclusion line and are otherwise unchanged.
