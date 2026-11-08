-- Nachschub-HQ W1.2 + W1.3 - named Nachschub (package) slots, Einsatz membership, and the one-time migration
-- of today's open Nachschub lines into a single Nachschub "Bisheriger Nachschub" (r2 d2-migrate = one).
--
-- UI wording is "Nachschub" / "Nachschuebe"; the table keeps the neutral name hq_supply_packages.
--
--   hq_supply_packages   one row per Nachschub. status 'active' holds a slot 1..7 (partial unique index =
--                        at most 7 active per user, no trigger needed); 'archived' has no slot (a finished
--                        Nachschub frees its slot). name <= 28 chars. `snapshot` = inventory quantity per
--                        supply line at planning time ({ "<supply id>": <qty> }); a line closes only when the
--                        inventory rose above it (or by manual tick), never by time.
--   hq_supplies.package_id / hq_einsaetze.package_id   membership (soft reference, no FK: both sides are
--                        sync tables with tombstones; same convention as set_id).
--   Einsatz names inside a Nachschub <= 40 chars (check applies only when package_id is set, NOT VALID so
--   older longer titles stay untouched).
--
-- Sync model = hq_supplies (20261101000000): LWW on updated_at, synced_at watermark, deleted_at tombstone,
-- the generic trigger hq_sync_before_write(), cap 40 live / 120 incl. tombstones, owner-only RLS.
--
-- Alpha data policy: nothing is dropped here.

create table if not exists public.hq_supply_packages (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          uuid        not null default gen_random_uuid(),
  name        text        not null,
  status      text        not null default 'active',
  slot        integer,
  snapshot    jsonb       not null default '{}'::jsonb,
  archived_at timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now(),
  primary key (user_id, id),

  constraint hq_supply_packages_name_len check (char_length(btrim(name)) between 1 and 28),
  constraint hq_supply_packages_status   check (status in ('active', 'archived')),
  constraint hq_supply_packages_slot     check (slot is null or slot between 1 and 7),
  -- An active Nachschub holds a slot, an archived one does not.
  constraint hq_supply_packages_slot_pair check ((status = 'active') = (slot is not null)),
  constraint hq_supply_packages_snapshot check (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 65536)
);

comment on table public.hq_supply_packages is
  'HQ Nachschub (named bundle of supply lines and Einsaetze), up to 7 active slots, archive beyond. Owner-only RLS. '
  'snapshot = inventory qty per supply line at planning time (line closes only on a rise vs. it). Sync like hq_supplies.';

-- At most one ACTIVE Nachschub per slot (tombstones do not hold a slot) = at most 7 active per user.
create unique index if not exists hq_supply_packages_active_slot_idx
  on public.hq_supply_packages (user_id, slot) where status = 'active' and deleted_at is null;
create index if not exists hq_supply_packages_user_synced_idx on public.hq_supply_packages (user_id, synced_at, id);

drop trigger if exists hq_supply_packages_a_sync on public.hq_supply_packages;
create trigger hq_supply_packages_a_sync
  before insert or update on public.hq_supply_packages
  for each row execute function public.hq_sync_before_write();

drop trigger if exists hq_supply_packages_b_cap on public.hq_supply_packages;
create trigger hq_supply_packages_b_cap
  before insert or update on public.hq_supply_packages
  for each row execute function public.hq_enforce_cap(40, 120);

alter table public.hq_supply_packages enable row level security;
revoke all on table public.hq_supply_packages from anon;
grant select, insert, update, delete on table public.hq_supply_packages to authenticated;

drop policy if exists hq_supply_packages_select_own on public.hq_supply_packages;
create policy hq_supply_packages_select_own on public.hq_supply_packages
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists hq_supply_packages_insert_own on public.hq_supply_packages;
create policy hq_supply_packages_insert_own on public.hq_supply_packages
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists hq_supply_packages_update_own on public.hq_supply_packages;
create policy hq_supply_packages_update_own on public.hq_supply_packages
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists hq_supply_packages_delete_own on public.hq_supply_packages;
create policy hq_supply_packages_delete_own on public.hq_supply_packages
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Membership columns.
alter table public.hq_supplies  add column if not exists package_id uuid;
alter table public.hq_einsaetze add column if not exists package_id uuid;
create index if not exists hq_supplies_user_package_idx  on public.hq_supplies  (user_id, package_id);
create index if not exists hq_einsaetze_user_package_idx on public.hq_einsaetze (user_id, package_id);

comment on column public.hq_supplies.package_id  is 'hq_supply_packages.id of the same user (soft reference). Null = loose line.';
comment on column public.hq_einsaetze.package_id is 'hq_supply_packages.id of the same user (soft reference). An Einsatz of a Nachschub has a title <= 40 chars.';

alter table public.hq_einsaetze drop constraint if exists hq_einsaetze_package_title_len;
alter table public.hq_einsaetze add constraint hq_einsaetze_package_title_len
  check (package_id is null or char_length(btrim(title)) <= 40) not valid;

-- The purge job also takes tombstoned Nachschuebe (same 180 days). Recreated with the extra delete; the cron
-- schedule itself is untouched (never repeat create extension pg_cron, 2BP01).
create or replace function public.hq_purge_tombstones()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.hq_supplies         where deleted_at is not null and deleted_at < now() - interval '180 days';
  delete from public.hq_einsaetze        where deleted_at is not null and deleted_at < now() - interval '180 days';
  delete from public.hq_supply_packages  where deleted_at is not null and deleted_at < now() - interval '180 days';
$$;
revoke all on function public.hq_purge_tombstones() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- W1.3 data migration: every user with open Nachschub lines gets ONE active Nachschub (slot 1)
-- "Bisheriger Nachschub" holding those lines and their live, not archived Einsaetze.
-- The snapshot is left empty: lines that existed before the feature have no planning-time baseline, so
-- the client treats a missing key as "baseline = current inventory when first seen" (see nachschub.model.ts).
-- Idempotent: only users without any Nachschub yet, only lines without a package.
-- ---------------------------------------------------------------------------
with todo as (
  select distinct s.user_id
  from public.hq_supplies s
  where s.deleted_at is null and s.done = false and s.package_id is null
    and not exists (select 1 from public.hq_supply_packages p where p.user_id = s.user_id)
), made as (
  insert into public.hq_supply_packages (user_id, id, name, status, slot)
  select user_id, gen_random_uuid(), 'Bisheriger Nachschub', 'active', 1 from todo
  returning user_id, id
), lines as (
  update public.hq_supplies s
     set package_id = m.id, updated_at = now()
    from made m
   where s.user_id = m.user_id and s.deleted_at is null and s.done = false and s.package_id is null
  returning s.user_id
)
update public.hq_einsaetze e
   set package_id = m.id, updated_at = now()
  from made m
 where e.user_id = m.user_id and e.deleted_at is null and e.status in ('planned', 'active') and e.package_id is null;

notify pgrst, 'reload schema';
