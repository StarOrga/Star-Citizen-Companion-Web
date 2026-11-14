-- ============================================================
-- Codex: every upload is its own build, the live one is switched atomically
-- ============================================================
-- Root cause (live evidence 2026-11-14, build f99645d3 = LIVE 4.10.2 / 12913470):
-- `codex_builds` was keyed on (channel, patch_version, build_number) and so was
-- every catalog row. A second upload of the SAME game build (a newer uploader
-- re-extracting 4.10.2: 2026-11-08, -11, -12) `init`-ed the row that was already
-- live and wrote into it in place:
--   * during the upload the Codex served a mix of old and new rows, and
--     `clear_ports` / `clear_ingredients` emptied the live hardpoints and recipes
--     until the phase finished; an aborted run left that mix for good;
--   * rows the new extract no longer has were never removed (1 063 stale
--     manufacturers, 68 stale items in the live build);
--   * `set_current_codex_build` kept `finalized_at` (coalesce), so the derived
--     tables never followed: `codex_ship_fit_ports` still held the 2026-11-03
--     backfill (343 rows off; the Starlancer MAX lost its `battery` fit), and
--     `codex_build_changes` likewise;
--   * the build id never changed, so every client cache keyed on it (the rank
--     cohort in localStorage, the in-memory per-build caches, the live-build
--     revalidation that compares ids) kept the pre-upload numbers indefinitely.
--
-- From now on:
--   1. `init` of a build whose coordinates are already published creates a NEW
--      staging row (ingest-catalog). Catalog rows are keyed on (build_id, …).
--   2. Every write to a build-scoped table is recorded per (build, table) in
--      `codex_build_touched` (statement triggers), so the server knows which
--      phases a run uploaded and which it skipped (the uploader skips subthemes
--      its server ledger already holds for the same game build).
--   3. `finalize` first copies every table the run did not touch from the
--      published predecessor (`codex_clone_untouched`, in chunks: every RPC
--      runs under the authenticator's 8 s statement_timeout), then
--      `set_current_codex_build` refuses an incomplete build and, in one
--      transaction, marks the predecessor superseded and makes the new build
--      current. Readers never see a half-written build.
--   4. Staging and superseded builds are hidden from anon/authenticated (RLS);
--      superseded ones are no diff baseline and are deleted after an hour
--      (`codex-superseded-prune`).
--   5. The ~30 s changed-class-names refresh and the patch news leave the
--      finalize RPC (they were cancelled at 8 s there) for the cron job
--      `codex-derived-refresh`.
--
-- Additive except: the coordinate unique constraints on codex_builds and the
-- catalog tables are replaced by build_id ones (same columns otherwise), and the
-- redundant non-unique (build_id, class_name) indexes are dropped because the new
-- unique ones cover them. No data is dropped.
-- ============================================================

-- Fail fast instead of queueing behind a running upload (every Codex read would
-- queue behind this migration's ACCESS EXCLUSIVE locks in turn).
set local lock_timeout = '5s';

-- ── 1. codex_builds: superseded state, coordinates no longer unique ─────────
alter table public.codex_builds
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by uuid references public.codex_builds(id) on delete set null;

comment on column public.codex_builds.superseded_at is
  'Set when a later upload of the same channel/patch/build went live (set_current_codex_build). Hidden from clients, pruned after 1 h.';

alter table public.codex_builds drop constraint if exists codex_builds_channel_patch_build_key;
-- One PUBLISHED build per coordinates; staging rows (finalized_at null) may share them.
create unique index if not exists codex_builds_natkey_published
  on public.codex_builds (channel, patch_version, build_number)
  where finalized_at is not null and superseded_at is null;
create index if not exists codex_builds_natkey_idx
  on public.codex_builds (channel, patch_version, build_number);

-- ── 2. catalog rows keyed on the build id ───────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['manufacturers', 'ships', 'weapons', 'components', 'items', 'ammunition', 'blueprints'] loop
    execute format('alter table public.%I drop constraint if exists %I', 'codex_' || t || '_rows', 'codex_' || t || '_natkey');
    execute format('alter table public.%I add constraint %I unique (build_id, class_name)',
                   'codex_' || t || '_rows', 'codex_' || t || '_build_natkey');
    execute format('drop index if exists public.%I', 'codex_' || t || '_build_class_idx');
  end loop;
end $$;

alter table public.codex_silhouettes_rows drop constraint if exists codex_silhouettes_natkey;
alter table public.codex_silhouettes_rows
  add constraint codex_silhouettes_build_natkey unique (build_id, kind, class_name);
drop index if exists public.codex_silhouettes_kind_class_idx;

alter table public.codex_keybinds drop constraint if exists codex_keybinds_natkey;
alter table public.codex_keybinds
  add constraint codex_keybinds_build_natkey unique (build_id, actionmap, action_name);

-- The conflict target every catalog write uses (codex_upsert_rows, codex_carry_over).
create or replace function public.codex_carry_spec(p_table text, out base text, out key_cols text[], out conflict text, out volatile text[])
 returns record
 language plpgsql
 immutable
 set search_path to ''
as $function$
begin
  case p_table
    when 'codex_manufacturers', 'codex_ships', 'codex_weapons', 'codex_components',
         'codex_items', 'codex_ammunition', 'codex_blueprints' then
      base := p_table || '_rows';
      key_cols := array['class_name'];
      conflict := 'build_id, class_name';
      volatile := array[]::text[];   -- `source` is derived by the view now
    when 'codex_silhouettes' then
      base := 'codex_silhouettes_rows';
      key_cols := array['kind', 'class_name'];
      conflict := 'build_id, kind, class_name';
      volatile := array['meta.source'];
    else
      raise exception 'codex_carry_spec: table % is not carried', p_table using errcode = '22023';
  end case;
end $function$;

-- ── 3. which tables a run wrote ─────────────────────────────────────────────
create table if not exists public.codex_build_touched (
  build_id    uuid not null references public.codex_builds(id) on delete cascade,
  table_name  text not null,
  touched_at  timestamptz not null default now(),
  -- null = written by the upload run; set = copied from that build by codex_clone_untouched
  cloned_from uuid,
  primary key (build_id, table_name)
);
alter table public.codex_build_touched enable row level security;
-- No policy and no client grant: written by triggers, read by the definer functions below.
revoke all on public.codex_build_touched from anon, authenticated;

-- Where a chunked copy of one table stands (codex_clone_untouched).
create table if not exists public.codex_build_clone_progress (
  build_id        uuid not null references public.codex_builds(id) on delete cascade,
  table_name      text not null,
  source_build_id uuid not null,
  last_key        text,
  copied          bigint not null default 0,
  primary key (build_id, table_name)
);
alter table public.codex_build_clone_progress enable row level security;
revoke all on public.codex_build_clone_progress from anon, authenticated;

-- The build-scoped tables a staging build inherits from its predecessor when the
-- run did not upload them. Derived tables (fit ports, ammo, build changes) are
-- recomputed after the switch; locale strings live in R2 and are copied by
-- ingest-catalog. Mirrored by CLONE_TABLES in ingest-catalog/_rebuild.ts.
create or replace function public.codex_clone_tables()
 returns text[]
 language sql
 immutable
 set search_path to ''
as $function$
  select array[
    'codex_manufacturers_rows', 'codex_ships_rows', 'codex_weapons_rows', 'codex_components_rows',
    'codex_items_rows', 'codex_ammunition_rows', 'codex_blueprints_rows', 'codex_silhouettes_rows',
    'codex_item_ports', 'codex_blueprint_ingredients', 'codex_missions', 'codex_keybinds',
    'codex_silhouette_skips', 'codex_locations'
  ]::text[]
$function$;

-- Statement trigger: a write of the run marks the table. The copy itself
-- (codex.cloning = on) does not, so a half-finished copy stays "untouched".
create or replace function public.codex_build_touch_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if coalesce(current_setting('codex.cloning', true), '') = 'on' then
    return null;
  end if;
  insert into public.codex_build_touched (build_id, table_name)
  select distinct n.build_id, tg_table_name from new_rows n where n.build_id is not null
  on conflict (build_id, table_name) do nothing;
  return null;
end $function$;

do $$
declare
  t text;
begin
  foreach t in array public.codex_clone_tables() || array['codex_locale_strings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_ins', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch_upd', t);
    execute format('create trigger %I after insert on public.%I referencing new table as new_rows '
                   'for each statement execute function public.codex_build_touch_trg()', t || '_touch_ins', t);
    execute format('create trigger %I after update on public.%I referencing new table as new_rows '
                   'for each statement execute function public.codex_build_touch_trg()', t || '_touch_upd', t);
  end loop;
end $$;

-- ── 4. predecessor + chunked copy ───────────────────────────────────────────
-- The published build a staging build replaces: same coordinates, finalized,
-- not superseded. Null for the first upload of a game build.
create or replace function public.codex_build_predecessor(p_build_id uuid)
 returns uuid
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select p.id
    from public.codex_builds b
    join public.codex_builds p
      on p.channel = b.channel and p.patch_version = b.patch_version
     and p.build_number = b.build_number and p.id <> b.id
   where b.id = p_build_id and p.finalized_at is not null and p.superseded_at is null
   order by p.is_current desc, p.finalized_at desc
   limit 1
$function$;

-- Copies the predecessor's rows of ONE table into a staging build, at most
-- p_limit rows per call, unless the run wrote that table itself. Every RPC from
-- ingest-catalog runs under the authenticator's 8 s statement_timeout (a SET
-- clause on the function does not extend it, measured 2026-11-14), and the
-- whole items table took 24 s, so the caller loops until `done`. Keyset on the
-- source key; serialised per build (row lock); the progress row pins the
-- source, so a predecessor that changes mid-copy is refused, never mixed in.
create or replace function public.codex_clone_untouched(p_build_id uuid, p_table text, p_limit integer default 2000)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_build public.codex_builds%rowtype;
  v_from uuid;
  v_prog public.codex_build_clone_progress%rowtype;
  v_after text;
  v_cols text;
  v_key text;
  v_n integer := 0;
  v_last text;
begin
  if p_table is null or not (p_table = any(public.codex_clone_tables())) then
    raise exception 'codex_clone_untouched: table % is not cloned', p_table using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20000 then
    raise exception 'codex_clone_untouched: limit must be 1..20000' using errcode = '22023';
  end if;
  select * into v_build from public.codex_builds where id = p_build_id for update;
  if not found then
    raise exception 'codex_clone_untouched: unknown build %', p_build_id using errcode = '22023';
  end if;
  -- Only a staging build is filled; a published one is never written behind the reader's back.
  if v_build.finalized_at is not null then return jsonb_build_object('copied', 0, 'done', true); end if;
  v_from := public.codex_build_predecessor(p_build_id);
  if v_from is null then return jsonb_build_object('copied', 0, 'done', true); end if;
  if exists (select 1 from public.codex_build_touched x where x.build_id = p_build_id and x.table_name = p_table) then
    return jsonb_build_object('copied', 0, 'done', true);
  end if;

  select * into v_prog from public.codex_build_clone_progress
   where build_id = p_build_id and table_name = p_table;
  if found then
    if v_prog.source_build_id <> v_from then
      raise exception 'codex_build_superseded: the build % replaces changed from % to % while % was copied',
        p_build_id, v_prog.source_build_id, v_from, p_table;
    end if;
    v_after := v_prog.last_key;
  end if;

  v_key := case p_table when 'codex_silhouette_skips' then $k$(kind || '/' || class_name)$k$ else 'id::text' end;
  select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position) into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table
     and c.column_name <> 'build_id' and c.is_generated = 'NEVER'
     and not (c.column_name = 'id' and (c.column_default is not null or c.is_identity = 'YES'));

  perform set_config('codex.cloning', 'on', true);
  execute format($q$
    with src as materialized (
      select * from public.%1$I
       where build_id = $1 and ($3::text is null or %3$s > $3)
       order by %3$s
       limit $4
    ),
    ins as (
      insert into public.%1$I (build_id, %2$s) select $2, %2$s from src returning 1
    )
    select (select count(*) from ins)::integer, (select max(%3$s) from src)
  $q$, p_table, v_cols, v_key)
    into v_n, v_last
    using v_from, p_build_id, v_after, p_limit;
  perform set_config('codex.cloning', 'off', true);

  if v_n < p_limit then
    -- Done (an empty source counts as handled too).
    insert into public.codex_build_touched (build_id, table_name, cloned_from)
    values (p_build_id, p_table, v_from)
    on conflict (build_id, table_name) do nothing;
    delete from public.codex_build_clone_progress where build_id = p_build_id and table_name = p_table;
    return jsonb_build_object('copied', v_n, 'done', true);
  end if;
  insert into public.codex_build_clone_progress (build_id, table_name, source_build_id, last_key, copied)
  values (p_build_id, p_table, v_from, v_last, v_n)
  on conflict (build_id, table_name) do update
    set last_key = excluded.last_key, copied = public.codex_build_clone_progress.copied + excluded.copied;
  return jsonb_build_object('copied', v_n, 'done', false);
end $function$;

revoke all on function public.codex_build_predecessor(uuid) from public, anon, authenticated;
revoke all on function public.codex_clone_untouched(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.codex_build_touch_trg() from public, anon, authenticated;
grant execute on function public.codex_build_predecessor(uuid) to service_role;
grant execute on function public.codex_clone_untouched(uuid, text, integer) to service_role;

-- ── 5. the atomic switch ────────────────────────────────────────────────────
-- Must stay well inside the 8 s RPC budget: only the reverse lookups (~1 s) run
-- here; the changed-class-names refresh (~30 s) and the patch news are done by
-- the cron job codex-derived-refresh (section 7).
create or replace function public.set_current_codex_build(p_build_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_build public.codex_builds%rowtype;
  v_prev uuid;
  v_was_final boolean;
  v_missing text;
  v_seeded jsonb;
  v_pair text[];
  v_have bigint;
  v_want bigint;
begin
  select * into v_build from public.codex_builds where id = p_build_id for update;
  if not found then
    raise exception 'codex build % not found', p_build_id;
  end if;
  -- One switch per game build at a time: a second finalize of the same
  -- coordinates waits here and then sees the first one as its predecessor.
  perform pg_advisory_xact_lock(hashtextextended(
    'codex_switch|' || v_build.channel || '|' || v_build.patch_version || '|' || v_build.build_number, 0));
  select * into v_build from public.codex_builds where id = p_build_id;
  if v_build.superseded_at is not null then
    raise exception 'codex_build_superseded: % was replaced by %', p_build_id, v_build.superseded_by;
  end if;
  v_was_final := v_build.finalized_at is not null;

  if not v_was_final then
    v_prev := public.codex_build_predecessor(p_build_id);

    if v_prev is not null then
      -- Copied from a build that has been replaced since: the copy is stale.
      if exists (select 1 from public.codex_build_touched x
                  where x.build_id = p_build_id and x.cloned_from is not null and x.cloned_from <> v_prev) then
        raise exception 'codex_build_superseded: % was replaced while % was finalizing, upload again', v_prev, p_build_id;
      end if;
      -- A re-upload must hold every table: uploaded by the run or copied from v_prev.
      select string_agg(t, ', ' order by t) into v_missing
        from unnest(public.codex_clone_tables()) t
       where not exists (select 1 from public.codex_build_touched x
                          where x.build_id = p_build_id and x.table_name = t);
      if v_missing is not null then
        raise exception 'codex_build_incomplete: neither uploaded nor carried over: %', v_missing;
      end if;
    end if;

    if not exists (select 1 from public.codex_ships_rows where build_id = p_build_id) then
      raise exception 'codex_build_incomplete: no ships';
    end if;

    -- What the uploader says it sent must be there (2 % slack for duplicate keys).
    v_seeded := v_build.entity_counts -> 'seeded';
    if jsonb_typeof(v_seeded) = 'object' then
      foreach v_pair slice 1 in array array[
        ['ships', 'codex_ships_rows'], ['items', 'codex_items_rows'], ['weapons', 'codex_weapons_rows'],
        ['components', 'codex_components_rows'], ['ammunition', 'codex_ammunition_rows'],
        ['blueprints', 'codex_blueprints_rows'], ['manufacturers', 'codex_manufacturers_rows'],
        ['item_ports', 'codex_item_ports'], ['blueprint_ingredients', 'codex_blueprint_ingredients'],
        ['missions', 'codex_missions'], ['keybinds', 'codex_keybinds']
      ] loop
        if coalesce(v_seeded ->> v_pair[1], '') ~ '^[0-9]+$' then
          v_want := (v_seeded ->> v_pair[1])::bigint;
          execute format('select count(*) from public.%I where build_id = $1', v_pair[2])
            into v_have using p_build_id;
          if v_have < floor(v_want * 0.98) then
            raise exception 'codex_build_incomplete: % has % of % rows', v_pair[1], v_have, v_want;
          end if;
        end if;
      end loop;
    end if;

    if v_prev is not null then
      -- Before the new build is finalized: the published-natkey index allows one.
      update public.codex_builds
         set superseded_at = now(), superseded_by = p_build_id, is_current = false
       where id = v_prev;
      -- Same game build: keep its KI patch summary instead of generating another.
      update public.codex_builds b
         set patch_summary = p.patch_summary
        from public.codex_builds p
       where b.id = p_build_id and p.id = v_prev and b.patch_summary is null;
    end if;
  end if;

  update public.codex_builds set is_current = false
    where channel = v_build.channel and is_current and id <> p_build_id;
  -- AUD-113: finalize marks the build as finished for prune_codex_builds. The
  -- reverse-lookup trigger on finalized_at fills the new build's fit ports.
  update public.codex_builds
    set is_current = true, finalized_at = coalesce(finalized_at, now())
    where id = p_build_id;

  -- A published build written in place (an uploader resuming an old job, a seed
  -- script): its derived tables must follow the rows; the triggers do not fire.
  if v_was_final then
    perform public.codex_refresh_reverse_lookups(p_build_id);
    delete from public.codex_build_changes_done where build_id = p_build_id;  -- the cron job recomputes
  end if;
end
$function$;

-- ── 6. retention: superseded builds go after an hour ────────────────────────
create or replace function public.prune_superseded_codex_builds(p_grace interval default interval '1 hour')
 returns table(build_id uuid, channel text, patch_version text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return query
  delete from public.codex_builds d
   where d.superseded_at is not null and not d.is_current
     and d.superseded_at < now() - coalesce(p_grace, interval '1 hour')
  returning d.id, d.channel, d.patch_version;
end
$function$;
revoke all on function public.prune_superseded_codex_builds(interval) from public, anon, authenticated;
grant execute on function public.prune_superseded_codex_builds(interval) to service_role;

create or replace function public.prune_codex_builds(p_keep integer default 3)
 returns table(build_id uuid, channel text, patch_version text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_keep is null or p_keep < 1 then
    raise exception 'prune_codex_builds: p_keep must be >= 1 (got %)', p_keep;
  end if;

  return query
  with eligible as (
    select b.id, b.channel, b.patch_version, b.is_current, b.created_at
    from public.codex_builds b
    where (b.finalized_at is not null or b.is_current) and b.superseded_at is null
  ),
  ranked as (
    select e.*, row_number() over (partition by e.channel order by e.created_at desc) as rn
    from eligible e
  ),
  -- The patch "new in" is measured for: the current build's, else the channel's newest.
  head as (
    select distinct on (r.channel) r.channel, r.patch_version
    from ranked r
    order by r.channel, r.is_current desc, r.created_at desc
  ),
  -- Its diff baseline: the newest eligible build of any other patch.
  baseline as (
    select distinct on (r.channel) r.id
    from ranked r
    join head h on h.channel = r.channel
    where r.patch_version is distinct from h.patch_version
    order by r.channel, r.created_at desc
  ),
  doomed as (
    select r.id from ranked r
    where r.rn > p_keep and not r.is_current
      and r.id not in (select id from baseline)
    union
    select b.id from public.codex_builds b
    where b.finalized_at is null and not b.is_current
      and b.created_at < now() - interval '7 days'
    union
    select b.id from public.codex_builds b
    where b.superseded_at is not null and not b.is_current
      and b.superseded_at < now() - interval '1 hour'
  )
  delete from public.codex_builds d
  using doomed x
  where d.id = x.id
  returning d.id, d.channel, d.patch_version;
end
$function$;

select cron.schedule(
  'codex-superseded-prune',
  '20 * * * *',
  $cron$ select count(*) from public.prune_superseded_codex_builds(interval '1 hour'); $cron$
);

-- ── 7. diff baselines never pick a superseded build ─────────────────────────
create or replace function public.codex_refresh_changed_class_names(p_build_id uuid, p_previous uuid default null::uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
 set statement_timeout to '120s'
as $function$
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
       and superseded_at is null and created_at < v_cur.created_at
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
$function$;

create or replace function public.codex_build_diff_digest(p_build_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '25s'
as $function$
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
    and finalized_at is not null and superseded_at is null and created_at < v_cur.created_at
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
$function$;

-- ── 7b. derived tables outside the RPC budget ───────────────────────────────
-- The changed-class-names refresh takes ~30 s per build; inside the finalize
-- RPC (8 s budget) it was cancelled, and with it the whole switch. The trigger
-- no longer computes; a cron job fills what is missing for every current build
-- within two minutes, including the "new / changed in patch X" records that
-- ingest-catalog used to request after finalize (also cancelled at 8 s).
create or replace function public.codex_builds_changed_class_names_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Deferred to codex_refresh_pending_derived() (cron codex-derived-refresh).
  return new;
end;
$function$;

create or replace function public.codex_refresh_pending_derived()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  b record;
  v_prev uuid;
  v_other uuid;
  v_n integer := 0;
begin
  for b in select id, channel, patch_version, created_at from public.codex_builds
            where is_current and finalized_at is not null and superseded_at is null loop
    -- The default diff baseline (the build before it in the channel).
    select id into v_prev from public.codex_builds
     where channel = b.channel and id <> b.id and finalized_at is not null
       and superseded_at is null and created_at < b.created_at
     order by created_at desc limit 1;
    if v_prev is not null and not exists (select 1 from public.codex_build_changes_done d
                                           where d.build_id = b.id and d.previous_build_id = v_prev) then
      perform public.codex_refresh_changed_class_names(b.id, v_prev);
      v_n := v_n + 1;
    end if;
    -- Patch news: first-seen + changed versus the newest build of another patch.
    select id into v_other from public.codex_builds
     where channel = b.channel and id <> b.id and finalized_at is not null and superseded_at is null
       and patch_version <> b.patch_version and created_at < b.created_at
     order by created_at desc limit 1;
    if v_other is not null and not exists (select 1 from public.codex_build_changes_done d
                                            where d.build_id = b.id and d.previous_build_id = v_other) then
      perform public.codex_record_patch_news(b.id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$function$;
revoke all on function public.codex_refresh_pending_derived() from public, anon, authenticated;
grant execute on function public.codex_refresh_pending_derived() to service_role;

select cron.schedule(
  'codex-derived-refresh',
  '*/2 * * * *',
  $cron$ select public.codex_refresh_pending_derived(); $cron$
);

-- ── 8. clients only ever see published, current-generation builds ───────────
-- A staging build (finalized_at null) is half written; a superseded one has
-- been replaced. A tab still on a superseded build learns from
-- CodexService.buildStillExists that it is gone and moves to the live one (its
-- rows stay readable until the prune).
alter policy codex_builds_anon_read on public.codex_builds
  using (finalized_at is not null and superseded_at is null);
alter policy codex_builds_authenticated_read on public.codex_builds
  using (finalized_at is not null and superseded_at is null);

-- ── 9. the live build of 2026-11-14 catches up with its rows ────────────────
-- Its derived tables were computed before the in-place re-uploads. The reverse
-- lookups take ~1 s and run here; for the changed class names only the "done"
-- marker goes, codex-derived-refresh recomputes them outside this transaction
-- (which holds ACCESS EXCLUSIVE on the catalog tables).
do $$
declare
  b uuid;
begin
  for b in select id from public.codex_builds where is_current and finalized_at is not null loop
    perform public.codex_refresh_reverse_lookups(b);
    delete from public.codex_build_changes_done where build_id = b;
  end loop;
end $$;
