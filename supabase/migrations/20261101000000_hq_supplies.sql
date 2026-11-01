-- HQ (beta) - Nachschub / supply list on the server (plan section 3.1, D31).
--
-- Replaces the localStorage list `sc.hq.supplies`: HqSuppliesService uploads it
-- once after sign-in, then removes the key. Offline adds stay idempotent
-- because the client generates the row id.
--
-- Alpha-phase data policy: nothing to drop here - /hq supplies never had a table,
-- and no legacy table is touched. Purely additive.
--
-- Sync model = user_spots (20261008124350_user_spots.sql), shared by every HQ
-- table that syncs between devices:
--   * updated_at = CLIENT edit time (last-write-wins key), clamped to now() when
--                  more than 5 minutes in the future.
--   * synced_at  = SERVER time of the last accepted write (pull watermark).
--   * deleted_at = tombstone (soft delete so deletions reach other devices).
--     NOTE: the plan sketch says `deleted boolean`; user_spots uses a tombstone
--     timestamp and the 180-day purge convention, so HQ follows that.
--   * A stale upsert (older updated_at, or equal while the stored row is a
--     tombstone) is silently skipped by the trigger.
--
-- The two trigger functions below are GENERIC: they only touch the columns
-- user_id, id, created_at, updated_at, deleted_at, synced_at, which every HQ
-- sync table has. Later HQ migrations reuse them.

-- ---------------------------------------------------------------------------
-- generic trigger: watermark, clock clamp, server-side LWW
-- ---------------------------------------------------------------------------
create or replace function public.hq_sync_before_write()
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
    if new.updated_at < old.updated_at
       or (new.updated_at = old.updated_at and old.deleted_at is not null and new.deleted_at is null) then
      return null;
    end if;
  end if;

  new.synced_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- generic trigger: per-user row caps (abuse guard)
--   TG_ARGV[0] = max live rows (deleted_at is null), TG_ARGV[1] = max rows incl. tombstones
-- ---------------------------------------------------------------------------
create or replace function public.hq_enforce_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  live_cap  integer := tg_argv[0]::integer;
  total_cap integer := tg_argv[1]::integer;
  live_count  integer;
  total_count integer;
begin
  -- Serialize concurrent writes of the same user so the counts are exact.
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || new.user_id::text, 0));

  if tg_op = 'INSERT' then
    execute format('select count(*) from %I.%I where user_id = $1', tg_table_schema, tg_table_name)
      into total_count using new.user_id;
    if total_count >= total_cap then
      raise exception '%: row limit reached (% incl. deleted)', tg_table_name, total_cap
        using errcode = 'check_violation';
    end if;
  end if;

  if new.deleted_at is null and (tg_op = 'INSERT' or old.deleted_at is not null) then
    execute format('select count(*) from %I.%I where user_id = $1 and deleted_at is null', tg_table_schema, tg_table_name)
      into live_count using new.user_id;
    if live_count >= live_cap then
      raise exception '%: row limit reached (% live)', tg_table_name, live_cap
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.hq_sync_before_write() from public, anon, authenticated;
revoke all on function public.hq_enforce_cap() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- hq_supplies
-- ---------------------------------------------------------------------------
create table if not exists public.hq_supplies (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        not null,
  name        text        not null,
  qty         integer     not null default 1,
  done        boolean     not null default false,
  entity_kind text,
  class_name  text,
  set_kind    text,
  set_id      uuid,
  step_kind   text,
  wanted      boolean     not null default true,
  source      text        not null default 'manual',
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now(),
  primary key (user_id, id),

  constraint hq_supplies_id_len     check (char_length(id) between 1 and 200),
  constraint hq_supplies_name_len   check (char_length(btrim(name)) between 1 and 80),
  constraint hq_supplies_qty        check (qty between 1 and 999),
  constraint hq_supplies_kind_len   check (entity_kind is null or char_length(entity_kind) <= 40),
  constraint hq_supplies_class_len  check (class_name is null or char_length(class_name) <= 200),
  constraint hq_supplies_set_kind   check (set_kind is null or set_kind in ('ship', 'fps')),
  constraint hq_supplies_step_kind  check (step_kind is null or step_kind in
    ('buy', 'mission', 'mine', 'refine', 'craft', 'transport', 'pickup')),
  constraint hq_supplies_source     check (source in ('manual', 'set', 'search', 'live')),
  -- set_id and set_kind belong together (set_id soft-FKs hangar_ship_configs.id or
  -- hangar_role_loadouts.id depending on set_kind; no real FK because of the two targets).
  constraint hq_supplies_set_pair   check ((set_id is null) = (set_kind is null))
);

comment on table public.hq_supplies is
  'HQ Nachschub (supply list), synced between devices. Private per user (owner-only RLS). '
  'Soft deletes via deleted_at; updated_at = client edit time (LWW), synced_at = server watermark. '
  'wanted = the user marked the part as wanted for its set; drives the tri-state ring fraction (D28).';
comment on column public.hq_supplies.set_id is
  'hangar_ship_configs.id (set_kind=ship) or hangar_role_loadouts.id (set_kind=fps). Soft reference, no FK.';
comment on column public.hq_supplies.done is 'Shown as "liegt bereit" in the UI.';

create index if not exists hq_supplies_user_set_idx    on public.hq_supplies (user_id, set_id);
create index if not exists hq_supplies_user_synced_idx on public.hq_supplies (user_id, synced_at);

-- Trigger order is alphabetical: hq_supplies_a_sync (LWW) runs before hq_supplies_b_cap,
-- so skipped stale writes never count towards the cap.
drop trigger if exists hq_supplies_a_sync on public.hq_supplies;
create trigger hq_supplies_a_sync
  before insert or update on public.hq_supplies
  for each row execute function public.hq_sync_before_write();

-- Cap: 300 live rows, 1000 incl. tombstones per user.
drop trigger if exists hq_supplies_b_cap on public.hq_supplies;
create trigger hq_supplies_b_cap
  before insert or update on public.hq_supplies
  for each row execute function public.hq_enforce_cap(300, 1000);

-- ---------------------------------------------------------------------------
-- RLS: owner only
-- ---------------------------------------------------------------------------
alter table public.hq_supplies enable row level security;

revoke all on table public.hq_supplies from anon;
grant select, insert, update, delete on table public.hq_supplies to authenticated;

drop policy if exists hq_supplies_select_own on public.hq_supplies;
create policy hq_supplies_select_own on public.hq_supplies
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists hq_supplies_insert_own on public.hq_supplies;
create policy hq_supplies_insert_own on public.hq_supplies
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists hq_supplies_update_own on public.hq_supplies;
create policy hq_supplies_update_own on public.hq_supplies
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists hq_supplies_delete_own on public.hq_supplies;
create policy hq_supplies_delete_own on public.hq_supplies
  for delete to authenticated using ((select auth.uid()) = user_id);
