-- ============================================================
-- 20260928231143_delete_paths_and_log_retention.sql
-- Make the delete paths work again, count only finished codex builds for
-- retention, and bound the two log tables (plan D02, option A).
--
-- WHY
--   AUD-005: hangar_ship_configs.source_config_id and
--     hangar_share_links.source_config_id reference hangar_ship_configs
--     ON DELETE SET NULL, and hangar_ship_configs.owner_user_id references
--     auth.users ON DELETE SET NULL. PostgreSQL runs those FK actions as
--     ordinary UPDATEs that fire row triggers, and the share / revoke guards
--     (20260920160000_hangar_loadout_sharing.sql) reject every change of those
--     columns. So deleting a config somebody shared or adopted, removing its
--     ship (cascade), and deleting an account that shared or follows a share
--     all failed with 42501.
--   AUD-108: p4k_bundles.disabled_by (00005_phase2_diff_disable_build.sql:11)
--     is the only FK to auth.users without an ON DELETE action; every
--     supersede writes the uploader into it, so deleting that collaborator
--     failed with a FK violation.
--   AUD-113: prune_codex_builds (20260925010000_codex_build_retention.sql)
--     ranks every codex_builds row, so a running or abandoned import counts as
--     one of the two kept builds and pushes the previous LIVE build out.
--     entity_counts cannot serve as a "finished" marker: it is
--     jsonb not null default '{}' and ingest-catalog already writes it at
--     `init`. Hence the new column finalized_at, set by set_current_codex_build.
--   AUD-319: api_request_log was promised an "autopurge cron"
--     (20260529_public_api_tokens.sql) that was never created.
--   AUD-344 (DB part): telemetry_events grows without bound.
--   AUD-321: the FK columns touched above have no index, so every FK action
--     scans the referencing table.
--
-- WHAT
--   A. share guard + revoke guard allow the one-way null the FK actions write
--      (a follower copy that loses its source forks irreversibly).
--   B. p4k_bundles.disabled_by re-added ON DELETE SET NULL.
--   C. codex_builds.finalized_at (+ one-time backfill), set_current_codex_build
--      sets it, prune_codex_builds counts finalized builds only and sweeps
--      never-finalized, non-current builds after 7 days.
--   D. pg_cron jobs api-request-log-purge (1 day) and
--      telemetry-events-retention (120 days) + api_request_log (ts) index.
--   E. indexes on the sharing FKs and on p4k_bundles.disabled_by.
--   The pin uniqueness of AUD-111 already exists (hangar_ships_pin_unique,
--   20260613000000_hangar.sql) and is NOT re-created here.
--
-- Alpha data policy: this file deletes data only through the new cron jobs —
--   api_request_log rows older than 1 day, telemetry_events rows older than
--   120 days, and never-finalized codex builds older than 7 days (re-extractable
--   catalog data). auth.users and profiles are untouched.
--
-- pg_cron is already enabled (20260906130000_patch_stability_cron.sql). Do NOT
-- repeat `create extension pg_cron` here (2BP01, see 20260925010000).
--
-- IDEMPOTENT: safe to re-run (create or replace, if-not-exists guards, the
--   finalized_at backfill runs only when the column is created, cron jobs are
--   unscheduled before they are scheduled).
--
-- ROLLBACK: per section, see the ROLLBACK line at the top of each section.
-- ============================================================

-- ============================================================
-- A. Share + revoke guards allow the FK action's one-way null (AUD-005)
--
-- Both functions are re-created from 20260920160000_hangar_loadout_sharing.sql
-- verbatim except for the marked AUD-005 parts; the triggers already point at
-- them and stay in place.
--
-- The guard cannot tell a FK action from a direct UPDATE. A recipient can
-- therefore null her own source_config_id herself — the same fork any own edit
-- triggers anyway — or null owner_user_id on her own row, which only drops the
-- "managed by ..." hint. Both are harmless; not tightened with
-- pg_trigger_depth() on purpose.
--
-- ROLLBACK: re-run the two function bodies from 20260920160000 (lines
--   158-212 and 299-321) and restore the old share-guard comment.
-- ============================================================
create or replace function public.hangar_ship_configs_share_guard()
returns trigger language plpgsql set search_path = public as $func$
declare
  v_internal boolean := coalesce(nullif(current_setting('hangar.internal_write', true), ''), 'off') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_internal then
      if new.owner_user_id is not null
         or new.source_config_id is not null
         or new.follows_owner is true
         or new.shared_channel is not null
         or new.shared_patch_version is not null
      then
        raise exception 'sharing columns are managed by adopt_shared_loadout only' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE'
  if not v_internal then
    if new.source_config_id is distinct from old.source_config_id then
      -- AUD-005: the one permitted change. The owner deleted the source config
      -- and the FK action `on delete set null` detaches this copy. A copy that
      -- lost its source cannot follow it any more: it forks, irreversibly.
      if old.source_config_id is not null and new.source_config_id is null then
        if old.follows_owner then
          new.follows_owner := false;
          new.forked_at := coalesce(old.forked_at, now());
        end if;
      else
        raise exception 'source_config_id is immutable' using errcode = '42501';
      end if;
    end if;
    -- AUD-005: owner_user_id references auth.users ON DELETE SET NULL too —
    -- deleting the sharer's account must not fail on the follower's row.
    if new.owner_user_id is distinct from old.owner_user_id
       and not (old.owner_user_id is not null and new.owner_user_id is null) then
      raise exception 'owner_user_id is immutable' using errcode = '42501';
    end if;
    if new.shared_channel is distinct from old.shared_channel then
      raise exception 'shared_channel is immutable' using errcode = '42501';
    end if;
    if new.shared_patch_version is distinct from old.shared_patch_version then
      raise exception 'shared_patch_version is immutable' using errcode = '42501';
    end if;
    if new.follows_owner and not old.follows_owner then
      raise exception 'follows_owner may not be re-enabled' using errcode = '42501';
    end if;

    if old.follows_owner and new.follows_owner
       and (new.name is distinct from old.name
            or new.role is distinct from old.role
            or new.loadout is distinct from old.loadout)
    then
      new.follows_owner := false;
      new.forked_at := now();
    end if;
  end if;

  return new;
end;
$func$;

comment on function public.hangar_ship_configs_share_guard() is
  'Wave 1.5 fix (redteam blocker 3): gates the sharing columns and auto-forks a followed config on the recipient''s own edit. See migration header for the hangar.internal_write GUC mechanism. AUD-005: one-way null via FK action allowed (source_config_id forks the copy, owner_user_id).';

create or replace function public.hangar_share_links_revoke_guard()
returns trigger language plpgsql set search_path = public as $func$
begin
  -- AUD-005: FK action `on delete set null` when the owner deletes the source
  -- config. Allowed only if literally nothing else on the row changes.
  if old.source_config_id is not null and new.source_config_id is null
     and (to_jsonb(new) - 'source_config_id') = (to_jsonb(old) - 'source_config_id') then
    return new;
  end if;

  if new.token is distinct from old.token
     or new.created_by is distinct from old.created_by
     or new.ship_class_name is distinct from old.ship_class_name
     or new.channel is distinct from old.channel
     or new.patch_version is distinct from old.patch_version
     or new.loadout is distinct from old.loadout
     or new.config_name is distinct from old.config_name
     or new.role is distinct from old.role
     or new.source_config_id is distinct from old.source_config_id
     or new.expires_at is distinct from old.expires_at
  then
    raise exception 'only revoked_at may be updated on a share link' using errcode = '42501';
  end if;
  if old.revoked_at is not null then
    raise exception 'share link already revoked' using errcode = '42501';
  end if;
  if new.revoked_at is null then
    raise exception 'revoked_at may only be set, never cleared' using errcode = '42501';
  end if;
  return new;
end;
$func$;

comment on function public.hangar_share_links_revoke_guard() is
  'Wave 1.5 (user decision 1): a share link is immutable except revoked_at (null -> timestamp, once). AUD-005: one-way null via FK action allowed (source_config_id only, nothing else on the row may change).';

-- ============================================================
-- B. p4k_bundles.disabled_by ON DELETE SET NULL (AUD-108)
--
-- The only FK to auth.users without an ON DELETE action. Every supersede
-- writes disabled_by = uploader, so deleting that collaborator failed with a
-- FK violation. Look the constraint up by definition (it is auto-named), drop
-- it, re-add it with ON DELETE SET NULL. Re-runnable: the lookup also finds
-- the constraint this block created. The column is already nullable.
--
-- ROLLBACK: alter table public.p4k_bundles drop constraint p4k_bundles_disabled_by_fkey;
--           alter table public.p4k_bundles add constraint p4k_bundles_disabled_by_fkey
--             foreign key (disabled_by) references auth.users (id);
-- ============================================================
do $$
declare v_con text;
begin
  for v_con in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.p4k_bundles'::regclass
      and c.contype = 'f'
      and a.attname = 'disabled_by'
  loop
    execute format('alter table public.p4k_bundles drop constraint %I', v_con);
  end loop;
end $$;

alter table public.p4k_bundles
  add constraint p4k_bundles_disabled_by_fkey
  foreign key (disabled_by) references auth.users (id) on delete set null;

-- ============================================================
-- C. Codex retention counts finalized builds only (AUD-113)
--
-- finalized_at is set by set_current_codex_build (ingest-catalog op
-- `finalize`, its only caller). NULL = import still running or abandoned.
-- The backfill runs only in the same run that creates the column, so a re-run
-- never marks a running import as finished.
--
-- ROLLBACK: re-run prune_codex_builds from 20260925010000 and
--   set_current_codex_build from 00008_codex_catalog.sql:324-340, then
--   alter table public.codex_builds drop column finalized_at;
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'codex_builds' and column_name = 'finalized_at'
  ) then
    alter table public.codex_builds add column finalized_at timestamptz;
    -- Every build that exists when this first runs counts as finished (see
    -- the pre-check in the D02 plan for a build newer than the current one).
    update public.codex_builds set finalized_at = coalesce(extracted_at, created_at);
  end if;
end $$;

comment on column public.codex_builds.finalized_at is
  'Set by set_current_codex_build (ingest-catalog finalize). NULL = import still running or abandoned — never counted by prune_codex_builds, swept after 7 days. A re-import of an already finalized build (init upserts on channel/patch_version/build_number) keeps its finalized_at: same data.';

create or replace function public.set_current_codex_build(p_build_id uuid)
returns void
language plpgsql security definer set search_path = public as $func$
declare
  v_channel text;
begin
  select channel into v_channel from public.codex_builds where id = p_build_id;
  if v_channel is null then
    raise exception 'codex build % not found', p_build_id;
  end if;
  update public.codex_builds set is_current = false
    where channel = v_channel and is_current and id <> p_build_id;
  -- AUD-113: finalize marks the build as finished for prune_codex_builds.
  update public.codex_builds
    set is_current = true, finalized_at = coalesce(finalized_at, now())
    where id = p_build_id;
end
$func$;

revoke all on function public.set_current_codex_build(uuid) from public, anon, authenticated;

-- Per channel, keeps the p_keep newest FINALIZED builds (plus the current
-- one, whatever its age); an unfinished build never counts and so never
-- pushes the previous LIVE build out. Never-finalized, non-current builds
-- older than 7 days are swept as abandoned imports. Columns are qualified
-- everywhere: channel / patch_version are also OUT parameters.
create or replace function public.prune_codex_builds(p_keep int default 2)
returns table (build_id uuid, channel text, patch_version text)
language plpgsql security definer set search_path = public as $func$
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
$func$;

revoke all on function public.prune_codex_builds(int) from public, anon, authenticated;
