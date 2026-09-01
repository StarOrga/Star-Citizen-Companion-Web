-- ============================================================
-- 20260901143000_telemetry_starscape_product.sql
-- Make Starscape (the native Windows wallpaper app) a first-class telemetry
-- product, and turn the admin read RPC from a two-product switch into a
-- multi-product overview.
--
-- WHY
--   Starscape now reports crashes + opt-in usage through the SAME signed
--   ingest-telemetry path as the SCC app and the Data Uploader
--   (product='starscape', role='desktop'). Two things blocked that:
--     1. `telemetry_events.product` had a CHECK that only allowed
--        ('scc-app','data-uploader') — a Starscape row would be REJECTED.
--     2. `telemetry_events.channel` only allowed ('stable','beta','dev'), but
--        Starscape's release rings are stable | beta | ALPHA. Without 'alpha'
--        the ingest function silently downgrades every alpha install to 'dev'
--        and the ring signal is lost.
--   The admin dashboard also asked the wrong question ("which ONE product?").
--   It now gets a per-product roll-up in every response so the page can show
--   all products side by side and drill into one.
--
-- WHAT CHANGES
--   ~ CHECK on product  -> adds 'starscape'  (strictly WIDER, rejects nothing
--                                             that was accepted before)
--   ~ CHECK on channel  -> adds 'alpha'      (likewise strictly wider)
--   ~ get_telemetry_stats(int, text) replaced in place (same signature):
--       + products[]      - per-product roll-up over the whole window,
--                           INDEPENDENT of product_filter, so the overview is
--                           always available. Scales to N products: it groups
--                           by whatever is in the column, no hardcoded list.
--       + usageByMetric[] - what the opt-in usage events actually are
--       + byChannel[]     - release-ring split (stable/beta/alpha/dev)
--       + recentCrashes[].product - so the "all products" view is readable
--       ~ product_filter accepts ANY product id now (previously a hardcoded
--         allow-list silently fell back to "no filter" for anything else,
--         which would have made 'starscape' look like 'all').
--
-- NON-DESTRUCTIVE: no drop of a table/column, no rename, no row touched. The
-- two CHECK constraints are replaced by strictly wider ones - every row that
-- validated before still validates. Rollback = re-apply the narrower CHECKs
-- plus the function body from 20260724180000_telemetry_extract_aborts.sql.
-- IDEMPOTENT: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Widen the `product` CHECK: + 'starscape'
--
-- The constraint was created inline by `add column ... check (...)`, so its
-- name is auto-generated. Dropping it by a guessed name would leave the old,
-- narrow constraint in place on any deployment where the name differs - and a
-- Starscape insert would keep failing while this migration reported success.
-- So it is located by its DEFINITION (the only CHECK on this table that
-- mentions 'data-uploader') and re-added under a stable, explicit name.
-- ------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class     rel on rel.oid = con.conrelid
    join pg_namespace ns  on ns.oid  = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'telemetry_events'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%data-uploader%'
  loop
    execute format('alter table public.telemetry_events drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.telemetry_events
  add constraint telemetry_events_product_check
  check (
    product is null
    or product in ('scc-app', 'data-uploader', 'starscape')
  );

comment on column public.telemetry_events.product is
  'Which client sent the event: scc-app | data-uploader | starscape. NULL = legacy (pre-2026-07 SCC-app rows); readers coalesce NULL to scc-app.';

-- ------------------------------------------------------------
-- 2. Widen the `channel` CHECK: + 'alpha'
--
-- Same locate-by-definition approach. The channel CHECK is the only one on
-- this table whose definition mentions the column name `channel`.
-- ------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class     rel on rel.oid = con.conrelid
    join pg_namespace ns  on ns.oid  = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'telemetry_events'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%channel%'
  loop
    execute format('alter table public.telemetry_events drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.telemetry_events
  add constraint telemetry_events_channel_check
  check (channel in ('stable', 'beta', 'alpha', 'dev'));

comment on column public.telemetry_events.channel is
  'Release ring the reporting build came from: stable | beta | alpha | dev. alpha is Starscape''s lowest ring; dev is an unsigned local build (also the fallback the ingest function uses for an unknown value).';

-- ------------------------------------------------------------
-- 3. Read RPC - same signature, replaced in place.
-- ------------------------------------------------------------
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
  -- coalesced) product column. Deliberately NOT an allow-list any more: a new
  -- product must not need an RPC change to become filterable, and an unknown id
  -- must return "nothing" rather than silently widening to every product.
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
                               and coalesce(error_type, '') <> 'extract-aborted'
                           ),
          'usage',         count(*) filter (where event_type = 'usage'),
          'extractAborts', count(*) filter (where error_type = 'extract-aborted'),
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
                          and coalesce(error_type, '') <> 'extract-aborted'
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
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_telemetry_stats(int, text) from public;
grant execute on function public.get_telemetry_stats(int, text) to authenticated;

comment on function public.get_telemetry_stats(int, text) is
  'Admin-only aggregate telemetry stats (last N days, 1..365) as JSON. Always returns a per-product roll-up in `products` (independent of the filter); `product_filter` additionally scopes every other block to one product id (null/''all'' = no restriction, legacy NULL rows count as scc-app). Crash aggregates exclude error_type=''extract-aborted''; those are reported separately under extractAborts. SECURITY DEFINER; raises 42501 for non-admins. Aggregates only - no raw PII.';
