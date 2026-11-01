-- ============================================================
-- 20261102000000_codex_carry_over.sql
-- Per-object incremental codex upload: unchanged rows are copied server-side
-- from an earlier build instead of being sent again by the uploader.
--
-- WHY
--   Every codex build is a full per-build copy of the catalog (ships, weapons,
--   components, items, ammunition, manufacturers, blueprints, entity strings,
--   silhouettes): ~35k entity rows + ~57k entity strings, ~120 MB per build
--   on disk. The uploader re-sent every row each build. Measured 2026-11-01 on
--   the two newest LIVE builds (4.10.2 12881860 -> 12913470) with the payload's
--   per-build `source` stamp left out: items 20234/20385, components 2261/2261,
--   weapons 1067/1346, blueprints 1616/1616, manufacturers 1200/1200, ammo
--   242/242, entity strings 57153/57153 identical; ships 2/360 (the extractor
--   gained decks/hardpoints in between). Across a patch (4.10.0 -> 4.10.2)
--   still ~90 % of the items. Byte-identical with the stamp: 0 %, because
--   `payload.source` = {channel, patch, build} differs on every row.
--
-- HOW
--   * `content_sha` (sha256 hex, nullable) on every carried table: the
--     uploader's hash of the row WITHOUT its build coordinates (build_id,
--     channel, patch_version, build_number) and without the volatile build
--     stamp (`payload.source`, silhouettes `meta.source` + `generated_at`).
--     Rows written before this migration have NULL and are simply never
--     matched -> the first upload after it is a full one.
--   * `codex_carry_over(table, build_id, rows, set)`: rows = [{k: [key...],
--     h: sha}]. Per row: already in the target build with that sha -> kept;
--     found in one of the newest finalized builds with that sha -> copied into
--     the target build (build coordinates of the target, volatile stamp
--     replaced by `set`); otherwise its index is returned in `missing` and the
--     uploader sends that row in full. Idempotent, so the uploader's resumable
--     chunk loop and timeout-halving keep working unchanged.
--   * `codex_prune_build(table, build_id, keys)`: deletes the target build's
--     rows whose key is not in `keys` — replaces `clear_silhouettes`, which
--     would wipe rows a re-upload could keep.
--
-- STORAGE
--   Rows are still physical per-build copies: readers (PostgREST selects, the
--   codex_* RPCs, the codex_search_text trigram indexes) stay untouched. The
--   saving is transfer + uploader time; DB size per build is unchanged and
--   stays bounded by prune_codex_builds (2 builds + current).
--
-- Additive only. Service role only (ingest-catalog).
-- ============================================================

alter table public.codex_manufacturers  add column if not exists content_sha text;
alter table public.codex_ships          add column if not exists content_sha text;
alter table public.codex_weapons        add column if not exists content_sha text;
alter table public.codex_components     add column if not exists content_sha text;
alter table public.codex_items          add column if not exists content_sha text;
alter table public.codex_ammunition     add column if not exists content_sha text;
alter table public.codex_blueprints     add column if not exists content_sha text;
alter table public.codex_entity_strings add column if not exists content_sha text;
alter table public.codex_silhouettes    add column if not exists content_sha text;

-- The source-row lookup is (build_id, class_name); these two tables had no
-- such btree yet (20261008223000 covered the other five).
create index if not exists codex_blueprints_build_class_idx    on public.codex_blueprints (build_id, class_name);
create index if not exists codex_manufacturers_build_class_idx on public.codex_manufacturers (build_id, class_name);

-- Key columns, ON CONFLICT target and volatile jsonb paths ('column.key') per table.
create or replace function public.codex_carry_spec(p_table text,
  out key_cols text[], out conflict text, out volatile text[])
language plpgsql immutable set search_path = '' as $$
begin
  case p_table
    when 'codex_manufacturers', 'codex_ships', 'codex_weapons', 'codex_components',
         'codex_items', 'codex_ammunition', 'codex_blueprints' then
      key_cols := array['class_name'];
      conflict := 'channel, patch_version, build_number, class_name';
      volatile := array['payload.source'];
    when 'codex_silhouettes' then
      key_cols := array['kind', 'class_name'];
      conflict := 'channel, patch_version, build_number, kind, class_name';
      volatile := array['meta.source'];
    when 'codex_entity_strings' then
      key_cols := array['entity_class_name', 'lang', 'field'];
      conflict := 'build_id, entity_class_name, lang, field';
      volatile := array[]::text[];
    else
      raise exception 'codex_carry_spec: table % is not carried', p_table using errcode = '22023';
  end case;
end $$;

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
  select * into v_spec from public.codex_carry_spec(p_table);
  select * into v_build from public.codex_builds where id = p_build_id;
  if not found then
    raise exception 'codex_carry_over: unknown build %', p_build_id using errcode = '22023';
  end if;

  -- Where unchanged rows come from: the newest finalized builds (any channel —
  -- equal hashes are equal content). Retention keeps only a handful.
  select coalesce(array_agg(id order by finalized_at desc), '{}') into v_sources
  from (
    select id, finalized_at from public.codex_builds
    where id <> p_build_id and finalized_at is not null
    order by finalized_at desc limit 4
  ) s;

  select array_agg(column_name::text order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table
    and column_name not in ('id', 'build_id', 'channel', 'patch_version', 'build_number', 'created_at');

  foreach v_col in array v_cols loop
    v_expr := format('s.%I', v_col);
    foreach v_path in array v_spec.volatile loop
      if split_part(v_path, '.', 1) = v_col then
        -- Re-stamp: drop the source build's value, set the uploader's (absent in `set` = absent in the row).
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
      -- One copy per KEY (a key listed twice would hit the same target row
      -- twice in one ON CONFLICT); the duplicate comes back as missing.
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
    p_table, v_tjoin, v_sjoin,
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
    p_table, v_join)
  using p_build_id, p_keys;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.codex_carry_spec(text) from public, anon, authenticated;
revoke all on function public.codex_carry_over(text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.codex_prune_build(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.codex_carry_spec(text) to service_role;
grant execute on function public.codex_carry_over(text, uuid, jsonb, jsonb) to service_role;
grant execute on function public.codex_prune_build(text, uuid, jsonb) to service_role;
