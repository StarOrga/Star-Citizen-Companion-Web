import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { environment } from '../../../environments/environment';
import { shipSkinsBase } from '../ship-skins.service';
import {
  type AssetPackageKind,
  type AssetPackageManifest,
  type AssetPackageRow,
  packageUrls,
  parseManifest,
  rowFromDb,
} from './asset-package.model';

/**
 * Dev-only fixture override: set `localStorage['sc.assetPackages.devBase']` to a
 * local folder URL laid out like `ship-skins/` (`_manifests/`, `_hulls/`,
 * `_parts/`, `_interiors/`) plus an `asset_packages.json` array of rows. Ignored
 * in production builds.
 */
export const DEV_BASE_KEY = 'sc.assetPackages.devBase';

/** The slice of the supabase query builder this service uses (asset_packages is newer than database.types). */
interface RowQuery {
  select(cols: string): RowQuery;
  eq(col: string, v: string): RowQuery;
  in(col: string, v: readonly string[]): RowQuery;
  limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
}

const ROW_COLS =
  'kind, entity_class, ship_id, manifest_sha256, root_sha256, interior_sha256, part_count, total_bytes, schema_version';

/** Keep at most this many GLB bytes in the session cache (parts are shared between entities). */
const BUFFER_BUDGET = 96 * 1024 * 1024;

/**
 * Loads 3D asset packages: `asset_packages` row → manifest → GLB bytes, every
 * blob cached by sha256 (immutable keys). Errors are thrown to the caller,
 * which maps them through `toErrorKey`.
 */
@Injectable({ providedIn: 'root' })
export class AssetPackageService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly rows = new Map<string, Promise<AssetPackageRow | null>>();
  private readonly manifests = new Map<string, Promise<AssetPackageManifest>>();
  private readonly buffers = new Map<string, { p: Promise<ArrayBuffer>; bytes: number }>();
  private bufferedBytes = 0;

  /** `…/ship-skins/` (or the dev fixture folder). */
  readonly base: string = this.devBase() ?? shipSkinsBase(environment.assets?.r2BaseUrl);
  readonly urls = packageUrls(this.base);

  private devBase(): string | null {
    if (environment.production) return null;
    try {
      const v = localStorage.getItem(DEV_BASE_KEY)?.trim();
      return v ? (v.endsWith('/') ? v : `${v}/`) : null;
    } catch {
      return null;
    }
  }

  /**
   * The package row for an entity, trying `kinds` in order. Null = no package
   * (the caller hides the viewer / falls back). Throws on a query failure.
   */
  findRow(kinds: readonly AssetPackageKind[], entityClass: string): Promise<AssetPackageRow | null> {
    const key = `${kinds.join(',')}|${entityClass.toLowerCase()}`;
    let hit = this.rows.get(key);
    if (!hit) {
      hit = this.queryRow(kinds, entityClass);
      this.rows.set(key, hit);
      hit.catch(() => this.rows.delete(key));
    }
    return hit;
  }

  private async queryRow(kinds: readonly AssetPackageKind[], entityClass: string): Promise<AssetPackageRow | null> {
    if (!entityClass || kinds.length === 0) return null;
    let raw: unknown[];
    if (this.base !== shipSkinsBase(environment.assets?.r2BaseUrl)) {
      const res = await fetch(`${this.base}asset_packages.json`);
      if (!res.ok) throw Object.assign(new Error(`fixture rows ${res.status}`), { status: res.status });
      raw = (await res.json()) as unknown[];
    } else {
      const q = (this.sb.client as unknown as { from(t: string): RowQuery })
        .from('asset_packages')
        .select(ROW_COLS)
        .eq('entity_class', entityClass)
        .in('kind', kinds);
      const { data, error } = await q.limit(kinds.length);
      if (error) throw error;
      raw = data ?? [];
    }
    const rows = raw.map(rowFromDb).filter((r): r is AssetPackageRow => !!r);
    const lc = entityClass.toLowerCase();
    for (const k of kinds) {
      const r = rows.find((x) => x.kind === k && x.entityClass.toLowerCase() === lc);
      if (r) return r;
    }
    return null;
  }

  manifest(sha: string): Promise<AssetPackageManifest> {
    let hit = this.manifests.get(sha);
    if (!hit) {
      hit = this.fetchOk(this.urls.manifest(sha)).then(async (r) => parseManifest(await r.json()));
      this.manifests.set(sha, hit);
      hit.catch(() => this.manifests.delete(sha));
    }
    return hit;
  }

  /** GLB bytes by URL (URLs are sha-keyed, so the URL is the cache key). */
  glb(url: string): Promise<ArrayBuffer> {
    const hit = this.buffers.get(url);
    if (hit) {
      // LRU touch.
      this.buffers.delete(url);
      this.buffers.set(url, hit);
      return hit.p;
    }
    const entry = { p: Promise.resolve(new ArrayBuffer(0)), bytes: 0 };
    entry.p = this.fetchOk(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        entry.bytes = buf.byteLength;
        this.bufferedBytes += buf.byteLength;
        this.evict();
        return buf;
      });
    entry.p.catch(() => this.buffers.delete(url));
    this.buffers.set(url, entry);
    return entry.p;
  }

  private evict(): void {
    for (const [url, e] of this.buffers) {
      if (this.bufferedBytes <= BUFFER_BUDGET || this.buffers.size <= 1) break;
      this.buffers.delete(url);
      this.bufferedBytes -= e.bytes;
    }
  }

  private async fetchOk(url: string): Promise<Response> {
    const res = await fetch(url);
    if (!res.ok) throw Object.assign(new Error(`GET ${url} → ${res.status}`), { status: res.status });
    return res;
  }
}
