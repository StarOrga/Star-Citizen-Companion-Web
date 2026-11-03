-- ============================================================
-- 20261103190000_vote_age_from_approval.sql
--
-- #885 red-team R5: the 7-day account age of the community votes was read
-- from auth.users.created_at. A self-signup left unapproved for weeks (or
-- accounts created in advance) then voted with full weight the moment it was
-- allowlisted. The age now counts from the APPROVAL.
--
--   profiles.approved_at   set by trigger profiles_set_approved_at whenever
--                          is_approved turns true (insert or update), cleared
--                          when it turns false, so a re-approval starts the
--                          wait again. A raw session can never set it; the
--                          owner (migrations, SECURITY DEFINER admin RPCs)
--                          may set it explicitly.
--   backfill               existing approved accounts get their created_at,
--                          so nobody who is already counted loses weight.
--   vote aggregates        patch_stability_vote_state() and
--                          patch_channel_build_vote_state() weigh a voter 0
--                          until 7 days after approved_at.
--
-- ADDITIVE: one column, one trigger; both aggregates replaced in place (same
-- signatures, bodies as in 20261103090000 / 20261103091000 plus the age source).
-- ROLLBACK: restore both functions from those migrations;
--           drop trigger profiles_set_approved_at on public.profiles;
--           drop function public.profiles_set_approved_at();
--           alter table public.profiles drop column approved_at;
-- ============================================================

alter table public.profiles add column if not exists approved_at timestamptz;

comment on column public.profiles.approved_at is
  'When is_approved last turned true (trigger profiles_set_approved_at); null while not approved. '
  'The community votes count an account from 7 days after this.';

update public.profiles set approved_at = created_at where is_approved and approved_at is null;

create or replace function public.profiles_set_approved_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_raw boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if v_raw or new.approved_at is null then
      new.approved_at := case when new.is_approved then now() end;
    end if;
    return new;
  end if;

  -- The owner may set it explicitly (backfills, fixtures); a raw session never.
  if not v_raw and new.approved_at is distinct from old.approved_at then
    return new;
  end if;

  if new.is_approved and not coalesce(old.is_approved, false) then
    new.approved_at := now();
  elsif not new.is_approved then
    new.approved_at := null;
  else
    new.approved_at := old.approved_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_set_approved_at on public.profiles;
create trigger profiles_set_approved_at
  before insert or update on public.profiles
  for each row execute function public.profiles_set_approved_at();

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
        when coalesce(p.approved_at, u.created_at) > now() - interval '7 days' then 0::double precision
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
        when coalesce(p.approved_at, u.created_at) > now() - interval '7 days' then 0::double precision
        else power(0.5::double precision,
                   floor(extract(epoch from (now() - v.updated_at)) / 3600) / (7 * 24))
      end as w
    from public.patch_channel_build_votes v
    join builds b on b.channel = v.channel and b.version = v.version
    join auth.users u on u.id = v.user_id
    join public.profiles p on p.id = v.user_id
   where p.is_approved
     and (p.suspended_at is null or (p.suspended_until is not null and p.suspended_until <= now()))
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
