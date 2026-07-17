import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { PostHogService } from '../core/posthog.service';
import { FooterComponent } from '../shell/footer.component';

@Component({
  selector: 'sc-login',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, FooterComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login-shell">
      <main class="login-page">
        <div class="sc-card login-card">
          <h1>SC Companion</h1>
          <p class="tag">{{ 'auth.tagline' | translate }}</p>

          @if (denied()) {
            <div class="notice denied">{{ 'auth.deniedInvite' | translate }}</div>
          }

          <form [formGroup]="form" (ngSubmit)="onSubmit()" novalidate>
            <label>
              {{ 'auth.email' | translate }}
              <input type="email" class="sc-input" formControlName="email" autocomplete="email" />
            </label>

            <label>
              {{ 'auth.password' | translate }}
              <input type="password" class="sc-input" formControlName="password" autocomplete="current-password" />
            </label>

            @if (errorMsg()) {
              <div class="err">{{ errorMsg() }}</div>
            }

            <div class="actions">
              <button type="submit" class="sc-btn sc-btn-primary" [disabled]="busy() || form.invalid">
                {{ 'auth.signIn' | translate }}
              </button>
            </div>
          </form>

          <div class="sep"><span>{{ 'auth.or' | translate }}</span></div>

          <button type="button" class="sc-btn google" (click)="signInWithGoogle()" [disabled]="busy()">
            {{ 'auth.continueGoogle' | translate }}
          </button>

          <p class="invite-only">{{ 'auth.inviteOnly' | translate }}</p>

          <!-- Trust links: a bare credential form with no self-description is a
               phishing-heuristic trigger for AV URL scanners — keep these visible
               on the login card itself, not only in the footer. -->
          <nav class="trust-links" [attr.aria-label]="'footer.legalNav' | translate">
            <a routerLink="/about">{{ 'footer.links.about' | translate }}</a>
            <span aria-hidden="true">·</span>
            <a routerLink="/legal/privacy">{{ 'footer.links.privacy' | translate }}</a>
            <span aria-hidden="true">·</span>
            <a routerLink="/legal/imprint">{{ 'footer.links.imprint' | translate }}</a>
          </nav>
        </div>
      </main>

      <sc-footer />
    </div>
  `,
  styles: [`
    .login-shell {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    .login-page {
      flex: 1;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .login-card { width: 100%; max-width: 420px; }
    .notice {
      margin-bottom: 18px;
      padding: 10px 14px;
      border-radius: 4px;
      font-size: 0.85rem;
      line-height: 1.45;
    }
    .notice.denied {
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid var(--sc-warning);
      color: var(--sc-warning);
    }
    .invite-only {
      margin: 20px 0 0;
      text-align: center;
      color: var(--sc-fg-2);
      font-size: 0.78rem;
      line-height: 1.45;
    }
    .trust-links {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 14px;
      font-size: 0.72rem;
      color: var(--sc-fg-2);
    }
    .trust-links a {
      color: var(--sc-fg-2);
      text-decoration: none;
      transition: color 0.16s ease;
    }
    .trust-links a:hover { color: var(--sc-accent); }
    h1 {
      text-align: center;
      font-size: 2rem;
      background: linear-gradient(90deg, var(--sc-accent), var(--sc-accent-hot));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .tag {
      text-align: center;
      color: var(--sc-fg-2);
      margin-bottom: 28px;
      font-size: 0.9rem;
    }
    label {
      display: block;
      margin-bottom: 14px;
      color: var(--sc-fg-1);
      font-size: 0.85rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    label .sc-input { margin-top: 6px; }
    .actions {
      display: flex;
      gap: 10px;
      margin-top: 18px;
      flex-wrap: wrap;
    }
    .actions .sc-btn { flex: 1; justify-content: center; }
    .err {
      margin-top: 12px;
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
      font-size: 0.85rem;
    }
    .sep {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 22px 0;
      color: var(--sc-fg-2);
      font-size: 0.75rem;
      letter-spacing: 0.1em;
    }
    .sep::before, .sep::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--sc-border);
    }
    .google { width: 100%; justify-content: center; }
  `],
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly posthog = inject(PostHogService);

  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  /** Set when the approvedGuard bounced an un-invited account back here. */
  readonly denied = signal(this.route.snapshot.queryParamMap.get('denied') === 'invite');

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  /**
   * Read the `?redirect=…` query param the auth guard set when bouncing
   * an unauthenticated user. Only same-origin absolute paths are honored
   * (must start with `/`); anything else falls back to `/news` to prevent
   * open-redirect attacks via crafted login links.
   */
  private safeRedirectTarget(): string {
    const raw = this.route.snapshot.queryParamMap.get('redirect');
    if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return '/news';
  }

  async onSubmit() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    const { email, password } = this.form.getRawValue();
    try {
      const { error } = await this.auth.signInWithPassword(email, password);
      if (error) {
        this.errorMsg.set(error.message);
      } else {
        this.posthog.posthog.capture('user_signed_in', { provider: 'email' });
        // navigateByUrl handles path + query string in one call
        // (router.navigate(['/path?q=1']) treats the whole thing as a single segment).
        await this.router.navigateByUrl(this.safeRedirectTarget());
      }
    } catch (err) {
      this.errorMsg.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async signInWithGoogle() {
    this.busy.set(true);
    this.errorMsg.set(null);
    let target = this.safeRedirectTarget();
    // Supabase's URL allowlist matches the full redirect URL — entries
    // configured without explicit wildcards reject query strings on the
    // OAuth callback ("Invalid redirect URL"). Stash any query string,
    // pass the bare path to the provider, and let the destination route
    // (currently only /uploader/auth) restore cb/state from sessionStorage.
    const qIdx = target.indexOf('?');
    if (qIdx !== -1) {
      try {
        sessionStorage.setItem('sc.oauth-redirect-qs', JSON.stringify({
          path: target.slice(0, qIdx),
          qs: target.slice(qIdx + 1),
        }));
      } catch { /* private mode / disabled storage — fall back to URL */ }
      target = target.slice(0, qIdx);
    }
    const { error } = await this.auth.signInWithGoogle(target);
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
    } else {
      this.posthog.posthog.capture('user_signed_in_with_google', { provider: 'google' });
    }
  }
}
