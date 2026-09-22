-- 20260922_booking_source
-- Structured booking channel. Replaces the practice of typing channel labels
-- ("WhatsApp", "Direct", "Airbnb") into the free-text external_booking_ref, which
-- made "which bookings came from ads" unanswerable. external_booking_ref stays as
-- the Airbnb reservation code field (the stay conflict checks read it).
--
-- Values: instagram_ad, instagram_organic, whatsapp, referral, airbnb, direct,
-- walk_in (admin dropdown) + website (auto-set for entry_source='site').
-- NULL = legacy row with no recorded channel.

alter table public.bookings add column if not exists booking_source text;

alter table public.bookings drop constraint if exists bookings_booking_source_check;
alter table public.bookings add constraint bookings_booking_source_check check (
  booking_source is null or booking_source in
  ('instagram_ad','instagram_organic','whatsapp','referral','airbnb','direct','walk_in','website')
);

create index if not exists bookings_booking_source_idx on public.bookings (booking_source);

-- Website bookings get 'website' automatically (submit_booking_intent is untouched).
create or replace function public.bookings_default_source()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
  if new.booking_source is null and coalesce(new.entry_source, 'site') = 'site' then
    new.booking_source := 'website';
  end if;
  return new;
end $$;

drop trigger if exists set_booking_source on public.bookings;
create trigger set_booking_source before insert on public.bookings
  for each row execute function public.bookings_default_source();

-- Backfill only where the old free-text field already said the channel.
update public.bookings set booking_source = 'website'
  where booking_source is null and entry_source = 'site';
update public.bookings set booking_source = 'airbnb'
  where booking_source is null and (external_booking_ref ~ '^HM[A-Z0-9]{8}$' or external_booking_ref = 'Airbnb');
update public.bookings set booking_source = 'whatsapp'
  where booking_source is null and external_booking_ref = 'WhatsApp';
update public.bookings set booking_source = 'direct'
  where booking_source is null and external_booking_ref in ('Direct', 'direct-extension');

-- Admin RPCs: patch in booking_source by exact text replacement so the rest of
-- each (long) function body is untouched. Fails loudly if an anchor is missing.
do $mig$
declare
  src text;
  new_src text;
begin
  -- admin_add_manual_booking: read, require, insert
  src := pg_get_functiondef('public.admin_add_manual_booking'::regproc);
  if position('booking_source' in src) = 0 then
    new_src := replace(src,
      $a$  v_ext_ref    text := nullif(p_booking->>'external_booking_ref', '');$a$,
      $a$  v_ext_ref    text := nullif(p_booking->>'external_booking_ref', '');
  v_source     text := nullif(p_booking->>'booking_source', '');$a$);
    new_src := replace(new_src,
      $a$  if coalesce((p_booking->>'guest_count')::int, 0) < 1 then raise exception 'Guest count is required'; end if;$a$,
      $a$  if coalesce((p_booking->>'guest_count')::int, 0) < 1 then raise exception 'Guest count is required'; end if;
  if v_source is null then raise exception 'Booking source is required'; end if;$a$);
    new_src := replace(new_src,
      $a$    slot_start_time, slot_end_time
  ) values ($a$,
      $a$    slot_start_time, slot_end_time, booking_source
  ) values ($a$);
    new_src := replace(new_src,
      $a$    v_slot_start, v_slot_end
  ) returning id into v_id;$a$,
      $a$    v_slot_start, v_slot_end, v_source
  ) returning id into v_id;$a$);
    if (length(new_src) - length(replace(new_src, 'v_source', ''))) / length('v_source') <> 3 then
      raise exception 'admin_add_manual_booking patch anchors not all found';
    end if;
    execute new_src;
  end if;

  -- admin_edit_booking: update when provided, else keep existing
  src := pg_get_functiondef('public.admin_edit_booking'::regproc);
  if position('booking_source' in src) = 0 then
    new_src := replace(src,
      $a$    slot_end_time        = v_slot_end
  where id = p_booking_id;$a$,
      $a$    slot_end_time        = v_slot_end,
    booking_source       = coalesce(nullif(p_booking->>'booking_source', ''), v_existing.booking_source)
  where id = p_booking_id;$a$);
    if position('booking_source' in new_src) = 0 then
      raise exception 'admin_edit_booking patch anchor not found';
    end if;
    execute new_src;
  end if;
end
$mig$;
