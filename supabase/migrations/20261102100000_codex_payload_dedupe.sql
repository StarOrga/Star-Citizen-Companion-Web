-- ============================================================
-- 20261102100000_codex_payload_dedupe.sql
-- Codex payloads stored once instead of once per build
-- (concept docs/concepts/20261102-0030-codex-payload-dedupe, round 1).
--
-- WHY
--   Every build was a full copy: ~120 MB per build, ~96 % of the payloads
--   identical to the previous build (measured 2026-11-01/02). Since
--   20261102000000 the uploader no longer SENDS unchanged rows; this
--   migration stops STORING them twice.
--
-- HOW
--   * public.codex_payloads(sha, body): every JSON body once, keyed by
--     sha256 of its jsonb text (codex_blob_sha).
--   * codex_items / _components / _weapons / _ships / _blueprints /
--     _manufacturers / _ammunition: the table becomes <name>_rows (promoted
--     columns + payload_sha + search_text, every index, policy and FK kept)
--     and <name> becomes a security_invoker VIEW with the old columns.
--     `payload` is the blob as stored. The build stamp `source`
--     ({channel, patch, build}) is dropped from it — it equalled the row's
--     build columns on all 54 820 rows, which carry it from now on. The view
--     does NOT add it back: rebuilding the document on every `payload` read
--     would cost a full jsonb rebuild per reference on the hot RPC paths.
--   * Every *_rows table references codex_payloads by FK, so the blob GC can
--     never delete a body a concurrent ingest or carry is about to point at.
--   * codex_silhouettes: the shape (view_box, path, bbox, anchors,
--     unresolved) is the blob, codex_silhouettes_rows keeps the rest.
--   * codex_entity_strings: DROPPED as a table (alpha data policy) and
--     recreated as a view derived from the payloads — every row was
--     payload.{name,description,vehicleName}.{en,de} (57 153 / 57 153
--     reproduced, 0 differences). Where a class exists in two kinds, the
--     kind ingested last wins, as the old upsert did:
--     blueprint > item > component > weapon > ship > manufacturer.
--   * Search: a stored `search_text` (= codex_search_text(name_localized,
--     payload)) with its trigram index on each *_rows table replaces the
--     expression index; codex_search / codex_search_suggest read it.
--   * Writes: codex_upsert_rows(table, rows) (service role) — ingest-catalog
--     calls it; INSTEAD OF INSERT triggers keep plain INSERTs on the views
--     working (gen-codex-sql, seed-codex direct mode).
--   * codex_carry_over / codex_prune_build work on the *_rows tables; a copy
--     copies the payload_sha, never the payload.
--   * Retention 3 builds (was 2): a further build now costs only its changed
--     payloads. codex_gc_payloads() deletes unreferenced blobs after the prune.
--
-- ROLLOUT (red-team review 2026-11-02)
--   Deploy ingest-catalog first (its fallback still works on the old
--   layout), take a data dump of the codex tables, then push; VACUUM FULL by
--   hand right after, before the next ingest. Reverse path, if ever needed:
--   create table <t> as select * from <t> (the view), then indexes/policies.
--   Writes on the views stay closed to anon/authenticated (revokes below):
--   the INSTEAD OF trigger runs as definer and would bypass RLS otherwise.
--
-- DATA
--   No payload is lost: every body moves into codex_payloads before the
--   column is dropped. The dropped codex_entity_strings rows are derivable
--   1:1 from the payloads (see above). Space comes back with the nightly
--   VACUUM FULL jobs (retargeted below).
-- ============================================================

set lock_timeout = '15s';
set statement_timeout = 0;

-- ── blobs ───────────────────────────────────────────────────────────────────
create table public.codex_payloads (
  sha        text primary key,
  body       jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.codex_payloads enable row level security;
create policy codex_payloads_anon_read on public.codex_payloads for select to anon using (true);
create policy codex_payloads_authenticated_read on public.codex_payloads for select to authenticated using (true);
grant select on public.codex_payloads to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.codex_payloads from anon, authenticated;
grant all on public.codex_payloads to service_role;

create or replace function public.codex_blob_sha(p_body jsonb)
returns text language sql immutable parallel safe set search_path = '' as $$
  select encode(pg_catalog.sha256(pg_catalog.convert_to(p_body::text, 'UTF8')), 'hex')
$$;

-- The payload without its build stamp (the row's build columns carry it).
create or replace function public.codex_payload_body(p_payload jsonb)
returns jsonb language sql immutable parallel safe set search_path = '' as $$
  select p_payload - 'source'
$$;

-- ── catalog tables → *_rows + view ──────────────────────────────────────────
do $m$
declare
  t text;
  sel text;
  payload_expr constant text := 'p.body as payload';
begin
  foreach t in array array['codex_manufacturers', 'codex_ships', 'codex_weapons', 'codex_components',
                           'codex_items', 'codex_ammunition', 'codex_blueprints'] loop
    -- The view keeps today's column order.
    select string_agg(case when column_name = 'payload' then payload_expr else format('r.%I', column_name) end,
                      ', ' order by ordinal_position)
      into sel
      from information_schema.columns
     where table_schema = 'public' and table_name = t;

    execute format('alter table public.%I add column payload_sha text, add column search_text text', t);
    -- One pass per table: the update computes the sha, its RETURNING feeds
    -- the blobs (ON CONFLICT DO NOTHING absorbs duplicates without a sort).
    execute format($q$
      with u as (
        update public.%I
           set payload_sha = public.codex_blob_sha(public.codex_payload_body(payload)),
               search_text = public.codex_search_text(name_localized, payload)
        returning payload_sha, public.codex_payload_body(payload) as body
      )
      insert into public.codex_payloads (sha, body)
      select payload_sha, body from u
      on conflict (sha) do nothing$q$, t);
    execute format('alter table public.%I alter column payload_sha set not null', t);

    execute format('drop index if exists public.%I', t || '_search_trgm');
    execute format('alter table public.%I drop column payload', t);
    execute format('alter table public.%I rename to %I', t, t || '_rows');
    execute format('create index %I on public.%I (payload_sha)', t || '_payload_sha_idx', t || '_rows');
    execute format('alter table public.%I add constraint %I foreign key (payload_sha) references public.codex_payloads (sha)',
                   t || '_rows', t || '_payload_sha_fkey');
    if t <> 'codex_ammunition' then
      execute format('create index %I on public.%I using gin (search_text extensions.gin_trgm_ops)',
                     t || '_search_trgm', t || '_rows');
    end if;

    execute format(
      'create view public.%I with (security_invoker = true) as select %s from public.%I r left join public.codex_payloads p on p.sha = r.payload_sha',
      t, sel, t || '_rows');
    execute format('grant select on public.%I to anon, authenticated', t);
    -- Default privileges grant ALL on a new view; the definer trigger below
    -- would turn an anon INSERT into a write past RLS.
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end
$m$;

-- ── silhouettes → codex_silhouettes_rows + view ─────────────────────────────
alter table public.codex_silhouettes add column shape_sha text;
with u as (
  update public.codex_silhouettes
     set shape_sha = public.codex_blob_sha(jsonb_build_object('view_box', view_box, 'path', path, 'bbox', bbox,
                                                              'anchors', anchors, 'unresolved', unresolved))
  returning shape_sha, jsonb_build_object('view_box', view_box, 'path', path, 'bbox', bbox,
                                          'anchors', anchors, 'unresolved', unresolved) as body
)
insert into public.codex_payloads (sha, body)
select shape_sha, body from u
on conflict (sha) do nothing;
alter table public.codex_silhouettes alter column shape_sha set not null;
alter table public.codex_silhouettes
  drop column view_box, drop column path, drop column bbox, drop column anchors, drop column unresolved;
alter table public.codex_silhouettes rename to codex_silhouettes_rows;
create index codex_silhouettes_shape_sha_idx on public.codex_silhouettes_rows (shape_sha);
alter table public.codex_silhouettes_rows
  add constraint codex_silhouettes_shape_sha_fkey foreign key (shape_sha) references public.codex_payloads (sha);

create view public.codex_silhouettes with (security_invoker = true) as
select r.id, r.build_id, r.channel, r.patch_version, r.build_number, r.kind, r.class_name,
       p.body ->> 'view_box' as view_box,
       p.body ->> 'path' as path,
       nullif(p.body -> 'bbox', 'null'::jsonb) as bbox,
       nullif(p.body -> 'anchors', 'null'::jsonb) as anchors,
       nullif(p.body -> 'unresolved', 'null'::jsonb) as unresolved,
       r.meta, r.generated_at, r.created_at, r.content_sha
  from public.codex_silhouettes_rows r
  left join public.codex_payloads p on p.sha = r.shape_sha;
grant select on public.codex_silhouettes to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.codex_silhouettes from anon, authenticated;
grant all on public.codex_silhouettes to service_role;

-- ── entity strings: derived from the payloads ───────────────────────────────
drop table public.codex_entity_strings;

create view public.codex_entity_strings with (security_invoker = true) as
select distinct on (s.build_id, s.class_name, l.lang, f.field)
       md5(s.build_id::text || chr(31) || s.class_name || chr(31) || l.lang || chr(31) || f.field)::uuid as id,
       s.build_id, s.channel, s.patch_version, s.build_number,
       s.class_name as entity_class_name,
       s.kind as entity_kind,
       l.lang, f.field,
       p.body -> f.field ->> l.lang as value,
       p.body -> f.field ->> 'key' as loc_key,
       s.created_at,
       null::text as content_sha
  from (
    select 1 as prec, 'manufacturer'::text as kind, build_id, channel, patch_version, build_number, class_name, payload_sha, created_at from public.codex_manufacturers_rows
    union all select 2, 'ship', build_id, channel, patch_version, build_number, class_name, payload_sha, created_at from public.codex_ships_rows
    union all select 3, 'weapon', build_id, channel, patch_version, build_number, class_name, payload_sha, created_at from public.codex_weapons_rows
    union all select 4, 'component', build_id, channel, patch_version, build_number, class_name, payload_sha, created_at from public.codex_components_rows
    union all select 5, 'item', build_id, channel, patch_version, build_number, class_name, payload_sha, created_at from public.codex_items_rows
    union all select 6, 'blueprint', build_id, channel, patch_version, build_number, class_name, payload_sha, created_at from public.codex_blueprints_rows
  ) s
  join public.codex_payloads p on p.sha = s.payload_sha
  cross join (values ('name'), ('description'), ('vehicleName')) f(field)
  cross join (values ('en'), ('de')) l(lang)
 where jsonb_typeof(p.body -> f.field) = 'object'
   and coalesce(p.body -> f.field ->> l.lang, '') <> ''
   and (f.field <> 'vehicleName' or s.kind = 'ship')
 order by s.build_id, s.class_name, l.lang, f.field, s.prec desc;
grant select on public.codex_entity_strings to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.codex_entity_strings from anon, authenticated;
grant all on public.codex_entity_strings to service_role;

-- ── carry spec: base tables, no stored payload stamp any more ───────────────
drop function if exists public.codex_carry_spec(text);
create or replace function public.codex_carry_spec(p_table text,
  out base text, out key_cols text[], out conflict text, out volatile text[])
language plpgsql immutable set search_path = '' as $$
begin
  case p_table
    when 'codex_manufacturers', 'codex_ships', 'codex_weapons', 'codex_components',
         'codex_items', 'codex_ammunition', 'codex_blueprints' then
      base := p_table || '_rows';
      key_cols := array['class_name'];
      conflict := 'channel, patch_version, build_number, class_name';
      volatile := array[]::text[];   -- `source` is derived by the view now
    when 'codex_silhouettes' then
      base := 'codex_silhouettes_rows';
      key_cols := array['kind', 'class_name'];
      conflict := 'channel, patch_version, build_number, kind, class_name';
      volatile := array['meta.source'];
    else
      raise exception 'codex_carry_spec: table % is not carried', p_table using errcode = '22023';
  end case;
end $$;
revoke all on function public.codex_carry_spec(text) from public, anon, authenticated;
grant execute on function public.codex_carry_spec(text) to service_role;

create or replace function public.codex_carry_over(
  p_table text, p_build_id uuid, p_rows jsonb, p_set jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_spec record;
  v_build public.codex_builds%rowtype;
  v_sources uuid[];
  v_cols text[];
  v_sel text := '';
  v_upd text := '';
  v_tjoin text := '';
  v_sjoin text := '';
  v_col text;
  v_path text;
  v_expr text;
  v_res jsonb;
  i int;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'codex_carry_over: rows must be an array' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_set, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'codex_carry_over: set must be an object' using errcode = '22023';
  end if;
  -- Entity strings are derived from the payloads: nothing to store or send.
  if p_table = 'codex_entity_strings' then
    return jsonb_build_object('kept', jsonb_array_length(p_rows), 'copied', 0, 'missing', '[]'::jsonb, 'invalid', 0);
  end if;
  select * into v_spec from public.codex_carry_spec(p_table);
  select * into v_build from public.codex_builds where id = p_build_id;
  if not found then
    raise exception 'codex_carry_over: unknown build %', p_build_id using errcode = '22023';
  end if;

  select coalesce(array_agg(id order by finalized_at desc), '{}') into v_sources
  from (
    select id, finalized_at from public.codex_builds
    where id <> p_build_id and finalized_at is not null
    order by finalized_at desc limit 4
  ) s;

  select array_agg(column_name::text order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = v_spec.base
    and column_name not in ('id', 'build_id', 'channel', 'patch_version', 'build_number', 'created_at');

  foreach v_col in array v_cols loop
    v_expr := format('s.%I', v_col);
    foreach v_path in array v_spec.volatile loop
      if split_part(v_path, '.', 1) = v_col then
        v_expr := format(
          'case when %1$s is null then null else (%1$s - %2$L) || case when $7 ? %3$L then jsonb_build_object(%2$L, $7 -> %3$L) else ''{}''::jsonb end end',
          v_expr, split_part(v_path, '.', 2), v_path);
      end if;
    end loop;
    v_sel := v_sel || ', ' || v_expr;
    v_upd := v_upd || format('%s%I = excluded.%I', case when v_upd = '' then '' else ', ' end, v_col, v_col);
  end loop;

  for i in 1 .. array_length(v_spec.key_cols, 1) loop
    v_tjoin := v_tjoin || format(' and t.%I = q.k ->> %s', v_spec.key_cols[i], i - 1);
    v_sjoin := v_sjoin || format(' and s.%I = q.k ->> %s', v_spec.key_cols[i], i - 1);
  end loop;

  execute format($q$
    with req as materialized (
      select (r.ord - 1)::int as i, r.v ->> 'h' as h, r.v -> 'k' as k
      from jsonb_array_elements($1) with ordinality as r(v, ord)
      where jsonb_typeof(r.v -> 'k') = 'array' and r.v ->> 'h' is not null
    ),
    kept as materialized (
      select q.i from req q
      join public.%1$I t on t.build_id = $2 %2$s and t.content_sha = q.h
    ),
    src as materialized (
      select distinct on (q.k) q.i as carry_i, s.*
      from req q
      join public.%1$I s on s.build_id = any($3) %3$s and s.content_sha = q.h
      where q.i not in (select i from kept)
      order by q.k, q.i desc, array_position($3, s.build_id)
    ),
    ins as (
      insert into public.%1$I (build_id, channel, patch_version, build_number, %4$s)
      select $2, $4, $5, $6 %5$s from src s
      on conflict (%6$s) do update set %7$s
      returning 1
    )
    select jsonb_build_object(
      'kept', (select count(*) from kept),
      'copied', (select count(*) from ins),
      'missing', coalesce((
        select jsonb_agg(q.i order by q.i) from req q
        where q.i not in (select i from kept) and q.i not in (select carry_i from src)
      ), '[]'::jsonb),
      'invalid', jsonb_array_length($1) - (select count(*) from req)
    )
  $q$,
    v_spec.base, v_tjoin, v_sjoin,
    (select string_agg(format('%I', c), ', ') from unnest(v_cols) c),
    v_sel, v_spec.conflict, v_upd)
  into v_res
  using p_rows, p_build_id, v_sources, v_build.channel, v_build.patch_version, v_build.build_number,
        coalesce(p_set, '{}'::jsonb);
  return v_res;
end $$;

create or replace function public.codex_prune_build(p_table text, p_build_id uuid, p_keys jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_spec record;
  v_join text := '';
  v_n integer;
  i int;
begin
  if jsonb_typeof(p_keys) is distinct from 'array' then
    raise exception 'codex_prune_build: keys must be an array' using errcode = '22023';
  end if;
  select * into v_spec from public.codex_carry_spec(p_table);
  for i in 1 .. array_length(v_spec.key_cols, 1) loop
    v_join := v_join || format(' and t.%I = k.v ->> %s', v_spec.key_cols[i], i - 1);
  end loop;
  execute format(
    'delete from public.%I t where t.build_id = $1 and not exists (select 1 from jsonb_array_elements($2) k(v) where true %s)',
    v_spec.base, v_join)
  using p_build_id, p_keys;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── writes ──────────────────────────────────────────────────────────────────
-- Rows in the shape of the views (with `payload`, or the silhouette shape
-- columns) → blob + *_rows upsert on the natural key. Entity strings are
-- derived: accepted and dropped. Like a PostgREST upsert, only the columns
-- the batch names are written: an absent column keeps its default on insert
-- and its value on conflict.
create or replace function public.codex_upsert_rows(p_table text, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_spec record;
  v_cols text[];
  v_list text;
  v_upd text;
  v_body text;
  v_extra text;
  v_n integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'codex_upsert_rows: rows must be an array' using errcode = '22023';
  end if;
  if p_table = 'codex_entity_strings' then
    return 0;
  end if;
  select * into v_spec from public.codex_carry_spec(p_table);

  if p_table = 'codex_silhouettes' then
    if exists (select 1 from jsonb_array_elements(p_rows) r
                where coalesce(r ->> 'view_box', '') = '' or coalesce(r ->> 'path', '') = ''
                   or jsonb_typeof(r -> 'bbox') is distinct from 'object') then
      raise exception 'codex_upsert_rows: silhouette rows need view_box, path and bbox' using errcode = '23502';
    end if;
    v_body := $b$jsonb_build_object('view_box', r -> 'view_box', 'path', r -> 'path', 'bbox', r -> 'bbox',
                                    'anchors', coalesce(r -> 'anchors', '[]'::jsonb),
                                    'unresolved', coalesce(r -> 'unresolved', '[]'::jsonb))$b$;
    v_extra := $e$jsonb_build_object('shape_sha', public.codex_blob_sha(body))$e$;
  else
    if exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r -> 'payload') is distinct from 'object') then
      raise exception 'codex_upsert_rows: every row needs a payload object' using errcode = '23502';
    end if;
    v_body := $b$public.codex_payload_body(r -> 'payload')$b$;
    v_extra := $e$jsonb_build_object('payload_sha', public.codex_blob_sha(body),
                                     'search_text', public.codex_search_text(r ->> 'name_localized', r -> 'payload'))$e$;
  end if;

  select array_agg(column_name::text order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = v_spec.base
    and column_name not in ('id', 'created_at')
    and (column_name in ('payload_sha', 'search_text', 'shape_sha')
         or column_name in (select distinct k from jsonb_array_elements(p_rows) r, jsonb_object_keys(r) k));
  select string_agg(format('%I', c), ', '), string_agg(format('%I = excluded.%I', c, c), ', ')
    into v_list, v_upd from unnest(v_cols) c;

  execute format($q$
    with src as materialized (
      select r, %1$s as body from jsonb_array_elements($1) r
    ),
    blobs as (
      insert into public.codex_payloads (sha, body)
      select public.codex_blob_sha(body), body from src
      on conflict (sha) do nothing
      returning 1
    ),
    recs as (
      select x.* from src cross join lateral jsonb_populate_record(null::public.%2$I, r || %3$s) x
    )
    insert into public.%2$I (%4$s)
    select %4$s from recs
    on conflict (%5$s) do update set %6$s
  $q$, v_body, v_spec.base, v_extra, v_list, v_spec.conflict, v_upd)
  using p_rows;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.codex_upsert_rows(text, jsonb) from public, anon, authenticated;
grant execute on function public.codex_upsert_rows(text, jsonb) to service_role;

-- Plain INSERTs on the views (scripts) go through the same path.
create or replace function public.codex_view_insert()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- NEW carries every view column; the unset ones (null) stay out, so the
  -- base table's defaults apply as they did for a plain INSERT.
  perform public.codex_upsert_rows(tg_table_name, jsonb_build_array(
    (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(new)) e where e.value <> 'null'::jsonb)));
  return new;
end $$;
revoke all on function public.codex_view_insert() from public, anon, authenticated;
revoke all on function public.codex_payload_body(jsonb) from public, anon, authenticated;

do $t$
declare t text;
begin
  foreach t in array array['codex_manufacturers', 'codex_ships', 'codex_weapons', 'codex_components',
                           'codex_items', 'codex_ammunition', 'codex_blueprints', 'codex_silhouettes',
                           'codex_entity_strings'] loop
    execute format('create trigger %I instead of insert on public.%I for each row execute function public.codex_view_insert()',
                   t || '_insert', t);
  end loop;
end
$t$;

-- ── search on the stored column ─────────────────────────────────────────────
create or replace function public.codex_search(p_kind text, p_build uuid, p_tokens text[], p_limit integer default 60, p_offset integer default 0)
returns table(class_name text, name_localized text, rank real)
language plpgsql stable set search_path = '' as $function$
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
      ' and (t.search_text like %L or t.class_name ilike %L)',
      v_pat, v_pat);
  end loop;
  -- Without one token of 3+ characters no trigram index applies.
  if v_n = 0 or not v_indexable then
    return;
  end if;
  return query execute format(
    'select t.class_name, t.name_localized,
            extensions.word_similarity(%L, t.search_text) as rank
       from public.%I t
      where t.build_id = $1 %s
      order by rank desc, t.name_localized nulls last, t.class_name
      limit $2 offset $3',
    v_all, v_table || '_rows', v_where)
  using p_build,
        least(greatest(coalesce(p_limit, 60), 1), 500),
        greatest(coalesce(p_offset, 0), 0);
end;
$function$;

create or replace function public.codex_search_suggest(p_kind text, p_build uuid, p_term text, p_limit integer default 3)
returns table(name text, score real)
language plpgsql stable
set search_path = ''
set "pg_trgm.word_similarity_threshold" to '0.45'
as $function$
declare
  v_table text := public.codex_kind_table(p_kind);
  v_term text := left(btrim(public.codex_search_text(p_term, null)), 60);
begin
  if v_table is null or p_build is null or length(replace(v_term, ' ', '')) < 3 then
    return;
  end if;
  -- The trigram filter runs on the stored column; only the hits read their
  -- payload (for the German name).
  return query execute format(
    'select s.name, max(s.score)::real as score
       from (
         select case
                  when extensions.word_similarity(%1$L, public.codex_search_text(null, p.body))
                     > extensions.word_similarity(%1$L, public.codex_search_text(t.name_localized, null))
                  then p.body -> ''name'' ->> ''de''
                  else t.name_localized
                end as name,
                extensions.word_similarity(%1$L, t.search_text) as score
           from public.%2$I t
           left join public.codex_payloads p on p.sha = t.payload_sha
          where t.build_id = $1
            and %1$L operator(extensions.<%%) t.search_text
       ) s
      where s.name is not null and s.name <> ''''
      group by s.name
      order by 2 desc, 1
      limit $2',
    v_term, v_table || '_rows')
  using p_build, least(greatest(coalesce(p_limit, 3), 1), 10);
end;
$function$;

-- ── retention + blob GC ─────────────────────────────────────────────────────
create or replace function public.prune_codex_builds(p_keep integer default 3)
returns table(build_id uuid, channel text, patch_version text)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_keep is null or p_keep < 1 then
    raise exception 'prune_codex_builds: p_keep must be >= 1 (got %)', p_keep;
  end if;

  return query
  with ranked as (
    select b.id, b.is_current,
           row_number() over (partition by b.channel order by b.created_at desc) as rn
    from public.codex_builds b
    where b.finalized_at is not null or b.is_current
  ),
  doomed as (
    select r.id from ranked r where r.rn > p_keep and not r.is_current
    union
    select b.id from public.codex_builds b
    where b.finalized_at is null and not b.is_current
      and b.created_at < now() - interval '7 days'
  )
  delete from public.codex_builds d
  using doomed x
  where d.id = x.id
  returning d.id, d.channel, d.patch_version;
end
$function$;

-- Blobs no row references any more (pruned builds). The hour of grace keeps
-- a blob an ingest just wrote even if its row lands in a later batch. A
-- concurrent ingest pointing at a blob holds a key-share lock on it (FK), so
-- SKIP LOCKED leaves that blob alone instead of failing the whole sweep.
create or replace function public.codex_gc_payloads()
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.codex_payloads d
   where d.sha in (
    select p.sha from public.codex_payloads p
     where p.created_at < now() - interval '1 hour'
     and not exists (select 1 from public.codex_items_rows r where r.payload_sha = p.sha)
     and not exists (select 1 from public.codex_components_rows r where r.payload_sha = p.sha)
     and not exists (select 1 from public.codex_weapons_rows r where r.payload_sha = p.sha)
     and not exists (select 1 from public.codex_ships_rows r where r.payload_sha = p.sha)
     and not exists (select 1 from public.codex_blueprints_rows r where r.payload_sha = p.sha)
     and not exists (select 1 from public.codex_manufacturers_rows r where r.payload_sha = p.sha)
     and not exists (select 1 from public.codex_ammunition_rows r where r.payload_sha = p.sha)
     and not exists (select 1 from public.codex_silhouettes_rows r where r.shape_sha = p.sha)
     for update skip locked);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.codex_gc_payloads() from public, anon, authenticated;
grant execute on function public.codex_gc_payloads() to service_role;

-- ── cron: retention 3 + GC, VACUUM FULL on the new names ────────────────────
-- codex_payloads gets no nightly VACUUM FULL: every codex read joins it, so
-- its exclusive lock would stall the whole Codex; GC + autovacuum reuse the
-- space instead.
select cron.schedule('codex-build-retention', '30 3 * * *',
  $$ select count(*) from public.prune_codex_builds(3); select public.codex_gc_payloads(); $$);
select cron.unschedule('codex-storage-reclaim-codex_entity_strings')
 where exists (select 1 from cron.job where jobname = 'codex-storage-reclaim-codex_entity_strings');
select cron.schedule('codex-storage-reclaim-codex_items', '45 4 * * *', 'vacuum full public.codex_items_rows');
select cron.schedule('codex-storage-reclaim-codex_components', '48 4 * * *', 'vacuum full public.codex_components_rows');
select cron.schedule('codex-storage-reclaim-codex_blueprints', '49 4 * * *', 'vacuum full public.codex_blueprints_rows');
select cron.schedule('codex-storage-reclaim-codex_weapons', '50 4 * * *', 'vacuum full public.codex_weapons_rows');
select cron.schedule('codex-storage-reclaim-codex_ships', '51 4 * * *', 'vacuum full public.codex_ships_rows');
select cron.schedule('codex-storage-reclaim-codex_silhouettes', '53 4 * * *', 'vacuum full public.codex_silhouettes_rows');
select cron.schedule('codex-storage-reclaim-codex_manufacturers', '54 4 * * *', 'vacuum full public.codex_manufacturers_rows');
select cron.schedule('codex-storage-reclaim-codex_ammunition', '56 4 * * *', 'vacuum full public.codex_ammunition_rows');
