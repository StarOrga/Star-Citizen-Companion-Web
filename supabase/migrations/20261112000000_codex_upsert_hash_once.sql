-- codex_upsert_rows: hash each payload once per row (ingest_timeout fix).
--
-- Field evidence (uploader main.log 2026-11-01..11): ~50x HTTP 503 ingest_timeout
-- ("canceling statement due to statement timeout") on codex_ships (360 -> 180 ->
-- 90 -> 45 rows), codex_blueprints and codex_items (500 -> 250) on every run.
-- The function hashed the full payload body in the blobs CTE AND again inside
-- the per-row extra column (shape_sha / payload_sha), each time detoasting the
-- jsonb: the same expression was paid two to three times per row. The hash is
-- now computed once in the materialized src CTE and reused; `distinct on (sha)`
-- also stops identical payloads in one batch from hitting the unique index
-- twice. Behaviour and signature are unchanged. ROLLBACK: re-apply the function
-- from 20261108222000_codex_silhouette_edges.sql.
-- NOT verified against a live DB before commit: apply with db push, then run the
-- uploader's catalog stage once and check main.log for ingest_timeout.

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
                                    'unresolved', coalesce(r -> 'unresolved', '[]'::jsonb))
                    || case when coalesce(r ->> 'edges', '') <> ''
                            then jsonb_build_object('edges', r -> 'edges') else '{}'::jsonb end$b$;
    v_extra := $e$jsonb_build_object('shape_sha', sha)$e$;
  else
    if exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r -> 'payload') is distinct from 'object') then
      raise exception 'codex_upsert_rows: every row needs a payload object' using errcode = '23502';
    end if;
    v_body := $b$public.codex_payload_body(r -> 'payload')$b$;
    v_extra := $e$jsonb_build_object('payload_sha', sha,
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
      -- body is built and hashed ONCE per row; it used to be rebuilt and hashed
      -- again in the blobs CTE and in every extra column (each pass re-detoasts
      -- the whole payload), which pushed 90-360 ship rows past the statement
      -- timeout.
      select t.r, t.body, public.codex_blob_sha(t.body) as sha
        from (select r, %1$s as body from jsonb_array_elements($1) r) t
    ),
    blobs as (
      insert into public.codex_payloads (sha, body)
      select distinct on (sha) sha, body from src
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
