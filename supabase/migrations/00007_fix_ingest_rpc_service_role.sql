-- ============================================================
-- 00007_fix_ingest_rpc_service_role.sql
-- Fix desktop "Upload-Fehler: ingest_failed".
--
-- Root cause (confirmed via postgres logs — "forbidden: collaborator role
-- required" raised on every upload):
--   ingest_bundle_atomic() (migration 00006) starts with a defense-in-depth
--   `if not public.is_collaborator() then raise 'forbidden'` guard.
--   The ingest-bundle edge function calls this RPC with the SERVICE-ROLE key
--   (intentionally — to bypass RLS for the cross-user prev-bundle lookup and
--   the diff). Under the service-role key auth.uid() is NULL, so
--   current_user_role() falls back to 'viewer' and is_collaborator() returns
--   false → the guard always raises → the function returns ingest_failed (500).
--
--   The edge function ALREADY validates the caller's JWT + collaborator role +
--   release token before invoking the RPC, so the user-level gate is intact.
--
-- Fix: let the service-role caller through, but keep rejecting *direct*
-- authenticated RPC calls (a non-collaborator must not be able to insert a
-- bundle by calling the RPC directly and bypassing the edge function).
-- Only the guard changed; the rest of the body is identical to 00006.
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
  diff_summary jsonb
)
language plpgsql security definer set search_path = public as $func$
declare
  v_lock_key bigint;
  v_new_id uuid;
  v_prev_id uuid;
  v_diff jsonb;
begin
  -- The ingest-bundle edge function calls this RPC with the service-role key
  -- AFTER it has already validated the user's JWT + collaborator role +
  -- release token. Under the service-role key auth.uid() is NULL, so
  -- is_collaborator() would wrongly return false here. Allow the service-role
  -- caller through; still gate any *direct* authenticated RPC calls (defense
  -- in depth) so a non-collaborator can't insert bundles bypassing the function.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role'
     and not public.is_collaborator() then
    raise exception 'forbidden: collaborator role required';
  end if;

  -- Serialize uploads within (channel, patch_version) family so two
  -- concurrent builds can't both diff against the same prev_id.
  v_lock_key := hashtextextended(
    p_channel::text || '|' || p_patch_version,
    0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  -- Find the latest active bundle of this channel+patch, excluding the
  -- current build (so re-uploads of the same build under the new tighter
  -- UNIQUE constraint don't accidentally diff against themselves before the
  -- INSERT throws).
  select id into v_prev_id
  from public.p4k_bundles
  where channel = p_channel
    and patch_version = p_patch_version
    and build_number <> p_build_number
    and disabled = false
  order by created_at desc
  limit 1;

  -- Insert (UNIQUE on channel/patch/build will throw 23505 if a parallel
  -- transaction already inserted the same build — caller maps to HTTP 409).
  insert into public.p4k_bundles (
    uploaded_by, channel, patch_version, build_number, schema_version,
    quality_score, entity_counts, manifest, tool_version
  ) values (
    p_uploader, p_channel, p_patch_version, p_build_number, p_schema_version,
    p_quality_score, p_entity_counts, p_manifest, p_tool_version
  )
  returning id into v_new_id;

  -- Compute diff vs. prev under the same lock.
  if v_prev_id is not null then
    v_diff := public.diff_bundle(v_prev_id, v_new_id);
    update public.p4k_bundles
    set diff_summary = v_diff
    where id = v_new_id;
  end if;

  return query select v_new_id, v_prev_id, v_diff;
end
$func$;

grant execute on function public.ingest_bundle_atomic(
  uuid, public.p4k_channel, text, text, int, numeric, jsonb, jsonb, text
) to authenticated;
