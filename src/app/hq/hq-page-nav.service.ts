import { Injectable, computed, inject, signal } from '@angular/core';
import { isPlainLeftClick } from '../core/modified-click.util';
import { ShellChromeService } from '../shell/fusion-bar/shell-chrome.service';
import { HQ_EINSATZ_PARAM, HQ_PAGES, HqPageId, hqPageHref } from './hq-routes';

/** Icon paths (24×24 box, stroke) of the five pages: rail and phone bottom bar. */
export const HQ_PAGE_ICONS: Readonly<Record<HqPageId, string>> = {
  start: 'M3 11.5L12 4l9 7.5M6 10v9h12v-9',
  planen: 'M4 6h16M4 12h10M4 18h6M17 14l3 3-3 3',
  jetzt: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 100 6 3 3 0 000-6z',
  bestand: 'M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4 8-4V8M12 12v8',
  statistik: 'M5 20V11M12 20V5M19 20v-7',
};

/** The digit that jumps to a page: its place after Start (Bestand 1 … Statistik 4). Start has none. */
export function hqPageHotkey(page: HqPageId): number | null {
  const i = HQ_PAGES.indexOf(page);
  return i > 0 ? i : null;
}

/**
 * The glue between the five navigation surfaces (rail, phone bar, cue) and the landing that
 * scrolls: every one of them is a real `<a href="/hq#planen">`; a PLAIN left click is handed to
 * the landing (smooth scroll, one history entry), every modified click (new tab) keeps the
 * browser's own behaviour. `HqPagesComponent` attaches the handler while it is on screen; without
 * it (another route) the click simply follows the href.
 */
@Injectable({ providedIn: 'root' })
export class HqPageNavService {
  private readonly chrome = inject(ShellChromeService);
  private handler: ((page: HqPageId) => void) | null = null;

  readonly pages = HQ_PAGES;
  /** No hover and no hardware keyboard to speak of: hotkey hints stay away. */
  readonly noHover = typeof matchMedia === 'function' && matchMedia('(hover: none), (pointer: coarse)').matches;
  /** The saved Einsatz whose route Planen should open (from the URL or a plain click on "Route öffnen"). */
  readonly routeFocus = signal<{ id: string } | null>(routeFromUrl());
  /** The page in view (Start when the landing has not reported one yet). */
  readonly active = computed<HqPageId>(() => this.chrome.hqPage() ?? 'start');

  /** The landing registers how to go to a page; returns the unregister function. */
  attach(handler: (page: HqPageId) => void): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }

  href(page: HqPageId): string {
    return hqPageHref(page);
  }

  /** Go to a page from code (the landing scrolls; off the landing nothing is attached). */
  open(page: HqPageId): void {
    this.handler?.(page);
  }

  /** `(click)` of an anchor that opens exactly one route; a modified click follows its href. */
  openRoute(ev: MouseEvent, id: string): void {
    if (!this.handler || !isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.routeFocus.set({ id });
    this.handler('planen');
  }

  /** `(click)` of every page anchor. */
  go(ev: MouseEvent, page: HqPageId): void {
    if (!this.handler || !isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.handler(page);
  }
}

function routeFromUrl(): { id: string } | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get(HQ_EINSATZ_PARAM);
  return id ? { id } : null;
}
