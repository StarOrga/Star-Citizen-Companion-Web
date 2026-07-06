-- ============================================================
-- 20260706120000_telemetry_product.sql
-- Add a `product` dimension to desktop telemetry so the admin dashboard can
-- separate the two desktop clients:
--     'scc-app'       — the main Star Citizen Companion desktop app
--     'data-uploader' — the P4K extraction & upload tool
--
-- WHY
--   Both clients report crashes to the same ingest-telemetry function and
--   telemetry_events table. Until now they were indistinguishable except by the
--   coarse `role` field. The Data Uploader now reports (product='data-uploader',
--   role='desktop'); this column lets the dashboard filter per product.
--
-- LEGACY DATA
--   Rows written before this migration have product = NULL. They all originate
--   from the SCC app (the only prior reporter), so every reader treats
--   NULL as 'scc-app' via coalesce(product,'scc-app').
--
-- IDEMPOTENT: safe to re-run. ADDITIVE: drops no data.
-- ============================================================

alter table public.telemetry_events
  add column if not exists product text
    check (product is null or product in ('scc-app', 'data-uploader'));

create index if not exists telemetry_events_product_idx
  on public.telemetry_events (product, received_at desc);

comment on column public.telemetry_events.product is
  'Which desktop client sent the event: scc-app | data-uploader. NULL = legacy (pre-2026-07 SCC-app rows); readers coalesce NULL to scc-app.';

-- ============================================================
-- get_telemetry_stats(window_days, product_filter) — admin-only aggregate read
-- Adds an optional product_filter:
--   null / 'all'    → both products
--   'scc-app'       → product = 'scc-app' OR product IS NULL (legacy)
--   'data-uploader' → product = 'data-uploader'
-- ============================================================

-- Replace the single-arg version with the two-arg one (product_filter defaults
-- to null so existing one-arg callers keep working unchanged).
drop function if exists public.get_telemetry_stats(int);

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
  )
  select jsonb_build_object(
    'generatedAt', (extract(epoch from now()) * 1000)::bigint,
    'windowDays',  v_days,
    'product',     coalesce(v_product, 'all'),
    'totals', jsonb_build_object(
      'crashes',  (select count(*) from scoped where event_type = 'crash'),
      'usage',    (select count(*) from scoped where event_type = 'usage'),
      'installs', (select count(distinct install_hash) from scoped where install_hash is not null),
      'sessions', (select count(distinct session_hash) from scoped where session_hash is not null)
    ),
    'byVersion', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object(
          'version',  app_version,
          'crashes',  count(*) filter (where event_type = 'crash'),
          'usage',    count(*) filter (where event_type = 'usage'),
          'sessions', count(distinct session_hash)
        ) as v
        from scoped
        group by app_version order by count(*) desc limit 25
      ) t), '[]'::jsonb),
    'crashesByType', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object('name', coalesce(error_name, 'Unknown'), 'count', count(*)) as v
        from scoped where event_type = 'crash'
        group by error_name order by count(*) desc limit 25
      ) t), '[]'::jsonb),
    'crashesByRole', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object('role', coalesce(role, 'unknown'), 'count', count(*)) as v
        from scoped where event_type = 'crash'
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
        from scoped where event_type = 'crash'
        order by received_at desc limit 50
      ) t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_telemetry_stats(int, text) from public;
grant execute on function public.get_telemetry_stats(int, text) to authenticated;

comment on function public.get_telemetry_stats(int, text) is
  'Admin-only aggregate telemetry stats (last N days, 1..365) as JSON, optionally filtered by product (scc-app | data-uploader; null/all = both, legacy NULL rows count as scc-app). SECURITY DEFINER; raises 42501 for non-admins. Aggregates only — no raw PII.';
