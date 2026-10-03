-- Localization strings move to R2 (storage plan, 2026-10-03).
--
-- codex_locale_strings held 185 MB (117 MB heap + 68 MB pkey) for two builds
-- of a 500 MB Free database. From now on the table is only the staging area of
-- a running ingest: ingest-catalog publishes each language as JSON shards to
-- the R2 assets bucket (layout: supabase/functions/ingest-catalog/
-- _locale-shards.ts) and deletes the rows once the public Worker serves them.
-- The table itself stays; existing rows are moved by
-- scripts/codex-locale-to-r2.mjs (--delete-source), never by a migration.
--
-- Three service-role-only helpers, because PostgREST caps a plain select at
-- 1 000 rows and English alone has ~90 000 keys:
--   codex_locale_langs(build)                     languages + row counts
--   codex_locale_export(build, lang, after, lim)  one keyset page as ONE jsonb
--                                                 object + the page's last key
--   codex_locale_delete(build, lang, lim)         deletes up to lim rows
-- Paged because PostgREST runs under the authenticator's 8 s statement_timeout:
-- measured 2026-10-03, the whole English export took 5.0 s and its delete
-- 6.4 s, too close. A page of 20 000 is well under 2 s. The cursor is the
-- page's max(key), so it follows the database collation, not JS ordering.

create or replace function public.codex_locale_langs(p_build_id uuid)
returns table (lang text, n bigint)
language sql
stable
set search_path = public
as $$
  select l.lang, count(*)::bigint
  from public.codex_locale_strings l
  where l.build_id = p_build_id
  group by l.lang
  order by l.lang;
$$;

create or replace function public.codex_locale_export(
  p_build_id uuid, p_lang text, p_after text default null, p_limit int default 20000)
returns table (entries jsonb, last_key text, n int)
language sql
stable
set search_path = public
as $$
  with page as (
    select l.key, l.value
    from public.codex_locale_strings l
    where l.build_id = p_build_id and l.lang = p_lang
      and (p_after is null or l.key > p_after)
    order by l.key
    limit least(greatest(p_limit, 1), 50000)
  )
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb), max(key), count(*)::int from page;
$$;

create or replace function public.codex_locale_delete(p_build_id uuid, p_lang text, p_limit int default 20000)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  n bigint;
begin
  delete from public.codex_locale_strings
  where ctid in (
    select ctid from public.codex_locale_strings
    where build_id = p_build_id and lang = p_lang
    limit least(greatest(p_limit, 1), 50000)
  );
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.codex_locale_langs(uuid) from public, anon, authenticated;
revoke all on function public.codex_locale_export(uuid, text, text, int) from public, anon, authenticated;
revoke all on function public.codex_locale_delete(uuid, text, int) from public, anon, authenticated;
grant execute on function public.codex_locale_langs(uuid) to service_role;
grant execute on function public.codex_locale_export(uuid, text, text, int) to service_role;
grant execute on function public.codex_locale_delete(uuid, text, int) to service_role;

comment on table public.codex_locale_strings is
  'Staging only since 2026-10-03: a running ingest writes the global.ini tables here, ingest-catalog publishes them to R2 (codex-locale/<build>/<lang>/) and deletes the rows once the Worker serves them. Clients read R2 and fall back to this table while a build has no R2 index.';
