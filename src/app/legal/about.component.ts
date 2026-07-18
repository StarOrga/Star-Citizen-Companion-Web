import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/**
 * /about — public "who runs this and what is it" page.
 *
 * Trust/legitimacy surface for both humans and URL-reputation scanners:
 * a login-capable site with no self-description matches phishing heuristics,
 * so this page states purpose, operator, source code and non-affiliation
 * in plain, crawlable text (linked from the footer and the login page).
 */
@Component({
  selector: 'sc-about',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ 'legal.about.title' | translate }}</h1>
      <p class="subtitle">{{ 'legal.about.subtitle' | translate }}</p>

      <div class="sc-card">
        <h2>{{ 'legal.about.what.title' | translate }}</h2>
        <p>{{ 'legal.about.what.p1' | translate }}</p>
        <p>{{ 'legal.about.what.p2' | translate }}</p>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.about.openSource.title' | translate }}</h2>
        <p>{{ 'legal.about.openSource.p1' | translate }}</p>
        <ul class="link-list">
          <li>
            <a href="https://github.com/StarOrga/Star-Citizen-Companion-Web"
               target="_blank" rel="noopener noreferrer">
              {{ 'legal.about.openSource.repoLink' | translate }}
            </a>
          </li>
        </ul>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.about.data.title' | translate }}</h2>
        <p>{{ 'legal.about.data.p1' | translate }}</p>
        <a routerLink="/legal/privacy">{{ 'legal.about.data.privacyLink' | translate }}</a>
      </div>

      <div class="sc-card affiliation">
        <h2>{{ 'legal.about.affiliation.title' | translate }}</h2>
        <p>{{ 'legal.about.affiliation.p1' | translate }}</p>
        <p class="disclaimer">{{ 'footer.trademarks' | translate }}</p>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.about.contact.title' | translate }}</h2>
        <p>{{ 'legal.about.contact.p1' | translate }}</p>
        <ul class="link-list">
          <li>
            <a href="https://github.com/StarOrga/Star-Citizen-Companion-Web/issues"
               target="_blank" rel="noopener noreferrer">
              {{ 'legal.about.contact.issuesLink' | translate }}
            </a>
          </li>
          <li>
            <a href="/.well-known/security.txt" target="_blank" rel="noopener noreferrer">
              {{ 'legal.about.contact.securityLink' | translate }}
            </a>
          </li>
        </ul>
      </div>
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; max-width: 860px; }
    h1 { margin: 0; }
    .subtitle { color: var(--sc-fg-2); margin: -8px 0 0; }
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
    .affiliation { border-color: var(--sc-accent); }
    .affiliation .disclaimer {
      color: var(--sc-fg-2);
      font-size: 0.78rem;
      border-top: 1px solid var(--sc-border);
      padding-top: 10px;
      margin-top: 12px;
    }
  `],
})
export class AboutComponent {}
