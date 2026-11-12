import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { onScrollTick } from '../core/scroll-tick';
import { pageScrollY } from '../core/page-scroll-y';
import { SceneCameraService } from '../shell/scene/scene-camera.service';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, Scroll } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ShellChromeService } from '../shell/fusion-bar/shell-chrome.service';
import { HqCueComponent } from './hq-cue.component';
import { wireHqPageHotkeys, wireHqPageScroll } from './hq-page-scroll';
import { HqNowComponent } from './now/hq-now.component';
import { HqLiveTickerComponent } from './now/hq-live-ticker.component';
import { HangarService } from '../hangar/hangar.service';
import { HqInventoryService } from './data/hq-inventory.service';
import { NachschubService } from './nachschub/nachschub.service';
import { HqPageBarComponent } from './hq-page-bar.component';
import { HqPageNavService } from './hq-page-nav.service';
import { HqPlanComponent } from './plan/hq-plan.component';
import { HqRailComponent } from './hq-rail.component';
import { HQ_EINSATZ_PARAM, HQ_PAGES, HqPageId, hqPageHref, hqPageOfFragment } from './hq-routes';
import { HqStartFeedService } from './start/hq-start-feed.service';
import { HqStartComponent } from './start/hq-start.component';
import { HqStatsComponent } from './stats/hq-stats.component';
import { HqStockComponent } from './stock/hq-stock.component';

/** Inventar, Jetzt, Planen, Statistik: the pages after Start. */
const FOLLOW_PAGES = HQ_PAGES.length - 1;
/** At the latest this long after the route's first render the follow pages are built, flight or not. */
const FLIGHT_WAIT_MS = 2500;
/** An idle callback that never comes (a busy page) runs the next build step after this long. */
const BUILD_IDLE_TIMEOUT_MS = 400;

/**
 * The HQ landing (beta shell, concept D1–D6): ONE route, five Verse-like scroll stages —
 * Start · Bestand · Jetzt · Planen · Statistik — as `<section id="…">`, so `/hq#planen` is a real
 * anchor (router anchor scrolling does the deep link, back/forward and the initial landing).
 *
 * - The page in view comes from an IntersectionObserver on the viewport's middle line. It is
 *   published as `ShellChromeService.hqPage` (the search context, the rail, the bottom bar) and
 *   mirrored into the URL fragment with `replaceState` — scrolling never adds a history entry
 *   (a click on a page anchor adds exactly one).
 * - Start is the cinematic main page (hero search in the scene, no subheader). The follow pages
 *   stand under the docked subheader: the bar condenses by scroll depth like on every main page,
 *   and the page column is the subheader's width (`.sc-below-stage` = `--sc-b-w`).
 * - The footer is the shell's own and comes after the last page, Statistik.
 * - One page at a time (`hq-page-scroll.ts`): native CSS scroll-snap finishes every wheel, key or
 *   touch gesture on a page; the cue at the viewport's bottom edge leads to the next one.
 * - Built in steps (Kamera-Welt r6-oq-first-render): the route renders Start only, so the frame the
 *   camera flight starts in stays short. The four follow pages lie below the fold in their
 *   viewport-tall sections; they are built one per idle frame once the flight has landed
 *   (`SceneCameraService.flying()` false). Anything that heads for them (a scroll, a rail / bar /
 *   cue click, a hotkey, a deep link, back/forward) builds them all at once first.
 */
@Component({
  selector: 'sc-hq-pages',
  standalone: true,
  imports: [
    TranslatePipe,
    HqRailComponent,
    HqPageBarComponent,
    HqCueComponent,
    HqStartComponent,
    HqPlanComponent,
    HqNowComponent,
    HqStockComponent,
    HqStatsComponent,
    HqLiveTickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-hq-rail />
    <section id="start" class="page start sc-stage-a" data-hq-page="start" [attr.aria-label]="'hq.pages.start' | translate">
      <sc-hq-start [patch]="feed.patchHit()" />
    </section>
    <section id="inventar" class="page follow sc-below-stage" data-hq-page="inventar" aria-labelledby="hq-stock-title">
      @if (built() > 0) { <sc-hq-stock /> }
    </section>
    <section id="jetzt" class="page follow sc-below-stage" data-hq-page="jetzt" aria-labelledby="hq-now-title">
      @if (built() > 1) { <sc-hq-now /> }
    </section>
    <section id="planen" class="page follow sc-below-stage" data-hq-page="planen" aria-labelledby="hq-plan-title">
      @if (built() > 2) { <sc-hq-plan /> }
    </section>
    <section id="statistik" class="page follow last sc-below-stage" data-hq-page="statistik" aria-labelledby="hq-stats-title">
      @if (built() > 3) { <sc-hq-stats /> }
    </section>
    @if (nextPage(); as next) {
      <sc-hq-cue class="page-cue" [class.gone]="!cueFree()" [target]="next" />
    }
    <sc-hq-page-bar />
    <sc-hq-live-ticker [page]="chrome.hqPage()" />
  `,
  styles: [
    `
      :host { display: block; }
      .page { box-sizing: border-box; min-height: 100svh; }
      /* Start begins under the shell header; with the cue it must fit the rest of the viewport (D5). */
      .start { min-height: calc(100svh - var(--hq-start-top, 0px)); }
      /* A follow page stands under the docked subheader: its content starts below the bar. */
      /* Its own padding already clears the bar, so it cancels the global scroll-padding: rail click,
         deep link and back/forward all land the section at the viewport top. */
      .follow { scroll-margin-top: calc(-1 * var(--sc-bar-h, 64px)); padding-top: calc(var(--sc-bar-h, 64px) + var(--sc-space-7, 48px)); padding-bottom: var(--sc-space-6, 32px); }
      /* The room a page's content has on desktop: the viewport minus the bar, the top padding and the bottom padding. Pages
         size themselves to it (height: var(--hq-page-h)) and scroll inside their panels, never as a page. */
      @media (min-width: 1024px) { .follow { --hq-page-h: calc(100svh - var(--sc-bar-h, 64px) - var(--sc-space-7, 48px) - var(--sc-space-8, 64px) - var(--sc-space-5, 24px)); } }
      /* Room after the last page, before the footer. */
      .last { padding-bottom: var(--sc-space-8, 64px); }
      /* The shell footer follows in flow: the last page leaves its height out of the viewport-tall minimum, so page + footer fill exactly one screen and the document does not scroll on past the content. */
      .last { min-height: calc(100svh - var(--sc-footer-h, 56px) - var(--sc-safe-bottom, 0px)); }
      /* The way on stands at the viewport's bottom edge on every page; the phone bar does that job below 1024px. */
      .page-cue { position: fixed; z-index: 3; inset-inline: 0; bottom: max(8px, 0.8vw); pointer-events: none; transition: opacity 0.25s, visibility 0.25s; }
      /* Like the Verse cue it has no ground, so it stands back while page content lies beneath it. */
      .page-cue.gone { opacity: 0; visibility: hidden; }
      @media (prefers-reduced-motion: reduce) { .page-cue { transition: none; } }
      /* The fixed rail stands left of the frame: keep its lane free where the frame's gutter is narrower. */
      @media (min-width: 1024px) { .page { padding-inline-start: max(0px, calc(var(--hq-rail-clear) - var(--sc-page-gutter))); } }
      @media (min-width: 1024px) { .follow { padding-bottom: calc(var(--sc-space-8, 64px) + var(--sc-space-5, 24px)); } }
      @media (max-width: 1023px) { .page-cue { display: none; } }
      /* From the rail's breakpoint the left page rail (24px inset + 36px wide) stands in the page margin. Where that margin is
         narrower than the rail's lane (up to ~1440px) the content's left edge makes room for it, so no card lies under an icon;
         the right edge stays on the subheader's. From ~1440px the margin is wide enough and this is 0. */
      @media (min-width: 1024px) { .follow { padding-inline-start: max(0px, calc(max(var(--sc-fab-inset, 24px), env(safe-area-inset-left, 0px)) + 36px + var(--sc-space-2, 8px) - (100% - var(--sc-b-w)) / 2)); } }
      /* The app-status chip (32px, 48px on a touch screen) floats above the page bar (tablet) / the fusion and page bars (phone): the page's own end keeps
         that lane free, so its last control scrolls clear of the chip instead of standing under it. */
      @media (max-width: 1023px) { .follow { padding-bottom: calc(12px + var(--sc-safe-bottom, 0px) + 58px + 2 * var(--sc-space-2, 8px) + 48px); } }
      @media (max-width: 720px) { .follow { padding-bottom: calc(var(--sc-float-bottom, 16px) + var(--sc-bar-h, 56px) + 58px + 3 * var(--sc-space-2, 8px) + 48px + var(--sc-space-2, 8px)); } }
    `,
  ],
})
export class HqPagesComponent {
  protected readonly feed = inject(HqStartFeedService);
  protected readonly chrome = inject(ShellChromeService);
  private readonly nachschub = inject(NachschubService);
  private readonly inventory = inject(HqInventoryService);
  private readonly hangar = inject(HangarService);
  private readonly nav = inject(HqPageNavService);
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly camera = inject(SceneCameraService);

  /** How many follow pages (Inventar, Jetzt, Planen, Statistik) stand: Start comes with the route. */
  protected readonly built = signal(0);
  /** Cancels the pending step of the stepwise build. */
  private stopBuild: (() => void) | null = null;
  private cueFrame = 0;

  /** Where the cue leads: the page after the one in view; the last page has none. */
  protected readonly nextPage = computed<HqPageId | null>(() => {
    const i = HQ_PAGES.indexOf(this.chrome.hqPage() ?? 'start');
    return HQ_PAGES[i + 1] ?? null;
  });

  /** The end of the page in view is on screen, so nothing but its bottom padding lies under the cue. */
  protected readonly cueFree = signal(true);

  /** Inventar and Hangar are loaded: Nachschub lines may be compared against them. */
  private readonly stockReady = signal(false);

  constructor() {
    // A deep link to a follow page: every page up to it must stand before the landing scroll.
    const deep = hqPageOfFragment(this.route.snapshot.fragment);
    if ((deep && deep !== 'start') || typeof requestAnimationFrame !== 'function') this.built.set(FOLLOW_PAGES);
    effect(() => {
      this.chrome.hqPage();
      // A frame later: a rect read in the route's first frame would force its whole layout early.
      this.queueCue();
    });
    // A finished Nachschub archives itself: whenever Inventar or Hangar change, close the lines that rose (r4 s3-a1).
    // Only against stock that really loaded: a baseline taken from an empty, not yet loaded stock would close lines later.
    void this.nachschub.ensureLoaded();
    void Promise.all([this.inventory.load(), this.hangar.loadAll()]).then(() =>
      this.stockReady.set(this.inventory.loaded() && !this.inventory.error() && !this.hangar.error()),
    );
    effect(() => {
      this.inventory.items();
      this.hangar.ships();
      if (!this.stockReady() || !this.nachschub.loaded()) return;
      untracked(() => void this.nachschub.reconcile());
    });
    this.chrome.setHqPage(hqPageOfFragment(this.route.snapshot.fragment) ?? 'start');
    effect(() => {
      const page = this.chrome.hqPage();
      if (page) this.syncUrl(page);
    });
    const detach = this.nav.attach((p) => this.goTo(p));
    // Back / forward and fragment links run as router navigations; the app's scroll policy
    // (OverlayRouteScrollService) answers their Scroll event with a jump to the top. Land on the
    // page the fragment names afterwards, on the next frame.
    const nav = this.router.events.subscribe((e) => {
      if (!(e instanceof Scroll)) return;
      const land = () => {
        // The address bar, not the router URL: rail clicks move the fragment past the router.
        const page = hqPageOfFragment(typeof window === 'undefined' ? null : window.location.hash.slice(1)) ?? 'start';
        // The route's own arrival lands on Start and leaves the stepwise build alone.
        if (page !== 'start') this.buildAll();
        this.scrollTo(page, false);
        this.chrome.setHqPage(page);
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(land);
      else land();
    });
    this.destroyRef.onDestroy(() => nav.unsubscribe());
    if (typeof window !== 'undefined') {
      const onResize = () => this.measureStartTop();
      window.addEventListener('resize', onResize, { passive: true });
      this.destroyRef.onDestroy(() => window.removeEventListener('resize', onResize));
    }
    this.destroyRef.onDestroy(() => {
      this.stopBuild?.();
      if (this.cueFrame) cancelAnimationFrame(this.cueFrame);
      detach();
      this.chrome.setHqPage(null);
    });

    afterNextRender(() => {
      // Deep link: land on the page before the observer reports anything (else it would report
      // Start and rewrite the fragment away).
      const target = hqPageOfFragment(this.route.snapshot.fragment);
      this.measureStartTop();
      if (target && target !== 'start') this.scrollTo(target, false);
      this.observe();
      const unwire = wireHqPageScroll(
        () => HQ_PAGES.flatMap((p) => this.section(p) ?? []),
        this.zone,
      );
      this.destroyRef.onDestroy(unwire);
      this.destroyRef.onDestroy(this.watchCue());
      this.destroyRef.onDestroy(wireHqPageHotkeys((p) => this.goTo(p), this.zone));
      this.buildInSteps();
    });
  }

  /** Builds every follow page now, ahead of a scroll or a jump to one of them. */
  private buildAll(): void {
    if (this.built() >= FOLLOW_PAGES) return;
    this.stopBuild?.();
    this.zone.run(() => this.built.set(FOLLOW_PAGES));
  }

  /**
   * Builds the follow pages one per idle frame once the camera flight has landed. The first frames
   * after the route only wait: the flight starts in them. A flight that never reports its end does
   * not hold the pages back past FLIGHT_WAIT_MS.
   */
  private buildInSteps(): void {
    if (this.built() >= FOLLOW_PAGES || typeof requestAnimationFrame !== 'function') return;
    const idle = typeof requestIdleCallback === 'function';
    const since = performance.now();
    let frames = 0;
    let frame = 0;
    let idleId = 0;
    const stop = (): void => {
      cancelAnimationFrame(frame);
      if (idleId) cancelIdleCallback(idleId);
      frame = idleId = 0;
      this.stopBuild = null;
    };
    const step = (): void => {
      idleId = 0;
      if (this.built() < FOLLOW_PAGES) this.zone.run(() => this.built.update((n) => n + 1));
      // The next page in a later frame, so this one lays out and paints on its own.
      if (this.built() < FOLLOW_PAGES) frame = requestAnimationFrame(next);
      else stop();
    };
    const next = (): void => {
      frame = 0;
      if (idle) idleId = requestIdleCallback(step, { timeout: BUILD_IDLE_TIMEOUT_MS });
      else frame = requestAnimationFrame(step);
    };
    const wait = (): void => {
      frames += 1;
      if ((frames > 2 && !this.camera.flying()) || performance.now() - since > FLIGHT_WAIT_MS) next();
      else frame = requestAnimationFrame(wait);
    };
    this.stopBuild = stop;
    this.zone.runOutsideAngular(() => (frame = requestAnimationFrame(wait)));
  }

  private queueCue(): void {
    if (typeof requestAnimationFrame !== 'function') return this.measureCue();
    if (this.cueFrame) return;
    this.zone.runOutsideAngular(() => {
      this.cueFrame = requestAnimationFrame(() => {
        this.cueFrame = 0;
        this.measureCue();
      });
    });
  }

  private section(page: HqPageId): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`[data-hq-page="${page}"]`);
  }

  /** Plain left click on a rail / bar / cue anchor: scroll there and add ONE history entry. */
  private goTo(page: HqPageId): void {
    this.buildAll();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.scrollTo(page, !reduced);
    const url = this.urlFor(page);
    if (this.currentUrl() !== url) this.location.go(url);
    this.chrome.setHqPage(page);
  }

  /** One scroll path for rail / bar / cue clicks, deep links and back/forward. */
  private scrollTo(page: HqPageId, smooth: boolean): void {
    if (page === 'start' && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
      return;
    }
    this.section(page)?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  }

  /** Where Start begins (under the shell header), so Start plus its cue fit one viewport. */
  private measureStartTop(): void {
    const start = this.section('start');
    if (!start || typeof window === 'undefined') return;
    const top = Math.max(0, Math.round(start.getBoundingClientRect().top + window.scrollY));
    this.host.nativeElement.style.setProperty('--hq-start-top', `${top}px`);
  }

  /** A long page keeps the cue away until its end is in view: on scroll, and when its content grows. */
  private watchCue(): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const queue = (): void => this.queueCue();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(queue);
    this.zone.runOutsideAngular(() => {
      window.addEventListener('resize', queue, { passive: true });
      ro?.observe(this.host.nativeElement);
    });
    const offScroll = onScrollTick(() => {
      // Scrolled away from Start before the stepwise build is done: the pages below are wanted now.
      // pageScrollY, not window.scrollY: under a modal's scroll block that reads 0 (#336).
      if (pageScrollY() > 0) this.buildAll();
      this.measureCue();
    });
    this.queueCue();
    return () => {
      offScroll();
      window.removeEventListener('resize', queue);
      ro?.disconnect();
    };
  }

  private measureCue(): void {
    const section = this.section(this.chrome.hqPage() ?? 'start');
    if (!section || typeof window === 'undefined') return;
    const free = section.getBoundingClientRect().bottom <= window.innerHeight + 2;
    if (free !== this.cueFree()) this.zone.run(() => this.cueFree.set(free));
  }

  private urlFor(page: HqPageId): string {
    const base = hqPageHref(page);
    const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    // The route focus belongs to Planen; another page's URL does not carry it along.
    if (page !== 'planen') params.delete(HQ_EINSATZ_PARAM);
    const search = params.size ? `?${params}` : '';
    if (!search) return base;
    const [path, hash] = base.split('#');
    return hash ? `${path}${search}#${hash}` : `${path}${search}`;
  }

  private currentUrl(): string {
    return typeof window === 'undefined' ? '' : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  /** Scrolling replaces the fragment, never pushes. */
  private syncUrl(page: HqPageId): void {
    if (typeof window === 'undefined') return;
    const url = this.urlFor(page);
    if (this.currentUrl() === url) return;
    this.location.replaceState(url, '', this.location.getState());
  }

  private observe(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    const root = this.host.nativeElement;
    // The page crossing the viewport's middle line is the page in view.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const page = hqPageOfFragment((e.target as HTMLElement).dataset['hqPage']);
          if (page && page !== this.chrome.hqPage()) this.zone.run(() => this.chrome.setHqPage(page));
        }
      },
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 },
    );
    for (const p of HQ_PAGES) {
      const el = root.querySelector(`[data-hq-page="${p}"]`);
      if (el) io.observe(el);
    }
    this.destroyRef.onDestroy(() => io.disconnect());
  }
}
