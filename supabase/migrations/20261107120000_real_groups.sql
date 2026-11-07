-- ============================================================
-- 20261107120000_real_groups.sql
--
-- Real groups (#903): a shared space with members, roles and an invite code, next
-- to (not instead of) the owner-private friend_groups of 20261105120000.
--
-- TRUST MODEL
--   * friend_groups  = the owner's private address-book list. Members never know,
--                      never see each other, need a friendship with the owner.
--   * sc_groups      = a place members JOIN (invite code) and LEAVE. Joining is
--                      the opt-in. No friendship is needed or created.
--
-- NO TABLE IS DROPPED. friend_groups, friend_group_members, friend_shares and
-- every function of 20261105120000 keep their behaviour, except four re-created
-- functions that each ADD a group clause (PART 4):
--   einsatz_access(), einsatz_crew_json(), list_einsaetze_shared_with_me(), and
--   friendships_after_delete(), whose RSVP delete now spares a person who still
--   reaches the Einsatz through a group. For a friend-only Einsatz the friend
--   share is deleted earlier in the same trigger, so that delete is unchanged.
--
-- WHAT A MEMBER SEES ABOUT OTHER MEMBERS:
--   * member list: display_name, username, role, joined_at, and is_me. Members
--     in a user block with the caller, and suspended or unapproved accounts, are
--     left out (the blocked account must stay indistinguishable from a
--     nonexistent one, social_graph_reports.sql). member_count uses the same
--     filter.
--   * on an Einsatz shared with the group: the Einsatz, its steps (no supply ids),
--     the crew slots, the three RSVP counts and the caller's own answer. The NAME
--     on a taken slot only when taker and viewer share a group holding the
--     Einsatz and are not blocked. The full answer list stays owner-only.
--   * Nothing about hangar, presence, stats, e-mail, friendships or other groups.
--
-- SECURITY DESIGN
--   * RLS is enabled on every table and NOTHING is granted to anon or
--     authenticated: no policy, no table grant, like the rest of the social area.
--     Every read and write is a security definer RPC with `set search_path =
--     public`, which applies is_approved(), blocks and suspension. No client can
--     write its own role or membership, or read invite_code.
--   * sc_group_member()/sc_group_role() are internal (no client grant), so the
--     membership check is no oracle about other users.
--   * Invite code: 16 hex chars from gen_random_uuid() (64 bit), unique, valid 30
--     days, replaced on rotation, shown to owner/admin only. join_group() answers
--     a wrong, expired or rotated code with NULL, cannot enumerate groups, and
--     throttles to 10 failures / 15 min / user. It deliberately does NOT refuse a
--     blocked user: a refusal would reveal the block.
--   * Concurrency: group mutations take `select ... for update` on the sc_groups
--     row first and read roles afterwards; create/join also take a per-user
--     advisory lock, so the caps (20 groups per user, 50 members per group) hold
--     under parallel calls.
--   * A group never ends without an owner: leave/remove/role change check that an
--     owner remains ('last_owner'), and an AFTER DELETE trigger on
--     sc_group_members covers account deletion (promote the oldest admin, else
--     the oldest member, delete an empty group).
--   * Answers do not survive losing access: leaving, removal, unsharing and
--     deleting a group delete the RSVPs/slot takes of whoever no longer reaches
--     the Einsatz.
--   * execute is revoked from public/anon on everything; only `authenticated`
--     gets the RPCs, internal helpers get no grant. Errors are one-word codes.
-- ============================================================


-- ============================================================
-- PART 1 - tables
-- ============================================================

create table if not exists public.sc_groups (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  invite_code       text not null,
  invite_expires_at timestamptz not null default now() + interval '30 days',
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint sc_groups_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint sc_groups_code_shape check (invite_code ~ '^[0-9A-F]{16}$')
);
create unique index if not exists sc_groups_invite_code_unique on public.sc_groups (invite_code);

create table if not exists public.sc_group_members (
  group_id  uuid not null references public.sc_groups (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists sc_group_members_user_idx on public.sc_group_members (user_id);

-- An Einsatz offered to a group. The owner is stored so access can require the
-- owner to still be a member (leaving the group takes the share with you).
create table if not exists public.sc_group_einsatz_shares (
  group_id   uuid not null references public.sc_groups (id) on delete cascade,
  einsatz_id uuid not null references public.hq_einsaetze (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, einsatz_id)
);
create index if not exists sc_group_einsatz_shares_einsatz_idx on public.sc_group_einsatz_shares (einsatz_id);
create index if not exists sc_group_einsatz_shares_owner_idx on public.sc_group_einsatz_shares (owner_id);

-- Failed join attempts, for the throttle only.
create table if not exists public.sc_group_join_fails (
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists sc_group_join_fails_user_idx on public.sc_group_join_fails (user_id, at);

comment on table public.sc_groups is
  'Real, joinable groups (#903). RPC-only: no policy, no client grant.';
comment on table public.sc_group_members is
  'Membership and role (#903). RPC-only: no policy, no client grant.';

-- RLS on, no policy, no grant: the RPCs below are the only way in.
alter table public.sc_groups enable row level security;
alter table public.sc_group_members enable row level security;
alter table public.sc_group_einsatz_shares enable row level security;
alter table public.sc_group_join_fails enable row level security;
revoke all on table public.sc_groups, public.sc_group_members,
  public.sc_group_einsatz_shares, public.sc_group_join_fails from anon, authenticated;


-- ============================================================
-- PART 2 - internal helpers (no grant to any client role)
-- ============================================================

create or replace function public.sc_group_member(p_group uuid, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select p_user is not null and exists (
    select 1 from public.sc_group_members m where m.group_id = p_group and m.user_id = p_user
  );
$$;

create or replace function public.sc_group_role(p_group uuid, p_user uuid)
returns text language sql security definer set search_path = public stable as $$
  select m.role from public.sc_group_members m where m.group_id = p_group and m.user_id = p_user;
$$;

-- A new 16-char code. Loops on the (practically impossible) collision.
create or replace function public.sc_group_new_code()
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
              || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.sc_groups g where g.invite_code = c);
  end loop;
  return c;
end;
$$;

-- Takes the row lock every group mutation starts with. False when the group does
-- not exist.
create or replace function public.sc_group_lock(p_group uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.sc_groups g where g.id = p_group for update;
  return found;
end;
$$;

-- Does a group still have an owner? Call after the lock.
create or replace function public.sc_group_has_owner(p_group uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.sc_group_members m where m.group_id = p_group and m.role = 'owner');
$$;

revoke all on function public.sc_group_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sc_group_role(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sc_group_new_code() from public, anon, authenticated;
revoke all on function public.sc_group_lock(uuid) from public, anon, authenticated;
revoke all on function public.sc_group_has_owner(uuid) from public, anon, authenticated;


-- ============================================================
-- PART 3 - group RPCs
-- ============================================================

create or replace function public.create_group(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
  v_code text;
begin
  if char_length(v_name) not between 1 and 40 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sc_groups:' || caller::text, 0));
  if (select count(*) from public.sc_group_members m where m.user_id = caller) >= 20 then
    raise exception 'team_limit' using errcode = '22023';
  end if;
  v_code := public.sc_group_new_code();
  insert into public.sc_groups (name, invite_code, created_by)
  values (v_name, v_code, caller) returning id into v_id;
  insert into public.sc_group_members (group_id, user_id, role) values (v_id, caller, 'owner');
  return jsonb_build_object('id', v_id, 'name', v_name, 'invite_code', v_code);
end;
$$;

-- Joins by code. A wrong / expired / rotated code returns NULL (never raises, so
-- the failure row survives the transaction and feeds the throttle). A blocked
-- user is NOT refused: that would reveal the block.
create or replace function public.join_group(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  v_group uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('sc_groups:' || caller::text, 0));
  if (select count(*) from public.sc_group_join_fails f
       where f.user_id = caller and f.at > now() - interval '15 minutes') >= 10 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  select g.id into v_group from public.sc_groups g
   where g.invite_code = v_code and g.invite_expires_at > now();
  if v_group is not null then
    -- Lock, then re-check: a rotation or delete may have won the race.
    perform 1 from public.sc_groups g
     where g.id = v_group and g.invite_code = v_code and g.invite_expires_at > now() for update;
    if not found then v_group := null; end if;
  end if;
  if v_group is null then
    delete from public.sc_group_join_fails f where f.user_id = caller and f.at < now() - interval '1 hour';
    insert into public.sc_group_join_fails (user_id) values (caller);
    return null;
  end if;

  if public.sc_group_member(v_group, caller) then
    return v_group;
  end if;
  if (select count(*) from public.sc_group_members m where m.user_id = caller) >= 20 then
    raise exception 'team_limit' using errcode = '22023';
  end if;
  if (select count(*) from public.sc_group_members m where m.group_id = v_group) >= 50 then
    raise exception 'team_full' using errcode = '22023';
  end if;
  insert into public.sc_group_members (group_id, user_id, role) values (v_group, caller, 'member')
  on conflict do nothing;
  return v_group;
end;
$$;

create or replace function public.rotate_group_invite(p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_code text;
  v_exp timestamptz;
begin
  if not public.sc_group_lock(p_group)
     or coalesce(public.sc_group_role(p_group, caller), '') not in ('owner', 'admin') then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  v_code := public.sc_group_new_code();
  update public.sc_groups set invite_code = v_code, invite_expires_at = now() + interval '30 days'
   where id = p_group returning invite_expires_at into v_exp;
  return jsonb_build_object('invite_code', v_code, 'invite_expires_at', v_exp);
end;
$$;

-- Deletes the answers and slot takes of everybody who no longer reaches one of
-- the Einsatz (the owner's own answers stay). Call AFTER the membership/share
-- change. The slot is freed with the row.
create or replace function public.sc_group_prune_answers(p_einsaetze uuid[])
returns void language sql security definer set search_path = public as $$
  delete from public.einsatz_rsvps r
   using public.hq_einsaetze e
   where r.einsatz_id = e.id
     and r.einsatz_id = any (coalesce(p_einsaetze, '{}'))
     and r.user_id <> e.user_id
     and not public.einsatz_access(r.einsatz_id, r.user_id);
$$;
revoke all on function public.sc_group_prune_answers(uuid[]) from public, anon, authenticated;

create or replace function public.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_role text;
  v_ids uuid[];
begin
  if not public.sc_group_lock(p_group) then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  v_role := public.sc_group_role(p_group, caller);
  if v_role is null then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  v_ids := array(select s.einsatz_id from public.sc_group_einsatz_shares s where s.group_id = p_group);
  -- Checked BEFORE the delete: the after-delete trigger would otherwise promote
  -- a successor and hide the refusal.
  if v_role = 'owner' and (
    select count(*) from public.sc_group_members m where m.group_id = p_group and m.role = 'owner'
  ) <= 1 then
    raise exception 'last_owner' using errcode = '22023';
  end if;
  delete from public.sc_group_members where group_id = p_group and user_id = caller;
  delete from public.sc_group_einsatz_shares where group_id = p_group and owner_id = caller;
  perform public.sc_group_prune_answers(v_ids);
end;
$$;

-- Owner removes anybody but themselves; an admin removes plain members only.
create or replace function public.remove_group_member(p_group uuid, p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_mine text;
  v_theirs text;
  v_ids uuid[];
begin
  if not public.sc_group_lock(p_group) then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  v_mine := public.sc_group_role(p_group, caller);
  v_theirs := public.sc_group_role(p_group, p_member);
  if v_mine is null or v_theirs is null then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  if p_member = caller then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not (v_mine = 'owner' or (v_mine = 'admin' and v_theirs = 'member')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_ids := array(select s.einsatz_id from public.sc_group_einsatz_shares s where s.group_id = p_group);
  -- The caller is an owner (an admin cannot remove an owner) and stays, so an
  -- owner remains; the after-delete trigger is a no-op here.
  delete from public.sc_group_members where group_id = p_group and user_id = p_member;
  delete from public.sc_group_einsatz_shares where group_id = p_group and owner_id = p_member;
  perform public.sc_group_prune_answers(v_ids);
end;
$$;

-- Owner only, never on oneself (leave, or promote another owner first).
create or replace function public.set_group_member_role(p_group uuid, p_member uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  if p_role is null or p_role not in ('owner', 'admin', 'member') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if not public.sc_group_lock(p_group)
     or public.sc_group_role(p_group, caller) is distinct from 'owner'
     or not public.sc_group_member(p_group, p_member) then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  if p_member = caller then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  update public.sc_group_members set role = p_role where group_id = p_group and user_id = p_member;
  if not public.sc_group_has_owner(p_group) then
    raise exception 'last_owner' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.delete_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_ids uuid[];
begin
  if not public.sc_group_lock(p_group)
     or public.sc_group_role(p_group, caller) is distinct from 'owner' then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  v_ids := array(select s.einsatz_id from public.sc_group_einsatz_shares s where s.group_id = p_group);
  delete from public.sc_groups where id = p_group;
  perform public.sc_group_prune_answers(v_ids);
end;
$$;

-- Account deletion (or any other delete path) must not leave a group ownerless:
-- promote the oldest admin, else the oldest member; an empty group is deleted.
-- While a group row is itself being deleted the lookup finds nothing and returns.
create or replace function public.sc_group_members_after_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_next uuid;
begin
  if old.role <> 'owner' then
    return null;
  end if;
  perform 1 from public.sc_groups g where g.id = old.group_id for update;
  if not found or public.sc_group_has_owner(old.group_id) then
    return null;
  end if;
  select m.user_id into v_next
    from public.sc_group_members m
   where m.group_id = old.group_id
   order by (m.role = 'admin') desc, m.joined_at, m.user_id
   limit 1;
  if v_next is null then
    delete from public.sc_groups where id = old.group_id;
  else
    update public.sc_group_members set role = 'owner' where group_id = old.group_id and user_id = v_next;
  end if;
  return null;
end;
$$;
revoke all on function public.sc_group_members_after_delete() from public, anon, authenticated;

drop trigger if exists sc_group_members_after_delete on public.sc_group_members;
create trigger sc_group_members_after_delete
  after delete on public.sc_group_members
  for each row execute function public.sc_group_members_after_delete();

-- The caller's groups. The invite code only for owner/admin. member_count
-- applies the member-list filter (no blocked, suspended or unapproved account).
create or replace function public.list_my_groups()
returns table (
  id uuid, name text, role text, member_count integer, joined_at timestamptz,
  invite_code text, invite_expires_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select g.id, g.name, m.role,
         (select count(*)::integer from public.sc_group_members x
           where x.group_id = g.id
             and public.social_peer_ok(x.user_id)
             and not public.is_blocked_between(auth.uid(), x.user_id)),
         m.joined_at,
         case when m.role in ('owner', 'admin') then g.invite_code end,
         case when m.role in ('owner', 'admin') then g.invite_expires_at end
  from public.sc_group_members m
  join public.sc_groups g on g.id = m.group_id
  where m.user_id = auth.uid() and public.is_approved()
  order by g.name, g.created_at
$$;

-- Members of one group, for members only (empty for everybody else).
create or replace function public.list_group_members(p_group uuid)
returns table (user_id uuid, display_name text, username citext, role text, joined_at timestamptz, is_me boolean)
language sql security definer set search_path = public stable as $$
  select m.user_id, p.display_name, p.username, m.role, m.joined_at, m.user_id = auth.uid()
  from public.sc_group_members m
  join public.profiles p on p.id = m.user_id
  where public.is_approved()
    and public.sc_group_member(p_group, auth.uid())
    and m.group_id = p_group
    and public.social_peer_ok(m.user_id)
    and not public.is_blocked_between(auth.uid(), m.user_id)
  order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, p.display_name nulls last, p.username
$$;


-- ============================================================
-- PART 4 - sharing an Einsatz with a group
-- ============================================================

create or replace function public.share_einsatz_with_group(p_einsatz uuid, p_group uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  inserted integer;
begin
  if not exists (
    select 1 from public.hq_einsaetze e
    where e.id = p_einsatz and e.user_id = caller and e.deleted_at is null
  ) then
    raise exception 'einsatz_not_found' using errcode = 'P0002';
  end if;
  if not public.sc_group_member(p_group, caller) then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  insert into public.sc_group_einsatz_shares (group_id, einsatz_id, owner_id)
  values (p_group, p_einsatz, caller) on conflict do nothing;
  get diagnostics inserted = row_count;
  return case when inserted > 0 then 'created' else 'duplicate' end;
end;
$$;

create or replace function public.unshare_einsatz_from_group(p_einsatz uuid, p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  delete from public.sc_group_einsatz_shares s
   where s.einsatz_id = p_einsatz and s.group_id = p_group and s.owner_id = caller;
  if not found then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;
  perform public.sc_group_prune_answers(array[p_einsatz]);
end;
$$;

-- Owner view: the groups one of the caller's Einsatz is shared with.
create or replace function public.list_einsatz_group_shares(p_einsatz uuid)
returns table (group_id uuid, name text, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select s.group_id, g.name, s.created_at
  from public.sc_group_einsatz_shares s
  join public.sc_groups g on g.id = s.group_id
  where s.einsatz_id = p_einsatz and s.owner_id = auth.uid() and public.is_approved()
  order by g.name
$$;

-- Does a group reach p_viewer for this Einsatz? Owner AND viewer must both still
-- be members, not blocked with each other, both accounts in good standing, and
-- the share's owner must really own the Einsatz.
create or replace function public.einsatz_group_access(p_einsatz uuid, p_viewer uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select p_viewer is not null and exists (
    select 1 from public.sc_group_einsatz_shares s
    join public.hq_einsaetze e on e.id = s.einsatz_id and e.user_id = s.owner_id
    where s.einsatz_id = p_einsatz
      and public.sc_group_member(s.group_id, s.owner_id)
      and public.sc_group_member(s.group_id, p_viewer)
      and public.social_peer_ok(s.owner_id)
      and public.social_peer_ok(p_viewer)
      and not public.is_blocked_between(s.owner_id, p_viewer)
  );
$$;

-- Do a and b share a group that holds this Einsatz (both members), unblocked?
create or replace function public.einsatz_group_common(p_einsatz uuid, p_a uuid, p_b uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select p_a is not null and p_b is not null
    and not public.is_blocked_between(p_a, p_b)
    and exists (
      select 1 from public.sc_group_einsatz_shares s
      where s.einsatz_id = p_einsatz
        and public.sc_group_member(s.group_id, p_a)
        and public.sc_group_member(s.group_id, p_b)
    );
$$;
revoke all on function public.einsatz_group_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.einsatz_group_common(uuid, uuid, uuid) from public, anon, authenticated;

-- Re-created from 20261105120000 with ONE added OR branch.
create or replace function public.einsatz_access(p_einsatz uuid, p_viewer uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.friend_shares s
    where s.einsatz_id = p_einsatz
      and public.friend_share_reaches(s.shared_with, s.group_id, s.owner_id, p_viewer)
  ) or public.einsatz_group_access(p_einsatz, p_viewer);
$$;

-- Re-created from 20261105120000 with ONE added OR in the 'taker' clause.
create or replace function public.einsatz_crew_json(p_einsatz uuid, p_owner uuid, p_viewer uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  with valid as materialized (
    select r.user_id, r.answer, r.slot_id, r.answered_at, p.display_name, p.username
    from public.einsatz_rsvps r
    join public.profiles p on p.id = r.user_id
    where r.einsatz_id = p_einsatz
      and public.social_peer_ok(r.user_id)
      and (r.user_id = p_owner or public.einsatz_access(p_einsatz, r.user_id))
  )
  select jsonb_build_object(
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'ord', s.ord,
        'label', s.label,
        'taken', v.user_id is not null,
        'mine', coalesce(v.user_id = p_viewer, false),
        'taker', case
          when v.user_id is not null
           and (p_viewer = p_owner or v.user_id = p_viewer or v.user_id = p_owner
                or public.are_friends(p_viewer, v.user_id)
                or public.einsatz_group_common(p_einsatz, p_viewer, v.user_id))
          then jsonb_build_object('user_id', v.user_id, 'display_name', v.display_name, 'username', v.username)
        end
      ) order by s.ord)
      from public.einsatz_crew_slots s
      left join valid v on v.slot_id = s.id
      where s.einsatz_id = p_einsatz
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'yes',   (select count(*) from valid where answer = 'yes'),
      'maybe', (select count(*) from valid where answer = 'maybe'),
      'no',    (select count(*) from valid where answer = 'no')
    ),
    'my_answer', (select answer from valid where user_id = p_viewer),
    'my_slot', (select slot_id from valid where user_id = p_viewer),
    'rsvps', case when p_viewer = p_owner then coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', user_id, 'display_name', display_name, 'username', username,
        'answer', answer, 'slot_id', slot_id, 'answered_at', answered_at
      ) order by answered_at)
      from valid
    ), '[]'::jsonb) end
  );
$$;

-- Re-created from 20261105120000: the reach CTE gains a second, group source.
create or replace function public.list_einsaetze_shared_with_me()
returns table (
  einsatz_id     uuid,
  title          text,
  activity       text,
  status         text,
  planned_at     timestamptz,
  start_location text,
  updated_at     timestamptz,
  owner_id       uuid,
  owner_name     text,
  owner_handle   citext,
  shared_at      timestamptz,
  steps          jsonb,
  crew           jsonb
)
language sql security definer set search_path = public stable as $$
  with me as (
    select auth.uid() as id where public.is_approved()
  ), reach as (
    select x.einsatz_id, min(x.created_at) as shared_at
    from (
      select s.einsatz_id, s.created_at
      from public.friend_shares s
      cross join me
      where s.kind = 'einsatz'
        and (s.shared_with = me.id
             or s.group_id in (select m.group_id from public.friend_group_members m where m.member_id = me.id))
        and public.are_friends(me.id, s.owner_id)
        and public.social_peer_ok(s.owner_id)
      union all
      select g.einsatz_id, g.created_at
      from public.sc_group_einsatz_shares g
      cross join me
      where g.owner_id <> me.id
        and public.einsatz_group_access(g.einsatz_id, me.id)
        and public.sc_group_member(g.group_id, me.id)
    ) x
    group by x.einsatz_id
  )
  select e.id, e.title, e.activity, e.status, e.planned_at, e.start_location, e.updated_at,
         e.user_id, p.display_name, p.username, r.shared_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'ord', st.ord, 'kind', st.kind, 'label', st.label, 'location', st.location,
             'system', st.system, 'class_name', st.class_name, 'qty', st.qty,
             'mission_ref', st.mission_ref, 'state', st.state
           ) order by st.ord)
           from public.hq_einsatz_steps st where st.einsatz_id = e.id
         ), '[]'::jsonb),
         public.einsatz_crew_json(e.id, e.user_id, auth.uid())
  from reach r
  join public.hq_einsaetze e on e.id = r.einsatz_id
  join public.profiles p on p.id = e.user_id
  where e.deleted_at is null and e.status <> 'archived'
  order by e.planned_at nulls last, r.shared_at desc
$$;

-- Re-created from 20261105120000 with ONE change: the RSVP delete spares a
-- person who still reaches the Einsatz (through a group). The friend share and
-- friend-group rows are deleted by the statements above it, so for a friend-only
-- Einsatz einsatz_access() is false there and the delete is exactly as before.
create or replace function public.friendships_after_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.friend_group_members m
   using public.friend_groups g
   where m.group_id = g.id
     and ((g.owner_id = old.user_low and m.member_id = old.user_high)
       or (g.owner_id = old.user_high and m.member_id = old.user_low));

  delete from public.friend_shares s
   where (s.owner_id = old.user_low and s.shared_with = old.user_high)
      or (s.owner_id = old.user_high and s.shared_with = old.user_low);

  update public.loadout_shares s
     set revoked_at = now()
   where s.revoked_at is null
     and ((s.owner_id = old.user_low and s.shared_with = old.user_high)
       or (s.owner_id = old.user_high and s.shared_with = old.user_low));

  delete from public.einsatz_rsvps r
   using public.hq_einsaetze e
   where r.einsatz_id = e.id
     and ((e.user_id = old.user_low and r.user_id = old.user_high)
       or (e.user_id = old.user_high and r.user_id = old.user_low))
     and not public.einsatz_access(r.einsatz_id, r.user_id);

  delete from public.social_visibility_overrides o
   where (o.user_id = old.user_low and o.friend_id = old.user_high)
      or (o.user_id = old.user_high and o.friend_id = old.user_low);
  return null;
end;
$$;
revoke all on function public.friendships_after_delete() from public, anon, authenticated;


-- ============================================================
-- PART 5 - grants
-- ============================================================

revoke all on function public.create_group(text) from public, anon;
revoke all on function public.join_group(text) from public, anon;
revoke all on function public.rotate_group_invite(uuid) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
revoke all on function public.set_group_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.delete_group(uuid) from public, anon;
revoke all on function public.list_my_groups() from public, anon;
revoke all on function public.list_group_members(uuid) from public, anon;
revoke all on function public.share_einsatz_with_group(uuid, uuid) from public, anon;
revoke all on function public.unshare_einsatz_from_group(uuid, uuid) from public, anon;
revoke all on function public.list_einsatz_group_shares(uuid) from public, anon;

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.rotate_group_invite(uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;
grant execute on function public.list_my_groups() to authenticated;
grant execute on function public.list_group_members(uuid) to authenticated;
grant execute on function public.share_einsatz_with_group(uuid, uuid) to authenticated;
grant execute on function public.unshare_einsatz_from_group(uuid, uuid) to authenticated;
grant execute on function public.list_einsatz_group_shares(uuid) to authenticated;

-- CREATE OR REPLACE keeps the grants of the originals; restated so a reader sees
-- the end state: einsatz_access / einsatz_crew_json stay internal,
-- list_einsaetze_shared_with_me stays callable by authenticated only.
revoke all on function public.einsatz_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.einsatz_crew_json(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_einsaetze_shared_with_me() from public, anon;
grant execute on function public.list_einsaetze_shared_with_me() to authenticated;

notify pgrst, 'reload schema';
