-- 2026-11-10 — One money book, phase 1 (docs/LEDGER_MONEY_BOOK_PLAN_2026-11-10.md).
-- STATUS: APPLIED to production 2026-11-10 by the owner via the SQL editor. Verified: balances tie; owners read/write, Jaipur manager + customers + anon see nothing.
--
-- Every rupee movement of the Gurugram business, one row each. Replaces the hand-kept
-- "Ledger Picnic stories.xlsx" once the parallel run passes. Additive: nothing existing
-- reads or writes these objects. Rollback = drop view, two tables, one function.
--
-- Balance rule: an account's balance = (in - out on its own rows) - (in - out on rows that
-- name it as counter_account). A transfer is therefore ONE row, never two.
-- Rows are never deleted: void them. Amount/account/direction/date freeze 24h after entry.

create table public.money_accounts (
  code   text primary key,
  label  text not null,
  kind   text not null check (kind in ('partner','bank','cash','staff')),
  sort   int  not null default 0,
  active boolean not null default true
);
insert into public.money_accounts (code, label, kind, sort) values
  ('neeraj',  'Neeraj',  'partner', 1),
  ('aksheev', 'Aksheev', 'partner', 2),
  ('adhiraj', 'Adhiraj (Banna)', 'partner', 3),
  ('bank',    'Current account', 'bank', 4),
  ('cash',    'Cash box', 'cash', 5),
  ('sunny',   'Sunny (advances; salary not netted)', 'staff', 6);

create table public.money_entries (
  id              bigserial primary key,
  entry_date      date    not null,
  account         text    not null references public.money_accounts(code),
  direction       text    not null check (direction in ('in','out')),
  amount          numeric(12,2) not null check (amount > 0),
  kind            text    not null check (kind in ('expense','receipt','transfer','capital','deposit','opening','review')),
  category        text,
  description     text,
  booking_id      bigint  references public.bookings(id) on delete set null,
  counter_account text    references public.money_accounts(code),
  region          text    not null default 'ncr' check (region = 'ncr'),
  property        text,
  source          text    not null default 'app' check (source in ('app','bank_import','booking','migration')),
  source_ref      text    unique,
  needs_review    boolean not null default false,
  created_by      uuid    default auth.uid(),
  created_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text,
  check (counter_account is null or counter_account <> account),
  check ((voided_at is null) = (void_reason is null))
);
comment on table public.money_entries is
  'The single money book for Gurugram. One row per rupee movement. Transfers are one row with counter_account. Never delete: void. region is fixed to ncr by owner decision 2026-11-10 (Jaipur is out of scope).';

create index money_entries_account_idx on public.money_entries (account, entry_date);
create index money_entries_counter_idx on public.money_entries (counter_account) where counter_account is not null;
create index money_entries_booking_idx on public.money_entries (booking_id) where booking_id is not null;

create or replace function public.money_entries_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.created_at < now() - interval '24 hours'
     and (new.amount, new.account, new.direction, new.entry_date, new.counter_account)
         is distinct from (old.amount, old.account, old.direction, old.entry_date, old.counter_account) then
    raise exception 'money entry % is older than 24h: void it and add a new one instead of editing the money fields', old.id;
  end if;
  if old.voided_at is not null and new.voided_at is null then
    raise exception 'money entry % is voided and cannot be un-voided', old.id;
  end if;
  return new;
end $$;
create trigger money_entries_guard before update on public.money_entries
  for each row execute function public.money_entries_guard();
create trigger rbac_audit after insert or delete or update on public.money_entries
  for each row execute function public.rbac_audit('id');

alter table public.money_accounts enable row level security;
alter table public.money_entries  enable row level security;
revoke all on public.money_accounts, public.money_entries from anon;
revoke delete, truncate on public.money_entries from authenticated;
revoke insert, update, delete, truncate on public.money_accounts from authenticated;

-- Access comes only from app_users (customers are 'authenticated' too). Gurugram money only.
create policy rbac_money_accounts_select on public.money_accounts for select to authenticated
  using ((select app_can_region('ncr','money')));
create policy rbac_money_entries_select on public.money_entries for select to authenticated
  using (region = any((select app_regions('money'))::text[]));
create policy rbac_money_entries_insert on public.money_entries for insert to authenticated
  with check (region = any((select app_regions('money'))::text[]));
create policy rbac_money_entries_update on public.money_entries for update to authenticated
  using (region = any((select app_regions('money'))::text[]))
  with check (region = any((select app_regions('money'))::text[]));
-- deliberately NO delete policy.

create view public.money_account_balances with (security_invoker = true) as
select a.code, a.label, a.kind, a.sort,
       coalesce(own.net, 0) - coalesce(ctr.net, 0) as balance,
       own.n as entries, own.last_date
from public.money_accounts a
left join lateral (
  select sum(case when e.direction = 'in' then e.amount else -e.amount end) as net,
         count(*) as n, max(e.entry_date) as last_date
  from public.money_entries e where e.account = a.code and e.voided_at is null) own on true
left join lateral (
  select sum(case when e.direction = 'in' then e.amount else -e.amount end) as net
  from public.money_entries e where e.counter_account = a.code and e.voided_at is null) ctr on true;
revoke all on public.money_account_balances from anon;
comment on view public.money_account_balances is
  'Company money held per account. Replaces the xlsx Company Summary tab. security_invoker: inherits money_entries RLS.';
