import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Mirror a list page's state (category, search, facets) into the query string
 * so Back from a detail page, a reload or a shared link lands on the same list.
 *
 * Deliberately NOT a router navigation: every `router.navigate` fires
 * NavigationEnd, which counted a page view per keystroke, scrolled the window
 * to the top (`scrollPositionRestoration: 'top'`) and could cancel a click
 * that was already navigating to a detail page (red-team review of the
 * archive audit, 2026-09-25). `replaceState` only rewrites the address bar
 * and keeps the history entry's state, so the router's own bookkeeping
 * (navigationId for back/forward) stays intact.
 *
 * `params` holds the page's own keys; null removes one. Keys it does not name
 * (`equipInto`, `equipSlot`, …) are kept. They are merged with the ADDRESS
 * BAR, not with the router's `queryParamsHandling: 'merge'`: the router never
 * learns about a `replaceState`, so its URL still holds the query the page
 * was opened with, and a key removed by an earlier call would come back.
 */
export function mirrorQueryParams(
  router: Router,
  route: ActivatedRoute,
  location: Location,
  params: Record<string, string | null>,
): void {
  try {
    const current = router.parseUrl(location.path()).queryParams;
    const tree = router.createUrlTree([], { relativeTo: route, queryParams: { ...current, ...params } });
    const url = router.serializeUrl(tree);
    if (url !== location.path()) location.replaceState(url, '', location.getState());
  } catch {
    // A detached route (tests, a view outside the router): the list works, the URL stays as it was.
  }
}
