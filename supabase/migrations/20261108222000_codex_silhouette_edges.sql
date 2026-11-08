-- ============================================================
-- 20261108222000_codex_silhouette_edges.sql
-- Optional inner-edge path on silhouettes (uploader recipe silhouette@N+1).
--
-- WHERE IT LIVES
--   There is no `path` column any more: since 20261102100000 the silhouette
--   shape (view_box, path, bbox, anchors, unresolved) is a deduplicated blob in
--   codex_payloads, referenced by codex_silhouettes_rows.shape_sha, and the view
--   codex_silhouettes unpacks it. So no ALTER TABLE: `edges` becomes one more
--   key of the blob.
--
-- WHAT
--   * codex_upsert_rows: the silhouette blob gains 'edges' (SVG path d, same
--     0..1000 viewBox as path) ONLY when the row carries a non-empty one. Rows
--     without it hash exactly as before, so existing blobs stay shared and no
--     row is rewritten. Everything else in the function is unchanged.
--   * view codex_silhouettes: new last column `edges` (text, null when absent).
--
-- Purely additive. ROLLBACK: re-apply the codex_upsert_rows and view definitions
-- of 20261102100000 (the view without the edges column needs drop + create).
-- After a real push run: notify pgrst, 'reload schema';
-- ============================================================

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

create or replace view public.codex_silhouettes with (security_invoker = true) as
select r.id, r.build_id, r.channel, r.patch_version, r.build_number, r.kind, r.class_name,
       p.body ->> 'view_box' as view_box,
       p.body ->> 'path' as path,
       nullif(p.body -> 'bbox', 'null'::jsonb) as bbox,
       nullif(p.body -> 'anchors', 'null'::jsonb) as anchors,
       nullif(p.body -> 'unresolved', 'null'::jsonb) as unresolved,
       r.meta, r.generated_at, r.created_at, r.content_sha,
       p.body ->> 'edges' as edges
  from public.codex_silhouettes_rows r
  left join public.codex_payloads p on p.sha = r.shape_sha;
