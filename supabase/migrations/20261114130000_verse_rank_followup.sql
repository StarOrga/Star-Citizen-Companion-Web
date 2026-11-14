-- Verse rank follow-up (concept 20261114-0200): rank by lit stars, reward ideas with
-- voting from tier 5, x.y.z target detected from PTU/EPTU/Evocati, sun splinters.
--
-- * verse_lit_star_count(uid): lit stars over ALL patch lines (verse_star_progress rows,
--   the same rows verse_explorer_state sums into total_stars). Client tiers are the
--   thresholds [1,3,7,12,18,26,35]; tier 5 = 18 stars. verse_explorer_state() carries it
--   as kartograph.stars and the caller's splinter count as sun_splinters (top level).
-- * Reward ideas: verse_rank_reward_ideas + _votes, writes only through the RPCs below,
--   gated server-side at 18 lit stars. The old "Top-Eintrag" suggestion backend
--   (verse_promote_suggestion & co.) is deliberately left untouched - the client stops
--   using it, nothing is dropped.
-- * verse_comet_version_info(): target = the lowest x.y.z (z >= 1) ABOVE LIVE among
--   patch_versions (ptu, eptu) and patch_channel_builds (ptu, evocati; Spectrum lists
--   Evocati builds before any EPTU exists), fallback LIVE + 1 patch. New key `source`.
-- * Sun splinters: verse_patch_version_tips.hit / resolved_at, verse_resolve_version_tips()
--   run by pg_cron every 30 min (a write must not sit in the 8 s authenticated read path).
--   Hit rule = the line tip's rule from verse_explorer_state: |predicted - actual LIVE date
--   (UTC date)| <= 2 days; the actual date of an x.y.z = started_at of its hotfix build in
--   patch_channel_builds. Splinters never count as stars and never move the rank.
-- Alpha policy: new tables/columns only, nothing dropped.
-- ROLLBACK: drop the four rank-idea functions and verse_lit_star_count, drop tables
--   verse_rank_reward_idea_votes / verse_rank_reward_ideas, drop function
--   verse_resolve_version_tips + cron.unschedule('verse-resolve-version-tips'), drop the two
--   columns, restore verse_explorer_state / verse_comet_version_* from 20261025120000 / 20261113120000.

-- ── 1. star count ──────────────────────────────────────────────────────────
create or replace function public.verse_lit_star_count(p_uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.verse_star_progress sp where sp.user_id = p_uid;
$$;
-- Callable for the own uid only (the explorer/idea RPCs pass auth.uid()).
revoke execute on function public.verse_lit_star_count(uuid) from public, anon, authenticated;

-- ── 2. splinter columns + resolver ─────────────────────────────────────────
alter table public.verse_patch_version_tips
  add column if not exists hit boolean,
  add column if not exists resolved_at timestamptz;

create or replace function public.verse_resolve_version_tips()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  -- Only tips whose version has a started hotfix build (= reached LIVE) and are still
  -- unresolved; the hit flag is set exactly once, so running twice awards nothing twice.
  with b as (
    select h.version, min(h.started_at) as started_at
      from public.patch_channel_builds h
     where h.channel = 'hotfix' and h.started_at <= now()
     group by h.version
  ), r as (
    update public.verse_patch_version_tips t
       set hit = abs(t.predicted_live_date - (b.started_at at time zone 'UTC')::date) <= 2,
           resolved_at = now()
      from b
     where t.patch_version = b.version and t.resolved_at is null
    returning 1
  )
  select count(*)::int into v_n from r;
  return v_n;
end;
$$;
revoke execute on function public.verse_resolve_version_tips() from public, anon, authenticated;

select cron.schedule(
  'verse-resolve-version-tips',
  '*/30 * * * *',
  $cron$ select public.verse_resolve_version_tips(); $cron$
);

-- ── 3. x.y.z target with forum detection ───────────────────────────────────
create or replace function public.verse_comet_version_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l record;
  t record;
  v_target text;
begin
  select q.ma, q.mi, q.z into l
    from (
      select split_part(m[1], '.', 1)::int as ma, split_part(m[1], '.', 2)::int as mi,
             coalesce(nullif(split_part(m[1], '.', 3), ''), '0')::int as z
        from (select regexp_match(v.version, '^([0-9]{1,2}\.[0-9]{1,2}(?:\.[0-9]{1,2})?)') as m
                from public.patch_versions v where v.channel = 'live') a
       where m is not null
      union all
      select split_part(m[1], '.', 1)::int, split_part(m[1], '.', 2)::int,
             coalesce(nullif(split_part(m[1], '.', 3), ''), '0')::int
        from (select regexp_match(b.version, '^([0-9]{1,2}\.[0-9]{1,2}(?:\.[0-9]{1,2})?)') as m
                from public.patch_channel_builds b
               where b.channel = 'hotfix' and b.started_at <= now()) c
       where m is not null
    ) q
   order by q.ma desc, q.mi desc, q.z desc
   limit 1;
  if l.ma is null then
    return jsonb_build_object('live', null, 'target', null, 'source', null);
  end if;

  -- Lowest x.y.z (z >= 1) above LIVE in testing or announced: PTU/EPTU rows plus the
  -- PTU and Evocati builds Spectrum lists (threads from the last 120 days, so an old
  -- abandoned row cannot haunt the target). Ties: ptu before eptu before evocati.
  select a.ma, a.mi, a.z, a.src into t
    from (
      select split_part(m[1], '.', 1)::int as ma, split_part(m[1], '.', 2)::int as mi,
             split_part(m[1], '.', 3)::int as z, src
        from (select regexp_match(v.version, '^([0-9]{1,2}\.[0-9]{1,2}\.[1-9][0-9]?)') as m, v.channel as src
                from public.patch_versions v where v.channel in ('ptu', 'eptu')
              union all
              select regexp_match(b.version, '^([0-9]{1,2}\.[0-9]{1,2}\.[1-9][0-9]?)'), b.channel
                from public.patch_channel_builds b
               where b.channel in ('ptu', 'evocati')
                 and b.thread_first_at > now() - interval '120 days') s
       where m is not null
    ) a
   where (a.ma, a.mi, a.z) > (l.ma, l.mi, l.z) and a.z <= 99
   order by a.ma, a.mi, a.z,
            case a.src when 'ptu' then 1 when 'eptu' then 2 else 3 end
   limit 1;

  if t.ma is not null then
    v_target := t.ma || '.' || t.mi || '.' || t.z;
    return jsonb_build_object('live', l.ma || '.' || l.mi || '.' || l.z, 'target', v_target, 'source', t.src);
  end if;
  if l.z + 1 <= 99 then
    v_target := l.ma || '.' || l.mi || '.' || (l.z + 1);
  end if;
  return jsonb_build_object('live', l.ma || '.' || l.mi || '.' || l.z, 'target', v_target,
                            'source', case when v_target is null then null else 'derived' end);
end;
$$;
revoke execute on function public.verse_comet_version_info() from public, anon, authenticated;

-- verse_comet_version_state(): unchanged except the new `splinters` key (caller's hits)
-- and `source` (ptu|eptu|evocati|derived).
create or replace function public.verse_comet_version_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_info jsonb := public.verse_comet_version_info();
  v_target text := v_info ->> 'target';
  v_tip date;
  v_lock text;
  v_ann date;
  v_splinters int;
begin
  if v_uid is null then
    return null;
  end if;
  select count(*)::int into v_splinters
    from public.verse_patch_version_tips t where t.user_id = v_uid and t.hit;
  if v_target is null then
    return jsonb_build_object('patch_version', null, 'patch_line', null, 'live_version', v_info ->> 'live',
                              'source', null, 'splinters', v_splinters, 'comet', null);
  end if;
  v_lock := public.verse_comet_version_lock(v_target);
  select t.predicted_live_date into v_tip
    from public.verse_patch_version_tips t where t.user_id = v_uid and t.patch_version = v_target;
  select a.live_date into v_ann from public.verse_patch_announcements a where a.patch_line = v_target;
  return jsonb_build_object(
    'patch_version', v_target,
    'patch_line', split_part(v_target, '.', 1) || '.' || split_part(v_target, '.', 2),
    'live_version', v_info ->> 'live',
    'source', v_info ->> 'source',
    'splinters', v_splinters,
    'comet', jsonb_build_object(
      'state', case when v_tip is not null then 'tipped' else 'none' end,
      'tipped_date', v_tip,
      'locked', v_lock is not null,
      'locked_reason', v_lock,
      'announced_date', v_ann));
end;
$$;
revoke execute on function public.verse_comet_version_state() from public, anon;
grant execute on function public.verse_comet_version_state() to authenticated;

-- ── 4. reward ideas ────────────────────────────────────────────────────────
create table if not exists public.verse_rank_reward_ideas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 3 and 280),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create table if not exists public.verse_rank_reward_idea_votes (
  idea_id    uuid not null references public.verse_rank_reward_ideas (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);
create index if not exists verse_rank_reward_ideas_user_idx on public.verse_rank_reward_ideas (user_id);
alter table public.verse_rank_reward_ideas enable row level security;
alter table public.verse_rank_reward_idea_votes enable row level security;
-- No policies and no grants: every read and write goes through the security-definer RPCs.
revoke all on public.verse_rank_reward_ideas from anon, authenticated;
revoke all on public.verse_rank_reward_idea_votes from anon, authenticated;

create or replace function public.verse_rank_ideas()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := public.is_admin();
begin
  if v_uid is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(x.o order by x.votes desc, x.created_at desc)
      from (
        select i.created_at,
               (select count(*) from public.verse_rank_reward_idea_votes v where v.idea_id = i.id)::int as votes,
               jsonb_build_object(
                 'id', i.id,
                 'body', i.body,
                 'votes', (select count(*) from public.verse_rank_reward_idea_votes v where v.idea_id = i.id)::int,
                 'voted', exists (select 1 from public.verse_rank_reward_idea_votes v
                                   where v.idea_id = i.id and v.user_id = v_uid),
                 'mine', i.user_id = v_uid,
                 'created_at', i.created_at,
                 'archived', i.archived_at is not null) as o
          from public.verse_rank_reward_ideas i
         where i.archived_at is null or v_admin
      ) x), '[]'::jsonb);
end;
$$;
revoke execute on function public.verse_rank_ideas() from public, anon;
grant execute on function public.verse_rank_ideas() to authenticated;

create or replace function public.verse_submit_rank_idea(p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.verse_lit_star_count(v_uid) < 18 then
    raise exception 'rank_tier_too_low' using errcode = 'P0001';
  end if;
  if char_length(v_body) < 3 or char_length(v_body) > 280 then
    raise exception 'rank_idea_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.verse_rank_reward_ideas i
       where i.user_id = v_uid and i.archived_at is null) >= 3 then
    raise exception 'rank_idea_limit' using errcode = 'P0001';
  end if;
  insert into public.verse_rank_reward_ideas (user_id, body) values (v_uid, v_body) returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.verse_submit_rank_idea(text) from public, anon;
grant execute on function public.verse_submit_rank_idea(text) to authenticated;

create or replace function public.verse_vote_rank_idea(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_voted boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.verse_lit_star_count(v_uid) < 18 then
    raise exception 'rank_tier_too_low' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.verse_rank_reward_ideas i where i.id = p_id) then
    raise exception 'rank_idea_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.verse_rank_reward_ideas i where i.id = p_id and i.archived_at is not null) then
    raise exception 'rank_idea_archived' using errcode = 'P0001';
  end if;
  delete from public.verse_rank_reward_idea_votes where idea_id = p_id and user_id = v_uid;
  if found then
    v_voted := false;
  else
    insert into public.verse_rank_reward_idea_votes (idea_id, user_id) values (p_id, v_uid)
    on conflict do nothing;
    v_voted := true;
  end if;
  return jsonb_build_object('voted', v_voted,
    'votes', (select count(*) from public.verse_rank_reward_idea_votes v where v.idea_id = p_id)::int);
end;
$$;
revoke execute on function public.verse_vote_rank_idea(uuid) from public, anon;
grant execute on function public.verse_vote_rank_idea(uuid) to authenticated;

create or replace function public.verse_archive_rank_idea(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.verse_rank_reward_ideas set archived_at = coalesce(archived_at, now()) where id = p_id;
  if not found then
    raise exception 'rank_idea_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.verse_archive_rank_idea(uuid) from public, anon;
grant execute on function public.verse_archive_rank_idea(uuid) to authenticated;

-- ── 5. explorer state: kartograph.stars + sun_splinters ────────────────────
create or replace function public.verse_explorer_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_patches jsonb := '[]'::jsonb;
  r record;
  c record;
  v_guess jsonb;
  v_revealed boolean;
  v_streak int := 0;
  v_best int := 0;
  v_reserve boolean := false;
  v_next_reserve int := 5;
  v_reserves_used int := 0;
  v_full int := 0;
  v_suns jsonb := '[]'::jsonb;
  v_total int := 0;
  v_up_line text;
  v_upcoming jsonb := null;
  v_live_line text;
  v_live_major int;
  v_live_minor int;
begin
  if v_uid is null then
    return null;
  end if;

  for r in
    with lines as (
      (select p.patch_line, p.live_at
         from public.patch_stability_patches p
        order by p.live_at desc
        limit 12)
      union
      select s.patch_line, p.live_at
        from (select sp.patch_line from public.verse_star_progress sp where sp.user_id = v_uid
              union
              select pp.patch_line from public.patch_prediction pp where pp.user_id = v_uid) s
        left join public.patch_stability_patches p using (patch_line)
    )
    select row_number() over (order by l.live_at asc nulls last, l.patch_line)::int as ord,
           count(*) over ()::int as n,
           -- Lines with a reached LIVE date sort first (asc, nulls last), so the
           -- newest LIVE line has ord = n_live; everything after it is not LIVE yet.
           (count(*) filter (where l.live_at <= now()) over ())::int as n_live,
           l.patch_line,
           l.live_at,
           coalesce((select array_agg(sp.star_key order by sp.earned_at)
                       from public.verse_star_progress sp
                      where sp.user_id = v_uid and sp.patch_line = l.patch_line), '{}') as stars,
           coalesce((select jsonb_object_agg(sp.star_key, sp.earned_at)
                       from public.verse_star_progress sp
                      where sp.user_id = v_uid and sp.patch_line = l.patch_line), '{}'::jsonb) as star_dates,
           coalesce((select l.live_at is not null
                            and abs(pp.predicted_live_date - (l.live_at at time zone 'UTC')::date) <= 2
                       from public.patch_prediction pp
                      where pp.user_id = v_uid and pp.patch_line = l.patch_line), false) as sun
      from lines l
     order by 1
  loop
    if cardinality(r.stars) > 0 or r.sun then
      v_streak := v_streak + 1;
      if v_streak >= v_next_reserve then
        v_reserve := true;
        v_next_reserve := v_streak + 5;
      end if;
    elsif r.live_at is null or r.live_at > now() or r.ord >= r.n_live then
      -- Still open: the newest LIVE patch and every line that is not LIVE yet
      -- (a comet tip on the PTU line must not turn the current LIVE patch into
      -- a missed one) never break the streak.
      null;
    elsif v_reserve then
      v_reserve := false;
      v_reserves_used := v_reserves_used + 1;
    else
      v_streak := 0;
      v_next_reserve := 5;
    end if;
    v_best := greatest(v_best, v_streak);
    v_total := v_total + cardinality(r.stars);
    if cardinality(r.stars) >= 7 then v_full := v_full + 1; end if;
    if r.sun then v_suns := v_suns || to_jsonb(r.patch_line); end if;

    v_guess := public.verse_guess_state(v_uid, r.patch_line);
    v_revealed := (v_guess ->> 'state') in ('correct', 'wrong') or cardinality(r.stars) >= 7;
    select vc.class_name, vc.kind, vc.points into c
      from public.verse_constellations vc where vc.patch_line = r.patch_line;

    -- Newest first in the payload.
    v_patches := jsonb_build_array(jsonb_build_object(
      'patch_line', r.patch_line,
      'live_at', r.live_at,
      'stars', to_jsonb(r.stars),
      'star_dates', r.star_dates,
      'star_count', cardinality(r.stars),
      'sun', r.sun,
      'offered', to_jsonb(public.verse_star_pool(r.patch_line)),
      'constellation', case when c.kind is null then null else jsonb_build_object(
        'class_name', case when v_revealed then coalesce(v_guess ->> 'answer_class', c.class_name) end,
        'name', v_guess -> 'answer_name',
        'kind', c.kind,
        'points', c.points) end,
      'comet', public.verse_comet_state(v_uid, r.patch_line, r.live_at),
      'guess', v_guess,
      'unlocks', jsonb_build_object(
        'log_entry', cardinality(r.stars) > 0 or r.sun,
        'community', cardinality(r.stars) >= 3,
        'wallpaper', cardinality(r.stars) >= 7))) || v_patches;
  end loop;

  -- Live line = the highest well-formed 'major.minor' among the live channel of
  -- patch_versions (a lazily filled cache, empty on a cold DB) and the patch_stability_patches
  -- lines already LIVE (live_at <= now()); several rows or a malformed version
  -- cannot break the map, none at all -> null -> upcoming stays null.
  select l.major || '.' || l.minor, l.major, l.minor
    into v_live_line, v_live_major, v_live_minor
    from (
      select split_part(v.version, '.', 1)::int as major, split_part(v.version, '.', 2)::int as minor
        from public.patch_versions v
       where v.channel = 'live' and v.version ~ '^[0-9]{1,2}\.[0-9]{1,2}(\.|$)'
      union all
      select split_part(p.patch_line, '.', 1)::int, split_part(p.patch_line, '.', 2)::int
        from public.patch_stability_patches p
       where p.live_at <= now() and p.patch_line ~ '^[0-9]{1,2}\.[0-9]{1,2}$'
    ) l
   order by l.major desc, l.minor desc
   limit 1;

  -- 1) The line in the PTU/EPTU ring, as long as it is newer than LIVE.
  select split_part(v.version, '.', 1) || '.' || split_part(v.version, '.', 2)
    into v_up_line
    from public.patch_versions v
   where v.channel in ('ptu', 'eptu')
     and v.version ~ '^[0-9]{1,2}\.[0-9]{1,2}(\.|$)'
     and (v_live_line is null
          -- CASE pins the evaluation order: AND quals may run in any order,
          -- so the casts only see rows the regex above already accepted.
          or (case when v.version ~ '^[0-9]{1,2}\.[0-9]{1,2}(\.|$)'
                   then split_part(v.version, '.', 1)::int end,
              case when v.version ~ '^[0-9]{1,2}\.[0-9]{1,2}(\.|$)'
                   then split_part(v.version, '.', 2)::int end)
             > (v_live_major, v_live_minor))
   order by (v.channel = 'ptu') desc
   limit 1;
  -- 2) Nothing in testing: the tip is always open on LIVE + 1 minor (4.10 -> 4.11).
  if v_up_line is null and v_live_line is not null then
    v_up_line := v_live_major || '.' || (v_live_minor + 1);
  end if;
  if v_up_line is not null and not exists (
       select 1 from public.patch_stability_patches p where p.patch_line = v_up_line and p.live_at <= now()) then
    v_upcoming := jsonb_build_object(
      'patch_line', v_up_line,
      'comet', public.verse_comet_state(v_uid, v_up_line, null));
  end if;

  return jsonb_build_object(
    'patches', v_patches,
    'upcoming', v_upcoming,
    'total_stars', v_total,
    'sun_splinters', (select count(*)::int from public.verse_patch_version_tips t where t.user_id = v_uid and t.hit),
    'suns', v_suns,
    'streak', jsonb_build_object(
      'current', v_streak,
      'best', v_best,
      'reserve_available', v_reserve,
      'reserves_used', v_reserves_used),
    'kartograph', jsonb_build_object('unlocked', v_full >= 1, 'rank', v_full,
      'stars', public.verse_lit_star_count(v_uid)),
    'rewards', jsonb_build_object(
      'road', v_best >= 2,
      'nebula', v_best >= 3,
      'live', v_best >= 4,
      'reserve', v_best >= 5,
      'meteor', v_best >= 6,
      'supernova', v_best >= 7,
      'sun_collection', jsonb_array_length(v_suns) > 0)
  );
end;
$$;

revoke execute on function public.verse_explorer_state() from public, anon;
grant execute on function public.verse_explorer_state() to authenticated;

notify pgrst, 'reload schema';
