import { Injectable, signal } from '@angular/core';

/**
 * Whether the current overlay route was opened from its list in this tab.
 *
 * Memory only on purpose: a refresh, a shared link or a fresh tab starts with
 * `false`, so the same URL then renders as a full page (spec §9, "intercepting
 * route"); an in-app plain left click on a list entry calls `fromList()` just
 * before navigating, and the overlay frame lays itself over the list.
 */
@Injectable({ providedIn: 'root' })
export class OverlayOriginService {
  /** True while an overlay that came from a list click is open. */
  readonly overlaid = signal(false);

  /** Call right before navigating to an overlay route from its list. */
  fromList(): void {
    this.overlaid.set(true);
  }

  /** The overlay route went away (closed, or the user navigated elsewhere). */
  reset(): void {
    this.overlaid.set(false);
  }
}
