-- 00004 · Read-API for the P4K bundle history view (collaborator+).
-- The web app's /p4k page consumes this — raw inserts still go through the
-- desktop tool's POST to the bundle ingest function (Phase 2).

create or replace function public.list_p4k_bundles_for_collaborator()
returns table (
  id uuid,
  channel public.p4k_channel,
  patch_version text,
  schema_version int,
  quality_score numeric,
  entity_counts jsonb,
  tool_version text,
  uploaded_by_id uuid,
  uploaded_by_email text,
  uploaded_by_name text,
  created_at timestamptz
)
language sql security definer set search_path = public stable as $func$
  select
    b.id,
    b.channel,
    b.patch_version,
    b.schema_version,
    b.quality_score,
    b.entity_counts,
    b.tool_version,
    b.uploaded_by as uploaded_by_id,
    u.email as uploaded_by_email,
    p.display_name as uploaded_by_name,
    b.created_at
  from public.p4k_bundles b
  join auth.users u on u.id = b.uploaded_by
  left join public.profiles p on p.id = b.uploaded_by
  where public.is_collaborator()
  order by b.created_at desc
$func$;

grant execute on function public.list_p4k_bundles_for_collaborator() to authenticated;
