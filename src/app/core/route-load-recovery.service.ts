import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationError, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';

/**
 * Substrings every major engine puts in the error when a dynamic `import()` —
 * i.e. a lazily loaded route chunk — cannot be turned into a module. They read
 * differently per browser, so all four phrasings are matched:
 *
 *  - Chromium: "Failed to fetch dynamically imported module: …"
 *  - Firefox:  "error loading dynamically imported module: …"
 *  - Safari:   "Importing a module script failed."
 *  - MIME mismatch (see the class comment): "Failed to load module script:
 *    Expected a JavaScript module script but the server responded with a MIME
 *    type of text/html."
 *
 * Deliberately narrow: anything else that makes a navigation fail (a guard
 * throwing, a resolver rejecting) must NOT trigger a page load, or a broken
 * guard would turn into a reload loop.
 */
const MODULE_LOAD_MARKERS: readonly string[] = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'failed to load module script',
  'expected a javascript module script',
  'unable to preload css',
];

/**
 * True when `error` is a route CHUNK that would not load, as opposed to any
 * other reason a navigation failed. Exported so the classification has a test
 * of its own — it is the gate in front of a full page load.
 */
export function isRouteChunkError(error: unknown): boolean {
  if (error == null) return false;
  if ((error as { name?: unknown }).name === 'ChunkLoadError') return true;
  const raw = (error as { message?: unknown }).message;
  const message = (typeof raw === 'string' ? raw : String(error)).toLowerCase();
  // webpack-era phrasing, still emitted by some tooling: "Loading chunk 42 failed".
  if (/loading chunk \S+ failed/.test(message)) return true;
  return MODULE_LOAD_MARKERS.some((marker) => message.includes(marker));
}

/**
 * Turns a route whose lazy chunk cannot be loaded back into a working
 * navigation, instead of a menu entry that silently does nothing.
 *
 * WHY THIS EXISTS (admin feedback cdb16d63: "teilweise funktionieren menü
 * punkte oben in de header nicht mehr, wie telemetrie oder auch hinter dem
 * profilicon wie freunde … ich weiß nicht warum nur manchmal"):
 *
 * EVERY route in this app is `loadComponent: () => import(...)`, so clicking a
 * nav entry has to fetch a hash-named chunk. When that fetch does not yield a
 * module the router emits `NavigationError`, leaves the URL where it was and
 * renders nothing — the click is a no-op with no message anywhere. Chromium
 * additionally memoises the rejected module specifier for the lifetime of the
 * document, so that entry stays dead until the page is reloaded. That is
 * exactly the reported shape: "sometimes", "no longer", and specifically on
 * the entries one visits rarely (telemetry, friends) — the frequently used
 * ones were already imported and live in memory, so they keep working.
 *
 * The trigger is a stale document: this app deploys many times a day, and
 * `vercel.json` rewrites every unmatched path to `/index.html`, so a chunk
 * name from a superseded build does not even 404 — it answers 200 with HTML,
 * which fails the module MIME check. A long-open tab (or a service worker that
 * fell back to network passthrough) therefore asks for chunk names that no
 * longer exist.
 *
 * Recovery is what the plain `<a href>` would have done without the router: a
 * full page load of the same URL, so index.html and the chunk manifest come
 * back matched. Any newer service-worker version is adopted first, so the
 * reload cannot be served the very cache that just failed. It is a ONE-SHOT
 * per target URL — if the same URL fails again the reload did not help, and
 * looping the page would be worse than saying so, so {@link loadFailed} raises
 * a visible notice instead (rendered by ShellComponent).
 */
@Injectable({ providedIn: 'root' })
export class RouteLoadRecoveryService {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  /**
   * Optional on purpose: `SwUpdate` only exists where `provideServiceWorker()`
   * ran (production). In dev and in tests there is no worker to adopt, and the
   * recovery below is a plain reload — so this service must not drag a
   * service-worker provider into every component that renders its notice.
   */
  private readonly swUpdate = inject(SwUpdate, { optional: true });

  /**
   * True once a route chunk failed AND the one-shot reload for that URL was
   * already spent — i.e. the app cannot fix this by itself and has to say so.
   */
  readonly loadFailed = signal(false);

  /**
   * True from the failed navigation until the page load takes over. The shell
   * keeps its navigation indicator up on it, so the seconds between the dead
   * click and the reload are not another stretch of "nothing happened".
   */
  readonly recovering = signal(false);

  /**
   * sessionStorage key holding the URL whose one-shot reload has been spent.
   * Session-scoped because the fix IS a fresh document: a marker that outlived
   * the tab would disarm the recovery for a future, unrelated failure.
   */
  private static readonly RECOVERED_KEY = 'sc.nav.recoveredUrl';

  /** Max time spent adopting a newer worker before reloading anyway. */
  private static readonly ADOPT_TIMEOUT_MS = 4000;

  private initialized = false;
  private inFlight = false;

  /**
   * Subscribe to the router. Idempotent; called from `AppComponent.ngOnInit`
   * so the recovery covers every route, not only the ones under the shell.
   * No teardown: this is a root service that lives as long as the document.
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationError) {
        void this.onNavigationError(event);
      } else if (event instanceof NavigationEnd) {
        this.onNavigationEnd(event);
      }
    });
  }

  /** Hide the notice without reloading (the entry stays dead until a reload). */
  dismiss(): void {
    this.loadFailed.set(false);
  }

  /** The notice's action: the manual version of the recovery that did not stick. */
  reload(): void {
    this.document.location.reload();
  }

  private async onNavigationError(event: NavigationError): Promise<void> {
    if (!isRouteChunkError(event.error)) return;

    const url = event.url;
    // Checked BEFORE the in-flight guard: in production this branch is
    // reached in the FRESH document the reload produced (the marker survives
    // in sessionStorage, the guard does not), and that document must be able
    // to give up no matter what else is going on.
    if (this.recoveredUrl() === url) {
      // This URL already got its full page load and the chunk STILL does not
      // load. Reloading again is a loop — surface it instead.
      this.recovering.set(false);
      this.loadFailed.set(true);
      return;
    }

    // A second failure while the reload is already being prepared would only
    // race the first one to `location`.
    if (this.inFlight) return;
    this.inFlight = true;
    this.recovering.set(true);
    this.rememberRecovered(url);
    await this.adoptNewestVersion();
    this.document.location.assign(url);
  }

  /**
   * A navigation succeeded. If it is the URL we reloaded for, the recovery
   * worked and its one-shot is rearmed — otherwise a single bad deploy would
   * disarm that URL for the rest of the browsing session.
   */
  private onNavigationEnd(event: NavigationEnd): void {
    // A navigation completed, so nothing is being recovered any more — reset
    // the in-flight guard too, or one spent recovery would disarm the service
    // for every later failure in this document.
    this.inFlight = false;
    this.recovering.set(false);

    const recovered = this.recoveredUrl();
    if (recovered === null) return;
    if (recovered === event.url || recovered === event.urlAfterRedirects) {
      this.forgetRecovered();
      this.loadFailed.set(false);
    }
  }

  /**
   * Best effort, time-boxed: activate a newer service-worker version before
   * reloading, so the fresh document is not served from the same stale cache
   * that just failed. Never throws and never blocks the reload for long — a
   * hanging update check must not strand the user on a dead click.
   */
  private async adoptNewestVersion(): Promise<void> {
    if (!this.swUpdate?.isEnabled) return;
    try {
      await Promise.race([
        this.checkAndActivate(),
        new Promise<void>((resolve) =>
          setTimeout(resolve, RouteLoadRecoveryService.ADOPT_TIMEOUT_MS),
        ),
      ]);
    } catch {
      // Ignore — the reload below is the recovery; adopting a newer worker
      // only makes it more likely to help.
    }
  }

  private async checkAndActivate(): Promise<void> {
    if (await this.swUpdate!.checkForUpdate()) {
      await this.swUpdate!.activateUpdate();
    }
  }

  private recoveredUrl(): string | null {
    try {
      return (
        this.document.defaultView?.sessionStorage.getItem(
          RouteLoadRecoveryService.RECOVERED_KEY,
        ) ?? null
      );
    } catch {
      // sessionStorage can throw (private mode / disabled storage). Treating it
      // as "not yet recovered" keeps the recovery available; the worst case is
      // one reload that does not help, and the notice never appears.
      return null;
    }
  }

  private rememberRecovered(url: string): void {
    try {
      this.document.defaultView?.sessionStorage.setItem(
        RouteLoadRecoveryService.RECOVERED_KEY,
        url,
      );
    } catch {
      // Ignore — see recoveredUrl().
    }
  }

  private forgetRecovered(): void {
    try {
      this.document.defaultView?.sessionStorage.removeItem(
        RouteLoadRecoveryService.RECOVERED_KEY,
      );
    } catch {
      // Ignore — see recoveredUrl().
    }
  }
}
