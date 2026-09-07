-- Rollback snapshot taken before the image re-encode migration (2026-09-07).
-- Captures the exact pre-migration state of every image reference so the
-- optimisation can be reverted with a single UPDATE ... FROM per table.
-- Deliberately a plain table, not a view: it must survive later edits.
create table if not exists public.image_refs_backup_20260907 (
  src         text not null,          -- 'venue' | 'package' | 'addon'
  row_id      bigint not null,
  images      jsonb,                  -- venues.images / packages.images verbatim
  image_url   text,                   -- add_ons.image_url verbatim
  captured_at timestamptz not null default now(),
  primary key (src, row_id)
);

insert into public.image_refs_backup_20260907 (src, row_id, images, image_url)
select 'venue', v.id, v.images, null from venues v
union all
select 'package', p.id, p.images, null from packages p
union all
select 'addon', a.id, null, a.image_url from add_ons a
on conflict (src, row_id) do nothing;

-- Admin-only: this mirrors customer-facing content, but there is no reason
-- for anon to read a backup table. No policies => no access except service_role.
alter table public.image_refs_backup_20260907 enable row level security;
