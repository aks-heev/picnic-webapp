-- ✅ APPLIED to production 2026-10-17 (owner ran it in the Supabase SQL editor;
--   apply_migration approval kept timing out). Verified live: 13 rolled-back
--   DO-block checks passed, zero residue. The staff.js / app.js code that calls
--   these RPCs was already live and switched on automatically.
-- ============================================================================
-- Guest reviews collected in person on /staff (picnics only).
--
-- Flow: after setup is done, staff tap "Guest review" on today's card and hand
-- the phone over; a full-screen guest form (list removed from the DOM) takes
-- the rating, review and private feedback. The guest is NOT asked for a name:
-- it comes from bookings.full_name, published as "First L." (owner's call,
-- 2026-10-11). No tick-box: the form shows a visible notice that the review +
-- first name may appear on the website, and
-- the client sends p_publish_consent = true (owner's call, 2026-10-11). The
-- column stays so a future opt-out can set it false without a schema change.
-- Admin approves in the panel. The public site reads ONLY through
-- public_reviews(), which returns approved + consented reviews at or above
-- site_settings.reviews_min_public_rating (default 4, the owner's choice on
-- 2026-10-11; set it to 1 to publish every consented review).
--
-- 🔴 Separate table, never columns on `bookings`: customer_select_own_bookings
--    is row-level, so a signed-in customer reads every bookings column.
-- 🔴 private_feedback is never returned by public_reviews(). Admin-only.
-- 🔴 Staff write scope = staff_event_ids_active() (today + pre-04:00 grace),
--    same day-cap as staff_log_step. A leaked link cannot plant reviews on
--    past or future bookings.
-- ============================================================================

create table if not exists public.booking_reviews (
  id                bigint generated always as identity primary key,
  booking_id        bigint not null unique references public.bookings(id) on delete cascade,
  rating            smallint not null check (rating between 1 and 5),
  review_text       text check (review_text is null or char_length(review_text) <= 1000),
  private_feedback  text check (private_feedback is null or char_length(private_feedback) <= 1000),
  publish_consent   boolean not null default false,
  status            text not null default 'pending' check (status in ('pending','approved','hidden')),
  staff_token_id    bigint references public.staff_tokens(id) on delete set null,
  collected_by      text,
  created_at        timestamptz not null default now(),
  moderated_at      timestamptz
);

create index if not exists booking_reviews_public_idx
  on public.booking_reviews (status, publish_consent, rating, created_at desc);
create index if not exists booking_reviews_staff_token_idx on public.booking_reviews (staff_token_id);

alter table public.booking_reviews enable row level security;
revoke all on public.booking_reviews from anon;

drop policy if exists booking_reviews_admin_select on public.booking_reviews;
create policy booking_reviews_admin_select on public.booking_reviews
  for select to authenticated using ((select auth.email()) = 'aksh.eeev@gmail.com');
drop policy if exists booking_reviews_admin_update on public.booking_reviews;
create policy booking_reviews_admin_update on public.booking_reviews
  for update to authenticated using ((select auth.email()) = 'aksh.eeev@gmail.com')
  with check ((select auth.email()) = 'aksh.eeev@gmail.com');
drop policy if exists booking_reviews_admin_delete on public.booking_reviews;
create policy booking_reviews_admin_delete on public.booking_reviews
  for delete to authenticated using ((select auth.email()) = 'aksh.eeev@gmail.com');
-- No INSERT policy: inserts only via staff_submit_review (SECURITY DEFINER).

insert into public.site_settings (key, value, updated_at)
values ('reviews_min_public_rating', '4', now())
on conflict (key) do nothing;

-- ---------------------------------------------------------------- staff write
create or replace function public.staff_submit_review(
  p_token text, p_booking_id bigint, p_rating int, p_review_text text,
  p_private_feedback text, p_publish_consent boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_tok  public.staff_tokens%rowtype;
  v_text text := nullif(btrim(coalesce(p_review_text, '')), '');
  v_priv text := nullif(btrim(coalesce(p_private_feedback, '')), '');
  v_id   bigint;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  select * into v_tok from public.staff_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if not exists (select 1 from public.staff_event_ids_active(v_tok.region) x where x = p_booking_id) then
    return jsonb_build_object('ok', false, 'error', 'not_today');
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'error', 'bad_rating');
  end if;
  if char_length(coalesce(v_text, '')) > 1000 or char_length(coalesce(v_priv, '')) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;

  -- One review per booking. A replayed queue job is a no-op that still reports
  -- ok, so the client can drop it — never overwrite what the guest wrote.
  insert into public.booking_reviews
    (booking_id, rating, review_text, private_feedback,
     publish_consent, staff_token_id, collected_by)
  values
    (p_booking_id, p_rating, v_text, v_priv,
     coalesce(p_publish_consent, false), v_tok.id, v_tok.staff_name)
  on conflict (booking_id) do nothing
  returning id into v_id;

  update public.staff_tokens set last_used_at = now() where id = v_tok.id;

  return jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'duplicate', v_id is null);
end;
$function$;

revoke all on function public.staff_submit_review(text, bigint, int, text, text, boolean) from public;
grant execute on function public.staff_submit_review(text, bigint, int, text, text, boolean) to anon, authenticated;

-- ------------------------------------------------- which of today's are done
-- Separate from staff_today on purpose: staff_today is the page's load-bearing
-- payload with two allowlists; this returns booking ids only, no review content.
create or replace function public.staff_reviewed_ids(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_tok public.staff_tokens%rowtype;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  select * into v_tok from public.staff_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  return jsonb_build_object('ok', true, 'ids', coalesce((
    select jsonb_agg(r.booking_id)
    from public.booking_reviews r
    where r.booking_id in (select x from public.staff_event_ids_active(v_tok.region) x)
  ), '[]'::jsonb));
end;
$function$;

revoke all on function public.staff_reviewed_ids(text) from public;
grant execute on function public.staff_reviewed_ids(text) to anon, authenticated;

-- --------------------------------------------------------------- admin review
create or replace function public.admin_set_review_status(p_review_id bigint, p_status text)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.email() is distinct from 'aksh.eeev@gmail.com' then
    raise exception 'Admin login required';
  end if;
  if p_status not in ('pending', 'approved', 'hidden') then
    raise exception 'Unknown status %', p_status;
  end if;
  update public.booking_reviews
     set status = p_status, moderated_at = now()
   where id = p_review_id;
  if not found then
    raise exception 'Review % not found', p_review_id;
  end if;
end;
$function$;

revoke all on function public.admin_set_review_status(bigint, text) from public, anon;
grant execute on function public.admin_set_review_status(bigint, text) to authenticated;

-- ------------------------------------------------------- public display name
-- 'riya  sharma' -> 'Riya S.'   'Riya' -> 'Riya'   '' / null -> 'Guest'
-- 'Mr. Rahul Kumar Gupta' -> 'Rahul G.' (leading Mr/Mrs/Ms/Miss/Dr dropped)
-- Derived at read time from the booking, so fixing a typo in the booking's
-- name fixes the website too. Never the full surname.
create or replace function public.review_display_name(p_full_name text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when btrim(coalesce(p_full_name, '')) = '' then 'Guest'
    when array_length(w, 1) = 1 then initcap(w[1])
    else initcap(w[1]) || ' ' || upper(left(w[array_length(w, 1)], 1)) || '.'
  end
  from (select regexp_split_to_array(
                 regexp_replace(btrim(coalesce(p_full_name, '')), '^(mr|mrs|ms|miss|dr)\.?\s+', '', 'i'),
                 '\s+') as w) x
$function$;

-- ------------------------------------------------------------- public read
-- Only what is safe to print on the website. No surname, no phone, no email,
-- no booking id, no private_feedback. Date is month precision.
create or replace function public.public_reviews(p_venue_id bigint default null, p_limit int default 12)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with s as (
    select coalesce((select nullif(value, '')::int from public.site_settings
                     where key = 'reviews_min_public_rating'), 4) as min_rating
  )
  select coalesce(jsonb_agg(to_jsonb(t) - 'sort_at' order by t.sort_at desc), '[]'::jsonb)
  from (
    select public.review_display_name(b.full_name) as display_name, r.rating, r.review_text,
           b.occasion, v.id as venue_id, v.name as venue_name, v.city,
           to_char(b.preferred_date, 'Mon YYYY') as month,
           r.created_at as sort_at
    from public.booking_reviews r
    join public.bookings b on b.id = r.booking_id
    left join public.venues v on v.id = b.venue_id
    cross join s
    where r.status = 'approved'
      and r.publish_consent
      and r.rating >= s.min_rating
      and r.review_text is not null
      and (p_venue_id is null or b.venue_id = p_venue_id)
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit, 12), 1), 50)
  ) t
$function$;

revoke all on function public.public_reviews(bigint, int) from public;
grant execute on function public.public_reviews(bigint, int) to anon, authenticated;
