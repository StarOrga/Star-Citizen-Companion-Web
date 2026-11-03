-- ============================================================
-- 20261103091000_patch_stability_votes_hardening.sql
--
-- The LIVE votes (20261029140000) get the protection the build votes got in
-- 20261103090000 after the #885 red-team pass:
--   - the restrictive is_approved() gate every other self-scoped table has
--     (an unapproved or suspended account can no longer vote via PostgREST),
--   - the aggregate drops votes of accounts that are no longer approved or are
--     suspended,
--   - re-sending the same verdict is a no-op that keeps updated_at, so a script
--     cannot refresh its vote's weight against the 7-day half-life,
--   - the public sums never reveal a single vote: a vote counts from the next
--     full hour on, its age is rounded to the hour, and below 10 counted votes
--     the RPC returns the count only, no split.
-- Same signatures; the client is unchanged (it shows no distribution before
-- 25 effective votes anyway).
--
-- ADDITIVE: one policy; two functions replaced in place.
-- ROLLBACK: drop policy patch_stability_votes_approved_gate on public.patch_stability_votes;
--           restore both functions from 20261029140000_patch_stability_votes.sql.
-- ============================================================

drop policy if exists patch_stability_votes_approved_gate on public.patch_stability_votes;
create policy patch_stability_votes_approved_gate on public.patch_stability_votes
  as restrictive for all to authenticated
  using (public.is_approved()) with check (public.is_approved());

create or replace function public.patch_stability_votes_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- DELETE obeys the same window, otherwise delete + insert would dodge it.
  -- Only for the voter themself: an account deletion cascades with no auth.uid().
  if tg_op = 'DELETE' then
    if auth.uid() is not distinct from old.user_id and now() < old.updated_at + interval '12 hours' then
      raise exception 'vote_change_too_soon'
        using errcode = 'P0001',
              detail = 'A stability vote can be changed once every 12 hours.',
              hint = (old.updated_at + interval '12 hours')::text;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- Same verdict again: nothing changes, not even updated_at (weight refresh).
  if new.verdict is not distinct from old.verdict then
    return old;
  end if;

  -- UPDATE: the row identity is fixed, only the verdict may move.
  new.user_id := old.user_id;
  new.patch_line := old.patch_line;
  new.created_at := old.created_at;

  if now() < old.updated_at + interval '12 hours' then
    raise exception 'vote_change_too_soon'
      using errcode = 'P0001',
            detail = 'A stability vote can be changed once every 12 hours.',
            hint = (old.updated_at + interval '12 hours')::text;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.patch_stability_vote_state(p_line text)
returns table (
  w_stabil           double precision,
  w_wackelig         double precision,
  w_instabil         double precision,
  sum_w              double precision,
  sum_w2             double precision,
  votes              integer,
  own_verdict        text,
  own_next_change_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with weighted as (
    select
      v.verdict,
      case
        when u.created_at > now() - interval '7 days' then 0::double precision
        else power(0.5::double precision,
                   floor(extract(epoch from (now() - v.updated_at)) / 3600) / (7 * 24))
      end as w
    from public.patch_stability_votes v
    join auth.users u on u.id = v.user_id
    join public.profiles p on p.id = v.user_id
    where v.patch_line = p_line
      and p.is_approved
      and (p.suspended_at is null or (p.suspended_until is not null and p.suspended_until <= now()))
      and v.updated_at < date_trunc('hour', now())
  ),
  agg as (
    select count(*)::integer as n,
           sum(w) filter (where verdict = 'stabil')   as ws,
           sum(w) filter (where verdict = 'wackelig') as ww,
           sum(w) filter (where verdict = 'instabil') as wi,
           sum(w) as sw, sum(w * w) as sw2
      from weighted
  ),
  own as (
    select o.verdict, o.updated_at + interval '12 hours' as next_change_at
    from public.patch_stability_votes o
    where o.patch_line = p_line
      and o.user_id = (select auth.uid())
  )
  select
    case when a.n >= 10 then coalesce(a.ws, 0) else 0 end::double precision,
    case when a.n >= 10 then coalesce(a.ww, 0) else 0 end::double precision,
    case when a.n >= 10 then coalesce(a.wi, 0) else 0 end::double precision,
    case when a.n >= 10 then coalesce(a.sw, 0) else 0 end::double precision,
    case when a.n >= 10 then coalesce(a.sw2, 0) else 0 end::double precision,
    a.n,
    (select verdict from own),
    (select next_change_at from own)
  from agg a;
$$;

comment on function public.patch_stability_vote_state(text) is
  'Weighted community-verdict sums for one patch line (accounts < 7 days old '
  'weigh 0, half-life 7 days on the vote''s updated_at rounded to the hour, '
  'unapproved / suspended voters dropped, votes counted from the next full hour, '
  'split withheld below 10 votes) plus the counted votes and the caller''s own '
  'vote with the time it becomes changeable. SECURITY DEFINER; returns no user '
  'id. Always exactly one row. The correction formula is client-side.';
