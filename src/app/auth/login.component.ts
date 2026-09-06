import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { AccessRequestService } from './access-request.service';
import { ImpersonationService } from './impersonation.service';
import { AnalyticsService } from '../core/analytics.service';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { safeRedirectTarget } from '../core/safe-redirect.util';
import { AccountStatusService } from '../social/account-status.service';

/** Which panel the landing card currently shows. */
type Panel = 'signIn' | 'apply' | 'reset';

@Component({
  selector: 'sc-login',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, RouterLink, ScDatePipe],
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
              <img src="icons/brand/scc-mark.svg" alt="" width="64" height="64" class="brand-logo" />
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

              <!--
                A suspended account (feedback cf0ddf7d phase 2) may still
                authenticate — deliberately, see suspend_user() — so that it
                gets told WHY instead of a generic auth failure. The guard
                drops the session again immediately and lands here. The reason
                is the admin's free text: interpolated, never bound as HTML.
              -->
              @if (suspended()) {
                <div class="notice suspended" role="alert">
                  <p class="suspended__title">{{ 'auth.suspended.title' | translate }}</p>
                  @if (suspensionReason(); as why) {
                    <p class="suspended__reason">{{ why }}</p>
                  }
                  <p class="suspended__body">
                    @if (suspendedUntil(); as until) {
                      {{ 'auth.suspended.until' | translate: { date: (until | scDate: 'datetime') } }}
                    } @else {
                      {{ 'auth.suspended.indefinite' | translate }}
                    }
                  </p>
                </div>
              }

              @if (previewLocked()) {
                <!--
                  Defect B: while previewing as the signed-out visitor, auth.isAuthenticated()
                  is shadowed to false (see auth.service.ts), so authGuard bounces every
                  private route right back here even after a REAL, successful sign-in — the
                  form would just silently reset in a loop with no explanation. The page
                  itself still renders exactly as a visitor sees it (that fidelity is the
                  point of the preview); only the sign-in ATTEMPT is refused, with a way out.
                -->
                <div class="notice preview-locked" role="status">
                  <p class="preview-locked__title">{{ 'auth.previewLocked.title' | translate }}</p>
                  <p class="preview-locked__body">{{ 'auth.previewLocked.body' | translate }}</p>
                  <button type="button" class="sc-btn sc-btn-primary" (click)="leavePreview()">
                    {{ 'auth.previewLocked.exit' | translate }}
                  </button>
                </div>
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
                  <!-- An action (it sends a mail), not a navigation — stays a
                       <button>. Invited accounts start WITHOUT a password, so
                       this is the way back in, not just a "forgot" case. -->
                  <button type="button" class="linkish forgot" (click)="showReset()">
                    {{ 'auth.forgotPassword' | translate }}
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
            } @else if (panel() === 'reset') {
              <h2>{{ 'auth.reset.title' | translate }}</h2>

              @if (resetDone()) {
                <div class="notice sent" role="status">{{ 'auth.reset.sent' | translate }}</div>
                <button type="button" class="sc-btn back-btn" (click)="showSignIn()">
                  {{ 'auth.landing.backToSignIn' | translate }}
                </button>
              } @else {
                <p class="apply-hint">{{ 'auth.reset.hint' | translate }}</p>

                <form [formGroup]="resetForm" (ngSubmit)="onReset()" novalidate>
                  <label>
                    {{ 'auth.email' | translate }}
                    <input type="email" class="sc-input" formControlName="email" autocomplete="email" />
                  </label>

                  @if (resetError()) {
                    <div class="err">{{ resetError() }}</div>
                  }

                  <div class="actions">
                    <button type="submit" class="sc-btn sc-btn-primary"
                            [disabled]="resetBusy() || resetForm.invalid">
                      {{ (resetBusy() ? 'auth.reset.sending' : 'auth.reset.send') | translate }}
                    </button>
                    <button type="button" class="linkish" (click)="showSignIn()">
                      {{ 'auth.landing.backToSignIn' | translate }}
                    </button>
                  </div>
                </form>
              }
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
    /* --sc-danger, not --sc-accent-hot: this is an error state shown to the
       affected user, not an elevated-access surface. */
    .notice.suspended {
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-fg-0);
    }
    .suspended__title {
      margin: 0 0 6px;
      font-weight: 600;
      color: var(--sc-danger);
    }
    .suspended__reason {
      margin: 0 0 6px;
      overflow-wrap: anywhere;
    }
    .suspended__body { margin: 0; color: var(--sc-fg-2); }
    .notice.sent {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid var(--sc-success);
      color: var(--sc-success);
    }
    .notice.preview-locked {
      background: rgba(0, 212, 255, 0.08);
      border: 1px solid var(--sc-accent);
      color: var(--sc-fg-0);
    }
    .preview-locked__title {
      margin: 0 0 4px;
      font-weight: 600;
    }
    .preview-locked__body {
      margin: 0 0 12px;
      color: var(--sc-fg-2);
    }
    .notice.preview-locked .sc-btn { width: 100%; justify-content: center; }
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
    /* Brighten the normal accent rather than shifting to the hot one — the
       login page is the most public surface there is, and the hot accent is
       reserved for admin-only affordances (admin feedback b8b31f24). */
    .linkish:hover { color: color-mix(in srgb, var(--sc-accent) 78%, #fff); }
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
    /* The link-styled buttons in an action row centre against the primary
       button instead of stretching like one. */
    .actions .linkish {
      flex: 0 0 auto;
      align-self: center;
      font-size: max(0.8rem, var(--sc-fs-floor));
      min-height: 44px;
    }
    .actions .linkish.forgot { margin-inline-start: auto; }
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
      .brand-logo { width: 48px; height: 48px; }
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
  private readonly imp = inject(ImpersonationService);
  private readonly account = inject(AccountStatusService);

  /**
   * True while previewing as the signed-out visitor (defect B). Only `'anon'`
   * matters here — it is the sole preview value that shadows
   * `auth.isAuthenticated()` (see auth.service.ts's `session`/`user`
   * projections); a `'viewer'`/`'collaborator'` preview never blocks a real
   * sign-in. Deliberately NOT auto-exited on load — a visitor preview
   * rendering `/login` exactly as a real visitor sees it is the entire point
   * of the feature. Only the sign-in attempt itself is refused.
   */
  readonly previewLocked = computed(() => this.imp.viewAs() === 'anon');

  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  /** Set when the approvedGuard bounced an un-invited account back here. */
  readonly denied = signal(this.route.snapshot.queryParamMap.get('denied') === 'invite');

  /**
   * Set when the approvedGuard dropped a SUSPENDED session back here
   * (`?denied=suspended`, feedback cf0ddf7d phase 2). The query param is only
   * the trigger — the reason itself is never put in the URL; it is read from
   * the in-memory notice the guard left behind, which is why it disappears on
   * a reload and the generic wording below carries the rest.
   */
  private readonly deniedSuspended =
    this.route.snapshot.queryParamMap.get('denied') === 'suspended';
  readonly suspended = computed(
    () =>
      this.deniedSuspended ||
      // Not only the query param: the eject can come from the shell's
      // AccountNoticeComponent (a suspension that lands mid-session), whose
      // imperative navigation can lose a race with the guard's own UrlTree
      // and drop the param. The in-memory notice is the more reliable
      // signal, and it is set on every eject path.
      this.account.suspensionNotice() !== null,
  );
  readonly suspensionReason = computed(() => this.account.suspensionNotice()?.reason ?? null);
  readonly suspendedUntil = computed(() => this.account.suspensionNotice()?.until ?? null);

  /**
   * Which half of the card is showing. A bounced-back visitor (`?denied=invite`)
   * has just been told the site is invite-only — but the sign-in panel still
   * leads, so they can retry with the right account before applying.
   */
  readonly panel = signal<Panel>('signIn');

  readonly applyBusy = signal(false);
  readonly applyDone = signal(false);
  readonly applyError = signal<string | null>(null);

  readonly resetBusy = signal(false);
  readonly resetDone = signal(false);
  readonly resetError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  readonly applyForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    handle: [''],
    message: [''],
  });

  readonly resetForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
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

  showReset(): void {
    this.panel.set('reset');
    this.resetError.set(null);
    const typed = this.form.getRawValue().email;
    if (typed && !this.resetForm.getRawValue().email) {
      this.resetForm.patchValue({ email: typed });
    }
  }

  /**
   * Mail a password link. The confirmation is the SAME whether or not the
   * address has an account — Supabase answers identically on purpose, and
   * echoing "no such user" here would turn the login card into a membership
   * oracle (same rule as the apply form's duplicate handling).
   */
  async onReset() {
    if (this.resetForm.invalid) return;
    this.resetBusy.set(true);
    this.resetError.set(null);
    try {
      const { error } = await this.auth.sendPasswordReset(this.resetForm.getRawValue().email);
      if (error && error.status === 429) {
        this.resetError.set(error.message);
        return;
      }
      this.resetDone.set(true);
    } catch (err) {
      this.resetError.set((err as Error).message);
    } finally {
      this.resetBusy.set(false);
    }
  }

  /**
   * Read the `?redirect=…` query param the auth guard set when bouncing
   * an unauthenticated user. Delegates the open-redirect check to the
   * shared `safeRedirectTarget()` util — `publicOnlyGuard` reuses the exact
   * same check for the "exit an impersonation preview" flow (Defect B).
   */
  private safeRedirectTarget(): string {
    return safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirect'));
  }

  /** Reuses `ImpersonationService.exit()` — the only sanctioned way out of a preview. */
  leavePreview(): void {
    this.imp.exit();
  }

  async onSubmit() {
    if (this.form.invalid) return;
    if (this.previewLocked()) {
      // Defect B: signInWithPassword would succeed against the real client,
      // but navigateByUrl would still be bounced by authGuard back to /login
      // (viewAs() === 'anon' shadows isAuthenticated()) — a silent loop with
      // no feedback. Refuse before attempting it at all.
      this.errorMsg.set(this.translate.instant('auth.previewLocked.body'));
      return;
    }
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
    if (this.previewLocked()) {
      // Same reasoning as onSubmit(): sc.viewAs is sessionStorage, so it
      // survives the OAuth round trip and would loop back to /login too.
      this.errorMsg.set(this.translate.instant('auth.previewLocked.body'));
      return;
    }
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
