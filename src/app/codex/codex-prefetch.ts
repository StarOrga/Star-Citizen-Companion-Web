import type { PrefetchWarmer } from '../core/prefetch/prefetch.model';

/**
 * Codex data warmers for intent prefetching (core/prefetch). This file sits in the boot
 * bundle: it only matches paths; the services load through `import()` inside `warm`.
 */

/** Detail kinds of `/codex/:kind/:className` (CODEX_KINDS, inlined to keep codex.service out of the boot bundle). */
const DETAIL_KINDS = new Set(['ship', 'weapon', 'component', 'item', 'ammunition', 'manufacturer', 'blueprint']);
/** Static segments that sit before `:kind` in app.routes.ts and are not entries. */
const NOT_DETAIL = new Set(['index', 'mission', 'blueprint', 'fps', 'keybinds', 'upcoming']);

/** `[kind, className]` of a Codex detail path, or null. */
export function codexDetailOf(path: string): [string, string] | null {
  const m = /^\/codex\/([^/]+)\/([^/]+)$/.exec(path);
  if (!m || !DETAIL_KINDS.has(m[1])) return null;
  // `/codex/blueprint/:className` is the blueprint page, not the generic detail.
  if (NOT_DETAIL.has(m[1])) return null;
  return [m[1], decodeSegment(m[2])];
}

/** The Codex landing: build, rotation, the patch's news column and its summary. */
export const CODEX_LANDING_WARMER: PrefetchWarmer = {
  id: 'codex-landing',
  matches: (path) => path === '/codex',
  warm: async (injector) => (await import('./codex-prefetch.warm')).warmCodexLanding(injector),
};

/** A ship's silhouette (small, one row): the detail's skeleton and Holotable draw it at once. */
export const CODEX_SHIP_OUTLINE_WARMER: PrefetchWarmer = {
  id: 'codex-ship-outline',
  matches: (path) => codexDetailOf(path)?.[0] === 'ship',
  key: (path) => codexDetailOf(path)?.[1] ?? '',
  warm: async (injector, path) => {
    const hit = codexDetailOf(path);
    if (hit) (await import('./codex-prefetch.warm')).warmShipOutline(injector, hit[1]);
  },
};

/** The entry's detail read — press only: a pointer sweeping down a list must not fire one per row. */
export const CODEX_DETAIL_WARMER: PrefetchWarmer = {
  id: 'codex-detail',
  trigger: 'press',
  matches: (path) => !!codexDetailOf(path),
  key: (path) => codexDetailOf(path)?.join(':') ?? '',
  warm: async (injector, path) => {
    const hit = codexDetailOf(path);
    if (hit) (await import('./codex-prefetch.warm')).warmDetail(injector, hit[0], hit[1]);
  },
};

export const CODEX_WARMERS: readonly PrefetchWarmer[] = [CODEX_LANDING_WARMER, CODEX_SHIP_OUTLINE_WARMER, CODEX_DETAIL_WARMER];

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
