-- ============================================================
-- 20261105120000_social_area.sql
--
-- The social area (concept docs/concepts/2026-11-05-freunde-zweck-und-platz,
-- checklist C02-C07, C18-C21). Friends stop being a sharing list and become
-- co-players: invite links, owner-private groups, Einsatz and ship-variant
-- shares, crew slots with RSVPs, presence, per-friend visibility and a
-- friends-only overview with a comparison block.
--
-- ADDITIVE: no table, column or row is dropped. Two nullable columns are added
-- to hangar_role_loadouts (provenance of an adopted copy).
--
-- DOCTRINE, same as 20260903220000 / 20260904020000:
--   * No table here has a policy at all. RLS is on and every grant is revoked,
--     so PostgREST cannot touch these tables. Reads and writes go through
--     SECURITY DEFINER RPCs that pin the actor to auth.uid().
--   * Authorisation is checked on every READ (are_friends + owner approved and
--     not suspended), so un-friending or blocking revokes everything on the
--     next read with no cleanup pass. Rows of a dead friendship stay until the
--     owner deletes them and come back if the two become friends again, which
--     is the behaviour loadout_shares already has.
--   * Errors are stable one-word codes, mapped client-side by socialErrorKey().
--
-- DECISIONS (all repeated in the concept's contract.md):
--   * An invite creates a REQUEST, never a friendship. The link is meant to be
--     posted in Discord, the round's wording is "Klick stellt die Anfrage", and
--     a friend sees the whole hangar by default: a one-click friendship would
--     hand that hangar to anybody holding the link.
--   * A group share is expanded at READ time: the group is the audience, adding
--     a friend later grants access, removing them or deleting the group revokes
--     it. share_loadout_with_group() is the exception, it fans out into
--     loadout_shares at share time, because that table has no group column.
--   * Revoking a friend_share is a DELETE, not a tombstone: a row of no further
--     use is not worth keeping under the 500 MB budget. loadout_shares keeps
--     its own revoke-never-delete rule.
--   * Adopting a ship variant makes a COPY that does not follow the friend:
--     hangar_follow_snapshot() does not re-check a friendship, so a follower
--     would keep reading the owner's loadout after un-friending.
--   * Visibility defaults to ON for all four facets (no row = everything
--     visible), per reading R4.
--   * Presence is one row per user. The active-day rollup is a 30-bit mask, so
--     the table never grows beyond one small row per account.
-- ============================================================


-- ============================================================
-- PART 1 - tables
-- ============================================================

-- Invite links ------------------------------------------------
create table if not exists public.friend_invites (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  constraint friend_invites_token_len check (char_length(token) between 32 and 128)
);

-- One live link per owner: re-creating returns it, "new link" is revoke + create.
create unique index if not exists friend_invites_one_live
  on public.friend_invites (owner_id) where revoked_at is null;
create index if not exists friend_invites_owner_created_idx
  on public.friend_invites (owner_id, created_at desc);

comment on table public.friend_invites is
  'Personal expiring invite link (7 days). Redeeming creates a friend request towards owner_id. Written only through create_friend_invite()/revoke_friend_invite().';

-- Friend groups -----------------------------------------------
create table if not exists public.friend_groups (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('org', 'einsatzgruppe')),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_groups_name_len check (char_length(btrim(name)) between 1 and 60)
);

create unique index if not exists friend_groups_owner_name_unique
  on public.friend_groups (owner_id, kind, lower(btrim(name)));

comment on table public.friend_groups is
  'Owner-private list of friends (reading R2): kind org or einsatzgruppe. Members never see it. Not a shared Org with its own membership.';

create table if not exists public.friend_group_members (
  group_id  uuid not null references public.friend_groups (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (group_id, member_id)
);

create index if not exists friend_group_members_member_idx
  on public.friend_group_members (member_id);

comment on table public.friend_group_members is
  'Friend in a friend_group, several groups per friend allowed. Every read filters by the current friendship; a row of a dead friendship stays and is ignored.';

-- Visibility --------------------------------------------------
create table if not exists public.social_visibility (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  hangar     boolean not null default true,
  flagship   boolean not null default true,
  presence   boolean not null default true,
  stats      boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.social_visibility is
  'General setting: what my friends see automatically (reading R4). No row means everything on.';

create table if not exists public.social_visibility_overrides (
  user_id    uuid not null references auth.users (id) on delete cascade,
  friend_id  uuid not null references auth.users (id) on delete cascade,
  hangar     boolean,
  flagship   boolean,
  presence   boolean,
  stats      boolean,
  updated_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

create index if not exists social_visibility_overrides_friend_idx
  on public.social_visibility_overrides (friend_id);

comment on table public.social_visibility_overrides is
  'Per-friend override of social_visibility. NULL in a facet = inherit the general setting; a row with four NULLs is deleted.';

-- Presence ----------------------------------------------------
create table if not exists public.user_presence (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  -- Rightmost bit = active_day, each bit to the left one day earlier. Rewritten
  -- on touch, so the 30-day counter costs four bytes and never grows.
  active_days  bit(30) not null default 1::bit(30),
  active_day   date not null default ((now() at time zone 'utc')::date)
);

create index if not exists user_presence_seen_idx on public.user_presence (last_seen_at);

comment on table public.user_presence is
  'One row per account: last_seen_at for "online" (within 5 minutes) and a 30-day active-day mask. Written only through touch_presence(), read only through friend-gated RPCs. Separate from profiles.last_seen_at, whose 5-minute throttle cannot back a 5-minute online window.';

-- Generalised friend shares -----------------------------------
create table if not exists public.friend_shares (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('einsatz', 'ship_config')),
  einsatz_id  uuid references public.hq_einsaetze (id) on delete cascade,
  config_id   uuid references public.hangar_ship_configs (id) on delete cascade,
  shared_with uuid references auth.users (id) on delete cascade,
  group_id    uuid references public.friend_groups (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint friend_shares_subject check (
    (kind = 'einsatz' and einsatz_id is not null and config_id is null)
    or (kind = 'ship_config' and config_id is not null and einsatz_id is null)
  ),
  constraint friend_shares_one_audience check (num_nonnulls(shared_with, group_id) = 1),
  constraint friend_shares_not_self check (shared_with is null or shared_with <> owner_id)
);

create unique index if not exists friend_shares_einsatz_friend_unique
  on public.friend_shares (einsatz_id, shared_with) where einsatz_id is not null and shared_with is not null;
create unique index if not exists friend_shares_einsatz_group_unique
  on public.friend_shares (einsatz_id, group_id) where einsatz_id is not null and group_id is not null;
create unique index if not exists friend_shares_config_friend_unique
  on public.friend_shares (config_id, shared_with) where config_id is not null and shared_with is not null;
create unique index if not exists friend_shares_config_group_unique
  on public.friend_shares (config_id, group_id) where config_id is not null and group_id is not null;
create index if not exists friend_shares_shared_with_idx
  on public.friend_shares (shared_with, kind) where shared_with is not null;
create index if not exists friend_shares_group_idx
  on public.friend_shares (group_id, kind) where group_id is not null;
create index if not exists friend_shares_owner_idx on public.friend_shares (owner_id, kind);

comment on table public.friend_shares is
  'An Einsatz or ship variant shared read-only with one friend (shared_with) or a friend_group (group_id, expanded at read time). Revoke = delete.';

-- Crew slots and RSVPs ----------------------------------------
create table if not exists public.einsatz_crew_slots (
  id         uuid primary key default gen_random_uuid(),
  einsatz_id uuid not null references public.hq_einsaetze (id) on delete cascade,
  ord        integer not null,
  label      text not null,
  created_at timestamptz not null default now(),
  constraint einsatz_crew_slots_ord check (ord between 0 and 11),
  constraint einsatz_crew_slots_label_len check (char_length(btrim(label)) between 1 and 40),
  constraint einsatz_crew_slots_position unique (einsatz_id, ord)
);

comment on table public.einsatz_crew_slots is
  'Crew slot labels the Einsatz owner set, at most 12 per Einsatz. Written only through set_einsatz_slots().';

create table if not exists public.einsatz_rsvps (
  einsatz_id  uuid not null references public.hq_einsaetze (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  answer      text not null check (answer in ('yes', 'maybe', 'no')),
  slot_id     uuid references public.einsatz_crew_slots (id) on delete set null,
  answered_at timestamptz not null default now(),
  primary key (einsatz_id, user_id)
);

-- One person per slot. The primary key already makes it one slot per person.
create unique index if not exists einsatz_rsvps_slot_unique
  on public.einsatz_rsvps (slot_id) where slot_id is not null;
create index if not exists einsatz_rsvps_user_idx on public.einsatz_rsvps (user_id);

comment on table public.einsatz_rsvps is
  'A yes/maybe/no on an Einsatz plus at most one crew slot. Written only through respond_einsatz(). A row whose author lost access is ignored by every read and evicted when another person takes the slot.';

-- Provenance of an adopted set --------------------------------
alter table public.hangar_role_loadouts
  add column if not exists source_loadout_id uuid references public.hangar_role_loadouts (id) on delete set null,
  add column if not exists source_owner_id uuid references auth.users (id) on delete set null;

comment on column public.hangar_role_loadouts.source_loadout_id is
  'The friend''s set this row was copied from by adopt_friend_loadout(). The copy belongs to user_id and never follows the source. Also what makes re-adopting idempotent.';
comment on column public.hangar_role_loadouts.source_owner_id is
  'The friend who shared the set this row was copied from. A hint for "from <friend>", no access is derived from it.';

create unique index if not exists hangar_role_loadouts_adopted_unique
  on public.hangar_role_loadouts (user_id, source_loadout_id)
  where source_loadout_id is not null and deleted_at is null;

-- RLS on, no policy, no grant: everything below is the only way in.
do $$
declare
  t text;
begin
  foreach t in array array[
    'friend_invites', 'friend_groups', 'friend_group_members',
    'social_visibility', 'social_visibility_overrides', 'user_presence',
    'friend_shares', 'einsatz_crew_slots', 'einsatz_rsvps'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;


-- ============================================================
-- PART 2 - internal helpers (no grant to any client role)
-- ============================================================

-- An account another person may still see through: approved and not suspended.
create or replace function public.social_peer_ok(p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user
      and p.is_approved
      and (p.suspended_at is null or (p.suspended_until is not null and p.suspended_until <= now()))
  );
$$;

-- The visibility decision: per-friend override, then general setting, then ON.
create or replace function public.social_visible(p_owner uuid, p_viewer uuid, p_facet text)
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce(
    (select case p_facet
              when 'hangar' then o.hangar when 'flagship' then o.flagship
              when 'presence' then o.presence when 'stats' then o.stats end
       from public.social_visibility_overrides o
      where o.user_id = p_owner and o.friend_id = p_viewer),
    (select case p_facet
              when 'hangar' then g.hangar when 'flagship' then g.flagship
              when 'presence' then g.presence when 'stats' then g.stats end
       from public.social_visibility g
      where g.user_id = p_owner),
    true
  );
$$;

-- Does this share reach p_viewer right now?
create or replace function public.friend_share_reaches(
  p_shared_with uuid, p_group uuid, p_owner uuid, p_viewer uuid
)
returns boolean language sql security definer set search_path = public stable as $$
  select p_viewer is not null
    and public.are_friends(p_viewer, p_owner)
    and public.social_peer_ok(p_owner)
    and (
      p_shared_with = p_viewer
      or exists (
        select 1 from public.friend_group_members m
        where m.group_id = p_group and m.member_id = p_viewer
      )
    );
$$;

create or replace function public.einsatz_access(p_einsatz uuid, p_viewer uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.friend_shares s
    where s.einsatz_id = p_einsatz
      and public.friend_share_reaches(s.shared_with, s.group_id, s.owner_id, p_viewer)
  );
$$;

-- Crew view of one Einsatz as p_viewer sees it. The owner sees every answer. A
-- friend sees the slots, the three counts and their own answer; the name on a
-- taken slot only for the owner, themselves and their own friends, so a share
-- does not introduce two people who are not friends with each other.
create or replace function public.einsatz_crew_json(p_einsatz uuid, p_owner uuid, p_viewer uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  with valid as materialized (
    select r.user_id, r.answer, r.slot_id, r.answered_at, p.display_name, p.username
    from public.einsatz_rsvps r
    join public.profiles p on p.id = r.user_id
    where r.einsatz_id = p_einsatz
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
                or public.are_friends(p_viewer, v.user_id))
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

-- Everything the owner shared that the viewer can read right now.
create or replace function public.friend_shared_between(p_owner uuid, p_viewer uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'loadouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'share_id', s.id, 'loadout_id', l.id, 'name', l.name, 'role', l.role, 'shared_at', s.created_at
      ) order by s.created_at desc)
      from public.loadout_shares s
      join public.hangar_role_loadouts l on l.id = s.loadout_id
      where s.owner_id = p_owner and s.shared_with = p_viewer
        and s.revoked_at is null and l.deleted_at is null
    ), '[]'::jsonb),
    'einsaetze', coalesce((
      select jsonb_agg(jsonb_build_object(
        'einsatz_id', e.id, 'title', e.title, 'activity', e.activity,
        'status', e.status, 'planned_at', e.planned_at
      ) order by e.planned_at nulls last)
      from public.hq_einsaetze e
      where e.user_id = p_owner and e.deleted_at is null and e.status <> 'archived'
        and exists (
          select 1 from public.friend_shares s
          where s.einsatz_id = e.id
            and public.friend_share_reaches(s.shared_with, s.group_id, s.owner_id, p_viewer)
        )
    ), '[]'::jsonb),
    'ship_configs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'share_id', d.share_id, 'config_id', d.config_id, 'name', d.name, 'role', d.role,
        'ship_class_name', d.ship_class_name
      ) order by d.name)
      from (
        select distinct on (c.id) s.id as share_id, c.id as config_id, c.name, c.role, h.ship_class_name
        from public.friend_shares s
        join public.hangar_ship_configs c on c.id = s.config_id
        join public.hangar_ships h on h.id = c.hangar_ship_id
        where s.owner_id = p_owner and s.kind = 'ship_config' and c.deleted_at is null
          and public.friend_share_reaches(s.shared_with, s.group_id, s.owner_id, p_viewer)
        order by c.id, s.created_at
      ) d
    ), '[]'::jsonb)
  );
$$;

-- The numbers the comparison block shows. Only what the server really knows:
--   ships           hangar_ships, status owned
--   sets            hangar_role_loadouts
--   einsaetze_*     hq_einsaetze: planned = planned or active, done = done
--   missions_30d    the same count of contract.completed as hq_stats('30d')
--   kartograph_rank patch lines with at least 7 stars, verse_explorer_state's rule
--   active_days_30  the presence mask
--   desktop_connected a desktop_connections check-in or an SCC App live event
--                   within 30 days; the SCC App has no desktop_connections
--                   product, its proof of life is hq_live_events
create or replace function public.social_stats(p_user uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'ships', (select count(*) from public.hangar_ships h
               where h.user_id = p_user and h.status = 'owned' and h.deleted_at is null),
    'sets', (select count(*) from public.hangar_role_loadouts l
              where l.user_id = p_user and l.deleted_at is null),
    'einsaetze_planned', (select count(*) from public.hq_einsaetze e
                           where e.user_id = p_user and e.deleted_at is null
                             and e.status in ('planned', 'active')),
    'einsaetze_done', (select count(*) from public.hq_einsaetze e
                        where e.user_id = p_user and e.deleted_at is null and e.status = 'done'),
    'missions_30d', (select count(*) from public.hq_live_events ev
                      where ev.user_id = p_user and ev.type = 'contract.completed'
                        and ev.at >= now() - interval '30 days'),
    'kartograph_rank', (select count(*) from (
                          select sp.patch_line from public.verse_star_progress sp
                           where sp.user_id = p_user
                           group by sp.patch_line
                          having count(*) >= 7) full_lines),
    'active_days_30', coalesce((
      select bit_count(u.active_days << least(30, (now() at time zone 'utc')::date - u.active_day))
        from public.user_presence u where u.user_id = p_user), 0),
    'desktop_connected', (
      exists (select 1 from public.desktop_connections dc
               where dc.user_id = p_user and dc.last_seen_at >= now() - interval '30 days')
      or exists (select 1 from public.hq_live_events ev
                  where ev.user_id = p_user and ev.at >= now() - interval '30 days'))
  );
$$;

revoke all on function public.social_peer_ok(uuid) from public, anon, authenticated;
revoke all on function public.social_visible(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.friend_share_reaches(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.einsatz_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.einsatz_crew_json(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.friend_shared_between(uuid, uuid) from public, anon, authenticated;
revoke all on function public.social_stats(uuid) from public, anon, authenticated;


-- ============================================================
-- PART 3 - invite links (C20)
-- ============================================================

-- Idempotent like create_loadout_link(): a double click cannot leave a second
-- live URL behind. At most 10 fresh links a day, dead rows go after 30 days.
create or replace function public.create_friend_invite()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_invite public.friend_invites%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('friend_invites:' || caller::text, 0));

  update public.friend_invites i
     set revoked_at = now()
   where i.owner_id = caller and i.revoked_at is null and i.expires_at <= now();

  select * into v_invite from public.friend_invites i
   where i.owner_id = caller and i.revoked_at is null;
  if found then
    return jsonb_build_object('token', v_invite.token, 'expires_at', v_invite.expires_at);
  end if;

  if (select count(*) from public.friend_invites i
       where i.owner_id = caller and i.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'invite_limit' using errcode = '54000';
  end if;

  delete from public.friend_invites i
   where i.owner_id = caller and i.created_at < now() - interval '30 days';

  insert into public.friend_invites (owner_id, token)
  values (caller, public.new_share_token())
  returning * into v_invite;
  return jsonb_build_object('token', v_invite.token, 'expires_at', v_invite.expires_at);
end;
$$;

-- Idempotent: revoking when there is no live link is not an error.
create or replace function public.revoke_friend_invite()
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  update public.friend_invites i
     set revoked_at = now()
   where i.owner_id = caller and i.revoked_at is null;
end;
$$;

create or replace function public.my_friend_invite()
returns table (token text, expires_at timestamptz)
language sql security definer set search_path = public stable as $$
  select i.token, i.expires_at
  from public.friend_invites i
  where i.owner_id = auth.uid()
    and public.is_approved()
    and i.revoked_at is null
    and i.expires_at > now()
$$;

-- The one anon read: what a sign-in step needs and nothing else. Zero rows for
-- an unknown, revoked or expired token, a suspended or unapproved owner and a
-- block in either direction, all alike, so this cannot probe which tokens once
-- existed and cannot detect a block.
create or replace function public.peek_friend_invite(p_token text)
returns table (display_handle text)
language sql security definer set search_path = public stable as $$
  select coalesce(p.username::text, p.display_name)
  from public.friend_invites i
  join public.profiles p on p.id = i.owner_id
  where i.token = p_token
    and i.revoked_at is null
    and i.expires_at > now()
    and public.social_peer_ok(i.owner_id)
    and not public.is_blocked_between(auth.uid(), i.owner_id)
  limit 1
$$;

-- The click. Runs send_friend_request() for the invitee, so a crossing request
-- becomes a friendship the same way it does there. send_friend_request() itself
-- has no rate limit, so the two limits here are new: 20 fresh requests an hour
-- from one account through invite links, 50 pending on one inviter (a link
-- posted publicly must not bury the inviter).
create or replace function public.redeem_friend_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_invite public.friend_invites%rowtype;
  v_verdict text;
  v_name text;
  v_handle citext;
begin
  select * into v_invite from public.friend_invites i where i.token = p_token;
  -- Blocked answers like unknown: the caller must not be able to tell.
  if v_invite.id is null
     or v_invite.revoked_at is not null
     or not public.social_peer_ok(v_invite.owner_id)
     or public.is_blocked_between(caller, v_invite.owner_id) then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'P0002';
  end if;
  if v_invite.owner_id = caller then
    raise exception 'invite_self' using errcode = '22023';
  end if;

  if not public.are_friends(caller, v_invite.owner_id)
     and not exists (
       select 1 from public.friend_requests r
        where r.requester_id = caller and r.addressee_id = v_invite.owner_id and r.status = 'pending'
     ) then
    if (select count(*) from public.friend_requests r
         where r.requester_id = caller and r.status = 'pending'
           and r.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'invite_rate_limited' using errcode = '54000';
    end if;
    if (select count(*) from public.friend_requests r
         where r.addressee_id = v_invite.owner_id and r.status = 'pending'
           and r.created_at > now() - public.friend_request_ttl()) >= 50 then
      raise exception 'invite_full' using errcode = '54000';
    end if;
  end if;

  v_verdict := public.send_friend_request(v_invite.owner_id);

  select p.display_name, p.username into v_name, v_handle
    from public.profiles p where p.id = v_invite.owner_id;
  return jsonb_build_object(
    'verdict', v_verdict,
    'user_id', v_invite.owner_id,
    'display_name', v_name,
    'username', v_handle
  );
end;
$$;

revoke all on function public.create_friend_invite() from public, anon;
revoke all on function public.revoke_friend_invite() from public, anon;
revoke all on function public.my_friend_invite() from public, anon;
revoke all on function public.peek_friend_invite(text) from public;
revoke all on function public.redeem_friend_invite(text) from public, anon;
grant execute on function public.create_friend_invite() to authenticated;
grant execute on function public.revoke_friend_invite() to authenticated;
grant execute on function public.my_friend_invite() to authenticated;
grant execute on function public.peek_friend_invite(text) to anon, authenticated;
grant execute on function public.redeem_friend_invite(text) to authenticated;


-- ============================================================
-- PART 4 - friend groups (C18, R2)
-- ============================================================

create or replace function public.owned_friend_group(p_group uuid)
returns uuid language plpgsql security definer set search_path = public stable as $$
declare caller uuid := public.social_actor();
begin
  if not exists (select 1 from public.friend_groups g where g.id = p_group and g.owner_id = caller) then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  return caller;
end;
$$;
revoke all on function public.owned_friend_group(uuid) from public, anon, authenticated;

create or replace function public.create_friend_group(p_kind text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('org', 'einsatzgruppe') then
    raise exception 'invalid_group_kind' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'invalid_group_name' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('friend_groups:' || caller::text, 0));
  if (select count(*) from public.friend_groups g where g.owner_id = caller) >= 50 then
    raise exception 'group_limit' using errcode = '54000';
  end if;
  begin
    insert into public.friend_groups (owner_id, kind, name)
    values (caller, p_kind, v_name)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'group_name_taken' using errcode = '23505';
  end;
  return v_id;
end;
$$;

create or replace function public.rename_friend_group(p_group uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.owned_friend_group(p_group);
  v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 60 then
    raise exception 'invalid_group_name' using errcode = '22023';
  end if;
  begin
    update public.friend_groups g
       set name = v_name, updated_at = now()
     where g.id = p_group and g.owner_id = caller;
  exception when unique_violation then
    raise exception 'group_name_taken' using errcode = '23505';
  end;
end;
$$;

create or replace function public.delete_friend_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.owned_friend_group(p_group);
begin
  delete from public.friend_groups g where g.id = p_group and g.owner_id = caller;
end;
$$;

create or replace function public.set_friend_group_member(p_group uuid, p_member uuid, p_in boolean)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.owned_friend_group(p_group);
begin
  if p_member is null or p_member = caller or p_in is null then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not p_in then
    delete from public.friend_group_members m where m.group_id = p_group and m.member_id = p_member;
    return;
  end if;
  if not public.are_friends(caller, p_member) then
    raise exception 'not_friends' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('friend_group_members:' || p_group::text, 0));
  if (select count(*) from public.friend_group_members m where m.group_id = p_group) >= 100 then
    raise exception 'group_full' using errcode = '54000';
  end if;
  insert into public.friend_group_members (group_id, member_id)
  values (p_group, p_member)
  on conflict do nothing;
end;
$$;

create or replace function public.list_my_friend_groups()
returns table (
  id         uuid,
  kind       text,
  name       text,
  created_at timestamptz,
  members    jsonb
)
language sql security definer set search_path = public stable as $$
  select g.id, g.kind, g.name, g.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.id, 'display_name', p.display_name, 'username', p.username
      ) order by coalesce(p.username::text, p.display_name))
      from public.friend_group_members m
      join public.profiles p on p.id = m.member_id
      where m.group_id = g.id
        and public.are_friends(g.owner_id, m.member_id)
        and public.social_peer_ok(m.member_id)
    ), '[]'::jsonb)
  from public.friend_groups g
  where g.owner_id = auth.uid() and public.is_approved()
  order by g.kind, lower(g.name)
$$;

revoke all on function public.create_friend_group(text, text) from public, anon;
revoke all on function public.rename_friend_group(uuid, text) from public, anon;
revoke all on function public.delete_friend_group(uuid) from public, anon;
revoke all on function public.set_friend_group_member(uuid, uuid, boolean) from public, anon;
revoke all on function public.list_my_friend_groups() from public, anon;
grant execute on function public.create_friend_group(text, text) to authenticated;
grant execute on function public.rename_friend_group(uuid, text) to authenticated;
grant execute on function public.delete_friend_group(uuid) to authenticated;
grant execute on function public.set_friend_group_member(uuid, uuid, boolean) to authenticated;
grant execute on function public.list_my_friend_groups() to authenticated;


-- ============================================================
-- PART 5 - visibility (C21, R4)
-- ============================================================

create or replace function public.get_my_social_visibility()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare caller uuid := public.social_actor();
begin
  return jsonb_build_object(
    'general', coalesce((
      select jsonb_build_object('hangar', g.hangar, 'flagship', g.flagship, 'presence', g.presence, 'stats', g.stats)
      from public.social_visibility g where g.user_id = caller
    ), jsonb_build_object('hangar', true, 'flagship', true, 'presence', true, 'stats', true)),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', o.friend_id, 'display_name', p.display_name, 'username', p.username,
        'hangar', o.hangar, 'flagship', o.flagship, 'presence', o.presence, 'stats', o.stats
      ) order by coalesce(p.username::text, p.display_name))
      from public.social_visibility_overrides o
      join public.profiles p on p.id = o.friend_id
      where o.user_id = caller and public.are_friends(caller, o.friend_id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_my_social_visibility(
  p_hangar boolean, p_flagship boolean, p_presence boolean, p_stats boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  if p_hangar is null or p_flagship is null or p_presence is null or p_stats is null then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  insert into public.social_visibility as g (user_id, hangar, flagship, presence, stats)
  values (caller, p_hangar, p_flagship, p_presence, p_stats)
  on conflict (user_id) do update
    set hangar = excluded.hangar, flagship = excluded.flagship,
        presence = excluded.presence, stats = excluded.stats, updated_at = now();
end;
$$;

-- NULL = inherit the general setting; four NULLs remove the override.
create or replace function public.set_friend_visibility(
  p_friend uuid, p_hangar boolean, p_flagship boolean, p_presence boolean, p_stats boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  if p_friend is null or p_friend = caller then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not public.are_friends(caller, p_friend) then
    raise exception 'not_friends' using errcode = '42501';
  end if;
  if num_nonnulls(p_hangar, p_flagship, p_presence, p_stats) = 0 then
    delete from public.social_visibility_overrides o
     where o.user_id = caller and o.friend_id = p_friend;
    return;
  end if;
  insert into public.social_visibility_overrides as o (user_id, friend_id, hangar, flagship, presence, stats)
  values (caller, p_friend, p_hangar, p_flagship, p_presence, p_stats)
  on conflict (user_id, friend_id) do update
    set hangar = excluded.hangar, flagship = excluded.flagship,
        presence = excluded.presence, stats = excluded.stats, updated_at = now();
end;
$$;

revoke all on function public.get_my_social_visibility() from public, anon;
revoke all on function public.set_my_social_visibility(boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.set_friend_visibility(uuid, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.get_my_social_visibility() to authenticated;
grant execute on function public.set_my_social_visibility(boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.set_friend_visibility(uuid, boolean, boolean, boolean, boolean) to authenticated;


-- ============================================================
-- PART 6 - presence (C06)
-- ============================================================

-- At most one write per 2 minutes, whatever the client does. Silent for an
-- account that is not allowed in: this runs on a timer and must not produce an
-- error every few minutes.
create or replace function public.touch_presence()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
begin
  if v_uid is null or not public.is_approved() then
    return;
  end if;
  insert into public.user_presence as u (user_id, last_seen_at, active_days, active_day)
  values (v_uid, now(), 1::bit(30), v_today)
  on conflict (user_id) do update
    set last_seen_at = now(),
        active_days = (u.active_days << least(30, v_today - u.active_day)) | 1::bit(30),
        active_day = v_today
    where u.last_seen_at < now() - interval '2 minutes';
end;
$$;

-- Friends who are online right now and let this viewer see it. Online = seen
-- within 5 minutes. Only the id: "last seen at 03:12" is more than the feature
-- asked for.
create or replace function public.list_online_friends()
returns table (user_id uuid)
language sql security definer set search_path = public stable as $$
  select u.user_id
  from public.user_presence u
  join public.friendships f
    on auth.uid() in (f.user_low, f.user_high)
   and u.user_id = case when f.user_low = auth.uid() then f.user_high else f.user_low end
  where public.is_approved()
    and u.last_seen_at >= now() - interval '5 minutes'
    and public.social_peer_ok(u.user_id)
    and public.social_visible(u.user_id, auth.uid(), 'presence')
$$;

revoke all on function public.touch_presence() from public, anon;
revoke all on function public.list_online_friends() from public, anon;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.list_online_friends() to authenticated;


-- ============================================================
-- PART 7 - sharing an Einsatz or a ship variant (C03, C04)
-- ============================================================

-- The shared write path of both share RPCs: exactly one audience, a current
-- friend or an own group.
create or replace function public.friend_share_insert(
  p_owner uuid, p_kind text, p_einsatz uuid, p_config uuid, p_friend uuid, p_group uuid
)
returns text language plpgsql security definer set search_path = public as $$
declare inserted integer;
begin
  if num_nonnulls(p_friend, p_group) <> 1 or p_friend = p_owner then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if p_friend is not null and not public.are_friends(p_owner, p_friend) then
    raise exception 'not_friends' using errcode = '42501';
  end if;
  if p_group is not null and not exists (
    select 1 from public.friend_groups g where g.id = p_group and g.owner_id = p_owner
  ) then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  insert into public.friend_shares (owner_id, kind, einsatz_id, config_id, shared_with, group_id)
  values (p_owner, p_kind, p_einsatz, p_config, p_friend, p_group)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  return case when inserted > 0 then 'created' else 'duplicate' end;
end;
$$;
revoke all on function public.friend_share_insert(uuid, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.share_einsatz(p_einsatz uuid, p_friend uuid default null, p_group uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  if not exists (
    select 1 from public.hq_einsaetze e
    where e.id = p_einsatz and e.user_id = caller and e.deleted_at is null
  ) then
    raise exception 'einsatz_not_found' using errcode = 'P0002';
  end if;
  return public.friend_share_insert(caller, 'einsatz', p_einsatz, null, p_friend, p_group);
end;
$$;

create or replace function public.share_ship_config(p_config uuid, p_friend uuid default null, p_group uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  if not exists (
    select 1 from public.hangar_ship_configs c
    where c.id = p_config and c.user_id = caller and c.deleted_at is null
  ) then
    raise exception 'config_not_found' using errcode = 'P0002';
  end if;
  return public.friend_share_insert(caller, 'ship_config', null, p_config, p_friend, p_group);
end;
$$;

create or replace function public.revoke_friend_share(p_share uuid)
returns void language plpgsql security definer set search_path = public as $$
declare caller uuid := public.social_actor();
begin
  delete from public.friend_shares s where s.id = p_share and s.owner_id = caller;
  if not found then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Owner view of one subject's audience. Empty for anything not the caller's.
create or replace function public.list_friend_shares(p_kind text, p_subject uuid)
returns table (
  share_id      uuid,
  shared_with   uuid,
  friend_name   text,
  friend_handle citext,
  group_id      uuid,
  group_name    text,
  group_kind    text,
  created_at    timestamptz
)
language sql security definer set search_path = public stable as $$
  select s.id, s.shared_with, p.display_name, p.username, s.group_id, g.name, g.kind, s.created_at
  from public.friend_shares s
  left join public.profiles p on p.id = s.shared_with
  left join public.friend_groups g on g.id = s.group_id
  where s.owner_id = auth.uid()
    and public.is_approved()
    and s.kind = p_kind
    and ((p_kind = 'einsatz' and s.einsatz_id = p_subject)
      or (p_kind = 'ship_config' and s.config_id = p_subject))
    and (s.group_id is not null or public.are_friends(auth.uid(), s.shared_with))
  order by s.created_at desc
$$;

-- A set shared with a group: one loadout_shares row per current friend in the
-- group, at share time (that table has no group column). Returns how many new.
create or replace function public.share_loadout_with_group(p_loadout uuid, p_group uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.owned_loadout(p_loadout);
  inserted integer;
begin
  perform public.owned_friend_group(p_group);
  insert into public.loadout_shares (owner_id, loadout_id, shared_with)
  select caller, p_loadout, m.member_id
  from public.friend_group_members m
  where m.group_id = p_group and public.are_friends(caller, m.member_id)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- Everything friends shared with me, one row per Einsatz even when it reaches
-- me twice (directly and through a group). supply_id and done_by stay out: the
-- first points into the owner's private supplies, the second is bookkeeping.
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
    select s.einsatz_id, min(s.created_at) as shared_at
    from public.friend_shares s
    cross join me
    where s.kind = 'einsatz'
      and (s.shared_with = me.id
           or s.group_id in (select m.group_id from public.friend_group_members m where m.member_id = me.id))
      and public.are_friends(me.id, s.owner_id)
      and public.social_peer_ok(s.owner_id)
    group by s.einsatz_id
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

create or replace function public.list_ship_configs_shared_with_me()
returns table (
  share_id        uuid,
  config_id       uuid,
  name            text,
  role            text,
  loadout         jsonb,
  ship_class_name text,
  owner_id        uuid,
  owner_name      text,
  owner_handle    citext,
  shared_at       timestamptz,
  updated_at      timestamptz
)
language sql security definer set search_path = public stable as $$
  select d.share_id, d.config_id, d.name, d.role, d.loadout, d.ship_class_name,
         d.owner_id, d.display_name, d.username, d.shared_at, d.updated_at
  from (
    select distinct on (c.id)
      s.id as share_id, c.id as config_id, c.name, c.role, c.loadout, h.ship_class_name,
      s.owner_id, p.display_name, p.username, s.created_at as shared_at, c.updated_at
    from public.friend_shares s
    join public.hangar_ship_configs c on c.id = s.config_id
    join public.hangar_ships h on h.id = c.hangar_ship_id
    join public.profiles p on p.id = s.owner_id
    where s.kind = 'ship_config'
      and public.is_approved()
      and c.deleted_at is null
      and public.friend_share_reaches(s.shared_with, s.group_id, s.owner_id, auth.uid())
    order by c.id, s.created_at
  ) d
  order by d.shared_at desc
$$;

revoke all on function public.share_einsatz(uuid, uuid, uuid) from public, anon;
revoke all on function public.share_ship_config(uuid, uuid, uuid) from public, anon;
revoke all on function public.revoke_friend_share(uuid) from public, anon;
revoke all on function public.list_friend_shares(text, uuid) from public, anon;
revoke all on function public.share_loadout_with_group(uuid, uuid) from public, anon;
revoke all on function public.list_einsaetze_shared_with_me() from public, anon;
revoke all on function public.list_ship_configs_shared_with_me() from public, anon;
grant execute on function public.share_einsatz(uuid, uuid, uuid) to authenticated;
grant execute on function public.share_ship_config(uuid, uuid, uuid) to authenticated;
grant execute on function public.revoke_friend_share(uuid) to authenticated;
grant execute on function public.list_friend_shares(text, uuid) to authenticated;
grant execute on function public.share_loadout_with_group(uuid, uuid) to authenticated;
grant execute on function public.list_einsaetze_shared_with_me() to authenticated;
grant execute on function public.list_ship_configs_shared_with_me() to authenticated;


-- ============================================================
-- PART 8 - adopt as a copy (C02, C04)
-- ============================================================

-- A friend-shared set becomes a set of the recipient's. Server-side so the
-- recipient never needs a read of the source row. Idempotent per source.
create or replace function public.adopt_friend_loadout(p_share uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_source public.hangar_role_loadouts%rowtype;
  v_id uuid;
begin
  select l.* into v_source
  from public.loadout_shares s
  join public.hangar_role_loadouts l on l.id = s.loadout_id
  where s.id = p_share
    and s.shared_with = caller
    and s.revoked_at is null
    and l.deleted_at is null
    and public.are_friends(caller, s.owner_id)
    and public.social_peer_ok(s.owner_id);
  if v_source.id is null then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;

  select l.id into v_id from public.hangar_role_loadouts l
   where l.user_id = caller and l.source_loadout_id = v_source.id and l.deleted_at is null;
  if v_id is not null then
    return jsonb_build_object('loadoutId', v_id, 'existed', true);
  end if;

  insert into public.hangar_role_loadouts (user_id, name, role, items, source_loadout_id, source_owner_id)
  values (caller, v_source.name, v_source.role, v_source.items, v_source.id, v_source.user_id)
  on conflict (user_id, source_loadout_id) where source_loadout_id is not null and deleted_at is null
  do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost the race to a concurrent adopt of the same source.
    select l.id into v_id from public.hangar_role_loadouts l
     where l.user_id = caller and l.source_loadout_id = v_source.id and l.deleted_at is null;
    return jsonb_build_object('loadoutId', v_id, 'existed', true);
  end if;
  return jsonb_build_object('loadoutId', v_id, 'existed', false);
end;
$$;

-- A friend-shared ship variant becomes a config of the recipient's, adding the
-- ship to their hangar like adopt_shared_loadout() does. follows_owner stays
-- false (see the header); source_config_id only makes re-adopting idempotent.
create or replace function public.adopt_friend_ship_config(p_share uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_source public.hangar_ship_configs%rowtype;
  v_class text;
  v_ship uuid;
  v_id uuid;
  v_existed boolean := true;
begin
  select c.* into v_source
  from public.friend_shares s
  join public.hangar_ship_configs c on c.id = s.config_id
  where s.id = p_share
    and s.kind = 'ship_config'
    and c.deleted_at is null
    and public.friend_share_reaches(s.shared_with, s.group_id, s.owner_id, caller);
  if v_source.id is null then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;
  select h.ship_class_name into v_class from public.hangar_ships h where h.id = v_source.hangar_ship_id;

  select c.id into v_id from public.hangar_ship_configs c
   where c.user_id = caller and c.source_config_id = v_source.id and c.deleted_at is null;

  if v_id is null then
    select h.id into v_ship from public.hangar_ships h
     where h.user_id = caller and h.ship_class_name = v_class;
    if v_ship is null then
      insert into public.hangar_ships (user_id, ship_class_name, status)
      values (caller, v_class, 'owned')
      returning id into v_ship;
    else
      update public.hangar_ships h set deleted_at = null
       where h.id = v_ship and h.deleted_at is not null;
    end if;

    perform set_config('hangar.internal_write', 'on', true);
    -- A tombstone of an earlier copy holds the unique slot, drop it first.
    delete from public.hangar_ship_configs c
     where c.user_id = caller and c.source_config_id = v_source.id and c.deleted_at is not null;
    insert into public.hangar_ship_configs (
      user_id, hangar_ship_id, name, role, loadout,
      source_config_id, follows_owner, owner_user_id, forked_at
    ) values (
      caller, v_ship, v_source.name, v_source.role, v_source.loadout,
      v_source.id, false, v_source.user_id, now()
    )
    on conflict (user_id, source_config_id) where source_config_id is not null do nothing
    returning id into v_id;
    perform set_config('hangar.internal_write', 'off', true);

    if v_id is null then
      select c.id into v_id from public.hangar_ship_configs c
       where c.user_id = caller and c.source_config_id = v_source.id;
    else
      v_existed := false;
    end if;
  end if;

  return jsonb_build_object('configId', v_id, 'shipClassName', v_class, 'existed', v_existed);
end;
$$;

revoke all on function public.adopt_friend_loadout(uuid) from public, anon;
revoke all on function public.adopt_friend_ship_config(uuid) from public, anon;
grant execute on function public.adopt_friend_loadout(uuid) to authenticated;
grant execute on function public.adopt_friend_ship_config(uuid) to authenticated;


-- ============================================================
-- PART 9 - crew slots and RSVPs (C05)
-- ============================================================

-- The owner writes the whole label list. A label stays attached to its position,
-- so renaming keeps the person on it; a removed position frees its taker's slot
-- (einsatz_rsvps.slot_id goes to null, the answer stays).
create or replace function public.set_einsatz_slots(p_einsatz uuid, p_labels text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  n integer := coalesce(cardinality(p_labels), 0);
  i integer;
  v_label text;
begin
  if not exists (
    select 1 from public.hq_einsaetze e
    where e.id = p_einsatz and e.user_id = caller and e.deleted_at is null
  ) then
    raise exception 'einsatz_not_found' using errcode = 'P0002';
  end if;
  if n > 12 then
    raise exception 'too_many_slots' using errcode = '54000';
  end if;

  delete from public.einsatz_crew_slots s where s.einsatz_id = p_einsatz and s.ord >= n;
  for i in 1 .. n loop
    v_label := btrim(coalesce(p_labels[i], ''));
    if char_length(v_label) not between 1 and 40 then
      raise exception 'invalid_slot_label' using errcode = '22023';
    end if;
    insert into public.einsatz_crew_slots (einsatz_id, ord, label)
    values (p_einsatz, i - 1, v_label)
    on conflict on constraint einsatz_crew_slots_position do update set label = excluded.label;
  end loop;

  return public.einsatz_crew_json(p_einsatz, caller, caller);
end;
$$;

-- The owner's own answer counts too: a planner usually flies along. p_slot null
-- means "no slot", so a client re-answering keeps a slot by passing it again;
-- answering no always frees it. A closed Einsatz takes no more answers.
create or replace function public.respond_einsatz(p_einsatz uuid, p_answer text, p_slot uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  caller uuid := public.social_actor();
  v_owner uuid;
  v_status text;
  v_slot uuid := case when p_answer = 'no' then null else p_slot end;
begin
  select e.user_id, e.status into v_owner, v_status
  from public.hq_einsaetze e
  where e.id = p_einsatz and e.deleted_at is null;
  if v_owner is null or (v_owner <> caller and not public.einsatz_access(p_einsatz, caller)) then
    raise exception 'einsatz_not_found' using errcode = 'P0002';
  end if;
  if v_status not in ('planned', 'active') then
    raise exception 'einsatz_closed' using errcode = '22023';
  end if;
  if p_answer is null or p_answer not in ('yes', 'maybe', 'no') then
    raise exception 'invalid_answer' using errcode = '22023';
  end if;

  if v_slot is not null then
    if not exists (select 1 from public.einsatz_crew_slots s where s.id = v_slot and s.einsatz_id = p_einsatz) then
      raise exception 'slot_not_found' using errcode = 'P0002';
    end if;
    -- A taker who lost access must not block the slot for ever.
    delete from public.einsatz_rsvps r
     where r.slot_id = v_slot and r.user_id <> caller and r.user_id <> v_owner
       and not public.einsatz_access(p_einsatz, r.user_id);
  end if;

  begin
    insert into public.einsatz_rsvps as r (einsatz_id, user_id, answer, slot_id)
    values (p_einsatz, caller, p_answer, v_slot)
    on conflict (einsatz_id, user_id) do update
      set answer = excluded.answer, slot_id = excluded.slot_id, answered_at = now();
  exception when unique_violation then
    raise exception 'slot_taken' using errcode = '23505';
  end;

  return public.einsatz_crew_json(p_einsatz, v_owner, caller);
end;
$$;

-- For the owner, or a friend with access. Same answer for "does not exist" and
-- "not yours to read".
create or replace function public.get_einsatz_crew(p_einsatz uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  caller uuid := public.social_actor();
  v_owner uuid;
begin
  select e.user_id into v_owner
  from public.hq_einsaetze e
  where e.id = p_einsatz and e.deleted_at is null;
  if v_owner is null or (v_owner <> caller and not public.einsatz_access(p_einsatz, caller)) then
    raise exception 'einsatz_not_found' using errcode = 'P0002';
  end if;
  return public.einsatz_crew_json(p_einsatz, v_owner, caller);
end;
$$;

revoke all on function public.set_einsatz_slots(uuid, text[]) from public, anon;
revoke all on function public.respond_einsatz(uuid, text, uuid) from public, anon;
revoke all on function public.get_einsatz_crew(uuid) from public, anon;
grant execute on function public.set_einsatz_slots(uuid, text[]) to authenticated;
grant execute on function public.respond_einsatz(uuid, text, uuid) to authenticated;
grant execute on function public.get_einsatz_crew(uuid) to authenticated;


-- ============================================================
-- PART 10 - friend page and comparison (C07, C19, C21)
-- ============================================================

-- The friends-only page. NULL for an unknown handle, a non-friend, a block and a
-- suspended account alike: "für alle anderen existiert sie nicht". p_friend is a
-- handle or a user id, because most accounts have no handle yet. notes,
-- selected_skin_id and the concept wishlist (hangar_concept_ships, free text) stay
-- out of `hangar`. A facet the friend hid arrives as null, never as an empty list.
create or replace function public.friend_overview(p_friend text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  caller uuid := public.social_actor();
  v_friend uuid;
  v_profile public.profiles%rowtype;
  v_since timestamptz;
  v_hangar boolean;
  v_flagship boolean;
  v_presence boolean;
  v_stats boolean;
begin
  if p_friend is null or btrim(p_friend) = '' then
    return null;
  end if;
  if p_friend ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_friend := p_friend::uuid;
  else
    select p.id into v_friend from public.profiles p where p.username = btrim(p_friend)::citext;
  end if;

  if v_friend is null or v_friend = caller or not public.social_peer_ok(v_friend) then
    return null;
  end if;
  select f.created_at into v_since
  from public.friendships f
  where f.user_low = least(caller, v_friend) and f.user_high = greatest(caller, v_friend);
  if v_since is null then
    return null;
  end if;

  select * into v_profile from public.profiles p where p.id = v_friend;
  v_hangar := public.social_visible(v_friend, caller, 'hangar');
  v_flagship := public.social_visible(v_friend, caller, 'flagship');
  v_presence := public.social_visible(v_friend, caller, 'presence');
  v_stats := public.social_visible(v_friend, caller, 'stats');

  return jsonb_build_object(
    'friend', jsonb_build_object(
      'user_id', v_friend,
      'display_name', v_profile.display_name,
      'username', v_profile.username,
      'since', v_since,
      'flagship_ship_class', case when v_flagship then v_profile.flagship_ship_class end,
      'online', case when v_presence then exists (
        select 1 from public.user_presence u
        where u.user_id = v_friend and u.last_seen_at >= now() - interval '5 minutes'
      ) end
    ),
    'from_friend', public.friend_shared_between(v_friend, caller),
    'from_me', public.friend_shared_between(caller, v_friend),
    'my_groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'name', g.name) order by g.kind, lower(g.name))
      from public.friend_groups g
      join public.friend_group_members m on m.group_id = g.id
      where g.owner_id = caller and m.member_id = v_friend
    ), '[]'::jsonb),
    'hangar', case when v_hangar then coalesce((
      select jsonb_agg(jsonb_build_object(
        'ship_class_name', h.ship_class_name,
        'custom_name', h.custom_name,
        'status', h.status,
        'pinned_rank', h.pinned_rank
      ) order by h.pinned_rank nulls last, h.ship_class_name)
      from public.hangar_ships h
      where h.user_id = v_friend and h.deleted_at is null
    ), '[]'::jsonb) end,
    'compare', jsonb_build_object(
      'me', public.social_stats(caller),
      'friend', case when v_stats then public.social_stats(v_friend) end
    )
  );
end;
$$;

-- The Social page's comparison in one call. `stats` is null for a friend who
-- hides it.
create or replace function public.list_friend_compare()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare caller uuid := public.social_actor();
begin
  return jsonb_build_object(
    'me', public.social_stats(caller),
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', d.id,
        'display_name', d.display_name,
        'username', d.username,
        'stats', case when public.social_visible(d.id, caller, 'stats') then public.social_stats(d.id) end
      ) order by coalesce(d.username::text, d.display_name))
      from (
        select p.id, p.display_name, p.username
        from public.friendships f
        join public.profiles p
          on p.id = case when f.user_low = caller then f.user_high else f.user_low end
        where caller in (f.user_low, f.user_high)
          and public.social_peer_ok(p.id)
      ) d
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.friend_overview(text) from public, anon;
revoke all on function public.list_friend_compare() from public, anon;
grant execute on function public.friend_overview(text) to authenticated;
grant execute on function public.list_friend_compare() to authenticated;

comment on function public.friend_overview(text) is
  'Friends-only page data. NULL for anyone who is not a current, unsuspended friend, so it cannot tell a non-friend from a missing account. Honours social_visibility on every facet.';
comment on function public.peek_friend_invite(text) is
  'Anon read for the invite sign-in step: only the display handle of a live invite.';
comment on function public.touch_presence() is
  'Marks the caller as seen, at most one write per 2 minutes. The only write path for user_presence.';
