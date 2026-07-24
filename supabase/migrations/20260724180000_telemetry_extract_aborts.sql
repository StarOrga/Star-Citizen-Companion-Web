-- ============================================================
-- 20260724180000_telemetry_extract_aborts.sql
-- Surface ABORTED P4K EXTRACTIONS as their own dimension in the admin
-- telemetry dashboard.
--
-- WHY
--   The Data Uploader now reports every extraction that ends without a result
--   (operator cancel, app quit mid-run, sidecar failure) as a signed telemetry
--   event with error_type = 'extract-aborted' and detail->>'reason' in
--   ('cancelled', 'quit', 'error'). An aborted extraction is real pain: there
--   is no resume, so the operator restarts a multi-hour P4K scan from zero.
--   Aborted *uploads* are deliberately NOT reported — the resumable upload job
--   picks those back up, so they are non-events.
--
--   Those rows ride the existing `crash` wire type (no ingest change needed),
--   which means that without this migration a deliberate operator cancel would
--   count as a "crash" and inflate the headline crash number. So the read RPC
--   now splits them out: crash aggregates EXCLUDE error_type='extract-aborted'
--   and the aborts get their own block with a per-reason breakdown.
--
-- WHAT CHANGES
--   Read path only. `get_telemetry_stats(int, text)` is replaced in place
--   (same signature — no drop, existing callers keep working):
--     + totals.extractAborts        — new count
--     + extractAborts { total, byReason[], recent[] }   — new block
--     ~ totals.crashes / byVersion.crashes / crashesByType / crashesByRole /
--       recentCrashes now exclude extract-aborted rows
--   Rollback = re-apply the previous function body from
--   20260706120000_telemetry_product.sql; no data is touched either way.
--
-- NO SCHEMA CHANGE: no new column, no data written, nothing dropped. The one
-- DDL side effect is an additive partial index for the new predicate.
-- IDEMPOTENT: safe to re-run.
-- ============================================================

-- The dashboard reads aborts as their own slice on every load; a partial index
-- keeps that off the full-table scan the generic (event_type, error_name) index
-- would force.
create index if not exists telemetry_events_extract_abort_idx
  on public.telemetry_events (received_at desc)
  where error_type = 'extract-aborted';

create or replace function public.get_telemetry_stats(
  window_days    int  default 30,
  product_filter text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text;
  v_days    int := greatest(1, least(coalesce(window_days, 30), 365));
  v_since   timestamptz := now() - make_interval(days => v_days);
  -- Normalise the filter: null/'all'/unknown → no product restriction.
  v_product text := case
                      when product_filter in ('scc-app', 'data-uploader') then product_filter
                      else null
                    end;
  v_result  jsonb;
begin
  -- Server-side admin gate (defence in depth alongside the route's roleGuard).
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- The product predicate is applied to every aggregate below. Because it is
  -- the same expression everywhere, a CTE keeps it DRY and lets the planner use
  -- the (product, received_at) index once.
  with scoped as (
    select *
    from telemetry_events
    where received_at >= v_since
      and (
        v_product is null
        or coalesce(product, 'scc-app') = v_product
      )
  ),
  -- Real crashes: an extraction abort rides the same wire type but is a
  -- reported outcome, not a fault, so it must not distort the crash numbers.
  crashes as (
    select * from scoped
    where event_type = 'crash'
      and coalesce(error_type, '') <> 'extract-aborted'
  ),
  aborts as (
    select * from scoped
    where event_type = 'crash'
      and error_type = 'extract-aborted'
  )
  select jsonb_build_object(
    'generatedAt', (extract(epoch from now()) * 1000)::bigint,
    'windowDays',  v_days,
    'product',     coalesce(v_product, 'all'),
    'totals', jsonb_build_object(
      'crashes',       (select count(*) from crashes),
      'usage',         (select count(*) from scoped where event_type = 'usage'),
      'installs',      (select count(distinct install_hash) from scoped where install_hash is not null),
      'sessions',      (select count(distinct session_hash) from scoped where session_hash is not null),
      'extractAborts', (select count(*) from aborts)
    ),
    'byVersion', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object(
          'version',  app_version,
          'crashes',  count(*) filter (
                        where event_type = 'crash'
                          and coalesce(error_type, '') <> 'extract-aborted'
                      ),
          'usage',    count(*) filter (where event_type = 'usage'),
          'sessions', count(distinct session_hash)
        ) as v
        from scoped
        group by app_version order by count(*) desc limit 25
      ) t), '[]'::jsonb),
    'crashesByType', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object('name', coalesce(error_name, 'Unknown'), 'count', count(*)) as v
        from crashes
        group by error_name order by count(*) desc limit 25
      ) t), '[]'::jsonb),
    'crashesByRole', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object('role', coalesce(role, 'unknown'), 'count', count(*)) as v
        from crashes
        group by role order by count(*) desc
      ) t), '[]'::jsonb),
    'recentCrashes', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object(
          'version', app_version,
          'role',    role,
          'name',    error_name,
          'message', left(coalesce(error_message, ''), 200),
          'at',      (extract(epoch from received_at) * 1000)::bigint
        ) as v
        from crashes
        order by received_at desc limit 50
      ) t), '[]'::jsonb),
    -- Aborted extractions — the reason lives in the client-sent detail payload
    -- (cancelled | quit | error), alongside how far the run had got.
    'extractAborts', jsonb_build_object(
      'total', (select count(*) from aborts),
      'byReason', coalesce((
        select jsonb_agg(v) from (
          select jsonb_build_object(
            'reason', coalesce(detail->>'reason', 'unknown'),
            'count',  count(*)
          ) as v
          from aborts
          group by detail->>'reason' order by count(*) desc limit 10
        ) t), '[]'::jsonb),
      'recent', coalesce((
        select jsonb_agg(v) from (
          select jsonb_build_object(
            'version', app_version,
            'reason',  coalesce(detail->>'reason', 'unknown'),
            'phase',   detail->>'phase',
            'pct',     case when jsonb_typeof(detail->'pct') = 'number'
                            then (detail->>'pct')::numeric else null end,
            'message', left(coalesce(error_message, ''), 200),
            'at',      (extract(epoch from received_at) * 1000)::bigint
          ) as v
          from aborts
          order by received_at desc limit 25
        ) t), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_telemetry_stats(int, text) from public;
grant execute on function public.get_telemetry_stats(int, text) to authenticated;

comment on function public.get_telemetry_stats(int, text) is
  'Admin-only aggregate telemetry stats (last N days, 1..365) as JSON, optionally filtered by product (scc-app | data-uploader; null/all = both, legacy NULL rows count as scc-app). Crash aggregates exclude error_type=''extract-aborted''; those are reported separately under extractAborts (total + byReason + recent). SECURITY DEFINER; raises 42501 for non-admins. Aggregates only — no raw PII.';
