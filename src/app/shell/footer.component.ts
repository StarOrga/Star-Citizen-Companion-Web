import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Site-wide footer. Shown on both the public login page and inside the
 * authenticated shell. Carries the "Made by the Community" fan badge and
 * the trademark disclaimer required for a Star Citizen fan site.
 */
@Component({
  selector: 'sc-footer',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="site-footer">
      <div class="inner">
        <div class="badge">
          <img src="icons/made-by-community.svg"
               [alt]="'footer.badgeAlt' | translate"
               width="64" height="64" />
          <span class="badge-label">{{ 'footer.madeByCommunity' | translate }}</span>
        </div>

        <div class="meta">
          <p class="brand">Star Citizen Companion</p>
          <p class="disclaimer">{{ 'footer.disclaimer' | translate }}</p>
          <p class="copyright">{{ 'footer.trademarks' | translate }}</p>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    .site-footer {
      border-top: 1px solid var(--sc-border);
      background: linear-gradient(0deg, var(--sc-bg-2), transparent);
      padding: 24px 28px;
      margin-top: auto;
    }
    .inner {
      max-width: 1280px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 24px;
      flex-wrap: wrap;
    }
    .badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .badge img {
      filter: drop-shadow(0 0 8px rgba(0, 212, 255, 0.35));
    }
    .badge-label {
      font-family: var(--sc-font-display);
      font-size: 0.62rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .meta { flex: 1; min-width: 220px; }
    .meta .brand {
      font-family: var(--sc-font-display);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-1);
      margin: 0 0 6px;
      font-size: 0.85rem;
    }
    .meta .disclaimer {
      color: var(--sc-fg-2);
      font-size: 0.78rem;
      line-height: 1.5;
      margin: 0 0 4px;
      max-width: 70ch;
    }
    .meta .copyright {
      color: var(--sc-fg-2);
      font-size: 0.72rem;
      line-height: 1.5;
      margin: 0;
      opacity: 0.8;
      max-width: 70ch;
    }
    @media (max-width: 640px) {
      .site-footer { padding: 20px 16px; }
      .inner { gap: 16px; }
    }
  `],
})
export class FooterComponent {}
