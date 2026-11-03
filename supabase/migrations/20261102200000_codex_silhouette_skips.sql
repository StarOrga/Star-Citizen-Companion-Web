-- ============================================================
-- 20261102200000_codex_silhouette_skips.sql
-- Why a hull has no Holotable silhouette (issue #842, part 1).
--
-- WHAT THIS CREATES
--   public.codex_silhouette_skips — one row per entity of a build that the
--   uploader's silhouette build could not outline, with the reason:
--     no_mesh         the entity record names no .cga/.cgf, or the named
--                     file is not in the archive
--     convert_failed  cgf-converter / the glb parse failed (detail = error)
--     empty           converted, but no triangles / no traceable outline
--   Written by ingest-catalog op `silhouette_skips` (service role, replaces
--   the build's list per run). Read only through silhouette_coverage().
--
-- WHAT THIS CHANGES
--   public.silhouette_coverage(uuid) additionally returns
--     reasons      {no_mesh, convert_failed, empty} counts over the hulls
--                  without a silhouette
--     unexplained  hulls without a silhouette AND without a recorded reason
--   and every `missing` entry carries `reason` + `detail` (null = no reason
--   recorded, e.g. a build uploaded before uploader 0.68.0).
--
-- SECURITY
--   RLS on, no policies: only the service role (edge function) writes, only
--   the SECURITY DEFINER admin RPC reads. Nothing for anon / authenticated.
--
-- ADDITIVE: one new table, one replaced function. Drops nothing.
-- ============================================================

create table if not exists public.codex_silhouette_skips (
  build_id   uuid not null references public.codex_builds(id) on delete cascade,
  kind       text not null,
  class_name text not null,
  reason     text not null check (reason in ('no_mesh', 'convert_failed', 'empty')),
  detail     text,
  created_at timestamptz not null default now(),
  primary key (build_id, kind, class_name)
);

comment on table public.codex_silhouette_skips is
  'Why an entity of a codex build has no silhouette row (#842): no_mesh | convert_failed | empty. Uploader-written via ingest-catalog, read by silhouette_coverage().';

alter table public.codex_silhouette_skips enable row level security;
revoke all on table public.codex_silhouette_skips from anon, authenticated;

create or replace function public.silhouette_coverage(p_build_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_build public.codex_builds%rowtype;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_build_id is null then
    select * into v_build
      from public.codex_builds b
     where b.channel = 'LIVE' and b.is_current
     limit 1;
  else
    select * into v_build from public.codex_builds b where b.id = p_build_id;
  end if;

  if v_build.id is null then
    return null;
  end if;

  with ships as (
    select
      s.class_name,
      s.name_localized,
      coalesce(s.payload->>'previewImage', '') <> '' as has_icon,
      x.class_name is not null as has_silhouette,
      coalesce(jsonb_typeof(x.anchors) = 'array' and jsonb_array_length(x.anchors) > 0, false) as has_anchors,
      k.reason,
      k.detail
    from public.codex_ships s
    left join public.codex_silhouettes x
      on x.build_id = s.build_id and x.kind = 'ship' and x.class_name = s.class_name
    left join public.codex_silhouette_skips k
      on k.build_id = s.build_id and k.kind = 'ship' and k.class_name = s.class_name
    where s.build_id = v_build.id
  )
  select jsonb_build_object(
    'build', jsonb_build_object(
      'id', v_build.id,
      'channel', v_build.channel,
      'patch_version', v_build.patch_version,
      'build_number', v_build.build_number
    ),
    'total', count(*),
    'with_silhouette', count(*) filter (where has_silhouette),
    'with_anchors', count(*) filter (where has_anchors),
    'without_silhouette', count(*) filter (where not has_silhouette),
    'fallback_icon', count(*) filter (where not has_silhouette and has_icon),
    'fallback_none', count(*) filter (where not has_silhouette and not has_icon),
    'reasons', jsonb_build_object(
      'no_mesh', count(*) filter (where not has_silhouette and reason = 'no_mesh'),
      'convert_failed', count(*) filter (where not has_silhouette and reason = 'convert_failed'),
      'empty', count(*) filter (where not has_silhouette and reason = 'empty')
    ),
    'unexplained', count(*) filter (where not has_silhouette and reason is null),
    'missing', coalesce((
      select jsonb_agg(jsonb_build_object('class_name', m.class_name, 'name', m.name_localized,
                                          'reason', m.reason, 'detail', m.detail)
                       order by coalesce(m.name_localized, m.class_name))
        from (select * from ships where not has_silhouette
               order by coalesce(name_localized, class_name) limit 500) m
    ), '[]'::jsonb)
  )
  into v_result
  from ships;

  return v_result;
end;
$$;

comment on function public.silhouette_coverage(uuid) is
  'Admin-only: Holotable silhouette coverage of one codex build (default LIVE current) — totals, anchors, preview-icon fallback, skip reasons (#842) and the hulls without a silhouette (#647).';

revoke all on function public.silhouette_coverage(uuid) from public, anon;
grant execute on function public.silhouette_coverage(uuid) to authenticated;
