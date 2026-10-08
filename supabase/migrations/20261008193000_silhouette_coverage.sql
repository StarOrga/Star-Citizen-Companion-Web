-- ============================================================
-- 20261008193000_silhouette_coverage.sql
-- Admin dashboard: how many hulls of a build have a Holotable silhouette
-- (issue #647).
--
-- WHAT THIS CREATES
--   public.silhouette_coverage(p_build_id uuid default null) -> jsonb
--   Counts for ONE build (default: the LIVE `is_current` build, the same row
--   CodexService treats as current):
--     total               codex_ships rows of the build
--     with_silhouette     ...that have a codex_silhouettes row (kind 'ship')
--     with_anchors        ...whose silhouette carries at least one anchor
--     without_silhouette  total - with_silhouette
--     fallback_icon       without silhouette, but a datamined preview image
--                         (payload.previewImage) exists
--     fallback_none       without silhouette AND without preview image
--   plus `missing`: the hulls without a silhouette (class_name + English
--   name, sorted by name, capped at 500) so the tile can link each one.
--
-- WHAT IT DELIBERATELY DOES NOT COUNT
--   "Falls back to RSI art" vs "generic glyph" is decided in the browser:
--   the RSI store render comes from the rsi-upcoming-ships feed and the glyph
--   only shows once every image candidate failed to LOAD. The database cannot
--   know either, so fallback_none means "RSI art or the glyph" and the tile
--   says so instead of inventing a split.
--
-- SECURITY
--   SECURITY DEFINER with an empty search_path (every name qualified), admin
--   check via public.is_admin() like the other admin RPCs (raises for
--   everyone else). EXECUTE for `authenticated` only.
--
-- ADDITIVE: creates one function, drops nothing.
-- ============================================================

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
      coalesce(jsonb_typeof(x.anchors) = 'array' and jsonb_array_length(x.anchors) > 0, false) as has_anchors
    from public.codex_ships s
    left join public.codex_silhouettes x
      on x.build_id = s.build_id and x.kind = 'ship' and x.class_name = s.class_name
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
    'missing', coalesce((
      select jsonb_agg(jsonb_build_object('class_name', m.class_name, 'name', m.name_localized)
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
  'Admin-only: Holotable silhouette coverage of one codex build (default LIVE current) — totals, anchors, preview-icon fallback and the hulls without a silhouette (#647).';

revoke all on function public.silhouette_coverage(uuid) from public, anon;
grant execute on function public.silhouette_coverage(uuid) to authenticated;
