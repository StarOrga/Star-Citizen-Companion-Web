-- ============================================================
-- 20260920160000_hangar_loadout_sharing.sql
-- Personal-hangar loadout sharing — concept decisions it.2 (hv-s4 comment),
-- it.3 (s3-follow / s3-fork / s3-hint), it.6 general comment.
--
-- MODEL (per the user's own explanation on hv-s4, verbatim rule):
--   A shared loadout is a FOLLOWING COPY: the recipient starts out seeing
--   every change the owner makes to their loadout. The moment the recipient
--   makes their OWN first edit, the copy FORKS — irreversibly. From then on
--   the recipient's copy is independent and the owner's further edits no
--   longer reach it; the only way back to "following" is the owner sharing
--   again (a brand-new adopt).
--
--   NO "source" (NPC / Wikelo / …) column — the user explicitly said a
--   skin-only difference does not warrant a variant (that stays a 3D-mode
--   skin pick); a variant needs an actual LOADOUT difference. The only
--   provenance kept is WHO owns the followed copy and WHEN it was last
--   touched, driving the display hint "gespeichert gestern/heute/<Datum>" vs.
--   "verwaltet von <owner>" (hv-s4).
--
-- WHAT THIS CHANGES
--   1. `hangar_ship_configs` gains four nullable/defaulted columns:
--        source_config_id  — the OWNER's config this row follows/forked from
--                             (self-referencing FK; null = never shared).
--        follows_owner     — true while still a live following copy.
--        owner_user_id     — the sharer's user id (for the "managed by"
--                             hint; the FRONTEND resolves it to a display
--                             name via the existing profile lookup — this
--                             migration stores only the raw id).
--        forked_at         — when the recipient's first edit broke the
--                             follow link (audit only; forking itself is a
--                             plain client-side UPDATE of follows_owner via
--                             the pre-existing self-only RLS policy, no new
--                             DB surface needed for that half).
--   2. New table `hangar_share_links` — a share TOKEN that carries the ship
--      class, the patch/build the owner shared at, and a JSONB SNAPSHOT of
--      the loadout at share time (the recipient's starting copy; the LIVE
--      follow afterwards reads through `source_config_id`, never re-reads
--      this snapshot). RLS: owner CRUD only — no anon/authenticated SELECT
--      policy, because recipients must never read another user's row
--      directly. A recipient with a token adopts through the
--      `adopt_shared_loadout(token)` SECURITY DEFINER RPC below instead.
--   3. Two SECURITY DEFINER RPCs:
--        adopt_shared_loadout(token) — the ONLY way a token turns into a
--          config: creates the recipient's hangar_ships row if missing (a
--          shared ship always lands in the recipient's hangar, matching the
--          concept's "im hangar ... abzuspeichern"), then inserts a
--          following hangar_ship_configs row.
--        hangar_follow_snapshot(config_id) — lets a follower pull the
--          owner's CURRENT loadout (bypassing the self-only RLS that would
--          otherwise hide the owner's row) WITHOUT granting the follower any
--          general read access to other users' configs; returns null once
--          the copy has forked or the owner's config is gone, so the caller
--          keeps its own last-known values rather than erroring.
--
-- ADDITIVE: this migration drops nothing.
-- ============================================================

alter table public.hangar_ship_configs
  add column if not exists source_config_id uuid references public.hangar_ship_configs(id) on delete set null,
  add column if not exists follows_owner boolean not null default false,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists forked_at timestamptz;

comment on column public.hangar_ship_configs.source_config_id is
  'The OWNER config this row was shared from (self-FK). Null = never shared / not a follower.';
comment on column public.hangar_ship_configs.follows_owner is
  'True while this row is a live following copy of source_config_id. Flips to false (irreversibly) on the recipient''s first own edit.';
comment on column public.hangar_ship_configs.owner_user_id is
  'auth.users.id of the sharer, kept even after forking, for the "managed by <owner>" / historical hint. Frontend resolves the display name.';
comment on column public.hangar_ship_configs.forked_at is
  'When follows_owner flipped to false (recipient''s first edit). Null while still following or never shared.';

-- Token generator: 244 bits from two v4 uuids, same technique as
-- `public.new_share_token()` (20260904020000) — deliberately not
-- gen_random_bytes()/pgcrypto (lives in `extensions`, every function here
-- pins `search_path = public`). A SEPARATE function (not that one): the
-- column DEFAULT below is evaluated under the inserting client's own
-- `authenticated` role, and `new_share_token()` revokes EXECUTE from
-- `authenticated` for its own (differently-gated) use case.
create or replace function public.new_hangar_share_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

grant execute on function public.new_hangar_share_token() to authenticated;

-- ============================================================
-- hangar_share_links — a share token; owner-only table, no anon/authenticated
-- SELECT policy (see RLS below). Recipients never query this table directly.
-- ============================================================
create table public.hangar_share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default public.new_hangar_share_token(),
  created_by uuid not null references auth.users(id) on delete cascade,
  ship_class_name text not null,
  channel text not null,
  patch_version text not null,
  -- Snapshot at share time — the recipient's STARTING loadout. Shape matches
  -- hangar_ship_configs.loadout: [{portName, className, kind}].
  loadout jsonb not null default '[]'::jsonb,
  config_name text not null default '',
  role text,
  -- The owner's config this link follows — adopt_shared_loadout copies this
  -- into the new row's source_config_id so the "live follow" reads the
  -- OWNER'S CURRENT loadout, not this frozen snapshot, from the first fetch.
  source_config_id uuid references public.hangar_ship_configs(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index hangar_share_links_created_by_idx on public.hangar_share_links (created_by, created_at desc);

comment on table public.hangar_share_links is
  'A share token carrying ship + loadout snapshot + patch. Recipients adopt via adopt_shared_loadout(token), never a direct table read.';

alter table public.hangar_share_links enable row level security;

create policy hangar_share_links_self_select on public.hangar_share_links
  for select to authenticated using (auth.uid() = created_by);
create policy hangar_share_links_self_insert on public.hangar_share_links
  for insert to authenticated with check (auth.uid() = created_by);
create policy hangar_share_links_self_delete on public.hangar_share_links
  for delete to authenticated using (auth.uid() = created_by);
-- No update policy: a link is create-once/revoke(delete)-only, never edited.
revoke all on public.hangar_share_links from anon;

-- Hardening mirror of hangar_ship_configs_ship_owned_insert: a link's
-- source_config_id, if set, must belong to the SAME user creating the link.
create policy hangar_share_links_source_owned_insert on public.hangar_share_links
  as restrictive for insert to authenticated
  with check (
    source_config_id is null or exists (
      select 1 from public.hangar_ship_configs c
      where c.id = source_config_id and c.user_id = auth.uid()
    )
  );

-- ============================================================
-- adopt_shared_loadout — the only path from a token to a followed config.
-- ============================================================
create or replace function public.adopt_shared_loadout(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $func$
declare
  v_link public.hangar_share_links%rowtype;
  v_uid uuid := auth.uid();
  v_hangar_ship_id uuid;
  v_config_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select * into v_link from public.hangar_share_links where token = p_token;
  if v_link.id is null then
    raise exception 'share link not found';
  end if;
  if v_link.expires_at is not null and v_link.expires_at < now() then
    raise exception 'share link expired';
  end if;

  select id into v_hangar_ship_id from public.hangar_ships
    where user_id = v_uid and ship_class_name = v_link.ship_class_name;
  if v_hangar_ship_id is null then
    insert into public.hangar_ships (user_id, ship_class_name, status)
      values (v_uid, v_link.ship_class_name, 'owned')
      returning id into v_hangar_ship_id;
  end if;

  insert into public.hangar_ship_configs (
    user_id, hangar_ship_id, name, role, loadout,
    source_config_id, follows_owner, owner_user_id
  ) values (
    v_uid, v_hangar_ship_id,
    v_link.config_name,
    coalesce(v_link.role, 'multipurpose'),
    v_link.loadout,
    v_link.source_config_id, true, v_link.created_by
  ) returning id into v_config_id;

  return v_config_id;
end
$func$;

revoke all on function public.adopt_shared_loadout(text) from public, anon;
grant execute on function public.adopt_shared_loadout(text) to authenticated;

-- ============================================================
-- hangar_follow_snapshot — a follower pulls the owner's CURRENT loadout
-- without gaining general read access to the owner's row.
-- ============================================================
create or replace function public.hangar_follow_snapshot(p_config_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_uid uuid := auth.uid();
  v_follower public.hangar_ship_configs%rowtype;
  v_owner public.hangar_ship_configs%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select * into v_follower from public.hangar_ship_configs
    where id = p_config_id and user_id = v_uid;
  if v_follower.id is null then
    raise exception 'config not found';
  end if;
  if not v_follower.follows_owner or v_follower.source_config_id is null then
    return null; -- forked already, or never a follower — caller keeps its own loadout
  end if;

  select * into v_owner from public.hangar_ship_configs where id = v_follower.source_config_id;
  if v_owner.id is null then
    return null; -- owner deleted their config — caller stays on the last-known copy
  end if;

  return jsonb_build_object(
    'loadout', v_owner.loadout,
    'name', v_owner.name,
    'role', v_owner.role,
    'ownerUpdatedAt', v_owner.updated_at
  );
end
$func$;

revoke all on function public.hangar_follow_snapshot(uuid) from public, anon;
grant execute on function public.hangar_follow_snapshot(uuid) to authenticated;
