-- "Your Own Space" (custom) venues 26 (NCR) and 5 (Jaipur) had zero venue_add_ons rows,
-- so the admin Add/Edit Booking form never rendered an add-on picker for them.
-- Mirror Beige Cafe's (14) active non-setup add-ons. Idempotent.
insert into public.venue_add_ons (venue_id, addon_id)
select v.id, va.addon_id
from (values (26::bigint), (5::bigint)) v(id)
cross join public.venue_add_ons va
join public.add_ons a on a.id = va.addon_id and a.is_active and a.category <> 'setup'
where va.venue_id = 14
  and not exists (select 1 from public.venue_add_ons x where x.venue_id = v.id and x.addon_id = va.addon_id);
