-- ============================================================
-- 20261103200000_codex_search_reverse_lookups.sql
-- Reverse lookups for the search CTAs "Passende Schiffe" and "Passende Waffen"
-- (concept 2026-11-02-suche-kontext-aktionen, round 3 `q3-matrix`, #832).
--
-- WHAT
--   * codex_ship_fit_ports — per build: every (ship, accepted port type, size
--     range) a ship offers, INCLUDING the sub-ports of what its stock loadout
--     seats (turret -> gimbal -> gun seat, up to 6 levels). Same walk as the
--     client's buildFitPorts() (src/app/codex/search/search-compat.ts): the
--     ship's own ports plus the ports of every entity its defaultLoadout tree
--     seats. Port types are stored lower-cased.
--   * codex_ammo_weapons — per build: ammo class name -> weapon class names
--     (from payload.weaponParams.ammoClassName).
--   * codex_ships_fitting(build, type, size) -> ship class names whose ports
--     accept an attach type + size (size null = any size).
--   * codex_weapons_for_ammo(build, ammo) -> weapon class names firing it.
--
-- WHY PRECOMPUTED
--   Both answers live inside payload blobs (codex_payloads.body via the
--   codex_* views). Reading every ship payload per request is a full detoast
--   of ~270 large blobs — far over the anon 3 s budget and the pool rules of
--   sc-unavailable-pool-exhaustion. The tables are filled ONCE per build:
--     - when a build is finalized (trigger on codex_builds.finalized_at),
--     - for every already finalized build right here (backfill).
--   The RPCs read only the small indexed tables. A build without rows yet
--   (finalized before this migration ran and somehow missed the backfill)
--   simply yields no result; the CTA then falls back like before.
--
-- SECURITY
--   Tables: RLS on, select for anon + authenticated (public catalog data like
--   every codex_* table since 20260710190000), no write policy. The refresh
--   function is SECURITY DEFINER and granted to nobody but the trigger/owner.
--   RPCs: SECURITY INVOKER, STABLE, pinned search_path.
--
-- Additive only: no existing table, policy or function changes.
-- ============================================================

create table if not exists public.codex_ship_fit_ports (
  build_id        uuid not null references public.codex_builds (id) on delete cascade,
  ship_class_name text not null,
  port_type       text not null,
  min_size        int,
  max_size        int
);

create index if not exists codex_ship_fit_ports_lookup_idx
  on public.codex_ship_fit_ports using btree (build_id, port_type, ship_class_name);

create table if not exists public.codex_ammo_weapons (
  build_id          uuid not null references public.codex_builds (id) on delete cascade,
  ammo_class_name   text not null,
  weapon_class_name text not null,
  primary key (build_id, ammo_class_name, weapon_class_name)
);

alter table public.codex_ship_fit_ports enable row level security;
alter table public.codex_ammo_weapons enable row level security;

drop policy if exists codex_ship_fit_ports_read on public.codex_ship_fit_ports;
create policy codex_ship_fit_ports_read on public.codex_ship_fit_ports for select to anon, authenticated using (true);
drop policy if exists codex_ammo_weapons_read on public.codex_ammo_weapons;
create policy codex_ammo_weapons_read on public.codex_ammo_weapons for select to anon, authenticated using (true);

grant select on public.codex_ship_fit_ports to anon, authenticated;
grant select on public.codex_ammo_weapons to anon, authenticated;

-- Fill (or refill) both tables for one build. Idempotent.
create or replace function public.codex_refresh_reverse_lookups(p_build_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
begin
  delete from public.codex_ship_fit_ports where build_id = p_build_id;
  delete from public.codex_ammo_weapons where build_id = p_build_id;

  insert into public.codex_ship_fit_ports (build_id, ship_class_name, port_type, min_size, max_size)
  with recursive ships as materialized (
    select s.class_name, s.payload -> 'defaultLoadout' as lo
      from public.codex_ships s
     where s.build_id = p_build_id
  ),
  walk (ship, cls, entries, depth) as (
    select class_name, class_name, lo, 0 from ships
    union all
    select w.ship, e ->> 'entityClassName', e -> 'entries', w.depth + 1
      from walk w
     cross join lateral jsonb_array_elements(
       case when jsonb_typeof(w.entries) = 'array' then w.entries else '[]'::jsonb end
     ) e
     where w.depth < 6 and nullif(e ->> 'entityClassName', '') is not null
  ),
  seated as (select distinct ship, cls from walk)
  select distinct p_build_id, st.ship, lower(t), p.min_size, p.max_size
    from seated st
    join public.codex_item_ports p on p.build_id = p_build_id and p.parent_class_name = st.cls
   cross join lateral unnest(p.types) t
   where nullif(trim(t), '') is not null;

  insert into public.codex_ammo_weapons (build_id, ammo_class_name, weapon_class_name)
  select distinct p_build_id, a.ammo, w.class_name
    from public.codex_weapons w
   cross join lateral (select nullif(trim(w.payload #>> '{weaponParams,ammoClassName}'), '') as ammo) a
   where w.build_id = p_build_id and a.ammo is not null;
end;
$func$;

revoke all on function public.codex_refresh_reverse_lookups(uuid) from public, anon, authenticated;

create or replace function public.codex_builds_reverse_lookups_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if new.finalized_at is not null and (tg_op = 'INSERT' or old.finalized_at is distinct from new.finalized_at) then
    perform public.codex_refresh_reverse_lookups(new.id);
  end if;
  return new;
end;
$func$;

revoke all on function public.codex_builds_reverse_lookups_trg() from public, anon, authenticated;

drop trigger if exists codex_builds_reverse_lookups on public.codex_builds;
create trigger codex_builds_reverse_lookups
  after insert or update of finalized_at on public.codex_builds
  for each row execute function public.codex_builds_reverse_lookups_trg();

-- Ships whose ports (incl. nested mount seats) accept an attach type + size.
create or replace function public.codex_ships_fitting(p_build_id uuid, p_type text, p_size int default null)
returns table (class_name text)
language sql
stable
security invoker
set search_path = public
as $func$
  select distinct f.ship_class_name
    from public.codex_ship_fit_ports f
   where f.build_id = p_build_id
     and f.port_type = lower(trim(p_type))
     and (p_size is null
          or ((f.min_size is null or p_size >= f.min_size) and (f.max_size is null or p_size <= f.max_size)))
   order by 1
   limit 1000
$func$;

-- Weapons that fire an ammunition class.
create or replace function public.codex_weapons_for_ammo(p_build_id uuid, p_ammo text)
returns table (class_name text)
language sql
stable
security invoker
set search_path = public
as $func$
  select a.weapon_class_name
    from public.codex_ammo_weapons a
   where a.build_id = p_build_id and a.ammo_class_name = p_ammo
   order by 1
   limit 1000
$func$;

grant execute on function public.codex_ships_fitting(uuid, text, int) to anon, authenticated;
grant execute on function public.codex_weapons_for_ammo(uuid, text) to anon, authenticated;

-- Backfill every finalized build.
do $$
declare b uuid;
begin
  for b in select id from public.codex_builds where finalized_at is not null loop
    perform public.codex_refresh_reverse_lookups(b);
  end loop;
end $$;
