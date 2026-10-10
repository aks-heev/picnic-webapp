-- 2026-10-10 — Per-unit rent/spend segregation for the TerraCottage stays.
--
-- Why: every Airbnb spend row was "Airbnb / Gurugram" with no unit, and the 4th-floor
-- lease (₹1,00,000/month) covers BOTH Umber (15) and Ochre (16). TerraCottage Boho (28,
-- added 2026-10-10) has its own ₹32,000 lease and its own electricity meter.
--
-- Design (approved by Aksheev 2026-10-10):
--   * A spend is recorded against what the BILL covers (expenses.property), never pre-split.
--   * cost_allocation maps a property/cost centre to units. Changing a split = editing rows
--     here; no history is rewritten.
--       Umber / Ochre / Boho      -> 100% to that unit
--       4th Floor                 -> Umber 68% / Ochre 32%  (Boho, same layout as Ochre,
--                                    leases standalone for ₹32k = market anchor for Ochre)
--       All TerraCottage          -> split by nights sold that month (basis='nights')
--   * Categories 'Deposit' (refundable, an asset) and 'Setup' (one-time) are kept OUT of
--     operating profit and reported in their own columns.
--   * Revenue comes ONLY from booking_revenue_split (the single revenue definition),
--     spread across the nights actually stayed. Sienna (17, combo of 15+16) revenue is
--     split by the '4th Floor' shares.
--   * Airbnb payouts are already net of Airbnb's fee — no fee expense line exists or
--     should be added.
--   * An Airbnb-business spend whose property is blank/unknown surfaces as unit
--     'Unassigned', never dropped.

alter table public.expenses add column if not exists property text;
comment on column public.expenses.property is
  'What the bill covers: Umber | Ochre | Boho | 4th Floor | All TerraCottage. Mirrored from the sheet Expenses tab Property column. Split to units by cost_allocation.';

create table if not exists public.cost_allocation (
  cost_centre text   not null,
  venue_id    bigint not null references public.venues(id),
  basis       text   not null default 'fixed' check (basis in ('fixed','nights')),
  share       numeric check (share is null or (share > 0 and share <= 1)),
  notes       text,
  primary key (cost_centre, venue_id),
  check ((basis = 'fixed') = (share is not null))
);
comment on table public.cost_allocation is
  'How a spend recorded against a property/cost centre is split across stay units. fixed = share; nights = by nights sold that month.';

alter table public.cost_allocation enable row level security;
revoke all on public.cost_allocation from anon;
create policy admin_all_cost_allocation on public.cost_allocation for all to authenticated
  using (auth.email() = 'aksh.eeev@gmail.com') with check (auth.email() = 'aksh.eeev@gmail.com');

insert into public.cost_allocation (cost_centre, venue_id, basis, share, notes) values
  ('Umber', 15, 'fixed', 1, null),
  ('Ochre', 16, 'fixed', 1, null),
  ('Boho',  28, 'fixed', 1, null),
  ('4th Floor', 15, 'fixed', 0.68, 'Umber = ₹1L lease − ₹32k Ochre-equivalent (Boho lease anchor)'),
  ('4th Floor', 16, 'fixed', 0.32, 'Ochre = ₹32k of ₹1L (same layout as Boho at ₹32k)'),
  ('All TerraCottage', 15, 'nights', null, null),
  ('All TerraCottage', 16, 'nights', null, null),
  ('All TerraCottage', 28, 'nights', null, null)
on conflict do nothing;

create or replace view public.unit_pnl_monthly with (security_invoker = true) as
with units as (
  select distinct ca.venue_id, v.name as unit
  from public.cost_allocation ca join public.venues v on v.id = ca.venue_id
),
-- revenue per booking, from the canonical view, spread evenly over its nights
bk as (
  select b.id, brs.venue_id, b.preferred_date, b.checkout_date,
         coalesce(brs.stay_revenue,0) + coalesce(brs.picnic_revenue,0) as revenue
  from public.booking_revenue_split brs
  join public.bookings b on b.id = brs.id
  where brs.confirmed and brs.excluded_reason is null
    and b.checkout_date is not null and b.checkout_date > b.preferred_date
    and coalesce(b.booking_status,'') <> 'Cancelled'
),
nights as (
  select bk.venue_id, d::date as night, bk.revenue / (bk.checkout_date - bk.preferred_date) as rev
  from bk, generate_series(bk.preferred_date, bk.checkout_date - 1, interval '1 day') d
),
-- push combo (Sienna) nights onto its children by the 4th Floor shares
unit_nights as (
  select n.venue_id, n.night, n.rev, 1::numeric as night_weight
  from nights n join units u on u.venue_id = n.venue_id
  union all
  select ca.venue_id, n.night, n.rev * ca.share, ca.share
  from nights n
  join public.venues v on v.id = n.venue_id and v.type = 'combo'
  join public.cost_allocation ca on ca.cost_centre = '4th Floor' and ca.venue_id in (select id from public.venues where parent_venue_id = v.id)
),
rev as (
  select venue_id, date_trunc('month', night)::date as month,
         sum(rev) as revenue, sum(night_weight) as nights_sold
  from unit_nights group by 1, 2
),
exp as (
  select e.*, date_trunc('month', e.spend_date)::date as month,
         case when e.category in ('Deposit','Setup') then e.category else 'Operating' end as bucket
  from public.expenses e
  where e.business = 'Airbnb'
),
-- fixed-share allocation
alloc_fixed as (
  -- direct = the bill covers exactly one unit
  select x.month, ca.venue_id, x.bucket, x.amount * ca.share as amt,
         (select count(*) from public.cost_allocation c2 where c2.cost_centre = ca.cost_centre) = 1 as direct
  from exp x
  join public.cost_allocation ca on ca.cost_centre = x.property and ca.basis = 'fixed'
),
-- nights-based allocation (equal split when no unit sold a night that month)
alloc_nights as (
  select x.month, ca.venue_id, x.bucket,
         x.amount * case when coalesce(t.tot,0) > 0 then coalesce(r.nights_sold,0) / t.tot
                         else 1.0 / count(*) over (partition by x.id) end as amt,
         false as direct
  from exp x
  join public.cost_allocation ca on ca.cost_centre = x.property and ca.basis = 'nights'
  left join rev r on r.venue_id = ca.venue_id and r.month = x.month
  left join lateral (
    select sum(r2.nights_sold) as tot from rev r2
    where r2.month = x.month
      and r2.venue_id in (select venue_id from public.cost_allocation where cost_centre = x.property)
  ) t on true
),
alloc as (select * from alloc_fixed union all select * from alloc_nights),
unassigned as (
  select x.month, x.bucket, x.amount from exp x
  where not exists (select 1 from public.cost_allocation ca where ca.cost_centre = x.property)
),
months as (
  select month from rev union select month from exp
),
grid as (
  select m.month, u.venue_id, u.unit from months m cross join units u
)
select g.month, g.unit, g.venue_id,
       round(coalesce(r.revenue,0), 2)                                                        as revenue,
       coalesce(r.nights_sold,0)                                                              as nights_sold,
       round(coalesce(sum(a.amt) filter (where a.bucket='Operating' and a.direct),0), 2)      as direct_costs,
       round(coalesce(sum(a.amt) filter (where a.bucket='Operating' and not a.direct),0), 2)  as shared_costs,
       round(coalesce(r.revenue,0) - coalesce(sum(a.amt) filter (where a.bucket='Operating'),0), 2) as operating_profit,
       round(coalesce(sum(a.amt) filter (where a.bucket='Setup'),0), 2)                       as setup_costs,
       round(coalesce(sum(a.amt) filter (where a.bucket='Deposit'),0), 2)                     as deposits
from grid g
left join rev r on r.venue_id = g.venue_id and r.month = g.month
left join alloc a on a.venue_id = g.venue_id and a.month = g.month
group by g.month, g.unit, g.venue_id, r.revenue, r.nights_sold
union all
select u.month, 'Unassigned', null, 0, 0, 0, 0,
       -round(coalesce(sum(u.amount) filter (where u.bucket='Operating'),0),2),
       round(coalesce(sum(u.amount) filter (where u.bucket='Setup'),0),2),
       round(coalesce(sum(u.amount) filter (where u.bucket='Deposit'),0),2)
from unassigned u group by u.month;

comment on view public.unit_pnl_monthly is
  'Per-unit monthly P&L for TerraCottage stays. Revenue from booking_revenue_split spread by night; spends from expenses split via cost_allocation. Deposit/Setup kept out of operating_profit. Unassigned row = Airbnb spends with no valid property.';

revoke all on public.unit_pnl_monthly from anon;
