// Content-addressed 3D asset packages (ships, FPS weapons) — pure helpers.
//
// R2 key layout (all under the shared prefix `ship-skins/`, see _r2.ts):
//   _hulls/<sha>.glb       ship hull (existing hull flow, referenced by manifest root)
//   _parts/<sha>.glb       shared geometry-only part (also an FPS weapon's root)
//   _interiors/<sha>.glb   optional ship interior layer
//   _manifests/<sha>.json  the package manifest, sha256 of its exact bytes
//
// Every key is built here from a validated lowercase hex sha256 — the client
// never supplies a path. Keys starting with `_` can never be a ship folder
// (isReservedShipId), so the per-ship prune never touches them. Objects are
// final once written (content addressing), so sign answers `exists` and never
// hands out a second URL for the same bytes.
//
// Orphans: a replaced manifest leaves its old manifest + now-unreferenced parts
// behind. Nothing deletes them yet (see docs: asset_packages is the ref table —
// a GC pass would list `_parts/`, subtract every sha any current manifest
// names, and delete the rest). At ~1.3-2.9 MB per package that is cheap.

import { hullSha, sha256Hex } from './_hulls.ts';

export type PackageKind = 'ship' | 'fps_weapon';
export type PackageObjectType = 'part' | 'interior' | 'manifest' | 'hull';

export const PACKAGE_KINDS: readonly PackageKind[] = ['ship', 'fps_weapon'];
export const MIN_PACKAGE_TOOL_VERSION = [0, 41, 0];
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Upper bounds per kind. Parts are ~10-300 kB, interiors a few MB, manifests ~100 kB. */
export const MAX_BYTES: Record<PackageObjectType, number> = {
  part: 8 * 1024 * 1024,
  interior: 40 * 1024 * 1024,
  manifest: 2 * 1024 * 1024,
  hull: 20 * 1024 * 1024,
};
/** Objects per sign call; the uploader chunks to this. */
export const MAX_OBJECTS_PER_SIGN = 200;

const DIR: Record<PackageObjectType, string> = {
  part: '_parts/',
  interior: '_interiors/',
  manifest: '_manifests/',
  hull: '_hulls/',
};
const EXT: Record<PackageObjectType, string> = { part: 'glb', interior: 'glb', manifest: 'json', hull: 'glb' };

/** Class names are CIG identifiers: letters, digits, `_`, `-`. */
export const CLASS_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isPackageKind(v: unknown): v is PackageKind {
  return v === 'ship' || v === 'fps_weapon';
}

export function isPackageObjectType(v: unknown): v is PackageObjectType {
  return v === 'part' || v === 'interior' || v === 'manifest';
}

/** Path below `ship-skins/` for one content-addressed package object. */
export function packagePath(type: PackageObjectType, sha: string): string {
  return `${DIR[type]}${sha}.${EXT[type]}`;
}

export interface ObjectIn {
  type?: unknown;
  sha256?: unknown;
  bytes?: unknown;
}

export interface ObjectOk {
  type: PackageObjectType;
  sha: string;
  bytes: number;
  path: string;
}

/** Validates one sign request entry; returns a message instead of throwing. */
export function parseObject(o: ObjectIn): ObjectOk | string {
  if (!isPackageObjectType(o.type)) return 'object type must be part|interior|manifest';
  const sha = hullSha(o.sha256);
  if (!sha) return 'sha256 must be 64 lowercase hex chars';
  const bytes = o.bytes;
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) return 'bytes must be a positive integer';
  if (bytes > MAX_BYTES[o.type]) return `${o.type} over the ${MAX_BYTES[o.type]} byte limit`;
  return { type: o.type, sha, bytes, path: packagePath(o.type, sha) };
}

export interface ManifestRefs {
  schemaVersion: number;
  kind: PackageKind;
  entityClass: string;
  rootSha: string | null;
  rootBytes: number | null;
  interiorSha: string | null;
  interiorBytes: number | null;
  /** Every `_parts/` object the package needs (parts map, plus an fps root). */
  parts: { sha: string; bytes: number }[];
  partCount: number;
  /** Bytes of everything this entity pulls (root + interior + parts). */
  totalBytes: number;
}

/** Reads the refs a commit needs out of manifest JSON; string = reason it is unusable. */
export function parseManifest(json: unknown): ManifestRefs | string {
  if (!json || typeof json !== 'object') return 'manifest is not an object';
  const m = json as Record<string, unknown>;
  if (m.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return `unsupported schemaVersion ${String(m.schemaVersion)}`;
  if (!isPackageKind(m.kind)) return 'manifest kind must be ship|fps_weapon';
  const entity = m.entity as { className?: unknown } | undefined;
  const entityClass = typeof entity?.className === 'string' ? entity.className : '';
  if (!CLASS_NAME.test(entityClass)) return 'manifest entity.className is not a safe class name';

  const ref = (v: unknown): { sha: string; bytes: number } | null | string => {
    if (v == null) return null;
    const r = v as { sha256?: unknown; bytes?: unknown };
    const sha = hullSha(r.sha256);
    if (!sha) return 'a root/interior sha256 is malformed';
    const bytes = typeof r.bytes === 'number' && Number.isInteger(r.bytes) && r.bytes >= 0 ? r.bytes : -1;
    if (bytes < 0) return 'a root/interior bytes is malformed';
    return { sha, bytes };
  };
  const root = ref(m.root);
  if (typeof root === 'string') return root;
  const interior = ref(m.interior);
  if (typeof interior === 'string') return interior;

  const partsIn = m.parts;
  if (partsIn != null && (typeof partsIn !== 'object' || Array.isArray(partsIn))) return 'manifest parts must be an object';
  const parts: { sha: string; bytes: number }[] = [];
  for (const [k, v] of Object.entries((partsIn ?? {}) as Record<string, { bytes?: unknown }>)) {
    const sha = hullSha(k);
    const bytes = v?.bytes;
    if (!sha) return 'a parts key is not a sha256';
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) return `part ${sha} has no bytes`;
    if (bytes > MAX_BYTES.part) return `part ${sha} over the size limit`;
    parts.push({ sha, bytes });
  }
  // A weapon's root lives in _parts/ (ships' hulls live in _hulls/).
  if (m.kind === 'fps_weapon' && root && !parts.some((p) => p.sha === root.sha)) {
    parts.push({ sha: root.sha, bytes: root.bytes });
  }
  const partCount = parts.length;
  // A weapon's root is already one of `parts`; a ship's hull is counted here.
  const totalBytes =
    (m.kind === 'ship' ? (root?.bytes ?? 0) : 0) + (interior?.bytes ?? 0) + parts.reduce((a, p) => a + p.bytes, 0);
  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    kind: m.kind,
    entityClass,
    rootSha: root?.sha ?? null,
    rootBytes: root?.bytes ?? null,
    interiorSha: interior?.sha ?? null,
    interiorBytes: interior?.bytes ?? null,
    parts,
    partCount,
    totalBytes,
  };
}

export type ManifestCheck = { ok: true; refs: ManifestRefs } | { ok: false; error: string; message: string };

/** The manifest bytes must hash to the claimed sha, parse, and name the claimed entity. */
export async function checkManifestBytes(
  bytes: Uint8Array,
  expectedSha: string,
  kind: PackageKind,
  entityClass: string,
): Promise<ManifestCheck> {
  if (bytes.byteLength > MAX_BYTES.manifest) return { ok: false, error: 'manifest_too_large', message: String(bytes.byteLength) };
  if ((await sha256Hex(bytes)) !== expectedSha) return { ok: false, error: 'manifest_hash_mismatch', message: expectedSha };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, error: 'manifest_invalid', message: 'not JSON' };
  }
  const refs = parseManifest(parsed);
  if (typeof refs === 'string') return { ok: false, error: 'manifest_invalid', message: refs };
  if (refs.kind !== kind || refs.entityClass !== entityClass) {
    return { ok: false, error: 'manifest_mismatch', message: `manifest is ${refs.kind}/${refs.entityClass}` };
  }
  return { ok: true, refs };
}
