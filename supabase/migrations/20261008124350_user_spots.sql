-- Verse Navigation: per-user spots synced between the SCC desktop app and
-- SCC-Web (desktop modules/desktop/src/spots-sync-service.js; local shape =
-- modules/shared/verse-nav/spots-store.js normalizeSpot()).
--
-- Sync model
--   * updated_at  = CLIENT edit time (last-write-wins key). Clients send it;
--                   the trigger only clamps it to now() when it lies more than
--                   5 minutes in the future (a skewed clock must not win forever).
--   * synced_at   = SERVER time of the last accepted write (pull watermark).
--                   Always set by the trigger, never by the client.
--   * deleted_at  = tombstone; deletions are soft so they reach other devices.
--   * Server-side LWW: an upsert whose updated_at is older than the stored
--     row (or equal, while the stored row is a tombstone and the incoming row
--     is not) is silently skipped, mirroring the client merge rule.
--   * Abuse cap: max 2000 live spots and 10000 rows (incl. tombstones) per user.

create table if not exists public.user_spots (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id           text        not null,
  name         text        not null,
  system_code  text,
  parent_body  text,
  frame        text        not null default 'system',
  pos_x        double precision not null,
  pos_y        double precision not null,
  pos_z        double precision not null,
  category     text        not null default 'general',
  tags         text[]      not null default '{}',
  note         text        not null default '',
  source       text        not null default 'manual',
  catalog_id   text,
  captured_at  timestamptz,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  primary key (user_id, id),

  constraint user_spots_id_len          check (char_length(id) between 1 and 200),
  constraint user_spots_name_len        check (char_length(btrim(name)) between 1 and 120),
  constraint user_spots_system_code_len check (system_code is null or char_length(system_code) <= 32),
  constraint user_spots_parent_body_len check (parent_body is null or char_length(parent_body) <= 160),
  constraint user_spots_frame           check (frame in ('body', 'system')),
  constraint user_spots_body_parent     check (frame <> 'body' or parent_body is not null),
  constraint user_spots_pos_finite      check (
    pos_x not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and abs(pos_x) < 1e15 and
    pos_y not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and abs(pos_y) < 1e15 and
    pos_z not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) and abs(pos_z) < 1e15),
  constraint user_spots_category        check (category in ('general', 'wreck', 'cave', 'loot', 'mining', 'trade',
                                                            'outpost', 'landing', 'combat', 'salvage', 'other')),
  constraint user_spots_source          check (source in ('manual', 'showlocation', 'catalog', 'overlay', 'voice', 'import')),
  constraint user_spots_tags            check (cardinality(tags) <= 20 and char_length(array_to_string(tags, '')) <= 800),
  constraint user_spots_note_len        check (char_length(note) <= 2000),
  constraint user_spots_catalog_id_len  check (catalog_id is null or char_length(catalog_id) <= 200)
);

-- Pull query: where user_id = auth.uid() and synced_at > <watermark> order by synced_at.
create index if not exists user_spots_user_synced_idx on public.user_spots (user_id, synced_at);

comment on table public.user_spots is
  'Verse Navigation spots (own saved places: wrecks, caves, landing spots) synced between the SCC desktop app and SCC-Web. '
  'Privacy: private per user - owner-only RLS on every operation, never shared or aggregated; rows are deleted with the account (on delete cascade). '
  'Soft deletes via deleted_at (tombstones) so deletions reach every device; updated_at = client edit time (last-write-wins), synced_at = server watermark.';
comment on column public.user_spots.updated_at is 'Client edit time; last-write-wins key. Clamped to now() when more than 5 minutes in the future.';
comment on column public.user_spots.synced_at  is 'Server time of the last accepted write; pull watermark. Set by trigger only.';
comment on column public.user_spots.deleted_at is 'Tombstone: spot deleted on some device; clients hide it and drop it after 180 days.';

-- ── trigger: watermark, clock clamp, server-side last-write-wins ─────────
create or replace function public.user_spots_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at is null then
    new.updated_at := now();
  elsif new.updated_at > now() + interval '5 minutes' then
    new.updated_at := now();
  end if;

  if tg_op = 'UPDATE' then
    -- Ownership and identity are immutable.
    new.user_id := old.user_id;
    new.id := old.id;
    new.created_at := old.created_at;
    -- Stale write (older revision, or equal revision trying to undo a tombstone): skip.
    if new.updated_at < old.updated_at
       or (new.updated_at = old.updated_at and old.deleted_at is not null and new.deleted_at is null) then
      return null;
    end if;
  end if;

  new.synced_at := now();
  return new;
end;
$$;

drop trigger if exists user_spots_before_write on public.user_spots;
create trigger user_spots_before_write
  before insert or update on public.user_spots
  for each row execute function public.user_spots_before_write();

-- ── trigger: per-user row cap (abuse guard) ──────────────────────────────
create or replace function public.user_spots_enforce_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  live_count  integer;
  total_count integer;
begin
  -- Serialize concurrent writes of the same user so the counts are exact.
  perform pg_advisory_xact_lock(hashtextextended('user_spots:' || new.user_id::text, 0));

  if tg_op = 'INSERT' then
    select count(*) into total_count from public.user_spots where user_id = new.user_id;
    if total_count >= 10000 then
      raise exception 'user_spots: row limit reached (10000 incl. deleted)' using errcode = 'check_violation';
    end if;
  end if;

  if new.deleted_at is null and (tg_op = 'INSERT' or old.deleted_at is not null) then
    select count(*) into live_count from public.user_spots where user_id = new.user_id and deleted_at is null;
    if live_count >= 2000 then
      raise exception 'user_spots: spot limit reached (2000)' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- Runs after the LWW trigger (alphabetical order: before_write < enforce_cap),
-- so skipped stale writes never count.
drop trigger if exists user_spots_enforce_cap on public.user_spots;
create trigger user_spots_enforce_cap
  before insert or update on public.user_spots
  for each row execute function public.user_spots_enforce_cap();

revoke all on function public.user_spots_before_write() from public, anon, authenticated;
revoke all on function public.user_spots_enforce_cap() from public, anon, authenticated;

-- ── RLS: owner only ──────────────────────────────────────────────────────
alter table public.user_spots enable row level security;

revoke all on table public.user_spots from anon;
grant select, insert, update, delete on table public.user_spots to authenticated;

drop policy if exists user_spots_select_own on public.user_spots;
create policy user_spots_select_own on public.user_spots
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_spots_insert_own on public.user_spots;
create policy user_spots_insert_own on public.user_spots
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_spots_update_own on public.user_spots;
create policy user_spots_update_own on public.user_spots
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_spots_delete_own on public.user_spots;
create policy user_spots_delete_own on public.user_spots
  for delete to authenticated
  using ((select auth.uid()) = user_id);
