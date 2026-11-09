-- ============================================================
-- 20261108220000_codex_patch_news.sql
-- "New / changed in patch X" as recorded facts, not a two-build diff (bundle B1a).
--
-- WHAT
--   codex_patch_first_seen  (kind, class_name) -> the patch a class name FIRST appeared in.
--                           first_patch NULL = baseline: it was already in the catalog when
--                           this table came to be, so its first patch is unknown. It is
--                           NEVER shown as "new in <current patch>".
--   codex_patch_changed     (patch_version, kind, class_name): class names whose numeric payload
--                           leaves changed in that patch versus the newest finalized build of the
--                           same channel from a DIFFERENT patch.
--   codex_record_patch_news(build_id)  service-role only; called by ingest-catalog finalize.
--   codex_patch_news(p_kind)           the public read (contract for the web).
--
-- WHY
--   The old "new" = names missing in the previous build. A re-upload of the same patch (or the
--   retention that keeps only two builds) made it reset or lie. Here a re-upload of a patch
--   inserts with ON CONFLICT DO NOTHING in both tables: nothing is ever reset.
--
-- SEMANTICS
--   * kind in ('ship','weapon','component','item') - the tables codex_ships / codex_weapons /
--     codex_components / codex_items. (Web kinds ammunition / manufacturer / blueprint have no
--     class-name diff today and return zero rows.) ship uses the default browse filters of
--     codex_added_class_names (no variants, no '!' names, no debris/sentry/probe).
--   * First record for a kind on an EMPTY first_seen table (fresh DB) is stored as baseline.
--   * "changed" reuses codex_refresh_changed_class_names(build, previous) (20261106120000).
--     Without a build of another patch to compare to, nothing is recorded.
--   * codex_patch_news(kind): rows of the patch_version of the current build (newest is_current),
--     status 'added' (first_patch = that patch) or 'changed' (an added name is not listed twice).
--     Zero rows when nothing is recorded for that patch -> the web falls back to its two-build diff.
--
-- SEED (alpha data policy: nothing dropped)
--   Every class name of every build in the catalog today is inserted as baseline. So 4.10.2
--   shows nothing recorded until the next patch is ingested.
--
-- SECURITY
--   Tables: RLS on, select for anon + authenticated, no write policy. Record function:
--   SECURITY DEFINER, executable by service_role only. Read RPC: SECURITY INVOKER, STABLE, an
--   indexed lookup on two small tables (no payload) - far below the anon 3 s timeout.
--
-- Purely additive.
-- ROLLBACK: drop function if exists public.codex_patch_news(text);
--           drop function if exists public.codex_record_patch_news(uuid);
--           drop table if exists public.codex_patch_first_seen, public.codex_patch_changed;
-- After a real push run: notify pgrst, 'reload schema';
-- ============================================================

create table if not exists public.codex_patch_first_seen (
  kind           text not null check (kind in ('ship', 'weapon', 'component', 'item')),
  class_name     text not null,
  first_patch    text,            -- NULL = baseline (first patch unknown)
  first_build_id uuid,            -- informational, no FK: builds are pruned
  recorded_at    timestamptz not null default now(),
  primary key (kind, class_name)
);
create index if not exists codex_patch_first_seen_patch_idx
  on public.codex_patch_first_seen (first_patch, kind) where first_patch is not null;

create table if not exists public.codex_patch_changed (
  patch_version text not null,
  kind          text not null check (kind in ('ship', 'weapon', 'component', 'item')),
  class_name    text not null,
  recorded_at   timestamptz not null default now(),
  primary key (patch_version, kind, class_name)
);

alter table public.codex_patch_first_seen enable row level security;
alter table public.codex_patch_changed enable row level security;
drop policy if exists codex_patch_first_seen_read on public.codex_patch_first_seen;
create policy codex_patch_first_seen_read on public.codex_patch_first_seen
  for select to anon, authenticated using (true);
drop policy if exists codex_patch_changed_read on public.codex_patch_changed;
create policy codex_patch_changed_read on public.codex_patch_changed
  for select to anon, authenticated using (true);
grant select on public.codex_patch_first_seen, public.codex_patch_changed to anon, authenticated;

comment on table public.codex_patch_first_seen is
  'Per kind and class name the patch it first appeared in; first_patch NULL = baseline (seeded, unknown). Never reset by a re-upload.';
comment on table public.codex_patch_changed is
  'Per patch and kind the class names whose numeric payload changed versus the previous patch. Insert-only.';

-- Seed: everything already in the catalog is baseline.
insert into public.codex_patch_first_seen (kind, class_name, first_patch)
select 'ship', class_name, null from public.codex_ships where class_name is not null group by class_name
on conflict do nothing;
insert into public.codex_patch_first_seen (kind, class_name, first_patch)
select 'weapon', class_name, null from public.codex_weapons where class_name is not null group by class_name
on conflict do nothing;
insert into public.codex_patch_first_seen (kind, class_name, first_patch)
select 'component', class_name, null from public.codex_components where class_name is not null group by class_name
on conflict do nothing;
insert into public.codex_patch_first_seen (kind, class_name, first_patch)
select 'item', class_name, null from public.codex_items where class_name is not null group by class_name
on conflict do nothing;

-- Record one finalized build. Idempotent; a re-run never resets anything.
create or replace function public.codex_record_patch_news(p_build_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '120s'
as $func$
declare
  v_cur public.codex_builds%rowtype;
  v_prev uuid;
  v_kind text;
  v_tbl text;
  v_ship text;
  v_added int := 0;
  v_changed int := 0;
  v_n int;
  v_empty boolean;
begin
  select * into v_cur from public.codex_builds where id = p_build_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown_build'); end if;

  foreach v_kind in array array['ship', 'weapon', 'component', 'item'] loop
    v_tbl := case v_kind when 'ship' then 'codex_ships' when 'weapon' then 'codex_weapons'
                         when 'component' then 'codex_components' else 'codex_items' end;
    v_ship := case when v_kind = 'ship' then $s$
        and not is_variant
        and (name_localized is null or name_localized not like '!%')
        and class_name not ilike 'SalvageableDebris%'
        and class_name not ilike 'Orbital_Sentry%'
        and class_name not ilike 'probe_%' $s$ else '' end;
    select not exists (select 1 from public.codex_patch_first_seen where kind = v_kind) into v_empty;

    execute format($f$
      insert into public.codex_patch_first_seen (kind, class_name, first_patch, first_build_id)
      select distinct $1, class_name, case when $4 then null else $2 end, case when $4 then null else $3 end
        from public.%1$I
       where build_id = $3 and class_name is not null %2$s
      on conflict (kind, class_name) do nothing
    $f$, v_tbl, v_ship) using v_kind, v_cur.patch_version, p_build_id, v_empty;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;

  -- changed: versus the newest finalized build of the channel from ANOTHER patch.
  select id into v_prev from public.codex_builds
   where channel = v_cur.channel and id <> v_cur.id and finalized_at is not null
     and patch_version <> v_cur.patch_version and created_at < v_cur.created_at
   order by created_at desc limit 1;
  if v_prev is not null then
    perform public.codex_refresh_changed_class_names(p_build_id, v_prev);
    insert into public.codex_patch_changed (patch_version, kind, class_name)
    select v_cur.patch_version, c.kind, c.class_name
      from public.codex_build_changes c
     where c.build_id = p_build_id and c.previous_build_id = v_prev
    on conflict do nothing;
    get diagnostics v_changed = row_count;
  end if;

  return jsonb_build_object('ok', true, 'patch', v_cur.patch_version, 'first_seen_inserted', v_added,
                            'changed_inserted', v_changed, 'compared_to', v_prev);
end;
$func$;

revoke all on function public.codex_record_patch_news(uuid) from public, anon, authenticated;
grant execute on function public.codex_record_patch_news(uuid) to service_role;

-- The public read.
create or replace function public.codex_patch_news(p_kind text)
returns table (class_name text, status text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $func$
  with cur as (
    select patch_version from public.codex_builds where is_current order by created_at desc limit 1
  ), added as (
    select f.class_name from public.codex_patch_first_seen f, cur
     where f.kind = p_kind and f.first_patch = cur.patch_version
  )
  select a.class_name, 'added'::text from added a
  union all
  select c.class_name, 'changed'::text from public.codex_patch_changed c, cur
   where c.kind = p_kind and c.patch_version = cur.patch_version
     and not exists (select 1 from added a where a.class_name = c.class_name)
  order by 2, 1
$func$;

revoke all on function public.codex_patch_news(text) from public;
grant execute on function public.codex_patch_news(text) to anon, authenticated;

comment on function public.codex_patch_news(text) is
  'Class names new (added) or changed in the patch of the current codex build, per kind (ship|weapon|component|item). Zero rows = nothing recorded for that patch; the web then diffs the two newest builds.';
