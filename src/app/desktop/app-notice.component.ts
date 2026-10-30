import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { ToastSlotDirective } from '../shared/toast-stack/toast-stack';
import { TranslatePipe } from '@ngx-translate/core';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { formatAppSize } from '../shell/apps-menu.component';
import { SCC_INSTALLER_URL } from '../news/verse-status-chip.component';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { APP_NOTICE_DELAY_MS, AppNoticeService, NoticeApp } from './app-notice.service';
import { DesktopReleaseService, RingRelease } from './desktop-release.service';

const STARSCAPE_FALLBACK_URL =
  'https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/wallpaper-app-latest/starscape-wallpaper.exe';

/**
 * `<sc-app-notice app="scc|starscape">` - the app notification toast, bottom
 * right in the look of the star toast. Appears after the host page has been
 * shown for 3 s without interruption (the component lives exactly as long as
 * the page), collapsed to one line; a click anywhere on it expands the app
 * info with a real download anchor. The x snoozes the app for ~14 days; if it
 * is ignored it simply returns on the next visit. Renders nothing on a device
 * that cannot install a desktop app.
 */
@Component({
  selector: 'sc-app-notice',
  standalone: true,
  imports: [ToastSlotDirective, TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="toast" scToastSlot role="region" [attr.aria-label]="'appNotice.aria' | translate"
           [class.open]="expanded()" (click)="expand()">
        <i class="ico" aria-hidden="true">
          @if (app() === 'scc') {
            <img src="icons/brand/scc-mark.svg" alt="" width="22" height="22" />
          } @else {
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
          }
        </i>
        <button type="button" class="head" (click)="toggle($event)" [attr.aria-expanded]="expanded()">
          <small>{{ 'appNotice.eyebrow' | translate }}</small>
          <b>{{ 'appNotice.' + app() + '.line' | translate }}</b>
        </button>
        <button type="button" class="x" (click)="dismiss($event)" [attr.aria-label]="'appNotice.close' | translate"
                [scTooltip]="'appNotice.close' | translate">×</button>
        <div class="more" [attr.inert]="expanded() ? null : ''">
          <div class="more-in">
            <p>{{ 'appNotice.' + app() + '.desc' | translate }}</p>
            <span class="meta">{{ meta() }}</span>
            <a class="dl" [href]="href()" rel="noopener noreferrer" download>{{ 'appNotice.download' | translate }}</a>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .toast {
      position: fixed; z-index: 1440;
      inset-inline-end: var(--sc-fab-gutter, 16px);
      bottom: calc(var(--sc-toast-bottom, var(--sc-fab-clear-block, 80px)) + var(--sc-toast-offset, 0px));
      width: min(var(--sc-toast-w, 24rem), calc(100vw - 2 * var(--sc-fab-gutter, 16px)));
      display: grid; grid-template-columns: auto 1fr auto; column-gap: 12px; align-items: center;
      padding: 10px 12px; border-radius: 14px; overflow: hidden; cursor: pointer;
      background: color-mix(in srgb, var(--sc-bg-1) 94%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55), 0 0 30px color-mix(in srgb, var(--sc-accent) 14%, transparent);
      backdrop-filter: blur(10px);
      animation: notice-in 0.28s ease-out both;
    }
    .toast.open { cursor: default; }
    .ico {
      font-style: normal; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-accent);
    }
    .ico svg { width: 20px; height: 20px; }
    .head {
      display: grid; gap: 2px; min-width: 0; text-align: start; padding: 4px 0; min-height: var(--sc-tap-min, 44px);
      align-content: center; background: none; border: 0; color: inherit; font: inherit; cursor: inherit; border-radius: 6px;
    }
    .head small { font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.18em; text-transform: uppercase; color: var(--sc-accent); }
    .head b { font-size: 0.92rem; font-weight: 600; color: var(--sc-fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toast.open .head b { white-space: normal; }
    .head:focus-visible, .x:focus-visible, .dl:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .x {
      width: 32px; height: 32px; border-radius: 50%; padding: 0; cursor: pointer; font-size: 16px; line-height: 1;
      background: none; border: 1px solid var(--sc-border); color: var(--sc-fg-2);
    }
    .x:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .more {
      grid-column: 1 / -1; display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.26s ease;
    }
    .toast.open .more { grid-template-rows: 1fr; }
    .more-in { overflow: hidden; display: grid; gap: 8px; justify-items: start; min-height: 0; }
    .toast.open .more-in { padding-top: 10px; }
    .more-in p { margin: 0; font-size: max(0.82rem, var(--sc-fs-floor)); line-height: 1.4; color: var(--sc-fg-1); }
    .meta { font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }
    .dl {
      display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 44px); padding: 0 16px; border-radius: 999px;
      border: 1px solid var(--sc-accent); color: var(--sc-accent); text-decoration: none; font-weight: 600;
    }
    .dl:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    @keyframes notice-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) {
      .toast { animation: notice-fade 0.2s linear both; }
      .more { transition: none; }
      @keyframes notice-fade { from { opacity: 0; } to { opacity: 1; } }
    }
  `],
})
export class AppNoticeComponent {
  readonly app = input.required<NoticeApp>();

  private readonly notices = inject(AppNoticeService);
  private readonly device = inject(DesktopCapabilityService);
  private readonly releases = inject(DesktopReleaseService);

  readonly visible = signal(false);
  readonly expanded = signal(false);
  private readonly release = signal<RingRelease | null>(null);
  private loaded = false;

  readonly href = computed(() =>
    this.app() === 'scc' ? SCC_INSTALLER_URL : (this.release()?.url ?? STARSCAPE_FALLBACK_URL),
  );
  readonly meta = computed(() => {
    const r = this.release();
    const parts = ['Windows'];
    if (r) {
      parts.push(`v${r.version}`);
      const size = formatAppSize(r.sizeBytes);
      if (size) parts.push(size);
    }
    return parts.join(' · ');
  });

  constructor() {
    // Presence timer: leaving the page destroys the component and cancels it.
    const timer = setTimeout(() => {
      if (this.device.canInstall() && !this.notices.isSnoozed(this.app())) this.visible.set(true);
    }, APP_NOTICE_DELAY_MS);
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  expand(): void {
    if (this.expanded()) return;
    this.expanded.set(true);
    void this.load();
  }

  toggle(ev: Event): void {
    ev.stopPropagation();
    const next = !this.expanded();
    this.expanded.set(next);
    if (next) void this.load();
  }

  dismiss(ev: Event): void {
    ev.stopPropagation();
    this.notices.snooze(this.app());
    this.visible.set(false);
    this.expanded.set(false);
  }

  private async load(): Promise<void> {
    if (this.loaded || this.app() !== 'starscape') return;
    this.loaded = true;
    const res = await this.releases.ringsFor('starscape', ['stable']);
    this.release.set(res.releases[0] ?? null);
  }
}
