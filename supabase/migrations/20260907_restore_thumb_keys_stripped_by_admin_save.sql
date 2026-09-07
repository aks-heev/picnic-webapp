-- Restore `thumb` keys stripped by an admin save.
--
-- The venue/package admin form rebuilt each image row as exactly
-- {url, alt, name}, so saving a venue silently dropped the `thumb` key added
-- by 20260907_repoint_images_to_optimized_variants. No visible symptom: cards
-- just fell back from the 800px opt/sm variant to the 1600px opt/lg one
-- (~56KB -> ~138KB each). Hit Beige Cafe (venue 14, 7 images) on 2026-09-07.
--
-- The app.js fix (hidden .vf-img-thumburl input at the three render sites,
-- preserved in the three image serialisers) MUST ship alongside this, or the
-- next admin save re-strips what this restores.
--
-- NOTE: the hidden input is class `vf-img-thumburl`, NOT `vf-img-thumb` -
-- that name is already taken by the preview <img> in the same row, and
-- reusing it would make querySelector match the image instead of the input.
--
-- thumb is derivable: opt/lg and opt/sm share a key apart from the segment.
-- Guarded on the opt/sm object existing so a repair can never point at a 404.
--
-- Applied via MCP 2026-09-07. Verified after: active venues 80/81 with thumb
-- (the 1 without is a post-migration upload, which only produces one size),
-- packages 21/21, zero still-broken.

update venues v
   set images = sub.imgs
  from (
    select v2.id,
           jsonb_agg(
             case
               when e.val->>'url' like '%/opt/lg/%'
                and not (e.val ? 'thumb')
                and exists (
                      select 1 from storage.objects o
                       where o.bucket_id = split_part(
                               replace(e.val->>'url',
                                 'https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/',''),'/',1)
                         and 'opt/sm/' || split_part(replace(e.val->>'url',
                               'https://evmftrogyzoudiccqkya.supabase.co/storage/v1/object/public/',''),'/',4)
                             = o.name)
               then e.val || jsonb_build_object('thumb',
                      replace(e.val->>'url','/opt/lg/','/opt/sm/'))
               else e.val
             end order by e.ord) as imgs
      from venues v2, lateral jsonb_array_elements(v2.images) with ordinality e(val, ord)
     where exists (select 1 from jsonb_array_elements(v2.images) e2
                    where e2->>'url' like '%/opt/lg/%' and not (e2 ? 'thumb'))
     group by v2.id
  ) sub
 where sub.id = v.id;

update packages p
   set images = sub.imgs
  from (
    select p2.id,
           jsonb_agg(
             case
               when e.val->>'url' like '%/opt/lg/%'
                and not (e.val ? 'thumb')
               then e.val || jsonb_build_object('thumb',
                      replace(e.val->>'url','/opt/lg/','/opt/sm/'))
               else e.val
             end order by e.ord) as imgs
      from packages p2, lateral jsonb_array_elements(p2.images) with ordinality e(val, ord)
     where exists (select 1 from jsonb_array_elements(p2.images) e2
                    where e2->>'url' like '%/opt/lg/%' and not (e2 ? 'thumb'))
     group by p2.id
  ) sub
 where sub.id = p.id;
