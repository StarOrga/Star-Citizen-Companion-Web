-- Patch-content cache for the `rsi-roadmap` edge function (feedback 961ab0a5).
--
-- The patch board needs two things RSI publishes but the news feed never
-- carried:
--
--   1. the ROADMAP Release View — what is planned for the current and the next
--      patch (https://robertsspaceindustries.com/api/roadmap/v1/boards/1),
--   2. the OUTLINE of an individual patch note — the bullet points RSI writes
--      into its Spectrum thread, which the feed only ever knew by title.
--
-- Both are slow-ish upstream calls (the board is ~800 KB of JSON, one Spectrum
-- thread is ~180 KB and takes about a second), and both are the same for every
-- visitor. This table is the shared, durable buffer in front of them: the edge
-- function serves from here whenever the row is fresh enough and only then
-- talks to RSI. The CDN cache above it is not enough on its own — it is
-- per-region and expires, and a cold miss on the board would otherwise cost the
-- visitor the full upstream round trip.
--
-- ONE table for both because they are the same kind of thing (a public, cached
-- upstream JSON document with a fetch timestamp) and the row count stays in the
-- low hundreds. `cache_key` carries the namespace:
--
--   'board:1'      → the parsed roadmap payload (see functions/rsi-roadmap/roadmap.ts)
--   'note:<slug>'  → one patch note's outline (see functions/rsi-roadmap/patch-outline.ts)
--
-- Stored PARSED, not raw: the trimmed payload is a fraction of the upstream
-- document, and re-parsing per request would defeat the point of caching.
-- `fetched_at` is the freshness handle; TTLs live in the edge function so they
-- can be tuned without a migration.
--
-- Public data (RSI publishes all of it openly), so anon may read. Writes are
-- service-role only.

create table if not exists public.rsi_patch_cache (
  cache_key  text primary key,
  payload    jsonb not null,
  fetched_at timestamptz not null default now()
);

comment on table public.rsi_patch_cache is
  'Cached, already-parsed RSI patch content for the rsi-roadmap edge function. '
  'cache_key namespaces: "board:<id>" = roadmap Release View payload, '
  '"note:<slug>" = one patch note outline. Written by the service role only.';

comment on column public.rsi_patch_cache.fetched_at is
  'When the upstream document behind this row was last fetched. The edge '
  'function compares it against its own TTL; a stale row is still served if the '
  'refetch fails, so RSI being down degrades to old data, not to no data.';

create index if not exists rsi_patch_cache_fetched_idx
  on public.rsi_patch_cache (fetched_at desc);

alter table public.rsi_patch_cache enable row level security;

drop policy if exists rsi_patch_cache_public_read on public.rsi_patch_cache;
create policy rsi_patch_cache_public_read on public.rsi_patch_cache
  for select to anon, authenticated using (true);

-- Writes are service-role only (no client write policy + explicit revoke).
revoke insert, update, delete, truncate on public.rsi_patch_cache from anon, authenticated;
grant select on public.rsi_patch_cache to anon, authenticated;
