// The Fusion bar's pure parts: modes, nav entries, Codex segments, hide/reveal.

import type { PageLayout } from '../../core/layout/page-layout';
import type { CodexKind } from '../../codex/codex.service';
import type { StageSearchState } from './shell-chrome.service';
import { HQ_ROOT, hqHangar, hqLocker, hqOps } from '../../hq/hq-routes';

/** The admin hub: tiles to Benutzer, Telemetrie and the other admin pages. */
export const ADMIN_HUB = '/admin/hub';

/** What the capsule shows — see FusionBarComponent. */
export type BarMode = 'stage' | 'hub' | 'docked' | 'content' | 'tool';

/** The bar mode for a page type and the hub's stage search state. */
export function barModeOf(layout: PageLayout, stage: StageSearchState): BarMode {
  if (layout === 'cinematic') return stage === 'stage' ? 'stage' : stage === 'docked' ? 'docked' : 'hub';
  if (layout === 'tool') return 'tool';
  return 'content';
}

/** Content pages slide the bar away on scroll; tools and hubs keep it. */
export function hidesOnScroll(mode: BarMode): boolean {
  return mode === 'content';
}

/** Pixels scrolled up that bring a hidden bar back (spec: 5–10 px). */
export const REVEAL_UP_PX = 8;

/**
 * Hide/reveal by scroll direction. Hides after more than one bar height of
 * continuous downward scroll (and never within the first bar height of the
 * page), reveals after {@link REVEAL_UP_PX} of upward scroll.
 */
export class HideTracker {
  private lastY = 0;
  private down = 0;
  private up = 0;
  private hidden = false;

  reset(y: number): void {
    this.lastY = y;
    this.down = 0;
    this.up = 0;
    this.hidden = false;
  }

  /** Feed the current scroll position; returns whether the bar should be hidden. */
  update(y: number, barH: number): boolean {
    const dy = y - this.lastY;
    this.lastY = y;
    if (y <= barH) {
      this.down = 0;
      this.up = 0;
      this.hidden = false;
      return false;
    }
    if (dy > 0) {
      this.down += dy;
      this.up = 0;
      if (this.down > barH) this.hidden = true;
    } else if (dy < 0) {
      this.up -= dy;
      this.down = 0;
      if (this.up >= REVEAL_UP_PX) this.hidden = false;
    }
    return this.hidden;
  }
}

export type AreaId = 'verse' | 'codex' | 'hq' | 'starscape' | 'admin';

export interface AreaEntry {
  id: AreaId;
  labelKey: string;
  link: string;
  /** Admin-only (red, says so in words). */
  elevated: boolean;
}

export const AREA_ENTRIES: readonly AreaEntry[] = [
  { id: 'verse', labelKey: 'nav.verse', link: '/verse', elevated: false },
  { id: 'codex', labelKey: 'nav.codex', link: '/codex', elevated: false },
  { id: 'hq', labelKey: 'nav.hq', link: '/hq', elevated: false },
  { id: 'starscape', labelKey: 'nav.starscape', link: '/verse/gallery', elevated: false },
  // Benutzer and Telemetrie merged into one entry: a plain link to the admin hub, whose tiles lead on.
  { id: 'admin', labelKey: 'nav.adminMenu', link: ADMIN_HUB, elevated: true },
];

/**
 * The main pages: the cinematic header (MainHeaderComponent) stands over the
 * scene on exactly these, and a switch between two of them plays the menu
 * switch (content out, camera moves, content in).
 */
export function isMainHeaderPage(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  return path === '/verse' || path === '/codex' || path === HQ_ROOT || path === ADMIN_HUB;
}

/** The main area a URL belongs to (null outside the main areas: settings, friends …). */
export function activeAreaOf(url: string, starscapeEntry: boolean): AreaId | null {
  const path = url.split(/[?#]/, 1)[0];
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (starscapeEntry && (path === '/verse/gallery' || path.startsWith('/verse/gallery/'))) return 'starscape';
  if (path === '/verse' || path.startsWith('/verse/')) return 'verse';
  if (path === '/codex' || path.startsWith('/codex/')) return 'codex';
  if (path === '/hq' || path.startsWith('/hq/')) return 'hq';
  return null;
}

/** One sub-page of a main area, shown as a tab in the capsule (mock d4-s2: „Verse ▾ · News · Patches · Galerie“). */
export interface AreaSection {
  id: string;
  labelKey: string;
  link: string;
  /** Active only on the exact path (an area's overview), not on its children. */
  exact: boolean;
}

/**
 * The sub-pages each area carries in the capsule. They replace the area's own
 * subheader row (HQ tabs) and the full main nav on the hub's sub-pages — the
 * main areas stay one click away in the area menu. Codex has none here: its
 * tool pages carry the kinds ({@link CODEX_SEGMENTS}) instead.
 */
export const AREA_SECTIONS: Readonly<Partial<Record<AreaId, readonly AreaSection[]>>> = {
  verse: [
    { id: 'news', labelKey: 'fusionBar.place.news', link: '/verse/news', exact: false },
    { id: 'patches', labelKey: 'fusionBar.place.patches', link: '/verse/patches', exact: false },
    { id: 'gallery', labelKey: 'fusionBar.place.gallery', link: '/verse/gallery', exact: false },
    { id: 'explorer', labelKey: 'verse.area.starmap', link: '/verse/explorer', exact: false },
  ],
  hq: [
    // Same order and targets as the HQ frame's own tabs (HQ_TABS, β off).
    { id: 'overview', labelKey: 'hq.tabs.overview', link: HQ_ROOT, exact: true },
    { id: 'locker', labelKey: 'hq.tabs.locker', link: hqLocker, exact: false },
    { id: 'hangar', labelKey: 'hq.tabs.hangar', link: hqHangar, exact: false },
    { id: 'ops', labelKey: 'hq.tabs.ops', link: hqOps, exact: false },
  ],
};

/** The section of `sections` the URL is on, or null. */
export function activeSectionOf(url: string, sections: readonly AreaSection[]): string | null {
  const path = url.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  for (const s of sections) {
    if (s.exact ? path === s.link : path === s.link || path.startsWith(`${s.link}/`)) return s.id;
  }
  return null;
}

export type SegmentId ='ship' | 'weapon' | 'component' | 'fps' | 'blueprint' | 'upcoming' | 'keybinds';

export interface CodexSegment {
  id: SegmentId;
  labelKey: string;
  link: string[];
  queryParams: Record<string, string> | null;
  /** Codex category icon; null = the segment draws its own glyph. */
  icon: CodexKind | null;
}

/** The seven Codex kinds as bar segments (spec §4). Real routes — every segment is an anchor. */
export const CODEX_SEGMENTS: readonly CodexSegment[] = [
  { id: 'ship', labelKey: 'codex.kinds.ship', link: ['/codex', 'index'], queryParams: { kind: 'ship' }, icon: 'ship' },
  { id: 'weapon', labelKey: 'codex.kinds.weapon', link: ['/codex', 'index'], queryParams: { kind: 'weapon' }, icon: 'weapon' },
  { id: 'component', labelKey: 'codex.kinds.component', link: ['/codex', 'index'], queryParams: { kind: 'component' }, icon: 'component' },
  { id: 'fps', labelKey: 'fusionBar.kinds.fps', link: ['/codex', 'fps'], queryParams: null, icon: 'item' },
  { id: 'blueprint', labelKey: 'codex.kinds.blueprint', link: ['/codex', 'index'], queryParams: { kind: 'blueprint' }, icon: 'blueprint' },
  { id: 'upcoming', labelKey: 'codex.kinds.upcoming', link: ['/codex', 'upcoming'], queryParams: null, icon: null },
  { id: 'keybinds', labelKey: 'fusionBar.kinds.keybinds', link: ['/codex', 'keybinds'], queryParams: null, icon: null },
];

/** True on the Codex tool pages that carry the kind segments. */
export function isCodexToolPage(url: string): boolean {
  const p = url.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  return p === '/codex/index' || p === '/codex/fps' || p === '/codex/keybinds' || p === '/codex/upcoming';
}

/** The active Codex segment of a URL; null when none applies (another index kind, no Codex tool page). */
export function activeSegmentOf(url: string): SegmentId | null {
  const [path, query = ''] = url.split('#', 1)[0].split('?');
  const p = path.replace(/\/+$/, '');
  if (p === '/codex/fps') return 'fps';
  if (p === '/codex/keybinds') return 'keybinds';
  if (p === '/codex/upcoming') return 'upcoming';
  if (p === '/codex/index') {
    const kind = new URLSearchParams(query).get('kind') ?? 'ship';
    if (kind === 'upcoming') return 'upcoming';
    return (['ship', 'weapon', 'component', 'blueprint'] as const).find((k) => k === kind) ?? null;
  }
  return null;
}
