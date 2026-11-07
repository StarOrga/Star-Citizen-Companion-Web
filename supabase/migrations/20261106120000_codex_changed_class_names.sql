-- ============================================================
-- 20261106120000_codex_changed_class_names.sql
-- "aktualisiert" next to "neu": which items a patch CHANGED (bundle B4).
--
-- WHAT
--   codex_changed_class_names(p_kind, p_current, p_previous) -> setof text:
--   class names present in BOTH builds whose NUMERIC payload leaves differ,
--   for one kind (ship | weapon | component | item), ordered by class_name.
--   Sibling of codex_added_class_names (same signature, same grants).
--
-- SEMANTICS
--   * Same walk as codex_build_diff_digest: object keys only (arrays are not
--     entered), depth <= 4, non-variant rows only. A row counts as changed when
--     at least one path is a number in both builds with a different numeric
--     value (1.0 = 1). Text, description and structure-only changes are NOT
--     "changed" - that would be noise. The volatile build stamp
--     (payload.source) is skipped.
--   * ship: same default browse filters as codex_added_class_names.
--   * Unknown kind, or a build pair that was never computed -> empty set.
--
-- WHY PRECOMPUTED (measured 2026-11-06 on prod, anon, rolled back)
--   Computing it live reads two payload blobs per row (TOASTed). Under the real
--   anon role (3 s statement timeout) the live version took 2.4 s for
--   components even when NOTHING differed, and timed out for ships, weapons and
--   items. So the answer is filled ONCE per build pair and the RPC only reads a
--   small indexed table - same pattern as 20261103200000 (reverse lookups):
--     - when a build is finalized (trigger on codex_builds.finalized_at),
--     - for the newest finalized build of every channel (vs its predecessor) here.
--   The previous build is the newest finalized build of the same channel that
--   was created before it. Rows are skipped cheaply when both sides carry the
--   same content_sha (hash without build stamp, 20261102000000); a NULL sha
--   falls back to comparing the payloads.
--
-- SECURITY
--   Tables: RLS on, select for anon + authenticated (public catalog data), no
--   write policy. Refresh function: SECURITY DEFINER, granted to nobody but the
--   trigger/owner. RPC: SECURITY INVOKER, STABLE, pinned search_path. A failing
--   refresh never blocks finalizing a build (warning only).
--
-- Purely additive: no existing table, policy or function changes.
-- ROLLBACK: drop trigger if exists codex_builds_changed_class_names on public.codex_builds;
--           drop function if exists public.codex_builds_changed_class_names_trg();
--           drop function if exists public.codex_changed_class_names(text, uuid, uuid);
--           drop function if exists public.codex_refresh_changed_class_names(uuid);
--           drop table if exists public.codex_build_changes, public.codex_build_changes_done;
-- After a real push run: notify pgrst, 'reload schema';
-- ============================================================

create table if not exists public.codex_build_changes_done (
  build_id          uuid not null references public.codex_builds (id) on delete cascade,
  previous_build_id uuid not null references public.codex_builds (id) on delete cascade,
  computed_at       timestamptz not null default now(),
  primary key (build_id, previous_build_id)
);

create table if not exists public.codex_build_changes (
  build_id          uuid not null references public.codex_builds (id) on delete cascade,
  previous_build_id uuid not null references public.codex_builds (id) on delete cascade,
  kind              text not null check (kind in ('ship', 'weapon', 'component', 'item')),
  class_name        text not null,
  primary key (build_id, previous_build_id, kind, class_name)
);

alter table public.codex_build_changes_done enable row level security;
alter table public.codex_build_changes enable row level security;

drop policy if exists codex_build_changes_done_read on public.codex_build_changes_done;
create policy codex_build_changes_done_read on public.codex_build_changes_done
  for select to anon, authenticated using (true);
drop policy if exists codex_build_changes_read on public.codex_build_changes;
create policy codex_build_changes_read on public.codex_build_changes
  for select to anon, authenticated using (true);

grant select on public.codex_build_changes_done, public.codex_build_changes to anon, authenticated;

comment on table public.codex_build_changes is
  'Per build pair and kind: class names present in both builds whose numeric payload leaves differ. Filled by codex_refresh_changed_class_names.';

-- Numeric leaves of a payload as {"<path>": number}: object keys only, up to 4
-- levels (same reach as codex_build_diff_digest), without the volatile build
-- stamp payload.source. Flat laterals instead of a recursive CTE: no subtree
-- copy per row (the recursive version timed out on ships).
create or replace function public.codex_numeric_leaves(j jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $func$
  with l1 as (select e.key as p, e.value as v from jsonb_each(case when jsonb_typeof(j) = 'object' then j - 'source' else '{}'::jsonb end) e),
       l2 as (select l1.p || '.' || e.key as p, e.value as v from l1, jsonb_each(case when jsonb_typeof(l1.v) = 'object' then l1.v else '{}'::jsonb end) e),
       l3 as (select l2.p || '.' || e.key as p, e.value as v from l2, jsonb_each(case when jsonb_typeof(l2.v) = 'object' then l2.v else '{}'::jsonb end) e),
       l4 as (select l3.p || '.' || e.key as p, e.value as v from l3, jsonb_each(case when jsonb_typeof(l3.v) = 'object' then l3.v else '{}'::jsonb end) e)
  select coalesce(jsonb_object_agg(p, v), '{}'::jsonb)
    from (select p, v from l1 union all select p, v from l2 union all select p, v from l3 union all select p, v from l4) u
   where jsonb_typeof(v) = 'number'
$func$;

-- Fill one build pair (service/trigger only). Idempotent: replaces the pair.
create or replace function public.codex_refresh_changed_class_names(p_build_id uuid, p_previous uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '120s'
as $func$
declare
  v_cur public.codex_builds%rowtype;
  v_prev uuid := p_previous;
  v_kind text;
  v_tbl text;
  v_ship text;
begin
  select * into v_cur from public.codex_builds where id = p_build_id;
  if not found then return; end if;
  if v_prev is null then
    select id into v_prev from public.codex_builds
     where channel = v_cur.channel and id <> v_cur.id and finalized_at is not null
       and created_at < v_cur.created_at
     order by created_at desc limit 1;
  end if;
  if v_prev is null then return; end if;

  delete from public.codex_build_changes where build_id = p_build_id and previous_build_id = v_prev;

  foreach v_kind in array array['ship', 'weapon', 'component', 'item'] loop
    v_tbl := case v_kind when 'ship' then 'codex_ships' when 'weapon' then 'codex_weapons'
                         when 'component' then 'codex_components' else 'codex_items' end;
    v_ship := '';
    if v_kind = 'ship' then
      v_ship := $s$
        and (cur.name_localized is null or cur.name_localized not like '!%')
        and cur.class_name not ilike 'SalvageableDebris%'
        and cur.class_name not ilike 'Orbital_Sentry%'
        and cur.class_name not ilike 'probe_%'
        and (prv.name_localized is null or prv.name_localized not like '!%')
      $s$;
    end if;

    execute format($f$
      insert into public.codex_build_changes (build_id, previous_build_id, kind, class_name)
      select $1, $2, $3, cur.class_name
        from public.%1$I cur
        join public.%1$I prv on prv.class_name = cur.class_name and prv.build_id = $2 and not prv.is_variant
       cross join lateral (select public.codex_numeric_leaves(cur.payload) as a,
                                  public.codex_numeric_leaves(prv.payload) as b) x
       where cur.build_id = $1 and not cur.is_variant and cur.class_name is not null
         and (cur.content_sha is null or prv.content_sha is null or cur.content_sha <> prv.content_sha)
         %2$s
         and exists (select 1 from jsonb_each(x.a) ea join jsonb_each(x.b) eb using (key)
                      where ea.value <> eb.value)
    $f$, v_tbl, v_ship) using p_build_id, v_prev, v_kind;
  end loop;

  insert into public.codex_build_changes_done (build_id, previous_build_id)
  values (p_build_id, v_prev)
  on conflict (build_id, previous_build_id) do update set computed_at = now();
end;
$func$;

revoke all on function public.codex_refresh_changed_class_names(uuid, uuid) from public, anon, authenticated;

create or replace function public.codex_builds_changed_class_names_trg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
begin
  if new.finalized_at is not null and (tg_op = 'INSERT' or old.finalized_at is distinct from new.finalized_at) then
    begin
      perform public.codex_refresh_changed_class_names(new.id);
    exception when others then
      raise warning 'codex_refresh_changed_class_names(%) failed: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$func$;

revoke all on function public.codex_builds_changed_class_names_trg() from public, anon, authenticated;

drop trigger if exists codex_builds_changed_class_names on public.codex_builds;
create trigger codex_builds_changed_class_names
  after insert or update of finalized_at on public.codex_builds
  for each row execute function public.codex_builds_changed_class_names_trg();

-- The public read: a plain indexed lookup, no payload.
create or replace function public.codex_changed_class_names(
  p_kind     text,
  p_current  uuid,
  p_previous uuid
) returns setof text
language sql
stable
security invoker
set search_path = public, pg_temp
as $func$
  select c.class_name
    from public.codex_build_changes c
   where c.build_id = p_current and c.previous_build_id = p_previous and c.kind = p_kind
   order by c.class_name
$func$;

revoke all on function public.codex_changed_class_names(text, uuid, uuid) from public;
grant execute on function public.codex_changed_class_names(text, uuid, uuid) to anon, authenticated;

comment on function public.codex_changed_class_names(text, uuid, uuid) is
  'Class names in both builds whose numeric payload leaves (object keys, depth <= 4, non-variant) differ - the "updated this patch" set next to codex_added_class_names. Reads the precomputed codex_build_changes.';

-- Backfill: the newest finalized build of every channel vs its predecessor (the pair the
-- app diffs). Best-effort per build so one failure cannot abort the migration.
do $backfill$
declare r record;
begin
  for r in
    select id from (
      select id, row_number() over (partition by channel order by created_at desc) rn
        from public.codex_builds where finalized_at is not null
    ) s where rn <= 1
  loop
    begin
      perform public.codex_refresh_changed_class_names(r.id);
    exception when others then
      raise warning 'backfill codex_refresh_changed_class_names(%) failed: %', r.id, sqlerrm;
    end;
  end loop;
end
$backfill$;
