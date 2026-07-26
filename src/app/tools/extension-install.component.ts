import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ExtensionBridgeService } from '../hangar/extension-bridge.service';

/** Where the unpacked extension lives until the Web Store review is through. */
const REPO_URL = 'https://github.com/StarOrga/Star-Citizen-Companion-Web/tree/main/browser-extension';
const REPO_ZIP_URL = 'https://github.com/StarOrga/Star-Citizen-Companion-Web/archive/refs/heads/main.zip';

/**
 * /tools/extension — install + privacy page for the hangar-import browser
 * extension (source: browser-extension/).
 *
 * Public on purpose: it is the page the codex promo points at, and the privacy
 * section has to be readable before anyone installs anything. It mirrors
 * browser-extension/PRIVACY.md — keep both in sync.
 */
@Component({
  selector: 'sc-extension-install',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ 'extension.install.title' | translate }}</h1>
      <p class="subtitle">{{ 'extension.install.subtitle' | translate }}</p>

      @if (installed()) {
        <div class="sc-card ok">
          <strong>{{ 'extension.install.detected.title' | translate }}</strong>
          <p>{{ 'extension.install.detected.text' | translate }}</p>
          <a class="sc-btn" href="https://robertsspaceindustries.com/en/account/pledges"
             target="_blank" rel="noopener noreferrer">
            {{ 'extension.install.detected.openHangar' | translate }}
          </a>
        </div>
      }

      <div class="sc-card">
        <h2>{{ 'extension.install.what.title' | translate }}</h2>
        <p>{{ 'extension.install.what.text' | translate }}</p>
        <ol class="steps">
          @for (step of ['open', 'offer', 'confirm']; track step) {
            <li>
              <span class="step-title">{{ 'extension.install.what.' + step + '.title' | translate }}</span>
              <span class="step-text">{{ 'extension.install.what.' + step + '.text' | translate }}</span>
            </li>
          }
        </ol>
      </div>

      <!-- Privacy first: this is the reason the extension exists in this shape -->
      <div class="sc-card privacy">
        <h2>{{ 'extension.install.privacy.title' | translate }}</h2>
        <p class="lead">{{ 'extension.privacy.gameContentOnly' | translate }}</p>
        <ul class="checks">
          @for (item of ['noCredentials', 'noPersonalData', 'noUpload', 'scopeLimited', 'localOnly']; track item) {
            <li>{{ 'extension.privacy.' + item | translate }}</li>
          }
        </ul>
        <p class="hint">{{ 'extension.install.privacy.openSource' | translate }}</p>
        <ul class="link-list">
          <li>
            <a [href]="repoUrl" target="_blank" rel="noopener noreferrer">
              {{ 'extension.install.privacy.sourceLink' | translate }}
            </a>
          </li>
          <li>
            <a routerLink="/legal/privacy">{{ 'extension.install.privacy.appPrivacyLink' | translate }}</a>
          </li>
        </ul>
      </div>

      <div class="sc-card">
        <h2>{{ 'extension.install.how.title' | translate }}</h2>
        <p class="hint">{{ 'extension.install.how.storeNote' | translate }}</p>
        <ol class="steps">
          @for (step of ['download', 'devmode', 'load', 'use']; track step) {
            <li>
              <span class="step-title">{{ 'extension.install.how.' + step + '.title' | translate }}</span>
              <span class="step-text">{{ 'extension.install.how.' + step + '.text' | translate }}</span>
            </li>
          }
        </ol>
        <div class="row">
          <a class="sc-btn sc-btn-primary" [href]="repoZipUrl" target="_blank" rel="noopener noreferrer">
            {{ 'extension.install.how.downloadCta' | translate }}
          </a>
          <a class="sc-btn" [href]="repoUrl" target="_blank" rel="noopener noreferrer">
            {{ 'extension.install.how.browseCta' | translate }}
          </a>
        </div>
        <p class="hint browsers">{{ 'extension.install.how.browsers' | translate }}</p>
      </div>

      <div class="sc-card">
        <h2>{{ 'extension.install.alt.title' | translate }}</h2>
        <p>{{ 'extension.install.alt.text' | translate }}</p>
        <a class="sc-btn" routerLink="/hangar">{{ 'extension.install.alt.cta' | translate }}</a>
      </div>

      <p class="disclaimer">{{ 'extension.install.disclaimer' | translate }}</p>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; padding: 20px 16px 48px; max-width: 860px; margin: 0 auto; }
      h1 { margin: 0; font-size: 1.35rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
      h2 { margin: 0 0 8px; font-size: 0.95rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
      .subtitle { margin: 0; color: var(--sc-fg-2); font-size: 0.9rem; line-height: 1.6; }
      p { line-height: 1.6; font-size: 0.86rem; }
      .hint { color: var(--sc-fg-2); font-size: 0.8rem; }
      .ok { border-color: color-mix(in srgb, var(--sc-success) 45%, transparent); }
      .ok strong { color: var(--sc-success); }
      .steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
      .steps li { line-height: 1.55; }
      .step-title { display: block; font-size: 0.86rem; color: var(--sc-fg-0); font-weight: 600; }
      .step-text { display: block; font-size: 0.82rem; color: var(--sc-fg-2); }
      .privacy .lead { font-size: 0.88rem; color: var(--sc-fg-0); }
      .checks { list-style: none; margin: 10px 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .checks li { position: relative; padding-left: 22px; font-size: 0.84rem; color: var(--sc-fg-1); line-height: 1.55; }
      .checks li::before { content: '✓'; position: absolute; left: 0; color: var(--sc-success); }
      .link-list { margin: 6px 0 0; padding-left: 18px; font-size: 0.82rem; }
      .link-list a { color: var(--sc-accent); }
      .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
      .browsers { margin-top: 10px; }
      .sc-btn-primary { background: var(--sc-accent); color: var(--sc-bg-0); border-color: var(--sc-accent); }
      .disclaimer { color: var(--sc-fg-2); font-size: 0.74rem; line-height: 1.6; }
    `,
  ],
})
export class ExtensionInstallComponent implements OnInit {
  private readonly bridge = inject(ExtensionBridgeService);

  readonly repoUrl = REPO_URL;
  readonly repoZipUrl = REPO_ZIP_URL;
  readonly installed = signal(false);

  async ngOnInit(): Promise<void> {
    this.installed.set(await this.bridge.waitForExtension());
  }
}
