-- 20260720000000_desktop_channels.sql
-- Release-channel selection for the desktop uploader (alpha/beta/stable).
-- Promotion-pointer model: desktop_releases becomes an immutable build catalog;
-- desktop_channels decides which build each channel currently serves.
-- Alpha-phase policy: drops desktop_releases.is_current + its dedupe trigger
-- (superseded by the per-channel pointer). No auth.users / profiles data touched.

-- 1. Pointer table -------------------------------------------------------------
create table if not exists public.desktop_channels (
  channel     text primary key check (channel in ('alpha','beta','stable')),
  release_id  uuid not null references public.desktop_releases(id) on delete restrict,
  updated_at  timestamptz not null default now()
);

alter table public.desktop_channels enable row level security;

-- Reads go exclusively through the SECURITY DEFINER RPC below, so no broad
-- SELECT policy. Admin may inspect/repair directly.
drop policy if exists "desktop_channels_admin_all" on public.desktop_channels;
create policy "desktop_channels_admin_all" on public.desktop_channels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 2. Seed: current build → all three channels (stable ⊆ beta ⊆ alpha) ----------
--    Runs before is_current is dropped below, so the column is still present.
insert into public.desktop_channels (channel, release_id)
select c.channel, r.id
from (values ('alpha'),('beta'),('stable')) as c(channel)
cross join lateral (
  select id from public.desktop_releases
  where is_current order by created_at desc limit 1
) r
on conflict (channel) do nothing;

-- 3. Retire the single-global-current machinery --------------------------------
drop trigger if exists desktop_releases_dedupe on public.desktop_releases;
drop function if exists public.dr_dedupe_current();
drop index if exists public.desktop_releases_current_idx;
alter table public.desktop_releases drop column if exists is_current;

-- 4. Role-clamped resolver -----------------------------------------------------
--    Returns the release for the requested channel, clamped down to the
--    caller's tier: admin→alpha, collaborator→beta, viewer/anon→stable.
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
  -- clamp requested channel down to the caller's max tier
  eff := case when (rank->>p_channel)::int > (rank->>maxc)::int then maxc else p_channel end;
  return query
    select dc.channel, dr.version, dr.platforms, dr.notes, dr.created_at
    from public.desktop_channels dc
    join public.desktop_releases dr on dr.id = dc.release_id
    where dc.channel = eff;
end $$;

grant execute on function public.desktop_release_for_channel(text) to authenticated, anon;

-- 5. Admin promotion (roll-forward only, monotonic) ----------------------------
--    stable ⊆ beta ⊆ alpha: a version may only enter a lower ring once it has
--    reached the next-higher ring (or is the same-or-older build there).
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
    from public.desktop_releases where version = p_version;
  if v_release_id is null then
    raise exception 'unknown release version: %', p_version;
  end if;
  -- Monotonicity: a release may only enter stable if it is already the beta
  -- pointer's release-or-older, and beta only if alpha's-or-older.
  higher := case p_to_channel when 'stable' then 'beta' when 'beta' then 'alpha' else null end;
  if higher is not null then
    select dr.created_at into v_higher_created
      from public.desktop_channels dc join public.desktop_releases dr on dr.id = dc.release_id
      where dc.channel = higher;
    if v_higher_created is null or v_new_created > v_higher_created then
      raise exception 'monotonicity: % must reach % before %', p_version, higher, p_to_channel;
    end if;
  end if;
  insert into public.desktop_channels (channel, release_id, updated_at)
  values (p_to_channel, v_release_id, now())
  on conflict (channel) do update set release_id = excluded.release_id, updated_at = now();
end $$;

grant execute on function public.promote_desktop_channel(text, text) to authenticated;
