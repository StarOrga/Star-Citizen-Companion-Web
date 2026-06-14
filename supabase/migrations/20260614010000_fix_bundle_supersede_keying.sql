-- 20260614010000 · Fix bundle supersede keying — (channel, patch, build)
--
-- The previous migration (20260614000000) keyed supersede + the partial-unique
-- index on (channel, patch_version, build_number, uploaded_by) and tried to drop
-- the constraint `p4k_bundles_channel_patch_build_uploader_key`. But migration
-- 00006 (Codex MED-4) had ALREADY replaced that with
-- `p4k_bundles_channel_patch_build_key` UNIQUE (channel, patch_version,
-- build_number) — "first upload wins, regardless of uploader" — which is the
-- app's real identity (check-bundle + list_p4k_bundles_for_collaborator both key
-- on (channel, patch, build) WITHOUT uploaded_by).
--
-- Net effect of the bug: that NON-partial (channel, patch, build) constraint
-- survived, so the supersede path (disable old active row, insert new) threw
-- 23505 — a higher uploader tool_version still got HTTP 409 instead of
-- replacing. This migration re-keys everything to (channel, patch, build):
--   * drop the non-partial constraint,
--   * make the active-uniqueness a PARTIAL index on (channel, patch, build)
--     where disabled = false (so superseded history rows coexist),
--   * fix the RPC's existing-active lookup + per-build retention to drop
--     uploaded_by.

-- ============================================================
-- 1. Replace the non-partial (channel, patch, build) constraint with a
--    partial-unique-on-active index keyed the same way.
-- ============================================================
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'p4k_bundles_channel_patch_build_key'
  ) then
    alter table public.p4k_bundles
      drop constraint p4k_bundles_channel_patch_build_key;
  end if;
end $$;

-- Drop the mis-keyed (4-column, incl. uploaded_by) partial index from the
-- previous migration and recreate it on (channel, patch, build).
drop index if exists public.p4k_bundles_active_unique;

create unique index if not exists p4k_bundles_active_unique
  on public.p4k_bundles (channel, patch_version, build_number)
  where disabled = false;

-- ============================================================
-- 2. ingest_bundle_atomic — same signature, re-keyed to (channel, patch, build)
--    (no uploaded_by in the existing-active lookup or per-build retention).
-- ============================================================
create or replace function public.ingest_bundle_atomic(
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
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role'
     and not public.is_collaborator() then
    raise exception 'forbidden: collaborator role required';
  end if;

  v_lock_key := hashtextextended(p_channel::text || '|' || p_patch_version, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  -- The active bundle for this (channel, patch, build) — regardless of which
  -- collaborator uploaded it (one bundle per build, per 00006 MED-4).
  select id, tool_version into v_existing_id, v_existing_tv
  from public.p4k_bundles
  where channel = p_channel
    and patch_version = p_patch_version
    and build_number = p_build_number
    and disabled = false
  limit 1;

  if v_existing_id is not null then
    if public.tool_version_newer(p_tool_version, v_existing_tv) then
      update public.p4k_bundles
      set disabled = true,
          disabled_reason = 'superseded by tool ' || coalesce(nullif(p_tool_version, ''), '?'),
          disabled_by = p_uploader,
          disabled_at = now()
      where id = v_existing_id;
      v_superseded_id := v_existing_id;
    else
      raise exception 'duplicate: a bundle with an equal or newer uploader version already exists'
        using errcode = '23505';
    end if;
  end if;

  select id into v_prev_id
  from public.p4k_bundles
  where channel = p_channel
    and patch_version = p_patch_version
    and build_number <> p_build_number
    and disabled = false
  order by created_at desc
  limit 1;

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

  -- Retention 1 — per build: keep only the newest 3 tool-versions for this
  -- (channel, patch, build).
  delete from public.p4k_bundles
  where id in (
    select id from public.p4k_bundles
    where channel = p_channel
      and patch_version = p_patch_version
      and build_number = p_build_number
    order by created_at desc, id
    offset 3
  );

  -- Retention 2 — global cap of 20: keep freshest active, prune disabled/oldest.
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
