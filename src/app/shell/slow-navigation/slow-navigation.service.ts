import { Injectable, NgZone, inject, signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationStart,
  Router,
} from '@angular/router';

/** How long a navigation may be pending before the calm "takes longer" card shows. */
export const SLOW_NAVIGATION_MS = 8000;

/**
 * Watches Router navigations (lazy chunk plus route data) and raises `slow`
 * once one has been pending for {@link SLOW_NAVIGATION_MS}. It hides again on
 * any end of that navigation. It only reads router events: a chunk that fails
 * to load ends in `NavigationError`, which `RouteLoadRecoveryService` handles
 * on its own (reload); this service just stops showing the card then.
 */
@Injectable({ providedIn: 'root' })
export class SlowNavigationService {
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);

  readonly slow = signal(false);
  private pendingId: number | null = null;
  private pendingUrl: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.clear();
        this.pendingId = e.id;
        this.pendingUrl = e.url;
        // Outside the zone: a pending 8 s timer must not hold app stability.
        this.zone.runOutsideAngular(() => {
          this.timer = setTimeout(() => this.slow.set(true), SLOW_NAVIGATION_MS);
        });
      } else if (
        (e instanceof NavigationEnd ||
          e instanceof NavigationCancel ||
          e instanceof NavigationError ||
          e instanceof NavigationSkipped) &&
        e.id === this.pendingId
      ) {
        this.clear();
      }
    });
  }

  /** Runs the pending navigation again (a superseding navigation to the same URL). */
  retry(): void {
    const url = this.pendingUrl;
    if (!url) return;
    void this.router.navigateByUrl(url, { onSameUrlNavigation: 'reload' });
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pendingId = null;
    this.pendingUrl = null;
    this.slow.set(false);
  }
}
