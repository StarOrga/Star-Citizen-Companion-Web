import { Injectable, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { logWarn } from '../../core/log';
import {
  NO_SIGNALS,
  OpenedRef,
  RankSignals,
  missKey,
  popularityMap,
  popularityOf,
  pushRecentOpened,
  readRecentOpened,
  recentRank,
} from './search-signals';

/** How long a zero-hit search must stand still before it is counted (typing in progress). */
export const MISS_DEBOUNCE_MS = 1500;
const POPULARITY_LIMIT = 500;

/**
 * Client side of the search signals and counters (C9, C10):
 *  - recently opened (local) and what others open often (`search_popularity`,
 *    read once per session, silently absent when the RPC is not deployed),
 *  - `search_log_open` on every open and `search_log_miss` for a committed
 *    search without a hit (debounced, once per term and session). Both are
 *    anonymous counters (text/class + count) and never throw.
 */
@Injectable({ providedIn: 'root' })
export class SearchSignalsService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly recentOpened = signal<OpenedRef[]>(readRecentOpened(storage()));
  private readonly popularity = signal<ReadonlyMap<string, number>>(new Map());
  private popularityRequested = false;
  private readonly missed = new Set<string>();
  private missTimer: ReturnType<typeof setTimeout> | null = null;

  /** The signals as the composer reads them. `owns` is supplied by the caller (HQ ownership). */
  signals(owns: (className: string) => boolean): RankSignals {
    const recent = this.recentOpened();
    const pop = this.popularity();
    return {
      recentRank: (kind, cls) => recentRank(recent, kind, cls),
      owns,
      popularity: (kind, cls) => popularityOf(pop, kind, cls),
    };
  }

  readonly none: RankSignals = NO_SIGNALS;

  /** Load the server popularity once per session. */
  ensurePopularity(): void {
    if (this.popularityRequested) return;
    this.popularityRequested = true;
    void (async () => {
      try {
        const { data, error } = await this.sb.client.rpc('search_popularity', { p_limit: POPULARITY_LIMIT });
        if (error) return;
        this.popularity.set(popularityMap(data as never));
      } catch {
        /* a ranking courtesy: absent is fine */
      }
    })();
  }

  /** A catalog entity was opened from the search: remember it locally, count it anonymously. */
  recordOpen(kind: string, className: string): void {
    if (!kind || !className.trim()) return;
    this.recentOpened.set(pushRecentOpened(storage(), this.recentOpened(), kind, className));
    void (async () => {
      try {
        await this.sb.client.rpc('search_log_open', { p_kind: kind, p_class: className });
      } catch (err) {
        logWarn('search', 'log open failed', err);
      }
    })();
  }

  /** A committed search found nothing anywhere: count the term (anonymous), once per term. */
  logMiss(term: string): void {
    const key = missKey(term);
    if (key.length < 2 || this.missed.has(key)) return;
    if (this.missTimer) clearTimeout(this.missTimer);
    this.missTimer = setTimeout(() => {
      this.missTimer = null;
      this.missed.add(key);
      void (async () => {
        try {
          await this.sb.client.rpc('search_log_miss', { p_query: key });
        } catch (err) {
          logWarn('search', 'log miss failed', err);
        }
      })();
    }, MISS_DEBOUNCE_MS);
  }

  /** Drop a pending miss (the reader kept typing or cleared the field). */
  cancelMiss(): void {
    if (this.missTimer) clearTimeout(this.missTimer);
    this.missTimer = null;
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
