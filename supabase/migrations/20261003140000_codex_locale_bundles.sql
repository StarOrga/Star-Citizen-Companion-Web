-- Codex locale strings move to Cloudflare R2 (.claude/deep-knowledge/storage.md
-- "Codex locale strings in R2", 2026-10-03).
--
-- codex_locale_strings (~137 MB incl. pkey, 303k rows per build, 11 langs) is
-- the largest table of the 500 MB Free-plan database, yet the app reads only
-- de + en and only for the current build. The strings now live in R2 as 64
-- content-addressed JSON shards per (build, lang) under
-- `codex-locale/<sha256>.json`, served by cloudflare/assets-worker.
--
-- locale_bundles points at them:
--   {"de":{"v":1,"shards":["<sha0>",...,"<sha63>"],"keys":<n>,"bytes":<n>},
--    "en":{...}}
-- Written only by ingest-catalog (ops locale_commit / locale_backfill, service
-- role, through set_codex_locale_bundle below). Public read follows the
-- existing codex_builds policies.
--
-- The table itself is dropped by a separate, still-pending migration
-- (20261003140100_drop_codex_locale_strings.sql.pending) once the client reads
-- from R2.

alter table public.codex_builds
  add column if not exists locale_bundles jsonb not null default '{}'::jsonb;

comment on column public.codex_builds.locale_bundles is
  'Per language the R2 shard list of the global.ini strings: {lang:{v,shards[64 sha256],keys,bytes}}. Shard sha -> https://sc-assets.sc-assets-worker.workers.dev/codex-locale/<sha>.json';

-- Atomic per-language merge, so a de and an en commit running side by side
-- never overwrite each other (a read-modify-write through PostgREST would).
create or replace function public.set_codex_locale_bundle(
  p_build_id uuid,
  p_lang text,
  p_bundle jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_lang not in ('de', 'en') then
    raise exception 'unsupported locale %', p_lang using errcode = '22023';
  end if;
  update public.codex_builds
     set locale_bundles = locale_bundles || jsonb_build_object(p_lang, p_bundle)
   where id = p_build_id;
  if not found then
    raise exception 'codex build % not found', p_build_id using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_codex_locale_bundle(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_codex_locale_bundle(uuid, text, jsonb) to service_role;
