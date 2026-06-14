-- 20260614000000 · Bundle supersede-on-higher-tool-version + retention caps
--
-- Problem: ingest_bundle_atomic did a plain INSERT; the UNIQUE
-- (channel, patch_version, build_number, uploaded_by) constraint turned any
-- re-upload of the same (channel/patch/build) by the same operator into a hard
-- 409 "duplicate" — even when the uploader TOOL had a higher version that
-- extracts more / corrected / better-prepared data from the same game build.
--
-- Fix:
--   1. A strictly-higher semver tool_version now SUPERSEDES the existing active
--      bundle: the old row is marked disabled (reason 'superseded by tool …',
--      kept visible under the history toggle for admin rollback), the new row
--      becomes active. Equal/lower tool_version still returns 409.
--   2. Retention: keep at most the newest 3 tool-versions per
--      (channel, patch_version, build_number, uploaded_by); and never store more
--      than 20 bundles total — prune the oldest (disabled/superseded first,
--      then oldest active).
--
-- The UNIQUE constraint is replaced by a PARTIAL unique index over active
-- (disabled = false) rows, so superseded history rows can coexist with the one
-- live row per key.

-- ============================================================
-- 1. Replace UNIQUE-constraint with a partial-unique-on-active index
-- ============================================================
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'p4k_bundles_channel_patch_build_uploader_key'
  ) then
    alter table public.p4k_bundles
      drop constraint p4k_bundles_channel_patch_build_uploader_key;
  end if;
end $$;

create unique index if not exists p4k_bundles_active_unique
  on public.p4k_bundles (channel, patch_version, build_number, uploaded_by)
  where disabled = false;

-- ============================================================
-- 2. Semver compare helpers (major.minor.patch; pre-release/build stripped,
--    null/garbage → 0.0.0 so anything real outranks an unknown version)
-- ============================================================
create or replace function public.tool_version_key(v text)
returns int[]
language plpgsql immutable as $func$
declare
  core text;
begin
  -- drop +build metadata and -prerelease suffix, keep the numeric core
  core := split_part(split_part(coalesce(v, ''), '+', 1), '-', 1);
  return array[
    coalesce(nullif(regexp_replace(split_part(core, '.', 1), '[^0-9]', '', 'g'), '')::int, 0),
    coalesce(nullif(regexp_replace(split_part(core, '.', 2), '[^0-9]', '', 'g'), '')::int, 0),
    coalesce(nullif(regexp_replace(split_part(core, '.', 3), '[^0-9]', '', 'g'), '')::int, 0)
  ];
end;
$func$;

create or replace function public.tool_version_newer(p_new text, p_existing text)
returns boolean
language sql immutable as $func$
  select public.tool_version_key(p_new) > public.tool_version_key(p_existing);
$func$;

-- ============================================================
-- 3. ingest_bundle_atomic — supersede + retention
--    (return signature gains superseded_id → must DROP + CREATE)
-- ============================================================
drop function if exists public.ingest_bundle_atomic(
  uuid, public.p4k_channel, text, text, int, numeric, jsonb, jsonb, text
);

create function public.ingest_bundle_atomic(
  p_uploader uuid,
  p_channel public.p4k_channel,
  p_patch_version text,
  p_build_number text,
  p_schema_version int,
  p_quality_score numeric,
  p_entity_counts jsonb,
  p_manifest jsonb,
  p_tool_version text
)
returns table (
  bundle_id uuid,
  prev_bundle_id uuid,
  superseded_id uuid,
  diff_summary jsonb
)
language plpgsql security definer set search_path = public as $func$
declare
  v_lock_key bigint;
  v_new_id uuid;
  v_prev_id uuid;
  v_diff jsonb;
  v_existing_id uuid;
  v_existing_tv text;
  v_superseded_id uuid;
begin
  -- The edge function calls this with the service-role key AFTER validating the
  -- user's JWT + collaborator role + release token. Allow the service-role
  -- caller through; still gate *direct* authenticated RPC calls (defense in
  -- depth) so a non-collaborator can't insert bundles bypassing the function.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role'
     and not public.is_collaborator() then
    raise exception 'forbidden: collaborator role required';
  end if;

  -- Serialize uploads within (channel, patch_version) family.
  v_lock_key := hashtextextended(p_channel::text || '|' || p_patch_version, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  -- Is there an active bundle for this exact (channel, patch, build, uploader)?
  select id, tool_version into v_existing_id, v_existing_tv
  from public.p4k_bundles
  where channel = p_channel
    and patch_version = p_patch_version
    and build_number = p_build_number
    and uploaded_by = p_uploader
    and disabled = false
  limit 1;

  if v_existing_id is not null then
    if public.tool_version_newer(p_tool_version, v_existing_tv) then
      -- Strictly higher tool version → supersede: retire the old active row
      -- (kept as history for rollback), then insert the new active row.
      update public.p4k_bundles
      set disabled = true,
          disabled_reason = 'superseded by tool ' || coalesce(nullif(p_tool_version, ''), '?'),
          disabled_by = p_uploader,
          disabled_at = now()
      where id = v_existing_id;
      v_superseded_id := v_existing_id;
    else
      -- Same or lower tool version → genuine duplicate; keep the better one.
      raise exception 'duplicate: a bundle with an equal or newer uploader version already exists'
        using errcode = '23505';
    end if;
  end if;

  -- Diff baseline: latest active bundle of same channel+patch, different build.
  select id into v_prev_id
  from public.p4k_bundles
  where channel = p_channel
    and patch_version = p_patch_version
    and build_number <> p_build_number
    and disabled = false
  order by created_at desc
  limit 1;

  -- Insert the new active row (partial-unique-on-active index now satisfied,
  -- since any same-key active row was just disabled above).
  insert into public.p4k_bundles (
    uploaded_by, channel, patch_version, build_number, schema_version,
    quality_score, entity_counts, manifest, tool_version
  ) values (
    p_uploader, p_channel, p_patch_version, p_build_number, p_schema_version,
    p_quality_score, p_entity_counts, p_manifest, p_tool_version
  )
  returning id into v_new_id;

  if v_prev_id is not null then
    v_diff := public.diff_bundle(v_prev_id, v_new_id);
    update public.p4k_bundles set diff_summary = v_diff where id = v_new_id;
  end if;

  -- Retention 1 — per key: keep only the newest 3 tool-versions for this exact
  -- (channel, patch, build, uploader); drop older superseded history.
  delete from public.p4k_bundles
  where id in (
    select id from public.p4k_bundles
    where channel = p_channel
      and patch_version = p_patch_version
      and build_number = p_build_number
      and uploaded_by = p_uploader
    order by created_at desc, id
    offset 3
  );

  -- Retention 2 — global cap of 20 rows: keep the freshest active, prune the
  -- rest (disabled/superseded first via `disabled asc`, then oldest).
  delete from public.p4k_bundles
  where id in (
    select id from public.p4k_bundles
    order by disabled asc, created_at desc, id
    offset 20
  );

  return query select v_new_id, v_prev_id, v_superseded_id, v_diff;
end
$func$;

grant execute on function public.ingest_bundle_atomic(
  uuid, public.p4k_channel, text, text, int, numeric, jsonb, jsonb, text
) to authenticated;
