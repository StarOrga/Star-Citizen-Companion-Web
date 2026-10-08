-- ============================================================
-- 20261008223000_codex_build_class_idx.sql
-- A plain btree on (build_id, class_name) for the mountable entity tables.
--
-- WHY
--   Every batched payload read filters `build_id = $1 and class_name in (…)`
--   (CodexService.getEntityPayloads / getAmmoPayloads / resolveEntities, the
--   ship page's loadout and the whole-fleet rank cohort). None of these tables
--   had an index that serves that shape: the natural key leads with
--   (channel, patch_version, build_number), so Postgres answered the
--   class_name equality through the TRIGRAM GIN index instead —
--   measured 2026-10-08 on codex_items, one 200-name chunk = ~300 ms of index
--   work and ~29k buffer hits, against ~10 ms / ~4k buffers through a btree
--   (the natkey, same rows). The cold rank cohort sends ~75 such chunks, so a
--   single visitor without a cohort cache cost ~20 s of database CPU; two or
--   three at once held PostgREST's whole connection pool (PGRST003 "Timed out
--   acquiring connection from connection pool" in the PostgREST log) and a
--   `profiles` primary-key read waited 7–11 s — past the 5 s approvedGuard
--   gives it, so fresh page loads landed on /unavailable.
--
-- SIZE
--   ~48k rows across the five tables today (two retained builds): a few MB of
--   index, well inside the DB budget (.claude/deep-knowledge/storage.md).
--
-- LOCKING
--   Plain CREATE INDEX (migrations run in a transaction, so not CONCURRENTLY).
--   On tables this small it holds the write lock for well under a second, and
--   only the uploader's ingest writes to them.
-- ============================================================

create index if not exists codex_items_build_class_idx
  on public.codex_items using btree (build_id, class_name);

create index if not exists codex_components_build_class_idx
  on public.codex_components using btree (build_id, class_name);

create index if not exists codex_weapons_build_class_idx
  on public.codex_weapons using btree (build_id, class_name);

create index if not exists codex_ammunition_build_class_idx
  on public.codex_ammunition using btree (build_id, class_name);

create index if not exists codex_ships_build_class_idx
  on public.codex_ships using btree (build_id, class_name);
