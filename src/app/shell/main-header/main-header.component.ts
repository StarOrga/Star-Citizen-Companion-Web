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
 * `<sc-main-header>` — the cinematic main header of the beta shell (concept
 * 2026-10-28 header/subheader, round 8): brand, main nav and the account
 * button standing directly on the scene. No capsule, no frame, no surface —
 * a soft text shadow and a top scrim carry legibility.
 *
 * Shown by the shell on the main pages only (`isMainHeaderPage`: Verse, Codex,
 * HQ, the admin hub) and identical on all of them: the row is the page frame
 * (`--sc-page-max`) and every nav slot is {@link MAIN_NAV_SLOT_PX} wide, so a
 * menu switch only moves the active indicator. It is pinned (`position: fixed`)
 * and the page scrolls under it; once the page passes the dock threshold the
 * staged search docks as the subheader and this header compresses into it
 * WHILE VISIBLE (`compressed`, timings from the concept's r8 morph keyframes):
 * the logo glides onto the bar's logo slot (FusionBarComponent plays that), the
 * wordmark condenses, the nav scales on X and blurs away, the avatar slides and
 * fades — all reversed on the way back up.
 *
 * The shell keeps it mounted for the whole beta shell: on every non-main page
 * it stays compressed (inert, invisible), so main ↔ subpage plays the same
 * compress / expand instead of an unmount. A route change or a programmatic
 * scroll reset jumps without transitions (`snap`, set by the bar).
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
    '[attr.inert]': "compressed() ? '' : null",
  },
  template: `
    <div class="row">
      <a class="brand" routerLink="/verse" [attr.aria-label]="'nav.brandAria' | translate"
         (click)="onNav($event, '/verse')">
        <img class="logo" src="icons/brand/scc-mark.svg" alt="" width="34" height="34" />
        <span class="wordmark">
          <span class="title">Star Citizen Companion</span>
          <span class="alpha">{{ 'nav.phaseBadge' | translate }}</span>
        </span>
      </a>

      <nav class="nav" [attr.aria-label]="'fusionBar.navAria' | translate"
           [style.--mh-slots]="areas().length">
        @for (a of areas(); track a.id) {
          <a class="slot" [routerLink]="a.link" [class.active]="activeArea() === a.id" [class.elevated]="a.elevated"
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

      <!-- Compressed into the bar: the bar carries its own account menu; this one is inert. -->
      <div class="account" [attr.inert]="compressed() ? '' : null"><ng-content select="[mhAccount]" /></div>
    </div>
  `,
  styles: [
    `
      :host {
        --mh-slot: ${MAIN_NAV_SLOT_PX}px;
        --mh-shadow: 0 1px 14px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.8);
        --mh-ease: cubic-bezier(0.55, 0, 0.2, 1);
        /* Pinned: the page scrolls under the header (concept r6–r8). */
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 25;
        display: block;
        padding-top: calc(var(--sc-imp-banner-h, 0px) + var(--sc-space-4));
        pointer-events: none;
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
      }
      .row {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        width: var(--sc-chrome-w);
        box-sizing: border-box;
        min-height: 56px;
        margin: 0 auto;
      }
      /* Compressed into the docked subheader: everything but the gliding logo
         fades/condenses. Timings are the concept's r8 morph keyframes (10 s loop):
         expanding back (82 → 96 %) on the base state, compressing (22 → 36 %) on
         .compressed — each property's own window as delay + duration. */
      :host::before {
        transition: opacity 1s ease-in-out 0.2s;
      }
      .wordmark {
        transition: opacity 1s ease-in-out 0.4s, transform 1s ease-in-out 0.4s;
      }
      .nav,
      .account {
        transition: opacity 1.2s var(--mh-ease) 0.2s, transform 1.2s var(--mh-ease) 0.2s, filter 1.2s var(--mh-ease) 0.2s;
      }
      :host(.compressed)::before {
        opacity: 0;
        transition: opacity 1.2s ease-in-out;
      }
      :host(.compressed) .wordmark {
        transition: opacity 0.8s ease-in-out, transform 0.8s ease-in-out;
      }
      :host(.compressed) .nav {
        transition: opacity 1.2s var(--mh-ease), transform 1.2s var(--mh-ease), filter 1.2s var(--mh-ease);
      }
      :host(.compressed) .account {
        transition: opacity 1.4s var(--mh-ease), transform 1.4s var(--mh-ease);
      }
      /* A silent jump (route change, scroll reset): no transition at all. */
      :host(.snap)::before,
      :host(.snap) * {
        transition: none !important;
      }
      :host(.compressed) .wordmark {
        opacity: 0;
        transform: translateX(-10px) scaleX(0.6);
        transform-origin: left center;
      }
      :host(.compressed) .nav {
        opacity: 0;
        transform: translateY(-14px) scaleX(0.25) scaleY(0.6);
        filter: blur(2px);
      }
      :host(.compressed) .account {
        opacity: 0;
        transform: translate(-24px, -14px) scale(0.55);
      }
      :host(.compressed) .logo {
        opacity: 0;
      }
      :host(.compressed) .row > * {
        pointer-events: none;
      }
      /* Phone: the β chip keeps the top-right corner; the row leaves it free. */
      @media (max-width: 720px) {
        .row {
          width: 100%;
          padding-inline: var(--sc-page-gutter) max(var(--sc-page-gutter), var(--sc-chip-lane, 0px));
        }
      }
      @media (prefers-reduced-motion: reduce) {
        :host::before,
        :host(.compressed)::before,
        .wordmark,
        .nav,
        .account,
        :host(.compressed) .wordmark,
        :host(.compressed) .nav,
        :host(.compressed) .account {
          transition: none;
        }
      }
      .row > * {
        pointer-events: auto;
      }
      .brand {
        justify-self: start;
        display: flex;
        align-items: center;
        gap: var(--sc-space-3);
        color: var(--sc-fg-0);
        text-decoration: none;
        text-shadow: 0 2px 14px rgba(0, 0, 0, 0.85);
        border-radius: 8px;
      }
      .logo {
        flex: none;
        width: 34px;
        height: 34px;
        filter: drop-shadow(0 0 8px color-mix(in srgb, var(--sc-accent) 55%, transparent));
      }
      .wordmark {
        display: grid;
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
        justify-self: center;
        display: flex;
      }
      .slot {
        display: block;
        width: var(--mh-slot);
        padding: 12px 0;
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
      .account {
        justify-self: end;
        display: flex;
        align-items: center;
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
      /* Phone: brand + account on top, the nav as a second row of equal slots. */
      @media (max-width: 720px) {
        .row {
          grid-template-columns: 1fr auto;
          row-gap: var(--sc-space-1);
        }
        .nav {
          grid-column: 1 / -1;
          grid-row: 2;
          justify-self: stretch;
          --mh-slot: calc((100vw - 2 * var(--sc-page-gutter)) / var(--mh-slots, 4));
        }
        .slot {
          font-size: 12px;
          letter-spacing: 0.14em;
          min-height: var(--sc-tap-min, 44px);
          box-sizing: border-box;
        }
      }
      @media (prefers-reduced-motion: reduce) {
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
  /** Compressed into the bar: the staged search docked, or not a main page at all. */
  readonly compressed = computed(() => this.chrome.stageSearch() !== 'stage');
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
  readonly activeArea = computed(() => activeAreaOf(this.url(), !this.beta.state().verse));
  readonly activeIndex = computed(() => this.areas().findIndex((a) => a.id === this.activeArea()));
  readonly activeElevated = computed(() => this.areas()[this.activeIndex()]?.elevated ?? false);

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof NavigationEnd) this.url.set(e.urlAfterRedirects);
    });
    // The pinned header is out of flow: publish its height for the shell's spacer.
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof document === 'undefined') return;
      const publish = () =>
        document.documentElement.style.setProperty('--sc-mainhead-h', `${Math.round(host.offsetHeight)}px`);
      publish();
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
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
