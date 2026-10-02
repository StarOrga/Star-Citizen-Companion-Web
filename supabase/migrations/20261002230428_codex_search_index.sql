-- Codex search over German names + typo suggestions (Codex UX audit 2026-10-02, L05/L06)
-- -----------------------------------------------------------------------------
-- L05: `name_localized` holds the ENGLISH name only (the 00008 comment "en+de"
-- never came true); the German name lives in `payload->'name'->>'de'`. Filtering
-- on that path detoasts every payload of the build — measured 3.1 s on
-- codex_items, over the anon 3 s statement timeout (500). So "Gewehr",
-- "Rüstung" or "Ferngesteuertes Geschütz" found nothing server-side.
-- L06: a typo ("Gladus", "Arowhead") ended in a bare empty state with no hint.
--
-- What this adds:
--   * `unaccent` (schema extensions) and the IMMUTABLE wrapper
--     `codex_search_text(name_localized, payload)` = lower(unaccent(en || ' ' || de)),
--     the German part dropped when it is empty, an unresolved `@loc_key`, the
--     CIG "TRANSLATION NOT FOUND" placeholder or equal to the English name.
--     `extensions.unaccent(text)` is only STABLE, hence the wrapper with the
--     dictionary pinned — the standard pattern for indexing unaccent.
--     The folding matches the client's `normalizeSearch` (codex-search.ts):
--     case and diacritics go, ß becomes ss.
--   * a trigram GIN index on that expression per table that has German names.
--     codex_ammunition has no `payload.name` and 242 rows per build — the RPCs
--     still serve it, by sequential scan.
--   * `codex_search(kind, build, tokens, limit, offset)` — class_name, English
--     name and a rank for every record whose search text (or class_name)
--     contains ALL tokens. Tokens come normalized from the client; the RPC
--     normalizes again, escapes LIKE metacharacters and maps `*` to `%`.
--   * `codex_search_suggest(kind, build, term, limit)` — the closest names by
--     word_similarity (threshold 0.45), for "Meintest du …" on a 0-hit search.
--     The suggestion is the English or the German name, whichever is closer.
--
-- The existing `*_name_trgm` / `*_class_trgm` indexes stay: the PostgREST
-- `or(name_localized.ilike, class_name.ilike)` path of `CodexService.listByKind`
-- runs on them as a BitmapOr and stays the primary search; the RPC is its
-- 0-hit fallback (German name) and suggestion source.
--
-- Budget (storage.md): the database sat at 493 MB of 500 MB when this was
-- written. Rolled-back dry run against prod (2026-10-03, two LIVE builds):
-- items 1960 kB, weapons 384 kB, manufacturers 192 kB, components 136 kB,
-- ships 112 kB, blueprints 24 kB — ~2.8 MB together. Small because GIN stores
-- each distinct trigram per row once and the German name repeats much of the
-- English one. Timings as anon in the same dry run: codex_search 10–480 ms,
-- codex_search_suggest 1–53 ms (index scans, see the PR).

create extension if not exists unaccent with schema extensions;

create or replace function public.codex_search_text(name_localized text, payload jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    coalesce(name_localized, '') || ' ' ||
    case
      when s.de is null or s.de = '' or s.de like '@%'
        or s.de like '%TRANSLATION NOT FOUND%'
        or lower(s.de) = lower(coalesce(name_localized, ''))
      then ''
      else s.de
    end))
  from (select payload -> 'name' ->> 'de' as de) s
$$;

comment on function public.codex_search_text(text, jsonb) is
  'Normalized search text of a codex record: lower(unaccent(English name || German name)). IMMUTABLE so it can back the *_search_trgm indexes.';

create index if not exists codex_ships_search_trgm
  on public.codex_ships using gin (public.codex_search_text(name_localized, payload) extensions.gin_trgm_ops);
create index if not exists codex_weapons_search_trgm
  on public.codex_weapons using gin (public.codex_search_text(name_localized, payload) extensions.gin_trgm_ops);
create index if not exists codex_components_search_trgm
  on public.codex_components using gin (public.codex_search_text(name_localized, payload) extensions.gin_trgm_ops);
create index if not exists codex_items_search_trgm
  on public.codex_items using gin (public.codex_search_text(name_localized, payload) extensions.gin_trgm_ops);
create index if not exists codex_blueprints_search_trgm
  on public.codex_blueprints using gin (public.codex_search_text(name_localized, payload) extensions.gin_trgm_ops);
create index if not exists codex_manufacturers_search_trgm
  on public.codex_manufacturers using gin (public.codex_search_text(name_localized, payload) extensions.gin_trgm_ops);

-- Expression statistics, so the planner picks the new indexes right away.
analyze public.codex_ships, public.codex_weapons, public.codex_components,
        public.codex_items, public.codex_blueprints, public.codex_manufacturers;

-- Kind → table. A whitelist: the RPCs build their query with format(%I).
create or replace function public.codex_kind_table(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'ship' then 'codex_ships'
    when 'weapon' then 'codex_weapons'
    when 'component' then 'codex_components'
    when 'item' then 'codex_items'
    when 'ammunition' then 'codex_ammunition'
    when 'manufacturer' then 'codex_manufacturers'
    when 'blueprint' then 'codex_blueprints'
  end
$$;

create or replace function public.codex_search(
  p_kind text,
  p_build uuid,
  p_tokens text[],
  p_limit int default 60,
  p_offset int default 0
)
returns table (class_name text, name_localized text, rank real)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_table text := public.codex_kind_table(p_kind);
  v_where text := '';
  v_tok text;
  v_pat text;
  v_n int := 0;
  v_indexable boolean := false;
  v_all text := '';
begin
  if v_table is null or p_build is null or p_tokens is null then
    return;
  end if;
  foreach v_tok in array p_tokens[1:8] loop
    v_tok := left(btrim(public.codex_search_text(v_tok, null)), 60);
    -- LIKE metacharacters are literal; `*` is the documented wildcard.
    v_pat := replace(replace(replace(v_tok, '\', '\\'), '%', '\%'), '_', '\_');
    v_pat := '%' || replace(v_pat, '*', '%') || '%';
    if replace(replace(v_pat, '%', ''), ' ', '') = '' then
      continue;
    end if;
    v_n := v_n + 1;
    v_indexable := v_indexable or length(replace(v_tok, '*', '')) >= 3;
    v_all := btrim(v_all || ' ' || replace(v_tok, '*', ' '));
    v_where := v_where || format(
      ' and (public.codex_search_text(t.name_localized, t.payload) like %L or t.class_name ilike %L)',
      v_pat, v_pat);
  end loop;
  -- Without one token of 3+ characters no trigram index applies and the
  -- filter recomputes the search text over the whole build (dry run: "p4 ar"
  -- 1.2 s on codex_items) — too close to the anon 3 s timeout.
  if v_n = 0 or not v_indexable then
    return;
  end if;
  return query execute format(
    'select t.class_name, t.name_localized,
            extensions.word_similarity(%L, public.codex_search_text(t.name_localized, t.payload)) as rank
       from public.%I t
      where t.build_id = $1 %s
      order by rank desc, t.name_localized nulls last, t.class_name
      limit $2 offset $3',
    v_all, v_table, v_where)
  using p_build,
        least(greatest(coalesce(p_limit, 60), 1), 500),
        greatest(coalesce(p_offset, 0), 0);
end;
$$;

comment on function public.codex_search(text, uuid, text[], int, int) is
  'Codex records of one kind and build whose English/German name or class_name contains every token (AND). Ranked by word_similarity. Audit 2026-10-02 L05.';

create or replace function public.codex_search_suggest(
  p_kind text,
  p_build uuid,
  p_term text,
  p_limit int default 3
)
returns table (name text, score real)
language plpgsql
stable
security invoker
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.45
as $$
declare
  v_table text := public.codex_kind_table(p_kind);
  v_term text := left(btrim(public.codex_search_text(p_term, null)), 60);
begin
  if v_table is null or p_build is null or length(replace(v_term, ' ', '')) < 3 then
    return;
  end if;
  return query execute format(
    'select s.name, max(s.score)::real as score
       from (
         select case
                  when extensions.word_similarity(%1$L, public.codex_search_text(null, t.payload))
                     > extensions.word_similarity(%1$L, public.codex_search_text(t.name_localized, null))
                  then t.payload -> ''name'' ->> ''de''
                  else t.name_localized
                end as name,
                extensions.word_similarity(%1$L, public.codex_search_text(t.name_localized, t.payload)) as score
           from public.%2$I t
          where t.build_id = $1
            and %1$L operator(extensions.<%%) public.codex_search_text(t.name_localized, t.payload)
       ) s
      where s.name is not null and s.name <> ''''
      group by s.name
      order by 2 desc, 1
      limit $2',
    v_term, v_table)
  using p_build, least(greatest(coalesce(p_limit, 3), 1), 10);
end;
$$;

comment on function public.codex_search_suggest(text, uuid, text, int) is
  'Closest codex names (English or German) to a term by word_similarity >= 0.45 — the "did you mean" source for a 0-hit search. Audit 2026-10-02 L06.';

grant execute on function public.codex_search_text(text, jsonb) to anon, authenticated;
grant execute on function public.codex_kind_table(text) to anon, authenticated;
grant execute on function public.codex_search(text, uuid, text[], int, int) to anon, authenticated;
grant execute on function public.codex_search_suggest(text, uuid, text, int) to anon, authenticated;
