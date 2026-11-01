import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  effect,
  inject,
} from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ShellChromeService } from '../shell/fusion-bar/shell-chrome.service';
import { HqNowComponent } from './now/hq-now.component';
import { HqPageBarComponent } from './hq-page-bar.component';
import { HqPageNavService } from './hq-page-nav.service';
import { HqPlanComponent } from './plan/hq-plan.component';
import { HqRailComponent } from './hq-rail.component';
import { HQ_PAGES, HqPageId, hqPageHref, hqPageOfFragment } from './hq-routes';
import { HqStartFeedService } from './start/hq-start-feed.service';
import { HqStartComponent } from './start/hq-start.component';
import { HqStatsComponent } from './stats/hq-stats.component';
import { HqStockComponent } from './stock/hq-stock.component';

/**
 * The HQ landing (beta shell, concept D1–D6): ONE route, five Verse-like scroll stages —
 * Start · Planen · Jetzt · Bestand · Statistik — as `<section id="…">`, so `/hq#planen` is a real
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
 */
@Component({
  selector: 'sc-hq-pages',
  standalone: true,
  imports: [
    TranslatePipe,
    HqRailComponent,
    HqPageBarComponent,
    HqStartComponent,
    HqPlanComponent,
    HqNowComponent,
    HqStockComponent,
    HqStatsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-hq-rail />
    <section id="start" class="page start sc-stage-a" data-hq-page="start" [attr.aria-label]="'hq.pages.start' | translate">
      <sc-hq-start [patchLines]="feed.patchLines()" [chips]="feed.chips()" />
    </section>
    <section id="planen" class="page follow sc-below-stage" data-hq-page="planen" aria-labelledby="hq-plan-title">
      <sc-hq-plan />
    </section>
    <section id="jetzt" class="page follow sc-below-stage" data-hq-page="jetzt" aria-labelledby="hq-now-title">
      <sc-hq-now />
    </section>
    <section id="bestand" class="page follow sc-below-stage" data-hq-page="bestand" aria-labelledby="hq-stock-title">
      <sc-hq-stock />
    </section>
    <section id="statistik" class="page follow last sc-below-stage" data-hq-page="statistik" aria-labelledby="hq-stats-title">
      <sc-hq-stats />
    </section>
    <sc-hq-page-bar />
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
      .follow { scroll-margin-top: calc(-1 * var(--sc-bar-h, 64px)); padding-top: calc(var(--sc-bar-h, 64px) + var(--sc-space-5, 24px)); padding-bottom: var(--sc-space-6, 32px); }
      /* Room after the last page, before the footer. */
      .last { padding-bottom: var(--sc-space-8, 64px); }
    `,
  ],
})
export class HqPagesComponent {
  protected readonly feed = inject(HqStartFeedService);
  private readonly chrome = inject(ShellChromeService);
  private readonly nav = inject(HqPageNavService);
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.chrome.setHqPage(hqPageOfFragment(this.route.snapshot.fragment) ?? 'start');
    effect(() => {
      const page = this.chrome.hqPage();
      if (page) this.syncUrl(page);
    });
    const detach = this.nav.attach((p) => this.goTo(p));
    // Back / forward between fragments: the router does not scroll, so follow the history entry.
    const pop = this.location.subscribe(() => {
      const page = hqPageOfFragment(typeof window === 'undefined' ? null : window.location.hash.slice(1)) ?? 'start';
      this.scrollTo(page, false);
      this.chrome.setHqPage(page);
    });
    this.destroyRef.onDestroy(() => pop.unsubscribe());
    if (typeof window !== 'undefined') {
      const onResize = () => this.measureStartTop();
      window.addEventListener('resize', onResize, { passive: true });
      this.destroyRef.onDestroy(() => window.removeEventListener('resize', onResize));
    }
    this.destroyRef.onDestroy(() => {
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
    });
  }

  private section(page: HqPageId): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`[data-hq-page="${page}"]`);
  }

  /** Plain left click on a rail / bar / cue anchor: scroll there and add ONE history entry. */
  private goTo(page: HqPageId): void {
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

  private urlFor(page: HqPageId): string {
    const base = hqPageHref(page);
    const search = typeof window === 'undefined' ? '' : window.location.search;
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
