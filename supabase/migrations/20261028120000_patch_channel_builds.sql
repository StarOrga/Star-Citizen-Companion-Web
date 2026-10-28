-- Per-channel patch stats for the Verse hub (Hotfix / PTU / Evocati).
--
-- patch_stability_samples only measures lines that reached LIVE, and
-- patch_versions has no hotfix / evocati row, so the hub could show nothing for
-- the three test channels. The patch-stability-sample edge function now also
-- groups the Spectrum patch-notes threads (forum 190048) into BUILDS - one
-- version in one channel - and persists them here:
--   started_at       when the version entered the channel (first thread; for a
--                    hotfix the newest event of its Hotfix Central post)
--   thread_first_at  first thread, the base for the reply velocity
--   wave             PTU/Evocati wave of the NEWEST thread ("[Wave 2]"), null
--                    when it names none ("All Backers", "RC2")
--   replies / votes  summed over the build's threads
--   top_ticket_*     Issue-Council ticket share of the newest thread's 25 top
--                    replies (the same raw numbers the LIVE formula reads)
--   running          the build currently in the channel (one per channel)
-- KB known issues exist for LIVE only and are not stored here. The client
-- computes every verdict (src/app/news/patch-stability.ts); nothing derived is
-- stored.
--
-- verse_digest() gains patch.channel_info (channel -> running build + its
-- predecessor in the SAME channel). patch.channels is unchanged, so old
-- consumers keep working. Everything else is as in 20261025121000.
--
-- Alpha policy: new table, nothing dropped.
-- ROLLBACK: restore verse_digest() from 20261025121000_verse_digest_gallery_per_series.sql;
--           drop table public.patch_channel_builds;

create table if not exists public.patch_channel_builds (
  channel               text not null check (channel in ('hotfix', 'ptu', 'evocati')),
  version               text not null,
  line                  text not null,
  started_at            timestamptz not null,
  thread_first_at       timestamptz not null,
  wave                  int,
  thread_count          int not null default 1,
  replies               int not null default 0,
  votes                 int not null default 0,
  top_ticket_share      numeric,
  top_ticket_vote_share numeric,
  running               boolean not null default false,
  updated_at            timestamptz not null default now(),
  primary key (channel, version)
);

create index if not exists patch_channel_builds_channel_first_idx
  on public.patch_channel_builds (channel, thread_first_at desc);

alter table public.patch_channel_builds enable row level security;

drop policy if exists patch_channel_builds_public_read on public.patch_channel_builds;
create policy patch_channel_builds_public_read on public.patch_channel_builds
  for select using (true);

revoke insert, update, delete, truncate on public.patch_channel_builds from anon, authenticated;
grant select on public.patch_channel_builds to anon, authenticated;

comment on table public.patch_channel_builds is
  'Hotfix / PTU / Evocati builds from Spectrum forum 190048, written by patch-stability-sample. Raw numbers only.';

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
           'channel_info', (select coalesce(jsonb_object_agg(r.channel, jsonb_build_object(
               'version', r.version, 'started_at', r.started_at, 'thread_first_at', r.thread_first_at,
               'wave', r.wave, 'replies', r.replies, 'votes', r.votes,
               'ticket_share', r.top_ticket_share, 'ticket_vote_share', r.top_ticket_vote_share,
               'previous', (select jsonb_build_object(
               'version', p.version, 'started_at', p.started_at, 'thread_first_at', p.thread_first_at,
               'wave', p.wave, 'replies', p.replies, 'votes', p.votes,
               'ticket_share', p.top_ticket_share, 'ticket_vote_share', p.top_ticket_vote_share, 'ended_at', r.thread_first_at)
                              from public.patch_channel_builds p
                             where p.channel = r.channel and p.thread_first_at < r.thread_first_at
                             order by p.thread_first_at desc limit 1))), '{}'::jsonb)
                             from (select distinct on (b.channel) b.*
                                     from public.patch_channel_builds b
                                    where b.running
                                    order by b.channel, b.thread_first_at desc) r),
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
