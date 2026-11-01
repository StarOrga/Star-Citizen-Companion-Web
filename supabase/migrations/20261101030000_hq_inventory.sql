-- HQ (beta) - Bestand / Lager: inventory snapshots per location (plan section 3.4, D38-D42).
--
-- "Log says where, OCR reads what": the desktop app learns WHERE from the game log and
-- reads WHAT from the screen (OCR, opt-in, armed only while an inventory screen is open).
-- One snapshot per location; a new snapshot replaces the old one (D39). The replaced
-- snapshot is NOT kept in a history table: the web stores it as JSON in the replacing
-- hq_live_events.applied row so the log's "Rueckgaengig" restores it.
--
-- Alpha-phase data policy: purely additive, nothing dropped.
--
-- Caps (500 MB DB budget): 300 locations, 400 items per location, 500 ship-storage rows per user.
-- No LWW/tombstones here: a snapshot is replaced wholesale (delete + insert items, or upsert
-- the snapshot with on_conflict=user_id,location), the newest write wins by construction.

create table if not exists public.hq_inventory_snapshots (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  location   text        not null,
  system     text,
  source     text        not null default 'manual',
  taken_at   timestamptz not null default now(),
  item_count integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, location),

  constraint hq_inv_snap_location_len check (char_length(btrim(location)) between 1 and 200),
  constraint hq_inv_snap_system_len   check (system is null or char_length(system) <= 80),
  constraint hq_inv_snap_source       check (source in ('log', 'search', 'community', 'ocr', 'manual')),
  constraint hq_inv_snap_count        check (item_count between 0 and 400)
);

comment on table public.hq_inventory_snapshots is
  'One inventory snapshot per (user, location); a new one replaces the old (D39). taken_at drives the "zuletzt geoeffnet vor ..." '
  'margin note (warning from 7 days). source order Log > Suche > Community > OCR (D43). Private per user.';

create table if not exists public.hq_inventory_items (
  user_id    uuid    not null default auth.uid(),
  location   text   not null,
  name       text   not null,
  class_name text,
  qty        numeric not null default 1,
  unit       text    not null default 'pcs',
  updated_at timestamptz not null default now(),
  primary key (user_id, location, name),
  foreign key (user_id, location) references public.hq_inventory_snapshots (user_id, location) on delete cascade,

  constraint hq_inv_item_name_len  check (char_length(btrim(name)) between 1 and 160),
  constraint hq_inv_item_class_len check (class_name is null or char_length(class_name) <= 200),
  constraint hq_inv_item_qty       check (qty > 0 and qty <= 1000000000),
  constraint hq_inv_item_unit      check (unit in ('pcs', 'scu'))
);

comment on table public.hq_inventory_items is
  'Items of a snapshot: raw materials in SCU (Gold, Kupfer, Hadanite ...) and pieces. Cascade-deleted with the snapshot. Private per user.';

create table if not exists public.hq_ship_storage (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  ship_ref   text        not null,
  location   text        not null,
  source     text        not null default 'ocr',
  taken_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, ship_ref),

  constraint hq_ship_storage_ref_len      check (char_length(btrim(ship_ref)) between 1 and 200),
  constraint hq_ship_storage_location_len check (char_length(btrim(location)) between 1 and 200),
  constraint hq_ship_storage_source       check (source in ('log', 'search', 'community', 'ocr', 'manual'))
);

comment on table public.hq_ship_storage is
  'Where each of the user''s ships is stored (read from the ASOP terminal via OCR). ship_ref = hangar ship id or class name. '
  'One row per ship (latest wins). Private per user.';

create index if not exists hq_inventory_items_user_class_idx on public.hq_inventory_items (user_id, class_name);

-- updated_at triggers
do $$
declare
  t text;
begin
  foreach t in array array['hq_inventory_snapshots', 'hq_inventory_items', 'hq_ship_storage']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Caps
-- ---------------------------------------------------------------------------
create or replace function public.hq_inventory_enforce_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || new.user_id::text, 0));
  -- `insert ... on conflict do update` fires this trigger for the attempted insert too:
  -- an upsert that replaces an EXISTING row must not trip the cap, so each branch skips
  -- rows that already exist.
  if tg_table_name = 'hq_inventory_snapshots' then
    if (select count(*) from public.hq_inventory_snapshots where user_id = new.user_id) >= 300
       and not exists (select 1 from public.hq_inventory_snapshots
                        where user_id = new.user_id and location = new.location) then
      raise exception 'hq_inventory_snapshots: at most 300 locations' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'hq_inventory_items' then
    if (select count(*) from public.hq_inventory_items
         where user_id = new.user_id and location = new.location) >= 400
       and not exists (select 1 from public.hq_inventory_items
                        where user_id = new.user_id and location = new.location and name = new.name) then
      raise exception 'hq_inventory_items: at most 400 items per location' using errcode = 'check_violation';
    end if;
  else
    if (select count(*) from public.hq_ship_storage where user_id = new.user_id) >= 500
       and not exists (select 1 from public.hq_ship_storage
                        where user_id = new.user_id and ship_ref = new.ship_ref) then
      raise exception 'hq_ship_storage: at most 500 ships' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.hq_inventory_enforce_cap() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['hq_inventory_snapshots', 'hq_inventory_items', 'hq_ship_storage']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_cap', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.hq_inventory_enforce_cap()',
      t || '_cap', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: owner only (all three tables)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['hq_inventory_snapshots', 'hq_inventory_items', 'hq_ship_storage']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t);
  end loop;
end $$;
