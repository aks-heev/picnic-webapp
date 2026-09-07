-- Repoint image references at the pre-encoded variants uploaded under
-- opt/sm/ (800px) and opt/lg/ (1600px). Originals are untouched and remain
-- in place; this only changes which key the app asks for.
--
-- venues.images / packages.images: `url` -> lg, new `thumb` key -> sm.
--   Additive, so a client running older JS that ignores `thumb` still works.
-- add_ons.image_url: single text column, no room for two sizes -> sm, which
--   is ample for the add-on picker cards.
--
-- Every rewrite is guarded on the storage.objects row existing, so a
-- reference whose variant was never encoded is left pointing at its original
-- rather than at a 404. That deliberately skips inactive venues (20 refs
-- across 12 venues) and inactive add-on 31 ("Hot Air Balloon"), none of which
-- are rendered to visitors. NOTE: add-on 31 was missed by the encode pass
-- because that enumeration ran under the anon key and RLS policy
-- anon_select_add_ons filters is_active = true. Re-run the pipeline without
-- the active filter if those rows are ever reactivated.
--
-- Applied via MCP 2026-09-07. Verified after: venue(active) 80/80 on lg with
-- thumb, package 21/21, addon 13/14, inactive refs untouched.
--
-- Rollback:
--   update venues v   set images    = b.images
--     from public.image_refs_backup_20260907 b where b.src='venue'   and b.row_id=v.id;
--   update packages p set images    = b.images
--     from public.image_refs_backup_20260907 b where b.src='package' and b.row_id=p.id;
--   update add_ons a  set image_url = b.image_url
--     from public.image_refs_backup_20260907 b where b.src='addon'   and b.row_id=a.id;

with pref as (select 'https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/'::text p),
ex as (
  select v.id, e.ord, e.val, replace(e.val->>'url',(select p from pref),'') key
  from venues v, lateral jsonb_array_elements(v.images) with ordinality e(val,ord)
),
t as (
  select ex.*, split_part(ex.key,'/',1) bucket,
         regexp_replace(substr(ex.key, length(split_part(ex.key,'/',1))+2),
           '(\.(jpe?g|png|webp|gif|bmp|tiff?))+$','','i') stem
  from ex
),
rebuilt as (
  select t.id, jsonb_agg(
    case when osm.id is not null and olg.id is not null
      then t.val || jsonb_build_object(
             'url',   (select p from pref) || t.bucket || '/opt/lg/' || t.stem || '.webp',
             'thumb', (select p from pref) || t.bucket || '/opt/sm/' || t.stem || '.webp')
      else t.val end order by t.ord) imgs
  from t
  left join storage.objects osm on osm.bucket_id=t.bucket and osm.name='opt/sm/'||t.stem||'.webp'
  left join storage.objects olg on olg.bucket_id=t.bucket and olg.name='opt/lg/'||t.stem||'.webp'
  group by t.id
)
update venues v set images = r.imgs from rebuilt r where r.id = v.id;

with pref as (select 'https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/'::text p),
ex as (
  select pk.id, e.ord, e.val, replace(e.val->>'url',(select p from pref),'') key
  from packages pk, lateral jsonb_array_elements(pk.images) with ordinality e(val,ord)
),
t as (
  select ex.*, split_part(ex.key,'/',1) bucket,
         regexp_replace(substr(ex.key, length(split_part(ex.key,'/',1))+2),
           '(\.(jpe?g|png|webp|gif|bmp|tiff?))+$','','i') stem
  from ex
),
rebuilt as (
  select t.id, jsonb_agg(
    case when osm.id is not null and olg.id is not null
      then t.val || jsonb_build_object(
             'url',   (select p from pref) || t.bucket || '/opt/lg/' || t.stem || '.webp',
             'thumb', (select p from pref) || t.bucket || '/opt/sm/' || t.stem || '.webp')
      else t.val end order by t.ord) imgs
  from t
  left join storage.objects osm on osm.bucket_id=t.bucket and osm.name='opt/sm/'||t.stem||'.webp'
  left join storage.objects olg on olg.bucket_id=t.bucket and olg.name='opt/lg/'||t.stem||'.webp'
  group by t.id
)
update packages pk set images = r.imgs from rebuilt r where r.id = pk.id;

with pref as (select 'https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/'::text p),
t as (
  select a.id, a.image_url,
         split_part(replace(a.image_url,(select p from pref),''),'/',1) bucket,
         regexp_replace(
           substr(replace(a.image_url,(select p from pref),''),
                  length(split_part(replace(a.image_url,(select p from pref),''),'/',1))+2),
           '(\.(jpe?g|png|webp|gif|bmp|tiff?))+$','','i') stem
  from add_ons a
  where a.image_url is not null and a.image_url <> ''
)
update add_ons a
   set image_url = (select p from pref) || t.bucket || '/opt/sm/' || t.stem || '.webp'
  from t
  join storage.objects o
    on o.bucket_id = t.bucket and o.name = 'opt/sm/' || t.stem || '.webp'
 where t.id = a.id;
