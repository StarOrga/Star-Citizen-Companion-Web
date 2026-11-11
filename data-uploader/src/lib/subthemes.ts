/**
 * Subthemes — the units a run can skip when the server already holds them.
 *
 * A subtheme is skipped when the server's ledger (`uploader_subtheme_uploads`)
 * already has it for the SAME channel + patch + build AND the revision it was
 * produced with equals this uploader's revision for it. A new game build, or an
 * uploader whose logic for that subtheme changed (revision bumped), uploads it
 * again; everything else is left alone.
 *
 * The revisions are bumped by hand whenever a change alters what a subtheme
 * puts on the server. `scripts/check-subtheme-revisions.mjs` (CI) refuses a
 * branch that touches a subtheme's `sources` without bumping its revision or
 * acknowledging it with a `Subtheme-Unchanged: <key>, …` commit trailer — so a
 * forgotten bump cannot silently freeze stale data on the server.
 *
 * Granularity follows the uploader's category bars (Texte · Schiffe ·
 * Komponenten · Waffen · Gegenstände), plus the catalog tables without a bar,
 * the silhouettes and the 3D hulls. The five bars share ONE extraction, so a
 * single pending catalog subtheme still extracts in full — what it saves is the
 * upload of the unchanged ones, and the silhouette / hull builds. Only when
 * nothing is pending does the run skip the extraction too.
 *
 * Pure data + pure functions — no Node, no Electron — so the renderer, the main
 * process and the CI script share one definition.
 */

import type { CatalogPhase } from './catalog-phases.js';

export type SubthemeKey =
  | 'strings'
  | 'ships'
  | 'components'
  | 'weapons'
  | 'items'
  | 'codex_extra'
  | 'silhouettes'
  | 'hulls';

export interface Subtheme {
  key: SubthemeKey;
  /** Bump when a change alters what this subtheme uploads. Positive integer. */
  revision: number;
  /** Catalog publish phases this subtheme owns (empty for the non-catalog stages). */
  phases: readonly CatalogPhase[];
  /**
   * Repo-relative path prefixes (from the repository root) whose changes can
   * alter this subtheme's output — read by the CI revision guard only.
   */
  sources: readonly string[];
}

/** Files every catalog subtheme depends on: the extractor core and the catalog mapper. */
const CATALOG_SHARED = [
  'data-uploader/python/sc_extract/extract.py',
  'data-uploader/python/sc_extract/dataforge.py',
  'data-uploader/python/sc_extract/dataforge_extract.py',
  'data-uploader/python/sc_extract/datacore_schema.json',
  'data-uploader/python/sc_extract/p4k_compat.py',
  'data-uploader/python/sc_extract/parallel_dump.py',
  'data-uploader/src/main/catalog-bridge.ts',
  'data-uploader/src/lib/catalog-map.ts',
  'supabase/functions/ingest-catalog/',
] as const;

export const SUBTHEMES: readonly Subtheme[] = [
  {
    key: 'strings',
    // 2: E14 — the English table gains the `scc_room_*` room labels
    // (ship_rooms.py), the translation pipeline's input for room names.
    revision: 2,
    phases: ['codex_locale_strings'],
    sources: [
      ...CATALOG_SHARED,
      'data-uploader/python/sc_extract/localization.py',
      'data-uploader/python/sc_extract/ship_rooms.py',
    ],
  },
  {
    key: 'ships',
    // 2: #643 — LIVE 4.x hull node names readable again, so
    // payload.hardpointTransforms / hardpointFrame are no longer empty.
    // 3: #796 — payload.decks (ordered deck list from the ship_setup
    // interior-map sections).
    // 4: #795 — payload.itemPorts gains the turret/weapon ports of the vehicle
    // XML; turrets without a ship-side fit (PDCs) carry their own stock gun.
    // 5: #794 — hardpointTransforms apply the port's helper offset; a port
    // that only matches the hull origin gets no position.
    // 6: #795 — a turret the ship loadout fits only in part keeps the stock
    // items of its other ports.
    // 7: #797 — payload.decks[].rooms + .bounds (room floor footprints from
    // the ship object containers) for the 2D deck plan.
    // 8: #797 — a single-deck ship takes its rooms without an
    // interiorMapSection (Prospector).
    // 9: #797 — rooms no deck takes land on one extra `fallback` deck
    // ("All rooms" / "Other rooms"); ships without decks get just that one.
    // 10: #842 — cargoScu / cargoStatus follow a cargo item's own stock fit
    // and count ore pods; no hull is "unmeasured" for a missing grid anymore.
    // 11: payload.sizeClass (S1-S6 from the vehicle's AttachDef.Size) for the
    // Codex index size filter.
    // 12: rooms without an interiorMapSection on a multi-deck ship take the
    // deck of the authored rooms on their floor level, this hull's and its
    // family's (Starlancer MAX from the TAC) — fewer rooms on "Other rooms".
    // 13: E14 — rooms carry `locKey` (the game's loc key) and, without a
    // German string, `labelKey` (`scc_room_*`, translated by the pipeline).
    revision: 13,
    phases: ['codex_ships'],
    sources: [
      ...CATALOG_SHARED,
      'data-uploader/python/sc_extract/geometry.py',
      'data-uploader/python/sc_extract/ship_decks.py',
      'data-uploader/python/sc_extract/ship_discovery.py',
      'data-uploader/python/sc_extract/ship_rooms.py',
      'data-uploader/python/sc_extract/thresholds.py',
    ],
  },
  // components 4 / items 4: #842 — ship radars move from codex_items to
  // codex_components (kind Radar) with flat range / sensitivity keys.
  { key: 'components', revision: 4, phases: ['codex_components'], sources: CATALOG_SHARED },
  // weapons 4: #343 — weaponParams gains regen.* / heat.* (sustained DPS).
  { key: 'weapons', revision: 4, phases: ['codex_weapons', 'codex_ammunition'], sources: CATALOG_SHARED },
  // items 5: missiles carry stats.SCItemMissileParams (feedback e7b6a2a1).
  { key: 'items', revision: 5, phases: ['codex_items'], sources: CATALOG_SHARED },
  {
    key: 'codex_extra',
    // 2: #643 — codex_item_ports.helper_name / position / rotation resolve on
    // LIVE 4.x again (hull node names from the node chunk's string table).
    // 3: #795 — codex_item_ports gains the turret/weapon ports declared only in
    // the vehicle implementation XML.
    // 4: #794 — codex_item_ports.position applies the helper offset; ports on
    // the hull origin carry no position.
    // 5: codex_missions — released contracts for the global search.
    // 6: codex_blueprints.payload.missionSource + codex_missions gains the
    //    career/list contracts that award a blueprint (blueprint_sources.py).
    // 7: codex_blueprints gains dismantle_yield / dismantlable (HQ Bestand, #1058).
    revision: 7,
    phases: [
      'codex_manufacturers',
      'codex_blueprints',
      'codex_blueprint_ingredients',
      'codex_missions',
      'codex_entity_strings',
      'codex_item_ports',
      'codex_previews',
      'codex_keybinds',
    ],
    sources: [
      ...CATALOG_SHARED,
      'data-uploader/python/sc_extract/geometry.py',
      'data-uploader/python/sc_extract/hardpoints.py',
      'data-uploader/python/sc_extract/images.py',
      'data-uploader/python/sc_extract/blueprint_sources.py',
      'data-uploader/python/sc_extract/missions.py',
      'data-uploader/python/sc_extract/keybinds.py',
    ],
  },
  {
    key: 'silhouettes',
    // 2: #643 — ship silhouettes carry hardpoint anchors (were all empty).
    // 3: ship silhouettes carry the Verse-hub constellation (7 stars) + ground flag.
    // 4: …now from the uploader's own build too (silhouette_build_app never
    //    wrote them — only the CLI driver did; both share build_rows now).
    // 5: #795/#794 — anchors come from the corrected hardpointTransforms (turret
    //    ports from the vehicle XML, helper offsets, no origin anchors).
    // 6: silhouettes for every item (not only armor) and for ammunition.
    // 7: #842 — hulls whose LOD0 breaks cgf-converter get their LOD1 outline,
    //    and every skipped entity's reason goes up (silhouette_skips).
    // 8: meshes deep in the P4K no longer die on WinError 267, so a build
    //    already on the server gets their silhouettes. The recipe stays: every
    //    existing blob is byte-identical, only the missing ones are built.
    // 9: item outlines — largest view, relative tolerance, proxy nodes dropped,
    //    inner `edges` path (stored in meta.edges); every item blob is rebuilt.
    revision: 9,
    phases: ['codex_silhouettes'],
    sources: [
      'data-uploader/python/sc_extract/silhouette',
      'data-uploader/python/sc_extract/constellation.py',
      'data-uploader/src/main/silhouette-bridge.ts',
      'data-uploader/src/lib/silhouette-bridge-args.ts',
    ],
  },
  {
    key: 'hulls',
    // 2: ground-vehicle hulls and armor/clothing asset packages.
    // 3: blueprint drawings gain the `front` view (sc-blueprint/2). The cached
    // hull GLBs are reused; only the drawings are redrawn and re-committed.
    // 4: FPS weapons whose .cdf model is a mesh (none_*, P8-AR, Gallant and
    //    their variants) get packages. Cached parts are reused; only the 27
    //    missing bodies are built.
    // 5: the grin multitool body (material the converter cannot read) and
    //    packages that failed on an empty/duplicate placement id (Meteor
    //    Collector) now build. Cached parts are reused; only the missing
    //    ones are built.
    revision: 5,
    phases: [],
    sources: [
      'data-uploader/python/sc_extract/assets3d/',
      'data-uploader/python/sc_extract/hull3d.py',
      'data-uploader/python/sc_extract/gltf_worker',
      'data-uploader/python/sc_extract/geometry.py',
      'data-uploader/python/sc_extract/glb_materials.py',
      'data-uploader/python/sc_extract/mesh_integrity.py',
      'data-uploader/python/sc_extract/ship_export.py',
      'data-uploader/python/sc_extract/skin_export_app.py',
      'data-uploader/python/sc_extract/upload_skins.py',
      'data-uploader/src/main/skin-bridge.ts',
      'data-uploader/src/main/skin-ingest.ts',
      'data-uploader/src/main/asset-package-ingest.ts',
      'data-uploader/src/main/blueprint-ingest.ts',
      'data-uploader/src/lib/blueprint/',
      'data-uploader/src/lib/asset-package.ts',
      'supabase/functions/ingest-skins/',
    ],
  },
];

export const SUBTHEME_KEYS: readonly SubthemeKey[] = SUBTHEMES.map((s) => s.key);

/** The current revision of every subtheme, as the ledger stores it. */
export function currentRevisions(): Record<SubthemeKey, number> {
  return Object.fromEntries(SUBTHEMES.map((s) => [s.key, s.revision])) as Record<SubthemeKey, number>;
}

/** One ledger row as the server returns it. */
export interface LedgerEntry {
  subtheme: string;
  revision: number;
}

export interface SubthemePlanInput {
  /** Game build number of the local install; empty/null = unknown. */
  buildNumber: string | null | undefined;
  /** Ledger rows for this channel + patch + build; null = could not be read. */
  ledger: readonly LedgerEntry[] | null;
  /** "Alles neu erzwingen" — skip nothing. */
  force: boolean;
  /** Override for tests; defaults to `currentRevisions()`. */
  revisions?: Record<SubthemeKey, number>;
}

export type SubthemePlanReason = 'force' | 'unknown-build' | 'no-ledger' | 'ledger';

export interface SubthemePlan {
  /** Subthemes the server already holds at the current revision. */
  skip: SubthemeKey[];
  /** Subthemes this run extracts and uploads. */
  pending: SubthemeKey[];
  reason: SubthemePlanReason;
}

/**
 * Decide which subthemes a run can leave out. Conservative like `decideAutoRun`:
 * anything unprovable (no build number, unreadable ledger) skips nothing —
 * wrongly skipping leaves stale data on the server, wrongly running only costs time.
 */
export function planSubthemes(input: SubthemePlanInput): SubthemePlan {
  const all = [...SUBTHEME_KEYS];
  if (input.force) return { skip: [], pending: all, reason: 'force' };
  if (!input.buildNumber || !input.buildNumber.trim()) return { skip: [], pending: all, reason: 'unknown-build' };
  if (!input.ledger) return { skip: [], pending: all, reason: 'no-ledger' };
  const revisions = input.revisions ?? currentRevisions();
  const held = new Map<string, number>();
  for (const row of input.ledger) held.set(row.subtheme, row.revision);
  const skip: SubthemeKey[] = [];
  const pending: SubthemeKey[] = [];
  for (const key of all) {
    if (held.get(key) === revisions[key]) skip.push(key);
    else pending.push(key);
  }
  return { skip, pending, reason: 'ledger' };
}

/** Catalog phases owned by the given subthemes — what the catalog upload leaves out. */
export function phasesOf(keys: readonly SubthemeKey[]): CatalogPhase[] {
  const want = new Set(keys);
  return SUBTHEMES.filter((s) => want.has(s.key)).flatMap((s) => [...s.phases]);
}

/** Catalog subthemes — the ones a successful catalog upload records. */
export const CATALOG_SUBTHEMES: readonly SubthemeKey[] = SUBTHEMES.filter(
  (s) => s.phases.length > 0 && s.key !== 'silhouettes',
).map((s) => s.key);
