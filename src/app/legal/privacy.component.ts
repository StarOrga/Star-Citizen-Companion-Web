import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * /legal/privacy — public privacy policy.
 *
 * A login-capable site without a reachable privacy policy is a strong
 * phishing-heuristic trigger for URL-reputation scanners (and a GDPR gap).
 * Content is honest and minimal: what is processed, where it lives
 * (Supabase eu-central-1, Vercel hosting), what never happens (ads,
 * tracking, resale). Operator details live on /legal/imprint.
 *
 * Every claim here is derived from the code, so this page has to be
 * re-checked whenever auth or storage changes. The current mapping:
 *  - sign-in methods → `AuthService` (password + Google OAuth, nothing else),
 *  - account fields → `profiles` (00001 / invite-only / username+lang /
 *    flagship migrations) plus Supabase's own `auth.users` record,
 *  - browser storage → `SupabaseClientProvider` (`storageKey: 'sc.auth'`)
 *    and `ConsentService`'s three categories,
 *  - third parties → the `Content-Security-Policy` in `vercel.json`,
 *  - deletion → `supabase/functions/delete-user` (admin-gated today).
 */
@Component({
  selector: 'sc-privacy',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ 'legal.privacy.title' | translate }}</h1>
      <p class="subtitle">{{ 'legal.privacy.updated' | translate }}</p>

      <div class="sc-card summary">
        <h2>{{ 'legal.privacy.summary.title' | translate }}</h2>
        <ul class="list">
          @for (item of ['noAds', 'signIn', 'noTracking', 'minimal', 'euHosting']; track item) {
            <li>{{ 'legal.privacy.summary.' + item | translate }}</li>
          }
        </ul>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.privacy.hosting.title' | translate }}</h2>
        <p>{{ 'legal.privacy.hosting.p1' | translate }}</p>
        <p>{{ 'legal.privacy.hosting.p2' | translate }}</p>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.privacy.account.title' | translate }}</h2>
        <p>{{ 'legal.privacy.account.p1' | translate }}</p>
        <p>{{ 'legal.privacy.account.p2' | translate }}</p>
        <p>{{ 'legal.privacy.account.p3' | translate }}</p>
        <p>{{ 'legal.privacy.account.p4' | translate }}</p>
        <p>{{ 'legal.privacy.account.p5' | translate }}</p>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.privacy.google.title' | translate }}</h2>
        <p>{{ 'legal.privacy.google.p1' | translate }}</p>
        <p>{{ 'legal.privacy.google.p2' | translate }}</p>
        <p>{{ 'legal.privacy.google.p3' | translate }}</p>
        <ul class="link-list">
          <li>
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
              {{ 'legal.privacy.google.policyLink' | translate }}
            </a>
          </li>
        </ul>
        <p>{{ 'legal.privacy.google.p4' | translate }}</p>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.privacy.local.title' | translate }}</h2>
        <p>{{ 'legal.privacy.local.p1' | translate }}</p>
        <ul class="list">
          @for (key of ['session', 'lang', 'consent', 'composer', 'preferences', 'statistics'];
                track key) {
            <li>{{ 'legal.privacy.local.keys.' + key | translate }}</li>
          }
        </ul>
        <p>{{ 'legal.privacy.local.p2' | translate }}</p>
        <p>{{ 'legal.privacy.local.p3' | translate }}</p>
        <p>{{ 'legal.privacy.local.p4' | translate }}</p>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.privacy.thirdParty.title' | translate }}</h2>
        <p>{{ 'legal.privacy.thirdParty.p1' | translate }}</p>
        <ul class="list">
          @for (item of ['supabase', 'vercel', 'google', 'posthog', 'fonts', 'rsiMedia', 'gameApis'];
                track item) {
            <li>{{ 'legal.privacy.thirdParty.' + item | translate }}</li>
          }
        </ul>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.privacy.rights.title' | translate }}</h2>
        <p>{{ 'legal.privacy.rights.p1' | translate }}</p>
        <p>{{ 'legal.privacy.rights.p2' | translate }}</p>
        <p>{{ 'legal.privacy.rights.p3' | translate }}</p>
      </div>
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; max-width: 860px; }
    h1 { margin: 0; }
    .subtitle { color: var(--sc-fg-2); margin: -8px 0 0; font-size: 0.85rem; }
    h2 {
      margin: 0 0 10px;
      font-size: 1rem;
      font-family: var(--sc-font-display);
      letter-spacing: 0.04em;
    }
    p { line-height: 1.55; margin: 0 0 10px; }
    p:last-child { margin-bottom: 0; }
    .summary { border-color: var(--sc-accent); }
    .list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
    .list li { line-height: 1.5; }
    .link-list {
      margin: 0 0 10px;
      padding-left: 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .link-list a { color: var(--sc-accent); }
  `],
})
export class PrivacyComponent {}
