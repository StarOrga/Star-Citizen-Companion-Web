import { ViewportScroller } from '@angular/common';
import { EnvironmentProviders, Injectable, OnDestroy, inject, provideEnvironmentInitializer } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router, Scroll } from '@angular/router';
import { Subscription } from 'rxjs';

/**
 * Route data flag for a routed overlay: a child route that opens over its
 * parent page (own URL, browser back closes it) instead of replacing it,
 * e.g. the patch dossier at `/verse/patches/:line`.
 */
export const OVERLAY_ROUTE_DATA = 'scOverlay';

/** sessionStorage key: the scroll position of the page as it was left, for a reload of the same URL. */
export const RELOAD_SCROLL_KEY = 'sc.reloadScroll';
/** How long a reload keeps trying to reach the old position while the page fills in (ms). */
/** A Codex list loads its rows late: keep retrying the restore until then (or the user scrolls). */
const RESTORE_WINDOW_MS = 8000;
/** Extra wait while the page is still too short to reach the old position. */
const RESTORE_LOADING_GRACE_MS = 12000;

/** The position to restore after a reload, or null (other URL, nothing stored, bad data). */
export function reloadScrollTarget(stored: string | null, url: string): number | null {
  if (!stored) return null;
  try {
    const v = JSON.parse(stored) as { url?: unknown; y?: unknown };
    return v.url === url && typeof v.y === 'number' && v.y > 0 ? v.y : null;
  } catch {
    return null;
  }
}

/** The page under the overlay: the route chain up to (not into) an overlay route. */
export interface OverlayScrollState {
  /** Each non-overlay route of the primary chain, with its params. */
  readonly base: readonly { readonly route: unknown; readonly params: string }[];
  /** True when the chain ends in an overlay route. */
  readonly overlay: boolean;
}

export function overlayScrollState(root: ActivatedRouteSnapshot): OverlayScrollState {
  const base: { route: unknown; params: string }[] = [];
  let overlay = false;
  for (let node: ActivatedRouteSnapshot | null = root; node; node = node.firstChild) {
    if (node.routeConfig?.data?.[OVERLAY_ROUTE_DATA]) {
      overlay = true;
      break;
    }
    if (node.routeConfig) base.push({ route: node.routeConfig, params: JSON.stringify(node.params) });
  }
  return { base, overlay };
}

/**
 * True when a navigation only opens, closes or swaps a routed overlay over
 * the same page: the page underneath never left, so its scroll position must
 * not move.
 */
export function keepsScroll(prev: OverlayScrollState | null, next: OverlayScrollState): boolean {
  if (!prev || (!prev.overlay && !next.overlay)) return false;
  if (prev.base.length !== next.base.length) return false;
  return prev.base.every((b, i) => b.route === next.base[i].route && b.params === next.base[i].params);
}

/**
 * The app's scroll policy, in place of `scrollPositionRestoration: 'top'`
 * (admin feedback #245): every navigation still lands at the top, except one
 * that only opens or closes a routed overlay. Closing the patch dossier
 * (close button, Esc, scrim, browser back) used to throw the reader to the
 * top of the board instead of the card they had opened. The router keeps
 * emitting its `Scroll` events with restoration 'disabled'; anchors stay with
 * the router (`anchorScrolling: 'enabled'`), and a navigation with
 * `scroll: 'manual'` stays untouched as before.
 */
@Injectable({ providedIn: 'root' })
export class OverlayRouteScrollService implements OnDestroy {
  private readonly router = inject(Router);
  private readonly scroller = inject(ViewportScroller);
  private readonly keep = new Set<number>();
  private prev: OverlayScrollState | null = null;
  private sub: Subscription | null = null;
  private first = true;
  /** True while a reload is scrolling back to its old position (a programmatic scroll, not the user's). */
  restoring = false;

  init(): void {
    if (this.sub) return;
    this.scroller.setHistoryScrollRestoration('manual');
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        try {
          sessionStorage.setItem(RELOAD_SCROLL_KEY, JSON.stringify({ url: this.router.url, y: Math.round(window.scrollY) }));
        } catch {
          // Storage unavailable: a reload simply starts at the top.
        }
      });
    }
    this.sub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) {
        const next = overlayScrollState(this.router.routerState.snapshot.root);
        if (keepsScroll(this.prev, next)) this.keep.add(e.id);
        this.prev = next;
      } else if (e instanceof Scroll) {
        this.onScroll(e);
      }
    });
  }

  private onScroll(e: Scroll): void {
    const id = e.routerEvent instanceof NavigationEnd ? e.routerEvent.id : -1;
    if (this.first) {
      this.first = false;
      if (this.restoreAfterReload()) return;
    }
    if (this.keep.delete(id) || e.scrollBehavior === 'manual') return;
    if (e.position) this.scroller.scrollToPosition([0, 0], { behavior: 'instant' });
    else if (!e.anchor) this.scroller.scrollToPosition([0, 0]);
  }

  /** A reload of the same URL comes back at the old scroll position (cheap: retried while the page fills in). */
  private restoreAfterReload(): boolean {
    if (typeof window === 'undefined' || typeof performance === 'undefined') return false;
    const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type !== 'reload') return false;
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(RELOAD_SCROLL_KEY);
      sessionStorage.removeItem(RELOAD_SCROLL_KEY);
    } catch {
      return false;
    }
    const y = reloadScrollTarget(stored, this.router.url);
    if (y === null) return false;
    this.restoring = true;
    const until = Date.now() + RESTORE_WINDOW_MS;
    let userMoved = false;
    const stop = () => (userMoved = true);
    const opts = { passive: true, once: true } as AddEventListenerOptions;
    for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.addEventListener(ev, stop, opts);
    const step = () => {
      if (!userMoved) window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
      // Still too short to reach y (the list is loading): keep waiting a while longer.
      const tooShort = document.documentElement.scrollHeight < y + window.innerHeight;
      const expired = Date.now() > until + (tooShort ? RESTORE_LOADING_GRACE_MS : 0);
      if (userMoved || Math.abs(window.scrollY - y) < 2 || expired || typeof requestAnimationFrame !== 'function') {
        for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.removeEventListener(ev, stop);
        requestAnimationFrame?.(() => (this.restoring = false));
        return;
      }
      requestAnimationFrame(step);
    };
    step();
    return true;
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}

/** Use with `withInMemoryScrolling({ scrollPositionRestoration: 'disabled', anchorScrolling: 'enabled' })`. */
export function provideOverlayRouteScroll(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => inject(OverlayRouteScrollService).init());
}
