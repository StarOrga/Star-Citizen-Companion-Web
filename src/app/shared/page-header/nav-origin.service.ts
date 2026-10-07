import { EnvironmentProviders, Injectable, inject, provideEnvironmentInitializer, signal } from '@angular/core';
import { NavigationEnd, Params, Router, UrlTree } from '@angular/router';
import { filter } from 'rxjs';

/** One breadcrumb step: a translated label or an i18n key, and where it leads. */
export interface PageCrumb {
  /** Literal text (a ship name, a remembered page title). Wins over `labelKey`. */
  label?: string;
  /** i18n key, translated by the header. */
  labelKey?: string;
  /** routerLink target — a path string or command array. */
  link: string | readonly unknown[];
  queryParams?: Params | null;
}

/** The first crumb of every Codex page. */
export const CODEX_ROOT_CRUMB: PageCrumb = { labelKey: 'pageHeader.crumb.codex', link: '/codex' };
/** The first crumb of every Hangar sub page. */
export const HANGAR_ROOT_CRUMB: PageCrumb = { labelKey: 'pageHeader.crumb.hangar', link: '/hangar' };

/** Where a crumb for a visited page leads: its path plus the query it carried. */
interface VisitedPage {
  path: string;
  queryParams: Params;
}

/** How many navigations are kept — enough to step over filter-only url updates. */
const HISTORY_LIMIT = 40;

/**
 * Remembers where the user came from, so a page's breadcrumb can lead back to
 * THAT page — the index with its filters, the FPS list, the hangar, the ship a
 * component was opened from — instead of always to the Codex front door (audit
 * 2026-10-07: every detail page sent "Zurück" to /codex and threw the index
 * filters away).
 *
 * Every page header also registers its title for its own path, so a crumb back
 * to a detail page can say "Gladius" instead of a generic "Schiff".
 *
 * Instantiated at bootstrap (`provideNavOrigin()`), otherwise the navigations
 * before the first header render would be missed.
 */
@Injectable({ providedIn: 'root' })
export class NavOriginService {
  private readonly router = inject(Router);
  private readonly history: string[] = [];
  private readonly titles = new Map<string, string>();
  /** The current url as a signal, so a computed crumb re-derives on every navigation. */
  private readonly url = signal('');

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.history.push(e.urlAfterRedirects);
        if (this.history.length > HISTORY_LIMIT) this.history.shift();
        this.url.set(e.urlAfterRedirects);
      });
  }

  /**
   * The last page visited before the current one whose PATH differs from the
   * current path — a filter change on the index (`?kind=` / `?q=`) rewrites
   * the url without leaving the page, and those entries must not count as
   * "where I came from".
   */
  previous(): VisitedPage | null {
    const current = this.pathOf(this.url() || this.router.url);
    for (let i = this.history.length - 1; i >= 0; i--) {
      const url = this.history[i];
      if (this.pathOf(url) !== current) return this.parse(url);
    }
    return null;
  }

  /** Records the visible title of the page at `url` (path only, query ignored). */
  rememberTitle(url: string, title: string): void {
    const t = title.trim();
    if (t) this.titles.set(this.pathOf(url), t);
  }

  titleFor(path: string): string | null {
    return this.titles.get(this.pathOf(path)) ?? null;
  }

  private parse(url: string): VisitedPage {
    const tree: UrlTree = this.router.parseUrl(url);
    return { path: this.pathOf(url), queryParams: { ...tree.queryParams } };
  }

  private pathOf(url: string): string {
    const cut = url.search(/[?#]/);
    return cut === -1 ? url : url.slice(0, cut);
  }
}

/** Starts the history at bootstrap. */
export function provideNavOrigin(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    inject(NavOriginService);
  });
}

/**
 * The crumb that leads back to the page the user came from, or `fallback` when
 * there is no such page inside the app area this header belongs to (a deep
 * link, a reload, a jump from the news).
 *
 * Only pages that are a real "parent" in the user's mind qualify: lists
 * (index, FPS, hangar) and other detail pages (ship → component). The Codex
 * front door itself is always the first crumb, so coming from it yields the
 * fallback (the kind's index) — still one step of orientation more than before.
 */
export function originCrumb(origin: NavOriginService, fallback: PageCrumb | null): PageCrumb | null {
  const prev = origin.previous();
  if (!prev) return fallback;
  const p = prev.path;
  const q = Object.keys(prev.queryParams).length ? prev.queryParams : null;
  if (p === '/codex/index' || p === '/codex/upcoming') {
    // Name the category the reader was browsing ("Waffen"), not just "Index".
    const kind = p === '/codex/upcoming' ? 'upcoming' : prev.queryParams['kind'];
    const labelKey = typeof kind === 'string' && /^[a-z]+$/.test(kind) ? `codex.kinds.${kind}` : 'pageHeader.crumb.index';
    return { labelKey, link: p, queryParams: q };
  }
  if (p === '/codex/fps') return { labelKey: 'pageHeader.crumb.fps', link: p, queryParams: q };
  if (p === '/codex/keybinds') return { labelKey: 'pageHeader.crumb.keybinds', link: p, queryParams: q };
  if (p === '/hangar') return { labelKey: 'pageHeader.crumb.hangar', link: p, queryParams: q };
  const isDetail =
    /^\/codex\/(?!index$|fps$|keybinds$|upcoming$)[^/]+\/[^/]+$/.test(p) || /^\/hangar\/ship\/[^/]+$/.test(p);
  if (isDetail) {
    const title = origin.titleFor(p);
    if (title) return { label: title, link: p, queryParams: q };
  }
  return fallback;
}
