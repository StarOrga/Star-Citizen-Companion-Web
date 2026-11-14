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

/**
 * Ops that empty a table of the build. A delete fires no insert/update touch
 * trigger (and on an empty staging build deletes nothing at all), so the op
 * marks the table itself: a run that clears a table means it, the predecessor's
 * rows must not be copied back in at finalize.
 */
export const CLEAR_OP_TABLES: Readonly<Record<string, string>> = {
  clear_ports: 'codex_item_ports',
  clear_ingredients: 'codex_blueprint_ingredients',
  clear_silhouettes: 'codex_silhouettes_rows',
  silhouette_skips: 'codex_silhouette_skips',
};

/** The staging table of the R2 locale strings; untouched = copy the predecessor's R2 prefix. */
export const LOCALE_TABLE = 'codex_locale_strings';

/**
 * True when an `init` insert failed on the pre-20261114120000 unique
 * constraint over the coordinates: the project still has the old schema, the
 * caller falls back to the old natural-key upsert.
 */
export function isLegacyNatkeyConflict(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string } | null;
  return e?.code === '23505' && `${e?.message ?? ''} ${e?.details ?? ''}`.includes('codex_builds_channel_patch_build_key');
}

export interface RebuildDeps {
  /** The published build this one replaces, or null. Throws when the RPC is missing. */
  predecessor(buildId: string): Promise<string | null>;
  /** Tables the run (or an earlier clone) already wrote for this build. */
  touched(buildId: string): Promise<Set<string>>;
  /** Copies the next chunk of one table from the predecessor. */
  clone(buildId: string, table: string): Promise<{ copied: number; done: boolean }>;
}

export interface RebuildPlan {
  predecessor: string | null;
  /** Rows copied per table by this call (0 = table was uploaded or already copied). */
  cloned: Record<string, number>;
  /** The run sent no locale strings: the predecessor's R2 strings must follow. */
  copyLocaleFrom: string | null;
}

/** Upper bound of chunk calls per table (items: ~11 chunks of 2 000). */
export const MAX_CLONE_CALLS = 200;

/**
 * Before the switch: fill every table the run skipped from the predecessor.
 * Chunked, because every RPC runs under the authenticator's 8 s statement
 * timeout and items alone took 24 s in the 2026-11-14 dry run. Idempotent: a
 * retried finalize resumes where the copy stopped and copies nothing twice.
 */
export async function prepareRebuild(deps: RebuildDeps, buildId: string): Promise<RebuildPlan> {
  const predecessor = await deps.predecessor(buildId);
  const plan: RebuildPlan = { predecessor, cloned: {}, copyLocaleFrom: null };
  if (!predecessor) return plan;
  const touched = await deps.touched(buildId);
  for (const table of CLONE_TABLES) {
    if (touched.has(table)) continue;
    let copied = 0;
    for (let call = 0; ; call++) {
      if (call >= MAX_CLONE_CALLS) throw new Error(`clone of ${table} did not finish in ${MAX_CLONE_CALLS} calls`);
      const r = await deps.clone(buildId, table);
      copied += r.copied;
      if (r.done) break;
    }
    plan.cloned[table] = copied;
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
  if (m) return { status: 409, code: m[1] };
  // A parallel finalize of the same game build was published first.
  if (msg.includes('codex_builds_natkey_published')) return { status: 409, code: 'codex_build_superseded' };
  return null;
}
