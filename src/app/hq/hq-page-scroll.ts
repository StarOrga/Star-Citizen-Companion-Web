import { NgZone } from '@angular/core';
import { typing, wireSnap } from '../verse/pages/briefing/briefing-dock';
import { HQ_PAGES, HqPageId } from './hq-routes';

/** From here on the rail stands beside the pages; below it the phone bar and touch scrolling rule. */
export const PAGE_SCROLL_MIN_WIDTH = 1024;

/**
 * Whole-page scrolling on the HQ landing, as native CSS scroll-snap (concept Kamera-Welt S6,
 * the same mechanism as the Verse hub, `wireSnap` in `briefing-dock.ts`): every HQ page is a snap
 * area, so a gesture on a page that fits the viewport finishes on the next one and a scroll never
 * rests with half of two pages on screen. A page TALLER than the viewport is an oversized snap
 * area and scrolls freely until its end, so its lower part stays readable. The footer under the
 * last page snaps with its end edge. The browser does it on the compositor: no wheel/key
 * listeners, no scripted glide. Only with the rail (wide screens) and without reduced motion.
 */
export function wireHqPageScroll(sections: () => readonly HTMLElement[], zone: NgZone): () => void {
  return wireSnap(sections, {
    minWidth: PAGE_SCROLL_MIN_WIDTH,
    end: () => document.querySelector<HTMLElement>('sc-footer'),
    zone,
  });
}

const OPEN_DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';

function dialogOpen(): boolean {
  return Array.from(document.querySelectorAll(OPEN_DIALOG)).some((d) => d.checkVisibility?.() ?? true);
}

/** The page a key press jumps to: digits 1 to 4, never with a modifier, while typing or under a dialog. */
export function hotkeyPage(e: KeyboardEvent, underDialog: boolean = dialogOpen()): HqPageId | null {
  if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (!/^[1-4]$/.test(e.key) || underDialog || typing(e.target as Element | null)) return null;
  return HQ_PAGES[Number(e.key)] ?? null;
}

/** Hotkeys 1 to 4 on the landing: Bestand, Jetzt, Planen, Statistik. */
export function wireHqPageHotkeys(go: (page: HqPageId) => void, zone: NgZone): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const page = hotkeyPage(e);
    if (!page) return;
    e.preventDefault();
    zone.run(() => go(page));
  };
  zone.runOutsideAngular(() => window.addEventListener('keydown', onKey));
  return () => window.removeEventListener('keydown', onKey);
}
