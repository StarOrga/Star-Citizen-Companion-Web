-- ============================================================
-- 20260820150000_keybind_categories.sql
-- Admin-curated category hierarchy for input actions (keybinds) —
-- feedback fd58a5eb.
--
-- WHAT THIS CREATES
--   keybind_categories — one optional assignment row per input action,
--                        keyed by (actionmap, action_name).
--
-- WHY A SEPARATE TABLE AND NOT A COLUMN ON codex_keybinds
--   `codex_keybinds` is EXTRACTED data: every catalog ingest rewrites it for
--   the new build, and rows carry a build_id. A curated assignment is the
--   opposite — human work that must survive the next patch. Keying on the
--   (actionmap, action_name) pair instead of a build-scoped id means an
--   assignment made on 4.2 still applies on 4.3 for every action that still
--   exists, and simply goes unused for ones that don't.
--
-- THE TAXONOMY (Context layers L1-L5 of the SCC "Input Actions Hierarchy
-- Concept v5", Star-Citizen-Companion-App/docs/architecture/generated/
-- input-actions-hierarchy.html):
--   L1 scope        — verse | in_game | out_of_game          (exclusive)
--   L2 environment  — refines the scope                      (exclusive)
--   L3 role         — refines the environment                (exclusive)
--   L4 activity     — what the player is doing               (exclusive)
--   L5 action_group — which system the action belongs to     (parallel)
-- L6-L8 (device / input / action) are BINDING layers and already live in
-- codex_keybinds — they are extracted, not curated, so they are not here.
--
-- Every column is nullable: a partially classified action is the normal
-- intermediate state while ~1.1k actions get worked through, and the UI
-- fills the chain top-down. The cross-column checks below mirror exactly
-- the cascade the admin UI offers, so an environment can never belong to
-- the wrong scope even if a write bypasses the UI.
--
-- ALPHA-PHASE DATA POLICY: additive only, nothing dropped.
-- ============================================================

create table public.keybind_categories (
  -- (actionmap, action_name) is the action's identity in defaultProfile.xml
  -- and stays stable across builds; codex_keybinds.id does not.
  actionmap    text not null,
  action_name  text not null,

  scope        text check (scope in ('verse', 'in_game', 'out_of_game')),
  environment  text check (environment in (
                 'on_foot', 'in_vehicle', 'spectator',   -- scope: verse
                 'mobiglas', 'starmap', 'chat',          -- scope: in_game
                 'console')),                            -- scope: out_of_game
  role         text check (role in (
                 'pilot', 'copilot', 'gunner', 'driver', -- environment: in_vehicle
                 'normal', 'eva', 'ladder')),            -- environment: on_foot
  activity     text check (activity in (
                 'combat', 'mining', 'salvage', 'exploring', 'medical',
                 'trading', 'racing', 'engineering', 'hacking')),
  action_group text check (action_group in (
                 'flight_control', 'weapons', 'targeting', 'shields', 'power',
                 'mfd_hud', 'mining_tools', 'movement', 'camera',
                 'communication', 'interaction')),

  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,

  primary key (actionmap, action_name),

  -- A child layer without its parent is not a partial assignment, it is an
  -- ambiguous one ("Pilot" of what?). The UI never produces it; the DB says
  -- so too.
  constraint keybind_categories_environment_scope check (
    environment is null or (
      (scope = 'verse'        and environment in ('on_foot', 'in_vehicle', 'spectator')) or
      (scope = 'in_game'      and environment in ('mobiglas', 'starmap', 'chat')) or
      (scope = 'out_of_game'  and environment = 'console')
    )
  ),
  constraint keybind_categories_role_environment check (
    role is null or (
      (environment = 'in_vehicle' and role in ('pilot', 'copilot', 'gunner', 'driver')) or
      (environment = 'on_foot'    and role in ('normal', 'eva', 'ladder'))
    )
  )
);

comment on table public.keybind_categories is
  'Admin-curated Context hierarchy (L1-L5) per input action, keyed by '
  '(actionmap, action_name) so it survives a build change. Extracted binding '
  'data stays in codex_keybinds. Public read (like the rest of the codex), '
  'admin-only write. Served to integrators via GET /v1/keybinds. '
  'See feedback fd58a5eb.';

comment on column public.keybind_categories.action_group is
  'L5 — parallel layer: which system the action belongs to (Flight Control, '
  'Weapons, ...). Independent of scope/environment/role, so it carries no '
  'cross-column constraint.';

-- The two reads this table gets: "everything, to paint the keybind list" and
-- "the assigned ones, grouped" for the API. A partial index on the assigned
-- rows keeps the second cheap while the table is mostly empty.
create index keybind_categories_assigned_idx
  on public.keybind_categories (action_group, activity)
  where action_group is not null or activity is not null;

create trigger keybind_categories_set_updated_at
  before update on public.keybind_categories
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS — public read (the codex is public), admin-only write
-- ============================================================
alter table public.keybind_categories enable row level security;

drop policy if exists keybind_categories_public_read on public.keybind_categories;
create policy keybind_categories_public_read on public.keybind_categories
  for select to anon, authenticated using (true);

drop policy if exists keybind_categories_admin_insert on public.keybind_categories;
create policy keybind_categories_admin_insert on public.keybind_categories
  for insert to authenticated with check (public.is_admin());

drop policy if exists keybind_categories_admin_update on public.keybind_categories;
create policy keybind_categories_admin_update on public.keybind_categories
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists keybind_categories_admin_delete on public.keybind_categories;
create policy keybind_categories_admin_delete on public.keybind_categories
  for delete to authenticated using (public.is_admin());

revoke all on public.keybind_categories from public, anon, authenticated;
grant select on public.keybind_categories to anon, authenticated;
grant insert, update, delete on public.keybind_categories to authenticated;
