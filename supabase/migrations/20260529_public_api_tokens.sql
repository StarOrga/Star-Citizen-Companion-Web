-- 20260529 · Public REST API foundation
-- Concept: docs/concepts/2026-05-28-public-api-token-mgmt.html
--
-- Tables introduced by this migration:
--   - public.api_tokens         Bearer-token store (sha256 hash, scopes, soft-delete)
--   - public.api_request_log    Per-request log used by the sliding-window rate limiter
--   - public.patch_versions     Cached LIVE/PTU/EPTU patch versions (single source of truth)
--   - public.news_cache         Aggregated news rows for sub-50ms /v1/news response
--
-- Helper:
--   - public.is_admin(uid uuid) New overload that accepts an explicit uid (the existing
--                               no-arg variant from migration 00003 stays untouched —
--                               we add an OVERLOAD because Edge-Function code can't
--                               rely on auth.uid() inside SQL it builds dynamically).
--
-- Alpha-phase notes:
--   - No legacy table is dropped. `news_cache` is new (the prior fetch-verse-news
--     edge function aggregated in-memory and never persisted).
--   - `api_request_log` is intentionally NOT partitioned in this first migration;
--     it can be retro-partitioned by day once volume justifies it (see comment below).

-- ============================================================
-- public.is_admin(uid uuid) — OVERLOAD of the existing no-arg helper
-- ============================================================
-- Migration 00003 introduced is_admin() reading auth.uid(). Edge Functions running
-- as service-role often need to ask "is THIS uid an admin" without rebinding the
-- JWT, so we add a uid-taking overload that wraps the same profiles.role check.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = uid),
    false
  );
$$;

grant execute on function public.is_admin(uuid) to authenticated, anon, service_role;


-- ============================================================
-- public.api_tokens
-- ============================================================
create table if not exists public.api_tokens (
  id            uuid        primary key default gen_random_uuid(),
  owner_user_id uuid        not null references auth.users(id) on delete cascade,
  name          text        not null,
  prefix        text        not null,           -- e.g. "scc_live_8aF3kP9q"
  token_hash    text        not null unique,    -- sha256(plaintext) hex
  scopes        text[]      not null default '{}',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  constraint api_tokens_name_per_user unique (owner_user_id, name)
);

-- Fast lookup path for the auth middleware: hash + active-only
create index if not exists api_tokens_token_hash_active_idx
  on public.api_tokens (token_hash) where revoked_at is null;

create index if not exists api_tokens_owner_active_idx
  on public.api_tokens (owner_user_id, created_at desc) where revoked_at is null;

alter table public.api_tokens enable row level security;

-- Admins manage ONLY their own tokens. Service-role (used by the edge function
-- for the bearer-auth path) bypasses RLS, which is fine — that code path validates
-- token_hash directly without needing auth.uid().
drop policy if exists "admins manage own tokens" on public.api_tokens;
create policy "admins manage own tokens" on public.api_tokens
  for all to authenticated
  using (owner_user_id = auth.uid() and public.is_admin(auth.uid()))
  with check (owner_user_id = auth.uid() and public.is_admin(auth.uid()));

comment on table public.api_tokens is
  'Bearer-token store for the public /v1 API. Plaintext is shown ONCE on POST and never persisted.';


-- ============================================================
-- public.api_request_log — sliding-window rate-limit counter
-- ============================================================
create table if not exists public.api_request_log (
  token_hash text        not null,
  ts         timestamptz not null default now(),
  endpoint   text        not null,
  status     int         not null
);

create index if not exists api_request_log_token_ts_idx
  on public.api_request_log (token_hash, ts desc);

-- Future-proofing: partition by day when row count exceeds ~10M.
-- For now (alpha, expected <100 req/min) a single table + autopurge cron is fine.
-- See concept §3 for migration plan to declarative partitioning.
comment on table public.api_request_log is
  'Per-request log for the sliding-window rate limiter. Partition by day once volume grows.';

-- RLS off — rows are only written/read by service-role from the edge function.
alter table public.api_request_log enable row level security;
-- (no policies → only service-role can touch it)


-- ============================================================
-- public.patch_versions — current LIVE/PTU/EPTU build numbers
-- ============================================================
create table if not exists public.patch_versions (
  channel     text        primary key,
  version     text        not null,
  detected_at timestamptz not null default now(),
  constraint patch_versions_channel_check check (channel in ('live','ptu','eptu'))
);

alter table public.patch_versions enable row level security;

-- Publicly readable (the /v1/patch endpoint returns this verbatim). Writes only
-- from service-role (the future patch-detector cron job).
drop policy if exists "patch_versions_public_read" on public.patch_versions;
create policy "patch_versions_public_read" on public.patch_versions
  for select using (true);

comment on table public.patch_versions is
  'Latest detected patch_version per channel. Updated by the patch-detector cron (see roadmap).';


-- ============================================================
-- public.news_cache — pre-aggregated news rows for /v1/news
-- ============================================================
-- Note: the existing `fetch-verse-news` edge function returned data in-memory
-- without persisting. This table is NEW (no ALTER). The future news-refresh
-- cron will populate it on a 10-minute cadence.
create table if not exists public.news_cache (
  source       text        not null,
  external_id  text        not null,
  title        text        not null,
  url          text        not null,
  thumbnail    text,
  published_at timestamptz not null,
  fetched_at   timestamptz not null default now(),
  primary key (source, external_id)
);

create index if not exists news_cache_published_idx
  on public.news_cache (published_at desc);

create index if not exists news_cache_source_published_idx
  on public.news_cache (source, published_at desc);

alter table public.news_cache enable row level security;

drop policy if exists "news_cache_public_read" on public.news_cache;
create policy "news_cache_public_read" on public.news_cache
  for select using (true);

comment on table public.news_cache is
  'Pre-aggregated Comm-Link/Spectrum/YouTube/Patch rows. Refreshed by pg_cron (see roadmap).';
