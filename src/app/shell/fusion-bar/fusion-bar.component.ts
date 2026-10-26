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
import { RoleService } from '../../auth/role.service';
import { BetaService } from '../../core/beta.service';
import { LayoutService } from '../../core/layout/layout.service';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { SameRouteRefreshService } from '../../core/same-route-refresh.service';
import { CodexCategoryIconComponent } from '../../codex/codex-category-icon.component';
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
} from './fusion-bar.model';

/**
 * The Fusion bar (beta `shell`, spec §4): header and subheader as ONE glass
 * capsule. The subheader is always the search.
 *
 * Modes (`barModeOf`, from `LayoutService.layout()` + the hub's stage search):
 * - `stage`   cinematic hub, stage search line on screen: brand + main nav only;
 * - `hub`     cinematic page without a stage search: brand + nav + search;
 * - `docked`  cinematic hub scrolled past its search line: the line morphed into
 *             the capsule (played once at the threshold, never scroll-scrubbed);
 * - `content` area segment + section label + crumbs + search; hides on scroll
 *             down after ~1 bar height, back after 8px up or on focus;
 * - `tool`    compact and persistent; the page's toolbar (`*scBarToolbar`) folds
 *             out of the search as the drawer and stays pinned with the bar.
 * On a Codex tool page the seven Codex kinds are segments in the capsule; the
 * crumb collapses into the active one on the way there.
 *
 * Phones (≤ 720px, the `--sc-bar-h` breakpoint): the capsule sits at the BOTTOM,
 * under the thumb, above `--sc-float-bottom` and clear of the feedback
 * launcher's lane (`--sc-fab-clear-inline`).
 *
 * The account menu is the shell's own, projected as `[barAccount]`.
 */
@Component({
  selector: 'sc-fusion-bar',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, CodexCategoryIconComponent, ScTooltipDirective, FusionSearchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-mode]': 'mode()',
    '[class.hidden]': 'hidden()',
    '[class.searching]': 'searchOpen()',
    '[class.morph]': 'morphing()',
    '[class.public]': "variant() === 'public'",
    '[class.phone]': 'phone()',
    '(focusin)': 'reveal()',
  },
  template: `
    <div class="cap" [class.with-drawer]="drawerShown()">
      @if (showStageLayer()) {
        <a class="brand" routerLink="/verse" [attr.aria-label]="'nav.brandAria' | translate"
           (click)="onNav($event, '/verse')">
          <img class="logo" src="icons/brand/scc-mark.svg" alt="" width="30" height="30" />
          <span class="wordmark">
            <span class="title">Star Citizen Companion</span>
            <span class="alpha">{{ 'nav.phaseBadge' | translate }}</span>
          </span>
        </a>
        @if (variant() === 'app') {
          <nav class="nav" [attr.aria-label]="'fusionBar.navAria' | translate">
            @for (a of areas(); track a.id) {
              <a [routerLink]="a.link" [class.active]="activeArea() === a.id" [class.elevated]="a.elevated"
                 [attr.aria-current]="activeArea() === a.id ? 'page' : null"
                 (click)="onNav($event, a.link)">
                {{ a.labelKey | translate }}
                @if (a.elevated) { <span class="sr-only"> ({{ 'nav.adminOnly' | translate }})</span> }
              </a>
            }
          </nav>
        } @else {
          <a class="home-link" routerLink="/">{{ 'nav.backToHome' | translate }}</a>
        }
      } @else {
        <div class="seg-wrap">
          <button type="button" class="seg" aria-haspopup="menu" [attr.aria-expanded]="menuOpen()"
                  [attr.aria-label]="'fusionBar.areaMenu' | translate: { area: (areaLabelKey() | translate) }"
                  (click)="toggleMenu($event)" (keydown)="onSegKeydown($event)">
            <img class="logo" src="icons/brand/scc-mark.svg" alt="" width="24" height="24" />
            <span class="seg-label">{{ areaLabelKey() | translate }}</span>
            <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          @if (menuOpen()) {
            <div class="menu" role="menu" [attr.aria-label]="'fusionBar.navAria' | translate" (keydown)="onMenuKeydown($event)">
              <a class="mi" role="menuitem" routerLink="/verse" (click)="onMenuNav($event, '/verse')">
                <span class="mi-label">{{ 'fusionBar.home' | translate }}</span>
              </a>
              @for (a of areas(); track a.id) {
                <a class="mi" role="menuitem" [routerLink]="a.link" [class.active]="activeArea() === a.id"
                   [class.elevated]="a.elevated" (click)="onMenuNav($event, a.link)">
                  <span class="mi-label">{{ a.labelKey | translate }}</span>
                  @if (a.elevated) { <span class="mi-tag">{{ 'nav.adminOnly' | translate }}</span> }
                </a>
              }
            </div>
          }
        </div>

        @if (segments(); as segs) {
          <nav class="kinds" [class.arrive]="collapsing()" [attr.aria-label]="'codex.categoriesAria' | translate">
            @for (s of segs; track s.id) {
              <a class="kind" [routerLink]="s.link" [queryParams]="s.queryParams"
                 [class.active]="activeSegment() === s.id"
                 [attr.aria-current]="activeSegment() === s.id ? 'page' : null"
                 [scTooltip]="s.labelKey | translate" scTooltipTier="label"
                 [scTooltipDisabled]="activeSegment() === s.id || !iconOnlyKinds()">
                <span class="k-icon" aria-hidden="true">
                  @if (s.icon) {
                    <sc-codex-icon [kind]="s.icon" />
                  } @else if (s.id === 'upcoming') {
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
                  } @else {
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="11" rx="2" /><path d="M7 11h.01M11 11h.01M15 11h.01M8 15h8" /></svg>
                  }
                </span>
                <span class="k-label">{{ s.labelKey | translate }}</span>
              </a>
            }
          </nav>
        } @else if (showCrumbs()) {
          <div class="where">
            @if (sectionLabel(); as sec) {
              <span class="section" aria-live="polite">{{ sec }}</span>
            }
            @if (crumbs()?.crumbs?.length) {
              <nav class="crumbs" [attr.aria-label]="'pageHeader.crumbsAria' | translate">
                <ol>
                  @for (c of crumbs()!.crumbs; track $index; let last = $last) {
                    <li [class.last]="last">
                      <a class="crumb" [routerLink]="$any(c.link)" [queryParams]="c.queryParams ?? null">{{
                        c.label ?? (c.labelKey! | translate: (c.labelParams ?? undefined))
                      }}</a>
                    </li>
                  }
                  @if (crumbs()!.title; as t) {
                    <li class="here" aria-current="page"><span>{{ t }}</span></li>
                  }
                </ol>
              </nav>
            }
          </div>
        }
      }

      @if (variant() === 'app' && showSearch()) {
        <sc-fusion-search class="search" [placement]="phone() ? 'bottom' : 'top'" [compact]="mode() === 'tool'"
                          (openChange)="onSearchOpen($event)">
          @if (toolbar()) {
            <button fsTrailing type="button" class="drawer-toggle" [class.on]="drawerOpen()"
                    [attr.aria-expanded]="drawerOpen()" aria-controls="sc-bar-drawer"
                    [attr.aria-label]="'fusionBar.filters' | translate"
                    (click)="toggleDrawer()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
              </svg>
              <span class="dt-label">{{ 'fusionBar.filters' | translate }}</span>
            </button>
          }
        </sc-fusion-search>
      } @else {
        <span class="spacer"></span>
      }

      <div class="account"><ng-content select="[barAccount]" /></div>
    </div>

    @if (drawerShown()) {
      <div class="drawer" id="sc-bar-drawer" role="region" [attr.aria-label]="'fusionBar.filters' | translate">
        <ng-container [ngTemplateOutlet]="toolbar()" />
      </div>
    }

    @if (phone() && segments(); as segs) {
      <!-- Phone: the Codex kinds as a chip row at the top (the capsule at the bottom has no room). -->
      <nav class="kinds-phone" [attr.aria-label]="'codex.categoriesAria' | translate">
        @for (s of segs; track s.id) {
          <a class="kchip" [routerLink]="s.link" [queryParams]="s.queryParams" [class.active]="activeSegment() === s.id"
             [attr.aria-current]="activeSegment() === s.id ? 'page' : null">{{ s.labelKey | translate }}</a>
        }
      </nav>
    }
  `,
  styleUrl: './fusion-bar.component.scss',
})
export class FusionBarComponent {
  private readonly router = inject(Router);
  private readonly layout = inject(LayoutService);
  private readonly chrome = inject(ShellChromeService);
  private readonly roles = inject(RoleService);
  private readonly beta = inject(BetaService);
  private readonly sameRoute = inject(SameRouteRefreshService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);
  private readonly injector = inject(Injector);

  /** `app` (shell) or `public` (public layout: brand + way home, no search, no account). */
  readonly variant = input<'app' | 'public'>('app');

  private readonly url = signal(this.router.url);
  readonly menuOpen = signal(false);
  readonly searchOpen = signal(false);
  readonly drawerOpen = signal(true);
  readonly hidden = signal(false);
  readonly morphing = signal(false);
  readonly collapsing = signal(false);
  readonly phone = signal(matches('(max-width: 720px)'));
  readonly iconOnlyKinds = signal(matches('(max-width: 1279px)'));
  private readonly autoSection = signal<string | null>(null);

  readonly mode = computed<BarMode>(() => barModeOf(this.layout.layout(), this.chrome.stageSearch()));
  readonly crumbs = this.chrome.crumbs;
  readonly toolbar = this.chrome.toolbar;
  readonly drawerShown = computed(() => !!this.toolbar() && this.drawerOpen() && !this.searchOpen());
  readonly showStageLayer = computed(() => {
    const m = this.mode();
    return this.variant() === 'public' || m === 'stage' || m === 'hub';
  });
  readonly showSearch = computed(() => this.mode() !== 'stage');
  readonly showCrumbs = computed(() => this.mode() !== 'docked' || !!this.chrome.section());
  readonly sectionLabel = computed(() => this.chrome.section() ?? this.autoSection());

  readonly areas = computed(() =>
    AREA_ENTRIES.filter((a) => {
      if (a.id === 'hq') return this.beta.state().codex;
      if (a.id === 'starscape') return !this.beta.state().verse;
      if (a.elevated) return this.roles.isAdmin();
      return true;
    }),
  );
  readonly activeArea = computed(() => activeAreaOf(this.url(), !this.beta.state().verse));
  readonly areaLabelKey = computed(() => AREA_ENTRIES.find((a) => a.id === this.activeArea())?.labelKey ?? 'fusionBar.home');
  readonly activeSegment = computed(() => activeSegmentOf(this.url()));
  /** Codex kinds as segments: on the Codex tool pages (index, FPS, upcoming, keybinds). */
  readonly segments = computed<readonly CodexSegment[] | null>(() =>
    this.variant() === 'app' && isCodexToolPage(this.url()) ? CODEX_SEGMENTS : null,
  );

  private readonly tracker = new HideTracker();
  private morphTimer: ReturnType<typeof setTimeout> | null = null;
  private collapseTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMode: BarMode | null = null;
  private hadCrumbs = false;
  private rafPending = false;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      this.hadCrumbs = !this.segments() && !!this.crumbs()?.crumbs.length;
      this.url.set(e.urlAfterRedirects);
      this.menuOpen.set(false);
      this.autoSection.set(null);
      this.setHidden(false);
      this.tracker.reset(typeof window === 'undefined' ? 0 : window.scrollY);
      // The crumb collapses into the active Codex segment on the way in.
      if (this.hadCrumbs && this.segments()) this.pulse(this.collapsing, 'collapse', 420);
    });

    // The one-shot morph: stage → docked plays the weld; any other change is a plain swap.
    effect(() => {
      const m = this.mode();
      untracked(() => {
        if (this.lastMode === 'stage' && m === 'docked') this.pulse(this.morphing, 'morph', 640);
        this.lastMode = m;
        if (!hidesOnScroll(m)) this.setHidden(false);
      });
    });

    afterNextRender(() => this.zone.runOutsideAngular(() => this.listen()), { injector: this.injector });
    inject(DestroyRef).onDestroy(() => {
      if (this.morphTimer) clearTimeout(this.morphTimer);
      if (this.collapseTimer) clearTimeout(this.collapseTimer);
      this.chrome.setBarHidden(false);
      if (typeof document !== 'undefined') {
        document.documentElement.style.removeProperty('--sc-topbar-h');
        document.documentElement.style.removeProperty('--sc-bar-stack-h');
      }
    });
  }

  private listen(): void {
    if (typeof window === 'undefined') return;
    const onScroll = () => {
      if (this.rafPending) return;
      this.rafPending = true;
      requestAnimationFrame(() => {
        this.rafPending = false;
        this.onScrollFrame();
      });
    };
    const onResize = () => {
      const phone = matches('(max-width: 720px)');
      const iconOnly = matches('(max-width: 1279px)');
      if (phone !== this.phone() || iconOnly !== this.iconOnlyKinds()) {
        this.zone.run(() => {
          this.phone.set(phone);
          this.iconOnlyKinds.set(iconOnly);
        });
      }
      this.publishHeight();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    // The stack grows with the drawer / kind chips: keep the published heights true.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.publishHeight());
    ro?.observe(this.host.nativeElement as HTMLElement);
    window.addEventListener('resize', onResize, { passive: true });
    this.publishHeight();
    this.injector.get(DestroyRef).onDestroy(() => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    });
  }

  private onScrollFrame(): void {
    const y = window.scrollY;
    const barH = this.barHeight();
    if (hidesOnScroll(this.mode()) && !this.searchOpen() && !this.menuOpen()) {
      const next = this.tracker.update(y, barH);
      if (next !== this.hidden()) this.zone.run(() => this.setHidden(next));
    } else {
      this.tracker.reset(y);
    }
    if (this.mode() === 'content' && !this.chrome.section()) {
      const label = sectionInView(barH);
      if (label !== this.autoSection()) this.zone.run(() => this.autoSection.set(label));
    }
  }

  private barHeight(): number {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sc-bar-h'));
    return Number.isFinite(v) && v > 0 ? v : 64;
  }

  private setHidden(hidden: boolean): void {
    if (this.hidden() === hidden) return;
    this.hidden.set(hidden);
    this.chrome.setBarHidden(hidden);
    this.publishHeight();
  }

  /**
   * `--sc-topbar-h`: where a page's own sticky bar parks (settings rail). The
   * capsule's height while it is shown at the top; 0 while hidden or on a
   * phone (the capsule is at the bottom there).
   */
  private publishHeight(): void {
    if (typeof document === 'undefined') return;
    const el = this.host.nativeElement as HTMLElement;
    const px = this.phone() || this.hidden() ? 0 : Math.round(el.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--sc-topbar-h', `${px}px`);
    // Phone: the whole bottom stack (capsule + kind chips / drawer) the page must keep free.
    const stack = this.phone() ? Math.round(el.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--sc-bar-stack-h', `${stack}px`);
  }

  private pulse(flag: typeof this.morphing, kind: 'morph' | 'collapse', ms: number): void {
    if (kind === 'morph' && this.morphTimer) clearTimeout(this.morphTimer);
    if (kind === 'collapse' && this.collapseTimer) clearTimeout(this.collapseTimer);
    flag.set(true);
    const t = setTimeout(() => flag.set(false), ms);
    if (kind === 'morph') this.morphTimer = t;
    else this.collapseTimer = t;
  }

  /** Focus inside the bar always brings it back (keyboard users never lose it). */
  reveal(): void {
    this.setHidden(false);
  }

  onSearchOpen(open: boolean): void {
    this.searchOpen.set(open);
    if (open) {
      this.menuOpen.set(false);
      this.setHidden(false);
    }
  }

  toggleDrawer(): void {
    this.drawerOpen.update((v) => !v);
  }

  onNav(ev: MouseEvent, path: string): void {
    if (!isPlainLeftClick(ev)) return;
    this.sameRoute.request(path);
  }

  // ---- area menu (menu-button pattern) ----

  toggleMenu(ev: Event): void {
    ev.stopPropagation();
    this.menuOpen.update((v) => !v);
  }

  onSegKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    this.menuOpen.set(true);
    const last = ev.key === 'ArrowUp';
    afterNextRender(
      () => {
        const items = this.menuItems();
        items[last ? items.length - 1 : 0]?.focus();
      },
      { injector: this.injector },
    );
  }

  onMenuKeydown(ev: KeyboardEvent): void {
    const items = this.menuItems();
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      items[(i + 1) % items.length].focus();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      items[(i - 1 + items.length) % items.length].focus();
    } else if (ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault();
      items[ev.key === 'Home' ? 0 : items.length - 1].focus();
    } else if (ev.key === 'Escape') {
      ev.stopPropagation();
      this.closeMenu(true);
    } else if (ev.key === 'Tab') {
      this.closeMenu();
    }
  }

  onMenuNav(ev: MouseEvent, path: string): void {
    if (!isPlainLeftClick(ev)) return;
    this.sameRoute.request(path);
    this.closeMenu();
  }

  closeMenu(returnFocus = false): void {
    this.menuOpen.set(false);
    if (returnFocus) (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.seg')?.focus();
  }

  private menuItems(): HTMLElement[] {
    return Array.from((this.host.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.menu .mi'));
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (!this.menuOpen()) return;
    const wrap = (this.host.nativeElement as HTMLElement).querySelector('.seg-wrap');
    if (wrap && !wrap.contains(ev.target as Node)) this.closeMenu();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.menuOpen()) this.closeMenu();
  }
}

function matches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

/** The last `h2` of the routed page whose top has passed under the bar — the section in view. */
function sectionInView(barH: number): string | null {
  const main = document.getElementById('sc-main');
  if (!main) return null;
  let label: string | null = null;
  for (const h of Array.from(main.querySelectorAll<HTMLElement>('h2'))) {
    const top = h.getBoundingClientRect().top;
    if (top > barH + 24) break;
    if (h.offsetParent === null) continue;
    const text = (h.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) label = text.length > 40 ? `${text.slice(0, 39)}…` : text;
  }
  return label;
}

