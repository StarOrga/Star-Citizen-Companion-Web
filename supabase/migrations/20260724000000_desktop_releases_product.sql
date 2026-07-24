-- 20260724000000_desktop_releases_product.sql
-- Multi-product desktop_releases: register Starscape (wallpaper-app) alongside
-- the data-uploader. Existing rows default to 'uploader'.
--
-- Starscape deliberately uses a SIMPLE resolver — newest build by created_at,
-- NO channels, NO role-clamp, NO release-token gate: its binary is a public
-- GitHub-mirror asset and it has no in-app updater. The data-uploader channel /
-- ring flow is left untouched; the only uploader-side change here is hardening
-- promote_desktop_channel against a future cross-product version collision.
--
-- Alpha-phase policy: additive column + new function only, no data dropped.

-- 1. Product discriminator ----------------------------------------------------
alter table public.desktop_releases
  add column if not exists product text not null default 'uploader';

-- 2. Harden the uploader promotion RPC: resolve ONLY uploader builds, so a
--    future Starscape version string can never be promoted through the rings by
--    accident (both products share the `version` text column).
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
  -- Monotonicity: a release may only enter a lower ring once it reached the
  -- next-higher ring (or is the same-or-older build there).
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

-- 3. Starscape latest resolver ------------------------------------------------
--    Newest Starscape build; anon-executable so the (public) Starscape gallery
--    page can show the current version + a hash-verified download without auth.
--    SECURITY DEFINER to read the RLS-protected catalog, but it exposes ONLY the
--    public download metadata (version / platforms / notes) — never release_token.
create or replace function public.starscape_latest_release()
returns table (version text, platforms jsonb, notes text, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select version, platforms, notes, created_at
  from public.desktop_releases
  where product = 'starscape' and token_revoked = false
  order by created_at desc
  limit 1
$$;

grant execute on function public.starscape_latest_release() to authenticated, anon;
