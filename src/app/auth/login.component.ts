import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { AccessRequestService } from './access-request.service';
import { AnalyticsService } from '../core/analytics.service';

/** Which panel the landing card currently shows. */
type Panel = 'signIn' | 'apply';

@Component({
  selector: 'sc-login',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
      The signed-out landing page (feedback 56f328ea). It is the first thing
      an uninvited visitor sees, so it says what this is (logo + name + one
      line), invites them in ("Join the club") and — since access is
      invite-only — gives them a way to ask for an invite instead of a dead
      end. Sized to fit a laptop viewport without scrolling; it falls back to
      normal scrolling on short/small screens rather than clipping content.
    -->
    <div class="landing">
      <main class="landing-main">
        <div class="landing-grid">
          <section class="hero">
            <div class="brand">
              <img src="icons/scc-favicon.svg" alt="" width="56" height="56" class="brand-logo" />
              <h1>{{ 'auth.landing.appName' | translate }}</h1>
            </div>
            <p class="tag">{{ 'auth.tagline' | translate }}</p>

            <p class="join">{{ 'auth.landing.join' | translate }}</p>
            <p class="pitch">{{ 'auth.landing.pitch' | translate }}</p>

            <ul class="perks">
              <li>{{ 'auth.landing.perks.hangar' | translate }}</li>
              <li>{{ 'auth.landing.perks.codex' | translate }}</li>
              <li>{{ 'auth.landing.perks.verse' | translate }}</li>
            </ul>

            @if (panel() === 'signIn') {
              <button type="button" class="sc-btn sc-btn-primary hero-cta" (click)="showApply()">
                {{ 'auth.landing.applyCta' | translate }}
              </button>
            } @else {
              <button type="button" class="sc-btn hero-cta" (click)="showSignIn()">
                {{ 'auth.landing.backToSignIn' | translate }}
              </button>
            }
          </section>

          <div class="sc-card login-card">
            @if (panel() === 'signIn') {
              <h2>{{ 'auth.signIn' | translate }}</h2>

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

              <p class="invite-only">
                {{ 'auth.inviteOnly' | translate }}
                <button type="button" class="linkish" (click)="showApply()">
                  {{ 'auth.landing.applyInline' | translate }}
                </button>
              </p>
            } @else {
              <h2>{{ 'auth.apply.title' | translate }}</h2>

              @if (applyDone()) {
                <div class="notice sent" role="status">{{ 'auth.apply.sent' | translate }}</div>
                <button type="button" class="sc-btn back-btn" (click)="showSignIn()">
                  {{ 'auth.landing.backToSignIn' | translate }}
                </button>
              } @else {
                <p class="apply-hint">{{ 'auth.apply.hint' | translate }}</p>

                <form [formGroup]="applyForm" (ngSubmit)="onApply()" novalidate>
                  <label>
                    {{ 'auth.email' | translate }}
                    <input type="email" class="sc-input" formControlName="email" autocomplete="email" />
                  </label>

                  <label>
                    {{ 'auth.apply.handle' | translate }}
                    <input type="text" class="sc-input" formControlName="handle" autocomplete="nickname"
                           [placeholder]="'auth.apply.handlePlaceholder' | translate" />
                  </label>

                  <label>
                    {{ 'auth.apply.message' | translate }}
                    <textarea class="sc-input" formControlName="message" rows="3"
                              [placeholder]="'auth.apply.messagePlaceholder' | translate"></textarea>
                  </label>

                  @if (applyError()) {
                    <div class="err">{{ applyError() }}</div>
                  }

                  <div class="actions">
                    <button type="submit" class="sc-btn sc-btn-primary"
                            [disabled]="applyBusy() || applyForm.invalid">
                      {{ applyBusy() ? ('auth.apply.sending' | translate) : ('auth.apply.send' | translate) }}
                    </button>
                  </div>
                </form>
              }
            }

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
        </div>
      </main>
    </div>
  `,
  styles: [`
    /* One viewport, no scrolling — the page is a single screen by design.
       min-height (not height) plus the short-viewport media query below keeps
       it honest on small screens instead of clipping the form. */
    .landing {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
    }
    .landing-main {
      flex: 1;
      display: grid;
      place-items: center;
      padding: clamp(16px, 4vh, 40px) 24px;
    }
    .landing-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 420px);
      gap: clamp(24px, 5vw, 64px);
      align-items: center;
      width: 100%;
      max-width: 1000px;
    }
    .hero { min-width: 0; }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-logo { flex: none; }
    h1 {
      margin: 0;
      font-size: clamp(1.7rem, 4vw, 2.6rem);
      line-height: 1.1;
      background: linear-gradient(90deg, var(--sc-accent), var(--sc-accent-hot));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .tag {
      margin: 10px 0 0;
      color: var(--sc-fg-2);
      font-size: 0.95rem;
    }
    .join {
      margin: clamp(14px, 3vh, 28px) 0 0;
      font-size: clamp(1.1rem, 2.4vw, 1.5rem);
      font-weight: 600;
      color: var(--sc-fg-0);
      letter-spacing: 0.01em;
    }
    .pitch {
      margin: 8px 0 0;
      color: var(--sc-fg-1);
      font-size: 0.92rem;
      line-height: 1.5;
      max-width: 46ch;
    }
    .perks {
      margin: 16px 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 6px;
      color: var(--sc-fg-2);
      font-size: 0.88rem;
    }
    .perks li { display: flex; gap: 8px; align-items: baseline; }
    .perks li::before {
      content: '▸';
      color: var(--sc-accent);
      flex: none;
    }
    .hero-cta { margin-top: clamp(16px, 3vh, 26px); }
    .login-card { width: 100%; }
    .login-card h2 {
      margin: 0 0 16px;
      font-size: 1.1rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--sc-fg-1);
    }
    .apply-hint {
      margin: 0 0 16px;
      color: var(--sc-fg-2);
      font-size: max(0.82rem, var(--sc-fs-floor));
      line-height: 1.45;
    }
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
    .notice.sent {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid var(--sc-success);
      color: var(--sc-success);
    }
    .back-btn { width: 100%; justify-content: center; }
    .invite-only {
      margin: 18px 0 0;
      text-align: center;
      color: var(--sc-fg-2);
      font-size: max(0.78rem, var(--sc-fs-floor));
      line-height: 1.45;
    }
    /* An in-place panel switch is an action, not a navigation — button, styled
       as a link (CLAUDE.md: anchors are for things that take you somewhere). */
    .linkish {
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      color: var(--sc-accent);
      cursor: pointer;
      text-decoration: underline;
    }
    .linkish:hover { color: var(--sc-accent-hot); }
    .trust-links {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 14px;
      font-size: max(0.72rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
    }
    .trust-links a {
      color: var(--sc-fg-2);
      text-decoration: none;
      transition: color 0.16s ease;
    }
    .trust-links a:hover { color: var(--sc-accent); }
    label {
      display: block;
      margin-bottom: 14px;
      color: var(--sc-fg-1);
      font-size: 0.85rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    label .sc-input { margin-top: 6px; }
    textarea.sc-input { resize: vertical; min-height: 68px; }
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
      margin: 20px 0;
      color: var(--sc-fg-2);
      font-size: max(0.75rem, var(--sc-fs-floor));
      letter-spacing: 0.1em;
    }
    .sep::before, .sep::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--sc-border);
    }
    .google { width: 100%; justify-content: center; }

    /* Stacked layout: brand first — the point of the page is that a visitor
       knows what this is before anything else. The prose is what gives way so
       the sign-in form still lands above the fold on a phone. */
    @media (max-width: 860px) {
      .landing-grid {
        grid-template-columns: minmax(0, 420px);
        justify-content: center;
        gap: 20px;
      }
      .hero { text-align: center; }
      .brand { justify-content: center; }
      .brand-logo { width: 44px; height: 44px; }
      .tag { margin-top: 6px; }
      .join { margin-top: 12px; }
      .pitch, .perks { display: none; }
      .hero-cta { width: 100%; justify-content: center; margin-top: 14px; }
    }
    /* Short viewports (and the stacked layout) simply scroll — clipping the
       password field to protect a "no scrolling" rule would be worse. */
    @media (max-height: 640px) {
      .perks { display: none; }
    }
  `],
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly analytics = inject(AnalyticsService);
  private readonly accessRequests = inject(AccessRequestService);
  private readonly translate = inject(TranslateService);

  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  /** Set when the approvedGuard bounced an un-invited account back here. */
  readonly denied = signal(this.route.snapshot.queryParamMap.get('denied') === 'invite');

  /**
   * Which half of the card is showing. A bounced-back visitor (`?denied=invite`)
   * has just been told the site is invite-only — but the sign-in panel still
   * leads, so they can retry with the right account before applying.
   */
  readonly panel = signal<Panel>('signIn');

  readonly applyBusy = signal(false);
  readonly applyDone = signal(false);
  readonly applyError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  readonly applyForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    handle: [''],
    message: [''],
  });

  showApply(): void {
    this.panel.set('apply');
    this.applyError.set(null);
    // Carry over whatever they already typed in the sign-in form.
    const typed = this.form.getRawValue().email;
    if (typed && !this.applyForm.getRawValue().email) {
      this.applyForm.patchValue({ email: typed });
    }
  }

  showSignIn(): void {
    this.panel.set('signIn');
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
      const { error } = await this.auth.signInWithPassword(email, password);
      if (error) {
        this.errorMsg.set(error.message);
      } else {
        this.analytics.capture('user_signed_in', { provider: 'email' });
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

  /**
   * File an invite application. A duplicate is reported as success on
   * purpose — see `AccessRequestService`: confirming that an application for
   * a given address already exists would make the form an oracle.
   */
  async onApply() {
    if (this.applyForm.invalid) return;
    this.applyBusy.set(true);
    this.applyError.set(null);
    const { email, handle, message } = this.applyForm.getRawValue();
    const result = await this.accessRequests.submit({ email, handle, message });
    this.applyBusy.set(false);

    if (result.kind === 'ok' || result.kind === 'duplicate') {
      this.applyDone.set(true);
      this.analytics.capture('access_requested', { duplicate: result.kind === 'duplicate' });
      return;
    }
    this.applyError.set(
      result.kind === 'rate-limited'
        ? this.translate.instant('auth.apply.rateLimited')
        : result.message,
    );
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
      this.analytics.capture('user_signed_in_with_google', { provider: 'google' });
    }
  }
}
