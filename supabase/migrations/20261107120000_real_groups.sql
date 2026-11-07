-- ============================================================
-- 20261107120000_real_groups.sql
--
-- Real groups (#903): a shared space with members, roles and an invite code, next
-- to (not instead of) the owner-private friend_groups of 20261105120000.
--
-- TRUST MODEL
--   * friend_groups  = the owner's private address-book list. Members never know,
--                      never see each other, need a friendship with the owner.
--                      UNCHANGED by this migration (#903 H5).
--   * sc_groups      = a place members JOIN (invite code) and LEAVE. Joining is
--                      the opt-in. No friendship is needed or created.
--
-- NO TABLE IS DROPPED. friend_groups, friend_group_members, friend_shares and
-- every function of 20261105120000 keep their behaviour. Only three functions
-- are re-created, each strictly ADDING a group branch (see PART 4):
-- einsatz_access(), einsatz_crew_json(), list_einsaetze_shared_with_me().
--
-- WHAT A MEMBER SEES ABOUT OTHER MEMBERS (decision, binding):
--   * member list: display_name, username, role, joined_at. Nothing else - no
--     hangar, presence, stats, e-mail, friendships or other groups.
--   * on an Einsatz shared with the group: the Einsatz itself (title, steps
--     without supply ids), the crew slots, the three RSVP counts, the caller's own
--     answer, and the NAME on a taken slot when taker and viewer are both members
--     of a group that holds this Einsatz. The full answer list (who said what)
--     stays owner-only, exactly as for friend shares.
--   * friend shares are not widened: the "taker" rule for friends is unchanged,
--     the group clause is an extra OR that needs a common group + this Einsatz.
--
-- SECURITY DESIGN
--   * RLS on all three tables. Tables get SELECT only for `authenticated`, and
--     only rows of groups the caller is a member of, via sc_group_is_mine()
--     (security definer, reads auth.uid() itself, so it cannot be used as a
--     membership oracle for another user, and the policy does not recurse into
--     the policy of the table it protects). sc_groups.invite_code is excluded by
--     a COLUMN grant: only the RPCs hand it out, and only to owner/admin.
--   * No INSERT/UPDATE/DELETE grant, no write policy: every mutation is a
--     security definer RPC with `set search_path = public`, so no client can
--     write its own role or membership.
--   * Invite code: 16 hex chars from gen_random_uuid() (CSPRNG, 64 bit), stored
--     upper-case, unique, expires after 30 days or on rotation. join_group()
--     answers a wrong, expired or rotated code identically (NULL), cannot be
--     used to enumerate groups, and is throttled to 10 failures / 15 min / user
--     (failures are recorded in sc_group_join_fails, which has no client grant).
--   * Caps: 20 memberships per user, 50 members per group.
--   * Last owner: leave/remove/role change can never leave a group without an
--     owner ('last_owner'); a lone owner deletes the group instead.
--   * execute is revoked from public/anon on everything; only `authenticated`
--     gets the RPCs, and the internal helpers get no grant at all.
--   * Errors are one-word codes like the rest of the social area.
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

-- Failed join attempts, for the throttle only. No client grant.
create table if not exists public.sc_group_join_fails (
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists sc_group_join_fails_user_idx on public.sc_group_join_fails (user_id, at);

comment on table public.sc_groups is
  'Real, joinable groups (#903). Written only through the group RPCs; invite_code is not readable by clients.';
comment on table public.sc_group_members is
  'Membership and role. Role is written only by the group RPCs; exactly the owner role is protected from removal of the last owner.';

alter table public.sc_groups enable row level security;
alter table public.sc_group_members enable row level security;
alter table public.sc_group_einsatz_shares enable row level security;
alter table public.sc_group_join_fails enable row level security;
revoke all on table public.sc_groups, public.sc_group_members,
  public.sc_group_einsatz_shares, public.sc_group_join_fails from anon, authenticated;


-- ============================================================
-- PART 2 - membership helpers (the only things policies call)
-- ============================================================

-- Is p_user in p_group? Internal: takes any user, therefore NO client grant.
create or replace function public.sc_group_member(p_group uuid, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select p_user is not null and exists (
    select 1 from public.sc_group_members m where m.group_id = p_group and m.user_id = p_user
  );
$$;

-- The caller's role in the group, null when not a member. Internal.
create or replace function public.sc_group_role(p_group uuid, p_user uuid)
returns text language sql security definer set search_path = public stable as $$
  select m.role from public.sc_group_members m where m.group_id = p_group and m.user_id = p_user;
$$;

-- For the RLS policies: is the CALLER in the group? auth.uid() is read inside,
-- so this is no oracle about anybody else, and as a security definer it reads
-- sc_group_members without re-entering its policy (no recursion).
create or replace function public.sc_group_is_mine(p_group uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.sc_group_member(p_group, auth.uid());
$$;

revoke all on function public.sc_group_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sc_group_role(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sc_group_is_mine(uuid) from public, anon;
grant execute on function public.sc_group_is_mine(uuid) to authenticated;

-- Policies. SELECT only; no write policy exists, and no write grant either.
drop policy if exists sc_groups_member_read on public.sc_groups;
create policy sc_groups_member_read on public.sc_groups
  for select to authenticated using (public.sc_group_is_mine(id));

drop policy if exists sc_group_members_member_read on public.sc_group_members;
create policy sc_group_members_member_read on public.sc_group_members
  for select to authenticated using (public.sc_group_is_mine(group_id));

drop policy if exists sc_group_einsatz_shares_member_read on public.sc_group_einsatz_shares;
create policy sc_group_einsatz_shares_member_read on public.sc_group_einsatz_shares
  for select to authenticated using (public.sc_group_is_mine(group_id));

-- Column grant: the invite code is deliberately not in the list.
grant select (id, name, invite_expires_at, created_by, created_at) on public.sc_groups to authenticated;
grant select (group_id, user_id, role, joined_at) on public.sc_group_members to authenticated;
grant select (group_id, einsatz_id, owner_id, created_at) on public.sc_group_einsatz_shares to authenticated;

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
revoke all on function public.sc_group_new_code() from public, anon, authenticated;


-- ============================================================
-- PART 3 - group RPCs (create, join, rotate, leave, remove, role, delete, list)
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
-- the failure row survives the transaction and feeds the throttle).
create or replace function public.join_group(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  v_group uuid;
begin
  if (select count(*) from public.sc_group_join_fails f
       where f.user_id = caller and f.at > now() - interval '15 minutes') >= 10 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  select g.id into v_group from public.sc_groups g
   where g.invite_code = v_code and g.invite_expires_at > now();
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
  if coalesce(public.sc_group_role(p_group, caller), '') not in ('owner', 'admin') then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  v_code := public.sc_group_new_code();
  update public.sc_groups set invite_code = v_code, invite_expires_at = now() + interval '30 days'
   where id = p_group returning invite_expires_at into v_exp;
  return jsonb_build_object('invite_code', v_code, 'invite_expires_at', v_exp);
end;
$$;

create or replace function public.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_role text := public.sc_group_role(p_group, caller);
begin
  if v_role is null then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  -- Lock the member rows so two owners leaving at once cannot both pass.
  perform 1 from public.sc_group_members m where m.group_id = p_group and m.role = 'owner' for update;
  if v_role = 'owner' and (
    select count(*) from public.sc_group_members m where m.group_id = p_group and m.role = 'owner'
  ) <= 1 then
    raise exception 'last_owner' using errcode = '22023';
  end if;
  delete from public.sc_group_members where group_id = p_group and user_id = caller;
  delete from public.sc_group_einsatz_shares where group_id = p_group and owner_id = caller;
end;
$$;

-- Owner removes anybody but themselves; an admin removes plain members only.
create or replace function public.remove_group_member(p_group uuid, p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_mine text := public.sc_group_role(p_group, caller);
  v_theirs text := public.sc_group_role(p_group, p_member);
begin
  if v_mine is null or v_theirs is null then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  if p_member = caller then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not (v_mine = 'owner' or (v_mine = 'admin' and v_theirs = 'member')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.sc_group_members where group_id = p_group and user_id = p_member;
  delete from public.sc_group_einsatz_shares where group_id = p_group and owner_id = p_member;
  -- The member's answers on this group's Einsatz are not deleted: einsatz_access()
  -- already stops counting them, and the slot is freed by respond_einsatz().
end;
$$;

-- Owner only. Never the caller's own role (leave / transfer by promoting another
-- owner first), so the last owner cannot be demoted by accident.
create or replace function public.set_group_member_role(p_group uuid, p_member uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  if p_role is null or p_role not in ('owner', 'admin', 'member') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if public.sc_group_role(p_group, caller) is distinct from 'owner'
     or not public.sc_group_member(p_group, p_member) then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  if p_member = caller then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  update public.sc_group_members set role = p_role where group_id = p_group and user_id = p_member;
end;
$$;

create or replace function public.delete_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  if public.sc_group_role(p_group, caller) is distinct from 'owner' then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  delete from public.sc_groups where id = p_group;
end;
$$;

-- The caller's groups. The invite code only for owner/admin.
create or replace function public.list_my_groups()
returns table (
  id uuid, name text, role text, member_count integer, joined_at timestamptz,
  invite_code text, invite_expires_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select g.id, g.name, m.role,
         (select count(*)::integer from public.sc_group_members x where x.group_id = g.id),
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
-- be members and both accounts in good standing.
create or replace function public.einsatz_group_access(p_einsatz uuid, p_viewer uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select p_viewer is not null and exists (
    select 1 from public.sc_group_einsatz_shares s
    where s.einsatz_id = p_einsatz
      and public.sc_group_member(s.group_id, s.owner_id)
      and public.sc_group_member(s.group_id, p_viewer)
      and public.social_peer_ok(s.owner_id)
      and public.social_peer_ok(p_viewer)
  );
$$;

-- Do a and b share a group that holds this Einsatz (both members)?
create or replace function public.einsatz_group_common(p_einsatz uuid, p_a uuid, p_b uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select p_a is not null and p_b is not null and exists (
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
-- The friend source keeps its are_friends() requirement; the group source
-- requires membership of owner and viewer instead.
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

-- CREATE OR REPLACE keeps the grants of the originals; restated so a reader of
-- this file sees the end state: einsatz_access / einsatz_crew_json stay internal,
-- list_einsaetze_shared_with_me stays callable by authenticated only.
revoke all on function public.einsatz_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.einsatz_crew_json(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_einsaetze_shared_with_me() from public, anon;
grant execute on function public.list_einsaetze_shared_with_me() to authenticated;

notify pgrst, 'reload schema';
