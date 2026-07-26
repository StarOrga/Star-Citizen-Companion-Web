-- 20260726160000_starscape_channels.sql
-- Release channels for Starscape (wallpaper-app), so the tray app can self-update
-- against the ring it was downloaded from.
--
-- Until now `desktop_channels` was implicitly uploader-only: its primary key was
-- `channel` alone. Starscape needs its own alpha/beta/stable pointers, so the
-- table becomes product-scoped — PK `(product, channel)`.
--
-- IMPORTANT — every call site that depends on the old single-column key is
-- updated in this same change. `on conflict (channel)` now raises "no unique or
-- exclusion constraint matching the ON CONFLICT specification", and an unfiltered
-- join returns one row per product, so none of these are optional:
--   1. desktop_release_for_channel() joined desktop_channels with no product
--      filter → would return TWO rows per channel once Starscape rows exist.
--   2. promote_desktop_channel() used `on conflict (channel)`.
--   3. supabase/functions/desktop-latest — `.eq('channel', …).maybeSingle()` on
--      the release-token path (fixed in index.ts by adding a product filter).
--   4. .github/workflows/data-uploader-build.yml — the register SQL the uploader
--      release step PRINTS. Not executed by CI, so nothing here would have caught
--      it; the next uploader release would simply have failed to register.
--   5. .claude/deep-knowledge/data-uploader-release.md and
--      .claude/skills/devops-ship/SKILL.md carry the same statement by hand.
-- (The `docs/superpowers/` plan + spec keep the old form on purpose — they are a
--  record of what was built in 2026-07, not instructions.)
--
-- Alpha-phase policy: additive column + key swap, no rows dropped.

-- 1. Product-scope the pointer table -------------------------------------------
alter table public.desktop_channels
  add column if not exists product text not null default 'uploader';

-- Re-runnable: `add primary key` has no `if not exists`, so a second apply (or a
-- partial apply that got as far as the swap) would fail with "multiple primary
-- keys for table are not allowed". Guard on the constraint's presence instead.
-- Widening only: every existing row already has product='uploader' from the
-- column default, so (product, channel) is unique wherever channel was.
do $$
begin
  alter table public.desktop_channels drop constraint if exists desktop_channels_pkey;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.desktop_channels'::regclass and contype = 'p'
  ) then
    alter table public.desktop_channels add primary key (product, channel);
  end if;
end $$;

-- 2. Uploader resolver — unchanged semantics, now explicitly product-scoped ----
create or replace function public.desktop_release_for_channel(p_channel text)
returns table (channel text, version text, platforms jsonb, notes text, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare
  r    text := public.current_user_role();               -- 'viewer' when anon
  maxc text := case r when 'admin' then 'alpha'
                      when 'collaborator' then 'beta'
                      else 'stable' end;
  rank constant jsonb := '{"stable":0,"beta":1,"alpha":2}'::jsonb;
  eff  text;
begin
  if p_channel is null or not (rank ? p_channel) then
    p_channel := 'stable';
  end if;
  eff := case when (rank->>p_channel)::int > (rank->>maxc)::int then maxc else p_channel end;
  return query
    select dc.channel, dr.version, dr.platforms, dr.notes, dr.created_at
    from public.desktop_channels dc
    join public.desktop_releases dr on dr.id = dc.release_id
    where dc.channel = eff and dc.product = 'uploader';
end $$;

grant execute on function public.desktop_release_for_channel(text) to authenticated, anon;

-- 3. Uploader promotion — same monotonic rule, product-scoped upsert ----------
create or replace function public.promote_desktop_channel(p_version text, p_to_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare
  rank constant jsonb := '{"stable":0,"beta":1,"alpha":2}'::jsonb;
  v_release_id uuid;
  v_new_created timestamptz;
  higher text;
  v_higher_created timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;
  if not (rank ? p_to_channel) then
    raise exception 'invalid channel: %', p_to_channel;
  end if;
  select id, created_at into v_release_id, v_new_created
    from public.desktop_releases where version = p_version and product = 'uploader';
  if v_release_id is null then
    raise exception 'unknown release version: %', p_version;
  end if;
  higher := case p_to_channel when 'stable' then 'beta' when 'beta' then 'alpha' else null end;
  if higher is not null then
    select dr.created_at into v_higher_created
      from public.desktop_channels dc join public.desktop_releases dr on dr.id = dc.release_id
      where dc.channel = higher and dc.product = 'uploader';
    if v_higher_created is null or v_new_created > v_higher_created then
      raise exception 'monotonicity: % must reach % before %', p_version, higher, p_to_channel;
    end if;
  end if;
  insert into public.desktop_channels (product, channel, release_id, updated_at)
  values ('uploader', p_to_channel, v_release_id, now())
  on conflict (product, channel) do update
    set release_id = excluded.release_id, updated_at = now();
end $$;

grant execute on function public.promote_desktop_channel(text, text) to authenticated;

-- 4. Starscape resolver --------------------------------------------------------
--    Same role clamp as the uploader (admin→alpha, collaborator→beta,
--    viewer/anon→stable) but over the Starscape pointers. anon-executable: the
--    binaries are public GitHub-mirror assets, and an unauthenticated tray app
--    must still be able to see that a newer STABLE build exists. Returns only
--    public download metadata — never release_token.
create or replace function public.starscape_release_for_channel(p_channel text)
returns table (channel text, version text, platforms jsonb, notes text, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare
  r    text := public.current_user_role();
  maxc text := case r when 'admin' then 'alpha'
                      when 'collaborator' then 'beta'
                      else 'stable' end;
  rank constant jsonb := '{"stable":0,"beta":1,"alpha":2}'::jsonb;
  eff  text;
begin
  if p_channel is null or not (rank ? p_channel) then
    p_channel := 'stable';
  end if;
  eff := case when (rank->>p_channel)::int > (rank->>maxc)::int then maxc else p_channel end;
  return query
    select dc.channel, dr.version, dr.platforms, dr.notes, dr.created_at
    from public.desktop_channels dc
    join public.desktop_releases dr on dr.id = dc.release_id
    where dc.channel = eff and dc.product = 'starscape' and dr.token_revoked = false;
end $$;

grant execute on function public.starscape_release_for_channel(text) to authenticated, anon;

-- 5. Starscape promotion -------------------------------------------------------
create or replace function public.promote_starscape_channel(p_version text, p_to_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare
  rank constant jsonb := '{"stable":0,"beta":1,"alpha":2}'::jsonb;
  v_release_id uuid;
  v_new_created timestamptz;
  higher text;
  v_higher_created timestamptz;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;
  if not (rank ? p_to_channel) then
    raise exception 'invalid channel: %', p_to_channel;
  end if;
  select id, created_at into v_release_id, v_new_created
    from public.desktop_releases where version = p_version and product = 'starscape';
  if v_release_id is null then
    raise exception 'unknown starscape version: %', p_version;
  end if;
  higher := case p_to_channel when 'stable' then 'beta' when 'beta' then 'alpha' else null end;
  if higher is not null then
    select dr.created_at into v_higher_created
      from public.desktop_channels dc join public.desktop_releases dr on dr.id = dc.release_id
      where dc.channel = higher and dc.product = 'starscape';
    if v_higher_created is null or v_new_created > v_higher_created then
      raise exception 'monotonicity: % must reach % before %', p_version, higher, p_to_channel;
    end if;
  end if;
  insert into public.desktop_channels (product, channel, release_id, updated_at)
  values ('starscape', p_to_channel, v_release_id, now())
  on conflict (product, channel) do update
    set release_id = excluded.release_id, updated_at = now();
end $$;

grant execute on function public.promote_starscape_channel(text, text) to authenticated;

-- 6. Seed: point all three Starscape rings at the newest registered build ------
--    Matches the original desktop_channels seed (stable ⊆ beta ⊆ alpha). A no-op
--    when no Starscape release is registered yet; the first tagged release then
--    seeds them via the CI-printed register SQL.
insert into public.desktop_channels (product, channel, release_id)
select 'starscape', c.channel, r.id
from (values ('alpha'),('beta'),('stable')) as c(channel)
cross join lateral (
  select id from public.desktop_releases
  where product = 'starscape' and token_revoked = false
  order by created_at desc limit 1
) r
on conflict (product, channel) do nothing;
