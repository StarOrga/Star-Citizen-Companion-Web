// Per-object incremental upload (migration 20261102000000_codex_carry_over).
// The uploader hashes every row without its build coordinates and build stamp
// and asks `carry` which rows the server can copy from an earlier build; only
// the `missing` ones are then sent in full. Pure validation + error
// classification — unit tested in _carry.test.mjs.

/** Tables codex_carry_over() knows (codex_carry_spec in the migration). */
export const CARRY_TABLES = new Set([
  'codex_manufacturers', 'codex_ships', 'codex_weapons',
  'codex_components', 'codex_items', 'codex_ammunition',
  'codex_blueprints', 'codex_entity_strings', 'codex_silhouettes',
]);

/** Tables `prune` may trim to a key list (replaces clear_silhouettes). */
export const PRUNE_TABLES = new Set(['codex_silhouettes']);

/** Key width per table: class_name | kind+class_name | class+lang+field. */
const KEY_WIDTH: Record<string, number> = {
  codex_silhouettes: 2,
  codex_entity_strings: 3,
};

/** Volatile stamp paths codex_carry_over() re-stamps on a copy. */
const SET_PATHS: Record<string, string> = {
  codex_silhouettes: 'meta.source',
  codex_entity_strings: '',
};

/** One request batch stays well inside a statement budget. */
export const MAX_CARRY_ROWS = 2000;
export const MAX_PRUNE_KEYS = 50_000;

const SHA_RE = /^[0-9a-f]{64}$/;

export interface CarryRow {
  k: string[];
  h: string;
}

function keyWidth(table: string): number {
  return KEY_WIDTH[table] ?? 1;
}

function validKey(k: unknown, width: number): k is string[] {
  return Array.isArray(k) && k.length === width &&
    k.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 512);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** Validates a `carry` body: table, rows [{k, h}], optional stamp `set`. */
export function parseCarry(body: Record<string, unknown>): Parsed<{
  table: string;
  rows: CarryRow[];
  set: Record<string, unknown>;
}> {
  const table = String(body.table ?? '');
  if (!CARRY_TABLES.has(table)) return { ok: false, message: 'bad table' };
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, message: 'rows required' };
  if (rows.length > MAX_CARRY_ROWS) return { ok: false, message: `at most ${MAX_CARRY_ROWS} rows` };
  const width = keyWidth(table);
  for (const r of rows) {
    const row = r as { k?: unknown; h?: unknown };
    if (!row || !validKey(row.k, width) || typeof row.h !== 'string' || !SHA_RE.test(row.h)) {
      return { ok: false, message: 'rows must be {k: string[], h: sha256 hex}' };
    }
  }
  const raw = body.set ?? {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'set must be an object' };
  // Only the table's own stamp path may be set; anything else is dropped.
  const path = SET_PATHS[table] ?? 'payload.source';
  const set: Record<string, unknown> = {};
  if (path && Object.prototype.hasOwnProperty.call(raw, path)) set[path] = (raw as Record<string, unknown>)[path];
  return { ok: true, value: { table, rows: (rows as CarryRow[]).map((r) => ({ k: r.k, h: r.h })), set } };
}

/** Validates a `prune` body: table + the complete key list of the build. */
export function parsePrune(body: Record<string, unknown>): Parsed<{ table: string; keys: string[][] }> {
  const table = String(body.table ?? '');
  if (!PRUNE_TABLES.has(table)) return { ok: false, message: 'bad table' };
  const keys = body.keys;
  // An empty list would delete the whole build's rows — never a valid prune.
  if (!Array.isArray(keys) || keys.length === 0) return { ok: false, message: 'keys required' };
  if (keys.length > MAX_PRUNE_KEYS) return { ok: false, message: `at most ${MAX_PRUNE_KEYS} keys` };
  const width = keyWidth(table);
  if (!keys.every((k) => validKey(k, width))) return { ok: false, message: 'keys must be string[]' };
  return { ok: true, value: { table, keys: keys as string[][] } };
}

/**
 * True when the project lacks the migration (RPC or content_sha column not
 * there yet): the op degrades and the uploader falls back to full rows.
 */
export function isCarryUnavailable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  const code = e?.code ?? '';
  const msg = (e?.message ?? '').toLowerCase();
  if (code === 'PGRST202' || code === '42883') return true; // function missing
  if (code === '42703' && msg.includes('content_sha')) return true; // column missing
  return (msg.includes('codex_carry_over') || msg.includes('codex_prune_build')) &&
    (msg.includes('could not find') || msg.includes('does not exist'));
}
