/**
 * Per-object incremental codex upload — the uploader half of `ingest-catalog`
 * op `carry` (migration 20261102000000_codex_carry_over).
 *
 * Every row is hashed WITHOUT what differs between two builds of identical
 * content: its build coordinates and the extractor's build stamp
 * (`payload.source`; silhouettes `meta.source` + `generated_at`). The server
 * keeps rows already in the build with that hash, copies rows it finds with
 * that hash in an earlier build (re-stamped with this build's stamp) and
 * names the rest — only those are sent in full.
 *
 * The subtheme ledger (`subthemes.ts`) stays the outer gate: it decides
 * whether the catalog runs at all. This is the inner, per-object gate.
 *
 * Pure apart from sha256 — unit tested in test/catalog-carry.spec.ts.
 */

import { createHash } from 'node:crypto';

/** Columns that only say WHICH build a row belongs to. */
const BUILD_COLUMNS = ['build_id', 'channel', 'patch_version', 'build_number', 'content_sha'] as const;

interface CarrySpec {
  /** Columns that make up the row's natural key inside one build. */
  key: readonly string[];
  /** `column.key` the server re-stamps on a copy (excluded from the hash). */
  stamp: string | null;
  /** Further top-level columns left out of the hash (kept from the source row). */
  ignore: readonly string[];
}

const CATALOG: CarrySpec = { key: ['class_name'], stamp: 'payload.source', ignore: [] };

const SPECS: Record<string, CarrySpec> = {
  codex_manufacturers: CATALOG,
  codex_ships: CATALOG,
  codex_weapons: CATALOG,
  codex_components: CATALOG,
  codex_items: CATALOG,
  codex_ammunition: CATALOG,
  codex_blueprints: CATALOG,
  codex_entity_strings: { key: ['entity_class_name', 'lang', 'field'], stamp: null, ignore: [] },
  codex_silhouettes: { key: ['kind', 'class_name'], stamp: 'meta.source', ignore: ['generated_at'] },
};

/** Whether `table` takes part in the carry protocol. */
export function isCarryTable(table: string): boolean {
  return Object.prototype.hasOwnProperty.call(SPECS, table);
}

/** JSON with object keys sorted at every level — equal content, equal text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined || typeof v === 'function' ? 'null' : canonicalJson(v))).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    if (v === undefined || typeof v === 'function') continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(',')}}`;
}

function spec(table: string): CarrySpec {
  const s = SPECS[table];
  if (!s) throw new Error(`catalog-carry: ${table} is not carried`);
  return s;
}

type Row = Record<string, unknown>;

/** The row as it is hashed: no build coordinates, no build stamp. */
function hashable(table: string, row: Row): Row {
  const s = spec(table);
  const out: Row = { ...row };
  for (const c of BUILD_COLUMNS) delete out[c];
  for (const c of s.ignore) delete out[c];
  if (s.stamp) {
    const [col, key] = s.stamp.split('.') as [string, string];
    const inner = out[col];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const copy = { ...(inner as Row) };
      delete copy[key];
      out[col] = copy;
    }
  }
  return out;
}

/** sha256 (hex) of the row's build-independent content. */
export function contentSha(table: string, row: Row): string {
  return createHash('sha256').update(canonicalJson(hashable(table, row))).digest('hex');
}

/** The row's natural key, or null when a part is missing (such a row is always sent). */
export function carryKey(table: string, row: Row): string[] | null {
  const key = spec(table).key.map((c) => row[c]);
  return key.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 512) ? (key as string[]) : null;
}

/** `{ present, value }` of the row's build stamp; `present: false` when the row has none. */
function stampOf(table: string, row: Row): { present: boolean; value: unknown } {
  const path = spec(table).stamp;
  if (!path) return { present: false, value: undefined };
  const [col, key] = path.split('.') as [string, string];
  const inner = row[col];
  if (!inner || typeof inner !== 'object' || Array.isArray(inner) || !(key in (inner as Row))) {
    return { present: false, value: undefined };
  }
  return { present: true, value: (inner as Row)[key] };
}

export interface CarryPlan {
  /** What `carry` is asked about: key + hash per row. */
  carry: { k: string[]; h: string }[];
  /** Slice index of each `carry` entry (the server answers with indexes into `carry`). */
  carryIdx: number[];
  /** Slice indexes that are always sent in full (no key, or a stamp unlike the chunk's). */
  forced: number[];
  /** The stamp a copy gets — this chunk's own, absent when its rows carry none. */
  set: Record<string, unknown>;
  /** content_sha per slice index. */
  shas: string[];
}

/**
 * Splits one chunk into "ask the server" and "send anyway". A copy is stamped
 * with ONE value per request, so a row whose stamp differs from the chunk's
 * first row (never the case for a single extract) is simply sent.
 */
export function planCarry(table: string, slice: readonly Row[]): CarryPlan {
  const s = spec(table);
  const plan: CarryPlan = { carry: [], carryIdx: [], forced: [], set: {}, shas: [] };
  const rep = slice.length > 0 ? stampOf(table, slice[0]!) : { present: false, value: undefined };
  const repText = rep.present ? canonicalJson(rep.value) : null;
  if (s.stamp && rep.present) plan.set[s.stamp] = rep.value;
  slice.forEach((row, i) => {
    const h = contentSha(table, row);
    plan.shas.push(h);
    const k = carryKey(table, row);
    const st = stampOf(table, row);
    const sameStamp = st.present === rep.present && (!st.present || canonicalJson(st.value) === repText);
    if (!k || !sameStamp) {
      plan.forced.push(i);
      return;
    }
    plan.carry.push({ k, h });
    plan.carryIdx.push(i);
  });
  return plan;
}

/**
 * Slice indexes the server could not keep or copy: the `forced` rows plus the
 * `missing` answer (indexes into `plan.carry`), in slice order.
 */
export function rowsToSend(plan: CarryPlan, missing: readonly number[]): number[] {
  const out = new Set(plan.forced);
  for (const m of missing) {
    const idx = plan.carryIdx[m];
    if (idx !== undefined) out.add(idx);
  }
  return [...out].sort((a, b) => a - b);
}
