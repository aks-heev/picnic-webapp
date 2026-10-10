-- Stay-only launch for TerraCottage Ochre (16) + Boho (28), 2026-10-10. Data only. APPLIED live 2026-10-10.
-- Values decided by Aksheev 2026-10-10: stay-only ₹2,500/night both units, all setups offered,
-- no direct-booking perks, short unit codes. Setup prices derived by Claude:
--
-- Setup pricing rule: Celebration Stay with The Setting for 1 night = ₹9,800 = the old bundle price,
-- so 7,300 + 2,500. Other tiers use the same price gaps as the Beige Cafe packages
-- (Prelude -3,000; Moment +4,000). Movie Night = Setting + the Movie Screening add-on (4,500).
-- The Story / Date Night / Movie Night Deluxe are NOT offered: they need skyshots, cold pyros,
-- bonfire or barbeque, none of which TerraCottage offers (venue_add_ons).
--
-- Verified after apply via compute_booking_total: Ochre/Boho 1 night = 2,500; 1 night + Setting = 9,800;
-- 3 nights + Moment = 18,800. Umber (15) and Sienna (17) untouched.
--
-- ROLLBACK:
--   delete from venue_add_ons where addon_id in (select id from add_ons where category='setup');
--   delete from add_ons where category='setup' and id not in (select addon_id from booking_add_ons);
--   update venues set base_price = 9800, metadata = metadata - 'stay_only' - 'unit_code' where id in (16, 28);
do $$
declare v_ids int[];
begin
  if exists (select 1 from add_ons where category = 'setup') then
    raise exception 'setup add-ons already exist; aborting to avoid duplicates';
  end if;
  if (select count(*) from venues where id in (16,28) and name in ('TerraCottage Ochre','TerraCottage Boho') and base_price = 9800) <> 2 then
    raise exception 'venue 16/28 not in expected state';
  end if;

  with ins as (
    insert into add_ons (name, description, price, category, is_active, sort_order, requires_confirmation)
    values
      ('The Prelude', 'A smaller setup: macramé tent, fairy lights, lamps and floor seating.', 4300, 'setup', true, 100, false),
      ('The Setting', 'The signature setup: macramé tent, fresh flowers and fruits, wax and electric candles, speaker and a message board.', 7300, 'setup', true, 101, false),
      ('The Moment', 'The Setting, plus a bouquet, a cake and 10 printed photos.', 11300, 'setup', true, 102, false),
      ('Movie Night', 'The Setting, plus a projector movie screening in the room.', 11800, 'setup', true, 103, false)
    returning id
  )
  select array_agg(id) into v_ids from ins;

  insert into venue_add_ons (venue_id, addon_id)
  select v, a from unnest(array[16, 28]) v cross join unnest(v_ids) a;

  update venues set base_price = 2500,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('stay_only', true, 'unit_code', 'TC-OCHRE')
  where id = 16;
  update venues set base_price = 2500,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('stay_only', true, 'unit_code', 'TC-BOHO')
  where id = 28;
end $$;
