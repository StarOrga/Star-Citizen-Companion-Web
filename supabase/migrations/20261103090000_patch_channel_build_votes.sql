-- ============================================================
-- 20261103090000_patch_channel_build_votes.sql
--
-- Community verdict on a running Hotfix / PTU BUILD (#885, split from #836).
-- The LIVE line keeps patch_stability_votes (FK to patch_stability_patches);
-- builds get their own table with a composite FK to patch_channel_builds, so
-- nothing about the LIVE table changes. Evocati gets no votes (NDA, and the
-- hub shows no chip there) - enforced by the CHECK below, not only in the UI.
--
-- Protection (the #851 rules of the LIVE votes, plus two more):
--   - accounts younger than 7 days weigh 0 (in the aggregate, like LIVE),
--   - a vote can be changed at most every 12 hours (trigger),
--   - only the RUNNING build of a channel (the newest running one, as the hub
--     shows it) can be voted on or changed (trigger),
--   - at most 3 distinct builds voted on or changed per account in a rolling
--     24 h (trigger, serialised per account with an advisory lock),
--   - re-sending the same verdict is a no-op: it keeps updated_at, so a
--     script cannot refresh its vote's weight against the 7-day half-life,
--   - no DELETE grant: a vote can be changed but never withdrawn, so
--     delete + insert cannot dodge the 12 h lock or the daily cap. Account
--     deletion and a dropped build still cascade (FK actions ignore grants).
--   - the restrictive is_approved() gate like every other self-scoped table,
--     and the aggregate drops votes of accounts that are no longer approved or
--     are suspended (a vote cannot be withdrawn, so this is the moderation lever),
--   - the public sums never reveal a single vote: a vote counts from the next
--     full hour on (hourly batches), its age is rounded to the hour, and below
--     10 counted votes the RPC returns the count only, no split.
-- Ties on thread_first_at resolve by version desc in the trigger and the RPC.
-- The minimum effective votes and the +-10 point cap are applied client-side
-- by communityCorrection() (src/app/news/patch-stability.ts) - one formula.
--
-- Privacy: self-read only (RLS). The public aggregate comes from
-- patch_channel_build_vote_state(), SECURITY DEFINER, weighted sums only and
-- never a user id (same precedent as patch_stability_vote_state()).
--
-- ADDITIVE: one table, two functions; nothing dropped or renamed.
-- ROLLBACK: drop function public.patch_channel_build_vote_state();
--           drop table public.patch_channel_build_votes;
--           drop function public.patch_channel_build_votes_guard();
-- ============================================================

create table if not exists public.patch_channel_build_votes (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  channel    text        not null check (channel in ('hotfix', 'ptu')),
  version    text        not null,
  verdict    text        not null check (verdict in ('stabil', 'wackelig', 'instabil')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, channel, version),
  foreign key (channel, version) references public.patch_channel_builds (channel, version) on delete cascade
);

create index if not exists patch_channel_build_votes_build_idx
  on public.patch_channel_build_votes (channel, version);

comment on table public.patch_channel_build_votes is
  'One community stability verdict per (user, Hotfix/PTU build). Self-read only; '
  'the public aggregate comes from patch_channel_build_vote_state(). Running builds '
  'only, changeable every 12 h, at most 3 casts/changes per account per 24 h, never '
  'withdrawn (trigger patch_channel_build_votes_guard, no DELETE grant).';

create or replace function public.patch_channel_build_votes_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_recent integer;
begin
  -- A session writes only its own rows (RLS says so too, but before the lock below).
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    raise exception 'vote_not_own' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- Same verdict again: nothing changes, not even updated_at (weight refresh).
    if new.verdict is not distinct from old.verdict then
      return old;
    end if;
    -- The row identity is fixed, only the verdict may move.
    new.user_id := old.user_id;
    new.channel := old.channel;
    new.version := old.version;
    new.created_at := old.created_at;
    if now() < old.updated_at + interval '12 hours' then
      raise exception 'vote_change_too_soon'
        using errcode = 'P0001',
              detail = 'A stability vote can be changed once every 12 hours.',
              hint = (old.updated_at + interval '12 hours')::text;
    end if;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();

  -- The build the hub and the RPC show: the newest running one of its channel.
  if not exists (select 1
                   from (select distinct on (b.channel) b.version
                           from public.patch_channel_builds b
                          where b.running and b.channel = new.channel
                          order by b.channel, b.thread_first_at desc, b.version desc) r
                  where r.version = new.version) then
    raise exception 'vote_build_not_running'
      using errcode = 'P0001',
            detail = 'Only the build currently running in its channel can be voted on.';
  end if;

  -- Parallel requests of one account queue here, so the count below is exact.
  perform pg_advisory_xact_lock(hashtextextended('patch_channel_build_votes:' || new.user_id::text, 0));
  select count(*) into v_recent
    from public.patch_channel_build_votes v
   where v.user_id = new.user_id
     and v.updated_at > now() - interval '24 hours'
     and not (v.channel = new.channel and v.version = new.version);
  if v_recent >= 3 then
    raise exception 'vote_daily_cap'
      using errcode = 'P0001',
            detail = 'At most 3 build votes can be cast or changed per 24 hours.';
  end if;
  return new;
end;
$$;

drop trigger if exists patch_channel_build_votes_guard on public.patch_channel_build_votes;
create trigger patch_channel_build_votes_guard
  before insert or update on public.patch_channel_build_votes
  for each row execute function public.patch_channel_build_votes_guard();

alter table public.patch_channel_build_votes enable row level security;

drop policy if exists patch_channel_build_votes_self_read on public.patch_channel_build_votes;
create policy patch_channel_build_votes_self_read on public.patch_channel_build_votes
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists patch_channel_build_votes_self_insert on public.patch_channel_build_votes;
create policy patch_channel_build_votes_self_insert on public.patch_channel_build_votes
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists patch_channel_build_votes_self_update on public.patch_channel_build_votes;
create policy patch_channel_build_votes_self_update on public.patch_channel_build_votes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists patch_channel_build_votes_approved_gate on public.patch_channel_build_votes;
create policy patch_channel_build_votes_approved_gate on public.patch_channel_build_votes
  as restrictive for all to authenticated
  using (public.is_approved()) with check (public.is_approved());

revoke all on public.patch_channel_build_votes from anon, authenticated;
grant select, insert, update on public.patch_channel_build_votes to authenticated;

-- One row per RUNNING Hotfix / PTU build: the raw numbers the client computes
-- the build's stability from, the weighted vote sums and the caller's own vote.
-- Never a user id.
create or replace function public.patch_channel_build_vote_state()
returns table (
  channel               text,
  version               text,
  line                  text,
  wave                  integer,
  thread_first_at       timestamptz,
  replies               integer,
  ticket_share          numeric,
  ticket_vote_share     numeric,
  w_stabil              double precision,
  w_wackelig            double precision,
  w_instabil            double precision,
  sum_w                 double precision,
  sum_w2                double precision,
  votes                 integer,
  own_verdict           text,
  own_next_change_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with builds as (
    select distinct on (b.channel) b.*
      from public.patch_channel_builds b
     where b.running and b.channel in ('hotfix', 'ptu')
     order by b.channel, b.thread_first_at desc, b.version desc
  ),
  weighted as (
    select
      v.channel, v.version, v.verdict,
      case
        when u.created_at > now() - interval '7 days' then 0::double precision
        else power(0.5::double precision,
                   floor(extract(epoch from (now() - v.updated_at)) / 3600) / (7 * 24))
      end as w
    from public.patch_channel_build_votes v
    join builds b on b.channel = v.channel and b.version = v.version
    join auth.users u on u.id = v.user_id
    join public.profiles p on p.id = v.user_id
   where p.is_approved
     and (p.suspended_at is null or (p.suspended_until is not null and p.suspended_until <= now()))
     -- Hourly batches: a vote counts from the next full hour on, so polling
     -- cannot tie a change in the sums to one vote (#885 redteam R3).
     and v.updated_at < date_trunc('hour', now())
  ),
  agg as (
    select w.channel, w.version, count(*)::integer as n,
           sum(w.w) filter (where w.verdict = 'stabil')   as ws,
           sum(w.w) filter (where w.verdict = 'wackelig') as ww,
           sum(w.w) filter (where w.verdict = 'instabil') as wi,
           sum(w.w) as sw, sum(w.w * w.w) as sw2
      from weighted w
     group by w.channel, w.version
  )
  -- Below 10 counted votes only the count leaves the function, never the
  -- split (the client shows no distribution before 25 effective votes anyway).
  select
    b.channel, b.version, b.line, b.wave, b.thread_first_at, b.replies,
    b.top_ticket_share, b.top_ticket_vote_share,
    case when a.n >= 10 then coalesce(a.ws, 0) else 0 end::double precision,
    case when a.n >= 10 then coalesce(a.ww, 0) else 0 end::double precision,
    case when a.n >= 10 then coalesce(a.wi, 0) else 0 end::double precision,
    case when a.n >= 10 then coalesce(a.sw, 0) else 0 end::double precision,
    case when a.n >= 10 then coalesce(a.sw2, 0) else 0 end::double precision,
    coalesce(a.n, 0),
    o.verdict,
    o.updated_at + interval '12 hours'
  from builds b
  left join agg a on a.channel = b.channel and a.version = b.version
  left join public.patch_channel_build_votes o
    on o.channel = b.channel and o.version = b.version and o.user_id = (select auth.uid())
  order by b.channel;
$$;

comment on function public.patch_channel_build_vote_state() is
  'Per running Hotfix / PTU build: its raw Spectrum numbers, the weighted '
  'community-verdict sums (accounts < 7 days weigh 0, half-life 7 days on '
  'updated_at, counted from the next full hour, split withheld below 10 votes), '
  'the counted votes and the caller''s own vote with the time it '
  'becomes changeable. SECURITY DEFINER (reads auth.users.created_at and other '
  'users'' rows); returns no user id. The correction formula is client-side.';

revoke execute on function public.patch_channel_build_vote_state() from public;
grant execute on function public.patch_channel_build_vote_state() to anon, authenticated;
