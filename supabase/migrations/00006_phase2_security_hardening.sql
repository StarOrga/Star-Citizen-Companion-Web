-- 00006 · Phase 2 — Security hardening from Codex review 2026-05-24
-- Findings addressed:
--   MED-HIGH 3: list_p4k_bundles_for_collaborator honored caller-controlled
--               include_disabled for ANY collaborator. UI hid the toggle
--               for non-admins, but the RPC was open. Now: include_disabled=true
--               requires admin role; non-admin callers always see only
--               non-disabled rows regardless of the flag.
--   MED 4:      UNIQUE was (channel, patch_version, build_number, uploaded_by),
--               so two collaborators could upload the same build independently
--               and create ambiguous history. Tighten to
--               (channel, patch_version, build_number) — first upload wins,
--               subsequent attempts get HTTP 409 from ingest-bundle. Admins
--               can still disable the winner if needed.
--   MED 5:      ingest-bundle did a two-step "select prev_id, then insert,
--               then compute diff" — concurrent uploads of different builds
--               could both see the same prev_id. Add a transaction-safe SQL
--               function that picks prev_id + inserts + computes diff
--               atomically under a single advisory lock per (channel, patch).

-- ============================================================
-- (MED 4) Tighten UNIQUE constraint
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

alter table public.p4k_bundles
  add constraint p4k_bundles_channel_patch_build_key
  unique (channel, patch_version, build_number);


-- ============================================================
-- (MED-HIGH 3) list_p4k_bundles_for_collaborator — admin-gate include_disabled
-- ============================================================
create or replace function public.list_p4k_bundles_for_collaborator(
  include_history boolean default false,
  include_disabled boolean default false
)
returns table (
  id uuid,
  channel public.p4k_channel,
  patch_version text,
  build_number text,
  schema_version int,
  quality_score numeric,
  entity_counts jsonb,
  diff_summary jsonb,
  disabled boolean,
  disabled_reason text,
  tool_version text,
  uploaded_by_id uuid,
  uploaded_by_email text,
  uploaded_by_name text,
  created_at timestamptz
)
language sql security definer set search_path = public stable as $func$
  -- include_disabled is honored ONLY when the caller is an admin.
  -- Non-admin collaborators always see disabled = false regardless of flag.
  -- (Codex review 2026-05-24, finding MED-HIGH 3.)
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
      and (effective.show_disabled or b.disabled = false)
  ),
  distinct_latest as (
    select distinct on (channel, patch_version, build_number) *
    from filtered
    order by channel, patch_version, build_number, created_at desc
  )
  select id, channel, patch_version, build_number, schema_version,
         quality_score, entity_counts, diff_summary, disabled, disabled_reason,
         tool_version, uploaded_by as uploaded_by_id,
         ue as uploaded_by_email, un as uploaded_by_name, created_at
  from (
    select * from filtered where include_history
    union all
    select * from distinct_latest where not include_history
  ) merged
  order by created_at desc
$func$;

grant execute on function public.list_p4k_bundles_for_collaborator(boolean, boolean) to authenticated;


-- ============================================================
-- (MED 5) Atomic ingest RPC — prev_id lookup + insert + diff under advisory lock
-- ============================================================
-- The ingest-bundle edge function will call this RPC instead of doing three
-- separate queries. Advisory lock keyed by hash(channel || patch_version)
-- serializes uploads within a patch family, eliminating the prev_id race.
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
  -- Caller must be a collaborator (ingest-bundle already checks JWT role,
  -- but defense in depth).
  if not public.is_collaborator() then
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
