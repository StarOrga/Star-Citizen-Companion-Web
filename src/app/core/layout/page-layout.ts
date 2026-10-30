import { ActivatedRouteSnapshot, Data } from '@angular/router';
import { OVERLAY_ROUTE_DATA } from '../overlay-route-scroll';

/**
 * The page type of a route (concept 2026-10-25-header-footer-subheader-analyse,
 * rounds 1-2), declared as `data: { layout }` on every route:
 *
 *  - `cinematic` stage pages (hubs and their cinematic sub pages, login, settings)
 *  - `content`   long-form reading / detail pages
 *  - `tool`      lists, filters, planners, admin screens
 *  - `overlay`   pages that are really a popup-detail
 *  - `plain`     legal and form pages
 *
 * The shell derives bar state, footer mode and width track from it
 * (`LayoutService`); there is no URL sniffing in the new shell.
 */
export type PageLayout = 'cinematic' | 'content' | 'tool' | 'overlay' | 'plain';

export const PAGE_LAYOUTS: readonly PageLayout[] = ['cinematic', 'content', 'tool', 'overlay', 'plain'];

/** Used when no route on the active chain declares a layout. */
export const DEFAULT_PAGE_LAYOUT: PageLayout = 'content';

/** The key under which a route declares its layout: `data: { [LAYOUT_DATA]: 'tool' }`. */
export const LAYOUT_DATA = 'layout';

/**
 * Width track of the shared page frame per layout (`.sc-track-*`, styles.scss
 * "PAGE FRAME"). The beta has exactly TWO page widths (concept
 * 2026-10-30-beta-breiten-popups-seiten):
 *
 *  - A, the stage (`stage`, 100% − 2·Rand): only the first, unscrolled view
 *    of a stage hub. A cinematic route spans `full` (its backdrop runs edge
 *    to edge) and the hub places its first view in A (`.sc-stage-a`) and
 *    every section below it in B (`.sc-below-stage`).
 *  - B, the subheader width (`narrow`, `--sc-b-w`): every other layout —
 *    content, tool, plain and overlay alike. The docked subheader has exactly
 *    this width, so the content stands under it.
 *
 * `measure` caps running text inside B; it is a column, not a page width.
 */
export type PageTrack = 'full' | 'stage' | 'narrow' | 'measure';

export const LAYOUT_TRACK: Readonly<Record<PageLayout, PageTrack>> = {
  cinematic: 'full',
  content: 'narrow',
  tool: 'narrow',
  overlay: 'narrow',
  plain: 'narrow',
};

export function isPageLayout(value: unknown): value is PageLayout {
  return typeof value === 'string' && (PAGE_LAYOUTS as readonly string[]).includes(value);
}

/** Reads a layout out of route data; `null` if the route declares none. */
export function layoutOfData(data: Data | undefined): PageLayout | null {
  const v = data?.[LAYOUT_DATA];
  return isPageLayout(v) ? v : null;
}

/**
 * The layout of the active route chain: the DEEPEST route that declares one
 * wins (a child overrides its parent). A routed overlay child
 * (`OVERLAY_ROUTE_DATA`, e.g. the patch dossier over the patch board) does
 * not change the page underneath it, so its own layout is skipped.
 * No declaration anywhere -> `DEFAULT_PAGE_LAYOUT`.
 */
export function layoutOfSnapshot(root: ActivatedRouteSnapshot): PageLayout {
  let found: PageLayout | null = null;
  for (let node: ActivatedRouteSnapshot | null = root; node; node = node.firstChild) {
    const data = node.routeConfig?.data;
    if (data?.[OVERLAY_ROUTE_DATA]) break;
    found = layoutOfData(data) ?? found;
  }
  return found ?? DEFAULT_PAGE_LAYOUT;
}
