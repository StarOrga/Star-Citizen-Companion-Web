import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { capturedAuthLinkType } from './auth-link';
import { AuthService } from './auth.service';
import { PasswordFormComponent } from './password-form.component';

/**
 * Where an invite mail and a password-reset mail land.
 *
 * THE GAP THIS CLOSES (feedback d93ddb05)
 * Accepting an access request calls `invite-user` with `sendInvite: true`, so
 * Supabase does send the applicant a mail — but its link used to drop them on
 * the news feed, signed in, with no password anyone had ever chosen. Nothing
 * on screen said so, and the app had no way to set one, so the moment that
 * session ended the account was unreachable (unless the address happened to
 * work with Google sign-in). This page is the missing step: it takes the
 * session the link hands over and turns it into a password the OWNER picked.
 *
 * Deliberately on the ungated public layout: it must render for a session
 * that has not been approved yet, and for no session at all (an expired or
 * already-used link), where it offers a fresh mail instead of a dead end.
 */
@Component({
  selector: 'sc-set-password',
  standalone: true,
  imports: [PasswordFormComponent, RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="wrap">
      <div class="sc-card card">
        <h1>{{ (fromInvite() ? 'auth.setPassword.inviteTitle' : 'auth.setPassword.title') | translate }}</h1>

        @if (!auth.ready()) {
          <p class="lead">{{ 'auth.setPassword.checking' | translate }}</p>
        } @else if (auth.realUser(); as user) {
          <p class="lead">
            {{ (fromInvite() ? 'auth.setPassword.inviteLead' : 'auth.setPassword.lead') | translate }}
          </p>
          <p class="who">{{ 'auth.email' | translate }}: <strong>{{ user.email }}</strong></p>

          @if (saved()) {
            <div class="flash success" role="status">{{ 'auth.setPassword.savedLead' | translate }}</div>
            <a routerLink="/news" class="sc-btn sc-btn-primary continue">
              {{ 'auth.setPassword.continue' | translate }}
            </a>
          } @else {
            <sc-password-form (saved)="saved.set(true)" />
          }
        } @else {
          <!-- No session: the link was already used, or it expired. Supabase
               answers a reset request identically for a known and an unknown
               address, so this stays a generic confirmation — it must not
               become an "is this address a member?" oracle. -->
          <p class="lead">{{ 'auth.setPassword.expired' | translate }}</p>

          @if (resentTo()) {
            <div class="flash success" role="status">{{ 'auth.setPassword.resent' | translate }}</div>
          } @else {
            <form class="resend" (submit)="resend($event)" novalidate>
              <label class="field">
                <span class="label">{{ 'auth.email' | translate }}</span>
                <input
                  type="email"
                  class="sc-input"
                  autocomplete="email"
                  [value]="email()"
                  (input)="email.set(asInput($event))"
                  [attr.aria-label]="'auth.email' | translate"
                  [disabled]="resending()"
                  required />
              </label>
              @if (resendError(); as e) {
                <div class="flash error" role="alert">{{ e }}</div>
              }
              <button type="submit" class="sc-btn sc-btn-primary" [disabled]="resending() || !emailLooksValid()">
                {{ (resending() ? 'auth.setPassword.sending' : 'auth.setPassword.sendLink') | translate }}
              </button>
            </form>
          }

          <p class="back">
            <a routerLink="/login">{{ 'auth.landing.backToSignIn' | translate }}</a>
          </p>
        }
      </div>
    </section>
  `,
  styles: [`
    .wrap { display: flex; justify-content: center; padding: clamp(12px, 4vh, 40px) 0; }
    .card { width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: 14px; }
    h1 { margin: 0; font-family: var(--sc-font-display); font-size: 1.3rem; letter-spacing: 0.04em; }
    .lead { margin: 0; color: var(--sc-fg-1); font-size: 0.9rem; line-height: 1.5; }
    .who { margin: 0; color: var(--sc-fg-2); font-size: 0.85rem; overflow-wrap: anywhere; }
    .resend { display: flex; flex-direction: column; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .field .label { color: var(--sc-fg-1); font-size: max(0.8rem, var(--sc-fs-floor)); }
    .field input { min-height: 44px; }
    .flash { padding: 8px 12px; border-radius: 4px; font-size: 0.84rem; }
    .flash.success { background: rgba(74, 222, 128, 0.1); border: 1px solid var(--sc-success); color: var(--sc-success); }
    .flash.error { background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger); }
    .resend .sc-btn, .continue { align-self: flex-start; justify-content: center; min-height: 44px; text-decoration: none; }
    .back { margin: 0; font-size: 0.85rem; }
    .back a { color: var(--sc-accent); }
    @media (max-width: 640px) {
      .resend .sc-btn, .continue { align-self: stretch; }
    }
  `],
})
export class SetPasswordComponent {
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  /**
   * `?via=invite`, read reactively: AuthService appends it AFTER this page may
   * already be on screen (the invite mail can link straight here), so a
   * one-shot snapshot would miss it. The URL snapshot from main.ts is the
   * second, independent source — it is what AuthService derives `via` from.
   */
  private readonly via = toSignal(this.route.queryParamMap, { initialValue: null });
  readonly fromInvite = computed(
    () => this.via()?.get('via') === 'invite' || capturedAuthLinkType() === 'invite',
  );

  readonly saved = signal(false);
  readonly email = signal('');
  readonly resending = signal(false);
  readonly resentTo = signal(false);
  readonly resendError = signal<string | null>(null);

  readonly emailLooksValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim()));

  asInput(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  async resend(e: Event): Promise<void> {
    e.preventDefault();
    if (this.resending() || !this.emailLooksValid()) return;
    this.resending.set(true);
    this.resendError.set(null);
    try {
      const { error } = await this.auth.sendPasswordReset(this.email());
      // A rate limit is the one failure worth showing; anything else stays
      // generic so the form never reports whether the address exists.
      if (error && error.status === 429) {
        this.resendError.set(error.message);
        return;
      }
      this.resentTo.set(true);
    } catch (err) {
      this.resendError.set((err as Error).message);
    } finally {
      this.resending.set(false);
    }
  }
}
