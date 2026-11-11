import { ChangeDetectionStrategy, Component, DestroyRef, Injector, computed, effect, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { isPlainLeftClick } from '../core/modified-click.util';
import { SCC_LAUNCH_GRACE_MS, SCC_LAUNCH_WAIT_MS, SccAppLauncherService } from '../desktop/scc-app-launcher.service';
import { SCC_INSTALLER_URL } from '../news/verse-status-chip.component';
import { ScPopupMotionDirective } from '../shared/popup-motion/sc-popup-motion.directive';
import { ToastSlotDirective } from '../shared/toast-stack/toast-stack';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { HqAppConnectionService } from './now/hq-app-connection.service';

type LaunchStatus = 'idle' | 'starting' | 'started' | 'downloading' | 'downloadStarted' | 'noResponse';

/** Fallback when the app never reports in: the success hint leaves by itself after this. */
const STARTED_HINT_MS = 6000;
/** After the app's live signal arrives, the success hint stays this long, then leaves. */
const CONNECTED_HINT_MS = 2000;

/**
 * The one desktop-app action on the HQ pages that only fill once the app reads the game (Jetzt,
 * Statistik): start the app, and download it when it does not answer. A small star toast (the look
 * of the app notice, stacked with it) says which of the two is happening. Public, so normal accent.
 * Hidden on a device that cannot install a desktop application (same rule as the status chip's
 * download).
 *
 * The success states ("started", "download running") have nothing left to click, so they carry no
 * close button and leave by themselves: shortly after the app's live signal arrives, else after
 * the fallback time. The failure states keep their action (retry / download) and a close.
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
  imports: [TranslatePipe, ScTooltipDirective, ScPopupMotionDirective, ToastSlotDirective],
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
          <div class="toast" [class.ok]="done()" scToastSlot scPopupMotion scPopupMotionOrigin="br" animate.leave="pm-out">
            <i class="ico" aria-hidden="true">
              @if (done()) {
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              } @else if (status() === 'starting') {
                <span class="spin"></span>
              } @else {
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14" /></svg>
              }
            </i>
            <span class="txt">{{ 'hq.app.' + status() | translate }}</span>
            @if (status() === 'downloading') {
              <button type="button" class="act" (click)="start()">{{ 'hq.app.retry' | translate }}</button>
            } @else if (status() === 'noResponse') {
              <a class="act" [href]="url" rel="noopener noreferrer">{{ 'hq.app.download' | translate }}</a>
            }
            @if (!done()) {
              <button type="button" class="x" [attr.aria-label]="'hq.app.close' | translate" [scTooltip]="'hq.app.close' | translate" (click)="dismiss()">×</button>
            }
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
      /* The star-toast look of sc-app-notice, bottom right; scToastSlot stacks it above a toast that is already up. */
      .toast {
        position: fixed; z-index: 1440;
        inset-inline-end: var(--sc-fab-gutter, 16px);
        bottom: calc(var(--sc-toast-bottom, var(--sc-fab-clear-block, 80px)) + var(--sc-toast-offset, 0px));
        width: min(var(--sc-toast-w, 24rem), calc(100vw - 2 * var(--sc-fab-gutter, 16px)));
        display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px;
        padding: 10px 12px; border-radius: 14px;
        background: color-mix(in srgb, var(--sc-bg-1) 96%, transparent);
        border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55), 0 0 30px color-mix(in srgb, var(--sc-accent) 14%, transparent);
      }
      .toast.ok { border-color: color-mix(in srgb, var(--sc-success) 55%, var(--sc-border)); }
      .ico {
        flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
        background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-accent);
      }
      .ok .ico { background: color-mix(in srgb, var(--sc-success) 14%, transparent); color: var(--sc-success); }
      .ico svg { width: 20px; height: 20px; }
      .spin {
        width: 18px; height: 18px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--sc-accent) 30%, transparent);
        border-top-color: var(--sc-accent); animation: hq-app-spin 0.9s linear infinite;
      }
      .txt { flex: 1 1 10rem; min-width: 0; font-size: max(0.88rem, var(--sc-fs-floor)); line-height: 1.4; color: var(--sc-fg-0); }
      .act {
        display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 44px); padding: 0 16px; border-radius: 999px;
        border: 1px solid var(--sc-accent); background: none; color: var(--sc-accent); font: inherit; font-weight: 600;
        text-decoration: none; cursor: pointer;
      }
      .act:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
      .x {
        flex: none; width: 32px; height: 32px; border-radius: 50%; padding: 0; cursor: pointer; font-size: 16px; line-height: 1;
        background: none; border: 1px solid var(--sc-border); color: var(--sc-fg-2);
      }
      .x:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
      .act:focus-visible, .x:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      @keyframes hq-app-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } }
    `,
  ],
})
export class HqAppLaunchComponent {
  private readonly launcher = inject(SccAppLauncherService);
  private readonly injector = inject(Injector);
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
  /** Success states have nothing left to click: no close button, they leave by themselves. */
  protected readonly done = computed(() => this.status() === 'started' || this.status() === 'downloadStarted');

  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private watch?: { destroy(): void };
  /** Bumped by every start and close, so a late answer of an attempt the reader closed changes nothing. */
  private run = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.hideTimer);
      this.watch?.destroy();
    });
  }

  onClick(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    if (this.mode() === 'download') this.download();
    else void this.start();
  }

  private download(): void {
    this.clearWatch();
    this.launcher.downloadInstaller();
    this.status.set('downloadStarted');
    this.hideTimer = setTimeout(() => this.status.set('idle'), STARTED_HINT_MS);
  }

  async start(): Promise<void> {
    if (this.status() === 'starting') return;
    this.clearWatch();
    const run = ++this.run;
    this.status.set('starting');
    // Seen here before: no download hangs on the answer, so give a cold start time to come to the front.
    const known = this.launcher.launchedBefore();
    const answered = await this.launcher.launch(known ? SCC_LAUNCH_GRACE_MS : SCC_LAUNCH_WAIT_MS);
    if (run !== this.run) return;
    if (answered) {
      this.status.set('started');
      this.hideTimer = setTimeout(() => this.status.set('idle'), STARTED_HINT_MS);
      this.hideOnceConnected(run);
    } else if (known) {
      this.status.set('noResponse');
    } else {
      this.launcher.downloadInstaller();
      this.status.set('downloading');
    }
  }

  dismiss(): void {
    this.clearWatch();
    this.run++;
    this.status.set('idle');
  }

  private clearWatch(): void {
    clearTimeout(this.hideTimer);
    this.watch?.destroy();
    this.watch = undefined;
  }

  /**
   * The app answered the launch; once its live signal shows up the hint has done its job, so it
   * leaves shortly after. The connection service is looked up only now, not on every page: it
   * starts the live subscription, which a page that never launched anything must not pay for.
   */
  private hideOnceConnected(run: number): void {
    let conn: HqAppConnectionService;
    try {
      conn = this.injector.get(HqAppConnectionService);
    } catch {
      return;
    }
    this.watch = effect(
      () => {
        if (!conn.connected() || run !== this.run || this.status() !== 'started') return;
        this.watch?.destroy();
        this.watch = undefined;
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
          if (run === this.run) this.status.set('idle');
        }, CONNECTED_HINT_MS);
      },
      { injector: this.injector },
    );
  }
}
