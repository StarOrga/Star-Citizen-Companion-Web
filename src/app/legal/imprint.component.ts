import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * /legal/imprint — site notice ("Impressum").
 *
 * Names the operating community project and reachable contact channels.
 * Deliberately references the GitHub organization instead of inventing
 * personal operator data; completing full legal operator details (if the
 * project's status ever requires them) is an explicit maintainer decision.
 */
@Component({
  selector: 'sc-imprint',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ 'legal.imprint.title' | translate }}</h1>

      <div class="sc-card">
        <h2>{{ 'legal.imprint.operator.title' | translate }}</h2>
        <p>{{ 'legal.imprint.operator.p1' | translate }}</p>
        <p>{{ 'legal.imprint.operator.p2' | translate }}</p>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.imprint.contact.title' | translate }}</h2>
        <ul class="link-list">
          <li>
            <a href="https://github.com/StarOrga/Star-Citizen-Companion-Web/issues"
               target="_blank" rel="noopener noreferrer">
              {{ 'legal.imprint.contact.issuesLink' | translate }}
            </a>
          </li>
          <li>
            <a href="https://github.com/StarOrga/Star-Citizen-Companion-Web/security/advisories/new"
               target="_blank" rel="noopener noreferrer">
              {{ 'legal.imprint.contact.securityLink' | translate }}
            </a>
          </li>
        </ul>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.imprint.liability.title' | translate }}</h2>
        <p>{{ 'legal.imprint.liability.p1' | translate }}</p>
        <p>{{ 'legal.imprint.liability.p2' | translate }}</p>
      </div>

      <div class="sc-card trademark">
        <h2>{{ 'legal.imprint.trademark.title' | translate }}</h2>
        <p>{{ 'footer.disclaimer' | translate }}</p>
        <p class="disclaimer">{{ 'footer.trademarks' | translate }}</p>
      </div>
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; max-width: 860px; }
    h1 { margin: 0; }
    h2 {
      margin: 0 0 10px;
      font-size: 1rem;
      font-family: var(--sc-font-display);
      letter-spacing: 0.04em;
    }
    p { line-height: 1.55; margin: 0 0 10px; }
    p:last-child { margin-bottom: 0; }
    a { color: var(--sc-accent); }
    a:hover { color: var(--sc-fg-0); }
    .link-list { margin: 0; padding-left: 20px; }
    .link-list li { margin: 4px 0; }
    .trademark { border-color: var(--sc-accent); }
    .trademark .disclaimer {
      color: var(--sc-fg-2);
      font-size: 0.78rem;
      border-top: 1px solid var(--sc-border);
      padding-top: 10px;
      margin-top: 12px;
    }
  `],
})
export class ImprintComponent {}
