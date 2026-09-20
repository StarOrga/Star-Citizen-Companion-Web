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
--   1. `hangar_ship_configs` gains six nullable/defaulted columns:
--        source_config_id     — the OWNER's config this row follows/forked
--                                from (self-referencing FK; null = never
--                                shared).
--        follows_owner        — true while still a live following copy.
--        owner_user_id        — the sharer's user id (for the "managed by"
--                                hint; the FRONTEND resolves it to a display
--                                name — the RPCs below also hand back a
--                                resolved `owner_name` for the same purpose).
--        forked_at             — when the recipient's first edit broke the
--                                follow link (audit only).
--        shared_channel        — the patch channel the link was shared at
--                                (copied from `hangar_share_links` at adopt
--                                time; fixed share context, not live-synced).
--        shared_patch_version  — same, the patch version string.
--
--      *** wave 1.5 red-team fix (blocker 3): all six are now WRITE-GATED ***
--      by the `hangar_ship_configs_share_guard` trigger below — they used to
--      be plain client-writable columns under the generic self-only RLS,
--      which let any user point their own row at any config id and read its
--      name/role/loadout, and reverse a fork by flipping `follows_owner`
--      back to true. See the trigger's own comment for the mechanism.
--
--   2. New table `hangar_share_links` — a share TOKEN that carries the ship
--      class, the patch/build the owner shared at, and a JSONB SNAPSHOT of
--      the loadout at share time (the recipient's starting copy; the LIVE
--      follow afterwards reads through `source_config_id`, never re-reads
--      this snapshot). RLS: owner CRUD only — no anon/authenticated SELECT
--      policy, because recipients must never read another user's row
--      directly. A recipient with a token adopts through the
--      `adopt_shared_loadout(token)` SECURITY DEFINER RPC below instead.
--      Also carries `revoked_at` (wave 1.5, user decision 1): revoke stops
--      new adoptions only — existing followers keep following until the
--      owner deletes the source config — so this is a plain "no longer
--      usable" stamp, never a DELETE, matching the `loadout_shares` /
--      `revoke_loadout_share()` convention in 20260904020000.
--
--   3. Four SECURITY DEFINER RPCs:
--        adopt_shared_loadout(token) — the ONLY way a token turns into a
--          config: creates the recipient's hangar_ships row if missing (a
--          shared ship always lands in the recipient's hangar, matching the
--          concept's "im hangar ... abzuspeichern"), then inserts (or, on a
--          re-adopt, returns) a following hangar_ship_configs row. Returns a
--          jsonb envelope carrying the resolved owner name/id/updated-at and
--          the share's channel/patch context (wave 1.5 blocker 4 — the
--          `profiles` table is self-read only, so the client has no other
--          way to resolve "verwaltet von <user>").
--        hangar_follow_snapshot(config_id) — lets a follower pull the
--          owner's CURRENT loadout (bypassing the self-only RLS that would
--          otherwise hide the owner's row), performs the follower's own
--          UPDATE itself (through the trusted internal-write path so the
--          share guard trigger does not mistake a sync-from-owner for the
--          recipient's own edit and auto-fork it — see the trigger comment),
--          and returns null once the copy has forked or the owner's config
--          is gone, so the caller keeps its own last-known values rather
--          than erroring. Per user decision 1 this does NOT check the share
--          link at all — the immutable `source_config_id`/`owner_user_id`
--          columns (guarded by the trigger) are now the only provenance that
--          matters, and revoking a link must not affect an existing follow.
--        peek_shared_loadout(token) — wave 1.5 user decision 3: an
--          anonymous recipient may VIEW a shared loadout without signing in
--          (adopting still requires auth, via adopt_shared_loadout above).
--          Callable by anon AND authenticated, read-only, same
--          revoked/expired/moderation-aware guards as `get_shared_loadout`
--          (20260904020000) — the established anon-read pattern for a share
--          token in this schema.
--
-- ADDITIVE: this migration drops nothing.
-- ============================================================

alter table public.hangar_ship_configs
  add column if not exists source_config_id uuid references public.hangar_ship_configs(id) on delete set null,
  add column if not exists follows_owner boolean not null default false,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists forked_at timestamptz,
  add column if not exists shared_channel text,
  add column if not exists shared_patch_version text;

comment on column public.hangar_ship_configs.source_config_id is
  'The OWNER config this row was shared from (self-FK). Null = never shared / not a follower. Immutable after insert — see hangar_ship_configs_share_guard.';
comment on column public.hangar_ship_configs.follows_owner is
  'True while this row is a live following copy of source_config_id. May only flip true->false (irreversibly), never false->true, outside the trusted RPC path — see hangar_ship_configs_share_guard.';
comment on column public.hangar_ship_configs.owner_user_id is
  'auth.users.id of the sharer, kept even after forking, for the "managed by <owner>" / historical hint. Immutable after insert. adopt_shared_loadout/hangar_follow_snapshot also resolve+return a display name, since profiles is self-read only.';
comment on column public.hangar_ship_configs.forked_at is
  'When follows_owner flipped to false (recipient''s first edit, or an auto-fork by the share guard trigger). Null while still following or never shared.';
comment on column public.hangar_ship_configs.shared_channel is
  'The patch channel this row was shared/adopted at (copied from hangar_share_links.channel). Immutable after insert. Null for a never-shared config.';
comment on column public.hangar_ship_configs.shared_patch_version is
  'The patch version this row was shared/adopted at (copied from hangar_share_links.patch_version). Immutable after insert. Null for a never-shared config.';

-- At most one following copy per (recipient, owner config) — re-adopting the
-- same share (or a fresh link to the same source) returns the existing
-- follow instead of creating a duplicate (wave 1.5 should-fix E).
create unique index if not exists hangar_ship_configs_user_source_unique
  on public.hangar_ship_configs (user_id, source_config_id)
  where source_config_id is not null;

-- ============================================================
-- hangar_ship_configs_share_guard — wave 1.5 fix for blocker 3.
--
-- MECHANISM: a transaction-local GUC (`hangar.internal_write`), set by the
-- two trusted SECURITY DEFINER paths (adopt_shared_loadout's insert,
-- hangar_follow_snapshot's own follower-row update) immediately around the
-- one statement each is trusted for, and reset straight after. A plain
-- client INSERT/UPDATE via PostgREST never sets it, so `current_setting`
-- reads back empty/'off' for every ordinary write. This was chosen over a
-- "move everything into the RPC" redesign because the fork-on-edit half of
-- the rule (s3-fork) must fire for ANY client write to name/role/loadout —
-- `updateConfig()`, `activateConfig()`, the Codex save bar — not just a
-- single dedicated write path, so the guard has to live in a trigger that
-- sees every UPDATE regardless of which service method issued it.
--
-- RULES:
--   INSERT — owner_user_id / source_config_id / follows_owner=true /
--     shared_channel / shared_patch_version may only be set by the trusted
--     path (adopt_shared_loadout). A plain client insert carrying any of
--     them is rejected outright (42501), not silently nulled — a client
--     that thinks it is creating a followed config would otherwise get a
--     row that silently isn't one.
--   UPDATE, untrusted path —
--     * source_config_id / owner_user_id / shared_channel /
--       shared_patch_version are immutable (any change rejected, 42501).
--     * follows_owner may go true->false but never false->true (42501 on
--       the forbidden direction).
--     * auto-fork: editing name/role/loadout on a still-following row
--       (follows_owner true before AND after this statement) forces
--       follows_owner := false and stamps forked_at := now() IN THE SAME
--       statement — the recipient's first real edit breaks the follow,
--       irreversibly, per the model comment above.
--   UPDATE, trusted path (hangar_follow_snapshot's own sync) — none of the
--     above apply, since this is precisely the "pull the owner's current
--     loadout into a still-following row" write that must NOT look like an
--     edit. The RPC still only ever touches loadout/name/role and only
--     while follows_owner is (and remains) true.
-- ============================================================
create or replace function public.hangar_ship_configs_share_guard()
returns trigger language plpgsql set search_path = public as $func$
declare
  v_internal boolean := coalesce(nullif(current_setting('hangar.internal_write', true), ''), 'off') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_internal then
      if new.owner_user_id is not null
         or new.source_config_id is not null
         or new.follows_owner is true
         or new.shared_channel is not null
         or new.shared_patch_version is not null
      then
        raise exception 'sharing columns are managed by adopt_shared_loadout only' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE'
  if not v_internal then
    if new.source_config_id is distinct from old.source_config_id then
      raise exception 'source_config_id is immutable' using errcode = '42501';
    end if;
    if new.owner_user_id is distinct from old.owner_user_id then
      raise exception 'owner_user_id is immutable' using errcode = '42501';
    end if;
    if new.shared_channel is distinct from old.shared_channel then
      raise exception 'shared_channel is immutable' using errcode = '42501';
    end if;
    if new.shared_patch_version is distinct from old.shared_patch_version then
      raise exception 'shared_patch_version is immutable' using errcode = '42501';
    end if;
    if new.follows_owner and not old.follows_owner then
      raise exception 'follows_owner may not be re-enabled' using errcode = '42501';
    end if;

    if old.follows_owner and new.follows_owner
       and (new.name is distinct from old.name
            or new.role is distinct from old.role
            or new.loadout is distinct from old.loadout)
    then
      new.follows_owner := false;
      new.forked_at := now();
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists hangar_ship_configs_share_guard on public.hangar_ship_configs;
create trigger hangar_ship_configs_share_guard
  before insert or update on public.hangar_ship_configs
  for each row execute function public.hangar_ship_configs_share_guard();

comment on function public.hangar_ship_configs_share_guard() is
  'Wave 1.5 fix (redteam blocker 3): gates the sharing columns and auto-forks a followed config on the recipient''s own edit. See migration header for the hangar.internal_write GUC mechanism.';

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
  -- wave 1.5 (user decision 1): revoke = stop new adoptions only, never a
  -- DELETE — existing followers keep following via source_config_id until
  -- the owner deletes their config. Only settable via
  -- hangar_share_links_revoke_guard below (once, null->timestamp).
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index hangar_share_links_created_by_idx on public.hangar_share_links (created_by, created_at desc);

comment on table public.hangar_share_links is
  'A share token carrying ship + loadout snapshot + patch. Recipients adopt via adopt_shared_loadout(token) or preview via peek_shared_loadout(token), never a direct table read.';

alter table public.hangar_share_links enable row level security;

create policy hangar_share_links_self_select on public.hangar_share_links
  for select to authenticated using (auth.uid() = created_by);
create policy hangar_share_links_self_insert on public.hangar_share_links
  for insert to authenticated with check (auth.uid() = created_by);
create policy hangar_share_links_self_update on public.hangar_share_links
  for update to authenticated using (auth.uid() = created_by) with check (auth.uid() = created_by);
create policy hangar_share_links_self_delete on public.hangar_share_links
  for delete to authenticated using (auth.uid() = created_by);
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

-- wave 1.5 should-fix (moderation invariant): same RESTRICTIVE approved+not-
-- suspended gate every other self-scoped table carries (20260805120000 /
-- 20260904020000 widened is_approved() to also mean "not suspended"). A
-- suspended user must not be able to mint a new share link.
create policy hangar_share_links_approved_gate on public.hangar_share_links
  as restrictive for all to authenticated
  using (public.is_approved()) with check (public.is_approved());

-- wave 1.5 (user decision 1): revoke is UPDATE-only (revoked_at, null->now,
-- once) — everything else about a link is immutable after creation, exactly
-- like `revoke_loadout_share()`'s "revoke, never delete" comment.
create or replace function public.hangar_share_links_revoke_guard()
returns trigger language plpgsql set search_path = public as $func$
begin
  if new.token is distinct from old.token
     or new.created_by is distinct from old.created_by
     or new.ship_class_name is distinct from old.ship_class_name
     or new.channel is distinct from old.channel
     or new.patch_version is distinct from old.patch_version
     or new.loadout is distinct from old.loadout
     or new.config_name is distinct from old.config_name
     or new.role is distinct from old.role
     or new.source_config_id is distinct from old.source_config_id
     or new.expires_at is distinct from old.expires_at
  then
    raise exception 'only revoked_at may be updated on a share link' using errcode = '42501';
  end if;
  if old.revoked_at is not null then
    raise exception 'share link already revoked' using errcode = '42501';
  end if;
  if new.revoked_at is null then
    raise exception 'revoked_at may only be set, never cleared' using errcode = '42501';
  end if;
  return new;
end;
$func$;

drop trigger if exists hangar_share_links_revoke_guard on public.hangar_share_links;
create trigger hangar_share_links_revoke_guard
  before update on public.hangar_share_links
  for each row execute function public.hangar_share_links_revoke_guard();

-- ============================================================
-- adopt_shared_loadout — the only path from a token to a followed config.
-- wave 1.5: social_actor()/is_suspended() moderation, revoked/expired
-- refusal, self-adopt refusal, re-adopt returns the existing follow (unique
-- index above), and returns owner name/id/updated-at + channel/patch
-- context (blocker 4) instead of a bare uuid.
-- ============================================================
drop function if exists public.adopt_shared_loadout(text);
create or replace function public.adopt_shared_loadout(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_link public.hangar_share_links%rowtype;
  v_uid uuid := public.social_actor();
  v_hangar_ship_id uuid;
  v_config_id uuid;
  v_owner_name text;
  v_owner_handle citext;
  v_owner_updated_at timestamptz;
begin
  select * into v_link from public.hangar_share_links where token = p_token;
  if v_link.id is null then
    raise exception 'share link not found' using errcode = 'P0002';
  end if;
  if v_link.revoked_at is not null then
    raise exception 'share link revoked' using errcode = 'P0002';
  end if;
  if v_link.expires_at is not null and v_link.expires_at < now() then
    raise exception 'share link expired' using errcode = 'P0002';
  end if;
  if v_link.created_by = v_uid then
    raise exception 'cannot adopt your own share link' using errcode = '22023';
  end if;
  if public.is_suspended(v_link.created_by) then
    raise exception 'owner unavailable' using errcode = '42501';
  end if;

  -- Re-adopt of an already-followed source config: return the existing
  -- follow instead of duplicating it (should-fix E).
  if v_link.source_config_id is not null then
    select id into v_config_id from public.hangar_ship_configs
      where user_id = v_uid and source_config_id = v_link.source_config_id;
  end if;

  if v_config_id is null then
    select id into v_hangar_ship_id from public.hangar_ships
      where user_id = v_uid and ship_class_name = v_link.ship_class_name;
    if v_hangar_ship_id is null then
      insert into public.hangar_ships (user_id, ship_class_name, status)
        values (v_uid, v_link.ship_class_name, 'owned')
        returning id into v_hangar_ship_id;
    end if;

    perform set_config('hangar.internal_write', 'on', true);
    insert into public.hangar_ship_configs (
      user_id, hangar_ship_id, name, role, loadout,
      source_config_id, follows_owner, owner_user_id,
      shared_channel, shared_patch_version
    ) values (
      v_uid, v_hangar_ship_id,
      v_link.config_name,
      coalesce(v_link.role, 'multipurpose'),
      v_link.loadout,
      v_link.source_config_id, true, v_link.created_by,
      v_link.channel, v_link.patch_version
    )
    on conflict (user_id, source_config_id) where source_config_id is not null do nothing
    returning id into v_config_id;
    perform set_config('hangar.internal_write', 'off', true);

    if v_config_id is null and v_link.source_config_id is not null then
      -- Lost the race to a concurrent adopt of the same link/source.
      select id into v_config_id from public.hangar_ship_configs
        where user_id = v_uid and source_config_id = v_link.source_config_id;
    end if;
  end if;

  select p.display_name, p.username into v_owner_name, v_owner_handle
    from public.profiles p where p.id = v_link.created_by;
  if v_link.source_config_id is not null then
    select o.updated_at into v_owner_updated_at
      from public.hangar_ship_configs o where o.id = v_link.source_config_id;
  end if;

  return jsonb_build_object(
    'configId', v_config_id,
    'ownerName', coalesce(v_owner_name, v_owner_handle::text),
    'ownerUserId', v_link.created_by,
    'ownerUpdatedAt', v_owner_updated_at,
    'channel', v_link.channel,
    'patchVersion', v_link.patch_version
  );
end
$func$;

revoke all on function public.adopt_shared_loadout(text) from public, anon;
grant execute on function public.adopt_shared_loadout(text) to authenticated;

-- ============================================================
-- hangar_follow_snapshot — a follower pulls the owner's CURRENT loadout
-- without gaining general read access to the owner's row. wave 1.5: uses
-- social_actor(), performs the follower's own sync-write itself (through the
-- trusted GUC path so the share guard trigger does not auto-fork it), skips
-- suspended owners (soft — same "caller keeps its last-known copy" treatment
-- as an owner-deleted config, per user decision 1 this does NOT re-check the
-- share link), and returns owner name/id/updated-at + the row's fixed
-- channel/patch context (blocker 4).
-- ============================================================
create or replace function public.hangar_follow_snapshot(p_config_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $func$
declare
  v_uid uuid := public.social_actor();
  v_follower public.hangar_ship_configs%rowtype;
  v_owner public.hangar_ship_configs%rowtype;
  v_owner_name text;
  v_owner_handle citext;
begin
  select * into v_follower from public.hangar_ship_configs
    where id = p_config_id and user_id = v_uid;
  if v_follower.id is null then
    raise exception 'config not found' using errcode = 'P0002';
  end if;
  if not v_follower.follows_owner or v_follower.source_config_id is null then
    return null; -- forked already, or never a follower — caller keeps its own loadout
  end if;

  select * into v_owner from public.hangar_ship_configs where id = v_follower.source_config_id;
  if v_owner.id is null then
    return null; -- owner deleted their config — caller stays on the last-known copy
  end if;
  if v_follower.owner_user_id is not null and public.is_suspended(v_follower.owner_user_id) then
    return null; -- owner suspended — caller stays on the last-known copy, same soft treatment
  end if;

  perform set_config('hangar.internal_write', 'on', true);
  update public.hangar_ship_configs
    set loadout = v_owner.loadout, name = v_owner.name, role = v_owner.role
    where id = v_follower.id and follows_owner = true;
  perform set_config('hangar.internal_write', 'off', true);

  select p.display_name, p.username into v_owner_name, v_owner_handle
    from public.profiles p where p.id = v_follower.owner_user_id;

  return jsonb_build_object(
    'loadout', v_owner.loadout,
    'name', v_owner.name,
    'role', v_owner.role,
    'ownerName', coalesce(v_owner_name, v_owner_handle::text),
    'ownerUserId', v_follower.owner_user_id,
    'ownerUpdatedAt', v_owner.updated_at,
    'channel', v_follower.shared_channel,
    'patchVersion', v_follower.shared_patch_version
  );
end
$func$;

revoke all on function public.hangar_follow_snapshot(uuid) from public, anon;
grant execute on function public.hangar_follow_snapshot(uuid) to authenticated;

-- ============================================================
-- peek_shared_loadout — wave 1.5 user decision 3: anonymous recipients may
-- VIEW a shared loadout without signing in (adopting still requires auth).
-- Same shape/guards as `get_shared_loadout` (20260904020000): callable by
-- anon AND authenticated, read-only, refuses a revoked/expired link or a
-- suspended/unapproved owner.
-- ============================================================
create or replace function public.peek_shared_loadout(p_token text)
returns table (
  ship_class_name text,
  loadout         jsonb,
  name            text,
  role            text,
  channel         text,
  patch_version   text,
  owner_name      text
)
language sql security definer set search_path = public stable as $$
  select
    l.ship_class_name, l.loadout, l.config_name, l.role, l.channel, l.patch_version,
    coalesce(p.display_name, p.username::text)
  from public.hangar_share_links l
  join public.profiles p on p.id = l.created_by
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now())
    and not public.is_suspended(l.created_by)
    and p.is_approved
  limit 1
$$;

grant execute on function public.peek_shared_loadout(text) to anon, authenticated;

comment on function public.peek_shared_loadout(text) is
  'Wave 1.5 user decision 3: anon-callable, read-only preview of a shared loadout via its token. Revoked/expired/suspended-or-unapproved owner all return zero rows, same as get_shared_loadout.';
