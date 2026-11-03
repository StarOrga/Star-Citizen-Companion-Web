import { Injectable, NgZone, inject } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { EMPTY, Observable } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { logWarn } from './log';

/** Route `data` key that marks a main area for idle preloading. */
export const PRELOAD_ROUTE_DATA = 'preload';

/** Earliest start after boot: the opened page (and its entrance) gets the main thread first. */
export const PRELOAD_START_DELAY_MS = 3000;
/**
 * Longest an idle callback may be put off before it runs anyway. Short on
 * purpose: pages with running animations are rarely idle in the strict sense,
 * and each area is one small task (a fetch plus one module evaluation).
 */
const IDLE_TIMEOUT_MS = 1000;

/** The bits of the Network Information API that matter here (not in every browser). */
export interface NetworkInformationLike {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

/** False when the user asked to save data or the connection is too slow to spend it on guesses. */
export function connectionAllowsPreload(connection: NetworkInformationLike | undefined): boolean {
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}

/**
 * Loads the code of the app's main areas (routes marked `data: { preload: true }`)
 * once the page the user opened is up and the browser is idle — so the first
 * click into another area does not wait for its chunk to download, parse and
 * compile (the Codex detail chunk alone is ~130 kB on the wire, ~700 kB of JS).
 *
 * - Starts no earlier than {@link PRELOAD_START_DELAY_MS} after boot, and only
 *   in idle time, so the opened page and its entrance keep the main thread.
 * - One area at a time, each in its own idle callback: compiling a chunk is a
 *   main-thread task, and all of them at once would be one long stall.
 * - Only for a signed-in user (every area sits behind the approval guard; the
 *   login page must not pay for code it cannot open), never with Save-Data or
 *   on a 2G connection. Admin routes are never marked.
 * - A failed preload is dropped quietly (like Angular's `PreloadAllModules`):
 *   the real navigation loads the chunk again and owns the error handling.
 *
 * Which areas are marked is a routing decision: app.routes.ts and
 * verse/verse.routes.ts set the flag on the main tabs and the Codex detail page.
 */
@Injectable({ providedIn: 'root' })
export class IdlePreloadingStrategy implements PreloadingStrategy {
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);
  private readonly bootAt = now();
  /** Tail of the preload queue: each area starts after the previous one finished. */
  private queue: Promise<void> = Promise.resolve();

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (!route.data?.[PRELOAD_ROUTE_DATA] || typeof window === 'undefined') return EMPTY;
    const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
    if (!connectionAllowsPreload(connection)) return EMPTY;

    return new Observable<unknown>((subscriber) => {
      let cancelled = false;
      this.queue = this.queue.then(async () => {
        await this.idle();
        if (cancelled || !this.auth.isAuthenticated()) return subscriber.complete();
        await new Promise<void>((resolve) => {
          load().subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => {
              logWarn('preload', 'idle preload failed', { path: route.path, err });
              subscriber.complete();
              resolve();
            },
            complete: () => {
              subscriber.complete();
              resolve();
            },
          });
        });
      });
      return () => (cancelled = true);
    });
  }

  /** Resolves in an idle period, no earlier than PRELOAD_START_DELAY_MS after boot. */
  private idle(): Promise<void> {
    const wait = Math.max(0, this.bootAt + PRELOAD_START_DELAY_MS - now());
    return new Promise<void>((resolve) => {
      this.zone.runOutsideAngular(() =>
        setTimeout(() => {
          if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
          } else {
            setTimeout(resolve, 50);
          }
        }, wait),
      );
    });
  }
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
