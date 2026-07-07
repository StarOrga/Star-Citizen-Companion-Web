-- 20260707120000 · Bundle "superseded" is history, not moderation
--
-- Problem: when a strictly-higher tool version re-uploads the same
-- (channel, patch, build), ingest_bundle_atomic retires the previous active row
-- with disabled = true + disabled_reason 'superseded by tool …'. The bundle
-- history RPC then hid those rows behind the admin-only include_disabled gate,
-- so the "history" toggle never revealed a user's earlier uploads — they looked
-- lost even though every upload is still stored.
--
-- Fix: give supersession its own marker (superseded_at), distinct from a manual
-- moderation disable. `disabled` STAYS true on supersede, so the
-- single-active-per-key invariant and every "active bundle" query
-- (disabled = false) are unchanged. The history RPC now treats superseded rows
-- as normal history — visible to any collaborator when include_history is on —
-- while genuine moderation disables (superseded_at IS NULL) stay admin-gated.
--
-- Alpha-phase note: additive only (new nullable column). No table drops.

-- 1. marker column ----------------------------------------------------------
alter table public.p4k_bundles
  add column if not exists superseded_at timestamptz;

comment on column public.p4k_bundles.superseded_at is
  'When this bundle was auto-retired by a newer tool-version upload of the same '
  '(channel, patch, build). NOT NULL => superseded history (still disabled = true, '
  'but surfaced by the history view); NULL + disabled => a manual moderation disable.';

-- backfill rows the previous ingest superseded (identified by the reason string)
update public.p4k_bundles
set superseded_at = coalesce(disabled_at, created_at)
where superseded_at is null
  and disabled = true
  and disabled_reason like 'superseded by tool%';

-- 2. ingest_bundle_atomic — stamp superseded_at when superseding -------------
-- Signature unchanged (CREATE OR REPLACE). Only the supersede UPDATE changes:
-- it now also sets superseded_at = now() alongside disabled = true.
create or replace function public.ingest_bundle_atomic(
  p_uploader uuid, p_channel p4k_channel, p_patch_version text, p_build_number text,
  p_schema_version integer, p_quality_score numeric, p_entity_counts jsonb,
  p_manifest jsonb, p_tool_version text)
 returns table(bundle_id uuid, prev_bundle_id uuid, superseded_id uuid, diff_summary jsonb)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
          disabled_at = now(),
          superseded_at = now()
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

  delete from public.p4k_bundles
  where id in (
    select id from public.p4k_bundles
    where channel = p_channel
      and patch_version = p_patch_version
      and build_number = p_build_number
    order by created_at desc, id
    offset 3
  );

  delete from public.p4k_bundles
  where id in (
    select id from public.p4k_bundles
    order by disabled asc, created_at desc, id
    offset 20
  );

  return query select v_new_id, v_prev_id, v_superseded_id, v_diff;
end
$function$;

-- 3. list_p4k_bundles_for_collaborator — superseded rows ARE history ---------
-- RETURNS TABLE gains superseded_at, so this must DROP + CREATE.
--
-- Visibility rules per row:
--   * active (disabled = false)                → always (subject to is_collaborator)
--   * superseded (superseded_at IS NOT NULL)   → when include_history (any collaborator)
--   * manual disable (disabled, superseded_at NULL) → only when include_disabled AND is_admin()
-- The history-off view collapses ACTIVE rows to one per (channel, patch, build).
drop function if exists public.list_p4k_bundles_for_collaborator(boolean, boolean);

create function public.list_p4k_bundles_for_collaborator(
  include_history boolean default false,
  include_disabled boolean default false)
 returns table(
   id uuid, channel p4k_channel, patch_version text, build_number text,
   schema_version integer, quality_score numeric, entity_counts jsonb,
   diff_summary jsonb, disabled boolean, disabled_reason text, tool_version text,
   uploaded_by_id uuid, uploaded_by_email text, uploaded_by_name text,
   created_at timestamp with time zone, superseded_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with effective as (
    select (include_disabled and public.is_admin()) as show_disabled
  ),
  filtered as (
    select b.*, u.email as ue, p.display_name as un
    from public.p4k_bundles b
    join auth.users u on u.id = b.uploaded_by
    left join public.profiles p on p.id = b.uploaded_by
    cross join effective
    where public.is_collaborator()
      and (
        b.disabled = false                                        -- active
        or (include_history and b.superseded_at is not null)      -- superseded = history
        or effective.show_disabled                                -- admin moderation view
      )
  ),
  distinct_latest as (
    -- collapse over the ACTIVE rows only — one current bundle per key
    select distinct on (channel, patch_version, build_number) *
    from filtered
    where disabled = false
    order by channel, patch_version, build_number, created_at desc
  )
  select id, channel, patch_version, build_number, schema_version,
         quality_score, entity_counts, diff_summary, disabled, disabled_reason,
         tool_version, uploaded_by as uploaded_by_id,
         ue as uploaded_by_email, un as uploaded_by_name, created_at, superseded_at
  from (
    select * from filtered where include_history
    union all
    select * from distinct_latest where not include_history
  ) merged
  order by created_at desc
$function$;

grant execute on function public.list_p4k_bundles_for_collaborator(boolean, boolean)
  to authenticated, service_role;
