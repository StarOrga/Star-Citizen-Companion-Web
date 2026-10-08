-- ============================================================
-- HQ sync contract (personal data: hangar ships, ship configs, FPS sets)
-- ============================================================
-- The app splits into CODEX (game knowledge, identical for everyone) and
-- HQ (everything individual). HQ rows will later sync with the SCC desktop
-- app, so every personal table carries the same two bookkeeping columns:
--
--   updated_at timestamptz not null default now()
--     bumped by a BEFORE UPDATE trigger (public.set_updated_at(), defined
--     in 00001_init_schema.sql). A sync client pulls "everything with
--     updated_at > my last cursor".
--   deleted_at timestamptz null
--     soft-delete tombstone. A row with deleted_at is not null is gone for
--     every reader; it survives only so a sync client can learn about the
--     deletion. Nothing writes it yet; readers add the filter together with
--     the first soft delete, so the client never depends on this column.
--
-- Rule: every NEW personal table (Nachschub, Einsaetze, ...) ships with
-- both columns and the trigger from day one.
--
-- hangar_ships / hangar_ship_configs / hangar_role_loadouts already had
-- updated_at + trigger since 20260613000000_hangar.sql; this migration is
-- idempotent about them and only adds deleted_at plus a sync-cursor index.
--
-- Not changed here: RLS policies (self-only CRUD stays as is) and the delete
-- paths (the web client still hard-deletes). Before clients switch to soft
-- delete, the unique keys hangar_ships_user_ship_key (user_id,
-- ship_class_name) and hangar_ship_configs_one_active must become partial
-- (where deleted_at is null), otherwise a tombstone blocks re-adding a ship.
-- ============================================================

-- hangar_ships ------------------------------------------------
alter table public.hangar_ships
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz null;

drop trigger if exists hangar_ships_updated_at on public.hangar_ships;
create trigger hangar_ships_updated_at before update on public.hangar_ships
  for each row execute function public.set_updated_at();

create index if not exists hangar_ships_sync_idx
  on public.hangar_ships (user_id, updated_at);

comment on column public.hangar_ships.deleted_at is
  'HQ sync contract: soft-delete tombstone. Non-null = deleted; readers filter deleted_at is null.';

-- hangar_ship_configs -----------------------------------------
alter table public.hangar_ship_configs
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz null;

drop trigger if exists hangar_ship_configs_updated_at on public.hangar_ship_configs;
create trigger hangar_ship_configs_updated_at before update on public.hangar_ship_configs
  for each row execute function public.set_updated_at();

create index if not exists hangar_ship_configs_sync_idx
  on public.hangar_ship_configs (user_id, updated_at);

comment on column public.hangar_ship_configs.deleted_at is
  'HQ sync contract: soft-delete tombstone. Non-null = deleted; readers filter deleted_at is null.';

-- hangar_role_loadouts ----------------------------------------
alter table public.hangar_role_loadouts
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz null;

drop trigger if exists hangar_role_loadouts_updated_at on public.hangar_role_loadouts;
create trigger hangar_role_loadouts_updated_at before update on public.hangar_role_loadouts
  for each row execute function public.set_updated_at();

create index if not exists hangar_role_loadouts_sync_idx
  on public.hangar_role_loadouts (user_id, updated_at);

comment on column public.hangar_role_loadouts.deleted_at is
  'HQ sync contract: soft-delete tombstone. Non-null = deleted; readers filter deleted_at is null.';
