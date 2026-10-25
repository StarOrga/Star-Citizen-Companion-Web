-- Comet tip target is always the next patch.
--
-- Before: verse_explorer_state().upcoming came only from patch_versions rows in
-- the ptu/eptu channel. With no PTU running (LIVE 4.10, nothing in testing) it
-- was null and the map showed "tips for 4.10 closed" although 4.10 is already
-- LIVE.
-- Now: upcoming = the PTU/EPTU line when it is newer than LIVE (as before), else
-- LIVE + 1 minor (4.10 -> 4.11), as long as that line has no
-- patch_stability_patches row with live_at <= now(). LIVE is read robustly
-- (patch_versions is empty on a cold DB, so patch_stability_patches counts too;
-- none at all -> upcoming stays null). upcoming.comet = verse_comet_state(uid, line, null).
-- Tip RPC: verse_submit_prediction / the insert policy only check the format and
-- verse_comet_lock (LIVE or announced => refused), never patch_versions, so a
-- tip on 4.11 is already accepted; no change needed there. Only
-- create or replace of verse_explorer_state; signature, security definer,
-- search_path and grants unchanged. No schema change.

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
    'suns', v_suns,
    'streak', jsonb_build_object(
      'current', v_streak,
      'best', v_best,
      'reserve_available', v_reserve,
      'reserves_used', v_reserves_used),
    'kartograph', jsonb_build_object('unlocked', v_full >= 1, 'rank', v_full),
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
