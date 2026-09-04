-- ============================================================
-- 20260904030000_verse_wallpapers_hide_roadmap_roundup.sql
--
-- Take the "Roadmap Roundup" series out of the Starscape gallery — on the
-- website AND in the Starscape desktop app.
--
-- Why: the series is a recurring column that reuses the SAME header artwork
-- issue after issue, so its filter segment showed the visitor the picture they
-- had just been shown. Maintainer verdict (admin feedback 1f78e57f):
-- "Roadmap Roundup als Filter hilft gar nicht, das ist ja häufig das gleiche
-- Bild. Der kann generell raus, auch aus der Starscape App".
--
-- Why the exclusion lives HERE and not in the Angular gallery:
-- the Starscape desktop app does not go through the website. It queries
-- PostgREST directly with the publishable key
-- (`/rest/v1/verse_wallpapers?select=source_url…`, wallpaper-app/src/net.rs),
-- so RLS is the only filter both surfaces share. A client-side filter would
-- need a new signed Rust release to reach an installed app; a policy reaches
-- every running install on its next fetch.
--
-- NOTHING IS DELETED. The one stored Roadmap Roundup row (and any that slipped
-- in before this) stays in the table, hidden on read. That keeps the change
-- reversible — dropping the predicate below brings the rows straight back —
-- and it keeps the row's perceptual hash working as a near-duplicate reference
-- for the crawler, which reads with the service role and is unaffected by RLS.
-- It also protects `wallpaper_votes`, whose FK cascades: deleting the row would
-- destroy its votes permanently.
--
-- The WRITE half of the same rule is
-- `supabase/functions/fetch-verse-news/wallpaper-series.ts`, which drops
-- excluded-series candidates at capture time so the table stops growing with
-- rows nobody can see.
--
-- ADDITIVE: no table, column or function is dropped or renamed.
-- ============================================================

-- ============================================================
-- 1 — the predicate, in ONE place
--
-- Referenced by both read paths below so they cannot drift apart. Matching is
-- trimmed + case-insensitive, mirroring isWallpaperSeries() in the crawler.
-- A NULL series is visible: most of the gallery carries no series at all
-- (patch notes, articles the wiki API files under "None"), and those rows are
-- the bulk of it.
-- ============================================================
create or replace function public.verse_wallpaper_series_visible(p_series text)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select p_series is null or lower(btrim(p_series)) <> 'roadmap roundup';
$$;

comment on function public.verse_wallpaper_series_visible(text) is
  'Starscape gallery series gate (admin feedback 1f78e57f). False for series '
  'whose artwork must never be shown — currently only "Roadmap Roundup", a '
  'recurring column that republishes one header image. Single source of truth '
  'for the verse_wallpapers RLS read policy and starscape_top_wallpapers(); '
  'mirrored on the write side by fetch-verse-news/wallpaper-series.ts. Rows of '
  'an excluded series are HIDDEN, never deleted.';

grant execute on function public.verse_wallpaper_series_visible(text) to anon, authenticated;

-- ============================================================
-- 2 — the table read (website grid + series probe, desktop app list,
--     and the `wallpaper_votes → verse_wallpapers` embed the app uses for
--     "my upvotes"; the embed simply yields null for a hidden row, which
--     net.rs already skips)
-- ============================================================
drop policy if exists verse_wallpapers_public_read on public.verse_wallpapers;
create policy verse_wallpapers_public_read on public.verse_wallpapers
  for select to anon, authenticated
  using (public.verse_wallpaper_series_visible(series));

-- ============================================================
-- 3 — the ranking read
--
-- `starscape_top_wallpapers` is SECURITY DEFINER (it aggregates the
-- self-read-only wallpaper_votes table), so it BYPASSES the policy above and
-- needs the predicate spelled out. Without this the excluded series would keep
-- surfacing through the website's "Top 7" toggle and the desktop tray's
-- ranking — the one place both surfaces would still show it.
--
-- Body is otherwise unchanged from 20260901182500; signature and return
-- columns are identical, so this is a plain replace.
-- ============================================================
create or replace function public.starscape_top_wallpapers(p_limit integer default 7)
returns table (
  image_id     text,
  source_url   text,
  preview_url  text,
  title        text,
  series       text,
  article_url  text,
  published_at timestamptz,
  votes        bigint,
  voted        boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.image_id,
    w.source_url,
    w.preview_url,
    w.title,
    w.series,
    w.article_url,
    w.published_at,
    coalesce(v.votes, 0)::bigint as votes,
    coalesce(v.mine, false) as voted
  from public.verse_wallpapers w
  left join (
    select
      wv.image_id,
      count(*) as votes,
      bool_or(wv.user_id = auth.uid()) as mine
    from public.wallpaper_votes wv
    group by wv.image_id
  ) v on v.image_id = w.image_id
  where public.verse_wallpaper_series_visible(w.series)
  order by
    coalesce(v.votes, 0) desc,
    w.published_at desc nulls last,
    w.image_id desc
  limit greatest(1, least(coalesce(p_limit, 7), 50));
$$;

comment on function public.starscape_top_wallpapers(integer) is
  'Globally highest-voted wallpapers, newest-first as the fallback filler when '
  'fewer than p_limit images have votes. SECURITY DEFINER (aggregates the '
  'self-read-only wallpaper_votes); returns no user_id. p_limit is clamped to '
  '1..50. Skips series verse_wallpaper_series_visible() excludes — the policy '
  'on verse_wallpapers cannot reach a SECURITY DEFINER body. Shared ranking '
  'for the website toggle and the desktop tray app.';

comment on table public.verse_wallpapers is
  'Starscape gallery (#133): metadata + ORIGINAL RSI CDN links for high-res '
  'news imagery. No image bytes are stored — hotlinks only, deduped by CDN id. '
  'Written by fetch-verse-news (service role). Public reads are filtered by '
  'verse_wallpaper_series_visible(series): rows of an excluded series stay in '
  'the table but are invisible to anon/authenticated, which is how the website '
  'and the Starscape desktop app share one exclusion without a Rust release.';
