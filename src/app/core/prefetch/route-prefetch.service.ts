import {
  DOCUMENT,
  DestroyRef,
  EnvironmentInjector,
  EnvironmentProviders,
  Injectable,
  NgZone,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { logWarn } from '../log';
import { PREFETCH_WARMERS, PrefetchBudget, PrefetchConnection, PrefetchWarmer, prefetchBudget } from './prefetch.model';
import { loadRouteCode } from './route-code';

/** How long the pointer must rest on a link before it counts as intent (a sweep across a menu does not). */
export const HOVER_INTENT_MS = 80;
/**
 * Quiet window after a navigation ends: the camera flight (1100 ms) and the arriving
 * page's first render own the main thread, so idle prefetches wait it out.
 */
export const FLIGHT_QUIET_MS = 1300;
/** Longest an idle prefetch may be put off before it runs anyway. */
const IDLE_TIMEOUT_MS = 400;

/** One planned prefetch: the destination path and whether it waits for an idle period. */
interface Job {
  readonly path: string;
  readonly urgent: boolean;
}

/**
 * Prefetches the destination of an in-app link on intent — hover (after
 * {@link HOVER_INTENT_MS}), keyboard focus or press (pointerdown / touchstart) —
 * so the click finds the route's lazy chunks evaluated and its first data in the
 * root services, and the camera flight no longer loads code or parses JSON mid-way.
 *
 * - One document-level delegated listener (capture, passive), outside the Angular
 *   zone: no template knows about it, every `<a href>` in the app is covered.
 * - Code: {@link loadRouteCode} walks the router config and calls the matched
 *   routes' `loadComponent` / `loadChildren` once per route.
 * - Data: registered {@link PrefetchWarmer}s (multi token {@link PREFETCH_WARMERS}),
 *   only for a signed-in reader, once per warmer key and session.
 * - Hover and focus wait for an idle period and never start during a navigation or
 *   its {@link FLIGHT_QUIET_MS} window; a press runs at once (the click follows in
 *   ~100 ms, so the earlier start is the whole point).
 * - Save-Data or 2G: nothing; 3G: code only (see {@link prefetchBudget}).
 */
@Injectable({ providedIn: 'root' })
export class RoutePrefetchService {
  private readonly doc = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly router = inject(Router);
  private readonly injector = inject(EnvironmentInjector);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly warmers: readonly PrefetchWarmer[] = inject(PREFETCH_WARMERS, { optional: true }) ?? [];

  /** Paths whose code is loaded or loading. */
  private readonly codeDone = new Set<string>();
  /** Warmer keys already started this session. */
  private readonly warmed = new Set<string>();
  /** Idle jobs waiting for their turn (dropped when a navigation starts). */
  private readonly queued = new Set<string>();
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverAnchor: HTMLAnchorElement | null = null;
  private navigating = false;
  private quietUntil = 0;
  private started = false;

  /** Starts listening. Idempotent; no-op outside a browser. */
  start(): void {
    const win = this.doc.defaultView;
    if (this.started || !win) return;
    this.started = true;
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    const over = (e: PointerEvent): void => this.onOver(e);
    const out = (e: PointerEvent): void => this.onOut(e);
    const focus = (e: FocusEvent): void => this.onIntent(e.target, false);
    const press = (e: Event): void => this.onIntent(e.target, true);
    this.zone.runOutsideAngular(() => {
      this.doc.addEventListener('pointerover', over, opts);
      this.doc.addEventListener('pointerout', out, opts);
      this.doc.addEventListener('focusin', focus, opts);
      this.doc.addEventListener('pointerdown', press, opts);
      this.doc.addEventListener('touchstart', press, opts);
    });
    const sub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.navigating = true;
        // Whatever waited for idle is stale now: the reader chose. A later intent re-queues it.
        for (const path of this.queued) this.codeDone.delete(path);
        this.queued.clear();
        this.clearHover();
      } else if (e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError) {
        this.navigating = false;
        this.quietUntil = now() + FLIGHT_QUIET_MS;
      }
    });
    this.destroyRef.onDestroy(() => {
      sub.unsubscribe();
      this.clearHover();
      this.doc.removeEventListener('pointerover', over, opts);
      this.doc.removeEventListener('pointerout', out, opts);
      this.doc.removeEventListener('focusin', focus, opts);
      this.doc.removeEventListener('pointerdown', press, opts);
      this.doc.removeEventListener('touchstart', press, opts);
    });
  }

  /** Prefetches `href` now (code and, when allowed, data). Exposed for callers that know the next step. */
  prefetch(href: string): Promise<void> {
    const path = this.pathOf(href);
    return path ? this.run({ path, urgent: true }) : Promise.resolve();
  }

  private onOver(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const a = anchorOf(e.target);
    if (!a || a === this.hoverAnchor) return;
    this.clearHover();
    this.hoverAnchor = a;
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      this.onIntent(a, false);
    }, HOVER_INTENT_MS);
  }

  private onOut(e: PointerEvent): void {
    const a = this.hoverAnchor;
    if (!a || anchorOf(e.target) !== a) return;
    const to = e.relatedTarget as Node | null;
    if (to && a.contains(to)) return;
    this.clearHover();
  }

  private clearHover(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
    this.hoverAnchor = null;
  }

  private onIntent(target: EventTarget | null, urgent: boolean): void {
    const a = anchorOf(target);
    if (!a || !eligible(a)) return;
    const path = this.pathOf(a.href);
    if (!path) return;
    const job: Job = { path, urgent };
    if (urgent) void this.run(job);
    else this.queue(job);
  }

  /** Same-origin, in-app path of `href` without query or fragment; null for the current page or a foreign link. */
  private pathOf(href: string): string | null {
    const loc = this.doc.location;
    let url: URL;
    try {
      url = new URL(href, loc.href);
    } catch {
      return null;
    }
    if (url.origin !== loc.origin || url.pathname === loc.pathname) return null;
    return url.pathname;
  }

  private budget(): PrefetchBudget {
    const nav = this.doc.defaultView?.navigator as (Navigator & { connection?: PrefetchConnection }) | undefined;
    return prefetchBudget(nav?.connection);
  }

  private queue(job: Job): void {
    if (this.budget() === 'none' || this.queued.has(job.path) || this.isDone(job.path)) return;
    this.queued.add(job.path);
    this.whenQuiet(() => {
      if (!this.queued.delete(job.path)) return;
      void this.run(job);
    });
  }

  private isDone(path: string): boolean {
    return this.codeDone.has(path) && this.matching(path, false).every((w) => this.warmed.has(this.keyOf(w, path)));
  }

  /** Calls `fn` in an idle period outside any navigation and its quiet window. */
  private whenQuiet(fn: () => void): void {
    const win = this.doc.defaultView;
    if (!win) return;
    this.zone.runOutsideAngular(() => {
      const attempt = (): void => {
        const wait = this.navigating ? FLIGHT_QUIET_MS : this.quietUntil - now();
        if (wait > 0) {
          win.setTimeout(attempt, wait);
          return;
        }
        const idle = (cb: () => void): void => {
          if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS });
          else win.setTimeout(cb, 30);
        };
        idle(() => (this.navigating || this.quietUntil > now() ? attempt() : fn()));
      };
      attempt();
    });
  }

  private async run(job: Job): Promise<void> {
    const budget = this.budget();
    if (budget === 'none') return;
    const { path } = job;
    if (!this.codeDone.has(path)) {
      this.codeDone.add(path);
      const segments = path.split('/').filter(Boolean).map(safeDecode);
      await this.zone.runOutsideAngular(() => loadRouteCode(this.router.config, segments, this.injector)).catch((err) => {
        this.codeDone.delete(path);
        logWarn('prefetch', 'route code failed', { path, err });
      });
    }
    if (budget !== 'all' || !this.auth.isAuthenticated()) return;
    for (const w of this.matching(path, job.urgent)) {
      const key = this.keyOf(w, path);
      if (this.warmed.has(key)) continue;
      this.warmed.add(key);
      try {
        await this.zone.run(() => w.warm(this.injector, path));
      } catch (err) {
        this.warmed.delete(key);
        logWarn('prefetch', 'warmer failed', { id: w.id, path, err });
      }
    }
  }

  private matching(path: string, urgent: boolean): PrefetchWarmer[] {
    return this.warmers.filter((w) => {
      if (w.trigger === 'press' && !urgent) return false;
      try {
        return w.matches(path);
      } catch {
        return false;
      }
    });
  }

  private keyOf(w: PrefetchWarmer, path: string): string {
    return `${w.id}:${w.key ? w.key(path) : ''}`;
  }
}

/** The link an event happened in, if any. */
function anchorOf(target: EventTarget | null): HTMLAnchorElement | null {
  const el = target instanceof Element ? target : null;
  const a = el?.closest('a[href]');
  return a instanceof HTMLAnchorElement ? a : null;
}

/** Links that open elsewhere, download or opted out are not prefetched. */
function eligible(a: HTMLAnchorElement): boolean {
  if (a.hasAttribute('download') || a.hasAttribute('data-no-prefetch')) return false;
  const target = a.getAttribute('target');
  return !target || target === '_self';
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/**
 * Turns on intent prefetching app-wide with the given data warmers. Register once in
 * app.config.ts; the listener starts with the app.
 */
export function provideRoutePrefetch(...warmers: PrefetchWarmer[]): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: PREFETCH_WARMERS, useValue: warmers },
    provideEnvironmentInitializer(() => inject(RoutePrefetchService).start()),
  ]);
}
