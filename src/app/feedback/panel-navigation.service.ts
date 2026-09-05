import { Injectable, signal } from '@angular/core';

/**
 * A feedback panel telling its shell that a link inside it just navigated the
 * app underneath.
 *
 * On a phone (≤720px) both panels are full-bleed sheets, so "▸ Ansehen" /
 * "Im App ansehen" routed the page behind a sheet that kept covering it —
 * nothing appeared to happen until the user minimized by hand (#517). The
 * interiors cannot reach their shell: the shells own the minimize state and
 * were deliberately left outside the 2026-09-04 rethink's corridor. This is the
 * seam between them, small enough that neither side has to know the other.
 *
 * A counter rather than a boolean or an event: two navigations in a row must
 * both be observable, and there is no state anyone has to remember to reset.
 */
@Injectable({ providedIn: 'root' })
export class PanelNavigationService {
  private readonly _navigations = signal(0);

  /** Bumped once per in-app navigation started from inside a feedback panel. */
  readonly navigations = this._navigations.asReadonly();

  /**
   * Call from a panel link that routes the app in place. Gate the caller with
   * `isPlainLeftClick` — a Ctrl/middle click opens a new tab and leaves this
   * one where it was, so the panel must stay put.
   */
  notifyInAppNavigation(): void {
    this._navigations.update((n) => n + 1);
  }
}
