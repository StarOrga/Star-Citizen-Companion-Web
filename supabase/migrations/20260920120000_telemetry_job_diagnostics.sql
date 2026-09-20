-- ============================================================
-- 20260920120000_telemetry_job_diagnostics.sql
-- Surface the WARNINGS + ERRORS a Data Uploader run wrote into its log
-- stream as their own dimension in the admin telemetry dashboard.
--
-- WHY
--   The uploader's run view prints every [warn] / [err] line the Python
--   sidecar emits, and the operator reads them — but the dashboard never saw
--   them: a crash reported, an abort reported, a run that FINISHED with a
--   dozen warnings about unreadable records reported nothing. The uploader
--   now sends one event per finished job (extract / skin export) that logged
--   at least one warning or error, with
--     error_type    = 'job-diagnostics'
--     error_name    = 'JobDiagnostics'
--     error_message = "<kind> finished (<outcome>) with N warning(s), M error(s)"
--     error_stack   = the [warn]/[err] transcript (relative mm:ss offsets)
--     detail        = { kind, jobId, outcome, warnings, errors, dropped,
--                       phase, pct, elapsedMs, channel, patchVersion }
--   (see data-uploader/src/lib/job-diagnostics.ts).
--
--   Those rows ride the existing `crash` wire type (no ingest change), which
--   means that without this migration a run that merely WARNED would count
--   as a crash and inflate the headline number. So the read RPC now splits
--   them out — the same treatment `extract-aborted` already gets — and hands
--   the admin page a `diagnostics` block WITH the transcript, so a row can be
--   turned into a feedback topic with the log attached.
--
-- WHAT CHANGES
--   Read path only. `get_telemetry_stats(int, text)` is replaced in place
--   (same signature — no drop, existing callers keep working):
--     + totals.diagnostics          — new count
--     + diagnostics { total, byOutcome[], recent[] }   — new block
--     ~ every crash aggregate (totals.crashes, products[].crashes,
--       byVersion.crashes, byChannel.crashes, crashesByType, crashesByRole,
--       recentCrashes) now excludes error_type = 'job-diagnostics' as well
--   Rollback = re-apply the function body from
--   20260901143000_telemetry_starscape_product.sql; no data is touched.
--
-- NO SCHEMA CHANGE: no new column, no data written, nothing dropped. The one
-- DDL side effect is an additive partial index for the new predicate.
-- IDEMPOTENT: safe to re-run.
-- ============================================================

-- The dashboard reads the diagnostics slice on every load; a partial index
-- keeps that off the generic (event_type, error_name) index's full scan.
create index if not exists telemetry_events_job_diag_idx
  on public.telemetry_events (received_at desc)
  where error_type = 'job-diagnostics';

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
  -- Normalise the filter. Anything blank or the literal 'all' means "no product
  -- restriction"; ANY other value is matched verbatim against the (legacy-
  -- coalesced) product column. Deliberately NOT an allow-list: a new product
  -- must not need an RPC change to become filterable, and an unknown id must
  -- return "nothing" rather than silently widening to every product.
  v_product text := nullif(lower(btrim(coalesce(product_filter, ''))), '');
  v_result  jsonb;
begin
  if v_product = 'all' then
    v_product := null;
  end if;

  -- Server-side admin gate (defence in depth alongside the route's roleGuard).
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- `scoped` is the drill-down (one product, or all). `products` below reads
  -- the unscoped window on purpose: the overview must keep listing every
  -- product even while the admin is drilled into one of them.
  with scoped as (
    select *
    from telemetry_events
    where received_at >= v_since
      and (
        v_product is null
        or coalesce(product, 'scc-app') = v_product
      )
  ),
  -- Real crashes: an extraction abort and a log-diagnostics row ride the same
  -- wire type but are reported OUTCOMES, not faults, so neither may distort
  -- the crash numbers.
  crashes as (
    select * from scoped
    where event_type = 'crash'
      and coalesce(error_type, '') not in ('extract-aborted', 'job-diagnostics')
  ),
  aborts as (
    select * from scoped
    where event_type = 'crash'
      and error_type = 'extract-aborted'
  ),
  diags as (
    select * from scoped
    where event_type = 'crash'
      and error_type = 'job-diagnostics'
  )
  select jsonb_build_object(
    'generatedAt', (extract(epoch from now()) * 1000)::bigint,
    'windowDays',  v_days,
    'product',     coalesce(v_product, 'all'),
    -- Per-product roll-up - the dashboard's overview. One row per product that
    -- actually reported in the window; the client fills in the known-but-silent
    -- ones so a product with zero events is still visible as a zero.
    'products', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object(
          'product',       coalesce(product, 'scc-app'),
          'events',        count(*),
          'crashes',       count(*) filter (
                             where event_type = 'crash'
                               and coalesce(error_type, '') not in ('extract-aborted', 'job-diagnostics')
                           ),
          'usage',         count(*) filter (where event_type = 'usage'),
          'extractAborts', count(*) filter (where error_type = 'extract-aborted'),
          'diagnostics',   count(*) filter (where error_type = 'job-diagnostics'),
          'installs',      count(distinct install_hash),
          'sessions',      count(distinct session_hash),
          'versions',      count(distinct app_version),
          'lastSeen',      (extract(epoch from max(received_at)) * 1000)::bigint
        ) as v
        from telemetry_events
        where received_at >= v_since
        group by coalesce(product, 'scc-app')
        order by count(*) desc
      ) t), '[]'::jsonb),
    'totals', jsonb_build_object(
      'crashes',       (select count(*) from crashes),
      'usage',         (select count(*) from scoped where event_type = 'usage'),
      'installs',      (select count(distinct install_hash) from scoped where install_hash is not null),
      'sessions',      (select count(distinct session_hash) from scoped where session_hash is not null),
      'extractAborts', (select count(*) from aborts),
      'diagnostics',   (select count(*) from diags)
    ),
    'byVersion', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object(
          'version',  app_version,
          'crashes',  count(*) filter (
                        where event_type = 'crash'
                          and coalesce(error_type, '') not in ('extract-aborted', 'job-diagnostics')
                      ),
          'usage',    count(*) filter (where event_type = 'usage'),
          'sessions', count(distinct session_hash)
        ) as v
        from scoped
        group by app_version order by count(*) desc limit 25
      ) t), '[]'::jsonb),
    -- Release-ring split. Starscape ships stable/beta/ALPHA rings, so "which
    -- ring is this pain coming from" is a real question for the first time.
    'byChannel', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object(
          'channel',  channel,
          'events',   count(*),
          'sessions', count(distinct session_hash),
          'crashes',  count(*) filter (
                        where event_type = 'crash'
                          and coalesce(error_type, '') not in ('extract-aborted', 'job-diagnostics')
                      )
        ) as v
        from scoped
        group by channel order by count(*) desc
      ) t), '[]'::jsonb),
    -- What the opt-in usage events actually ARE. Without this the dashboard
    -- shows a bare "usage events" count that answers nothing.
    'usageByMetric', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object(
          'metric',   coalesce(metric, 'unknown'),
          'count',    count(*),
          'sessions', count(distinct session_hash)
        ) as v
        from scoped where event_type = 'usage'
        group by metric order by count(*) desc limit 25
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
          -- Carried so the cross-product view can say WHICH product crashed.
          'product', coalesce(product, 'scc-app'),
          'role',    role,
          'name',    error_name,
          'message', left(coalesce(error_message, ''), 200),
          'at',      (extract(epoch from received_at) * 1000)::bigint
        ) as v
        from crashes
        order by received_at desc limit 50
      ) t), '[]'::jsonb),
    -- Aborted extractions - the reason lives in the client-sent detail payload
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
    ),
    -- Log diagnostics — runs that finished (or not) with warnings/errors in
    -- their log stream. `lines` is the full transcript the client sent (the
    -- ingest function clamps it at 8000 chars), carried in full so the admin
    -- page can attach it to a feedback topic without a second round trip.
    'diagnostics', jsonb_build_object(
      'total', (select count(*) from diags),
      'byOutcome', coalesce((
        select jsonb_agg(v) from (
          select jsonb_build_object(
            'outcome', coalesce(detail->>'outcome', 'unknown'),
            'count',   count(*)
          ) as v
          from diags
          group by detail->>'outcome' order by count(*) desc limit 10
        ) t), '[]'::jsonb),
      'recent', coalesce((
        select jsonb_agg(v) from (
          select jsonb_build_object(
            'id',           id,
            'at',           (extract(epoch from received_at) * 1000)::bigint,
            'product',      coalesce(product, 'scc-app'),
            'version',      app_version,
            'channel',      channel,
            'os',           os,
            'kind',         coalesce(detail->>'kind', 'unknown'),
            'outcome',      coalesce(detail->>'outcome', 'unknown'),
            'warnings',     case when jsonb_typeof(detail->'warnings') = 'number'
                                 then (detail->>'warnings')::int else 0 end,
            'errors',       case when jsonb_typeof(detail->'errors') = 'number'
                                 then (detail->>'errors')::int else 0 end,
            'dropped',      case when jsonb_typeof(detail->'dropped') = 'number'
                                 then (detail->>'dropped')::int else 0 end,
            'phase',        detail->>'phase',
            'pct',          case when jsonb_typeof(detail->'pct') = 'number'
                                 then (detail->>'pct')::numeric else null end,
            'elapsedMs',    case when jsonb_typeof(detail->'elapsedMs') = 'number'
                                 then (detail->>'elapsedMs')::bigint else null end,
            'gameChannel',  detail->>'channel',
            'patchVersion', detail->>'patchVersion',
            'message',      left(coalesce(error_message, ''), 200),
            'lines',        coalesce(error_stack, '')
          ) as v
          from diags
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
  'Admin-only aggregate telemetry stats (last N days, 1..365) as JSON. Always returns a per-product roll-up in `products` (independent of the filter); `product_filter` additionally scopes every other block to one product id (null/''all'' = no restriction, legacy NULL rows count as scc-app). Crash aggregates exclude error_type IN (''extract-aborted'', ''job-diagnostics''); those are reported separately under extractAborts and diagnostics (the latter with the log transcript). SECURITY DEFINER; raises 42501 for non-admins. Aggregates only - no raw PII.';
