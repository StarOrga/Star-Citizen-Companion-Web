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
    revision: 1,
    phases: ['codex_locale_strings'],
    sources: [...CATALOG_SHARED, 'data-uploader/python/sc_extract/localization.py'],
  },
  {
    key: 'ships',
    // 2: #643 — LIVE 4.x hull node names readable again, so
    // payload.hardpointTransforms / hardpointFrame are no longer empty.
    revision: 2,
    phases: ['codex_ships'],
    sources: [
      ...CATALOG_SHARED,
      'data-uploader/python/sc_extract/geometry.py',
      'data-uploader/python/sc_extract/ship_discovery.py',
      'data-uploader/python/sc_extract/thresholds.py',
    ],
  },
  { key: 'components', revision: 1, phases: ['codex_components'], sources: CATALOG_SHARED },
  { key: 'weapons', revision: 1, phases: ['codex_weapons', 'codex_ammunition'], sources: CATALOG_SHARED },
  { key: 'items', revision: 1, phases: ['codex_items'], sources: CATALOG_SHARED },
  {
    key: 'codex_extra',
    // 2: #643 — codex_item_ports.helper_name / position / rotation resolve on
    // LIVE 4.x again (hull node names from the node chunk's string table).
    revision: 2,
    phases: [
      'codex_manufacturers',
      'codex_blueprints',
      'codex_blueprint_ingredients',
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
      'data-uploader/python/sc_extract/keybinds.py',
    ],
  },
  {
    key: 'silhouettes',
    // 2: #643 — ship silhouettes carry hardpoint anchors (were all empty).
    // 3: ship silhouettes carry the Verse-hub constellation (7 stars) + ground flag.
    revision: 3,
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
    revision: 1,
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
