-- ============================================================
-- 20261029120000_wallpaper_vote_counts.sql
--
-- Verse gallery filters (beta-shell Feinschliff, notes #14/#15): the gallery
-- offers exactly four views - All, Newest, Community Top, My votes. "Community
-- Top" needs a vote count per image, "My votes" needs the caller's own votes,
-- and both must PAGE like the plain list does (load more / auto-load).
--
-- Why an RPC and not a view: `wallpaper_votes` is self-read only (RLS
-- wallpaper_votes_self_read). A SECURITY INVOKER view would therefore count
-- only the caller's own rows - wrong for a community ranking. An owner-run
-- view would bypass RLS, but a view cannot know the caller for "mine" without
-- auth.uid() anyway and cannot page by filter. So this follows the precedent
-- set by starscape_vote_state() / starscape_top_wallpapers(): SECURITY DEFINER,
-- aggregates only, never returns a user_id.
--
-- Filters (p_filter):
--   'top'    votes desc, newest first as tiebreak, capped at 48 rows (the
--            same "never short, never empty" fill as starscape_top_wallpapers)
--   'newest' published_at desc, capped at 48 rows
--   'mine'   the caller's own votes, most recently voted first; empty for a
--            signed-out caller (auth.uid() is null)
--   other    unknown values fall back to 'newest', so a stale client never errors.
--
-- Visibility matches the table read: verse_wallpaper_series_visible() (a
-- SECURITY DEFINER body bypasses the RLS policy, so the predicate is spelled
-- out) and the grid's variant_role rule (one tile per artwork).
--
-- ADDITIVE: creates one function, drops and renames nothing.
-- ============================================================

create or replace function public.starscape_gallery_page(
  p_filter text,
  p_limit  integer default 24,
  p_offset integer default 0
)
returns table (
  image_id     text,
  source_url   text,
  preview_url  text,
  title        text,
  series       text,
  article_url  text,
  published_at timestamptz,
  votes        bigint,
  voted        boolean,
  total_count  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      case when p_filter in ('top', 'newest', 'mine') then p_filter else 'newest' end as f,
      greatest(1, least(coalesce(p_limit, 24), 48))  as lim,
      greatest(0, coalesce(p_offset, 0))             as off
  ),
  counts as (
    select
      wv.image_id,
      count(*)                              as votes,
      bool_or(wv.user_id = auth.uid())      as mine,
      max(wv.created_at) filter (where wv.user_id = auth.uid()) as my_voted_at
    from public.wallpaper_votes wv
    group by wv.image_id
  ),
  base as (
    select
      w.image_id,
      w.source_url,
      w.preview_url,
      w.title,
      w.series,
      w.article_url,
      w.published_at,
      coalesce(c.votes, 0)::bigint        as votes,
      coalesce(c.mine, false)             as voted,
      c.my_voted_at,
      row_number() over (
        order by
          case when (select f from params) = 'top' then coalesce(c.votes, 0) end desc nulls last,
          case when (select f from params) = 'mine' then c.my_voted_at end desc nulls last,
          w.published_at desc nulls last,
          w.image_id desc
      ) as rn
    from public.verse_wallpapers w
    left join counts c on c.image_id = w.image_id
    where public.verse_wallpaper_series_visible(w.series)
      and w.variant_role in ('single', 'primary')
      and ((select f from params) <> 'mine' or coalesce(c.mine, false))
  ),
  capped as (
    select
      b.*,
      case when (select f from params) in ('top', 'newest')
           then least(count(*) over (), 48)
           else count(*) over ()
      end as total_count
    from base b
  )
  select
    k.image_id, k.source_url, k.preview_url, k.title, k.series, k.article_url,
    k.published_at, k.votes, k.voted, k.total_count::bigint
  from capped k
  where k.rn > (select off from params)
    and k.rn <= (select off from params) + (select lim from params)
    and k.rn <= k.total_count
  order by k.rn;
$$;

comment on function public.starscape_gallery_page(text, integer, integer) is
  'Starscape gallery pages for the Community Top / Newest / My votes filters, '
  'with the public vote count and the caller''s own vote flag. SECURITY DEFINER '
  '(aggregates the self-read-only wallpaper_votes); returns no user_id. '
  'top/newest are capped at 48 rows, mine is complete. Same visibility rules as '
  'the table read (series gate + variant_role).';

grant execute on function public.starscape_gallery_page(text, integer, integer) to anon, authenticated;
