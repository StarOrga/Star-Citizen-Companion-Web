import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { setRootVar } from '../../core/root-var';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { BetaService } from '../../core/beta.service';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { SameRouteRefreshService } from '../../core/same-route-refresh.service';
import { BrandLogoComponent, BrandNameComponent } from '../brand/brand.component';
import { AREA_ENTRIES, activeAreaOf } from '../fusion-bar/fusion-bar.model';
import { ShellChromeService, introBeatCss } from '../fusion-bar/shell-chrome.service';

/** Width of one nav slot — fixed, so the nav never shifts between main pages. */
export const MAIN_NAV_SLOT_PX = 112;

/**
 * `<sc-main-header>` — the cinematic main header of the beta shell: brand, main
 * nav and the account button standing directly on the scene. No capsule, no
 * frame, no surface — a soft text shadow and a top scrim carry legibility.
 *
 * Corner layout (concept 2026-10-29 startseite-animationen): the brand (logo,
 * wordmark, Alpha badge) is pinned to the top-LEFT viewport corner and apps menu
 * + profile to the top-RIGHT, both at the feedback launcher's inset
 * (`--sc-fab-inset`, plus the safe areas); the nav stands centred. The Admin
 * entry is not part of the header: it sits in the account menu (red, in words). The header is NOT sized by the page frame.
 *
 * Shown by the shell on the main pages (`isMainHeaderPage`) and kept mounted
 * for the whole beta shell: on every other page it stays condensed (inert,
 * invisible). The condense is SCROLL-LINKED: `--sc-dock-p` (0 → 1 over
 * `DOCK_SCROLL_PX` of scroll, painted by ShellChromeService) drives wordmark and
 * nav (fade, nav scale .86 + blur 6px), the logo and the account (they glide
 * from the corners to the ends of the narrower docked bar) and the scrim. Half
 * scrolled is half docked; a smooth programmatic scroll plays the same. Route
 * changes ease the property for a moment (`data-ease`), a silent jump (`snap`)
 * does not transition at all. At progress 1 the header is inert and the bar's
 * own logo and account take over.
 *
 * The account menu is the shell's own, projected as `[mhAccount]`.
 */
@Component({
  selector: 'sc-main-header',
  standalone: true,
  imports: [RouterLink, TranslatePipe, BrandLogoComponent, BrandNameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'banner',
    '[class.compressed]': 'compressed()',
    '[class.snap]': 'snap()',
    '[attr.inert]': "compressed() || introWait() ? '' : null",
    '[class.hero-intro]': 'introWait()',
    '[class.intro-hold]': 'introHold()',
    '[style.--sc-intro-k]': 'introK()',
    '[style.--sc-intro-header-at]': 'introHeaderAt()',
  },
  template: `
    <a class="brand" routerLink="/verse" [attr.aria-label]="'nav.brandAria' | translate"
       (click)="onNav($event, '/verse')">
      <sc-brand-logo class="logo" />
      <sc-brand-name class="wordmark" channel="stack" />
    </a>

    <div class="row">
      <nav class="nav" [attr.aria-label]="'fusionBar.navAria' | translate"
           [style.--mh-slots]="areas().length">
        @for (a of areas(); track a.id) {
          <a class="slot" [routerLink]="a.link" [class.active]="activeArea() === a.id"
             [attr.aria-current]="activeArea() === a.id ? 'page' : null"
             (click)="onNav($event, a.link)">
            {{ a.labelKey | translate }}
          </a>
        }
        @if (activeIndex() >= 0) {
          <span class="ind" [style.--mh-i]="activeIndex()" aria-hidden="true"></span>
        }
      </nav>
    </div>

    <!-- Measuring probe: where the docked bar's content edge and logo row stand (--_rail, --_dock-top). -->
    <i class="probe" aria-hidden="true"></i>

    <!-- Top-right corner: apps + profile. Admin is not here: it lives in the account menu. -->
    <div class="account">
      <div class="acc-main"><ng-content select="[mhAccount]" /></div>
    </div>
  `,
  styles: [
    `
      :host {
        --mh-slot: ${MAIN_NAV_SLOT_PX}px;
        --mh-shadow: 0 1px 14px color-mix(in srgb, var(--sc-depth) 90%, transparent), 0 0 2px color-mix(in srgb, var(--sc-depth) 80%, transparent);
        --mh-ease: cubic-bezier(0.55, 0, 0.2, 1);
        /* Where the corners stand: the feedback launcher's inset + the safe areas. */
        --_x: max(var(--sc-fab-inset), env(safe-area-inset-left, 0px));
        --_xr: max(var(--sc-fab-inset), env(safe-area-inset-right, 0px));
        --_top: var(--sc-chrome-top);
        /* One centre line for brand, nav, apps and avatar: every control is this tall. */
        --_item: var(--sc-head-item-h, 40px);
        /* Where a control's top lands on the docked bar (60px, same top): centred in it. */
        --_dock-top: calc(var(--sc-chrome-top) + (var(--sc-sub-h) - var(--_item)) / 2);
        /* The docked bar the corners glide into: its content edge (border + padding). */
        --_rail: calc((100% - var(--sc-dock-w)) / 2 + 1px + var(--sc-space-4));
        --_p: var(--sc-dock-p, 0);
        /* One ease per beat (S1): every element runs its own slice of the scroll-linked progress
           through a smoothstep, so they leave one after another and overlap a little. The deltas
           (--_bdx … --_ndy, px) are measured per layout; the frames only multiply them. */
        --_lm: clamp(0, calc((var(--_p) - 0.03) / 0.87), 1);
        --_em: calc(var(--_lm) * var(--_lm) * (3 - 2 * var(--_lm)));
        --_la: clamp(0, calc((var(--_p) - 0.1) / 0.8), 1);
        --_ea: calc(var(--_la) * var(--_la) * (3 - 2 * var(--_la)));
        /* Pinned: the page scrolls under the header. */
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 25;
        display: block;
        /* 100cqw = the header's own width: the docked bar's edges are measured against it. */
        container-type: inline-size;
        padding-top: var(--_top);
        padding-bottom: var(--sc-space-4);
        pointer-events: none;
      }
      /* The open account menu lies over the beta chip (z-index 45), which would cover its head. */
      :host(.menu-open) { z-index: 46; }
      /* A route change eases the progress for a moment; scrolling sets it directly. */
      :host([data-ease]) {
        transition: --sc-dock-p 1.1s var(--mh-ease);
      }
      /* First Verse visit: the header appears when the hub's entrance reaches 1.9 s (after
         the stars and the app's name). Announced but not started (.intro-hold): it stands
         at its hidden first frame — from the very first paint, not only once the hub loaded. */
      :host(.hero-intro) {
        animation: mh-intro calc(0.6s * var(--sc-intro-k, 1)) cubic-bezier(0.16, 1, 0.3, 1) var(--sc-intro-header-at, calc(1.9s * var(--sc-intro-k, 1))) both;
      }
      :host(.hero-intro.intro-hold) {
        animation-play-state: paused;
      }
      @keyframes mh-intro {
        from { opacity: 0; transform: translateY(-14px); }
        to { opacity: 1; transform: none; }
      }
      /* Legibility scrim: a soft fade from the top, no edge, no surface. */
      :host::before {
        content: '';
        position: absolute;
        inset: 0 0 auto 0;
        height: 150px;
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-0) 55%, transparent), transparent);
        pointer-events: none;
        z-index: -1;
        opacity: calc(1 - var(--_p));
      }
      .probe {
        position: absolute;
        left: var(--_rail);
        top: var(--_dock-top);
        width: 1px;
        height: var(--_item);
        visibility: hidden;
        pointer-events: none;
      }
      .row {
        display: flex;
        justify-content: center;
        align-items: center;
        height: var(--_item);
      }
      /* Brand: the logo is the anchor, top-left at the inset, gliding to the docked bar's logo slot. */
      .brand {
        position: absolute;
        z-index: 1;
        left: var(--_x);
        top: var(--_top);
        /* Straight line to the bar's logo slot, compositor only. */
        transform: translate(calc(var(--_bdx, 0px) * var(--_em)), calc(var(--_bdy, 0px) * var(--_em)));
        display: flex;
        align-items: center;
        height: var(--_item);
        color: var(--sc-fg-0);
        text-decoration: none;
        text-shadow: 0 2px 14px color-mix(in srgb, var(--sc-depth) 85%, transparent);
        border-radius: 8px;
        pointer-events: auto;
      }
      /* Logo + name come from shell/brand (one source with the subheader, same size and glow). */
      .logo {
        /* Stands until the bar's own logo takes over (.compressed): never a frame without one. */
        opacity: 1;
        transition: none;
      }
      .wordmark {
        position: absolute;
        left: calc(100% + var(--sc-space-3));
        top: 50%;
        display: grid;
        /* Absolutely placed: without it the name shrinks to its min-content and ellipsises. */
        width: max-content;
        transform: translateY(-50%);
        /* Two lines out, the bar's one-line name in (it fades in from half way). */
        opacity: clamp(0, calc(1 - (var(--_p) - 0.15) * 2.6), 1);
      }
      .nav {
        position: relative;
        display: flex;
        pointer-events: auto;
        /* The active area travels to the crumb on the bar's second line; the others fade away. */
        transform: translate(calc(var(--_ndx, 0px) * var(--_em)), calc(var(--_ndy, 0px) * var(--_em))) ;
      }
      .slot:not(.active),
      .ind {
        opacity: clamp(0, calc(1 - var(--_p) * 4.5), 1);
      }
      .slot.active {
        opacity: clamp(0, calc(1 - (var(--_p) - 0.55) * 2.4), 1);
      }
      /* Top-right corner: apps + profile glide to the docked bar's right end; the sub row hangs below. */
      .account {
        position: absolute;
        z-index: 1;
        right: var(--_xr);
        top: var(--_top);
        transform: translate(calc(var(--_adx, 0px) * var(--_ea)), calc(var(--_ady, 0px) * var(--_ea)));
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        pointer-events: auto;
      }
      .acc-main {
        display: flex;
        align-items: center;
        height: var(--_item);
        /* Stands until the bar's own account takes over (.compressed): the icons never vanish. */
        opacity: 1;
      }
      /* A silent jump (route change, scroll reset): no transition at all. */
      :host(.snap),
      :host(.snap) * {
        transition: none !important;
      }
      /* Condensed: nothing of it is reachable (the bar carries logo and account). */
      :host(.compressed) * {
        pointer-events: none;
      }
      /* The hand-over to the bar's own logo and account is one hard swap (same spot, no fade). */
      :host(.compressed) .logo,
      :host(.compressed) .acc-main {
        opacity: 0;
      }
      .slot {
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        width: var(--mh-slot);
        height: var(--_item);
        padding: 0;
        /* The trailing letter-spacing would shift the label left of its slot's centre. */
        text-indent: 0.22em;
        text-align: center;
        font-family: var(--sc-font-display);
        font-size: 13px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        text-decoration: none;
        color: var(--sc-fg-1);
        text-shadow: var(--mh-shadow);
        border-radius: 8px;
        transition: color 0.2s ease, text-shadow 0.2s ease;
      }
      .slot:hover {
        color: var(--sc-fg-0);
      }
      .slot.active {
        color: var(--sc-fg-0);
        text-shadow: 0 0 18px color-mix(in srgb, var(--sc-accent) 55%, transparent), var(--mh-shadow);
      }
      .brand:focus-visible,
      .slot:focus-visible {
        outline: 2px solid var(--sc-accent);
        outline-offset: 2px;
      }
      /* One indicator that glides under the active slot on a menu switch. */
      .ind {
        position: absolute;
        bottom: 2px;
        left: calc(var(--mh-i) * var(--mh-slot) + (var(--mh-slot) - 40px) / 2);
        width: 40px;
        height: 2px;
        border-radius: 2px;
        background: var(--sc-accent);
        box-shadow: 0 0 12px var(--sc-accent);
        transition: left 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.2s ease;
      }
      /* Tablet: the wordmark yields to the nav. */
      @media (max-width: 1099px) {
        .wordmark {
          display: none;
        }
      }
      /* Phone: brand + account on top (the beta chip keeps the corner: its lane stays free),
         the nav as a second row of equal slots. The bar is at the thumb, so
         nothing glides: the header just fades out as a whole. */
      @media (max-width: 720px) {
        :host {
          padding-inline: var(--_x) var(--_xr);
          padding-bottom: var(--sc-space-1);
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          row-gap: var(--sc-space-1);
        }
        .brand,
        .account {
          position: static;
        }
        /* The wordmark shares the row with apps + avatar: it shrinks, then truncates — never overlaps. */
        .wordmark {
          position: static;
          display: grid;
          min-width: 0;
          transform: none;
        }
        .title {
          overflow: hidden;
          font-size: 12px;
          letter-spacing: 0.1em;
          text-overflow: ellipsis;
        }
        .brand {
          display: flex;
          align-items: center;
          min-width: 0;
          gap: var(--sc-space-2);
        }
        .logo {
          width: 34px;
          height: 34px;
        }
        .row {
          grid-column: 1 / -1;
          grid-row: 2;
          height: auto;
        }
        .nav {
          width: 100%;
          --mh-slot: calc((100vw - var(--_x) - var(--_xr)) / var(--mh-slots, 4));
          transform: none;
        }
        .slot {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-indent: 0.14em;
          min-height: var(--sc-tap-min, 44px);
          box-sizing: border-box;
        }
        /* Phone: logo and account stay on top (the route line joins them, the search flies to
           the thumb bar); nothing travels, so the deltas are zero. */
        .brand,
        .account,
        .nav {
          transform: none;
        }
      }
      /* Narrow phones: five equal slots cannot hold "Starscape" (a slot is ~58px
         under the beta chip lane) and the wordmark ran under the account buttons.
         The nav row takes the full width (the chip lane only guards the top row),
         slots size to their label, the active one carries its own underline, and
         the wordmark wraps. */
      @media (max-width: 420px) {
        :host {
          grid-template-columns: minmax(0, 1fr) auto;
          column-gap: var(--sc-space-2);
        }
        .row {
          margin-inline-end: calc(var(--_x) - var(--_xr));
        }
        .nav {
          justify-content: space-between;
        }
        .slot {
          position: relative;
          width: auto;
          flex: 0 1 auto;
          padding-inline: 4px;
          font-size: 11px;
          letter-spacing: 0.08em;
          white-space: nowrap;
        }
        .ind {
          display: none !important;
        }
        .slot.active::after {
          content: "";
          position: absolute;
          left: 50%;
          bottom: 2px;
          width: 28px;
          height: 2px;
          border-radius: 2px;
          transform: translateX(-50%);
          background: var(--sc-accent);
          box-shadow: 0 0 12px var(--sc-accent);
        }
        .brand {
          min-width: 0;
        }
        .wordmark {
          min-width: 0;
          white-space: normal;
        }
        .title {
          font-size: 11px;
          letter-spacing: 0.1em;
          line-height: 1.15;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        :host([data-ease]) {
          transition: none;
        }
        :host(.hero-intro) {
          animation: none;
        }
        .ind,
        .slot {
          transition: none;
        }
      }
    `,
  ],
})
export class MainHeaderComponent {
  private readonly chrome = inject(ShellChromeService);
  private readonly injector = inject(Injector);
  /** Condensed into the bar (progress 1, or not a main page at all): inert and invisible. */
  readonly compressed = computed(() => this.chrome.stageSearch() === 'none' || this.chrome.dockFull());
  /** A silent state jump (route change / scroll reset): transitions off for it. */
  readonly snap = this.chrome.snap;
  private readonly router = inject(Router);
  private readonly beta = inject(BetaService);
  private readonly sameRoute = inject(SameRouteRefreshService);

  private readonly url = signal(this.router.url);

  /** The nav: the public areas only. Admin (elevated) lives in the account menu, never here. */
  readonly areas = computed(() =>
    AREA_ENTRIES.filter((a) => {
      if (a.elevated) return false;
      if (a.id === 'hq') return this.beta.state().codex;
      if (a.id === 'starscape') return !this.beta.state().verse;
      return true;
    }),
  );
  readonly activeArea = computed(() => activeAreaOf(this.url(), !this.beta.state().verse));
  readonly activeIndex = computed(() => this.areas().findIndex((a) => a.id === this.activeArea()));

  /** The hub's first-visit intro holds the header back until its 1.9 s mark. */
  readonly introWait = computed(() => this.chrome.heroIntro()?.full === true);
  /** The entrance is announced but not started: the header stands at its hidden first frame. */
  readonly introHold = computed(() => this.chrome.heroIntro()?.hold === true);
  readonly introK = computed(() => this.chrome.heroIntro()?.k ?? 1);
  /** The main header's own entrance beat (null = 1.9 s * k). */
  readonly introHeaderAt = computed(() => introBeatCss(this.chrome.heroIntro()?.headerAtMs));

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof NavigationEnd) this.url.set(e.urlAfterRedirects);
    });
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    // Scroll-linked condense: the shell chrome paints --sc-dock-p on this host.
    afterNextRender(() => {
      destroyRef.onDestroy(this.chrome.registerDockTarget(host));
    });
    // S1: the straight lines from the big header's places to the docked bar's (measured, not per frame).
    afterNextRender(() => {
      if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return;
      let frame = 0;
      const run = () => {
        frame = 0;
        measureMorph(host);
      };
      const later = () => {
        if (!frame) frame = requestAnimationFrame(run);
      };
      later();
      const ro = new ResizeObserver(later);
      ro.observe(host);
      window.addEventListener('resize', later, { passive: true });
      // The active area (and so the nav's target) changes with the route; fonts change label widths.
      const stop = effect(() => (this.activeIndex(), later()), { injector: this.injector });
      document.fonts?.ready.then(later).catch(() => undefined);
      destroyRef.onDestroy(() => {
        ro.disconnect();
        window.removeEventListener('resize', later);
        stop.destroy();
        if (frame) cancelAnimationFrame(frame);
      });
    });
    // The pinned header is out of flow: publish its height for the shell's spacer.
    afterNextRender(() => {
      if (typeof document === 'undefined') return;
      const publish = () =>
        setRootVar('--sc-mainhead-h', `${Math.round(host.offsetHeight)}px`);
      publish();
      // One frame later: the published height resizes the spacer (and the body), which a
      // write inside this callback would report again in the same frame (RO loop error).
      let frame = 0;
      const later = () => {
        if (!frame) frame = requestAnimationFrame(() => ((frame = 0), publish()));
      };
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
      ro?.observe(host);
      destroyRef.onDestroy(() => {
        ro?.disconnect();
        document.documentElement.style.removeProperty('--sc-mainhead-h');
      });
    });
  }

  onNav(ev: MouseEvent, path: string): void {
    if (!isPlainLeftClick(ev)) return;
    this.sameRoute.request(path);
  }
}

/** Plate text starts after the bar's logo slot (44px) and its own gap. */
const BAR_LOGO_SLOT_PX = 44;

/**
 * Measures the straight lines of the header morph (S1) and paints them as px deltas on the host:
 * the brand to the bar's logo slot, the account inwards to the bar's far end, the nav so that its
 * active area lands on the crumb line (second line of the plate). The frames only multiply them by
 * the eased progress. On phones nothing travels (logo and account stay on top).
 */
export function measureMorph(host: HTMLElement): void {
  const set = (k: string, v: number) => host.style.setProperty(k, `${Math.round(v * 10) / 10}px`);
  const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches;
  const probe = host.querySelector<HTMLElement>('.probe');
  const brand = host.querySelector<HTMLElement>('.brand');
  const account = host.querySelector<HTMLElement>('.account');
  const zero = () => ['--_bdx', '--_bdy', '--_adx', '--_ady', '--_ndx', '--_ndy'].forEach((k) => set(k, 0));
  if (phone || !probe || !brand || !account) return zero();
  const hostW = host.clientWidth;
  const railX = probe.offsetLeft;
  const dockTop = probe.offsetTop;
  // offsetLeft/Top ignore transforms: the brand's resting place in the big header.
  set('--_bdx', railX - brand.offsetLeft);
  set('--_bdy', dockTop - brand.offsetTop);
  // The account's right edge goes to the bar's far content edge.
  const accRight = account.offsetLeft + account.offsetWidth;
  set('--_adx', hostW - railX - accRight);
  set('--_ady', dockTop - account.offsetTop);
  const slot = host.querySelector<HTMLElement>('.slot.active');
  if (!slot) {
    set('--_ndx', 0);
    set('--_ndy', 0);
    return;
  }
  const nav = slot.parentElement as HTMLElement;
  const range = document.createRange();
  range.selectNodeContents(slot);
  const textW = range.getBoundingClientRect().width;
  const slotCx = nav.offsetLeft + slot.offsetLeft + slot.offsetWidth / 2;
  const slotCy = nav.offsetTop + slot.offsetTop + slot.offsetHeight / 2;
  // Crumb line: right of the logo slot, on the plate's second line (about 9px under the bar's centre).
  const targetX = railX + BAR_LOGO_SLOT_PX + textW / 2;
  const targetY = dockTop + brand.offsetHeight / 2 + 9;
  set('--_ndx', targetX - slotCx);
  set('--_ndy', targetY - slotCy);
}
