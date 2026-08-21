-- ============================================================================
-- Staff Live Event-Status Tool — PHASE 1 (schema only)
-- Applied to production as migration version 20260820135229
-- Plan: docs/STAFF_STATUS_TOOL_PLAN.md
--
-- ADDITIVE ONLY. Two new tables. Nothing existing is altered.
-- Rollback: DROP TABLE public.booking_event_log, public.staff_tokens;
--
-- Design constraints this encodes:
--  C1  Status must NEVER be a column on `bookings` — customer_select_own_bookings
--      is row-level, so a signed-in customer reads every column of that table.
--  C2  Staff get no Supabase auth identity. Access lands in Phase 2 via two
--      SECURITY DEFINER RPCs. These tables carry NO anon grants at all.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- staff_tokens — one row per field staff member. Plaintext token is NEVER stored.
-- ---------------------------------------------------------------------------
create table public.staff_tokens (
  id            bigint generated always as identity primary key,
  staff_name    text        not null check (btrim(staff_name) <> ''),
  token_hash    text        not null unique,
  upload_prefix uuid        not null default gen_random_uuid(),
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

comment on table  public.staff_tokens is
  'Field-staff access tokens for the day-of status tool. Plaintext token is never stored — only sha256 hex in token_hash. Revoke by setting is_active=false.';
comment on column public.staff_tokens.token_hash is
  'encode(extensions.digest(<plaintext token>, ''sha256''), ''hex''). Set by admin_issue_staff_token (Phase 2).';
comment on column public.staff_tokens.upload_prefix is
  'Non-secret per-staff path prefix, reserved for the Phase 5 private staff-photos bucket. Safe to return to the client; identifies the uploader without exposing the token.';
comment on column public.staff_tokens.last_used_at is
  'Written by staff_today (Phase 2). Cheap liveness signal + leak detection.';

-- ---------------------------------------------------------------------------
-- booking_event_log — append-only. Current status of a booking = its last row.
-- ---------------------------------------------------------------------------
create table public.booking_event_log (
  id             bigint      generated always as identity primary key,
  booking_id     bigint      not null references public.bookings(id) on delete cascade,
  step           text        not null check (step in (
                               'reached','setup_done','payment_received','wrapped',
                               'guests_arrived','guests_left')),
  at             timestamptz not null default now(),
  staff_token_id bigint      references public.staff_tokens(id) on delete set null,
  by_name        text        not null check (btrim(by_name) <> ''),
  note           text,
  amount         numeric     check (amount is null or amount >= 0),
  photo_url      text
);

comment on table  public.booking_event_log is
  'Append-only day-of event steps. Spine (ordered): reached -> setup_done -> payment_received -> wrapped. Chips (order-free, non-blocking): guests_arrived, guests_left. Current status = latest row.';
comment on column public.booking_event_log.by_name is
  'Denormalised snapshot of staff_tokens.staff_name so attribution survives token deletion.';
comment on column public.booking_event_log.amount is
  'Only meaningful on payment_received: what staff SAY they collected. This table never moves money — reconciling into bookings.advance_amount stays a deliberate admin action.';
comment on column public.booking_event_log.photo_url is
  'Null until Phase 5. All Storage buckets are currently public, so photos are deliberately deferred.';

-- Idempotency: a double-tap on a flaky connection must be a no-op, not a duplicate.
-- Phase 2's staff_log_step relies on this for ON CONFLICT DO NOTHING, which in turn
-- is what makes the client-side retry queue safe to replay.
create unique index booking_event_log_step_once
  on public.booking_event_log (booking_id, step);

create index booking_event_log_booking_at_idx
  on public.booking_event_log (booking_id, at);

-- ---------------------------------------------------------------------------
-- RLS — admin-only, mirroring the booking_costs pattern.
-- NOTE: grants to `authenticated` are RETAINED on purpose. The admin signs in as
-- `authenticated`; the separation from customers is the auth.email() qual inside
-- the policies, not the role. Revoking from `authenticated` would lock the admin out.
-- `anon` is revoked outright.
-- ---------------------------------------------------------------------------
alter table public.staff_tokens       enable row level security;
alter table public.booking_event_log  enable row level security;

create policy admin_select_staff_tokens on public.staff_tokens
  for select using (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_insert_staff_tokens on public.staff_tokens
  for insert with check (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_update_staff_tokens on public.staff_tokens
  for update using (auth.email() = 'aksh.eeev@gmail.com')
             with check (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_delete_staff_tokens on public.staff_tokens
  for delete using (auth.email() = 'aksh.eeev@gmail.com');

create policy admin_select_booking_event_log on public.booking_event_log
  for select using (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_insert_booking_event_log on public.booking_event_log
  for insert with check (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_update_booking_event_log on public.booking_event_log
  for update using (auth.email() = 'aksh.eeev@gmail.com')
             with check (auth.email() = 'aksh.eeev@gmail.com');
create policy admin_delete_booking_event_log on public.booking_event_log
  for delete using (auth.email() = 'aksh.eeev@gmail.com');

revoke all on table public.staff_tokens      from anon;
revoke all on table public.booking_event_log from anon;

grant select, insert, update, delete on table public.staff_tokens      to authenticated;
grant select, insert, update, delete on table public.booking_event_log to authenticated;
