/**
 * Fixed order of the ingest-catalog publish phases — the single source both
 * consumers share:
 *
 *  - `catalog-bridge.ts` emits `phaseIndex`/`phaseTotal` off it so the live
 *    upload can draw a two-tier "step N / M" bar, and
 *  - `upload-job.ts` `resumeSummary` turns a stored cursor phase into the SAME
 *    1-based step number for the resume banner.
 *
 * Keeping it in one place is what stops the "step 3 / 15" the live upload shows
 * and the "Catalog step 3 / 15" a resume banner shows from ever drifting apart.
 *
 * Pure data — no imports — so both the main-process bridge and the DOM-only
 * renderer can pull it in without dragging Node or Electron along.
 */

export const CATALOG_PHASE_ORDER = [
  'init',
  'codex_manufacturers',
  'codex_ships',
  'codex_weapons',
  'codex_components',
  'codex_items',
  'codex_ammunition',
  'codex_blueprints',
  'codex_blueprint_ingredients',
  'codex_entity_strings',
  'codex_item_ports',
  'codex_locale_strings',
  'codex_previews',
  'codex_keybinds',
  'finalize',
] as const;

export type CatalogPhase = (typeof CATALOG_PHASE_ORDER)[number];

/** How many publish steps the catalog stage reports — the "/ M" a bar shows. */
export const CATALOG_PHASE_TOTAL = CATALOG_PHASE_ORDER.length;

/**
 * 1-based position of `phase` in the publish order, or null for an unknown
 * label. 1-based because it is shown to humans ("step 3 / 15"), never used to
 * index the array.
 */
export function catalogPhaseIndex(phase: string): number | null {
  const i = (CATALOG_PHASE_ORDER as readonly string[]).indexOf(phase);
  return i === -1 ? null : i + 1;
}

/**
 * The next phase a resume would actually send: the first data phase (past
 * `init`, before `finalize`) not yet in `donePhases`. Returns null once every
 * data phase is done and only `finalize` remains. `donePhases` accumulate
 * strictly in order, so a linear scan is correct.
 */
export function nextCatalogPhase(donePhases: readonly string[]): CatalogPhase | null {
  const done = new Set(donePhases);
  for (const phase of CATALOG_PHASE_ORDER) {
    if (phase === 'init' || phase === 'finalize') continue;
    if (!done.has(phase)) return phase;
  }
  return null;
}
