// Holotable silhouette — pure validation + typed contract for one
// `codex_silhouettes` row (wave0-research.md §C1). NEVER derives or fixes up
// a silhouette client-side: a row that fails validation is treated exactly
// like a missing one (§C3 "neutral placeholder"), never patched or guessed.

/** The kinds the uploader can emit a silhouette for (DB check constraint). */
export type SilhouetteKind = 'ship' | 'weapon' | 'component' | 'item' | 'armor';

export const SILHOUETTE_KINDS: readonly SilhouetteKind[] = [
  'ship',
  'weapon',
  'component',
  'item',
  'armor',
];

export function isSilhouetteKind(v: unknown): v is SilhouetteKind {
  return typeof v === 'string' && (SILHOUETTE_KINDS as readonly string[]).includes(v);
}

export interface SilhouetteBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One hardpoint pin, positioned as a % of the silhouette's viewBox. Ships only. */
export interface SilhouetteAnchor {
  portId: string;
  /** 0..100, % of the viewBox width. */
  x: number;
  /** 0..100, % of the viewBox height. */
  y: number;
  side: string | null;
  depth: number | null;
  source: string | null;
  helper: string | null;
  clamped: boolean;
}

export interface SilhouetteSource {
  hullCga: string | null;
  method: string | null;
  modelSpace: string | null;
  frame: { min: readonly [number, number, number]; max: readonly [number, number, number]; source: string } | null;
}

export interface HoloSilhouette {
  schema: number;
  kind: SilhouetteKind;
  classNameSlug: string;
  build: { channel: string; patchVersion: string; buildNumber: string };
  generatedAt: string | null;
  toolVersion: string | null;
  source: SilhouetteSource | null;
  viewBox: string;
  path: string;
  bbox: SilhouetteBbox;
  scaleMPerUnit: number | null;
  anchors: readonly SilhouetteAnchor[];
  unresolved: readonly string[];
}

// A malformed/corrupt path could otherwise bloat the payload without bound —
// cap it generously above any real traced-contour path we have seen.
const MAX_PATH_LENGTH = 200_000;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function parseBbox(raw: unknown): SilhouetteBbox | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const { x, y, w, h } = b;
  if (![x, y, w, h].every(isFiniteNumber)) return null;
  return { x: x as number, y: y as number, w: w as number, h: h as number };
}

function parseFrameVec(raw: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const [x, y, z] = raw;
  return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z) ? [x, y, z] : null;
}

function parseSource(meta: Record<string, unknown>): SilhouetteSource | null {
  const raw = meta['source'];
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const frameRaw = s['frame'];
  let frame: SilhouetteSource['frame'] = null;
  if (frameRaw && typeof frameRaw === 'object') {
    const f = frameRaw as Record<string, unknown>;
    const min = parseFrameVec(f['min']);
    const max = parseFrameVec(f['max']);
    if (min && max) frame = { min, max, source: asString(f['source']) ?? '' };
  }
  return {
    hullCga: asString(s['hullCga']),
    method: asString(s['method']),
    modelSpace: asString(s['modelSpace']),
    frame,
  };
}

/** One anchor row; `null` when the entry does not carry a usable portId + a
 * finite, in-bounds (0..100%) position — dropped rather than clamped here,
 * because the uploader already reports out-of-range clamps via `clamped`. */
function parseAnchor(raw: unknown): SilhouetteAnchor | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const portId = asString(a['portId']);
  const x = a['x'];
  const y = a['y'];
  if (!portId || !isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;
  return {
    portId,
    x,
    y,
    side: asString(a['side']),
    depth: isFiniteNumber(a['depth']) ? (a['depth'] as number) : null,
    source: asString(a['source']),
    helper: asString(a['helper']),
    clamped: a['clamped'] === true,
  };
}

/**
 * Validate + narrow one `codex_silhouettes` row (as returned by a Supabase
 * `select('*')`-shaped query) into the typed contract. Returns `null` for
 * anything that does not satisfy the contract's hard invariants (finite
 * numbers, a non-empty path under the size cap, a usable bbox) — the caller
 * renders the §C3 neutral placeholder for a `null`, exactly like a missing row.
 */
export function parseHoloSilhouette(row: Record<string, unknown> | null | undefined): HoloSilhouette | null {
  if (!row) return null;

  const path = row['path'];
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) return null;

  const viewBox = row['view_box'];
  if (typeof viewBox !== 'string' || viewBox.length === 0) return null;

  const bbox = parseBbox(row['bbox']);
  if (!bbox) return null;

  // wave 1.5 fix (redteam note): an unknown kind is a row this parser does
  // not understand, not a ship — mapping it to 'ship' would render a random
  // entity's outline as if it were the hull. Treat it exactly like every
  // other invalid row: null, same §C3 neutral placeholder.
  const kindRaw = row['kind'];
  if (!isSilhouetteKind(kindRaw)) return null;
  const kind: SilhouetteKind = kindRaw;

  const classNameSlug = asString(row['class_name']) ?? '';
  if (!classNameSlug) return null;

  const anchorsRaw = Array.isArray(row['anchors']) ? row['anchors'] : [];
  const anchors = anchorsRaw
    .map(parseAnchor)
    .filter((a): a is SilhouetteAnchor => a !== null);

  const unresolvedRaw = Array.isArray(row['unresolved']) ? row['unresolved'] : [];
  const unresolved = unresolvedRaw.filter((u): u is string => typeof u === 'string');

  const meta = row['meta'] && typeof row['meta'] === 'object' ? (row['meta'] as Record<string, unknown>) : {};

  return {
    schema: isFiniteNumber(meta['schema']) ? (meta['schema'] as number) : 1,
    kind,
    classNameSlug,
    build: {
      channel: asString(row['channel']) ?? '',
      patchVersion: asString(row['patch_version']) ?? '',
      buildNumber: asString(row['build_number']) ?? '',
    },
    generatedAt: asString(row['generated_at']),
    toolVersion: asString(meta['toolVersion']),
    source: parseSource(meta),
    viewBox,
    path,
    bbox,
    scaleMPerUnit: isFiniteNumber(meta['scaleMPerUnit']) ? (meta['scaleMPerUnit'] as number) : null,
    anchors,
    unresolved,
  };
}
