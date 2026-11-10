# Ledger → one money book

**Written** 2026-11-10 · **Status**: Phase 1 LIVE 2026-11-10 (tables + 534-row import run by the owner; balances tie; access verified per identity). Phase 2 page BUILT 2026-11-10 (`hosted-dashboard/ledger.html`, route `/ledger`; tested against a stubbed backend only; NOT committed or deployed). Phases 3-5 not built · Source: the LIVE workbook is on OneDrive (`Picnic/Ledger Picnic stories.xlsx`), readable through the Microsoft 365 connector. The copy in this repo is a stale 7-Nov snapshot that also carries Claude-added analysis tabs (Txn Register, Category Map, Audit Findings) which do not exist in the live file. §0 figures below are from the 7-Nov copy.

## 0. What the ledger actually is (measured)

It is not an expense list. It is six cash ledgers (Neeraj, Aksheev, Current Account, Cash, Banna, Sunny) whose job is one number each: how much company money that person/account holds.

| Fact | Value |
|---|---|
| Rows, Jun to Oct | 484 (Expense 249 · Revenue 164 · Transfer 45 · Review 25 · Deposit 1) |
| October alone | 178 rows (Aksheev 94, Neeraj 65, bank 18, cash 1), about 6 a day |
| Expense rows | ₹7,04,787; median ₹450; 128 of 246 under ₹500; top repeats: porter, fruits, petrol, cake, food bill, Zepto, Meta ads |
| Expense rows naming a booking | 3 of 249 |
| Receipt rows naming a booking number | 15 of 164 |
| Unclassified "Review items" | 22 rows, ₹2,04,565 |
| `Expense` tab in the workbook | empty, never used |

The same money is being written in up to three places that do not agree:

| Spend | Excel ledger | `booking_costs` (Close booking) | Google sheet Expenses tab → `public.expenses` |
|---|---|---|---|
| Food, Jun to Oct | ₹98,863 | ₹1,06,293 | none |
| Photography, Jun to Oct | ₹50,509 | ₹98,086 | none |
| Rent / deposit / utilities | bank + cash tabs | none | 17 rows, ₹10,33,136, `paid_by` blank on all 17 |
| Booking receipts | typed as credits | `bookings.advance_amount` (no date, no receiver) | none |

So an "add expense" form on its own covers half the rows, leaves receipts and transfers in Excel, and becomes a fourth book.

🔴 Landmine for the naive version: `pushExpenses()` deletes every `public.expenses` row whose `synced_at` is older than the current run. A row written to that table by an app form would be wiped within 30 minutes.

## 1. Goal and done

One table holds every rupee movement. Each movement is typed once, on a phone, at the time it happens. Partner balances, the P&L, per-booking cost and the Excel file are all derived.

Done when, for one full calendar month: nobody types into the xlsx; the app's balance per account equals the hand-kept Company Summary to the rupee; bank balance equals the statement; unclassified is under 2% of rows.

## 2. Design

### 2.1 `money_entries` (new table, owner/manager RLS via `app_can_region(region,'money')`, audited by the existing `rbac_audit` trigger)

`id · entry_date · account (neeraj|aksheev|adhiraj|bank|cash|banna|sunny) · direction (in|out) · amount · kind (expense|receipt|transfer|capital|deposit|opening) · category · description · booking_id null · counter_account null · region · property null · source (app|bank_import|booking|migration) · source_ref unique null · created_by · created_at · voided_at/void_reason`

- A transfer is one row with `counter_account`; the balance view reads it from both sides. That removes the F12/F13 class of one-sided transfers.
- No edits to amount or account after 24h; correct by void + new row. No hard deletes.
- Categories are a fixed list (the 26 already in the Category Map), not free text.

### 2.2 Three capture paths, each for the rows it suits

1. **Phone form `/money`** (partners; 231 of 249 expense rows came from two phones). Amount → category chip → paid-by defaults to the signed-in partner → optional booking → save. Chips ordered by that person's own frequency. Reuse the `staff.js` offline queue and its no-SDK fetch budget. Target: under 10 seconds, 3 taps plus the amount.
2. **Booking money posts itself.** Close booking, Add booking and `admin_apply_staff_payment` gain one field, "Received by". The RPC writes the receipt row. Per-booking costs are entered as entries tagged with `booking_id`; `booking_costs.cost_*` becomes derived from them, so the close modal shows costs already logged instead of asking for them again. This is the `booking_payments` gap found on 2026-09-02, solved in the same table.
3. **Bank is imported, never typed.** Upload the statement CSV; rows dedupe on bank transaction id (`source_ref`). Airbnb, Razorpay, Meta and rent lines auto-categorise by rule; the rest land in a "needs category" queue.

### 2.3 Derived, never typed

`account_balances` view (replaces Company Summary) · `public.expenses` becomes a view over `money_entries` where kind = expense and no booking (keeps `unit_pnl_monthly` and the hosted dashboard working, and retires `pushExpenses`) · monthly xlsx export in the current tab layout for anyone who wants the file.

## 3. Phases, each with an exit condition

| # | Work | Exit condition |
|---|---|---|
| 0 | Decide the open items in §5. Migration source is the LIVE OneDrive workbook (Picnic/Ledger Picnic stories.xlsx), not the stale copy in this repo; regenerate the import on the day it runs. | Answers written here |
| 1 | Migration: table, RLS, balance view. Import all 484 rows + opening balances with `source='migration'`. | View balances equal the live OneDrive sheet. As read 2026-11-10 (rows to 10-Nov): Neeraj ₹1,26,980 · Aksheev ₹1,61,502.45 (sheet shows ₹1,60,002.45; its E75 formula skips the ₹1,500 'Manisha advance' row) · Adhiraj/Banna ₹1,90,410 · Bank ₹69,505.67 · Cash ₹0 |
| 2 | `/money` phone form, expenses and transfers only. Excel still kept in parallel. | 14 days; at least 90% of Excel rows for those days also exist in the app, entered the same day |
| 3 | "Received by" on the three booking payment paths; costs as tagged entries; `booking_costs` derived. | A closed booking shows the same cost in the close modal, the ledger and the dashboard with one entry made |
| 4 | Bank CSV import + category rules. | October statement imports with zero duplicates and ties to ₹1,61,089.81 |
| 5 | `expenses` → view; remove `pushExpenses`; stop typing in Excel; monthly export. | The "done" test in §1 |

Rollback at every phase before 5: the xlsx is still the book; drop the new objects.

## 4. Risks

| Risk | Mitigation |
|---|---|
| Neeraj does not enter at the time of spend (he owns 138 of 249 expense rows) | Phase 2 is a 14-day parallel run with a hard 90% gate. Miss it and stop: the problem is habit, not software |
| Double count during the parallel run | Dashboards keep reading the old sources until phase 5 |
| Derived `booking_costs` changes 151 existing rows | Existing figures migrate as tagged entries dated `closed_at`; totals diffed before the switch |
| Partners hold ₹3.46 lakh with no confirmation (audit F22) | Weekly digest to all three owners with each balance; each confirms or disputes |
| Unsupported opening balances (F07, F10, F17) | Imported as `kind='opening'` and flagged, not silently trusted |

## 5. Decisions (2026-11-10) and what is still open

1. **Neeraj types his own tab.** So the phone form is the right capture surface; no relay step to replace.
2. **Adhiraj: OPEN.** Owner said he holds company money and to check the Excel, but the 7-Nov workbook has no Adhiraj tab and no row naming him. Accounts in the file are Neeraj, Aksheev, Banna, Sunny, Current Account, Cash. Need: is "Banna" Adhiraj, or is his ledger kept somewhere else?
3. **Gurugram only.** Every entry is `region = 'ncr'`. Jaipur and the Jaipur manager get no access to this book. No region picker in the form.
4. **Booking costs: decided by evidence, not now.** Phases 1 and 2 do not touch `booking_costs`. During the 14-day parallel run, measure how often partners tag a booking on food / photo / flowers / decor entries. At 80% or more, derive `booking_costs` from tagged entries (phase 3 as written). Below that, keep the five columns and only add "paid by" to the close modal.

## 5a. Live workbook check (2026-11-10, 22:35 IST)

Live file: 11 tabs, 531 rows with an amount (49 newer than the 7-Nov copy; none removed). Import regenerated from it: `_temp/money_entries_import_2026-11-10.sql`, 534 rows, 36 flagged for review.

| Account | Live sheet | Rows actually sum to |
|---|---|---|
| Neeraj | 1,26,980 | 1,26,980 |
| Aksheev | 1,60,002.45 | **1,61,502.45** |
| Adhiraj (Banna) | 1,90,410 | 1,90,410 |
| Current account | 69,505.67 | 69,505.67 |
| Cash | 0 | 0 |

- 🔴 The live Aksheev tab still has the skipped-row bug: `E75` does not include row 74 ("Manisha advance", 1,500 credit), so the sheet understates his balance by 1,500. It was fixed only in the local copy.
- Aksheev row 152 (1-Nov) is a 60 debit with no description.
- Adhiraj went from 90,410 to 1,90,410 on 10-Nov ("banna transfer" 1,00,000 from Aksheev).
- The sheet is edited daily, so the import file must be regenerated from OneDrive on the day it is run.

## 6. How this plan was arrived at

Scored against: fixes the real bottleneck 25 · capture friction on a phone 20 · fits RLS/RBAC/free plan 15 · reversible sequencing 15 · controls and tie-outs 15 · specificity 10.

`53 → 72 → 85 → 88 → 88`

- 53: add-expense form writing to `public.expenses` (covers half the rows; wiped by the sync).
- 72: one `money_entries` table for all movements, balances as a view.
- 85: receipts post from booking flows, bank imported, costs entered once, migration with tie-out.
- 88: phone-first chips, void-not-edit, parallel-run gate, weekly balance confirmation.
- Escape round, three different shapes, none beat 88: WhatsApp message capture (transport not built; see `picnic-bot/README.md`), Google Form into the sheet (keeps a separate book), bank/UPI auto-ingest only (misses the 231 partner-paid rows).
