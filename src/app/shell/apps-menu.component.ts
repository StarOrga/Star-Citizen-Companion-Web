import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { isPlainLeftClick } from '../core/modified-click.util';
import { DesktopProduct, ReleaseRing, isAdminOnlyRing, ringsForRole } from '../desktop/desktop-access';
import { DesktopReleaseService, RingRelease } from '../desktop/desktop-release.service';
import { SCC_INSTALLER_URL } from '../news/verse-status-chip.component';

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
  tagKey: string | null;
  /** Collaborator-gated app: head painted in the hot accent. */
  elevated: boolean;
  /** Channel rows (role-filtered); two or more -> the picker, else a plain download. */
  rows: readonly RingRelease[];
  href: string | null;
  meta: string;
  soloRing: ReleaseRing | null;
  adminOnly: (ring: ReleaseRing) => boolean;
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
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (offered()) {
      <div class="apps">
        <button #trigger type="button" class="trigger" [class.on]="open()" (click)="toggle($event)"
                aria-haspopup="true" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? panelId : null">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="6" cy="6" r="1.8" /><circle cx="12" cy="6" r="1.8" /><circle cx="18" cy="6" r="1.8" />
            <circle cx="6" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18" cy="12" r="1.8" />
            <circle cx="6" cy="18" r="1.8" /><circle cx="12" cy="18" r="1.8" /><circle cx="18" cy="18" r="1.8" />
          </svg>
          <span class="label">{{ 'appsMenu.trigger' | translate }}</span>
        </button>
        @if (open()) {
          <div class="pop" [id]="panelId" role="group" [attr.aria-label]="'appsMenu.aria' | translate">
            @for (app of apps(); track app.id) {
              @if (app.rows.length > 1) {
                <!-- Several channels for this role: head + one real download anchor per channel. -->
                <div class="app" [class.elevated]="app.elevated" role="group" [attr.aria-label]="app.nameKey | translate">
                  <div class="entry head">
                    <ng-container *ngTemplateOutlet="appBody; context: { $implicit: app }" />
                  </div>
                  <div class="rings">
                    @for (r of app.rows; track r.ring) {
                      <a class="ring" [class.admin-only]="app.adminOnly(r.ring)" [href]="r.url" rel="noopener noreferrer" download (click)="onPick($event)">
                        <span class="r-name">{{ 'desktop.channel.' + r.ring | translate }}</span>
                        <span class="r-meta">{{ metaOf(r) }}</span>
                        @if (app.adminOnly(r.ring)) {
                          <span class="r-tag">{{ 'appMenu.adminOnly' | translate }}</span>
                        } @else if (r.ring === 'stable') {
                          <span class="r-tag">{{ 'appMenu.recommended' | translate }}</span>
                        }
                      </a>
                    }
                  </div>
                </div>
              } @else if (app.href) {
                <a class="entry" [class.elevated]="app.elevated" [href]="app.href" rel="noopener noreferrer" download (click)="onPick($event)">
                  <ng-container *ngTemplateOutlet="appBody; context: { $implicit: app }" />
                </a>
              } @else {
                <a class="entry" [class.elevated]="app.elevated" routerLink="/uploader" (click)="onPick($event)">
                  <ng-container *ngTemplateOutlet="appBody; context: { $implicit: app }" />
                </a>
              }
            }
          </div>
        }
      </div>
    }
    <ng-template #appBody let-app>
      <span class="ico" aria-hidden="true">
        @switch (app.id) {
          @case ('scc') { <img src="icons/brand/scc-mark.svg" alt="" width="22" height="22" /> }
          @case ('starscape') {
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></svg>
          }
          @default {
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
          }
        }
      </span>
      <span class="txt">
        <strong>{{ app.nameKey | translate }}@if (app.tagKey) {<em>{{ app.tagKey | translate }}</em>}</strong>
        <span class="desc">{{ app.descKey | translate }}</span>
        @if (app.rows.length > 1) {
          <span class="meta">{{ 'appsMenu.pickChannel' | translate }}</span>
        } @else {
          <span class="meta">
            @if (app.id === 'scc') {
              {{ 'appsMenu.platform' | translate }}
            } @else {
              {{ app.meta }}
              @if (app.soloRing && app.soloRing !== 'stable') {
                · {{ 'desktop.channel.' + app.soloRing | translate }}
              }
            }
          </span>
        }
      </span>
    </ng-template>
  `,
  styles: [`
    :host { display: inline-flex; }
    .apps { position: relative; }
    .trigger {
      display: inline-flex; align-items: center; gap: 7px; height: var(--sc-head-item-h, 40px); padding: 0 12px;
      border-radius: calc(var(--sc-head-item-h, 40px) / 2); border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: var(--sc-fg-1); font-family: var(--sc-font-display); font-size: 12px;
      letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer;
      box-shadow: 0 2px 14px rgba(0, 0, 0, 0.6); transition: border-color 0.18s ease, color 0.18s ease;
    }
    .trigger svg { width: 16px; height: 16px; }
    .trigger:hover, .trigger.on { border-color: var(--sc-accent); color: var(--sc-accent); }
    .trigger:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .pop {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
      width: min(340px, calc(100vw - 24px)); display: flex; flex-direction: column; gap: 2px;
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
    .ico svg { width: 20px; height: 20px; }
    .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .txt strong { font-family: var(--sc-font-display); font-size: 0.86rem; font-weight: 600; }
    .txt em {
      margin-left: 8px; font-style: normal; font-size: 0.66rem; letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .desc { font-size: 0.76rem; line-height: 1.35; color: var(--sc-fg-2); }
    .meta { font-size: 0.72rem; color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }
    .entry.elevated { margin-top: 4px; border-top: 1px solid color-mix(in srgb, var(--sc-accent-hot) 40%, transparent); border-radius: 0 0 8px 8px; }
    .entry.elevated .ico { color: var(--sc-accent-hot); background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent); }
    .entry.elevated strong, .entry.elevated em { color: var(--sc-accent-hot); }
    .entry.elevated:hover, .entry.elevated:focus-visible { background: color-mix(in srgb, var(--sc-accent-hot) 12%, transparent); }
    .entry.elevated:focus-visible { box-shadow: inset 0 0 0 2px var(--sc-accent-hot); }
    .app { display: flex; flex-direction: column; border-radius: 8px; }
    .app.elevated { margin-top: 4px; border-top: 1px solid color-mix(in srgb, var(--sc-accent-hot) 40%, transparent); }
    .entry.head { cursor: default; padding-bottom: 4px; }
    .app.elevated .entry.head { margin-top: 0; border-top: 0; }
    .app.elevated .entry.head:hover { background: none; }
    .entry.head:hover { background: none; }
    .rings { display: flex; flex-direction: column; gap: 2px; padding: 0 6px 6px 58px; }
    .ring {
      display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 6px 10px; border-radius: 6px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, var(--sc-border));
      color: var(--sc-fg-1); text-decoration: none; font-size: 0.78rem;
    }
    .ring:hover, .ring:focus-visible {
      outline: none; color: var(--sc-fg-0); border-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 10%, transparent);
    }
    .ring:focus-visible { box-shadow: inset 0 0 0 2px var(--sc-accent); }
    .r-name { font-family: var(--sc-font-display); letter-spacing: 0.05em; flex: 1 1 auto; }
    .r-meta { font-variant-numeric: tabular-nums; color: var(--sc-fg-2); font-size: 0.72rem; }
    .r-tag { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .ring.admin-only { border-color: color-mix(in srgb, var(--sc-accent-hot) 45%, var(--sc-border)); }
    .ring.admin-only .r-name, .ring.admin-only .r-tag { color: var(--sc-accent-hot); }
    .ring.admin-only:hover, .ring.admin-only:focus-visible {
      border-color: var(--sc-accent-hot); background: color-mix(in srgb, var(--sc-accent-hot) 12%, transparent);
    }
    .ring.admin-only:focus-visible { box-shadow: inset 0 0 0 2px var(--sc-accent-hot); }
    @media (max-width: 720px) { .label { display: none; } .trigger { padding: 0 11px; } }
    @media (pointer: coarse) { .trigger { min-height: 48px; } .entry { min-height: 48px; } .ring { min-height: 48px; } }
  `],
})
export class AppsMenuComponent {
  readonly roles = inject(RoleService);
  private readonly device = inject(DesktopCapabilityService);
  private readonly releases = inject(DesktopReleaseService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly panelId = `apps-menu-${++uid}`;
  readonly open = signal(false);
  private readonly loadedReleases = signal<Record<DesktopProduct, readonly RingRelease[]>>({
    starscape: [],
    uploader: [],
  });
  private loaded = false;

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  readonly offered = computed(() => this.device.canInstall());

  /**
   * The apps this role sees, each with the channels its role may take. SCC App has
   * no release channels (one never-stale installer alias), so it stays a single
   * download. More than one resolved channel -> channel rows; otherwise a plain download.
   */
  readonly apps = computed<AppEntry[]>(() => {
    const role = this.roles.role();
    const rel = this.loadedReleases();
    const list: AppEntry[] = [
      {
        id: 'scc', nameKey: 'appsMenu.scc.name', descKey: 'appsMenu.scc.desc', tagKey: null, elevated: false,
        rows: [], href: SCC_INSTALLER_URL, meta: '', soloRing: null, adminOnly: () => false,
      },
    ];
    const build = (product: DesktopProduct, base: Omit<AppEntry, 'rows' | 'href' | 'meta' | 'soloRing' | 'adminOnly'>, fallback: string | null) => {
      const allowed = ringsForRole(product, role);
      const rows = rel[product].filter((r) => allowed.includes(r.ring));
      const solo = rows.length === 1 ? rows[0] : null;
      list.push({
        ...base,
        rows,
        href: solo?.url ?? fallback,
        meta: this.metaOf(solo),
        soloRing: solo?.ring ?? null,
        adminOnly: (ring: ReleaseRing) => isAdminOnlyRing(product, ring),
      });
    };
    build('starscape', { id: 'starscape', nameKey: 'appsMenu.starscape.name', descKey: 'appsMenu.starscape.desc', tagKey: null, elevated: false }, STARSCAPE_FALLBACK_URL);
    if (this.roles.isCollaborator() && ringsForRole('uploader', role).length > 0) {
      build('uploader', { id: 'uploader', nameKey: 'appsMenu.uploader.name', descKey: 'appsMenu.uploader.desc', tagKey: 'appsMenu.uploader.tag', elevated: true }, null);
    }
    return list;
  });

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
    if (next) void this.load();
  }

  /** Only a plain left click folds the menu away (modified clicks open a new tab). */
  onPick(ev: MouseEvent): void {
    if (isPlainLeftClick(ev)) this.open.set(false);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const role = this.roles.role();
    const wantsUploader = this.roles.isCollaborator() && ringsForRole('uploader', role).length > 0;
    const [s, u] = await Promise.all([
      this.releases.ringsFor('starscape', ringsForRole('starscape', role)),
      wantsUploader ? this.releases.ringsFor('uploader', ringsForRole('uploader', role)) : Promise.resolve({ releases: [] as RingRelease[] }),
    ]);
    this.loadedReleases.set({ starscape: s.releases, uploader: u.releases });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(ev.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.trigger()?.nativeElement.focus();
  }
}
