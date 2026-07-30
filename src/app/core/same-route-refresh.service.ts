import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subject, filter, map } from 'rxjs';

/**
 * "Tap the nav entry you are already on to reload the page" (admin feedback
 * 7532e639).
 *
 * The router deliberately drops a navigation that targets the URL you are
 * already on, so a second click on the active nav entry — or on the brand logo
 * while on the home route — does nothing at all and reads as a dead control.
 * The mobile-app convention is that re-activating the current tab re-fetches
 * (and returns you to the top), which is exactly what the feedback asks for.
 *
 * This service is the thin bridge between the two halves of that gesture:
 * the nav affordance (shell header) reports the click, the routed page decides
 * what "refresh" means for it — a data reload, not a `location.reload()`, so we
 * keep the SPA's warm state, the auth session and the bundle cache.
 *
 * Pages opt in with `onRefresh('/news')`; routes that don't subscribe simply
 * keep today's no-op behaviour.
 */
@Injectable({ providedIn: 'root' })
export class SameRouteRefreshService {
  private readonly router = inject(Router);
  private readonly requests = new Subject<string>();

  /**
   * Report an activation of `path`. Emits a refresh request only when the
   * router is already on that path — a real navigation refreshes by itself.
   * Returns whether a request was emitted (handy for tests and callers that
   * want to know the click was "same route").
   */
  request(path: string): boolean {
    const target = normalizePath(path);
    if (normalizePath(this.router.url) !== target) return false;
    this.requests.next(target);
    return true;
  }

  /** Fires whenever the user re-activates `path` while already on it. */
  onRefresh(path: string): Observable<void> {
    const target = normalizePath(path);
    return this.requests.pipe(
      filter((p) => p === target),
      map(() => undefined),
    );
  }
}

/**
 * Compare on the path only: query string and fragment are page state
 * (`/news?article=…` is still the news page), and a trailing slash is the same
 * route as none.
 */
export function normalizePath(url: string): string {
  const path = url.split('?')[0].split('#')[0].replace(/\/+$/, '');
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}
