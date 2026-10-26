// The Fusion bar's pure parts: modes, nav entries, Codex segments, hide/reveal.

import type { PageLayout } from '../../core/layout/page-layout';
import type { CodexKind } from '../../codex/codex.service';
import type { StageSearchState } from './shell-chrome.service';

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

export type AreaId = 'verse' | 'codex' | 'hq' | 'starscape' | 'admin' | 'telemetry';

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
  { id: 'admin', labelKey: 'nav.admin', link: '/admin', elevated: true },
  { id: 'telemetry', labelKey: 'nav.telemetry', link: '/admin/telemetry', elevated: true },
];

/** The main area a URL belongs to (null outside the main areas: settings, friends …). */
export function activeAreaOf(url: string, starscapeEntry: boolean): AreaId | null {
  const path = url.split(/[?#]/, 1)[0];
  if (path === '/admin/telemetry' || path.startsWith('/admin/telemetry/')) return 'telemetry';
  if (path === '/admin') return 'admin';
  if (starscapeEntry && (path === '/verse/gallery' || path.startsWith('/verse/gallery/'))) return 'starscape';
  if (path === '/verse' || path.startsWith('/verse/')) return 'verse';
  if (path === '/codex' || path.startsWith('/codex/')) return 'codex';
  if (path === '/hq' || path.startsWith('/hq/')) return 'hq';
  return null;
}

export type SegmentId = 'ship' | 'weapon' | 'component' | 'fps' | 'blueprint' | 'upcoming' | 'keybinds';

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
