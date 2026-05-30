-- ============================================================
-- 00009_codex_seed_tokens.sql
-- Seed-token store for the `ingest-catalog` edge function's seed path.
--
-- WHY: the catalog seed (supabase/scripts/seed-codex.mjs --via-function) runs
-- on an operator machine that should NOT hold the service-role key. The
-- ingest-catalog edge function holds the service-role secret server-side and
-- performs the writes; the local seed run authenticates to it with an opaque,
-- optionally-expiring, revocable seed token stored here. (The production ingest
-- path instead uses a collaborator JWT + desktop_releases release-token, like
-- ingest-bundle — no seed token needed there.)
--
-- RLS: enabled with NO policies, so only the service_role (which bypasses RLS,
-- inside the edge function) can read/validate tokens. No client/anon access.
-- Additive: no drops.
-- ============================================================
create table public.codex_seed_tokens (
  token text primary key,
  label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  disabled boolean not null default false
);

alter table public.codex_seed_tokens enable row level security;
-- No policies on purpose: service-role-only access from the edge function.
-- Also revoke default table grants so authenticated/anon have NO access at all
-- (defense-in-depth beyond the empty RLS policy set).
revoke all on public.codex_seed_tokens from authenticated, anon;

comment on table public.codex_seed_tokens is
  'Opaque seed tokens for the ingest-catalog seed path. Service-role read only; no client access.';
