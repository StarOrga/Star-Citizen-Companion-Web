-- ============================================================
-- 20260613000000_hangar.sql
-- Personal Web Hangar — the first user-owned data layer on top of the
-- read-only codex catalog (concept: docs/concepts/2026-06-13-web-hangar-redesign.md).
--
-- WHAT THIS CREATES
--   hangar_ships         — a ship in the user's personal hangar (owned/wishlist,
--                          custom name, top-3 pin rank, selected 3D skin).
--   hangar_ship_configs  — saved loadout configurations per hangar ship
--                          (role-tagged, JSONB port→item assignments, one
--                          active config per ship).
--   hangar_role_loadouts — ship-independent personal equipment sets
--                          (FPS / mining / salvage / medical / engineering).
--
-- SOFT FKs BY DESIGN
--   ship_class_name / loadout[].className reference codex entities by their
--   stable class_name slug, NOT by codex_* row FKs: catalog rows are
--   build-scoped and get replaced wholesale on every extractor run, while
--   user data must survive build swaps. selected_skin_id references
--   ship_skins.skin_id the same way.
--
-- RLS
--   All three tables: self-only CRUD (auth.uid() = user_id). No admin
--   override — hangar data is private to its owner. Mirrors the profiles
--   self-only pattern from 00001.
--
-- ADDITIVE: this migration drops nothing.
-- ============================================================

-- ============================================================
-- hangar_ships
-- ============================================================
create table public.hangar_ships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ship_class_name text not null,     -- codex_ships.class_name (soft FK, patch-stable slug)
  custom_name text,                  -- the user's pet name ("Mighty Pickle")
  status text not null default 'owned' check (status in ('owned', 'wishlist')),
  pinned_rank int check (pinned_rank between 1 and 3),
  selected_skin_id text,             -- ship_skins.skin_id (soft FK)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hangar_ships_user_ship_key unique (user_id, ship_class_name)
);

-- At most one ship per pin slot (1..3) per user.
create unique index hangar_ships_pin_unique
  on public.hangar_ships (user_id, pinned_rank) where pinned_rank is not null;

create index hangar_ships_user_idx on public.hangar_ships (user_id, created_at desc);

comment on table public.hangar_ships is
  'A ship in a user''s personal hangar. ship_class_name soft-FKs codex_ships.class_name so the entry survives catalog build swaps.';

create trigger hangar_ships_updated_at before update on public.hangar_ships
  for each row execute function public.set_updated_at();

-- ============================================================
-- hangar_ship_configs
-- ============================================================
create table public.hangar_ship_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  hangar_ship_id uuid not null references public.hangar_ships (id) on delete cascade,
  name text not null,
  role text not null default 'multipurpose' check (role in (
    'combat', 'mining', 'salvage', 'cargo', 'exploration',
    'racing', 'medical', 'multipurpose'
  )),
  -- [{ "portName": "hardpoint_gun_left", "className": "BEHR_LaserCannon_S3", "kind": "weapon" }]
  -- portName joins codex_item_ports.port_name; className joins the codex
  -- entity tables. Ports absent from the array keep their stock default.
  loadout jsonb not null default '[]'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one active config per hangar ship.
create unique index hangar_ship_configs_one_active
  on public.hangar_ship_configs (hangar_ship_id) where is_active;

create index hangar_ship_configs_ship_idx
  on public.hangar_ship_configs (hangar_ship_id, updated_at desc);
create index hangar_ship_configs_user_idx
  on public.hangar_ship_configs (user_id);

comment on table public.hangar_ship_configs is
  'A saved per-ship loadout (port→item assignments as JSONB). One active config per hangar ship (partial unique).';

create trigger hangar_ship_configs_updated_at before update on public.hangar_ship_configs
  for each row execute function public.set_updated_at();

-- ============================================================
-- hangar_role_loadouts
-- ============================================================
create table public.hangar_role_loadouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  role text not null check (role in (
    'fps', 'mining', 'salvage', 'medical', 'engineering'
  )),
  -- [{ "slot": "primary", "className": "BEHR_Rifle_Ballistic_01", "kind": "weapon" }]
  -- slot is a free label (primary/secondary/sidearm/helmet/core/arms/legs/
  -- undersuit/backpack/tool/gadget/multitool-attachment/…) — the editor
  -- offers role-specific suggestions but stores whatever the user names.
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hangar_role_loadouts_user_idx
  on public.hangar_role_loadouts (user_id, role, updated_at desc);

comment on table public.hangar_role_loadouts is
  'Ship-independent personal equipment sets (FPS/mining/salvage/…). items JSONB: [{slot, className, kind}].';

create trigger hangar_role_loadouts_updated_at before update on public.hangar_role_loadouts
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS — self-only CRUD on all three tables
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array['hangar_ships', 'hangar_ship_configs', 'hangar_role_loadouts']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($p$
      create policy %I on public.%I
        for select to authenticated using (auth.uid() = user_id);
    $p$, t || '_self_select', t);
    execute format($p$
      create policy %I on public.%I
        for insert to authenticated with check (auth.uid() = user_id);
    $p$, t || '_self_insert', t);
    execute format($p$
      create policy %I on public.%I
        for update to authenticated
        using (auth.uid() = user_id) with check (auth.uid() = user_id);
    $p$, t || '_self_update', t);
    execute format($p$
      create policy %I on public.%I
        for delete to authenticated using (auth.uid() = user_id);
    $p$, t || '_self_delete', t);
    -- anon never touches hangar data
    execute format('revoke all on public.%I from anon;', t);
  end loop;
end $$;

-- Hardening: a config row must point at a hangar ship the SAME user owns.
-- Without this, a user could insert a config carrying a foreign
-- hangar_ship_id (their own user_id passes the generic policy) and — via the
-- one-active partial unique index — block the victim's active config (DoS).
-- RESTRICTIVE policies AND with the permissive self-* policies above.
create policy hangar_ship_configs_ship_owned_insert on public.hangar_ship_configs
  as restrictive for insert to authenticated
  with check (exists (
    select 1 from public.hangar_ships hs
    where hs.id = hangar_ship_id and hs.user_id = auth.uid()
  ));

create policy hangar_ship_configs_ship_owned_update on public.hangar_ship_configs
  as restrictive for update to authenticated
  with check (exists (
    select 1 from public.hangar_ships hs
    where hs.id = hangar_ship_id and hs.user_id = auth.uid()
  ));
