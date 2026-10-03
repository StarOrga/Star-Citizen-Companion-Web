import { Injectable, InjectionToken, inject } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * Localization strings of a build, read from R2 through the assets Worker
 * (storage plan, 2026-10-03). The layout is written by ingest-catalog:
 * supabase/functions/ingest-catalog/_locale-shards.ts is the source of truth;
 * the lookup below is a copy pinned to the same golden vectors in
 * codex-locale-shards.spec.ts and that file's _locale.test.mjs.
 *
 *   codex-locale/<build>/<lang>/index.json          which shards exist (5 min cache)
 *   codex-locale/<build>/<lang>/<gen>/<shard>.json  key → value (immutable)
 */

export interface LocaleIndex {
  v: 1;
  build_id: string;
  lang: string;
  gen: string;
  count: number;
  groups: Record<string, number>;
  misc: number;
}

const GROUP_RE = /^[a-z0-9]{1,24}$/;
const GEN_RE = /^[0-9a-z]{6,16}$/;

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function keyGroup(key: string): string {
  const head = key.split('_', 1)[0].toLowerCase();
  return GROUP_RE.test(head) ? head : '';
}

export function shardFor(index: Pick<LocaleIndex, 'groups' | 'misc'>, key: string): string {
  const group = keyGroup(key);
  const own = group ? index.groups[group] : undefined;
  if (own) return `${group}-${fnv1a(key) % own}`;
  return `_misc-${fnv1a(key) % Math.max(1, index.misc)}`;
}

export function isLocaleIndex(v: unknown, buildId: string, lang: string): v is LocaleIndex {
  const i = v as LocaleIndex | null;
  return !!i && i.v === 1 && i.build_id === buildId && i.lang === lang &&
    typeof i.gen === 'string' && GEN_RE.test(i.gen) &&
    Number.isInteger(i.count) && Number.isInteger(i.misc) && i.misc >= 1 &&
    !!i.groups && typeof i.groups === 'object';
}

/** The fetch the shard reader uses — a token so specs never touch the network. */
export const LOCALE_SHARD_FETCH = new InjectionToken<typeof fetch>('LOCALE_SHARD_FETCH', {
  providedIn: 'root',
  factory: () => (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
});

/** Base of the assets Worker, without a trailing slash; '' when none is configured. */
export const LOCALE_SHARD_BASE = new InjectionToken<string>('LOCALE_SHARD_BASE', {
  providedIn: 'root',
  factory: () => (environment.assets?.r2BaseUrl ?? '').trim().replace(/\/+$/, ''),
});

type Shard = Record<string, string>;

@Injectable({ providedIn: 'root' })
export class CodexLocaleShards {
  private readonly fetchFn = inject(LOCALE_SHARD_FETCH);
  private readonly base = inject(LOCALE_SHARD_BASE);
  /** Per build + language. A settled `null` means "this build is not in R2". */
  private readonly indexes = new Map<string, Promise<LocaleIndex | null>>();
  private readonly shards = new Map<string, Promise<Shard>>();

  /**
   * Values for the given (stripped, `@`-less) keys, or `null` when this build
   * has no R2 index for `lang` — the caller then reads the database table.
   * A key the build does not have, or whose shard failed to load, is simply
   * absent from the map, exactly like a missing row.
   */
  async resolve(buildId: string, lang: string, keys: string[]): Promise<Map<string, string> | null> {
    if (!this.base) return null;
    const index = await this.index(buildId, lang);
    if (!index) return null;

    const byShard = new Map<string, string[]>();
    for (const key of keys) {
      const name = shardFor(index, key);
      const list = byShard.get(name);
      if (list) list.push(key);
      else byShard.set(name, [key]);
    }
    const out = new Map<string, string>();
    await Promise.all(
      [...byShard].map(async ([name, wanted]) => {
        let shard: Shard;
        try {
          shard = await this.shard(`${this.dir(buildId, lang)}${index.gen}/${name}.json`);
        } catch {
          return; // localization never blocks the view; these keys stay raw
        }
        for (const key of wanted) {
          const value = shard[key];
          if (typeof value === 'string') out.set(key, value);
        }
      }),
    );
    return out;
  }

  private dir(buildId: string, lang: string): string {
    return `codex-locale/${buildId}/${lang}/`;
  }

  private index(buildId: string, lang: string): Promise<LocaleIndex | null> {
    const id = `${buildId}/${lang}`;
    let p = this.indexes.get(id);
    if (!p) {
      p = this.loadIndex(buildId, lang).catch(() => {
        // Outage, not absence: forget it so the next call asks again.
        this.indexes.delete(id);
        return null;
      });
      this.indexes.set(id, p);
    }
    return p;
  }

  private async loadIndex(buildId: string, lang: string): Promise<LocaleIndex | null> {
    const res = await this.fetchFn(`${this.base}/${this.dir(buildId, lang)}index.json`);
    // 404 = this build has no R2 strings (yet): remember it, use the database.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`locale index HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!isLocaleIndex(body, buildId, lang)) throw new Error('locale index malformed');
    return body;
  }

  private shard(path: string): Promise<Shard> {
    let p = this.shards.get(path);
    if (!p) {
      p = this.loadShard(path);
      p.catch(() => this.shards.delete(path));
      this.shards.set(path, p);
    }
    return p;
  }

  private async loadShard(path: string): Promise<Shard> {
    const res = await this.fetchFn(`${this.base}/${path}`);
    if (!res.ok) throw new Error(`locale shard HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('locale shard malformed');
    return body as Shard;
  }
}
