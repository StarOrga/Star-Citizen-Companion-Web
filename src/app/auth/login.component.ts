import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from './auth.service';

@Component({
  selector: 'sc-login',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="login-page">
      <div class="sc-card login-card">
        <h1>SC Companion</h1>
        <p class="tag">{{ 'auth.tagline' | translate }}</p>

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
              @if (mode() === 'signin') {
                {{ 'auth.signIn' | translate }}
              } @else {
                {{ 'auth.signUp' | translate }}
              }
            </button>
            <button type="button" class="sc-btn" (click)="toggleMode()" [disabled]="busy()">
              @if (mode() === 'signin') {
                {{ 'auth.needAccount' | translate }}
              } @else {
                {{ 'auth.haveAccount' | translate }}
              }
            </button>
          </div>
        </form>

        <div class="sep"><span>{{ 'auth.or' | translate }}</span></div>

        <button type="button" class="sc-btn google" (click)="signInWithGoogle()" [disabled]="busy()">
          {{ 'auth.continueGoogle' | translate }}
        </button>
      </div>
    </main>
  `,
  styles: [`
    .login-page {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .login-card { width: 100%; max-width: 420px; }
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

  readonly mode = signal<'signin' | 'signup'>('signin');
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  toggleMode() {
    this.mode.update((m) => (m === 'signin' ? 'signup' : 'signin'));
    this.errorMsg.set(null);
  }

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
      const fn = this.mode() === 'signin'
        ? this.auth.signInWithPassword(email, password)
        : this.auth.signUp(email, password);
      const { error } = await fn;
      if (error) {
        this.errorMsg.set(error.message);
      } else {
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
    const { error } = await this.auth.signInWithGoogle(this.safeRedirectTarget());
    if (error) {
      this.errorMsg.set(error.message);
      this.busy.set(false);
    }
  }
}
