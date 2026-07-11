-- ============================================================================
-- Codex: default keybindings (Star Citizen action profile)
-- ----------------------------------------------------------------------------
-- The complete default keybindings extracted from Data/Libs/Config/
-- defaultProfile.xml — every actionmap (category) and action, with its default
-- binding per input device. Read-only for clients (anon + authenticated read,
-- service-role writes), same as the rest of the Codex catalog (public since
-- #131).
--
-- Labels are stored as raw global.ini @-keys (label_key / description_key /
-- category_label_key). They resolve to any language via the existing
-- codex_locale_strings table (which already holds the COMPLETE per-language
-- tables) + CodexService.resolveLocaleKeys — so "including all translations"
-- needs no denormalized copies here.
--
-- Additive migration — no legacy tables dropped.
-- ============================================================================

create table public.codex_keybinds (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds (id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  actionmap text not null,                -- action group / category name
  action_name text not null,              -- action key (unique within actionmap)
  label_key text,                         -- @-key for the action's UILabel
  description_key text,                   -- @-key for the action's UIDescription
  category_label_key text,                -- @-key for the actionmap's UILabel
  activation_mode text,                   -- press / hold / delayed_press / ...
  binding_keyboard text,                  -- default binding per device (null = unbound)
  binding_mouse text,
  binding_gamepad text,
  binding_joystick text,
  payload jsonb not null,                 -- full action record (future-proof)
  sort int not null default 0,            -- stable display order (document order)
  created_at timestamptz not null default now(),
  constraint codex_keybinds_natkey
    unique (channel, patch_version, build_number, actionmap, action_name)
);
comment on table public.codex_keybinds is
  'Complete default keybindings per build, from Data/Libs/Config/defaultProfile.xml. Labels are @-keys resolved via codex_locale_strings.';

create index codex_keybinds_build_idx
  on public.codex_keybinds (build_id, actionmap, sort);

-- RLS: anon + authenticated read, service-role write (mirrors codex_* catalog) --
alter table public.codex_keybinds enable row level security;

create policy codex_keybinds_authenticated_read on public.codex_keybinds
  for select to authenticated using (true);
create policy codex_keybinds_anon_read on public.codex_keybinds
  for select to anon using (true);

grant select on public.codex_keybinds to anon;
revoke insert, update, delete, truncate on public.codex_keybinds
  from authenticated, anon;
