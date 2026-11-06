import { Injectable, NgZone, inject, signal } from '@angular/core';

type FocusListener = (focused: boolean) => void;

/**
 * Whether this window has the user's focus. Without it the background stands
 * still: on a second monitor next to the game, the page should cost next to
 * nothing (concept 2026-11-06 "Planet-Leistung"). The stylesheet reads the class
 * `sc-unfocused` on `<html>`, canvas loops subscribe here.
 *
 * It starts as focused and changes on the window's own events only: a page that
 * loads behind another window runs until its first blur or focus.
 */
@Injectable({ providedIn: 'root' })
export class WindowFocusService {
  readonly focused = signal(true);
  private readonly listeners = new Set<FocusListener>();

  constructor() {
    if (typeof window === 'undefined') return;
    inject(NgZone).runOutsideAngular(() => {
      window.addEventListener('blur', () => {
        // Focus moving into an embedded frame blurs the window too; the user is still here.
        if (document.activeElement instanceof HTMLIFrameElement) return;
        this.set(false);
      });
      window.addEventListener('focus', () => this.set(true));
    });
  }

  /** Calls `listener` on every change. Returns the unsubscribe function. */
  onChange(listener: FocusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(focused: boolean): void {
    if (focused === this.focused()) return;
    this.focused.set(focused);
    document.documentElement.classList.toggle('sc-unfocused', !focused);
    for (const listener of this.listeners) listener(focused);
  }
}
