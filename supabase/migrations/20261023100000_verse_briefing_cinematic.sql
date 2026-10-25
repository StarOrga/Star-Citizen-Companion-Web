-- Verse briefing cinematic (concept 2026-10-23-verse-briefing-cinematisch), wave 1.
--
-- Adds (nothing is dropped):
--   verse_patch_announcements      public read, admin write — an OFFICIAL LIVE date
--                                  CIG announced for a patch line (closes the comet tip)
--   verse_constellation_guesses    own rows, read only — the one try per patch of the
--                                  "Sternbild erkennen" challenge
-- Changes:
--   verse_constellations           class_name is no longer readable by clients (the
--                                  answer of the guess challenge); column-level grant
--   verse_star_progress            new star key 'cx-guess'
--   verse_star_pool                'cx-guess' joins the pool (priority 3, needs a constellation)
--   patch_prediction insert policy tip closes through verse_comet_lock()
--   verse_explorer_state           per patch: star dates, comet state, guess state;
--                                  top level: `upcoming` (the patch in the test ring)
-- RPCs (all authenticated, SECURITY DEFINER, search_path pinned):
--   verse_guess_options(text)               the 7 options (answer hidden until guessed)
--   verse_guess_constellation(text, text)   the single guess; lights 'cx-guess' when right
--   verse_claim_newship(text, text)         server-validated 'cx-newship' (no oracle)
--   verse_submit_prediction(text, date)     comet tip with a translatable lock error
-- Internal helpers (execute revoked from every client role):
--   verse_guess_candidates, verse_guess_state, verse_comet_state
--
-- Decisions: ONE guess per patch; right = star, wrong = answer revealed, no star.
-- The comet tip locks once the patch is LIVE or an official date is announced; an
-- undetectable announcement leaves the tip open (in the user's favour).

-- ============================================================
-- 1 — announcements (the comet lock signal)
--
-- No existing source carries a reliable "date announced" flag (patch-stability.md:
-- the Spectrum / status / KB sources only know patches that are already LIVE).
-- This table is the explicit signal: an admin (or a future detector running as
-- service_role) records the announced date. Until a row exists the tip stays open.
-- ============================================================
create table if not exists public.verse_patch_announcements (
  patch_line   text        primary key check (char_length(patch_line) between 1 and 32),
  live_date    date        not null,
  source       text        check (source is null or char_length(source) <= 200),
  announced_at timestamptz not null default now()
);

alter table public.verse_patch_announcements enable row level security;
revoke all on public.verse_patch_announcements from anon;
revoke insert, update, delete, truncate on public.verse_patch_announcements from authenticated;
grant select on public.verse_patch_announcements to anon, authenticated;
grant insert, update, delete on public.verse_patch_announcements to authenticated;

drop policy if exists verse_patch_announcements_public_read on public.verse_patch_announcements;
create policy verse_patch_announcements_public_read on public.verse_patch_announcements
  for select to anon, authenticated using (true);
drop policy if exists verse_patch_announcements_admin_write on public.verse_patch_announcements;
create policy verse_patch_announcements_admin_write on public.verse_patch_announcements
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- null = tip open; 'live' = the patch is LIVE; 'announced' = official date known.
create or replace function public.verse_comet_lock(p_patch_line text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.patch_stability_patches p
                  where p.patch_line = p_patch_line and p.live_at <= now())
      or exists (select 1 from public.patch_versions v
                  where v.channel = 'live'
                    and split_part(v.version, '.', 1) || '.' || split_part(v.version, '.', 2) = p_patch_line)
      then 'live'
    when exists (select 1 from public.verse_patch_announcements a where a.patch_line = p_patch_line)
      or exists (select 1 from public.patch_stability_patches p
                  where p.patch_line = p_patch_line and p.live_at > now())
      then 'announced'
    else null
  end;
$$;

revoke execute on function public.verse_comet_lock(text) from public, anon;
grant execute on function public.verse_comet_lock(text) to authenticated;

-- The tip itself: same insert-only rule as before, plus the lock.
drop policy if exists patch_prediction_own_insert on public.patch_prediction;
create policy patch_prediction_own_insert on public.patch_prediction
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and predicted_live_date >= current_date
    and public.verse_comet_lock(patch_prediction.patch_line) is null
  );

create or replace function public.verse_submit_prediction(p_patch_line text, p_date date)
returns jsonb
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
  if p_patch_line is null or p_patch_line !~ '^[0-9]{1,2}\.[0-9]{1,2}$' or p_date is null then
    raise exception 'comet_invalid' using errcode = '22023';
  end if;
  if public.verse_comet_lock(p_patch_line) is not null then
    raise exception 'comet_locked' using errcode = 'P0001';
  end if;
  if p_date < current_date then
    raise exception 'comet_date_past' using errcode = 'P0001';
  end if;
  insert into public.patch_prediction (user_id, patch_line, predicted_live_date)
  values (v_uid, p_patch_line, p_date)
  on conflict do nothing; -- the comet star comes from the insert trigger
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'comet_already_tipped' using errcode = 'P0001';
  end if;
  return jsonb_build_object('patch_line', p_patch_line, 'predicted_live_date', p_date, 'star_earned', true);
end;
$$;

revoke execute on function public.verse_submit_prediction(text, date) from public, anon;
grant execute on function public.verse_submit_prediction(text, date) to authenticated;

-- ============================================================
-- 2 — the constellation answer no longer ships to clients
--
-- Column-level read: everything except class_name. The service role (ingest) and
-- the SECURITY DEFINER RPCs below still see it.
-- ============================================================
revoke select on public.verse_constellations from anon, authenticated;
grant select (patch_line, kind, points, source_build_id, created_at)
  on public.verse_constellations to anon, authenticated;

-- (defined before the pool, which calls it)
-- The answer of a patch's guess, taken from the SAME population as the distractors
-- (current build, not a variant / edition / template, a real localized name, the
-- constellation's entity kind). Returns no row when the hull has no such codex row:
-- the guess is then 'unavailable' - the answer must never carry a name built
-- differently from the distractors' (e.g. from the class name), which would single
-- it out. Never executable by clients.
create or replace function public.verse_guess_answer(p_patch_line text)
returns table (class_name text, name text, entity_kind text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.class_name, s.name_localized, s.entity_kind, s.role
    from public.verse_constellations c
    join public.codex_ships s on lower(s.class_name) = lower(c.class_name)
    join public.codex_builds b on b.id = s.build_id and b.is_current
   where c.patch_line = p_patch_line
     and not s.is_variant
     and s.name_localized is not null
     and s.name_localized !~ '^[@!]'
     and s.name_localized !~* '(edition|special|template)$'
   order by s.created_at desc
   limit 1;
$$;

revoke execute on function public.verse_guess_answer(text) from public, anon, authenticated;

-- ============================================================
-- 3 — star key 'cx-guess' + pool
-- ============================================================
alter table public.verse_star_progress drop constraint if exists verse_star_progress_star_key_check;
alter table public.verse_star_progress add constraint verse_star_progress_star_key_check
  check (star_key in (
    'notes', 'archive', 'loadout', 'comet',
    'cx-newship', 'cx-keybinds', 'cx-changed', 'cx-blueprint', 'cx-fps', 'cx-loadout', 'cx-guess'));

-- Priority 3: the guess takes the slot of the lowest of the seven (cx-loadout falls
-- out of the offered seven for patches that have a constellation). Stars already
-- earned stay earned.
create or replace function public.verse_star_pool(p_patch_line text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with pool(star_key, prio, applies) as (
    values
      ('notes',        1, exists (select 1 from public.patch_stability_patches p where p.patch_line = p_patch_line)),
      ('comet',        2, true),
      ('cx-guess',     3, exists (select 1 from public.verse_guess_answer(p_patch_line))),
      ('cx-newship',   4, exists (select 1 from public.verse_constellations c
                                   where c.patch_line = p_patch_line and c.kind = 'ship')),
      ('archive',      5, true),
      ('loadout',      6, true),
      ('cx-changed',   7, true),
      ('cx-loadout',   8, true),
      ('cx-keybinds',  9, true),
      ('cx-blueprint',10, true),
      ('cx-fps',      11, true)
  )
  select coalesce(array_agg(star_key order by prio), '{}')
    from (select star_key, prio from pool where applies order by prio limit 7) s;
$$;

revoke execute on function public.verse_star_pool(text) from public;
grant execute on function public.verse_star_pool(text) to anon, authenticated;

-- 'cx-guess' is earned by guessing right and 'cx-newship' through
-- verse_claim_newship, never claimed directly.
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
    raise exception 'comet is earned by the prediction' using errcode = '22023';
  end if;
  if p_star_key = 'cx-guess' then
    raise exception 'cx-guess is earned by the guess' using errcode = '22023';
  end if;
  if p_star_key = 'cx-newship' then
    raise exception 'cx-newship is earned through verse_claim_newship' using errcode = '22023';
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

-- ============================================================
-- 4 — the guess challenge
-- ============================================================
create table if not exists public.verse_constellation_guesses (
  user_id       uuid        not null references auth.users (id) on delete cascade,
  patch_line    text        not null check (char_length(patch_line) between 1 and 32),
  guessed_class text        not null,
  answer_class  text        not null,
  answer_name   text        not null,
  correct       boolean     not null,
  created_at    timestamptz not null default now(),
  primary key (user_id, patch_line)
);

alter table public.verse_constellation_guesses enable row level security;
revoke all on public.verse_constellation_guesses from anon;
revoke insert, update, delete, truncate on public.verse_constellation_guesses from authenticated;
grant select on public.verse_constellation_guesses to authenticated;

drop policy if exists verse_constellation_guesses_own_select on public.verse_constellation_guesses;
create policy verse_constellation_guesses_own_select on public.verse_constellation_guesses
  for select to authenticated using (user_id = (select auth.uid()));

-- The 7 shuffled options, deterministic per patch line: the answer + 6 distractors
-- from the current codex builds (same entity kind, same filters as the answer,
-- role-mates first, then a stable hash). Carries is_answer -> never executable by
-- clients. Null when the patch has no usable answer.
create or replace function public.verse_guess_candidates(p_patch_line text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_class text;
  v_name text;
  v_kind text;
  v_role text;
  v_opts jsonb;
begin
  select a.class_name, a.name, a.entity_kind, a.role
    into v_class, v_name, v_kind, v_role
    from public.verse_guess_answer(p_patch_line) a;
  if v_class is null then
    return null;
  end if;

  with d as (
    select distinct on (s.name_localized)
           s.class_name as cn, s.name_localized as nm, s.role as rl
      from public.codex_ships s
      join public.codex_builds b on b.id = s.build_id and b.is_current
     where not s.is_variant
       and s.name_localized is not null
       and s.name_localized !~ '^[@!]'
       and s.name_localized !~* '(edition|special|template)$'
       and lower(s.class_name) <> lower(v_class)
       and lower(s.name_localized) <> lower(v_name)
       and s.entity_kind is not distinct from v_kind
     order by s.name_localized, s.class_name
  ),
  pick as (
    select cn, nm from d
     order by (rl is not distinct from v_role) desc, md5(p_patch_line || ':' || cn)
     limit 6
  ),
  allopts as (
    select v_class as cn, v_name as nm, true as is_answer
    union all
    select cn, nm, false from pick
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('class_name', cn, 'name', nm, 'is_answer', is_answer)
           order by md5('shuffle:' || p_patch_line || ':' || cn)), '[]'::jsonb)
    into v_opts
    from allopts;
  return v_opts;
end;
$$;

revoke execute on function public.verse_guess_candidates(text) from public, anon, authenticated;

-- unavailable (no constellation) | open | correct | wrong. The answer fields stay
-- null while the state is open.
create or replace function public.verse_guess_state(p_uid uuid, p_patch_line text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g record;
begin
  select * into g from public.verse_constellation_guesses
   where user_id = p_uid and patch_line = p_patch_line;
  if found then
    return jsonb_build_object(
      'state', case when g.correct then 'correct' else 'wrong' end,
      'guessed_class', g.guessed_class,
      'answer_class', g.answer_class,
      'answer_name', g.answer_name);
  end if;
  if exists (select 1 from public.verse_guess_answer(p_patch_line)) then
    return jsonb_build_object('state', 'open', 'guessed_class', null, 'answer_class', null, 'answer_name', null);
  end if;
  return jsonb_build_object('state', 'unavailable', 'guessed_class', null, 'answer_class', null, 'answer_name', null);
end;
$$;

revoke execute on function public.verse_guess_state(uuid, text) from public, anon, authenticated;

create or replace function public.verse_guess_options(p_patch_line text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_state jsonb;
  v_cands jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_state := public.verse_guess_state(v_uid, p_patch_line);
  if v_state ->> 'state' = 'unavailable' then
    return v_state || jsonb_build_object('patch_line', p_patch_line, 'options', '[]'::jsonb);
  end if;
  v_cands := public.verse_guess_candidates(p_patch_line);
  return v_state || jsonb_build_object(
    'patch_line', p_patch_line,
    'options', coalesce((select jsonb_agg(jsonb_build_object('class_name', e ->> 'class_name', 'name', e ->> 'name'))
                           from jsonb_array_elements(v_cands) e), '[]'::jsonb));
end;
$$;

revoke execute on function public.verse_guess_options(text) from public, anon;
grant execute on function public.verse_guess_options(text) to authenticated;

create or replace function public.verse_guess_constellation(p_patch_line text, p_class_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cands jsonb;
  v_answer jsonb;
  v_correct boolean;
  v_inserted int;
  v_star boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_cands := public.verse_guess_candidates(p_patch_line);
  if v_cands is null then
    raise exception 'guess_unavailable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_cands) e where e ->> 'class_name' = p_class_name) then
    raise exception 'guess_invalid_option' using errcode = '22023';
  end if;
  select e into v_answer from jsonb_array_elements(v_cands) e where (e ->> 'is_answer')::boolean;
  v_correct := (v_answer ->> 'class_name') = p_class_name;

  insert into public.verse_constellation_guesses
    (user_id, patch_line, guessed_class, answer_class, answer_name, correct)
  values (v_uid, p_patch_line, p_class_name, v_answer ->> 'class_name', v_answer ->> 'name', v_correct)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'guess_already_made' using errcode = 'P0001';
  end if;

  if v_correct then
    insert into public.verse_star_progress (user_id, patch_line, star_key)
    values (v_uid, p_patch_line, 'cx-guess')
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    v_star := v_inserted > 0;
  end if;

  return jsonb_build_object(
    'patch_line', p_patch_line,
    'correct', v_correct,
    'answer_class', v_answer ->> 'class_name',
    'answer_name', v_answer ->> 'name',
    'star_earned', v_star);
end;
$$;

revoke execute on function public.verse_guess_constellation(text, text) from public, anon;
grant execute on function public.verse_guess_constellation(text, text) to authenticated;

-- 'cx-newship' without a client-side answer: the server compares the opened vehicle
-- with the constellation's hull. Returns 'earned' | 'already' | 'no' (not the newest
-- ship, or not offered). 'guess_first' (the guess is still open) is answered BEFORE
-- the comparison: opening the ship would reveal the answer, so the star waits until
-- the user has guessed, and no response depends on the class sent before that.
create or replace function public.verse_claim_newship(p_patch_line text, p_class_name text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_class text;
  v_inserted int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not ('cx-newship' = any (public.verse_star_pool(p_patch_line))) then
    return 'no';
  end if;
  -- The guess gate comes BEFORE any comparison with the hull: until a guess exists
  -- every caller gets the same 'guess_first' whatever class it sends, so the
  -- response cannot be used to probe class names.
  if 'cx-guess' = any (public.verse_star_pool(p_patch_line))
     and not exists (select 1 from public.verse_constellation_guesses g
                      where g.user_id = v_uid and g.patch_line = p_patch_line) then
    return 'guess_first';
  end if;
  select c.class_name into v_class from public.verse_constellations c where c.patch_line = p_patch_line;
  if v_class is null or lower(v_class) <> lower(coalesce(p_class_name, '')) then
    return 'no';
  end if;
  insert into public.verse_star_progress (user_id, patch_line, star_key)
  values (v_uid, p_patch_line, 'cx-newship')
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return case when v_inserted > 0 then 'earned' else 'already' end;
end;
$$;

revoke execute on function public.verse_claim_newship(text, text) from public, anon;
grant execute on function public.verse_claim_newship(text, text) to authenticated;

-- ============================================================
-- 5 — explorer state (extends 20261009100000 §9)
--
-- SECURITY DEFINER now: it reads verse_constellations.class_name, which clients
-- no longer can. Every user-scoped read filters on v_uid explicitly.
-- class_name / name of a constellation are exposed only once the guess exists or
-- the patch is complete (7 stars).
-- Comet state: none | tipped | hit | miss (miss = tipped, LIVE, outside +-2 days).
-- `upcoming` = the patch in the PTU/EPTU ring (not yet LIVE) with the caller's
-- tip and the lock, so the map can offer the comet before any vote exists.
-- ============================================================
create or replace function public.verse_comet_state(p_uid uuid, p_patch_line text, p_live_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tip date;
  v_lock text := public.verse_comet_lock(p_patch_line);
  v_ann date;
  v_state text := 'none';
begin
  select pp.predicted_live_date into v_tip
    from public.patch_prediction pp where pp.user_id = p_uid and pp.patch_line = p_patch_line;
  select a.live_date into v_ann from public.verse_patch_announcements a where a.patch_line = p_patch_line;
  if v_tip is not null then
    if p_live_at is not null and p_live_at <= now() then
      v_state := case when abs(v_tip - (p_live_at at time zone 'UTC')::date) <= 2 then 'hit' else 'miss' end;
    else
      v_state := 'tipped';
    end if;
  end if;
  return jsonb_build_object(
    'state', v_state,
    'tipped_date', v_tip,
    'locked', v_lock is not null,
    'locked_reason', v_lock,
    'announced_date', v_ann);
end;
$$;

revoke execute on function public.verse_comet_state(uuid, text, timestamptz) from public, anon, authenticated;

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

  select split_part(v.version, '.', 1) || '.' || split_part(v.version, '.', 2)
    into v_up_line
    from public.patch_versions v
   where v.channel in ('ptu', 'eptu')
     and v.version is distinct from (select l.version from public.patch_versions l where l.channel = 'live')
   order by (v.channel = 'ptu') desc
   limit 1;
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
