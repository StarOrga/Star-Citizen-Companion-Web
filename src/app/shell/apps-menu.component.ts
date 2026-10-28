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
import { ringsForRole } from '../desktop/desktop-access';
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
            <a class="entry" [href]="sccUrl" rel="noopener noreferrer" download (click)="onPick($event)">
              <span class="ico" aria-hidden="true">
                <img src="icons/brand/scc-mark.svg" alt="" width="22" height="22" />
              </span>
              <span class="txt">
                <strong>{{ 'appsMenu.scc.name' | translate }}</strong>
                <span class="desc">{{ 'appsMenu.scc.desc' | translate }}</span>
                <span class="meta">{{ 'appsMenu.platform' | translate }}</span>
              </span>
            </a>
            <a class="entry" [href]="starscapeHref()" rel="noopener noreferrer" download (click)="onPick($event)">
              <span class="ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></svg>
              </span>
              <span class="txt">
                <strong>{{ 'appsMenu.starscape.name' | translate }}</strong>
                <span class="desc">{{ 'appsMenu.starscape.desc' | translate }}</span>
                <span class="meta">{{ starscapeMeta() }}</span>
              </span>
            </a>
            @if (roles.isCollaborator()) {
              @if (uploaderHref(); as href) {
                <a class="entry elevated" [href]="href" rel="noopener noreferrer" download (click)="onPick($event)">
                  <ng-container *ngTemplateOutlet="uploaderBody" />
                </a>
              } @else {
                <a class="entry elevated" routerLink="/uploader" (click)="onPick($event)">
                  <ng-container *ngTemplateOutlet="uploaderBody" />
                </a>
              }
            }
          </div>
        }
      </div>
    }
    <ng-template #uploaderBody>
      <span class="ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
      </span>
      <span class="txt">
        <strong>{{ 'appsMenu.uploader.name' | translate }}<em>{{ 'appsMenu.uploader.tag' | translate }}</em></strong>
        <span class="desc">{{ 'appsMenu.uploader.desc' | translate }}</span>
        <span class="meta">{{ uploaderMeta() }}</span>
      </span>
    </ng-template>
  `,
  styles: [`
    :host { display: inline-flex; }
    .apps { position: relative; }
    .trigger {
      display: inline-flex; align-items: center; gap: 7px; height: 40px; padding: 0 12px;
      border-radius: 20px; border: 1px solid var(--sc-border); background: var(--sc-bg-1);
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
    @media (max-width: 720px) { .label { display: none; } .trigger { padding: 0 11px; } }
    @media (pointer: coarse) { .trigger { min-height: 48px; } .entry { min-height: 48px; } }
  `],
})
export class AppsMenuComponent {
  readonly roles = inject(RoleService);
  private readonly device = inject(DesktopCapabilityService);
  private readonly releases = inject(DesktopReleaseService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly sccUrl = SCC_INSTALLER_URL;
  readonly panelId = `apps-menu-${++uid}`;
  readonly open = signal(false);
  private readonly starscape = signal<RingRelease | null>(null);
  private readonly uploader = signal<RingRelease | null>(null);
  private loaded = false;

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  readonly offered = computed(() => this.device.canInstall());

  readonly starscapeHref = computed(() => this.starscape()?.url ?? STARSCAPE_FALLBACK_URL);
  readonly uploaderHref = computed(() => this.uploader()?.url ?? null);
  readonly starscapeMeta = computed(() => this.metaOf(this.starscape()));
  readonly uploaderMeta = computed(() => this.metaOf(this.uploader()));

  private metaOf(r: RingRelease | null): string {
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
    const wantsUploader = this.roles.isCollaborator() && ringsForRole('uploader', this.roles.role()).length > 0;
    const [s, u] = await Promise.all([
      this.releases.ringsFor('starscape', ['stable']),
      wantsUploader ? this.releases.ringsFor('uploader', ['stable']) : Promise.resolve({ releases: [] as RingRelease[] }),
    ]);
    this.starscape.set(s.releases[0] ?? null);
    this.uploader.set(u.releases[0] ?? null);
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
