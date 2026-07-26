import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ExtensionBridgeService } from '../hangar/extension-bridge.service';

/** Dismissal is a local preference, not account state — no round-trip needed. */
const DISMISS_KEY = 'sc.extensionPromo.dismissed';

/**
 * One-line promo for the hangar-import browser extension, shown on the Codex
 * landing. Self-hiding in three cases, so it can never become wallpaper:
 * the extension is already installed, the user dismissed it, or the browser
 * is not Chromium-based (the extension is MV3/Chrome only for now).
 */
@Component({
  selector: 'sc-extension-promo',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="promo" role="note">
        <span class="icon" aria-hidden="true">⇩</span>
        <span class="text">{{ 'extension.promo.text' | translate }}</span>
        <a class="cta" routerLink="/tools/extension">{{ 'extension.promo.cta' | translate }}</a>
        <button type="button" class="close" (click)="dismiss()"
                [attr.aria-label]="'extension.promo.dismiss' | translate">✕</button>
      </div>
    }
  `,
  styles: [
    `
      .promo {
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        padding: 8px 12px; border-radius: 8px;
        background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-1));
        border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, transparent);
        font-size: 0.8rem; color: var(--sc-fg-1);
      }
      .icon { color: var(--sc-accent); }
      .text { flex: 1 1 240px; line-height: 1.5; }
      .cta { color: var(--sc-accent); text-decoration: underline; white-space: nowrap; }
      .close { background: transparent; border: 0; color: var(--sc-fg-2); cursor: pointer; padding: 2px 4px; }
      .close:hover { color: var(--sc-fg-0); }
    `,
  ],
})
export class ExtensionPromoComponent implements OnInit {
  private readonly bridge = inject(ExtensionBridgeService);
  readonly visible = signal(false);

  async ngOnInit(): Promise<void> {
    if (this.dismissed() || !this.chromium()) return;
    // Give the extension's content script its moment before pitching it.
    const installed = await this.bridge.waitForExtension(600);
    this.visible.set(!installed);
  }

  dismiss(): void {
    this.visible.set(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode — the promo simply returns next visit */
    }
  }

  private dismissed(): boolean {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  }

  private chromium(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    if (/Firefox\//.test(ua)) return false;
    // Safari sets neither Chrome nor Chromium; Edge/Opera/Brave all do.
    return /Chrome\/|Chromium\//.test(ua);
  }
}
