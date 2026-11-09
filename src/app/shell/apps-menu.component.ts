import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { HeaderPopoutService } from './header-popout.service';
import { environment } from '../../environments/environment';
import { RoleService } from '../auth/role.service';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { logWarn } from '../core/log';
import { isPlainLeftClick } from '../core/modified-click.util';
import { DesktopProduct, ringsForRole } from '../desktop/desktop-access';
import { DesktopReleaseService, RingRelease } from '../desktop/desktop-release.service';
import { SCC_INSTALLER_URL } from '../news/verse-status-chip.component';

/** Edge proxy for the scc-app-latest alias release: {version, sizeBytes}, nulls when unknown. */
const SCC_RELEASE_META = `${environment.supabase.url}/functions/v1/scc-release-meta`;

const STARSCAPE_FALLBACK_URL =
  'https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/wallpaper-app-latest/starscape-wallpaper.exe';

/** "12.3 MB" - app-sized download, one decimal. */
export function formatAppSize(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

let uid = 0;

/** One row of the Apps menu: what the user may download of one app. */
export interface AppEntry {
  id: 'scc' | 'starscape' | 'uploader';
  nameKey: string;
  descKey: string;
  /** Collaborator-gated app: head painted in the hot accent (no badge, the colour is the signal). */
  elevated: boolean;
  /** The stable download, or null when no release resolved (uploader -> its page). */
  href: string | null;
  meta: string;
}

/**
 * `<sc-apps-menu>` - the "Apps" menu next to the avatar (main header and docked
 * subheader). Lists the public desktop apps (SCC App, Starscape) and, for
 * collaborators and admins, the Data Uploader in the hot accent, labelled in words.
 * Each entry is a real anchor to the download; version and size are read lazily
 * from the release resolvers on first open. Renders nothing on a device that
 * cannot install a desktop app (same rule as the download menu).
 */
@Component({
  selector: 'sc-apps-menu',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (offered()) {
      <div class="apps">
        <button #trigger type="button" class="trigger" [class.on]="open()" (click)="toggle($event)"
                aria-haspopup="true" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? panelId : null"
                [attr.aria-label]="'appsMenu.trigger' | translate" [scTooltip]="open() ? null : ('appsMenu.trigger' | translate)" scTooltipTier="label">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="6" cy="6" r="1.8" /><circle cx="12" cy="6" r="1.8" /><circle cx="18" cy="6" r="1.8" />
            <circle cx="6" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18" cy="12" r="1.8" />
            <circle cx="6" cy="18" r="1.8" /><circle cx="12" cy="18" r="1.8" /><circle cx="18" cy="18" r="1.8" />
          </svg>
        </button>
        @if (open()) {
          <div class="pop" [id]="panelId" role="group" [attr.aria-label]="'appsMenu.aria' | translate">
            @for (app of apps(); track app.id) {
              @if (app.href) {
                <a class="entry" [class.elevated]="app.elevated" [href]="app.href" rel="noopener noreferrer" download (click)="onPick($event)">
                  <ng-container *ngTemplateOutlet="appBody; context: { $implicit: app }" />
                </a>
              } @else {
                <a class="entry" [class.elevated]="app.elevated" routerLink="/apps/uploader" (click)="onPick($event)">
                  <ng-container *ngTemplateOutlet="appBody; context: { $implicit: app }" />
                </a>
              }
            }
            <!-- Stable only: beta/alpha are picked inside each app after sign-in. -->
            <p class="hint">{{ 'appsMenu.footer' | translate }}</p>
          </div>
        }
      </div>
    }
    <ng-template #appBody let-app>
      <span class="ico" aria-hidden="true">
        @switch (app.id) {
          @case ('scc') { <img src="icons/brand/scc-mark.svg" alt="" width="22" height="22" /> }
          @case ('starscape') { <img src="icons/brand/starscape-tray.png" alt="" width="28" height="28" /> }
          @default { <img src="icons/brand/uploader-tray.png" alt="" width="28" height="28" /> }
        }
      </span>
      <span class="txt">
        <strong>{{ app.nameKey | translate }}</strong>
        <span class="desc">{{ app.descKey | translate }}</span>
        <span class="meta">{{ app.meta }}</span>
      </span>
    </ng-template>
  `,
  styles: [`
    :host { display: inline-flex; }
    .apps { position: relative; }
    /* The header's one icon-button style (same as the wishlist trigger): square, bordered, icon only. */
    .trigger {
      display: grid; place-items: center; width: var(--sc-head-item-h, 40px); height: var(--sc-head-item-h, 40px); padding: 0;
      border-radius: 8px; border: 1px solid var(--sc-border); background: transparent; color: var(--sc-accent); cursor: pointer;
    }
    .trigger svg { width: 22px; height: 22px; }
    .trigger:hover, .trigger.on { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .trigger.on { box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 18%, transparent); }
    .trigger:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .pop {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
      /* 22rem: the chosen two-line copy per app fits at this width (20rem wrapped it to three). */
      width: min(22rem, calc(100vw - 32px)); display: flex; flex-direction: column; gap: 2px;
      padding: 6px; border-radius: 12px; border: 1px solid var(--sc-border);
      background: var(--sc-bg-1); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
    }
    .entry {
      display: flex; gap: 12px; align-items: flex-start; padding: 10px; border-radius: 8px;
      color: var(--sc-fg-0); text-decoration: none; min-height: 48px;
    }
    .entry:hover, .entry:focus-visible { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); outline: none; }
    .entry:focus-visible { box-shadow: inset 0 0 0 2px var(--sc-accent); }
    .ico {
      flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-accent);
    }
    .ico img { width: 24px; height: 24px; object-fit: contain; }
    .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .txt strong { font-family: var(--sc-font-display); font-size: 0.86rem; font-weight: 600; }
    .desc {
      font-size: 0.76rem; line-height: 1.35; color: var(--sc-fg-2);
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
    }
    .meta { font-size: 0.72rem; color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }
    .entry.elevated { margin-top: 4px; border-top: 1px solid color-mix(in srgb, var(--sc-accent-collab) 40%, transparent); border-radius: 0 0 8px 8px; }
    .entry.elevated .ico { color: var(--sc-accent-collab); background: color-mix(in srgb, var(--sc-accent-collab) 14%, transparent); }
    .entry.elevated strong { color: var(--sc-accent-collab); }
    .entry.elevated:hover, .entry.elevated:focus-visible { background: color-mix(in srgb, var(--sc-accent-collab) 12%, transparent); }
    .entry.elevated:focus-visible { box-shadow: inset 0 0 0 2px var(--sc-accent-collab); }
    .hint {
      margin: 4px 0 0; padding: 8px 10px 4px; border-top: 1px solid var(--sc-border);
      font-size: 0.72rem; line-height: 1.4; color: var(--sc-fg-2);
    }
    /* Phones: the Apps button leaves the header (desktop apps are not installable there). */
    @media (max-width: 749px) { :host { display: none; } }
    @media (pointer: coarse) { .trigger { width: 48px; height: 48px; } .entry { min-height: 48px; } }
  `],
})
export class AppsMenuComponent {
  readonly roles = inject(RoleService);
  private readonly device = inject(DesktopCapabilityService);
  private readonly releases = inject(DesktopReleaseService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly popouts = inject(HeaderPopoutService);

  readonly panelId = `apps-menu-${++uid}`;
  readonly open = signal(false);
  private readonly loadedReleases = signal<Record<DesktopProduct, readonly RingRelease[]>>({
    starscape: [],
    uploader: [],
  });
  private loaded = false;
  /** Version + size of the scc-app-latest alias; null until read (or GitHub unreachable). */
  private readonly sccRelease = signal<{ version: string | null; sizeBytes: number | null } | null>(null);

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  readonly offered = computed(() => this.device.canInstall());

  constructor() {
    // Another header popout took the slot: this one folds away.
    effect(() => {
      if (this.popouts.active() !== 'apps' && untracked(() => this.open())) this.open.set(false);
    });
  }

  /**
   * The apps this role sees, each as ONE stable download. SCC App points at its
   * never-stale stable installer alias; Starscape and the uploader at their
   * stable ring. Beta/alpha are not offered here — each app switches ring itself
   * once the user has signed in (see `DOWNLOAD_RING`).
   */
  readonly apps = computed<AppEntry[]>(() => {
    const role = this.roles.role();
    const rel = this.loadedReleases();
    const list: AppEntry[] = [
      {
        id: 'scc', nameKey: 'appsMenu.scc.name', descKey: 'appsMenu.scc.desc', elevated: false,
        href: SCC_INSTALLER_URL, meta: this.sccMeta(),
      },
    ];
    const build = (product: DesktopProduct, base: Omit<AppEntry, 'href' | 'meta'>, fallback: string | null) => {
      const allowed = ringsForRole(product, role);
      const stable = rel[product].find((r) => allowed.includes(r.ring)) ?? null;
      list.push({ ...base, href: stable?.url ?? fallback, meta: this.metaOf(stable) });
    };
    build('starscape', { id: 'starscape', nameKey: 'appsMenu.starscape.name', descKey: 'appsMenu.starscape.desc', elevated: false }, STARSCAPE_FALLBACK_URL);
    if (this.roles.isCollaborator() && ringsForRole('uploader', role).length > 0) {
      build('uploader', { id: 'uploader', nameKey: 'appsMenu.uploader.name', descKey: 'appsMenu.uploader.desc', elevated: true }, null);
    }
    return list;
  });

  /** "Windows · v0.100.0 · 462.7 MB" from the alias release; bare "Windows" while unknown. */
  private sccMeta(): string {
    const r = this.sccRelease();
    const parts = ['Windows'];
    if (r?.version) parts.push(r.version);
    const size = formatAppSize(r?.sizeBytes);
    if (size) parts.push(size);
    return parts.join(' · ');
  }

  metaOf(r: RingRelease | null): string {
    const parts = ['Windows'];
    if (r) {
      parts.push(`v${r.version}`);
      const size = formatAppSize(r.sizeBytes);
      if (size) parts.push(size);
    }
    return parts.join(' · ');
  }

  toggle(ev: Event): void {
    ev.stopPropagation();
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.popouts.claim('apps');
      void this.load();
    } else {
      this.popouts.release('apps');
    }
  }

  /** Only a plain left click folds the menu away (modified clicks open a new tab). */
  onPick(ev: MouseEvent): void {
    if (isPlainLeftClick(ev)) this.closeMenu();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    void this.loadScc();
    const role = this.roles.role();
    const wantsUploader = this.roles.isCollaborator() && ringsForRole('uploader', role).length > 0;
    const [s, u] = await Promise.all([
      this.releases.ringsFor('starscape', ringsForRole('starscape', role)),
      wantsUploader ? this.releases.ringsFor('uploader', ringsForRole('uploader', role)) : Promise.resolve({ releases: [] as RingRelease[] }),
    ]);
    this.loadedReleases.set({ starscape: s.releases, uploader: u.releases });
  }

  /** Version + size come from the scc-release-meta edge proxy (cached there, no GitHub call from the browser). */
  private async loadScc(): Promise<void> {
    try {
      const res = await fetch(SCC_RELEASE_META, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const j = (await res.json()) as { version?: string | null; sizeBytes?: number | null };
      const version = typeof j.version === 'string' ? j.version : null;
      const sizeBytes = typeof j.sizeBytes === 'number' ? j.sizeBytes : null;
      if (version || sizeBytes) this.sccRelease.set({ version, sizeBytes });
    } catch (err) {
      logWarn('apps-menu', 'scc release meta unavailable', err);
    }
  }

  private closeMenu(): void {
    this.open.set(false);
    this.popouts.release('apps');
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(ev.target as Node)) this.closeMenu();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.open()) return;
    this.closeMenu();
    this.trigger()?.nativeElement.focus();
  }
}
