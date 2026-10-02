// Content-addressed hulls (shared across ship variants).
//
// Many ship variants carry a byte-identical hull glb (8x DRAK_Cutlass_Black_*,
// 5x ANVL_Valkyrie_*). Instead of one copy per variant under
// `<ship_id>/<skin_id>.glb`, an uploader that sends the glb's SHA-256 gets ONE
// object at `_hulls/<sha256>.glb`, and every variant's `ship_skins.model_path`
// points at it. Pure helpers only — index.ts does the I/O.
//
// Rules the helpers encode:
//  * `_hulls/` can never be a ship folder: ship ids starting with `_` are
//    refused, so the per-ship prune (`<ship_id>/` prefix) never lists it.
//  * A shared object is never overwritten: if it already exists, sign returns
//    `exists: true` and no URL — content addressing makes the bytes final.
//  * A shared object is deleted only when NO ship_skins row references it any
//    more (reference check across ships, after this commit's own rows are in).
//  * A hull no row references yet is read back on commit and its SHA-256
//    checked against the path (and a size bound); a failing object is deleted.
//  * Legacy per-ship paths keep working: a client without `sha256`, or a
//    function without R2, falls back to `<ship_id>/<skin_id>.glb`.

export const HULLS_DIR = '_hulls/';
const SHA256 = /^[0-9a-f]{64}$/;

/** A lowercase hex SHA-256, or null for anything else (absent, wrong length, uppercase). */
export function hullSha(value: unknown): string | null {
  return typeof value === 'string' && SHA256.test(value) ? value : null;
}

/** Ship ids that would collide with a shared-object directory. */
export function isReservedShipId(shipId: string): boolean {
  return shipId.startsWith('_');
}

export function hullPath(sha: string): string {
  return `${HULLS_DIR}${sha}.glb`;
}

export function isHullPath(path: unknown): path is string {
  return typeof path === 'string' && /^_hulls\/[0-9a-f]{64}\.glb$/.test(path);
}

/** Storage path for a ship's model: shared when hashed + R2, else per ship. */
export function modelPathFor(
  shipId: string,
  skinId: string,
  sha: string | null,
  shared: boolean,
): string {
  return shared && sha ? hullPath(sha) : `${shipId}/${skinId}.glb`;
}

/**
 * Shared hulls this commit stopped referencing for this ship. Each is only a
 * deletion CANDIDATE — the caller must still check that no other row
 * references it before deleting.
 */
export function droppedHulls(previous: (string | null)[], keep: Set<string>): string[] {
  return [...new Set(previous.filter(isHullPath))].filter((p) => !keep.has(p));
}

/** Largest shared hull commit will read back and hash (geometry hulls are ~0.6 MB). */
export const MAX_HULL_BYTES = 20 * 1024 * 1024;

/** Lowercase hex SHA-256 (WebCrypto — same in Deno and Node). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The sha256 a well-formed shared path names, else null. */
export function shaOfHullPath(path: string): string | null {
  return isHullPath(path) ? path.slice(HULLS_DIR.length, HULLS_DIR.length + 64) : null;
}

/**
 * A shared hull no ship_skins row references yet was uploaded by THIS upload
 * (an already-referenced one was verified when it was first committed), so it
 * is the one to read back and hash — and no other ship depends on it if it fails.
 */
export function needsVerification(path: string, referencingRows: number | null): boolean {
  return isHullPath(path) && referencingRows === 0;
}

export type HullCheck = 'ok' | 'too_large' | 'hash_mismatch';

/** Size first (an oversized object is never read), then content vs. the path's hash. */
export async function checkHull(
  path: string,
  size: number,
  read: () => Promise<Uint8Array>,
): Promise<HullCheck> {
  if (!(size >= 0) || size > MAX_HULL_BYTES) return 'too_large';
  const bytes = await read();
  if (bytes.byteLength > MAX_HULL_BYTES) return 'too_large';
  return (await sha256Hex(bytes)) === shaOfHullPath(path) ? 'ok' : 'hash_mismatch';
}
