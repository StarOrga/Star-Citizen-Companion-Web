-- verse_digest: one gallery candidate per series/title.
--
-- A wallpaper drop publishes several images under one title (e.g. four
-- "Day of the Vara 2956" wallpapers). The digest took the three newest
-- images, so the briefing hero showed the same story three times. The
-- gallery source now yields the newest image per title (series fallback),
-- still at most three, so different drops can compete with news and patches.
-- Everything else is unchanged from 20261009100000_verse_hub.sql.
create or replace function public.verse_digest()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_items jsonb;
  v_suggested int;
  v_patch jsonb;
  v_counts jsonb;
begin
  perform set_config('response.headers',
    '[{"Cache-Control": "public, max-age=60, stale-while-revalidate=300"}]', true);

  with cand as (
    select vp.item_key, vp.kind, vp.title, vp.url, vp.summary, null::text as image,
           vp.created_at as at, true as pinned, 1000 + vp.weight::numeric as score
      from public.verse_pins vp
     where vp.pinned_until is null or vp.pinned_until > now()
    union all
    (select 'patch:' || p.patch_line, 'patch', p.patch_line, '/verse/patches/' || p.patch_line, null, null,
            p.live_at, false,
            100 - 5 * extract(epoch from (now() - p.live_at)) / 86400
       from public.patch_stability_patches p
      order by p.live_at desc limit 1)
    union all
    select 'build:' || v.channel || ':' || v.version, 'patch', v.version, '/verse/patches', null, null,
           v.detected_at, false,
           90 - 5 * extract(epoch from (now() - v.detected_at)) / 86400
      from public.patch_versions v
     where v.channel in ('ptu', 'eptu')
       and v.version is distinct from (select l.version from public.patch_versions l where l.channel = 'live')
    union all
    (select 'news:' || n.source || ':' || n.external_id, 'news', n.title, n.url, null, n.thumbnail,
            n.published_at, false,
            80 - 6 * extract(epoch from (now() - n.published_at)) / 86400
       from public.news_cache n
      where n.published_at > now() - interval '14 days'
      order by n.published_at desc limit 7)
    union all
    (select g.* from (
       select distinct on (coalesce(w.title, w.series, w.image_id::text))
              'gallery:' || w.image_id as item_key, 'gallery' as kind, coalesce(w.title, w.series, '') as title,
              '/verse/gallery?image=' || w.image_id as url,
              null::text as summary, w.preview_url as image, w.published_at as at, false as pinned,
              60 - 6 * extract(epoch from (now() - w.published_at)) / 86400 as score
         from public.verse_wallpapers w
        where w.variant_role in ('single', 'primary')
          and w.published_at > now() - interval '14 days'
        order by coalesce(w.title, w.series, w.image_id::text), w.published_at desc nulls last) g
      order by g.at desc nulls last limit 3)
  ),
  ranked as (
    select c.*, row_number() over (order by c.score desc, c.at desc nulls last) as rank
      from cand c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', item_key, 'kind', kind, 'title', title, 'url', url, 'summary', summary,
           'image', image, 'at', at, 'pinned', pinned, 'score', round(score, 1), 'rank', rank
         ) order by rank), '[]'::jsonb),
         greatest(3, least(7, count(*) filter (where score >= 40)))
    into v_items, v_suggested
    from ranked
   where rank <= 7;

  select jsonb_build_object(
           'line', p.patch_line,
           'live_at', p.live_at,
           'channels', (select coalesce(jsonb_object_agg(v.channel, v.version), '{}'::jsonb) from public.patch_versions v),
           'status', case
             when exists (select 1 from public.patch_versions v
                           where v.channel in ('ptu', 'eptu')
                             and v.version is distinct from (select l.version from public.patch_versions l where l.channel = 'live'))
               then 'ptu'
             else 'live' end)
    into v_patch
    from public.patch_stability_patches p
   order by p.live_at desc
   limit 1;

  select jsonb_build_object(
    'news', jsonb_build_object(
      'recent', (select count(*) from public.news_cache n where n.published_at > now() - interval '7 days')),
    'patches', jsonb_build_object(
      'total', (select count(*) from public.patch_stability_patches),
      'recent', (select count(*) from public.patch_stability_patches p where p.live_at > now() - interval '30 days')),
    'gallery', jsonb_build_object(
      'total', (select count(*) from public.verse_wallpapers w where w.variant_role in ('single', 'primary')),
      'recent', (select count(*) from public.verse_wallpapers w
                  where w.variant_role in ('single', 'primary') and w.published_at > now() - interval '7 days'))
  ) into v_counts;

  return jsonb_build_object(
    'generated_at', now(),
    'items', v_items,
    'suggested', v_suggested,
    'patch', v_patch,
    'counts', v_counts);
end;
$$;

revoke execute on function public.verse_digest() from public;
grant execute on function public.verse_digest() to anon, authenticated;
