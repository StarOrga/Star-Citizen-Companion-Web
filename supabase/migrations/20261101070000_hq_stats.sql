-- HQ (beta) - Statistik tiles (plan section 3 / P6, D40): one RPC for the six tiles.
--
-- hq_stats(range) aggregates the caller's hq_live_events in ONE scan (index
-- hq_live_events_user_type_idx / user_at_idx) and returns every tile with a total and a
-- sparse series; the client zero-fills the empty buckets (so empty data renders as zero
-- states, not as an error).
--
-- Event mapping (SCC-App GAMELOG_EVENT_TYPES, modules/shared/callout-catalog.js):
--   aUEC            shop.purchase  data {kind: 'buy'|'sell', price, quantity, shop, item}
--                   price is treated as the total line amount (client_price from the log);
--                   spent = buys, earned = sells, net = earned - spent.
--   missions        contract.completed (count)
--   deaths_claims   deaths = incapacitated, claims = insurance.claim_complete
--   crimestat       crime.crimestat_increased (count)
--   refinery        refinery.complete, sum of data.count (finished jobs; the log carries no
--                   yield, so the tile reads "Ausbeute" as completed work orders)
--   blueprints      blueprint.received (count)
-- If the desktop app changes a type or payload key, adjust here and in docs/contracts/hq-live.md.
--
-- p_range: '7d' (daily buckets), '30d' (default) or '90d' (weekly buckets, Monday start).
-- SECURITY INVOKER + explicit user filter: RLS already restricts to the caller; the filter
-- keeps the plan on the (user_id, ...) index.
--
-- Alpha-phase data policy: purely additive.

create or replace function public.hq_stats(p_range text default '30d')
returns jsonb
language sql
stable
set search_path = ''
as $$
  with params as (
    select case p_range when '7d' then 7 when '90d' then 90 else 30 end as days,
           case p_range when '7d' then 'day' else 'week' end as bucket_unit
  ),
  ev as materialized (
    select date_trunc((select bucket_unit from params), e.at)::date as bucket,
           e.type,
           e.data ->> 'kind' as kind,
           case when e.data ->> 'price' ~ '^-?[0-9]{1,15}(\.[0-9]+)?$' then (e.data ->> 'price')::numeric else 0 end as price,
           case when e.data ->> 'count' ~ '^[0-9]{1,6}$' then (e.data ->> 'count')::integer else 1 end as cnt
      from public.hq_live_events e
     where e.user_id = (select auth.uid())
       and e.at >= now() - make_interval(days => (select days from params))
       and e.type in ('shop.purchase', 'contract.completed', 'incapacitated', 'insurance.claim_complete',
                      'crime.crimestat_increased', 'refinery.complete', 'blueprint.received')
  ),
  per_bucket as (
    select bucket,
           coalesce(sum(price) filter (where type = 'shop.purchase' and kind = 'sell'), 0) as earned,
           coalesce(sum(price) filter (where type = 'shop.purchase' and kind is distinct from 'sell'), 0) as spent,
           count(*) filter (where type = 'contract.completed') as missions,
           count(*) filter (where type = 'incapacitated') as deaths,
           count(*) filter (where type = 'insurance.claim_complete') as claims,
           count(*) filter (where type = 'crime.crimestat_increased') as crimestat,
           coalesce(sum(cnt) filter (where type = 'refinery.complete'), 0) as refinery,
           count(*) filter (where type = 'blueprint.received') as blueprints
      from ev
     group by bucket
  )
  select jsonb_build_object(
    'range', (select case when p_range in ('7d', '90d') then p_range else '30d' end),
    'bucket', (select bucket_unit from params),
    'auec', jsonb_build_object(
      'earned', coalesce((select sum(earned) from per_bucket), 0),
      'spent',  coalesce((select sum(spent) from per_bucket), 0),
      'net',    coalesce((select sum(earned - spent) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', earned - spent) order by bucket) from per_bucket), '[]'::jsonb)),
    'missions', jsonb_build_object(
      'total',  coalesce((select sum(missions) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', missions) order by bucket) from per_bucket where missions > 0), '[]'::jsonb)),
    'deaths_claims', jsonb_build_object(
      'deaths', coalesce((select sum(deaths) from per_bucket), 0),
      'claims', coalesce((select sum(claims) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'deaths', deaths, 'claims', claims) order by bucket) from per_bucket where deaths > 0 or claims > 0), '[]'::jsonb)),
    'crimestat', jsonb_build_object(
      'total',  coalesce((select sum(crimestat) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', crimestat) order by bucket) from per_bucket where crimestat > 0), '[]'::jsonb)),
    'refinery', jsonb_build_object(
      'total',  coalesce((select sum(refinery) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', refinery) order by bucket) from per_bucket where refinery > 0), '[]'::jsonb)),
    'blueprints', jsonb_build_object(
      'total',  coalesce((select sum(blueprints) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', blueprints) order by bucket) from per_bucket where blueprints > 0), '[]'::jsonb))
  )
$$;

revoke all on function public.hq_stats(text) from public, anon;
grant execute on function public.hq_stats(text) to authenticated;

comment on function public.hq_stats(text) is
  'HQ Statistik: six tiles (auec, missions, deaths_claims, crimestat, refinery, blueprints) aggregated from the caller''s hq_live_events. '
  'p_range 7d|30d|90d; sparse series [{bucket (date), value}] - the client zero-fills. Empty data returns zeros and [] (never an error).';
