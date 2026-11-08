-- HQ Bestand (concept 20261108-2135-hq-bestand, lines D1 / D2 / D3).
--
--   D1  Quality as a CHILD table, backward compatible with the released desktop app.
--       hq_inventory_items keeps its primary key (user_id, location, name) and its meaning: ONE row per item and place
--       with the TOTAL qty, exactly as the old app upserts it (on_conflict=user_id,location,name stays valid; the old app
--       writes no stacks, so all its quality is "unknown").
--       hq_inventory_stacks (user_id, location, name, quality 1..1000, qty) is the optional split of that total by quality,
--       PK (user_id, location, name, quality), FK to the item row ON DELETE CASCADE. The new app writes stacks IN ADDITION
--       to the item row.
--       Mismatch rule (decided): the item qty is the truth. unknown quality = qty - sum(stacks) (the remainder is shown as
--       "Qualitaet unbekannt"). If an old-app write left sum(stacks) ABOVE qty, the stacks are stale and are ignored (all
--       unknown) until the new app rewrites them. A stack write is refused when it would push sum(stacks) above qty, so the
--       new app writes the item row first when raising and the stacks first when lowering.
--       View hq_inventory_item_quality exposes stacked_qty / unknown_qty / stale per item.
--   D2  Reservations leave the jsonb column and become rows of hq_inventory_reservations: an amount earmarked on one item
--       row for a friend (friend_id), a free text (note), or both; optional quality (null = any stack); optional expires_at
--       that frees the amount by itself. Owner-only table RLS; the friend reads ONLY through hq_reservations_for_me()
--       (SECURITY DEFINER, are_friends() re-checked on every read).
--   D3  hq_inventory_removals: one row per MANUAL removal so "zuletzt aufgebraucht" can list the last ten removals.
--
-- Alpha data policy (documented drop): hq_inventory_items.reservations (jsonb) is DROPPED after its entries were copied
-- into hq_inventory_reservations (friend_id null, quality null, `at` becomes created_at). No other column or key changes.
--
-- Expiry: reads filter `expires_at is null or expires_at > now()` (RLS + RPC), and pg_cron job hq-reservations-expire
-- deletes expired rows hourly. cron.schedule is called directly, never create extension.
--
-- ROLLBACK (data of the new tables is lost):
--   select cron.unschedule('hq-reservations-expire'); select cron.unschedule('hq-inventory-removals-retention');
--   drop function if exists public.hq_reservations_for_me(); drop function if exists public.hq_reservations_mark_seen(uuid[]);
--   drop view if exists public.hq_inventory_item_quality;
--   drop table if exists public.hq_inventory_removals, public.hq_inventory_reservations, public.hq_inventory_stacks;
--   alter table public.hq_inventory_items add column reservations jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- D2 first: reservations (the jsonb copy needs only the item rows, which are unchanged)
-- ---------------------------------------------------------------------------
create table if not exists public.hq_inventory_reservations (
  user_id        uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id             uuid        not null default gen_random_uuid(),
  location       text        not null,
  name           text        not null,
  quality        smallint,
  amount         numeric     not null,
  note           text        not null default '',
  friend_id      uuid        references auth.users (id) on delete cascade,
  expires_at     timestamptz,
  friend_seen_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, location, name) references public.hq_inventory_items (user_id, location, name) on delete cascade,

  constraint hq_inv_res_amount check (amount > 0 and amount <= 1000000000),
  constraint hq_inv_res_note   check (char_length(note) <= 120),
  constraint hq_inv_res_quality check (quality is null or quality between 1 and 1000),
  -- A reservation says WHO (friend), WHAT FOR (text) or both; never nothing.
  constraint hq_inv_res_target check (friend_id is not null or char_length(btrim(note)) > 0),
  constraint hq_inv_res_not_self check (friend_id is null or friend_id <> user_id)
);
comment on table public.hq_inventory_reservations is
  'Part of an inventory item row earmarked for a friend (friend_id), a free text (note) or both, optionally of one quality '
  '(null = any stack) and until expires_at. Available = item qty minus the live reservations. Owner-only RLS; the friend reads hq_reservations_for_me().';

create index if not exists hq_inv_res_item_idx   on public.hq_inventory_reservations (user_id, location, name);
create index if not exists hq_inv_res_friend_idx on public.hq_inventory_reservations (friend_id) where friend_id is not null;
create index if not exists hq_inv_res_expiry_idx on public.hq_inventory_reservations (expires_at) where expires_at is not null;

-- Copy the jsonb entries (only while the column still exists, so a re-run is a no-op).
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'hq_inventory_items' and column_name = 'reservations') then
    insert into public.hq_inventory_reservations (user_id, location, name, amount, note, created_at)
    select i.user_id, i.location, i.name,
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

-- ---------------------------------------------------------------------------
-- D1: the stacks child table
-- ---------------------------------------------------------------------------
create table if not exists public.hq_inventory_stacks (
  user_id    uuid        not null default auth.uid(),
  location   text        not null,
  name       text        not null,
  quality    smallint    not null,
  qty        numeric     not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, location, name, quality),
  foreign key (user_id, location, name) references public.hq_inventory_items (user_id, location, name) on delete cascade,

  constraint hq_inv_stack_quality check (quality between 1 and 1000),
  constraint hq_inv_stack_qty     check (qty > 0 and qty <= 1000000000)
);
comment on table public.hq_inventory_stacks is
  'Optional split of an inventory item row''s total qty by quality 1..1000. sum(qty) <= item qty; the rest is "quality unknown". '
  'Written by the new SCC app in addition to the item row; the old app writes none. Cascade-deleted with the item. Private per user.';

drop trigger if exists hq_inventory_stacks_updated_at on public.hq_inventory_stacks;
create trigger hq_inventory_stacks_updated_at before update on public.hq_inventory_stacks
  for each row execute function public.set_updated_at();

-- sum(stacks) must not exceed the item qty; at most 20 qualities per item and 3000 stacks per user.
create or replace function public.hq_inventory_stack_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_qty numeric;
  v_sum numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('hq_inventory_stacks:' || new.user_id::text, 0));
  select qty into v_qty from public.hq_inventory_items
   where user_id = new.user_id and location = new.location and name = new.name;
  select coalesce(sum(qty), 0) into v_sum from public.hq_inventory_stacks
   where user_id = new.user_id and location = new.location and name = new.name and quality <> new.quality;
  if v_qty is null or v_sum + new.qty > v_qty + 1e-9 then
    raise exception 'stacks exceed the item quantity' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if (select count(*) from public.hq_inventory_stacks
         where user_id = new.user_id and location = new.location and name = new.name) >= 20 then
      raise exception 'hq_inventory_stacks: at most 20 qualities per item' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.hq_inventory_stacks where user_id = new.user_id) >= 3000 then
      raise exception 'hq_inventory_stacks: at most 3000 per user' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.hq_inventory_stack_guard() from public, anon, authenticated;
drop trigger if exists hq_inventory_stacks_guard on public.hq_inventory_stacks;
create trigger hq_inventory_stacks_guard before insert or update on public.hq_inventory_stacks
  for each row execute function public.hq_inventory_stack_guard();

alter table public.hq_inventory_stacks enable row level security;
revoke all on table public.hq_inventory_stacks from anon;
grant select, insert, update, delete on table public.hq_inventory_stacks to authenticated;
drop policy if exists hq_inventory_stacks_select_own on public.hq_inventory_stacks;
create policy hq_inventory_stacks_select_own on public.hq_inventory_stacks for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists hq_inventory_stacks_insert_own on public.hq_inventory_stacks;
create policy hq_inventory_stacks_insert_own on public.hq_inventory_stacks for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists hq_inventory_stacks_update_own on public.hq_inventory_stacks;
create policy hq_inventory_stacks_update_own on public.hq_inventory_stacks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists hq_inventory_stacks_delete_own on public.hq_inventory_stacks;
create policy hq_inventory_stacks_delete_own on public.hq_inventory_stacks for delete to authenticated using ((select auth.uid()) = user_id);

-- Per item: stacked amount, the unknown-quality remainder, and whether the stacks are stale (an old-app write left them above qty).
create or replace view public.hq_inventory_item_quality with (security_invoker = true) as
select i.user_id, i.location, i.name, i.qty,
       coalesce(s.total, 0) as stacked_qty,
       case when coalesce(s.total, 0) > i.qty + 1e-9 then i.qty else i.qty - coalesce(s.total, 0) end as unknown_qty,
       coalesce(s.total, 0) > i.qty + 1e-9 as stale
  from public.hq_inventory_items i
  left join (select user_id, location, name, sum(qty) as total from public.hq_inventory_stacks group by 1, 2, 3) s
    on s.user_id = i.user_id and s.location = i.location and s.name = i.name;
revoke all on public.hq_inventory_item_quality from anon;
grant select on public.hq_inventory_item_quality to authenticated;

-- ---------------------------------------------------------------------------
-- D2: reservation guards (item must hold the amount; a quality reservation must fit its stack; target friend must be a
-- current friend; 50 per item, 500 per user)
-- ---------------------------------------------------------------------------
create or replace function public.hq_inventory_reservation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_qty numeric;
  v_sum numeric;
  v_stack numeric;
begin
  if tg_op = 'UPDATE' then
    -- Identity of the reservation and its owner never move; amount, note, friend, quality, expiry do.
    new.user_id := old.user_id;
    new.id := old.id;
    new.created_at := old.created_at;
    new.location := old.location;
    new.name := old.name;
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
         where user_id = new.user_id and location = new.location and name = new.name) >= 50 then
      raise exception 'hq_inventory_reservations: at most 50 per item' using errcode = 'check_violation';
    end if;
  end if;

  select qty into v_qty from public.hq_inventory_items
   where user_id = new.user_id and location = new.location and name = new.name;
  select coalesce(sum(amount), 0) into v_sum from public.hq_inventory_reservations
   where user_id = new.user_id and location = new.location and name = new.name
     and (expires_at is null or expires_at > now()) and id <> new.id;
  if v_qty is null or v_sum + new.amount > v_qty + 1e-9 then
    raise exception 'reservation exceeds the item quantity' using errcode = 'check_violation';
  end if;

  -- A reservation of one quality must fit that quality's stack (together with the other reservations of that quality).
  if new.quality is not null then
    select qty into v_stack from public.hq_inventory_stacks
     where user_id = new.user_id and location = new.location and name = new.name and quality = new.quality;
    select coalesce(sum(amount), 0) into v_sum from public.hq_inventory_reservations
     where user_id = new.user_id and location = new.location and name = new.name and quality = new.quality
       and (expires_at is null or expires_at > now()) and id <> new.id;
    if v_stack is null or v_sum + new.amount > v_stack + 1e-9 then
      raise exception 'reservation exceeds the quality stack' using errcode = 'check_violation';
    end if;
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

-- The friend's side: live reservations made for the caller by a CURRENT friend.
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
         r.quality, r.amount, r.note, r.expires_at, r.created_at, r.updated_at,
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
