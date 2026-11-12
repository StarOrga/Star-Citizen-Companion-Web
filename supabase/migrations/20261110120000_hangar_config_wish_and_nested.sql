-- Holotisch-Feinschliff, implement brief 2 (concept 20261109-1745), D1 + D2.
--
-- D1 - a wish can carry a loadout ("Auf die Wunschliste" from a swapped Werk keeps the swaps).
--
--   hangar_ship_configs.is_wish   true = this saved loadout is a WISH for the hull, not an own exemplar.
--                                 It hangs off the hull's hangar_ships row like every config: the
--                                 status = 'wishlist' row of a ship the reader does not own yet, or the
--                                 owned row when the wish is one more copy (that wish's qty lives in
--                                 search_wishlist, 20261108130000). A ship row can carry several wishes,
--                                 each with its own loadout. The Holotisch hangar menu lists them under
--                                 "Wunschliste" with their part count and opens one like an exemplar (?v=).
--                                 Wish configs are created with is_active = false and never become the
--                                 ship's active config through this path.
--
-- D2 - nested ports (a gun inside a gimbal) are saveable. NO schema change for that: the loadout column
--   is jsonb [{portName, className, kind}] without a constraint on its elements. A nested entry stores the
--   full dotted draft path as portName ("hardpoint_weapon_left.hardpoint_class_2"). Older readers match
--   portName against top-level ports only, never find the dotted one and skip it, so every existing row and
--   every older client stays valid. Documented here so the format has one place of record.
--
-- Purely additive, nothing dropped. Existing rows get is_wish = false (= what they are today). RLS policies
-- of hangar_ship_configs are column-agnostic (owner-only, 20260613000000), so nothing changes there.
-- The social area (20261105120000) only reaches a config through an explicit share (config_id), so a
-- wish is never shown to a friend unless its owner shares it.
--
-- DEPLOY: apply with `npm run db:push`, then `notify pgrst, 'reload schema'` (new column). The client
-- degrades while the column is missing: a wish is then saved hull-only, as before, and the menu says the
-- loadout could not be kept (HangarService.createWishConfig detects 42703 / PGRST204).

alter table public.hangar_ship_configs
  add column if not exists is_wish boolean not null default false;

comment on column public.hangar_ship_configs.is_wish is
  'True = a wished loadout for this hull (Wunschliste), not an own exemplar. Never the active config.';

comment on column public.hangar_ship_configs.loadout is
  'Port -> item assignments: [{portName, className, kind}]. portName is a top-level port, or the dotted path of a nested port (parent.child) for a part inside a carried item.';

notify pgrst, 'reload schema';
