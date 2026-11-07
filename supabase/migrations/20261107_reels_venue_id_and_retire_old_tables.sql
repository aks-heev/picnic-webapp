-- Applied to evmftrogyzoudiccqkya 2026-11-07.
-- 1. reels.venue_id: which venue a reel was shot at. Nullable (= shows in every city).
--    The venue's region gives the city, so no separate reels.region column.
alter table public.reels
  add column if not exists venue_id bigint references public.venues(id) on delete set null;
create index if not exists reels_venue_id_idx on public.reels (venue_id);
comment on column public.reels.venue_id is
  'Venue the reel was shot at. NULL = not venue-specific, shown on every city brochure. City = venues.region.';

-- 2. occasion_reels: superseded by public.reels on 2026-10-24 (all 9 rows copied by
--    migration reels_import_occasion_reels). No code reads it, but pg_stat showed a
--    read on 2026-11-03, so RENAME first (reversible) and drop after 2026-11-21.
alter table public.occasion_reels rename to _deprecated_occasion_reels;
comment on table public._deprecated_occasion_reels is
  'Superseded by public.reels (2026-10-24). Renamed 2026-11-07; drop after 2026-11-21 if nothing broke. Undo: alter table public._deprecated_occasion_reels rename to occasion_reels;';

-- 3. image_refs_backup_20260907: rollback snapshot for the 2026-09-07 image
--    re-point, settled for 2 months. Moved out of the API-exposed public schema into
--    archive (kept, not dropped). Rollback SQL in 20260907_repoint_images_* must now
--    read archive.image_refs_backup_20260907.
create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;
alter table public.image_refs_backup_20260907 set schema archive;
