import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  TemplateRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import {
  DesktopProduct,
  ReleaseRing,
  daysSinceSeen,
  isAdminOnlyRing,
  isRestrictedProduct,
  ringsForRole,
} from './desktop-access';
import { DesktopConnectionService } from './desktop-connection.service';
import { DesktopReleaseService, RingRelease } from './desktop-release.service';

/** Per-product chrome — one place, so both mounts are visually identical. */
const CHROME: Record<DesktopProduct, { icon: string; title: string; desc: string; note: string }> = {
  uploader: {
    icon: '⬆',
    title: 'desktop.appTitle',
    desc: 'desktop.appDesc',
    note: 'desktop.access.note',
  },
  starscape: {
    icon: '🖥',
    title: 'starscape.appTitle',
    desc: 'starscape.appDesc',
    note: 'starscape.appNote',
  },
};

let nextId = 0;

/**
 * The desktop-app download control (admin feedback 924bf1d8) — ONE component,
 * mounted twice, so the Data Uploader and Starscape are recognisably the same
 * thing in two places:
 *
 *   · Codex landing, far right of the Archive-Terminal row → `uploader`
 *     (collaborator+ only; a viewer never sees it and the Verse-online pill
 *     simply becomes the row's last element).
 *   · Starscape header, top right → `starscape` (everyone; the ring list is
 *     what narrows by role).
 *
 * A resting trigger, an OVERLAPPING popover (absolute, never pushes layout),
 * one anchor per release ring, and the account's desktop-connection state. It
 * collapses itself the moment a download is started, on Esc, and on any click
 * outside — Esc and the download return focus to the trigger.
 *
 * It renders nothing on a device that cannot install a desktop application at
 * all (admin feedback dccdcc82) — see `offered()`.
 *
 * Role gating is a UI mirror, never the gate itself: `ringsForRole` decides what
 * is offered, and the SECURITY DEFINER resolvers behind `ringsFor` clamp every
 * request to the caller's tier server-side, dropping any ring that came back
 * downgraded. Calling the API directly as a viewer therefore yields stable, not
 * alpha.
 */
@Component({
  selector: 'sc-app-download-menu',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (offered()) {
      <!-- .restricted paints the whole control in the hot accent. Red is the
           app's "not for everyone" marker (admin feedback b8b31f24), so it is
           bound to the actual gate instead of being baked into the chrome:
           Starscape is a public download and therefore reads in the normal
           accent, while the collaborator-gated Data Uploader keeps the red box. -->
      <div class="dlm" [class.restricted]="restricted()">
        <button
          #trigger
          type="button"
          class="dlm-trigger"
          [class.on]="open()"
          (click)="toggle()"
          [attr.aria-expanded]="open()"
          aria-haspopup="dialog"
          [attr.aria-controls]="panelId"
          [attr.aria-label]="'appMenu.trigger' | translate: { app: chrome().title | translate }">
          <span class="dlm-icon" aria-hidden="true">{{ chrome().icon }}</span>
          <span class="dlm-name">{{ chrome().title | translate }}</span>
          <span class="dlm-arrow" aria-hidden="true">↓</span>
          @if (showConnection()) {
            <span class="dlm-dot" [class]="connectionState()" aria-hidden="true"></span>
          }
          <span class="dlm-chev" [class.on]="open()" aria-hidden="true">▾</span>
        </button>

        @if (open()) {
          <div
            #pop
            class="dlm-pop"
            [id]="panelId"
            role="dialog"
            aria-modal="false"
            tabindex="-1"
            [attr.aria-label]="chrome().title | translate">
            <div class="pop-head">
              <span class="pop-icon" aria-hidden="true">{{ chrome().icon }}</span>
              <span class="pop-id">
                <strong class="pop-title">{{ chrome().title | translate }}</strong>
                <span class="pop-desc">{{ chrome().desc | translate }}</span>
              </span>
              <button
                type="button"
                class="pop-x"
                (click)="close()"
                [attr.aria-label]="'desktop.close' | translate">✕</button>
            </div>

            @if (showConnection()) {
              <p class="pop-conn" [class]="connectionState()">
                <span class="conn-dot" aria-hidden="true"></span>
                <span class="conn-text">
                  {{ 'appMenu.conn.' + connectionState() | translate }}
                  @if (seenDays(); as d) {
                    <span class="conn-when">{{ 'appMenu.conn.since' | translate: { days: d } }}</span>
                  } @else if (connectionState() !== 'never') {
                    <span class="conn-when">{{ 'appMenu.conn.today' | translate }}</span>
                  }
                </span>
              </p>
            }

            <span class="pop-label">{{ 'appMenu.versions' | translate }}</span>

            @if (releases().length > 0) {
              <div class="pop-list">
                @for (r of releases(); track r.ring) {
                  <!-- Per-entry accent: a ring nobody below admin is ever
                       offered is red, every other ring stays in the normal
                       accent — even inside a red (restricted) box. The colour
                       never carries the meaning alone; the admin-only ring also
                       says so in words. -->
                  <a
                    class="pop-dl"
                    [class.secondary]="r.ring !== 'stable'"
                    [class.admin-only]="adminOnlyRing(r.ring)"
                    [href]="r.url"
                    [title]="tooltip(r)"
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    (click)="onDownload()">
                    <span class="dl-arrow" aria-hidden="true">↓</span>
                    <span class="dl-ring">{{ 'desktop.channel.' + r.ring | translate }}</span>
                    <span class="dl-ver">v{{ r.version }}</span>
                    @if (r.ring === 'stable') {
                      <span class="dl-tag">{{ 'appMenu.recommended' | translate }}</span>
                    } @else if (adminOnlyRing(r.ring)) {
                      <span class="dl-tag">{{ 'appMenu.adminOnly' | translate }}</span>
                    }
                  </a>
                }
              </div>
            } @else if (busy()) {
              <p class="pop-state">{{ 'desktop.loading' | translate }}</p>
            } @else if (fallbackUrl(); as url) {
              <!-- No ring pointer resolved, but the host knows a never-stale
                   alias asset. A working download beats an error banner. -->
              <div class="pop-list">
                <a
                  class="pop-dl"
                  [href]="url"
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  (click)="onDownload()">
                  <span class="dl-arrow" aria-hidden="true">↓</span>
                  <span class="dl-ring">{{ 'appMenu.fallback' | translate }}</span>
                </a>
              </div>
            } @else if (errorMsg(); as e) {
              <p class="pop-state err">{{ e }}</p>
            } @else {
              <p class="pop-state">{{ 'desktop.noRelease' | translate }}</p>
            }

            @if (extra(); as tpl) {
              <div class="pop-extra">
                <ng-container [ngTemplateOutlet]="tpl" />
              </div>
            }

            @for (n of notes(); track n) {
              <p class="pop-note">{{ n | translate }}</p>
            }

            @if (product() === 'uploader') {
              <a class="pop-link" routerLink="/uploader" (click)="close(false)">
                {{ 'desktop.access.fullPage' | translate }}
              </a>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; position: relative; }
    /* Colour semantics (admin feedback b8b31f24): the hot accent means "you are
       seeing this because of elevated access". The whole control paints from
       ONE variable so the meaning cannot drift between the trigger, the overlay
       and the entries — the box sets it, and an admin-only entry overrides it
       for itself. Everything public reads in the normal accent. */
    .dlm { position: relative; --dlm-accent: var(--sc-accent); }
    .dlm.restricted { --dlm-accent: var(--sc-accent-hot, #ff9f43); }

    .dlm-trigger {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 12px; border-radius: 3px;
      min-height: var(--sc-tap-min, 44px);
      font: inherit; cursor: pointer;
      color: var(--sc-fg-1); background: var(--sc-bg-1);
      border: 1px solid color-mix(in srgb, var(--dlm-accent) 40%, var(--sc-border));
      transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
    }
    .dlm-trigger:hover, .dlm-trigger:focus-visible, .dlm-trigger.on {
      outline: none;
      color: var(--sc-fg-0);
      border-color: var(--dlm-accent);
      background: color-mix(in srgb, var(--dlm-accent) 10%, var(--sc-bg-1));
    }
    .dlm-icon { font-size: 0.9rem; line-height: 1; }
    .dlm-name {
      font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor, 0.68rem));
      letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap;
    }
    .dlm-arrow { color: var(--dlm-accent); font-size: 0.8rem; }
    .dlm-chev { font-size: 0.7rem; color: var(--sc-fg-2); transition: transform 0.16s ease; }
    .dlm-chev.on { transform: rotate(180deg); }
    .dlm-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--sc-fg-2); flex: none; }
    .dlm-dot.connected {
      background: var(--sc-success, #5fd698);
      box-shadow: 0 0 7px var(--sc-success, #5fd698);
    }
    .dlm-dot.expired { background: var(--sc-warning, #ffc14d); }

    /* The overlay: overlaps whatever is below, never reflows the row. */
    .dlm-pop {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 80;
      width: min(320px, calc(100vw - 32px));
      display: flex; flex-direction: column; gap: 10px;
      padding: 12px 14px; border-radius: 10px;
      background: var(--sc-bg-1);
      border: 1px solid color-mix(in srgb, var(--dlm-accent) 45%, var(--sc-border));
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
      animation: dlm-in 0.14s ease-out both;
    }
    .dlm-pop:focus { outline: none; }
    @keyframes dlm-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: none; }
    }

    .pop-head { display: flex; align-items: flex-start; gap: 10px; }
    .pop-icon { font-size: 1rem; line-height: 1.2; }
    .pop-id { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
    .pop-title { font-family: var(--sc-font-display); font-size: 0.86rem; color: var(--sc-fg-0); }
    .pop-desc { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); line-height: 1.35; }
    .pop-x {
      background: transparent; border: 0; padding: 4px; cursor: pointer;
      color: var(--sc-fg-2); font-size: 0.85rem; line-height: 1;
    }
    .pop-x:hover { color: var(--sc-fg-0); }

    .pop-conn {
      display: flex; align-items: flex-start; gap: 8px; margin: 0;
      padding: 7px 9px; border-radius: 6px;
      font-size: max(0.72rem, var(--sc-fs-floor)); line-height: 1.35;
      background: color-mix(in srgb, var(--sc-fg-2) 10%, transparent);
      color: var(--sc-fg-1);
    }
    .pop-conn .conn-dot {
      width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex: none;
      background: var(--sc-fg-2);
    }
    .pop-conn.connected { background: color-mix(in srgb, var(--sc-success, #5fd698) 12%, transparent); }
    .pop-conn.connected .conn-dot { background: var(--sc-success, #5fd698); }
    .pop-conn.expired { background: color-mix(in srgb, var(--sc-warning, #ffc14d) 12%, transparent); }
    .pop-conn.expired .conn-dot { background: var(--sc-warning, #ffc14d); }
    .conn-when { color: var(--sc-fg-2); }

    .pop-label {
      font-family: var(--sc-font-display); font-size: max(0.66rem, var(--sc-fs-floor));
      letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-2);
    }

    .pop-list { display: flex; flex-direction: column; gap: 6px; }
    .pop-dl {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: 6px; min-height: 40px;
      text-decoration: none; font-size: max(0.78rem, var(--sc-fs-floor));
      color: var(--sc-bg-0); background: var(--dlm-accent);
      border: 1px solid var(--dlm-accent);
      transition: filter 0.16s ease;
    }
    .pop-dl:hover, .pop-dl:focus-visible { filter: brightness(1.1); outline: none; }
    .pop-dl.secondary {
      color: var(--sc-fg-1); background: transparent;
      border-color: color-mix(in srgb, var(--dlm-accent) 40%, var(--sc-border));
    }
    .pop-dl.secondary:hover, .pop-dl.secondary:focus-visible {
      color: var(--sc-fg-0); border-color: var(--dlm-accent);
      background: color-mix(in srgb, var(--dlm-accent) 10%, transparent);
    }
    /* The one sub-entry that is genuinely admin-only re-declares the variable
       for itself, so it reads red inside an otherwise normal-accent box. */
    .pop-dl.admin-only { --dlm-accent: var(--sc-accent-hot, #ff9f43); }
    .dl-ring { font-family: var(--sc-font-display); letter-spacing: 0.05em; flex: 1 1 auto; }
    .dl-ver { font-variant-numeric: tabular-nums; opacity: 0.85; }
    .dl-tag {
      font-size: max(0.62rem, var(--sc-fs-floor)); text-transform: uppercase;
      letter-spacing: 0.08em; opacity: 0.8;
    }

    /* Host slot for caller-supplied context (the Codex landing puts its patch /
       archive provenance here — the data this very tool produces). */
    .pop-extra {
      display: flex; flex-direction: column; gap: 3px;
      padding-top: 9px; border-top: 1px solid var(--sc-border);
      font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); line-height: 1.4;
    }

    .pop-state { margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .pop-state.err { color: var(--sc-danger); }
    .pop-note {
      margin: 0; font-size: max(0.66rem, var(--sc-fs-floor));
      color: var(--sc-fg-2); line-height: 1.4; opacity: 0.85;
    }
    .pop-link {
      font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-accent);
      text-decoration: underline; text-underline-offset: 2px;
    }
    .pop-link:hover { color: var(--dlm-accent); }

    /* Coarse pointers: 48px for every hit target — a 44px box measures short
       under overlapping scale animations (see the mobile gate baseline). */
    @media (pointer: coarse) {
      .dlm-trigger, .pop-dl { min-height: 48px; }
      .pop-x { min-width: 48px; min-height: 48px; }
    }
    /* Narrow viewports: pin the overlay inside the viewport instead of letting
       a right-aligned 320px box hang off the edge. */
    @media (max-width: 420px) {
      .dlm-pop { right: auto; left: 0; width: min(320px, calc(100vw - 24px)); }
      .dlm-name { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .dlm-pop { animation: none; }
      .dlm-chev { transition: none; }
    }
  `],
})
export class AppDownloadMenuComponent {
  private readonly roles = inject(RoleService);
  private readonly auth = inject(AuthService);
  private readonly releaseSvc = inject(DesktopReleaseService);
  private readonly conn = inject(DesktopConnectionService);
  private readonly device = inject(DesktopCapabilityService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly product = input.required<DesktopProduct>();
  /**
   * Optional block rendered at the bottom of the overlay, for context only the
   * host knows — the Codex landing passes the patch / archive provenance it used
   * to show in the retired "what changed?" disclosure. A TemplateRef rather than
   * `<ng-content>` on purpose: the overlay lives inside an `@if`, and projected
   * content in a conditional view is created eagerly and survives toggling only
   * by accident. This renders exactly when the overlay does.
   */
  readonly extra = input<TemplateRef<unknown> | null>(null);
  /**
   * Never-stale alias asset, offered only when NO ring pointer resolved. The
   * Starscape header passes its `wallpaper-app-latest` release URL, which is
   * what the retired panel fell back to — losing that would have turned an
   * unregistered (or briefly failing) resolver into "no download at all".
   * Role-gated all the same: the menu renders nothing when `rings()` is empty,
   * so this never reaches somebody who may not download the product.
   */
  readonly fallbackUrl = input<string | null>(null);

  /** Stable per-instance id — two menus can live on one page. */
  readonly panelId = `dlm-panel-${nextId++}`;

  readonly open = signal(false);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly releases = signal<readonly RingRelease[]>([]);
  /** Re-read on every open so the "x days ago" copy is never stale. */
  private readonly now = signal(Date.now());

  private readonly triggerEl = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly popEl = viewChild<ElementRef<HTMLElement>>('pop');

  readonly chrome = computed(() => CHROME[this.product()]);
  /**
   * Footnotes under the ring list. Starscape adds its auto-update note and, as
   * soon as more than one ring is on offer, the ring-lock warning — the app
   * derives its ring from the downloaded filename and cannot switch in-app.
   */
  readonly notes = computed<readonly string[]>(() => {
    if (this.product() !== 'starscape') return [this.chrome().note];
    const notes = [this.chrome().note, 'starscape.appAutoUpdate'];
    if (this.rings().length > 1) notes.push('starscape.appRingLock');
    return notes;
  });
  /** Rings this visitor may take — empty means the control is not rendered. */
  readonly rings = computed(() => ringsForRole(this.product(), this.roles.role()));
  /**
   * Is this control rendered at all?
   *
   * Two independent reasons not to render it, and both remove it completely:
   *   · the role may take no ring of this product, and
   *   · the device cannot install a desktop application (feedback dccdcc82).
   *
   * The second one is deliberately a full removal rather than an explanatory
   * line: this menu is a header chip whose ONLY purpose is to start a download.
   * There is nothing left of it once the download is off the table, and the
   * admin's complaint was precisely about seeing it on a phone. The information
   * itself is not lost — `/download`, `/uploader` and the Codex Bridge line all
   * render `sc-app-download-panel`, which explains the platform requirement
   * instead of hiding, so every deep link still lands somewhere meaningful.
   */
  readonly offered = computed(() => this.rings().length > 0 && this.device.canInstall());
  /**
   * Does the hot ("restricted") accent apply to this control? A product every
   * visitor may download is never painted red — that is the whole point of the
   * colour. Deliberately a property of the PRODUCT, not of the current role: a
   * collaborator-gated tool stays recognisably red for the people who can open
   * it, rather than changing colour per viewer.
   */
  readonly restricted = computed(() => isRestrictedProduct(this.product()));
  /** Connection state is an account fact — nothing to say to an anonymous visitor. */
  readonly showConnection = computed(() => !!this.auth.user());
  readonly connectionState = computed(() => this.conn.stateFor(this.product(), this.now()));
  /** Whole days since the last check-in, or null for "today" / never. */
  readonly seenDays = computed(() => {
    const days = daysSinceSeen(this.conn.for(this.product())?.lastSeenAt ?? null, this.now());
    return days != null && days > 0 ? days : null;
  });

  constructor() {
    // Move focus into the popover when it appears, so Esc and Tab act on it.
    effect(() => {
      const pop = this.popEl();
      if (this.open() && pop) pop.nativeElement.focus();
    });
  }

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.now.set(Date.now());
    this.open.set(true);
    void this.loadOnce();
  }

  /**
   * @param returnFocus put focus back on the trigger — right for Esc and for a
   * started download, wrong for an outside click (the user is already elsewhere).
   */
  close(returnFocus = true): void {
    if (!this.open()) return;
    this.open.set(false);
    if (returnFocus) this.triggerEl()?.nativeElement.focus();
  }

  /**
   * The admin's explicit rule: once a download is under way, collapse. The
   * anchor itself is untouched (no preventDefault), so middle-click and "open
   * in new tab" keep working and simply leave the menu closed behind them.
   */
  onDownload(): void {
    this.close();
  }

  /**
   * Is this ring offered to admins only? Drives both the red accent and the
   * "Admin only" tag on the entry, so the colour is never the only carrier of
   * the meaning (admin feedback b8b31f24).
   */
  adminOnlyRing(ring: ReleaseRing): boolean {
    return isAdminOnlyRing(this.product(), ring);
  }

  /** Technical detail belongs in the tooltip, not on the button. */
  tooltip(r: RingRelease): string {
    const parts = [`v${r.version}`];
    if (r.sizeBytes) parts.push(`${(r.sizeBytes / 1_048_576).toFixed(1)} MB`);
    if (r.hash) parts.push(r.hash);
    return parts.join(' · ');
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  @HostListener('document:pointerdown', ['$event'])
  onOutside(ev: Event): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(ev.target as Node)) this.close(false);
  }

  /** Fetch on first open only — a resting trigger must cost the page nothing. */
  private async loadOnce(): Promise<void> {
    void this.conn.refresh();
    if (this.busy() || this.releases().length > 0) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    const { releases, error } = await this.releaseSvc.ringsFor(this.product(), this.rings());
    this.releases.set(releases);
    this.errorMsg.set(error);
    this.busy.set(false);
  }
}
