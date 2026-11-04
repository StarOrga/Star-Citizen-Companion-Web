import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { isPlainLeftClick } from '../core/modified-click.util';
import { SccAppLauncherService } from '../desktop/scc-app-launcher.service';
import { SCC_INSTALLER_URL } from '../news/verse-status-chip.component';

type LaunchStatus = 'idle' | 'starting' | 'started' | 'downloading' | 'noResponse';

const STARTED_HINT_MS = 6000;

/**
 * The one SCC-App action on the HQ pages that only fill once the app reads the game (Jetzt,
 * Statistik): start the app, and download it when it does not answer. A small hint says which of
 * the two is happening. Public, so normal accent. Hidden on a device that cannot install a
 * desktop application (same rule as the status chip's download).
 *
 * A real anchor at the installer: a modified click, the context menu or a failed script all still
 * reach the download. Only the plain left click tries the app first.
 */
@Component({
  selector: 'sc-hq-app-launch',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canInstall()) {
      <a
        class="sc-btn sc-btn-primary go"
        [href]="url"
        rel="noopener noreferrer"
        [attr.aria-busy]="status() === 'starting'"
        (click)="onClick($event)"
      >{{ 'hq.app.launch' | translate }}</a>
      <div class="live" role="status">
        @if (status() !== 'idle') {
          <div class="hint">
            <span class="hint-text">{{ 'hq.app.' + status() | translate }}</span>
            @if (status() === 'downloading') {
              <button type="button" class="sc-btn" (click)="start()">{{ 'hq.app.retry' | translate }}</button>
            } @else if (status() === 'noResponse') {
              <a class="sc-btn" [href]="url" rel="noopener noreferrer">{{ 'hq.app.download' | translate }}</a>
            }
            @if (status() !== 'starting') {
              <button type="button" class="sc-btn" (click)="dismiss()">{{ 'hq.app.close' | translate }}</button>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { display: flex; }
      /* Only Angular's comment anchors left (cannot install): take no room. */
      :host:empty { display: none; }
      .go { display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 44px); text-decoration: none; }
      .hint {
        position: fixed; z-index: 50; left: 50%; transform: translateX(-50%); bottom: var(--sc-float-bottom, 16px);
        display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px);
        width: max-content; max-width: min(480px, calc(100vw - 2 * var(--sc-space-3, 12px)));
        padding: var(--sc-space-3, 12px); color: var(--sc-fg);
        background: var(--sc-bg-1); border: 1px solid var(--sc-accent); border-radius: var(--sc-radius, 10px);
      }
      .hint-text { flex: 1 1 16rem; }
      .hint .sc-btn { min-height: var(--sc-tap-min, 44px); text-decoration: none; }
    `,
  ],
})
export class HqAppLaunchComponent {
  private readonly launcher = inject(SccAppLauncherService);
  readonly canInstall = inject(DesktopCapabilityService).canInstall;
  readonly url = SCC_INSTALLER_URL;
  readonly status = signal<LaunchStatus>('idle');

  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.hideTimer));
  }

  onClick(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    void this.start();
  }

  async start(): Promise<void> {
    if (this.status() === 'starting') return;
    clearTimeout(this.hideTimer);
    this.status.set('starting');
    if (await this.launcher.launch()) {
      this.status.set('started');
      this.hideTimer = setTimeout(() => this.status.set('idle'), STARTED_HINT_MS);
    } else if (this.launcher.launchedBefore()) {
      this.status.set('noResponse');
    } else {
      this.launcher.downloadInstaller();
      this.status.set('downloading');
    }
  }

  dismiss(): void {
    clearTimeout(this.hideTimer);
    this.status.set('idle');
  }
}
