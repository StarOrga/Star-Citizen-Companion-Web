// Re-uploads of a published game build (migration 20261114120000_codex_atomic_rebuild).
//
// A second upload of the same channel/patch/build used to write into the live
// build in place: readers saw a mix of old and new rows while it ran, an
// aborted run left that mix behind, rows the new extract dropped stayed, and
// nothing keyed on the build id (derived tables, client caches) ever noticed.
// Now every upload gets its own staging row; `finalize` fills the tables the
// run skipped from the published predecessor, and set_current_codex_build
// switches atomically. This file holds the decisions, index.ts the wiring —
// unit tested in _rebuild.test.mjs.

/**
 * The build-scoped tables a staging build inherits when the run did not upload
 * them. Mirrors public.codex_clone_tables() — change both or neither.
 */
export const CLONE_TABLES: readonly string[] = [
  'codex_manufacturers_rows', 'codex_ships_rows', 'codex_weapons_rows', 'codex_components_rows',
  'codex_items_rows', 'codex_ammunition_rows', 'codex_blueprints_rows', 'codex_silhouettes_rows',
  'codex_item_ports', 'codex_blueprint_ingredients', 'codex_missions', 'codex_keybinds',
  'codex_silhouette_skips', 'codex_locations',
];

/** The staging table of the R2 locale strings; untouched = copy the predecessor's R2 prefix. */
export const LOCALE_TABLE = 'codex_locale_strings';

export interface BuildRowRef {
  id: string;
  finalized_at: string | null;
}

/**
 * What `init` does with the rows already holding these coordinates (newest
 * first, superseded ones already filtered out): resume the newest unfinished
 * staging row, or create a new one. A published row is never reused — writing
 * into it is exactly the in-place upload this file exists to stop.
 */
export function planInit(existing: readonly BuildRowRef[]): { action: 'reuse'; id: string } | { action: 'insert' } {
  const staging = existing.find((r) => !r.finalized_at);
  return staging ? { action: 'reuse', id: staging.id } : { action: 'insert' };
}

export interface RebuildDeps {
  /** The published build this one replaces, or null. Throws when the RPC is missing. */
  predecessor(buildId: string): Promise<string | null>;
  /** Tables the run (or an earlier clone) already wrote for this build. */
  touched(buildId: string): Promise<Set<string>>;
  /** Copies one table from the predecessor; returns the row count. */
  clone(buildId: string, table: string): Promise<number>;
}

export interface RebuildPlan {
  predecessor: string | null;
  /** Rows copied per table this call (0 = table was uploaded or already copied). */
  cloned: Record<string, number>;
  /** The run sent no locale strings: the predecessor's R2 strings must follow. */
  copyLocaleFrom: string | null;
}

/**
 * Before the switch: fill every table the run skipped from the predecessor.
 * One RPC per table keeps each statement short (items alone took 24 s in the
 * 2026-11-14 dry run). Idempotent — a retried finalize copies nothing twice.
 */
export async function prepareRebuild(deps: RebuildDeps, buildId: string): Promise<RebuildPlan> {
  const predecessor = await deps.predecessor(buildId);
  const plan: RebuildPlan = { predecessor, cloned: {}, copyLocaleFrom: null };
  if (!predecessor) return plan;
  const touched = await deps.touched(buildId);
  for (const table of CLONE_TABLES) {
    if (touched.has(table)) continue;
    plan.cloned[table] = await deps.clone(buildId, table);
  }
  if (!touched.has(LOCALE_TABLE)) plan.copyLocaleFrom = predecessor;
  return plan;
}

/** True when PostgREST/Postgres says the 20261114120000 objects are not there yet. */
export function isRebuildUnavailable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  const code = e?.code ?? '';
  const msg = (e?.message ?? '').toLowerCase();
  if (code === 'PGRST202' || code === '42883') return true; // function missing
  if (code === '42703' || code === 'PGRST204') return msg.includes('superseded'); // column missing
  if (code === '42P01' || code === 'PGRST205') return msg.includes('codex_build_touched');
  return false;
}

/**
 * The HTTP status for a refused switch: 409 = the build is not complete (or was
 * replaced meanwhile) — a retry of the same finalize cannot succeed, the
 * uploader has to upload again. Anything else is the caller's normal mapping.
 */
export function refusedSwitchStatus(error: unknown): { status: 409; code: string } | null {
  const msg = String((error as { message?: string } | null)?.message ?? '');
  const m = /\b(codex_build_incomplete|codex_build_superseded)\b/.exec(msg);
  return m ? { status: 409, code: m[1] } : null;
}
