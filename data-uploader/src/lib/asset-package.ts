/**
 * Pure helpers for the 3D asset-package upload (docs/asset-package.md): which
 * objects a manifest needs in storage, which export folders are ships, and the
 * retry / concurrency primitives the transport uses. No I/O, no Electron.
 */

export type PackageKind = 'ship' | 'fps_weapon' | 'item';
export type PackageObjectType = 'part' | 'interior' | 'manifest';

/** Extra `skin_export_app` flags: every ship builds its package + interior; FPS and items on request. */
export function packageExportArgs(req: { fps?: boolean; items?: boolean }): string[] {
  return ['--package', '--interior', ...(req.fps ? ['--fps'] : []), ...(req.items ? ['--items'] : [])];
}

/** Folders the exporter writes next to the ship folders — never a ship. */
const NON_SHIP_DIRS = new Set(['_parts', '_interiors', '_work_parts', '_fps', '_items', '_manifests']);

/** True for a real ship folder name; the export's shared/scratch dirs are not. */
export function isShipFolder(name: string): boolean {
  return !!name && !name.startsWith('_') && !name.startsWith('.') && !NON_SHIP_DIRS.has(name);
}

export interface UploadObject {
  type: PackageObjectType;
  sha256: string;
  bytes: number;
}

const SHA256 = /^[0-9a-f]{64}$/;

export interface PackagePlan {
  kind: PackageKind;
  entityClass: string;
  /** Every object this entity needs, deduplicated by (type, sha). The manifest is last. */
  objects: UploadObject[];
}

/**
 * Reads a manifest and lists what its entity needs in storage. A ship's hull
 * (`root`) is NOT listed: it lives in `_hulls/` and goes up with the hull flow.
 * An FPS weapon's root is a shared part. Throws on a manifest this uploader
 * cannot place (so the entity is reported, not half-uploaded).
 */
export function planPackage(manifest: unknown, manifestSha: string, manifestBytes: number): PackagePlan {
  const m = manifest as {
    schemaVersion?: unknown;
    kind?: unknown;
    entity?: { className?: unknown };
    root?: { sha256?: unknown; bytes?: unknown } | null;
    interior?: { sha256?: unknown; bytes?: unknown } | null;
    parts?: Record<string, { bytes?: unknown }>;
  };
  if (!m || typeof m !== 'object') throw new Error('manifest is not an object');
  if (m.schemaVersion !== 1) throw new Error(`unsupported manifest schemaVersion ${String(m.schemaVersion)}`);
  if (m.kind !== 'ship' && m.kind !== 'fps_weapon' && m.kind !== 'item') throw new Error('manifest kind must be ship, fps_weapon or item');
  const entityClass = typeof m.entity?.className === 'string' ? m.entity.className : '';
  if (!entityClass) throw new Error('manifest has no entity.className');

  const seen = new Set<string>();
  const objects: UploadObject[] = [];
  const add = (type: PackageObjectType, sha: unknown, bytes: unknown): void => {
    if (typeof sha !== 'string' || !SHA256.test(sha)) throw new Error(`malformed sha256 in manifest (${String(sha)})`);
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) throw new Error(`bad byte size for ${sha}`);
    const id = `${type}:${sha}`;
    if (seen.has(id)) return;
    seen.add(id);
    objects.push({ type, sha256: sha, bytes });
  };
  for (const [sha, p] of Object.entries(m.parts ?? {})) add('part', sha, p?.bytes);
  if (m.kind !== 'ship' && m.root) add('part', m.root.sha256, m.root.bytes);
  if (m.interior) add('interior', m.interior.sha256, m.interior.bytes);
  add('manifest', manifestSha, manifestBytes);
  return { kind: m.kind, entityClass, objects };
}

/** Splits `items` into chunks of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `fn` over `items`, at most `limit` at a time. Rejects with the first error. */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Backoff before retry number `attempt` (0-based): 500 ms, 1 s, 2 s … capped at 8 s. */
export function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt);
}

/**
 * Runs `fn`, retrying up to `retries` times after a failure `retryable` accepts
 * (default: all). Control-flow errors must be excluded by the caller's predicate.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; retryable?: (e: unknown) => boolean; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || (opts.retryable && !opts.retryable(e))) throw e;
      await sleep(backoffMs(attempt));
    }
  }
}
