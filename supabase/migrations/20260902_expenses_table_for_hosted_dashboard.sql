-- Operating expenses, mirrored from the workbook's Expenses tab by the Apps Script
-- sync. This is the ONE thing the dashboard needs that lives only in the sheet —
-- bookings, venues and per-booking costs (booking_costs, 15 rows) are already here.
-- Mirroring it lets a dashboard hosted outside Cowork read a single source over RLS,
-- with no service key in the browser and no serverless proxy.
--
-- The sheet stays the entry surface. This table is a read mirror, never authored here.
--
-- RLS verified live 2026-09-02 with a seeded row in a rolled-back transaction:
--   anon sees 0 | non-admin authenticated sees 0 | admin sees 1  -> PASS
create table if not exists public.expenses (
  id             bigserial primary key,
  spend_date     date,
  business       text,                      -- Picnic / Airbnb / Shared
  city           text,
  category       text,
  description    text,
  amount         numeric not null check (amount >= 0),
  paid_by        text,
  notes          text,
  -- Idempotency key: the Apps Script sends a stable hash of the sheet row so a
  -- re-run updates in place instead of duplicating. Without this every sync would
  -- add another copy of the rent line and the P&L would drift every 30 minutes.
  sheet_row_key  text not null unique,
  synced_at      timestamptz not null default now()
);

comment on table public.expenses is
  'Read mirror of the Gurugram/Delhi workbook Expenses tab, upserted by google-sheet-sync.gs on sheet_row_key. Authored in the sheet, never here. Exists so a dashboard hosted outside Cowork can read one source under RLS.';
comment on column public.expenses.sheet_row_key is
  'Stable hash of the sheet row (date|business|category|description|amount). Upsert key — prevents duplicate rows on every re-sync.';

create index if not exists expenses_spend_date_idx on public.expenses (spend_date);

alter table public.expenses enable row level security;

-- Same shape as admin_select_bookings. Deliberately NO anon policy of any kind:
-- an anon SELECT here would expose rent and overhead to anyone with the URL.
-- 🔴 The same rule protects `bookings`, which has no anon SELECT policy either.
-- Adding one would silently make a hosted dashboard world-readable.
drop policy if exists admin_select_expenses on public.expenses;
create policy admin_select_expenses on public.expenses
  for select to authenticated
  using (auth.email() = 'aksh.eeev@gmail.com');

drop policy if exists admin_insert_expenses on public.expenses;
create policy admin_insert_expenses on public.expenses
  for insert to authenticated
  with check (auth.email() = 'aksh.eeev@gmail.com');

drop policy if exists admin_update_expenses on public.expenses;
create policy admin_update_expenses on public.expenses
  for update to authenticated
  using (auth.email() = 'aksh.eeev@gmail.com');

drop policy if exists admin_delete_expenses on public.expenses;
create policy admin_delete_expenses on public.expenses
  for delete to authenticated
  using (auth.email() = 'aksh.eeev@gmail.com');
