import { EnvironmentInjector, InjectionToken } from '@angular/core';

/**
 * A data warmer: loads the first data of a destination before the reader gets there,
 * into the same root service and memo the page reads on arrival — so the page's first
 * render finds it and the camera flight does not parse it mid-way.
 *
 * Keep the module that `warm` imports lazy (`import()` inside `warm`): this registry
 * sits in the boot bundle and must not pull a feature's services into it.
 */
export interface PrefetchWarmer {
  /** Stable id; a warmer runs at most once per distinct {@link PrefetchWarmer.key}. */
  readonly id: string;
  /** True when the warmer serves this path (no query, no fragment, leading `/`). */
  matches(path: string): boolean;
  /**
   * Memo key for a path; the same key never warms twice in a session. Default: the id
   * (one warm per session). A detail warmer keys by the entity in the path.
   */
  key?(path: string): string;
  /**
   * When the warmer may run: `intent` (default) on hover, focus or press; `press` only on
   * pointerdown / touchstart — for reads that are too big to fire for every row a pointer
   * sweeps across in a long list.
   */
  readonly trigger?: 'intent' | 'press';
  /** Starts the reads. Runs inside the Angular zone; failures are swallowed. */
  warm(injector: EnvironmentInjector, path: string): Promise<unknown> | void;
}

/** Multi token: every registered {@link PrefetchWarmer}. */
export const PREFETCH_WARMERS = new InjectionToken<readonly PrefetchWarmer[]>('PREFETCH_WARMERS');

/** The bits of the Network Information API prefetching reads (not in every browser). */
export interface PrefetchConnection {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

/** What a connection allows: code only, code and data, or nothing. */
export type PrefetchBudget = 'none' | 'code' | 'all';

/**
 * Save-Data or a 2G link: nothing (guesses are not worth the reader's data).
 * 3G: the route's code only — a data warm-up is several hundred kB of JSON.
 */
export function prefetchBudget(connection: PrefetchConnection | undefined): PrefetchBudget {
  if (!connection) return 'all';
  if (connection.saveData) return 'none';
  const t = connection.effectiveType;
  if (t === 'slow-2g' || t === '2g') return 'none';
  if (t === '3g') return 'code';
  return 'all';
}
