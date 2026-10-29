import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { BetaService } from '../../core/beta.service';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { SameRouteRefreshService } from '../../core/same-route-refresh.service';
import { AREA_ENTRIES, activeAreaOf } from '../fusion-bar/fusion-bar.model';
import { ShellChromeService } from '../fusion-bar/shell-chrome.service';

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
 * entry (red, in words) and the beta chip form a small row directly below apps +
 * profile, right-aligned. The header is NOT sized by the page frame.
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
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'banner',
    '[class.compressed]': 'compressed()',
    '[class.snap]': 'snap()',
    '[attr.inert]': "compressed() || introWait() ? '' : null",
    '[class.hero-intro]': 'introWait()',
    '[style.--sc-intro-k]': 'introK()',
  },
  template: `
    <a class="brand" routerLink="/verse" [attr.aria-label]="'nav.brandAria' | translate"
       (click)="onNav($event, '/verse')">
      <img class="logo" src="icons/brand/scc-mark.svg" alt="" width="34" height="34" />
      <span class="wordmark">
        <span class="title">Star Citizen Companion</span>
        <span class="alpha">{{ 'nav.phaseBadge' | translate }}</span>
      </span>
    </a>

    <div class="row">
      <nav class="nav" [attr.aria-label]="'fusionBar.navAria' | translate"
           [style.--mh-slots]="areas().length">
        @for (a of areas(); track a.id) {
          <a class="slot" [routerLink]="a.link" [class.active]="activeArea() === a.id" [class.elevated]="a.elevated"
             [class.adm]="a.elevated"
             [attr.aria-current]="activeArea() === a.id ? 'page' : null"
             (click)="onNav($event, a.link)">
            {{ a.labelKey | translate }}
            @if (a.elevated) { <span class="sr-only"> ({{ 'nav.adminOnly' | translate }})</span> }
          </a>
        }
        @if (activeIndex() >= 0) {
          <span class="ind" [class.elevated]="activeElevated()" [style.--mh-i]="activeIndex()" aria-hidden="true"></span>
        }
      </nav>
    </div>

    <!-- Top-right corner: apps + profile; below them the Admin entry (desktop; on a phone
         it stays a nav slot) beside the beta chip's lane. -->
    <div class="account">
      <div class="acc-main"><ng-content select="[mhAccount]" /></div>
      @if (admin(); as adm) {
        <div class="subrow">
          <a class="admin" [routerLink]="adm.link" [class.active]="activeArea() === adm.id"
             [attr.aria-current]="activeArea() === adm.id ? 'page' : null"
             (click)="onNav($event, adm.link)">
            {{ adm.labelKey | translate }}
            <span class="sr-only"> ({{ 'nav.adminOnly' | translate }})</span>
          </a>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        --mh-slot: ${MAIN_NAV_SLOT_PX}px;
        --mh-shadow: 0 1px 14px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.8);
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
        /* Pinned: the page scrolls under the header. */
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 25;
        display: block;
        padding-top: var(--_top);
        padding-bottom: var(--sc-space-4);
        pointer-events: none;
      }
      /* A route change eases the progress for a moment; scrolling sets it directly. */
      :host([data-ease]) {
        transition: --sc-dock-p 1.1s var(--mh-ease);
      }
      /* First Verse visit: the header appears only when the hub's title sequence reaches 4.85 s. */
      :host(.hero-intro) {
        animation: mh-intro calc(0.6s * var(--sc-intro-k, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(4.85s * var(--sc-intro-k, 1)) both;
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
        left: calc(var(--_x) * (1 - var(--_p)) + var(--_rail) * var(--_p));
        top: calc(var(--_top) * (1 - var(--_p)) + var(--_dock-top) * var(--_p));
        display: flex;
        align-items: center;
        height: var(--_item);
        color: var(--sc-fg-0);
        text-decoration: none;
        text-shadow: 0 2px 14px rgba(0, 0, 0, 0.85);
        border-radius: 8px;
        pointer-events: auto;
      }
      .logo {
        display: block;
        width: calc(34px - 6px * var(--_p));
        height: calc(34px - 6px * var(--_p));
        filter: drop-shadow(0 0 8px color-mix(in srgb, var(--sc-accent) 55%, transparent));
        /* Gone the moment it has landed: the bar's own logo stands there. */
        opacity: clamp(0, calc((0.99 - var(--_p)) * 100), 1);
      }
      .wordmark {
        position: absolute;
        left: calc(100% + var(--sc-space-3));
        top: 50%;
        display: grid;
        transform: translateY(-50%);
        white-space: nowrap;
        opacity: clamp(0, calc(1 - var(--_p) * 3), 1);
      }
      .title {
        font-family: var(--sc-font-display);
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .alpha {
        font-family: var(--sc-font-display);
        font-size: 9px;
        letter-spacing: 0.42em;
        text-transform: uppercase;
        color: var(--sc-accent);
      }
      .nav {
        position: relative;
        display: flex;
        pointer-events: auto;
        transform: scale(calc(1 - 0.14 * var(--_p)));
        filter: blur(calc(6px * var(--_p)));
        opacity: clamp(0, calc(1 - var(--_p) * 1.7), 1);
      }
      /* Top-right corner: apps + profile glide to the docked bar's right end; the sub row hangs below. */
      .account {
        position: absolute;
        z-index: 1;
        right: calc(var(--_xr) * (1 - var(--_p)) + var(--_rail) * var(--_p));
        top: calc(var(--_top) * (1 - var(--_p)) + var(--_dock-top) * var(--_p));
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        pointer-events: auto;
      }
      .acc-main {
        display: flex;
        align-items: center;
        height: var(--_item);
        opacity: clamp(0, calc((0.99 - var(--_p)) * 100), 1);
      }
      /* Admin (red, says so in words) beside the beta chip's lane, directly under the account. */
      .subrow {
        position: absolute;
        top: calc(100% + 6px);
        right: calc(var(--sc-chip-lane, 24px) - 24px + var(--sc-space-2));
        display: flex;
        align-items: center;
        min-height: max(var(--sc-tap-min), 32px);
        white-space: nowrap;
        opacity: clamp(0, calc(1 - var(--_p) * 3), 1);
      }
      .admin {
        padding: 6px 4px;
        font-family: var(--sc-font-display);
        font-size: 12px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        text-decoration: none;
        color: var(--sc-accent-hot);
        text-shadow: var(--mh-shadow);
        border-radius: 8px;
      }
      .admin:hover,
      .admin.active {
        color: color-mix(in srgb, var(--sc-accent-hot) 70%, var(--sc-fg-0));
      }
      .admin.active {
        text-decoration: underline;
        text-underline-offset: 6px;
      }
      .admin:focus-visible {
        outline: 2px solid var(--sc-accent-hot);
        outline-offset: 2px;
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
        color: color-mix(in srgb, var(--sc-fg-0) 72%, transparent);
        text-shadow: var(--mh-shadow);
        border-radius: 8px;
        transition: color 0.2s ease, text-shadow 0.2s ease;
      }
      /* Desktop: Admin lives in the sub row under the account, not in the nav. */
      .slot.adm,
      .ind.elevated {
        display: none;
      }
      .slot:hover {
        color: var(--sc-fg-0);
      }
      .slot.active {
        color: var(--sc-fg-0);
        text-shadow: 0 0 18px color-mix(in srgb, var(--sc-accent) 55%, transparent), var(--mh-shadow);
      }
      .slot.elevated {
        color: var(--sc-accent-hot);
      }
      .slot.elevated:hover,
      .slot.elevated.active {
        color: color-mix(in srgb, var(--sc-accent-hot) 70%, var(--sc-fg-0));
      }
      .brand:focus-visible,
      .slot:focus-visible {
        outline: 2px solid var(--sc-accent);
        outline-offset: 2px;
      }
      .slot.elevated:focus-visible {
        outline-color: var(--sc-accent-hot);
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
      .ind.elevated {
        background: var(--sc-accent-hot);
        box-shadow: 0 0 12px var(--sc-accent-hot);
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      /* Tablet: the wordmark yields to the nav. */
      @media (max-width: 1099px) {
        .wordmark {
          display: none;
        }
      }
      /* Phone: brand + account on top (the beta chip keeps the corner: its lane stays free),
         the nav as a second row of equal slots incl. Admin. The bar is at the thumb, so
         nothing glides: the header just fades out as a whole. */
      @media (max-width: 720px) {
        :host {
          padding-inline: var(--_x) max(var(--_xr), var(--sc-chip-lane, 0px));
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
          --mh-slot: calc((100vw - var(--_x) - max(var(--_xr), var(--sc-chip-lane, 0px))) / var(--mh-slots, 4));
          transform: none;
        }
        .slot.adm {
          display: flex;
        }
        .ind.elevated {
          display: block;
        }
        .slot {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-indent: 0.14em;
          min-height: var(--sc-tap-min, 44px);
          box-sizing: border-box;
        }
        .logo,
        .acc-main {
          opacity: clamp(0, calc(1 - var(--_p) * 3), 1);
        }
        .subrow {
          display: none;
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
          margin-inline-end: calc(var(--_x) - max(var(--_xr), var(--sc-chip-lane, 0px)));
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
        .slot.elevated.active::after {
          background: var(--sc-accent-hot);
          box-shadow: 0 0 12px var(--sc-accent-hot);
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
  /** Condensed into the bar (progress 1, or not a main page at all): inert and invisible. */
  readonly compressed = computed(() => this.chrome.stageSearch() === 'none' || this.chrome.dockFull());
  /** A silent state jump (route change / scroll reset): transitions off for it. */
  readonly snap = this.chrome.snap;
  private readonly router = inject(Router);
  private readonly roles = inject(RoleService);
  private readonly beta = inject(BetaService);
  private readonly sameRoute = inject(SameRouteRefreshService);

  private readonly url = signal(this.router.url);

  /** Same gating as the Fusion bar's area menu. */
  readonly areas = computed(() =>
    AREA_ENTRIES.filter((a) => {
      if (a.id === 'hq') return this.beta.state().codex;
      if (a.id === 'starscape') return !this.beta.state().verse;
      if (a.elevated) return this.roles.isAdmin();
      return true;
    }),
  );
  /** The elevated entry (Admin), shown in the sub row under the account; null for everyone else. */
  readonly admin = computed(() => this.areas().find((a) => a.elevated) ?? null);
  readonly activeArea = computed(() => activeAreaOf(this.url(), !this.beta.state().verse));
  readonly activeIndex = computed(() => this.areas().findIndex((a) => a.id === this.activeArea()));
  readonly activeElevated = computed(() => this.areas()[this.activeIndex()]?.elevated ?? false);

  /** The hub's first-visit intro holds the header back until its 4.85 s mark. */
  readonly introWait = computed(() => this.chrome.heroIntro()?.full === true);
  readonly introK = computed(() => this.chrome.heroIntro()?.k ?? 1);

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
    // The pinned header is out of flow: publish its height for the shell's spacer.
    afterNextRender(() => {
      if (typeof document === 'undefined') return;
      const publish = () =>
        document.documentElement.style.setProperty('--sc-mainhead-h', `${Math.round(host.offsetHeight)}px`);
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
