-- ============================================================
-- 20260901182500_starscape_wallpaper_votes.sql
--
-- Starscape thumbs-up ("SC upvote", the stacked double triangle from Spectrum)
-- plus the per-user "only show the Top 7" preference.
--
-- Three pieces:
--   1. `wallpaper_votes` — one permanent row per (image, user). The primary key
--      IS the "one vote per user per image" rule; revoking a vote deletes the
--      row. No score column, no counters to drift: the count is always
--      `count(*)` over this table.
--   2. Read paths that expose the AGGREGATE without exposing the voters:
--      `starscape_vote_state()` (counts + "did I vote", for the visible page)
--      and `starscape_top_wallpapers()` (the global ranking). Both are
--      SECURITY DEFINER so they can aggregate a table whose rows the caller
--      cannot select; neither ever returns a `user_id`.
--   3. `profiles.starscape_top_only` + `set_starscape_top_only()` — the
--      per-user toggle, stored server-side so the desktop tray app can read
--      and write the SAME preference as the website (mirrors the
--      `set_preferred_region` pattern from 20260731183000).
--
-- Image identity: `verse_wallpapers.image_id`, the RSI CDN media id that is
-- already the gallery's primary key and the id the share deep-link
-- (`/starscape?image=<id>`) hands out. No new id scheme is invented here — the
-- FK makes a vote for an image the gallery does not have impossible, and a
-- wallpaper that is ever deleted takes its votes with it.
--
-- ADDITIVE: this migration drops and renames nothing.
-- ============================================================

-- ============================================================
-- 1 — the votes table
-- ============================================================
create table if not exists public.wallpaper_votes (
  image_id   text not null references public.verse_wallpapers (image_id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (image_id, user_id)
);

comment on table public.wallpaper_votes is
  'Starscape thumbs-up. One row per (image_id, user_id) — the PK enforces '
  '"one vote per user per image"; un-voting deletes the row. Votes are private '
  'data: only the owner can read their own rows. Aggregates are published '
  'through starscape_vote_state() / starscape_top_wallpapers(), which never '
  'return a user_id.';

comment on column public.wallpaper_votes.image_id is
  'verse_wallpapers.image_id — the RSI CDN media id, the gallery''s own stable identity.';

-- Ranking + per-image counts scan by image; the PK already covers that prefix.
-- This one serves "everything I voted for" (the grid''s own-vote lookup).
create index if not exists wallpaper_votes_user_idx
  on public.wallpaper_votes (user_id);

alter table public.wallpaper_votes enable row level security;

-- Read: OWN rows only. Deliberately not public — a public select on this table
-- would publish who liked what, and the aggregate the UI needs is served by the
-- two SECURITY DEFINER functions below instead.
drop policy if exists wallpaper_votes_self_read on public.wallpaper_votes;
create policy wallpaper_votes_self_read on public.wallpaper_votes
  for select to authenticated
  using (auth.uid() = user_id);

-- Write: own vote only, in both directions. There is no UPDATE policy at all —
-- a vote has nothing to update, and without one a caller cannot re-key a row
-- onto somebody else's user_id.
drop policy if exists wallpaper_votes_self_insert on public.wallpaper_votes;
create policy wallpaper_votes_self_insert on public.wallpaper_votes
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists wallpaper_votes_self_delete on public.wallpaper_votes;
create policy wallpaper_votes_self_delete on public.wallpaper_votes
  for delete to authenticated
  using (auth.uid() = user_id);

-- Same RESTRICTIVE approval gate the other self-scoped tables carry
-- (20260805120000 C8): a signed-up-but-never-approved account holds a valid
-- JWT and could otherwise stuff the global Top 7 through a direct PostgREST
-- call. Every pre-existing user was backfilled to is_approved = true, so this
-- is a no-op for anyone who can already use the app.
drop policy if exists wallpaper_votes_approved_gate on public.wallpaper_votes;
create policy wallpaper_votes_approved_gate on public.wallpaper_votes
  as restrictive for all to authenticated
  using (public.is_approved())
  with check (public.is_approved());

-- anon may not read or write anything here; authenticated gets exactly the
-- verbs the policies above describe.
revoke all on public.wallpaper_votes from anon;
revoke all on public.wallpaper_votes from authenticated;
grant select, insert, delete on public.wallpaper_votes to authenticated;

-- ============================================================
-- 2a — starscape_vote_state(image_ids)
--
-- Counts for the images currently on screen, plus whether the CALLER voted for
-- each. SECURITY DEFINER because `wallpaper_votes` is self-read only: the
-- aggregate is public information, the individual votes are not. The result
-- carries no user_id, so a caller learns "12 people liked this", never who.
--
-- Only images with at least one vote are returned; the client treats a missing
-- row as zero. Signed-out callers get `voted = false` everywhere.
-- ============================================================
create or replace function public.starscape_vote_state(p_image_ids text[])
returns table (image_id text, votes bigint, voted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.image_id,
    count(*)::bigint as votes,
    -- NULL for a signed-out caller (`uuid = null`), folded to false so the
    -- client never has to reason about a tri-state.
    coalesce(bool_or(v.user_id = auth.uid()), false) as voted
  from public.wallpaper_votes v
  where v.image_id = any(coalesce(p_image_ids, array[]::text[]))
  group by v.image_id;
$$;

comment on function public.starscape_vote_state(text[]) is
  'Public vote counts for the given wallpapers + whether the caller voted. '
  'SECURITY DEFINER so it can aggregate the self-read-only wallpaper_votes '
  'table; never returns a user_id. Images with no votes are simply absent.';

grant execute on function public.starscape_vote_state(text[]) to anon, authenticated;

-- ============================================================
-- 2b — starscape_top_wallpapers(limit)
--
-- The global ranking behind the "only show the Top 7" toggle, server-side so
-- the desktop tray app can reuse the exact same list the website shows.
--
-- Ordering is `votes desc, published_at desc` over a LEFT JOIN, which gives the
-- requested early-phase fallback for free: images WITH votes rank first, and
-- the remaining slots fill with the NEWEST wallpapers. With zero votes cast the
-- list is simply the 7 newest — never short, never empty.
--
-- `image_id` is the final tiebreaker so the ranking is deterministic (two
-- wallpapers from the same comm-link share a published_at to the second).
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
  '1..50. Shared ranking for the website toggle and the desktop tray app.';

grant execute on function public.starscape_top_wallpapers(integer) to anon, authenticated;

-- ============================================================
-- 3 — the per-user "Top 7 only" preference
--
-- Lives on `profiles` next to preferred_lang / preferred_region so the desktop
-- app reads the same row. Not-null with a default, because "no preference" and
-- "off" are the same thing here.
--
-- RLS unchanged: profiles_self_read (00001) already covers self-select of every
-- column, and the SECURITY DEFINER RPC is the write path — profiles_role_write_guard
-- only guards role/is_approved, so a plain self-update of this column would work
-- too; the RPC exists to give the desktop app one stable, typed entry point.
-- ============================================================
alter table public.profiles
  add column if not exists starscape_top_only boolean not null default false;

comment on column public.profiles.starscape_top_only is
  'Starscape: show only the global Top 7 wallpapers. Set via set_starscape_top_only(). '
  'Shared by the website and the Starscape desktop tray app. Default false = show everything.';

create or replace function public.set_starscape_top_only(enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  update public.profiles
  set starscape_top_only = coalesce(enabled, false)
  where id = caller;
end;
$$;

comment on function public.set_starscape_top_only(boolean) is
  'Write path for profiles.starscape_top_only (the Starscape "Top 7 only" toggle).';

grant execute on function public.set_starscape_top_only(boolean) to authenticated;
