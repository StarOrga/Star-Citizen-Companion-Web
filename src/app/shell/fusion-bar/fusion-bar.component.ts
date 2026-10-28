import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  NgZone,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { LayoutService } from '../../core/layout/layout.service';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { SameRouteRefreshService } from '../../core/same-route-refresh.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { FusionSearchComponent } from './fusion-search.component';
import { ShellChromeService } from './shell-chrome.service';
import {
  AREA_ENTRIES,
  BarMode,
  CODEX_SEGMENTS,
  CodexSegment,
  HideTracker,
  activeAreaOf,
  activeSegmentOf,
  barModeOf,
  hidesOnScroll,
  isCodexToolPage,
  isMainHeaderPage,
  nextStageDocked,
  plateBackOf,
  stageMorphOf,
} from './fusion-bar.model';

/** Morph duration (ms) of "Gleiche Leiste": the staged field flies up and widens into the subheader. */
export const DOCK_MORPH_MS = 620;
const DOCK_EASE = 'cubic-bezier(0.55, 0, 0.2, 1)';
/** Tokens shown inside the search field before the rest folds into "+n". */
const MAX_TOKENS = 3;

interface PathCrumb {
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string> | null;
  link: string | readonly unknown[] | null;
  queryParams?: unknown;
}

/**
 * The subheader of the beta shell (concept 2026-10-28 header/subheader, round 8
 * design d2 "Satinkante"): ONE 60px bar in the page frame's width.
 *
 * Main pages (`isMainHeaderPage`: Verse, Codex, HQ, admin hub): the bar's search
 * field stands centred in the scene on the page's stage slot (`[scStageSearch]`)
 * — mode `stage`, only the field. Past `STAGE_DOCK_PX` of scroll the SAME
 * element flies up and widens into the docked subheader (mode `docked`, played
 * once per crossing via FLIP, reversed on the way back); the cinematic header
 * compresses into it — its logo glides onto the bar's logo slot.
 *
 * Other pages: docked from the start (`content` slides away on scroll, `tool` and
 * `hub` stay). Content of the docked bar: logo slot · plate (category + "◂ origin",
 * the full path on hover) · divider · search · Strg K. Codex tool pages add the
 * kind switch, active filters as tokens in the field, the hit count and the
 * Filter button; the filter panel hangs from the bar in the same skin.
 *
 * Phones (≤ 720px): the bar docks at the bottom under the thumb (above
 * `--sc-float-bottom`, clear of the feedback launcher's lane); the route line
 * (category + ◂ back) sits alone at the top.
 *
 * The account menu is the shell's own, projected as `[barAccount]` where no
 * main header carries it.
 */
@Component({
  selector: 'sc-fusion-bar',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScTooltipDirective, FusionSearchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-mode]': 'mode()',
    '[class.hidden]': 'hidden()',
    '[class.searching]': 'searchOpen()',
    '[class.morph]': 'morphing()',
    '[class.entering]': 'entering()',
    '[class.placed]': 'placed()',
    '[class.public]': "variant() === 'public'",
    '[class.phone]': 'phone()',
    '(focusin)': 'reveal()',
  },
  template: `
    <div class="cap" [class.open]="panelShown()">
      <span class="skin" aria-hidden="true"></span>
      <span class="trace" aria-hidden="true"></span>
      @if (mode() === 'stage') { <span class="bloom" aria-hidden="true"></span> }

      @if (variant() === 'public') {
        <a class="brand" routerLink="/" [attr.aria-label]="'nav.brandAria' | translate">
          <img class="logo" src="icons/brand/scc-mark.svg" alt="" width="28" height="28" />
          <span class="title">Star Citizen Companion</span>
        </a>
        <span class="spacer"></span>
        <a class="home-link" routerLink="/">{{ 'nav.backToHome' | translate }}</a>
      } @else {
        @if (mode() !== 'stage') {
          <a class="blogo" routerLink="/verse" [attr.aria-label]="'nav.brandAria' | translate"
             [scTooltip]="'nav.brandAria' | translate" scTooltipTier="label" (click)="onNav($event, '/verse')">
            <img src="icons/brand/scc-mark.svg" alt="" width="28" height="28" />
          </a>
          <div class="plate">
            <span class="cat">{{ areaLabelKey() | translate }}</span>
            @if (back(); as b) {
              <a class="back" [routerLink]="$any(b.link)" [queryParams]="b.queryParams"
                 [attr.aria-label]="'fusionBar.backTo' | translate: { name: (b.label ?? (b.labelKey! | translate: (b.labelParams ?? undefined))) }">
                <span class="tri" aria-hidden="true">◂</span>
                <span class="back-label">{{ b.label ?? (b.labelKey! | translate: (b.labelParams ?? undefined)) }}</span>
              </a>
            }
            @if (path().length > 1) {
              <nav class="path" [attr.aria-label]="'pageHeader.crumbsAria' | translate">
                <ol>
                  @for (c of path(); track $index) {
                    <li>
                      @if (c.link) {
                        <a [routerLink]="$any(c.link)" [queryParams]="$any(c.queryParams) ?? null">{{ c.label ?? (c.labelKey! | translate: (c.labelParams ?? undefined)) }}</a>
                      } @else {
                        <span class="here" aria-current="page">{{ c.label }}</span>
                      }
                    </li>
                  }
                </ol>
              </nav>
            }
          </div>
          <span class="div" aria-hidden="true"></span>

          @if (segment(); as seg) {
            <button type="button" class="kindsw" [attr.aria-expanded]="panelOpen()" aria-controls="sc-bar-panel"
                    [attr.aria-label]="'fusionBar.kindSwitch' | translate: { kind: (seg.labelKey | translate) }"
                    (click)="togglePanel()">
              <span class="ks-label">{{ seg.labelKey | translate }}</span>
              @if (kindTotal() !== null) { <i>{{ kindTotal() }}</i> }
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                   stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          }
        }

        <sc-fusion-search class="search" [placement]="phone() && mode() !== 'stage' ? 'bottom' : 'top'"
                          [compact]="mode() === 'tool'" [hideContext]="mode() === 'stage' || !!segment()"
                          (openChange)="onSearchOpen($event)">
          @if (mode() !== 'stage' && tokens().length) {
            <span fsLeading class="toks">
              @for (t of shownTokens(); track t.id) {
                <span class="tok">
                  <em>{{ t.labelKey | translate }}</em>
                  @if (t.value) { <span class="tok-v">{{ t.value }}</span> }
                  <button type="button" class="tok-x" (click)="t.remove()"
                          [attr.aria-label]="'fusionBar.removeFilter' | translate: { name: (t.labelKey | translate) }"
                          [scTooltip]="'fusionBar.removeFilter' | translate: { name: (t.labelKey | translate) }" scTooltipTier="label">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                      <line x1="7" y1="7" x2="17" y2="17" /><line x1="17" y1="7" x2="7" y2="17" />
                    </svg>
                  </button>
                </span>
              }
              @if (moreTokens() > 0) {
                <button type="button" class="tok more" (click)="togglePanel(true)"
                        [attr.aria-label]="'fusionBar.moreFilters' | translate: { count: moreTokens() }">+{{ moreTokens() }}</button>
              }
            </span>
          }
        </sc-fusion-search>

        @if (mode() !== 'stage') {
          @if (hitCount() !== null) {
            <span class="count" aria-live="polite">{{ 'fusionBar.hits' | translate: { count: hitCount() } }}</span>
          }
          @if (toolbar()) {
            <button type="button" class="fbtn" [class.on]="panelOpen()" [attr.aria-expanded]="panelOpen()"
                    aria-controls="sc-bar-panel" (click)="togglePanel()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
              </svg>
              <span class="fb-label">{{ 'fusionBar.filters' | translate }}</span>
              @if (tokens().length) { <i>{{ tokens().length }}</i> }
            </button>
          }
          <div class="account"><ng-content select="[barAccount]" /></div>
        }
      }
    </div>

    @if (panelShown()) {
      <div class="fpanel" id="sc-bar-panel" role="region" [attr.aria-label]="'fusionBar.filters' | translate">
        <span class="skin" aria-hidden="true"></span>
        @if (segments(); as segs) {
          <nav class="kindrow" [attr.aria-label]="'codex.categoriesAria' | translate">
            @for (s of segs; track s.id) {
              <a class="kind" [routerLink]="s.link" [queryParams]="s.queryParams" [class.active]="segment()?.id === s.id"
                 [attr.aria-current]="segment()?.id === s.id ? 'page' : null">{{ s.labelKey | translate }}</a>
            }
          </nav>
        }
        @if (toolbar()) {
          <div class="fcols"><ng-container [ngTemplateOutlet]="toolbar()" /></div>
        }
        @if (filters(); as f) {
          <div class="ffoot">
            <span>
              @if (f.count !== null) { {{ 'fusionBar.hits' | translate: { count: f.count } }} }
            </span>
            @if (f.tokens.length) {
              <button type="button" class="freset" (click)="f.reset()">{{ 'codex.filters.reset' | translate }}</button>
            }
          </div>
        }
      </div>
    }

    @if (phone() && variant() === 'app' && mode() !== 'stage') {
      <!-- Phone: the route line alone at the top; the bar itself sits at the thumb. -->
      <div class="route">
        <span class="cat">{{ areaLabelKey() | translate }}</span>
        @if (back(); as b) {
          <a class="back" [routerLink]="$any(b.link)" [queryParams]="b.queryParams">
            <span class="tri" aria-hidden="true">◂</span>
            {{ b.label ?? (b.labelKey! | translate: (b.labelParams ?? undefined)) }}
          </a>
        }
      </div>
    }
  `,
  styleUrl: './fusion-bar.component.scss',
})
export class FusionBarComponent {
  private readonly router = inject(Router);
  private readonly layout = inject(LayoutService);
  private readonly chrome = inject(ShellChromeService);
  private readonly sameRoute = inject(SameRouteRefreshService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);
  private readonly injector = inject(Injector);

  /** `app` (shell) or `public` (public layout: brand + way home, no search, no account). */
  readonly variant = input<'app' | 'public'>('app');

  private readonly url = signal(this.router.url);
  readonly searchOpen = signal(false);
  readonly panelOpen = signal(false);
  readonly hidden = signal(false);
  readonly morphing = signal(false);
  readonly entering = signal(false);
  /** Main page scrolled past the threshold: the staged field docked as the subheader. */
  readonly docked = signal(false);
  /** The staged field stands on its slot (position measured). */
  readonly placed = signal(false);
  readonly phone = signal(matches('(max-width: 720px)'));

  readonly mainPage = computed(() => this.variant() === 'app' && isMainHeaderPage(this.url()));
  readonly mode = computed<BarMode>(() => {
    if (this.mainPage()) return this.docked() ? 'docked' : 'stage';
    return barModeOf(this.layout.layout(), 'none');
  });
  readonly crumbs = this.chrome.crumbs;
  readonly toolbar = this.chrome.toolbar;
  readonly filters = this.chrome.filters;

  private readonly areaEntry = computed(() => {
    const id = activeAreaOf(this.url(), false);
    return AREA_ENTRIES.find((a) => a.id === id) ?? null;
  });
  readonly areaLabelKey = computed(() => this.areaEntry()?.labelKey ?? 'fusionBar.home');
  /** "◂ <origin>": the page header's last crumb (NavOriginService decides where it leads), else the area root. */
  readonly back = computed(() => plateBackOf(this.crumbs()?.crumbs, this.url(), this.areaEntry()));
  /** The full trail for the plate's hover: crumbs + the page title. */
  readonly path = computed<readonly PathCrumb[]>(() => {
    const c = this.crumbs();
    if (!c) return [];
    const list: PathCrumb[] = [...c.crumbs];
    if (c.title) list.push({ label: c.title, link: null });
    return list;
  });

  /** Codex kinds: on the Codex tool pages (index, FPS, upcoming, keybinds) the kind switch + panel row. */
  readonly segments = computed<readonly CodexSegment[] | null>(() =>
    this.variant() === 'app' && isCodexToolPage(this.url()) ? CODEX_SEGMENTS : null,
  );
  readonly segment = computed<CodexSegment | null>(() => {
    if (!this.segments()) return null;
    const id = activeSegmentOf(this.url());
    return CODEX_SEGMENTS.find((s) => s.id === id) ?? null;
  });
  readonly kindTotal = computed(() => this.filters()?.kindTotal ?? null);
  readonly hitCount = computed(() => this.filters()?.count ?? null);
  readonly tokens = computed(() => this.filters()?.tokens ?? []);
  readonly shownTokens = computed(() => this.tokens().slice(0, MAX_TOKENS));
  readonly moreTokens = computed(() => Math.max(0, this.tokens().length - MAX_TOKENS));
  readonly panelShown = computed(
    () => this.panelOpen() && this.mode() !== 'stage' && !this.searchOpen() && (!!this.toolbar() || !!this.segments()),
  );

  private readonly tracker = new HideTracker();
  private morphTimer: ReturnType<typeof setTimeout> | null = null;
  private enterTimer: ReturnType<typeof setTimeout> | null = null;
  private placeFrame = 0;
  private anchorRo: ResizeObserver | null = null;
  private barH = readBarHeight();

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      const wasMain = this.mainPage();
      this.url.set(e.urlAfterRedirects);
      this.setHidden(false);
      const y = typeof window === 'undefined' ? 0 : window.scrollY;
      this.tracker.reset(y);
      if (!this.segments()) this.panelOpen.set(false);
      // A main page starts staged (the router scrolls to the top) and plays the entrance.
      this.docked.set(this.mainPage() ? nextStageDocked(false, y) : false);
      if (this.mainPage() && (!wasMain || !this.docked())) this.pulse('enter');
    });

    effect(() => {
      const m = this.mode();
      const main = this.mainPage();
      untracked(() => {
        this.chrome.setStageSearch(main ? (m === 'docked' ? 'docked' : 'stage') : 'none');
        if (!hidesOnScroll(m)) this.setHidden(false);
        this.publishHeight();
      });
    });

    // The stage slot comes and goes with the page: track it and stand on it.
    effect(() => {
      const anchor = this.chrome.stageAnchor();
      const staged = this.mode() === 'stage';
      untracked(() => {
        this.anchorRo?.disconnect();
        this.anchorRo = null;
        if (!staged || !anchor) {
          this.placed.set(false);
          return;
        }
        if (typeof ResizeObserver !== 'undefined') {
          this.anchorRo = new ResizeObserver(() => this.schedulePlace());
          this.anchorRo.observe(anchor);
        }
        this.schedulePlace();
      });
    });

    if (this.mainPage()) this.pulse('enter');
    afterNextRender(() => this.zone.runOutsideAngular(() => this.listen()), { injector: this.injector });
    inject(DestroyRef).onDestroy(() => {
      if (this.morphTimer) clearTimeout(this.morphTimer);
      if (this.enterTimer) clearTimeout(this.enterTimer);
      if (typeof cancelAnimationFrame === 'function') {
        if (this.placeFrame) cancelAnimationFrame(this.placeFrame);
        if (this.measureFrame) cancelAnimationFrame(this.measureFrame);
      }
      this.anchorRo?.disconnect();
      this.chrome.setBarHidden(false);
      this.chrome.setStageSearch('none');
      if (typeof document !== 'undefined') {
        document.documentElement.style.removeProperty('--sc-topbar-h');
        document.documentElement.style.removeProperty('--sc-bar-stack-h');
      }
    });
  }

  private listen(): void {
    if (typeof window === 'undefined') return;
    const onScroll = () => this.onScroll(window.scrollY);
    const onResize = () => {
      const phone = matches('(max-width: 720px)');
      if (phone !== this.phone()) this.zone.run(() => this.phone.set(phone));
      this.barH = readBarHeight();
      this.publishHeight();
      this.schedulePlace();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    // The stack grows with the panel; the page above the slot can reflow — keep both true.
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => this.scheduleMeasure());
    ro?.observe(this.host.nativeElement as HTMLElement);
    ro?.observe(document.body);
    window.addEventListener('resize', onResize, { passive: true });
    this.publishHeight();
    this.onScroll(window.scrollY);
    this.injector.get(DestroyRef).onDestroy(() => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    });
  }

  /** Scroll feed: the main page's dock state machine, the content page's hide/reveal. */
  onScroll(y: number): void {
    if (this.mainPage()) {
      const next = nextStageDocked(this.docked(), y);
      if (next !== this.docked() && !this.searchOpen()) this.setDocked(next);
      this.tracker.reset(y);
      return;
    }
    if (hidesOnScroll(this.mode()) && !this.searchOpen() && !this.panelOpen()) {
      const next = this.tracker.update(y, this.barH);
      if (next !== this.hidden()) this.zone.run(() => this.setHidden(next));
    } else {
      this.tracker.reset(y);
    }
  }

  /** One crossing of the threshold: switch state, then play the FLIP morph once. */
  private setDocked(next: boolean): void {
    const cap = this.capEl();
    const first = cap?.getBoundingClientRect() ?? null;
    const logoFirst = cap?.querySelector<HTMLElement>('.blogo img')?.getBoundingClientRect() ?? null;
    const morph = stageMorphOf(this.docked(), next);
    this.zone.run(() => {
      this.docked.set(next);
      if (next) this.panelOpen.set(false);
      if (morph === 'dock') this.pulse('morph');
    });
    if (!morph || !first) return;
    afterNextRender(
      () => {
        if (morph === 'undock') this.placeStage();
        this.playMorph(morph, first, logoFirst);
      },
      { injector: this.injector },
    );
  }

  private playMorph(kind: 'dock' | 'undock', first: DOMRect, logoFirst: DOMRect | null): void {
    const cap = this.capEl();
    if (!cap || reducedMotion() || typeof cap.animate !== 'function') return;
    const last = cap.getBoundingClientRect();
    cap.animate(
      [
        { transform: `translate(${first.left - last.left}px, ${first.top - last.top}px)`, width: `${first.width}px` },
        { transform: 'none', width: `${last.width}px` },
      ],
      { duration: DOCK_MORPH_MS, easing: DOCK_EASE },
    );
    // The header's logo glides onto the bar's logo slot (and back) — never overlapped.
    const head = document.querySelector<HTMLElement>('sc-main-header .brand > img.logo');
    const barLogo = cap.querySelector<HTMLElement>('.blogo img');
    const slot = kind === 'dock' ? (barLogo?.getBoundingClientRect() ?? null) : logoFirst;
    if (!head || !slot || typeof head.animate !== 'function') return;
    const h = head.getBoundingClientRect();
    const dx = slot.left + slot.width / 2 - (h.left + h.width / 2);
    const dy = slot.top + slot.height / 2 - (h.top + h.height / 2);
    const to = `translate(${dx}px, ${dy}px) scale(${slot.width / (h.width || 1)})`;
    if (kind === 'dock') {
      head.animate(
        [{ transform: 'none', opacity: 1 }, { transform: to, opacity: 1, offset: 0.92 }, { transform: to, opacity: 0 }],
        { duration: DOCK_MORPH_MS, easing: DOCK_EASE },
      );
      barLogo?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.9 }, { opacity: 1 }], { duration: DOCK_MORPH_MS });
    } else {
      head.animate([{ transform: to, opacity: 1 }, { transform: 'none', opacity: 1 }], {
        duration: DOCK_MORPH_MS,
        easing: DOCK_EASE,
      });
    }
  }

  private measureFrame = 0;

  /** Heights + stage position, one frame later (a write inside a ResizeObserver callback loops it). */
  private scheduleMeasure(): void {
    if (typeof requestAnimationFrame !== 'function' || this.measureFrame) return;
    this.measureFrame = requestAnimationFrame(() => {
      this.measureFrame = 0;
      this.publishHeight();
      this.placeStage();
    });
  }

  private schedulePlace(): void {
    if (typeof requestAnimationFrame !== 'function') {
      this.placeStage();
      return;
    }
    if (this.placeFrame) return;
    this.placeFrame = requestAnimationFrame(() => {
      this.placeFrame = 0;
      this.placeStage();
    });
  }

  /** Stand the staged field on the slot: its position relative to the bar's host, published as CSS vars. */
  private placeStage(): void {
    const anchor = this.chrome.stageAnchor();
    const el = this.host.nativeElement as HTMLElement;
    if (this.mode() !== 'stage' || !anchor || !anchor.isConnected) return;
    const a = anchor.getBoundingClientRect();
    const h = el.getBoundingClientRect();
    el.style.setProperty('--_st-top', `${Math.round(a.top - h.top)}px`);
    el.style.setProperty('--_st-left', `${Math.round(a.left - h.left)}px`);
    el.style.setProperty('--_st-w', `${Math.round(a.width)}px`);
    if (!this.placed()) this.zone.run(() => this.placed.set(true));
  }

  private capEl(): HTMLElement | null {
    return (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.cap');
  }

  private setHidden(hidden: boolean): void {
    if (this.hidden() === hidden) return;
    this.hidden.set(hidden);
    this.chrome.setBarHidden(hidden);
    this.publishHeight();
  }

  /**
   * `--sc-topbar-h`: where a page's own sticky bar parks — the docked bar's
   * height at the top; 0 while staged, hidden or on a phone (bar at the bottom).
   */
  private publishHeight(): void {
    if (typeof document === 'undefined') return;
    const el = this.host.nativeElement as HTMLElement;
    const staged = this.mode() === 'stage';
    const px = this.phone() || this.hidden() || staged ? 0 : Math.round(el.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--sc-topbar-h', `${px}px`);
    // Phone: the whole bottom stack (bar + panel) the page must keep free.
    const stack = this.phone() && !staged ? Math.round(el.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--sc-bar-stack-h', `${stack}px`);
  }

  private pulse(kind: 'morph' | 'enter'): void {
    if (reducedMotion()) return;
    const flag = kind === 'morph' ? this.morphing : this.entering;
    const old = kind === 'morph' ? this.morphTimer : this.enterTimer;
    if (old) clearTimeout(old);
    flag.set(true);
    const t = setTimeout(() => flag.set(false), kind === 'morph' ? 1100 : 1400);
    if (kind === 'morph') this.morphTimer = t;
    else this.enterTimer = t;
  }

  /** Focus inside the bar always brings it back (keyboard users never lose it). */
  reveal(): void {
    this.setHidden(false);
  }

  onSearchOpen(open: boolean): void {
    this.searchOpen.set(open);
    if (open) this.setHidden(false);
  }

  togglePanel(force?: boolean): void {
    this.panelOpen.update((v) => force ?? !v);
  }

  onNav(ev: MouseEvent, path: string): void {
    if (!isPlainLeftClick(ev)) return;
    this.sameRoute.request(path);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.panelOpen()) return;
    this.panelOpen.set(false);
    (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.fbtn, .kindsw')?.focus();
  }
}

/** --sc-bar-h in px (64 desktop, 56 phone). */
function readBarHeight(): number {
  if (typeof document === 'undefined') return 64;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sc-bar-h'));
  return Number.isFinite(v) && v > 0 ? v : 64;
}

function matches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

function reducedMotion(): boolean {
  return matches('(prefers-reduced-motion: reduce)');
}
