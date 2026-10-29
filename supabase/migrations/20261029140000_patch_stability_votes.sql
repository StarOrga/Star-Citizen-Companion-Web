-- ============================================================
-- 20261029140000_patch_stability_votes.sql
--
-- Community verdict on a patch line's stability (concept 2026-10-29
-- patch-stabilitaet-anzeige): a signed-in user rates the LIVE line
-- stabil / wackelig / instabil. One vote per (user, line); a vote may be
-- changed at most every 12 hours, enforced HERE (trigger), not in the client.
--
-- Privacy: patch_stability_votes is self-read only (RLS). The client never
-- sees other users' rows; it gets the aggregate from
-- patch_stability_vote_state(), a SECURITY DEFINER function that returns
-- weighted sums only and no user id (same precedent as starscape_vote_state()).
--
-- The weighting lives in SQL because the weights need auth.users.created_at,
-- which no client may read:
--   w = 0                           when the account is younger than 7 days,
--   w = 0.5 ^ (vote age / 7 days)   otherwise (half-life 7 d on updated_at).
-- The client turns the sums into a correction (src/app/news/patch-stability.ts,
-- communityCorrection) - the formula stays in exactly one place.
--
-- ADDITIVE: one table, two functions; nothing dropped or renamed.
-- ============================================================

create table if not exists public.patch_stability_votes (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  patch_line text        not null references public.patch_stability_patches (patch_line) on delete cascade,
  verdict    text        not null check (verdict in ('stabil', 'wackelig', 'instabil')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, patch_line)
);

comment on table public.patch_stability_votes is
  'One community stability verdict per (user, patch line). Self-read only; the '
  'public aggregate comes from patch_stability_vote_state(). A vote can be '
  'changed at most every 12 hours (trigger patch_stability_votes_guard).';

-- The 12 h rule and the timestamps are not the client's to set.
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

drop trigger if exists patch_stability_votes_guard on public.patch_stability_votes;
create trigger patch_stability_votes_guard
  before insert or update or delete on public.patch_stability_votes
  for each row execute function public.patch_stability_votes_guard();

alter table public.patch_stability_votes enable row level security;

drop policy if exists patch_stability_votes_self_read on public.patch_stability_votes;
create policy patch_stability_votes_self_read on public.patch_stability_votes
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists patch_stability_votes_self_insert on public.patch_stability_votes;
create policy patch_stability_votes_self_insert on public.patch_stability_votes
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists patch_stability_votes_self_update on public.patch_stability_votes;
create policy patch_stability_votes_self_update on public.patch_stability_votes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists patch_stability_votes_self_delete on public.patch_stability_votes;
create policy patch_stability_votes_self_delete on public.patch_stability_votes
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.patch_stability_votes from anon, authenticated;
grant select, insert, update, delete on public.patch_stability_votes to authenticated;

-- Aggregate for one line + the caller's own vote. One row, never a user id.
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
set search_path = public
as $$
  with weighted as (
    select
      v.verdict,
      case
        when u.created_at > now() - interval '7 days' then 0::double precision
        else power(0.5::double precision,
                   extract(epoch from (now() - v.updated_at)) / extract(epoch from interval '7 days'))
      end as w
    from public.patch_stability_votes v
    join auth.users u on u.id = v.user_id
    where v.patch_line = p_line
  ),
  own as (
    select o.verdict, o.updated_at + interval '12 hours' as next_change_at
    from public.patch_stability_votes o
    where o.patch_line = p_line
      and o.user_id = (select auth.uid())
  )
  select
    coalesce(sum(w) filter (where verdict = 'stabil'), 0)::double precision,
    coalesce(sum(w) filter (where verdict = 'wackelig'), 0)::double precision,
    coalesce(sum(w) filter (where verdict = 'instabil'), 0)::double precision,
    coalesce(sum(w), 0)::double precision,
    coalesce(sum(w * w), 0)::double precision,
    count(*)::integer,
    (select verdict from own),
    (select next_change_at from own)
  from weighted;
$$;

comment on function public.patch_stability_vote_state(text) is
  'Weighted community-verdict sums for one patch line (accounts < 7 days old '
  'weigh 0, half-life 7 days on the vote''s updated_at) plus the raw vote count '
  'and the caller''s own vote with the time it becomes changeable. SECURITY '
  'DEFINER (reads auth.users.created_at and other users'' rows); returns no '
  'user id. Always exactly one row. The correction formula is client-side.';

revoke execute on function public.patch_stability_vote_state(text) from public;
grant execute on function public.patch_stability_vote_state(text) to anon, authenticated;
