-- ============================================================
-- 20260618120000_telemetry.sql
-- Anonymous crash + opt-in usage telemetry from the desktop app
-- (StarOrga/Star-Citizen-Companion-App#21).
--
-- WHAT THIS CREATES
--   telemetry_events    — one row per received crash/usage event. No PII:
--                         identifiers arrive pre-hashed; the ingest edge
--                         function redacts free text again before insert.
--   get_telemetry_stats — SECURITY DEFINER RPC returning aggregate stats as
--                         JSON. Admin-only (checks profiles.role); the admin
--                         /admin/telemetry page is its only reader.
--
-- RLS
--   telemetry_events: RLS enabled, NO anon/authenticated policies → only the
--   service-role (ingest-telemetry edge function) can write; reads go
--   exclusively through the admin-gated SECURITY DEFINER RPC.
--
-- IDEMPOTENT: safe to re-run (if-not-exists / or-replace). ADDITIVE: drops nothing.
-- ============================================================

create table if not exists public.telemetry_events (
  id            bigint generated always as identity primary key,
  received_at   timestamptz not null default now(),
  event_type    text not null check (event_type in ('crash', 'usage')),
  app_version   text not null,
  build_id      text,
  channel       text not null default 'dev' check (channel in ('stable', 'beta', 'dev')),
  os            text,
  os_release    text,
  arch          text,
  role          text check (role in ('host', 'daemon', 'overlay', 'desktop', 'renderer')),
  -- crash fields (redacted by the ingest function)
  error_type    text,
  error_name    text,
  error_message text,
  error_stack   text,
  -- usage fields
  metric        text,
  metric_value  numeric,
  -- anonymous, pre-hashed identifiers — NEVER raw values
  session_hash  text,
  install_hash  text,
  ip_hash       text,
  detail        jsonb
);

create index if not exists telemetry_events_received_idx  on public.telemetry_events (received_at desc);
create index if not exists telemetry_events_version_idx   on public.telemetry_events (app_version);
create index if not exists telemetry_events_type_name_idx on public.telemetry_events (event_type, error_name);
create index if not exists telemetry_events_ip_window_idx on public.telemetry_events (ip_hash, received_at desc);

comment on table public.telemetry_events is
  'Anonymous desktop telemetry (crash + opt-in usage). No PII: identifiers pre-hashed, free text redacted by the ingest-telemetry edge function. Writes service-role-only; reads via get_telemetry_stats (admin RPC).';

alter table public.telemetry_events enable row level security;
-- Intentionally NO policies: anon/authenticated receive nothing. The service_role
-- (ingest edge function) bypasses RLS for inserts; reads go through the RPC below.

-- ============================================================
-- get_telemetry_stats(window_days) — admin-only aggregate read
-- ============================================================
create or replace function public.get_telemetry_stats(window_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_days   int := greatest(1, least(coalesce(window_days, 30), 365));
  v_since  timestamptz := now() - make_interval(days => v_days);
  v_result jsonb;
begin
  -- Server-side admin gate (defence in depth alongside the route's roleGuard).
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generatedAt', (extract(epoch from now()) * 1000)::bigint,
    'windowDays',  v_days,
    'totals', jsonb_build_object(
      'crashes',  (select count(*) from telemetry_events where event_type = 'crash' and received_at >= v_since),
      'usage',    (select count(*) from telemetry_events where event_type = 'usage' and received_at >= v_since),
      'installs', (select count(distinct install_hash) from telemetry_events where install_hash is not null and received_at >= v_since),
      'sessions', (select count(distinct session_hash) from telemetry_events where session_hash is not null and received_at >= v_since)
    ),
    'byVersion', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object(
          'version',  app_version,
          'crashes',  count(*) filter (where event_type = 'crash'),
          'usage',    count(*) filter (where event_type = 'usage'),
          'sessions', count(distinct session_hash)
        ) as v
        from telemetry_events where received_at >= v_since
        group by app_version order by count(*) desc limit 25
      ) t), '[]'::jsonb),
    'crashesByType', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object('name', coalesce(error_name, 'Unknown'), 'count', count(*)) as v
        from telemetry_events where event_type = 'crash' and received_at >= v_since
        group by error_name order by count(*) desc limit 25
      ) t), '[]'::jsonb),
    'crashesByRole', coalesce((
      select jsonb_agg(v) from (
        select jsonb_build_object('role', coalesce(role, 'unknown'), 'count', count(*)) as v
        from telemetry_events where event_type = 'crash' and received_at >= v_since
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
        from telemetry_events where event_type = 'crash' and received_at >= v_since
        order by received_at desc limit 50
      ) t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_telemetry_stats(int) from public;
grant execute on function public.get_telemetry_stats(int) to authenticated;

comment on function public.get_telemetry_stats(int) is
  'Admin-only aggregate telemetry stats (last N days, 1..365) as JSON. SECURITY DEFINER; raises 42501 for non-admins. Returns aggregates only — no raw PII.';
