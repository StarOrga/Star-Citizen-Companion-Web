# Web Hangar Redesign — Codex becomes a personal hub

> **Status:** implemented in this branch (autonomous run 2026-06-13).
> Builds on the Wave-1/2/3 codex catalog (migrations 00008–20260530) and the
> 3D ship-skin pipeline (20260603). Inspiration: erkul.games loadout planner.

## Vision

The Codex stays the read-only encyclopedia. On top of it, **"My Hangar"**
turns the app into a personal tool: your ships, your configurations, your
role loadouts — all referencing the immutable catalog by `class_name`.

## Use cases

| # | Use case | Backed by |
|---|----------|-----------|
| U1 | **Hangar dashboard** — my ships (owned/wishlist), custom names, top-3 flagships pinned with hero cards (3D/preview, quick stats) | `hangar_ships` + codex_ships + ship_skins |
| U2 | **Ship configurator** — per hangar ship, per hardpoint: swap components/weapons (compatible-item resolver), save named configs per role (combat/mining/salvage/…), one active config per ship | `hangar_ship_configs` + codex_item_ports + `codex_compatible_items` RPC |
| U3 | **Aggregate loadout stats** — shield pool, weapon loadout summary, quantum-drive figures, computed client-side from component payloads | `loadout-stats.ts` (pure functions over ComponentPayload.stats) |
| U4 | **Role loadouts** — personal FPS / mining / salvage equipment sets independent of ships (FPS weapons, armor, tools) | `hangar_role_loadouts` + codex_weapons (`weapon_class='FPS'`) + codex_items |
| U5 | **Quick search** — global Ctrl+K / "/" overlay: fuzzy search ships/components/weapons across the catalog, stat chips inline, jump to codex detail or add ship to hangar | trigram ilike across codex tables |
| U6 | **3D models in the hangar** — hangar ship detail reuses the model-viewer skin pipeline; per-ship selected skin persisted | `hangar_ships.selected_skin_id` + ship_skins |
| U7 | **Patch resilience** — configs reference `class_name` (stable slug); on a new current build the catalog rows swap underneath, configs re-resolve | natural-key design of codex_* |

## Schema (migration `20260613000000_hangar.sql`)

Three user-owned tables, RLS self-only (`auth.uid() = user_id`), additive:

- `hangar_ships` — (user_id, ship_class_name) unique; status `owned|wishlist`;
  `pinned_rank 1..3` (partial unique per user) drives the top-3 dashboard;
  `selected_skin_id` soft-FK to ship_skins.
- `hangar_ship_configs` — N per hangar ship; `role` enum-ish check; `loadout`
  JSONB `[{portName, className, kind}]`; partial unique "one active per ship".
- `hangar_role_loadouts` — role `fps|mining|salvage|medical|engineering`;
  `items` JSONB `[{slot, className, kind}]`.

Soft FKs to codex (`class_name` strings) by design — catalog rows are
build-scoped and replaceable; user data must survive build swaps.

## Frontend

- `/hangar` — `HangarDashboardComponent`: pinned hero strip, ship grid,
  role-loadout cards, add-ship via quick search.
- `/hangar/ship/:id` — `HangarShipDetailComponent`: ship header (3D skin
  viewer), config tabs, hardpoint editor with per-port component picker
  (`codex_compatible_items`), aggregate stats panel.
- `/hangar/loadout/:id` — `RoleLoadoutEditorComponent`: slot-based FPS/
  mining/salvage equipment editor.
- Shell: nav link + global `QuickSearchComponent` (Ctrl+K).
- Codex detail/list: "Add to hangar" action on ships.
- All strings via ngx-translate, keys in all 7 locale files.

## Uploader extension (languages + original English)

- `localization.py`: **dynamic language discovery** — scan the P4K
  `Data/Localization/<folder>/global.ini` entries instead of the hardcoded
  en/de map; folder→code mapping with graceful fallback slugs.
- English stays the canonical original (`en` always loaded first; payload
  contract `{de, en, key}` unchanged for compatibility).
- `dump_localization()` writes every discovered language as
  `localization/<code>.json`; manifest gains `languages: [..]` +
  per-language string counts so the ingest path can store additional
  languages in `codex_locale_strings` (column is `text`, no migration needed).

## Explicitly out of scope (this run)

- Flight stats (still null in extractor — vehicleDefinition resolution is a
  separate research task).
- Full-catalog reseed (cloud holds a representative subset; UI handles
  sparse compatible-item results gracefully).
- Loadout sharing/public links, power/heat budget simulation (v2 candidates).
