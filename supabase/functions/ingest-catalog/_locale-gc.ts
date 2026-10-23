// Garbage collection for `codex-locale/<build uuid>/...` in R2 (storage.md
// § Localization strings). prune_codex_builds deletes a build's rows, never its
// R2 prefix; this picks the prefixes whose build id is gone from codex_builds.
//
// Pure selection lives here so it can be tested without R2 or a database; the
// op in index.ts wires the listing, the live ids and the deletes.
//
// Safety rules, in order of importance:
//   * a prefix whose build id is in `liveIds` is NEVER selected (compared
//     lower-cased on both sides),
//   * an empty `liveIds` selects nothing: that is what a failed or truncated
//     read looks like, and "no builds at all" is not a state to delete in,
//   * a key that is not exactly `codex-locale/<uuid>/<something>` is ignored,
//     so a stray object or another prefix is never touched.

import { BUILD_ID_RE, LOCALE_ROOT } from './_locale-shards.ts';

export interface OrphanSelection {
  /** Build id -> every key under its prefix. Only ids absent from liveIds. */
  orphans: Map<string, string[]>;
  /** Distinct build ids found in R2 that still exist in codex_builds. */
  kept: string[];
  /** Keys that did not look like codex-locale/<uuid>/... and were left alone. */
  ignored: number;
}

export function selectOrphanLocaleKeys(keys: string[], liveIds: Iterable<string>): OrphanSelection {
  const live = new Set<string>();
  for (const id of liveIds) live.add(String(id).toLowerCase());
  const orphans = new Map<string, string[]>();
  const kept = new Set<string>();
  let ignored = 0;
  const head = `${LOCALE_ROOT}/`;
  for (const key of keys) {
    const rest = key.startsWith(head) ? key.slice(head.length) : '';
    const slash = rest.indexOf('/');
    const id = slash > 0 ? rest.slice(0, slash).toLowerCase() : '';
    if (!BUILD_ID_RE.test(id) || slash === rest.length - 1) {
      ignored++;
      continue;
    }
    if (live.has(id)) {
      kept.add(id);
      continue;
    }
    if (live.size === 0) {
      ignored++;
      continue;
    }
    const list = orphans.get(id);
    if (list) list.push(key);
    else orphans.set(id, [key]);
  }
  return { orphans, kept: [...kept].sort(), ignored };
}

export interface GcDeps {
  /** Every key under `codex-locale/`. */
  listKeys(prefix: string): Promise<string[]>;
  /** Ids of ALL rows in codex_builds (finalized or not). Must throw on a failed read. */
  liveBuildIds(): Promise<string[]>;
  deleteKey(key: string): Promise<void>;
}

export interface GcResult {
  dry_run: boolean;
  live_builds: number;
  kept_builds: string[];
  orphan_builds: { build_id: string; objects: number }[];
  objects_deleted: number;
  ignored: number;
}

const DELETE_CONCURRENCY = 8;

export async function gcLocalePrefixes(deps: GcDeps, opts: { dryRun: boolean }): Promise<GcResult> {
  // Live ids first, listing second: a build created in between is then at worst
  // missing from the list, never present in the list but missing from liveIds.
  const live = await deps.liveBuildIds();
  const keys = await deps.listKeys(`${LOCALE_ROOT}/`);
  const sel = selectOrphanLocaleKeys(keys, live);

  let deleted = 0;
  if (!opts.dryRun) {
    const all = [...sel.orphans.values()].flat();
    let next = 0;
    const workers = Array.from({ length: Math.min(DELETE_CONCURRENCY, all.length) }, async () => {
      while (next < all.length) {
        await deps.deleteKey(all[next++]);
        deleted++;
      }
    });
    await Promise.all(workers);
  }
  return {
    dry_run: opts.dryRun,
    live_builds: live.length,
    kept_builds: sel.kept,
    orphan_builds: [...sel.orphans].map(([build_id, k]) => ({ build_id, objects: k.length })),
    objects_deleted: deleted,
    ignored: sel.ignored,
  };
}
