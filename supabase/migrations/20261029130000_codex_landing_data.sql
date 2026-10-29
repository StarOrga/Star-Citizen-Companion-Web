-- ============================================================
-- 20261029130000_codex_landing_data.sql
-- Data contract for the new Codex landing (concept 2026-10-29-codex-landing-neu).
--
--  A. codex_builds.patch_summary   KI trend lines per build (<= 3 per language),
--                                  written ONCE per build by the edge function
--                                  `codex-patch-summary` (service role).
--  B. codex_build_diff_digest()    compact, service-only diff of one build vs the
--                                  previous finalized build of its channel; the
--                                  prompt input of that function. Never item lists.
--  C. rsi_ship_paints              RSI store paint/skin images (URL + metadata,
--                                  NO blobs - storage.md 500 MB budget), crawled by
--                                  `rsi-paints-sync`, public read.
--
-- "News seen" state needs NO new column: it rides the existing account-wide
-- `profiles.ui_prefs` map through the SECURITY DEFINER RPC `set_ui_pref`
-- (20261007100000; granted to every `authenticated` user incl. role viewer, self
-- row only; profiles_self_read covers the read). Key: `codex.newsSeen`, value =
-- the patch version string the user last opened the News popover for.
--
-- ADDITIVE: drops and renames nothing.
-- ROLLBACK: drop table if exists public.rsi_ship_paints;
--           drop function if exists public.codex_build_diff_digest(uuid);
--           alter table public.codex_builds drop column if exists patch_summary;
-- ============================================================

-- ---------------- A. patch summary on the build ----------------
-- Shape: { "de": [string x<=3], "en": [string x<=3], "model": text, "generated_at": iso }
-- Absent (null) = not generated (yet / failed): the UI hides the News button.
alter table public.codex_builds
  add column if not exists patch_summary jsonb;

alter table public.codex_builds
  drop constraint if exists codex_builds_patch_summary_check;
alter table public.codex_builds
  add constraint codex_builds_patch_summary_check check (
    patch_summary is null or (
      jsonb_typeof(patch_summary) = 'object'
      and jsonb_typeof(patch_summary -> 'de') = 'array'
      and jsonb_typeof(patch_summary -> 'en') = 'array'
      and jsonb_array_length(patch_summary -> 'de') <= 3
      and jsonb_array_length(patch_summary -> 'en') <= 3
      and pg_column_size(patch_summary) <= 4096
    )
  );

comment on column public.codex_builds.patch_summary is
  'KI patch summary: {de:[<=3 trend lines], en:[<=3], model, generated_at}. Written once per build by codex-patch-summary (service role); null = none.';

-- ---------------- B. diff digest for the prompt ----------------
create or replace function public.codex_build_diff_digest(p_build_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '25s'
as $$
declare
  v_cur public.codex_builds%rowtype;
  v_prev uuid;
  v_out jsonb := '{}'::jsonb;
  v_tbl text;
  v_added jsonb;
  v_changes jsonb;
begin
  select * into v_cur from public.codex_builds where id = p_build_id;
  if not found then return null; end if;

  select id into v_prev
  from public.codex_builds
  where channel = v_cur.channel and id <> v_cur.id
    and finalized_at is not null and created_at < v_cur.created_at
  order by created_at desc
  limit 1;

  v_out := jsonb_build_object('patch', v_cur.patch_version, 'channel', v_cur.channel,
                              'has_previous', v_prev is not null);
  if v_prev is null then return v_out; end if;

  foreach v_tbl in array array['codex_ships', 'codex_weapons', 'codex_components', 'codex_items'] loop
    -- added / removed counts + a few names (non-variant rows only)
    execute format($f$
      with cur as (select class_name, name_localized from public.%1$I where build_id = $1 and not is_variant),
           prv as (select class_name from public.%1$I where build_id = $2 and not is_variant)
      select jsonb_build_object(
        'added',   (select count(*) from cur where class_name not in (select class_name from prv)),
        'removed', (select count(*) from prv where class_name not in (select class_name from cur)),
        'added_names', coalesce((select jsonb_agg(n) from (
            select coalesce(nullif(name_localized, ''), class_name) as n from cur
            where class_name not in (select class_name from prv) order by class_name limit 12) s), '[]'::jsonb))
    $f$, v_tbl) into v_added using p_build_id, v_prev;

    -- numeric leaf changes of the payload, grouped by leaf path (trend, not items)
    execute format($f$
      with recursive walk(cn, path, val, depth) as (
        select class_name, ''::text, payload, 0 from public.%1$I where build_id = $1 and not is_variant
        union all
        select w.cn, w.path || '.' || e.key, e.value, w.depth + 1
        from walk w, jsonb_each(w.val) e
        where jsonb_typeof(w.val) = 'object' and w.depth < 4
      ), walk_prev(cn, path, val, depth) as (
        select class_name, ''::text, payload, 0 from public.%1$I where build_id = $2 and not is_variant
        union all
        select w.cn, w.path || '.' || e.key, e.value, w.depth + 1
        from walk_prev w, jsonb_each(w.val) e
        where jsonb_typeof(w.val) = 'object' and w.depth < 4
      ), delta as (
        select c.cn, c.path,
               ((c.val)::text)::numeric as cur_v, ((p.val)::text)::numeric as prev_v
        from walk c join walk_prev p using (cn, path)
        where jsonb_typeof(c.val) = 'number' and jsonb_typeof(p.val) = 'number'
          and ((p.val)::text)::numeric <> 0 and (c.val)::text <> (p.val)::text
      ), pct as (
        select cn, path, round((cur_v - prev_v) / abs(prev_v) * 100, 1) as pct from delta
      )
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'items', n, 'avg_pct', avg_pct, 'max_abs_pct', max_abs)
                                order by n desc), '[]'::jsonb)
      from (select path, count(*) as n, round(avg(pct), 1) as avg_pct, max(abs(pct)) as max_abs
            from pct where abs(pct) >= 3 group by path having count(*) >= 3
            order by count(*) desc limit 15) g
    $f$, v_tbl) into v_changes using p_build_id, v_prev;

    v_out := v_out || jsonb_build_object(
      replace(v_tbl, 'codex_', ''),
      v_added || jsonb_build_object('stat_changes', v_changes));
  end loop;

  return v_out;
end;
$$;

revoke all on function public.codex_build_diff_digest(uuid) from public, anon, authenticated;
grant execute on function public.codex_build_diff_digest(uuid) to service_role;

comment on function public.codex_build_diff_digest(uuid) is
  'Compact diff of a codex build vs the previous finalized build of its channel (counts, a few names, numeric stat changes by payload path). Service role only; prompt input of codex-patch-summary.';

-- ---------------- C. RSI paint images ----------------
create table if not exists public.rsi_ship_paints (
  rsi_id        text primary key,                    -- RSI store SKU / skin id
  ship_name     text not null,                       -- RSI ship the paint belongs to ("Gladius")
  ship_norm     text not null,                       -- normalized ship name (lowercase a-z0-9) for matching
  class_name    text,                                -- codex_ships.class_name when the crawler matched one
  name          text not null,                       -- paint name ("Ghoulish Green")
  image_url     text not null,                       -- RSI-hosted https url; rows without an image are never stored
  rsi_url       text,                                -- store page of the paint
  released_at   timestamptz,                         -- RSI's own date when the payload carries one (recency)
  first_seen_at timestamptz not null default now(),  -- fallback recency: when the crawler first saw it
  updated_at    timestamptz not null default now(),
  constraint rsi_ship_paints_image_https check (image_url like 'https://%')
);

create index if not exists rsi_ship_paints_ship_idx on public.rsi_ship_paints (ship_norm);
create index if not exists rsi_ship_paints_class_idx on public.rsi_ship_paints (class_name) where class_name is not null;

alter table public.rsi_ship_paints enable row level security;

drop policy if exists rsi_ship_paints_public_read on public.rsi_ship_paints;
create policy rsi_ship_paints_public_read on public.rsi_ship_paints
  for select to anon, authenticated using (true);
-- No write policies: only the service role (rsi-paints-sync) writes.

comment on table public.rsi_ship_paints is
  'RSI store paints/skins per ship: URL + metadata only (no blobs). Crawled by rsi-paints-sync; recency = coalesce(released_at, first_seen_at).';
