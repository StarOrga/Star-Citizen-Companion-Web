import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { isPlainLeftClick } from '../core/modified-click.util';
import { SCC_LAUNCH_GRACE_MS, SCC_LAUNCH_WAIT_MS, SccAppLauncherService } from '../desktop/scc-app-launcher.service';
import { SCC_INSTALLER_URL } from '../news/verse-status-chip.component';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';

type LaunchStatus = 'idle' | 'starting' | 'started' | 'downloading' | 'downloadStarted' | 'noResponse';

const STARTED_HINT_MS = 6000;

/**
 * The one desktop-app action on the HQ pages that only fill once the app reads the game (Jetzt,
 * Statistik): start the app, and download it when it does not answer. A small hint says which of
 * the two is happening. Public, so normal accent. Hidden on a device that cannot install a
 * desktop application (same rule as the status chip's download).
 *
 * A real anchor at the installer: a modified click, the context menu or a failed script all still
 * reach the download. Only the plain left click tries the app first.
 *
 * `mode="download"` is the same action for a browser and an account that have never seen the app:
 * it says "downloaden" and its plain click downloads right away (HQ Start, Jetzt tile).
 */
@Component({
  selector: 'sc-hq-app-launch',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canInstall()) {
      <a
        class="go"
        [class.sc-btn]="look() === 'primary'"
        [class.sc-btn-primary]="look() === 'primary'"
        [class.pill]="look() === 'pill' || look() === 'chip'"
        [class.chip]="look() === 'chip'"
        [href]="url"
        [scTooltip]="tip() ? (tip() | translate) : null"
        rel="noopener noreferrer"
        [attr.aria-busy]="status() === 'starting'"
        (click)="onClick($event)"
      >{{ (mode() === 'download' ? 'hq.app.downloadCta' : 'hq.app.launch') | translate }}</a>
      <div class="live" role="status">
        @if (status() !== 'idle') {
          <div class="hint">
            <span class="hint-text">{{ 'hq.app.' + status() | translate }}</span>
            @if (status() === 'downloading') {
              <button type="button" class="sc-btn" (click)="start()">{{ 'hq.app.retry' | translate }}</button>
            } @else if (status() === 'noResponse') {
              <a class="sc-btn" [href]="url" rel="noopener noreferrer">{{ 'hq.app.download' | translate }}</a>
            }
            <button type="button" class="sc-btn" (click)="dismiss()">{{ 'hq.app.close' | translate }}</button>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host { display: flex; }
      /* Phones: the desktop app is not something to start or download from here. */
      @media (max-width: 749px) { :host { display: none; } }
      /* Only Angular's comment anchors left (cannot install): take no room. */
      :host:empty { display: none; }
      .go { display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 44px); text-decoration: none; }
      .pill {
        min-height: 36px; padding: 0 14px;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 55%, transparent); border-radius: 999px;
        background: color-mix(in srgb, var(--sc-bg-1) 75%, transparent); color: var(--sc-accent);
        font: 500 max(0.84rem, var(--sc-fs-floor)) / 1 var(--sc-font-body);
      }
      .pill:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
      .pill:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      /* Inside the HQ status chip (sc-hq-live-ticker): the same pill, one size down, so it fits the 32px chip. */
      .pill.chip { min-height: 24px; padding: 0 10px; font-size: max(0.76rem, var(--sc-fs-floor)); }
      @media (pointer: coarse) { .pill, .pill.chip { min-height: 48px; } }
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
  /** `download`: never tries to start the app, the plain click downloads. */
  readonly mode = input<'launch' | 'download'>('launch');
  readonly look = input<'primary' | 'pill' | 'chip'>('primary');
  /** Explains the action and where the Apps menu keeps it (info tier). */
  readonly tipped = input(false);
  protected readonly tip = computed(() => {
    if (!this.tipped()) return '';
    return this.mode() === 'download' ? 'hq.app.tipDownload' : 'hq.app.tipLaunch';
  });

  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every start and close, so a late answer of an attempt the reader closed changes nothing. */
  private run = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.hideTimer));
  }

  onClick(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    if (this.mode() === 'download') this.download();
    else void this.start();
  }

  private download(): void {
    clearTimeout(this.hideTimer);
    this.launcher.downloadInstaller();
    this.status.set('downloadStarted');
    this.hideTimer = setTimeout(() => this.status.set('idle'), STARTED_HINT_MS);
  }

  async start(): Promise<void> {
    if (this.status() === 'starting') return;
    clearTimeout(this.hideTimer);
    const run = ++this.run;
    this.status.set('starting');
    // Seen here before: no download hangs on the answer, so give a cold start time to come to the front.
    const known = this.launcher.launchedBefore();
    const answered = await this.launcher.launch(known ? SCC_LAUNCH_GRACE_MS : SCC_LAUNCH_WAIT_MS);
    if (run !== this.run) return;
    if (answered) {
      this.status.set('started');
      this.hideTimer = setTimeout(() => this.status.set('idle'), STARTED_HINT_MS);
    } else if (known) {
      this.status.set('noResponse');
    } else {
      this.launcher.downloadInstaller();
      this.status.set('downloading');
    }
  }

  dismiss(): void {
    clearTimeout(this.hideTimer);
    this.run++;
    this.status.set('idle');
  }
}
