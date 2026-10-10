-- Stay-only for TerraCottage Umber (15), 2026-10-10. APPLIED live 2026-10-10. Price 4,000/night decided by Aksheev.
-- Same 4 setup add-ons as Ochre/Boho (shared rows, shared prices). Note: Umber's old bundle was 10,900,
-- so 1 night + The Setting is now 11,300 (+400 vs the old bundle).
-- ROLLBACK:
--   delete from venue_add_ons where venue_id = 15 and addon_id in (select id from add_ons where category='setup');
--   update venues set base_price = 10900, metadata = metadata - 'stay_only' - 'unit_code' where id = 15;
do $$
begin
  if (select count(*) from venues where id = 15 and name = 'TerraCottage Umber' and base_price = 10900) <> 1 then
    raise exception 'venue 15 not in expected state';
  end if;
  if (select count(*) from add_ons where category = 'setup' and is_active) <> 4 then
    raise exception 'expected 4 active setup add-ons';
  end if;
  insert into venue_add_ons (venue_id, addon_id)
  select 15, id from add_ons where category = 'setup' and is_active
  on conflict do nothing;
  update venues set base_price = 4000,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('stay_only', true, 'unit_code', 'TC-UMBER')
  where id = 15;
end $$;
