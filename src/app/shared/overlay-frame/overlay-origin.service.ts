import { Location } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router, UrlTree } from '@angular/router';

const pathOf = (url: string): string => url.split(/[?#]/)[0];
/** Whether `path` is `base` itself or a segment below it (`/verse/news-old` is not under `/verse/news`). */
const within = (path: string, base: string): boolean => path === base || path.startsWith(base.endsWith('/') ? base : base + '/');

/**
 * Whether the current overlay route was opened from its list in this tab, and
 * how an overlay closes without breaking the browser history.
 *
 * `overlaid` is memory only on purpose: a refresh, a shared link or a fresh tab
 * starts with `false`, so the same URL then renders as a full page (spec §9,
 * "intercepting route"); an in-app plain left click on a list entry calls
 * `fromList()` just before navigating, and the overlay frame lays itself over
 * the list. The flag survives the overlay being destroyed so browser Back and
 * Forward (list, overlay, list, overlay) keep rendering it as an overlay; it
 * drops as soon as the router leaves the list's path.
 *
 * History model: opening pushes ONE entry, prev/next replace it, and `close()`
 * goes back when the entry before the overlay is its list - otherwise it
 * replaces the overlay with the list. A hard `navigate(list)` would push a new
 * entry, so Forward would then land on a state that should not exist.
 */
@Injectable({ providedIn: 'root' })
export class OverlayOriginService {
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** True while an overlay that came from a list click is open. */
  readonly overlaid = signal(false);

  /** The list path the overlay was opened from (while `overlaid`). */
  private section: string | null = null;
  /** Path of the history entry before the current one (null when unknown). */
  private prevPath: string | null = null;
  private curPath: string = pathOf(this.router.url);
  private replacing = false;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.replacing = !!this.router.getCurrentNavigation()?.extras.replaceUrl;
      } else if (e instanceof NavigationEnd) {
        const next = pathOf(e.urlAfterRedirects);
        // A replaced entry keeps its predecessor; any other entry becomes the new "current".
        if (!this.replacing && next !== this.curPath) this.prevPath = this.curPath;
        this.curPath = next;
        this.replacing = false;
        if (this.section && !within(next, this.section)) this.reset();
      }
    });
  }

  /** Call right before navigating to an overlay route from its list. */
  fromList(): void {
    this.section = this.curPath;
    this.overlaid.set(true);
  }

  /** The overlay route went away (closed, or the user navigated elsewhere). */
  reset(): void {
    this.overlaid.set(false);
    this.section = null;
  }

  /**
   * Close an overlay: history-back when the previous entry is the list,
   * otherwise replace the overlay with the list (never push).
   */
  close(list: readonly unknown[], extras: { queryParams?: Record<string, string> | null } = {}): void {
    const listPath = pathOf(this.router.serializeUrl(this.router.createUrlTree([...list]) as UrlTree));
    if (this.prevPath === listPath) {
      this.location.back();
      return;
    }
    this.reset();
    void this.router.navigate([...list], { queryParams: extras.queryParams ?? undefined, replaceUrl: true });
  }
}
