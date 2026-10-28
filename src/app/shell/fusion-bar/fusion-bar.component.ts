import {
  ApplicationRef,
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
import { NavigationEnd, Router, RouterLink, Scroll } from '@angular/router';
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
  routeMorphOf,
  scrollMorphOf,
} from './fusion-bar.model';

/**
 * Morph durations (ms) of "Gleiche Leiste", from the concept's r8 keyframes
 * (10 s loop): docking 22 → 38 % = 1.6 s, undocking 82 → 96 % = 1.4 s.
 */
export const DOCK_MORPH_MS = 1600;
export const UNDOCK_MORPH_MS = 1400;
/** The header logo glides 22 → 36 % (1.4 s) and fades at 36 → 40 % (0.4 s). */
const LOGO_GLIDE_MS = 1400;
const LOGO_FADE_MS = 400;
const DOCK_EASE = 'cubic-bezier(0.55, 0, 0.2, 1)';
/** Longest wait for the router's scroll reset after a route change before the state settles anyway. */
const NAV_SETTLE_MS = 400;
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
    '[class.snap]': 'chrome.snap()',
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
        <!-- Logo slot, plate and divider stay mounted while staged (collapsed to zero
             width, inert), so docking can grow them — plate 0 → 170 px, logo slot
             0 → 44 px — instead of popping them in. -->
          <a class="blogo" routerLink="/verse" [attr.aria-label]="'nav.brandAria' | translate"
             [attr.inert]="mode() === 'stage' ? '' : null"
             [scTooltip]="'nav.brandAria' | translate" scTooltipTier="label" (click)="onNav($event, '/verse')">
            <img src="icons/brand/scc-mark.svg" alt="" width="28" height="28" />
          </a>
          <div class="plate" [attr.inert]="mode() === 'stage' ? '' : null">
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

          @if (mode() !== 'stage' && segment(); as seg) {
            <button type="button" class="kindsw" [attr.aria-expanded]="panelOpen()" aria-controls="sc-bar-panel"
                    [attr.aria-label]="'fusionBar.kindSwitch' | translate: { kind: (seg.labelKey | translate) }"
                    (click)="togglePanel()">
              <span class="ks-label">{{ seg.labelKey | translate }}</span>
              @if (kindTotal() !== null) { <i>{{ kindTotal() }}</i> }
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                   stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
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
  readonly chrome = inject(ShellChromeService);
  private readonly appRef = inject(ApplicationRef);
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
  /** A route change is settling (until the router's scroll reset): scroll crossings only snap. */
  private navQuiet = false;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private snapFrame = 0;
  /** The main ↔ subpage morph, waiting for the router's scroll reset. */
  private pendingFlip: (() => void) | null = null;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof Scroll) {
        // The router's scroll reset has been applied: the route change is settled.
        this.runPendingFlip();
        this.settleNav();
        return;
      }
      if (!(e instanceof NavigationEnd)) return;
      const wasMain = this.mainPage();
      const wasDocked = this.docked();
      const cap = this.capEl();
      const first = cap && (!wasMain || wasDocked || this.placed()) ? cap.getBoundingClientRect() : null;
      const logoFirst = cap?.querySelector<HTMLElement>('.blogo img')?.getBoundingClientRect() ?? null;
      this.url.set(e.urlAfterRedirects);
      this.setHidden(false);
      const y = typeof window === 'undefined' ? 0 : window.scrollY;
      this.tracker.reset(y);
      if (!this.segments()) this.panelOpen.set(false);
      this.beginNavQuiet();
      const morph = this.variant() === 'app' ? routeMorphOf(wasMain, this.mainPage(), wasDocked) : null;
      // A main page starts staged: the router resets the scroll to its top right after this event.
      if (morph === 'snap') this.snap();
      this.docked.set(false);
      if (this.mainPage()) this.pulse('enter');
      if ((morph === 'dock' || morph === 'undock') && first && first.width > 0) {
        // Main → subpage after docking: the header is already compressed, only the bar moves.
        this.queueRouteMorph(morph, first, logoFirst, !(morph === 'dock' && wasDocked));
      }
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
      if (this.quietTimer) clearTimeout(this.quietTimer);
      this.pendingFlip = null;
      this.chrome.setSnap(false);
      if (this.enterTimer) clearTimeout(this.enterTimer);
      if (typeof cancelAnimationFrame === 'function') {
        if (this.snapFrame) cancelAnimationFrame(this.snapFrame);
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
      if (next !== this.docked() && !this.searchOpen()) {
        if (scrollMorphOf(this.docked(), next, this.navQuiet) === 'snap') this.snapDocked(next);
        else this.setDocked(next);
      }
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

  /**
   * One crossing of the threshold by the user's own scroll: measure, switch the
   * state, render it synchronously and start the FLIP in the same task — the
   * browser never paints the new state without its animation (no flash).
   */
  private setDocked(next: boolean): void {
    const cap = this.capEl();
    const first = cap?.getBoundingClientRect() ?? null;
    const logoFirst = cap?.querySelector<HTMLElement>('.blogo img')?.getBoundingClientRect() ?? null;
    const morph = scrollMorphOf(this.docked(), next, false);
    this.zone.run(() => {
      this.docked.set(next);
      if (next) this.panelOpen.set(false);
      if (morph === 'dock') this.pulse('morph');
    });
    this.flush();
    if ((morph !== 'dock' && morph !== 'undock') || !first) return;
    if (morph === 'undock') this.placeStage();
    this.playMorph(morph, first, logoFirst, true);
  }

  /** A crossing caused by a route change or a scroll reset: jump, no morph, no transitions. */
  private snapDocked(next: boolean): void {
    this.zone.run(() => {
      this.snap();
      this.docked.set(next);
      if (next) this.panelOpen.set(false);
    });
    this.flush();
    if (!next) this.placeStage();
  }

  /** Transitions off for the next two frames (bar + header), so a state change jumps. */
  private snap(): void {
    this.chrome.setSnap(true);
    if (typeof requestAnimationFrame !== 'function') return;
    if (this.snapFrame) cancelAnimationFrame(this.snapFrame);
    this.snapFrame = requestAnimationFrame(() => {
      this.snapFrame = requestAnimationFrame(() => {
        this.snapFrame = 0;
        this.zone.run(() => this.chrome.setSnap(false));
      });
    });
  }

  /** From NavigationEnd until the router's scroll reset (or {@link NAV_SETTLE_MS}): crossings only snap. */
  private beginNavQuiet(): void {
    this.navQuiet = true;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => {
      this.runPendingFlip();
      this.settleNav();
    }, NAV_SETTLE_MS);
  }

  private settleNav(): void {
    if (!this.navQuiet) return;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    // The scroll event of the reset itself still arrives before the next frame: stay quiet through it.
    const done = () => (this.navQuiet = false);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(done));
    else done();
  }

  /** Render pending state now (no-op when the DOM already shows it). */
  private flush(): void {
    const el = this.host.nativeElement as HTMLElement;
    if (el.getAttribute('data-mode') === this.mode()) return;
    try {
      this.appRef.tick();
    } catch {
      // Already inside a change-detection pass: that pass renders the state itself.
    }
  }

  /**
   * Main ↔ subpage: the cap keeps its old rect (held, so nothing snaps in the
   * frames until the router's scroll reset), then travels into the new one —
   * the same FLIP as docking, while the header compresses / expands.
   */
  private queueRouteMorph(kind: 'dock' | 'undock', first: DOMRect, logoFirst: DOMRect | null, withLogo: boolean): void {
    this.flush();
    if (kind === 'undock') this.placeStage();
    const cap = this.capEl();
    if (!cap || reducedMotion() || typeof cap.animate !== 'function') return;
    const last = cap.getBoundingClientRect();
    const at = { transform: `translate(${first.left - last.left}px, ${first.top - last.top}px)`, width: `${first.width}px` };
    const hold = cap.animate([at, at], { duration: NAV_SETTLE_MS * 4, fill: 'both' });
    this.pendingFlip = () => {
      hold.cancel();
      if (kind === 'undock') this.placeStage();
      this.playMorph(kind, first, logoFirst, withLogo);
    };
  }

  private runPendingFlip(): void {
    const run = this.pendingFlip;
    this.pendingFlip = null;
    run?.();
  }

  /**
   * The FLIP: the cap travels from `first` into its new rect and widens
   * (`dockmove`); the header's logo glides onto the bar's logo slot and fades
   * there as the slot's own logo appears (`logo` / `blogo`), or comes back out
   * of it. Every rect is measured before any animation starts.
   */
  private playMorph(kind: 'dock' | 'undock', first: DOMRect, logoFirst: DOMRect | null, withLogo: boolean): void {
    const cap = this.capEl();
    if (!cap || reducedMotion() || typeof cap.animate !== 'function') return;
    const last = cap.getBoundingClientRect();
    const head = withLogo ? document.querySelector<HTMLElement>('sc-main-header .brand > img.logo') : null;
    const slot = kind === 'dock' ? (cap.querySelector<HTMLElement>('.blogo img')?.getBoundingClientRect() ?? null) : logoFirst;
    const h = head?.getBoundingClientRect() ?? null;
    cap.animate(
      [
        { transform: `translate(${first.left - last.left}px, ${first.top - last.top}px)`, width: `${first.width}px` },
        { transform: 'none', width: `${last.width}px` },
      ],
      { duration: kind === 'dock' ? DOCK_MORPH_MS : UNDOCK_MORPH_MS, easing: DOCK_EASE },
    );
    if (!head || !slot || !h || !h.width || typeof head.animate !== 'function') return;
    const dx = slot.left + slot.width / 2 - (h.left + h.width / 2);
    const dy = slot.top + slot.height / 2 - (h.top + h.height / 2);
    const to = `translate(${dx}px, ${dy}px) scale(${slot.width / h.width})`;
    if (kind === 'dock') {
      const total = LOGO_GLIDE_MS + LOGO_FADE_MS;
      head.animate(
        [
          { transform: 'none', opacity: 1, easing: DOCK_EASE },
          { transform: to, opacity: 1, offset: LOGO_GLIDE_MS / total },
          { transform: to, opacity: 0 },
        ],
        { duration: total },
      );
    } else {
      // Undock (82 → 96 %): it fades in on the slot at 84–86 %, then glides home at 86–96 %.
      head.animate(
        [
          { transform: to, opacity: 0 },
          { transform: to, opacity: 0, offset: 0.2 / 1.4 },
          { transform: to, opacity: 1, offset: 0.4 / 1.4, easing: DOCK_EASE },
          { transform: 'none', opacity: 1 },
        ],
        { duration: UNDOCK_MORPH_MS },
      );
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
