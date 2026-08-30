-- Starscape: tell a clamped caller which version its OWN ring is on.
--
-- Why: `starscape_release_for_channel` clamps the payload to the caller's role
-- (anon → stable), so an alpha-locked install without a session could only ever
-- learn what stable serves. Since alpha runs ahead of stable by definition, the
-- app's "you are provably outdated" hint never fired and the tray had nothing to
-- say but "sign in for alpha updates" — the user could not tell whether that
-- meant "there is something waiting" or "you are already current". Answering
-- "am I up to date?" must not require a login.
--
-- What is disclosed: the VERSION STRING of the requested ring, and nothing else
-- — no URL, no sha256, no size, no release token. The payload (url/sha/size) is
-- still clamped exactly as before, so this cannot install anything across rings.
-- The version is not a secret to begin with: Starscape's binaries are assets of
-- a PUBLIC GitHub mirror release (see `supabase/functions/desktop-latest`), so
-- the number is already readable by anyone. The gate that matters is the
-- download entitlement, which is untouched.
--
-- Signature change (extra `requested_version` column) forces a drop first —
-- Postgres refuses `create or replace` on a changed RETURNS TABLE.

drop function if exists public.starscape_release_for_channel(text);

create function public.starscape_release_for_channel(p_channel text)
returns table (
  channel text,
  version text,
  platforms jsonb,
  notes text,
  created_at timestamptz,
  requested_version text
)
language plpgsql security definer set search_path = public stable as $$
declare
  r    text := public.current_user_role();
  maxc text := case r when 'admin' then 'alpha'
                      when 'collaborator' then 'beta'
                      else 'stable' end;
  rank constant jsonb := '{"stable":0,"beta":1,"alpha":2}'::jsonb;
  eff  text;
  req  text;
begin
  if p_channel is null or not (rank ? p_channel) then
    p_channel := 'stable';
  end if;
  eff := case when (rank->>p_channel)::int > (rank->>maxc)::int then maxc else p_channel end;

  -- The requested ring's version, resolved WITHOUT the role clamp. Deliberately
  -- a separate lookup rather than a join on the returned row: when the caller is
  -- clamped, the returned row IS a different ring, and conflating the two is the
  -- exact bug this migration exists to fix.
  select dr.version into req
  from public.desktop_channels dc
  join public.desktop_releases dr on dr.id = dc.release_id
  where dc.channel = p_channel and dc.product = 'starscape' and dr.token_revoked = false;

  return query
    select dc.channel, dr.version, dr.platforms, dr.notes, dr.created_at, req
    from public.desktop_channels dc
    join public.desktop_releases dr on dr.id = dc.release_id
    where dc.channel = eff and dc.product = 'starscape' and dr.token_revoked = false;
end $$;

grant execute on function public.starscape_release_for_channel(text) to authenticated, anon;
