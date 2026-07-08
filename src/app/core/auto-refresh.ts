import { DestroyRef, Injectable, NgZone, inject } from '@angular/core';

/**
 * Idle-aware auto-refresh primitive.
 *
 * Replaces manual "Refresh" buttons across the app: data-driven views register
 * a refresh callback that fires on a gentle cadence, but ONLY while the user is
 * idle (no input for `idleMs`) and the tab is visible — so a live update never
 * yanks the ground out from under someone who is actively interacting.
 *
 * Best-practice defaults (the feedback asked us to pick): a 20s poll cadence
 * with a 10s idle grace. 10s comfortably clears the requested 5s floor while
 * still ignoring the brief pauses that happen mid-reading, and 20s keeps the
 * network chatter modest for these admin/data screens.
 */

export const DEFAULT_REFRESH_INTERVAL_MS = 20_000;
export const DEFAULT_IDLE_GRACE_MS = 10_000;

/** Pure idle predicate — extracted so the timing logic is unit-testable. */
export function isIdle(lastActivityAt: number, now: number, thresholdMs: number): boolean {
  return now - lastActivityAt >= thresholdMs;
}

/**
 * Tracks the timestamp of the user's most recent interaction, app-wide.
 * Listeners run outside Angular's zone so ordinary mouse/keyboard activity
 * doesn't trigger change-detection churn.
 */
@Injectable({ providedIn: 'root' })
export class IdleService {
  private lastActivityAt = this.now();

  constructor() {
    const zone = inject(NgZone);
    if (typeof window === 'undefined') return;
    const mark = () => {
      this.lastActivityAt = this.now();
    };
    zone.runOutsideAngular(() => {
      for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
        window.addEventListener(ev, mark, { passive: true });
      }
    });
  }

  /** True when the user has not interacted for at least `thresholdMs`. */
  isIdleFor(thresholdMs: number): boolean {
    return isIdle(this.lastActivityAt, this.now(), thresholdMs);
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
}

export interface AutoRefreshOptions {
  /** How often to attempt a refresh (ms). */
  intervalMs?: number;
  /** Minimum idle time before a refresh is allowed (ms). */
  idleMs?: number;
  /** Optional extra gate, e.g. `() => !this.busy()` to skip while loading. */
  enabled?: () => boolean;
}

/**
 * Registers an idle-gated, visibility-gated periodic refresh. Call it from a
 * component's injection context (field initializer or constructor). The timer
 * is torn down automatically when the component is destroyed.
 */
export function useAutoRefresh(cb: () => void | Promise<void>, options: AutoRefreshOptions = {}): void {
  const idle = inject(IdleService);
  const destroyRef = inject(DestroyRef);
  const zone = inject(NgZone);

  const intervalMs = options.intervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_GRACE_MS;

  if (typeof window === 'undefined') return;

  const tick = () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!idle.isIdleFor(idleMs)) return;
    if (options.enabled && !options.enabled()) return;
    // Re-enter the zone so signal updates from the callback are reflected.
    zone.run(() => void cb());
  };

  const id = zone.runOutsideAngular(() => setInterval(tick, intervalMs));
  destroyRef.onDestroy(() => clearInterval(id));
}
