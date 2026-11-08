-- HQ Bestand (concept 20261108-2135-hq-bestand, lines D1 / D2 / D3).
--
--   D1  hq_inventory_items.quality (smallint 1..1000, null = unknown). ONE STACK PER (place, item, quality):
--       the primary key becomes (user_id, location, name, quality_key) where quality_key is a stored generated
--       column = coalesce(quality, 0). The desktop app writes `quality`; its upsert must use
--       on_conflict=user_id,location,name,quality_key (docs/contracts/hq-inventory-quality.md).
--   D2  Reservations leave the jsonb column and become rows of hq_inventory_reservations: an amount earmarked on
--       one stack for a friend (friend_id), a free text (note), or both; optional expires_at that frees the amount
--       by itself. Owner-only table RLS; the friend reads ONLY through hq_reservations_for_me() (SECURITY DEFINER,
--       re-checks are_friends() on every read), so unfriending revokes the view with no cleanup.
--   D3  hq_inventory_removals: one row per MANUAL removal (take out, delete, amount reduction, handed-out
--       reservation) so "zuletzt aufgebraucht" can list the last ten removals independent of any session. Desktop
--       snapshot drops stay derived from hq_live_events (inventory.snapshot); this table is the manual half.
--
-- Alpha data policy (documented drops):
--   * hq_inventory_items.reservations (jsonb) is DROPPED after its entries were copied into
--     hq_inventory_reservations (one row per entry; friend_id null, note kept, `at` becomes created_at).
--   * The old primary key (user_id, location, name) is replaced; existing rows get quality null = key 0.
--
-- Expiry: reads filter `expires_at is null or expires_at > now()` (RLS + RPC), and pg_cron job
-- hq-reservations-expire deletes expired rows hourly. cron.schedule is called directly, never create extension.
--
-- ROLLBACK (data of the new tables is lost):
--   select cron.unschedule('hq-reservations-expire'); select cron.unschedule('hq-inventory-removals-retention');
--   drop function if exists public.hq_reservations_for_me(); drop function if exists public.hq_reservations_mark_seen(uuid[]);
--   drop table if exists public.hq_inventory_removals; drop table if exists public.hq_inventory_reservations;
--   alter table public.hq_inventory_items add column reservations jsonb not null default '[]'::jsonb;
--   alter table public.hq_inventory_items drop constraint hq_inventory_items_pkey;
--   alter table public.hq_inventory_items drop column quality_key, drop column quality;
--   alter table public.hq_inventory_items add primary key (user_id, location, name);

-- ---------------------------------------------------------------------------
-- D1: quality + stack key
-- ---------------------------------------------------------------------------
alter table public.hq_inventory_items add column if not exists quality smallint;
alter table public.hq_inventory_items drop constraint if exists hq_inv_item_quality;
alter table public.hq_inventory_items add constraint hq_inv_item_quality check (quality is null or quality between 1 and 1000);
comment on column public.hq_inventory_items.quality is
  'Material/item quality 1..1000 as the game shows it; null = unknown. Written by the SCC app, manual entry optional. One stack per (place, item, quality).';

alter table public.hq_inventory_items add column if not exists quality_key smallint generated always as (coalesce(quality, 0)::smallint) stored;
comment on column public.hq_inventory_items.quality_key is
  'coalesce(quality, 0): the nullable quality as a key column. Part of the primary key and the upsert conflict target (on_conflict=user_id,location,name,quality_key).';

-- Reservations move out before the key changes (their FK points at the new key).
create table if not exists public.hq_inventory_reservations (
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id            uuid        not null default gen_random_uuid(),
  location      text        not null,
  name          text        not null,
  quality_key   smallint    not null default 0,
  amount        numeric     not null,
  note          text        not null default '',
  friend_id     uuid        references auth.users (id) on delete cascade,
  expires_at    timestamptz,
  friend_seen_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, id),

  constraint hq_inv_res_amount check (amount > 0 and amount <= 1000000000),
  constraint hq_inv_res_note   check (char_length(note) <= 120),
  -- A reservation says WHO (friend), WHAT FOR (text) or both; never nothing.
  constraint hq_inv_res_target check (friend_id is not null or char_length(btrim(note)) > 0),
  constraint hq_inv_res_not_self check (friend_id is null or friend_id <> user_id)
);
comment on table public.hq_inventory_reservations is
  'Part of an inventory stack earmarked for a friend (friend_id), a free text (note) or both, optionally until expires_at. '
  'Available = stack qty minus the live reservations. Owner-only RLS; the friend reads through hq_reservations_for_me().';

create index if not exists hq_inv_res_stack_idx  on public.hq_inventory_reservations (user_id, location, name, quality_key);
create index if not exists hq_inv_res_friend_idx on public.hq_inventory_reservations (friend_id) where friend_id is not null;
create index if not exists hq_inv_res_expiry_idx on public.hq_inventory_reservations (expires_at) where expires_at is not null;

-- Copy the jsonb entries (only while the column still exists, so a re-run is a no-op).
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'hq_inventory_items' and column_name = 'reservations') then
    insert into public.hq_inventory_reservations (user_id, location, name, quality_key, amount, note, created_at)
    select i.user_id, i.location, i.name, 0,
           least((r.e ->> 'amount')::numeric, i.qty),
           left(coalesce(nullif(btrim(r.e ->> 'note'), ''), '-'), 120),
           coalesce(nullif(r.e ->> 'at', '')::timestamptz, now())
      from public.hq_inventory_items i
      cross join lateral jsonb_array_elements(i.reservations) as r(e)
     where jsonb_typeof(i.reservations) = 'array' and jsonb_array_length(i.reservations) > 0
       and (r.e ->> 'amount') ~ '^[0-9]+(\.[0-9]+)?$' and (r.e ->> 'amount')::numeric > 0;
  end if;
end $$;

alter table public.hq_inventory_items drop constraint if exists hq_inv_item_reservations_shape;
alter table public.hq_inventory_items drop column if exists reservations;

-- Primary key: (user, place, item, quality key).
-- (guarded: on a re-run the key already has the new shape and the reservations FK depends on it)
do $$
begin
  if not exists (
    select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.conrelid = 'public.hq_inventory_items'::regclass and c.contype = 'p' and a.attname = 'quality_key'
  ) then
    alter table public.hq_inventory_items drop constraint if exists hq_inventory_items_pkey;
    alter table public.hq_inventory_items add constraint hq_inventory_items_pkey primary key (user_id, location, name, quality_key);
  end if;
end $$;

alter table public.hq_inventory_reservations drop constraint if exists hq_inv_res_stack_fk;
alter table public.hq_inventory_reservations add constraint hq_inv_res_stack_fk
  foreign key (user_id, location, name, quality_key)
  references public.hq_inventory_items (user_id, location, name, quality_key) on delete cascade;

-- The cap trigger looked a row up by (location, name); the key now includes the quality. quality_key of a NEW row
-- is not computed yet inside a BEFORE trigger, so the cap compares coalesce(quality, 0).
create or replace function public.hq_inventory_enforce_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || new.user_id::text, 0));
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
                        where user_id = new.user_id and location = new.location and name = new.name
                          and quality_key = coalesce(new.quality, 0)) then
      raise exception 'hq_inventory_items: at most 400 stacks per location' using errcode = 'check_violation';
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

-- ---------------------------------------------------------------------------
-- D2: reservation guards (stack must hold the amount; target friend must be a current friend; 50 per stack, 500 per user)
-- ---------------------------------------------------------------------------
create or replace function public.hq_inventory_reservation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_qty numeric;
  v_sum numeric;
begin
  if tg_op = 'UPDATE' then
    -- Identity of the reservation and its owner never move; only amount, note, friend, expiry do.
    new.user_id := old.user_id;
    new.id := old.id;
    new.created_at := old.created_at;
    new.location := old.location;
    new.name := old.name;
    new.quality_key := old.quality_key;
    -- Another friend or another amount is news for the friend again.
    if new.friend_id is distinct from old.friend_id or new.amount <> old.amount then
      new.friend_seen_at := null;
    else
      new.friend_seen_at := old.friend_seen_at;
    end if;
  else
    new.friend_seen_at := null;
  end if;

  -- Only the owner picks a friend, and only a current friend (an RPC/service-role write has no auth.uid()).
  if new.friend_id is not null and auth.uid() is not null
     and (tg_op = 'INSERT' or new.friend_id is distinct from old.friend_id)
     and not public.are_friends(new.user_id, new.friend_id) then
    raise exception 'friend_id is not a friend' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hq_inventory_reservations:' || new.user_id::text, 0));

  if tg_op = 'INSERT' then
    if (select count(*) from public.hq_inventory_reservations where user_id = new.user_id) >= 500 then
      raise exception 'hq_inventory_reservations: at most 500 per user' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.hq_inventory_reservations
         where user_id = new.user_id and location = new.location and name = new.name and quality_key = new.quality_key) >= 50 then
      raise exception 'hq_inventory_reservations: at most 50 per stack' using errcode = 'check_violation';
    end if;
  end if;

  select qty into v_qty from public.hq_inventory_items
   where user_id = new.user_id and location = new.location and name = new.name and quality_key = new.quality_key;
  select coalesce(sum(amount), 0) into v_sum from public.hq_inventory_reservations
   where user_id = new.user_id and location = new.location and name = new.name and quality_key = new.quality_key
     and (expires_at is null or expires_at > now()) and id <> new.id;
  if v_qty is null or v_sum + new.amount > v_qty + 1e-9 then
    raise exception 'reservation exceeds the stack' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.hq_inventory_reservation_guard() from public, anon, authenticated;

drop trigger if exists hq_inv_res_guard on public.hq_inventory_reservations;
create trigger hq_inv_res_guard before insert or update on public.hq_inventory_reservations
  for each row execute function public.hq_inventory_reservation_guard();
drop trigger if exists hq_inv_res_updated_at on public.hq_inventory_reservations;
create trigger hq_inv_res_updated_at before update on public.hq_inventory_reservations
  for each row execute function public.set_updated_at();

alter table public.hq_inventory_reservations enable row level security;
revoke all on table public.hq_inventory_reservations from anon;
grant select, insert, update, delete on table public.hq_inventory_reservations to authenticated;
drop policy if exists hq_inv_res_select_own on public.hq_inventory_reservations;
create policy hq_inv_res_select_own on public.hq_inventory_reservations for select to authenticated
  using ((select auth.uid()) = user_id and (expires_at is null or expires_at > now()));
drop policy if exists hq_inv_res_insert_own on public.hq_inventory_reservations;
create policy hq_inv_res_insert_own on public.hq_inventory_reservations for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists hq_inv_res_update_own on public.hq_inventory_reservations;
create policy hq_inv_res_update_own on public.hq_inventory_reservations for update to authenticated
  using ((select auth.uid()) = user_id and (expires_at is null or expires_at > now())) with check ((select auth.uid()) = user_id);
drop policy if exists hq_inv_res_delete_own on public.hq_inventory_reservations;
create policy hq_inv_res_delete_own on public.hq_inventory_reservations for delete to authenticated
  using ((select auth.uid()) = user_id);

-- The friend's side: live reservations made for the caller by a CURRENT friend. Owner shown by name, never by place
-- detail beyond what the owner chose to reserve at ("liegt in Area18").
create or replace function public.hq_reservations_for_me()
returns table (
  id uuid, owner_id uuid, owner_name text, location text, item_name text, quality smallint,
  amount numeric, note text, expires_at timestamptz, created_at timestamptz, updated_at timestamptz, seen boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select r.id, r.user_id, coalesce(nullif(p.display_name, ''), p.username), r.location, r.name,
         nullif(r.quality_key, 0)::smallint, r.amount, r.note, r.expires_at, r.created_at, r.updated_at,
         r.friend_seen_at is not null
    from public.hq_inventory_reservations r
    left join public.profiles p on p.id = r.user_id
   where r.friend_id = (select auth.uid())
     and (r.expires_at is null or r.expires_at > now())
     and public.are_friends(r.user_id, r.friend_id)
   order by r.updated_at desc
   limit 200;
$$;
revoke all on function public.hq_reservations_for_me() from public, anon;
grant execute on function public.hq_reservations_for_me() to authenticated;

create or replace function public.hq_reservations_mark_seen(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  update public.hq_inventory_reservations r
     set friend_seen_at = now()
   where r.friend_id = (select auth.uid()) and r.id = any (p_ids) and r.friend_seen_at is null
     and public.are_friends(r.user_id, r.friend_id);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.hq_reservations_mark_seen(uuid[]) from public, anon;
grant execute on function public.hq_reservations_mark_seen(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- D3: manual removals
-- ---------------------------------------------------------------------------
create table if not exists public.hq_inventory_removals (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         uuid        not null default gen_random_uuid(),
  at         timestamptz not null default now(),
  location   text        not null,
  name       text        not null,
  class_name text,
  qty        numeric     not null,
  unit       text        not null default 'pcs',
  quality    smallint,
  -- take = taken out, delete = row deleted, reduce = amount corrected downwards, handout = reservation handed out
  kind       text        not null default 'take',
  primary key (user_id, id),

  constraint hq_inv_rem_qty      check (qty > 0 and qty <= 1000000000),
  constraint hq_inv_rem_unit     check (unit in ('pcs', 'scu')),
  constraint hq_inv_rem_kind     check (kind in ('take', 'delete', 'reduce', 'handout')),
  constraint hq_inv_rem_quality  check (quality is null or quality between 1 and 1000),
  constraint hq_inv_rem_text     check (char_length(location) between 1 and 200 and char_length(name) between 1 and 160
                                        and (class_name is null or char_length(class_name) <= 200)),
  constraint hq_inv_rem_at_sane  check (at < now() + interval '1 day')
);
comment on table public.hq_inventory_removals is
  'Manual removals from the Bestand (take out, delete, reduction, handed-out reservation): feeds "zuletzt aufgebraucht" = last ten removals. '
  'Owner-only. Cap 200 per user (oldest pruned), 90 days retention.';
create index if not exists hq_inv_rem_user_at_idx on public.hq_inventory_removals (user_id, at desc);

create or replace function public.hq_inventory_removals_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('hq_inventory_removals:' || new.user_id::text, 0));
  if (select count(*) from public.hq_inventory_removals where user_id = new.user_id) >= 200 then
    delete from public.hq_inventory_removals
     where (user_id, id) in (select user_id, id from public.hq_inventory_removals where user_id = new.user_id order by at asc limit 20);
  end if;
  return new;
end;
$$;
revoke all on function public.hq_inventory_removals_cap() from public, anon, authenticated;
drop trigger if exists hq_inv_rem_cap on public.hq_inventory_removals;
create trigger hq_inv_rem_cap before insert on public.hq_inventory_removals
  for each row execute function public.hq_inventory_removals_cap();

alter table public.hq_inventory_removals enable row level security;
revoke all on table public.hq_inventory_removals from anon;
grant select, insert, delete on table public.hq_inventory_removals to authenticated;
drop policy if exists hq_inv_rem_select_own on public.hq_inventory_removals;
create policy hq_inv_rem_select_own on public.hq_inventory_removals for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists hq_inv_rem_insert_own on public.hq_inventory_removals;
create policy hq_inv_rem_insert_own on public.hq_inventory_removals for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists hq_inv_rem_delete_own on public.hq_inventory_removals;
create policy hq_inv_rem_delete_own on public.hq_inventory_removals for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Cron: expire reservations hourly, prune removals nightly. cron.schedule replaces a job of the same name.
-- Guarded so a bare Postgres without pg_cron (tests, local dry-run) still applies the file.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('hq-reservations-expire', '7 * * * *',
      $job$ delete from public.hq_inventory_reservations where expires_at is not null and expires_at <= now() $job$);
    perform cron.schedule('hq-inventory-removals-retention', '25 3 * * *',
      $job$ delete from public.hq_inventory_removals where at < now() - interval '90 days' $job$);
  end if;
end $$;

notify pgrst, 'reload schema';
