import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ConsentService } from './consent.service';

/**
 * First-visit browser-storage notice (issue #130). Rendered until the user
 * decides; the choice is revisitable any time under Settings → Storage.
 * Deliberately compact — the app stores no cookies and no tracking state,
 * so this is an information + opt-in bar, not a cookie-wall.
 */
@Component({
  selector: 'sc-consent-banner',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!consent.decided()) {
      <div class="consent" role="dialog" aria-live="polite" [attr.aria-label]="'consent.banner.title' | translate">
        <div class="text">
          <strong>{{ 'consent.banner.title' | translate }}</strong>
          <span>{{ 'consent.banner.text' | translate }}</span>
        </div>
        <div class="actions">
          <button type="button" class="sc-btn sc-btn-primary" (click)="consent.acceptAll()">
            {{ 'consent.banner.acceptAll' | translate }}
          </button>
          <button type="button" class="sc-btn" (click)="consent.essentialOnly()">
            {{ 'consent.banner.essentialOnly' | translate }}
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .consent {
      position: fixed;
      left: 50%;
      bottom: 16px;
      transform: translateX(-50%);
      z-index: 1100;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      max-width: min(720px, calc(100vw - 32px));
      padding: 12px 16px;
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    }
    .text {
      flex: 1 1 320px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .text strong {
      font-family: var(--sc-font-display);
      font-size: 0.8rem;
      letter-spacing: 0.05em;
      color: var(--sc-fg-0);
    }
    .text span { color: var(--sc-fg-2); font-size: 0.78rem; line-height: 1.45; }
    .actions { display: flex; gap: 8px; flex: 0 0 auto; }
    .sc-btn-primary {
      background: var(--sc-accent);
      color: var(--sc-bg-0);
      border-color: var(--sc-accent);
    }
    @media (max-width: 560px) {
      .actions { flex: 1 1 100%; }
      .actions .sc-btn { flex: 1; justify-content: center; }
    }
  `],
})
export class ConsentBannerComponent {
  readonly consent = inject(ConsentService);
}
