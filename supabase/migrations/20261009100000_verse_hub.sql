-- Verse hub (concept 2026-10-08-verse-hub): one tab for Verse News, Patch News
-- and the Starscape gallery, plus the "Explorer" star-map gamification.
--
-- Adds (nothing is dropped — alpha data policy not exercised here):
--   verse_seen            own rows   — which briefing items a user has seen
--   patch_readiness       own rows   — per-patch prep checklist
--   patch_prediction      own rows   — the "comet vote" (predicted LIVE date),
--                                       insert-only and only before LIVE
--   verse_star_progress   own read   — earned stars; written only through
--                                       verse_earn_star() / the comet trigger
--   verse_constellations  public read, service_role write — 7-point hull
--                                       silhouettes the Data Uploader ingests
--   verse_pins            public read, admin write — briefing pins
-- RPCs:
--   verse_digest()                 anon+authenticated, stable, cheap (anon 3 s)
--   patch_prediction_median(text)  median only after the caller's own vote
--   verse_star_pool(text)          the <= 7 star keys offered for a patch
--   verse_earn_star(text, text)    server-validated star insert
--   verse_explorer_state()         stars, suns, streak, reserve, unlocks

-- ============================================================
-- 1 — verse_seen
-- ============================================================
create table if not exists public.verse_seen (
  user_id  uuid        not null references auth.users (id) on delete cascade default auth.uid(),
  item_key text        not null check (char_length(item_key) between 1 and 200),
  seen_at  timestamptz not null default now(),
  primary key (user_id, item_key)
);

alter table public.verse_seen enable row level security;
revoke all on public.verse_seen from anon;
grant select, insert, update, delete on public.verse_seen to authenticated;

drop policy if exists verse_seen_own_select on public.verse_seen;
create policy verse_seen_own_select on public.verse_seen
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists verse_seen_own_insert on public.verse_seen;
create policy verse_seen_own_insert on public.verse_seen
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists verse_seen_own_update on public.verse_seen;
create policy verse_seen_own_update on public.verse_seen
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists verse_seen_own_delete on public.verse_seen;
create policy verse_seen_own_delete on public.verse_seen
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================
-- 2 — patch_readiness
-- ============================================================
create table if not exists public.patch_readiness (
  user_id    uuid        not null references auth.users (id) on delete cascade default auth.uid(),
  patch_line text        not null check (char_length(patch_line) between 1 and 32),
  checklist  jsonb       not null default '{}'::jsonb
             check (jsonb_typeof(checklist) = 'object' and pg_column_size(checklist) <= 8192),
  updated_at timestamptz not null default now(),
  primary key (user_id, patch_line)
);

alter table public.patch_readiness enable row level security;
revoke all on public.patch_readiness from anon;
grant select, insert, update, delete on public.patch_readiness to authenticated;

drop policy if exists patch_readiness_own_select on public.patch_readiness;
create policy patch_readiness_own_select on public.patch_readiness
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists patch_readiness_own_insert on public.patch_readiness;
create policy patch_readiness_own_insert on public.patch_readiness
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists patch_readiness_own_update on public.patch_readiness;
create policy patch_readiness_own_update on public.patch_readiness
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists patch_readiness_own_delete on public.patch_readiness;
create policy patch_readiness_own_delete on public.patch_readiness
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================
-- 3 — patch_prediction (the comet vote)
--
-- Insert-only on purpose: the community median is revealed after the vote, so
-- an editable vote could simply be moved onto the median. A vote is accepted
-- only while the patch is not LIVE yet (no patch_stability_patches row with a
-- past live_at).
-- ============================================================
create table if not exists public.patch_prediction (
  user_id             uuid        not null references auth.users (id) on delete cascade default auth.uid(),
  patch_line          text        not null check (char_length(patch_line) between 1 and 32),
  predicted_live_date date        not null,
  created_at          timestamptz not null default now(),
  primary key (user_id, patch_line)
);

create index if not exists patch_prediction_patch_line_idx
  on public.patch_prediction (patch_line, predicted_live_date);

alter table public.patch_prediction enable row level security;
revoke all on public.patch_prediction from anon;
revoke update, delete, truncate on public.patch_prediction from authenticated;
grant select, insert on public.patch_prediction to authenticated;

drop policy if exists patch_prediction_own_select on public.patch_prediction;
create policy patch_prediction_own_select on public.patch_prediction
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists patch_prediction_own_insert on public.patch_prediction;
create policy patch_prediction_own_insert on public.patch_prediction
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and predicted_live_date >= current_date
    and not exists (
      select 1 from public.patch_stability_patches p
       where p.patch_line = patch_prediction.patch_line and p.live_at <= now()
    )
  );

-- ============================================================
-- 4 — verse_constellations (contract with the Data Uploader)
--
-- One 7-point silhouette per patch line: the newest ship / ground vehicle hull
-- seen from above, reduced with Douglas-Peucker. points = exactly 7 [x, y]
-- pairs normalised to 0..1. Written by service_role only (ingest path).
-- ============================================================
create or replace function public.verse_constellation_points_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) = 7
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'array'
           or jsonb_array_length(e) <> 2
           or jsonb_typeof(e -> 0) <> 'number'
           or jsonb_typeof(e -> 1) <> 'number'
           or (e ->> 0)::numeric not between 0 and 1
           or (e ->> 1)::numeric not between 0 and 1
     );
$$;

create table if not exists public.verse_constellations (
  patch_line      text        primary key check (char_length(patch_line) between 1 and 32),
  class_name      text        not null,
  kind            text        not null check (kind in ('ship', 'ground')),
  points          jsonb       not null check (public.verse_constellation_points_valid(points)),
  source_build_id text,
  created_at      timestamptz not null default now()
);

alter table public.verse_constellations enable row level security;
revoke insert, update, delete, truncate on public.verse_constellations from anon, authenticated;
grant select on public.verse_constellations to anon, authenticated;

drop policy if exists verse_constellations_public_read on public.verse_constellations;
create policy verse_constellations_public_read on public.verse_constellations
  for select to anon, authenticated using (true);

-- ============================================================
-- 5 — verse_pins (admin pins for the briefing top list)
-- ============================================================
create table if not exists public.verse_pins (
  item_key     text        primary key check (char_length(item_key) between 1 and 200),
  kind         text        not null check (kind in ('news', 'patch', 'gallery', 'link')),
  title        text        not null check (char_length(title) between 1 and 200),
  url          text        check (url is null or url ~ '^(https://|/)'),
  summary      text        check (summary is null or char_length(summary) <= 500),
  weight       int         not null default 0 check (weight between -100 and 100),
  pinned_until timestamptz,
  created_by   uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.verse_pins enable row level security;
revoke insert, update, delete, truncate on public.verse_pins from anon;
grant select on public.verse_pins to anon, authenticated;
grant insert, update, delete on public.verse_pins to authenticated;

drop policy if exists verse_pins_public_read on public.verse_pins;
create policy verse_pins_public_read on public.verse_pins
  for select to anon, authenticated
  using (pinned_until is null or pinned_until > now());
drop policy if exists verse_pins_admin_write on public.verse_pins;
create policy verse_pins_admin_write on public.verse_pins
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 6 — verse_star_progress
--
-- Read own rows; no direct write grant. Stars enter through verse_earn_star()
-- (pool-validated) or, for 'comet', the prediction trigger below.
-- ============================================================
create table if not exists public.verse_star_progress (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  patch_line text        not null check (char_length(patch_line) between 1 and 32),
  star_key   text        not null check (star_key in (
               'notes', 'archive', 'loadout', 'comet',
               'cx-newship', 'cx-keybinds', 'cx-changed', 'cx-blueprint', 'cx-fps', 'cx-loadout')),
  earned_at  timestamptz not null default now(),
  primary key (user_id, patch_line, star_key)
);

alter table public.verse_star_progress enable row level security;
revoke all on public.verse_star_progress from anon;
revoke insert, update, delete, truncate on public.verse_star_progress from authenticated;
grant select on public.verse_star_progress to authenticated;

drop policy if exists verse_star_progress_own_select on public.verse_star_progress;
create policy verse_star_progress_own_select on public.verse_star_progress
  for select to authenticated using (user_id = (select auth.uid()));

-- ============================================================
-- 7 — star pool: the <= 7 keys offered for a patch
--
-- Fixed priority; a key whose source does not exist for this patch is skipped
-- and the next one from the pool fills the slot. Currently only two sources
-- are conditional: 'notes' needs patch notes (a patch_stability_patches row),
-- 'cx-newship' needs a ship constellation for the patch (the uploader only
-- writes one when the patch brought a new ship).
-- ============================================================
create or replace function public.verse_star_pool(p_patch_line text)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  with pool(star_key, prio, applies) as (
    values
      ('notes',        1, exists (select 1 from public.patch_stability_patches p where p.patch_line = p_patch_line)),
      ('comet',        2, true),
      ('cx-newship',   3, exists (select 1 from public.verse_constellations c
                                   where c.patch_line = p_patch_line and c.kind = 'ship')),
      ('archive',      4, true),
      ('loadout',      5, true),
      ('cx-changed',   6, true),
      ('cx-loadout',   7, true),
      ('cx-keybinds',  8, true),
      ('cx-blueprint', 9, true),
      ('cx-fps',      10, true)
  )
  select coalesce(array_agg(star_key order by prio), '{}')
    from (select star_key, prio from pool where applies order by prio limit 7) s;
$$;

revoke execute on function public.verse_star_pool(text) from public;
grant execute on function public.verse_star_pool(text) to anon, authenticated;

create or replace function public.verse_earn_star(p_patch_line text, p_star_key text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inserted int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_star_key = 'comet' then
    -- Earned by submitting the prediction (trigger), never claimed directly.
    raise exception 'comet is earned by the prediction' using errcode = '22023';
  end if;
  if not (p_star_key = any (public.verse_star_pool(p_patch_line))) then
    raise exception 'star % not offered for patch %', p_star_key, p_patch_line using errcode = '22023';
  end if;
  insert into public.verse_star_progress (user_id, patch_line, star_key)
  values (v_uid, p_patch_line, p_star_key)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

revoke execute on function public.verse_earn_star(text, text) from public, anon;
grant execute on function public.verse_earn_star(text, text) to authenticated;

create or replace function public.verse_prediction_comet_star()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.verse_star_progress (user_id, patch_line, star_key)
  values (new.user_id, new.patch_line, 'comet')
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.verse_prediction_comet_star() from public, anon, authenticated;

drop trigger if exists patch_prediction_comet_star on public.patch_prediction;
create trigger patch_prediction_comet_star
  after insert on public.patch_prediction
  for each row execute function public.verse_prediction_comet_star();

-- ============================================================
-- 8 — community median, only after the caller's own vote
-- ============================================================
create or replace function public.patch_prediction_median(p_patch_line text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.patch_prediction
     where user_id = v_uid and patch_line = p_patch_line
  ) then
    return null; -- no leak before voting
  end if;
  select jsonb_build_object(
           'patch_line', p_patch_line,
           'median', percentile_disc(0.5) within group (order by predicted_live_date),
           'votes', count(*))
    into v_result
    from public.patch_prediction
   where patch_line = p_patch_line;
  return v_result;
end;
$$;

revoke execute on function public.patch_prediction_median(text) from public, anon;
grant execute on function public.patch_prediction_median(text) to authenticated;

-- ============================================================
-- 9 — explorer state
--
-- Patches = the last 12 LIVE lines (patch_stability_patches) plus any line the
-- caller has progress or a vote on (an upcoming patch), ordered by live_at,
-- unreleased last. Sun = own prediction within +-2 days of live_at.
-- Streak walks oldest -> newest: a patch with >= 1 star (or a sun) extends
-- it; a gap is bridged by a held reserve (earned every 5 streak patches),
-- otherwise resets. The newest patch never breaks the streak while it has no
-- star yet (it is still open).
-- Streak rewards unlock on the BEST streak so they are never taken away:
-- road 2, nebula 3, live 4, reserve 5, meteor 6, supernova 7.
-- ============================================================
create or replace function public.verse_explorer_state()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_patches jsonb := '[]'::jsonb;
  r record;
  v_streak int := 0;
  v_best int := 0;
  v_reserve boolean := false;
  v_next_reserve int := 5;
  v_reserves_used int := 0;
  v_full int := 0;
  v_suns jsonb := '[]'::jsonb;
  v_total int := 0;
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
           l.patch_line,
           l.live_at,
           coalesce((select array_agg(sp.star_key order by sp.earned_at)
                       from public.verse_star_progress sp
                      where sp.user_id = v_uid and sp.patch_line = l.patch_line), '{}') as stars,
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
    elsif r.ord = r.n then
      null; -- the newest patch is still open, it never breaks the streak
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
    -- Newest first in the payload.
    v_patches := jsonb_build_array(jsonb_build_object(
      'patch_line', r.patch_line,
      'live_at', r.live_at,
      'stars', to_jsonb(r.stars),
      'star_count', cardinality(r.stars),
      'sun', r.sun,
      'offered', to_jsonb(public.verse_star_pool(r.patch_line)),
      'constellation', (select jsonb_build_object('class_name', c.class_name, 'kind', c.kind, 'points', c.points)
                          from public.verse_constellations c where c.patch_line = r.patch_line),
      'unlocks', jsonb_build_object(
        'log_entry', cardinality(r.stars) > 0 or r.sun,
        'community', cardinality(r.stars) >= 3,
        'wallpaper', cardinality(r.stars) >= 7))) || v_patches;
  end loop;

  return jsonb_build_object(
    'patches', v_patches,
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

-- ============================================================
-- 10 — verse_digest: the briefing payload
--
-- Cheap by construction (anon statement timeout 3 s): every source is read
-- through an existing index with a small LIMIT. The news feed itself lives in
-- the fetch-verse-news edge function; news_cache is read only when populated.
-- Ranking: admin pins first (1000 + weight), then recency-decayed scores per
-- source. `suggested` = adaptive 3..7 (items scoring >= 40). Seen-state is
-- applied client-side so the payload stays identical for everyone and can be
-- cached (Cache-Control max-age=60, stale-while-revalidate).
-- ============================================================
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
    (select 'gallery:' || w.image_id, 'gallery', coalesce(w.title, w.series, ''), '/verse/gallery?image=' || w.image_id,
            null, w.preview_url, w.published_at, false,
            60 - 6 * extract(epoch from (now() - w.published_at)) / 86400
       from public.verse_wallpapers w
      where w.variant_role in ('single', 'primary')
        and w.published_at > now() - interval '14 days'
      order by w.published_at desc nulls last limit 3)
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
