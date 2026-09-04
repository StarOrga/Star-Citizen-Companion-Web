import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from './auth.service';

/** Mirrors the project's Supabase minimum; the sign-in form uses the same 8. */
const MIN_LENGTH = 8;

/**
 * "Choose a password" — the one form behind both entry points that need it:
 * the `/set-password` page an invite or reset mail lands on, and the account
 * section in Settings.
 *
 * It never receives, shows or stores a password anybody else picked: the user
 * types their own and it goes straight to `auth.updateUser()`. That is the
 * whole point — an invited account otherwise has NO password its owner could
 * know, which makes the second visit impossible.
 */
@Component({
  selector: 'sc-password-form',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="pw-form" (submit)="submit($event)" novalidate>
      <label class="field">
        <span class="label">{{ 'auth.setPassword.newPassword' | translate }}</span>
        <input
          type="password"
          class="sc-input"
          autocomplete="new-password"
          [value]="password()"
          (input)="password.set(asInput($event))"
          [attr.aria-label]="'auth.setPassword.newPassword' | translate"
          [disabled]="busy()"
          required />
      </label>

      <label class="field">
        <span class="label">{{ 'auth.setPassword.repeatPassword' | translate }}</span>
        <input
          type="password"
          class="sc-input"
          autocomplete="new-password"
          [value]="confirm()"
          (input)="confirm.set(asInput($event))"
          [attr.aria-label]="'auth.setPassword.repeatPassword' | translate"
          [disabled]="busy()"
          required />
      </label>

      <p class="hint">{{ 'auth.setPassword.rule' | translate: { min: minLength } }}</p>

      @if (error(); as e) {
        <div class="flash error" role="alert">{{ e }}</div>
      }
      @if (done()) {
        <div class="flash success" role="status">{{ 'auth.setPassword.saved' | translate }}</div>
      }

      <button type="submit" class="sc-btn sc-btn-primary" [disabled]="busy() || !valid()">
        {{ (busy() ? 'auth.setPassword.saving' : submitLabelKey()) | translate }}
      </button>
    </form>
  `,
  styles: [`
    .pw-form { display: flex; flex-direction: column; gap: 12px; align-items: stretch; }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .field .label { color: var(--sc-fg-1); font-size: max(0.8rem, var(--sc-fs-floor)); }
    .field input { min-height: 44px; }
    .hint { margin: 0; color: var(--sc-fg-2); font-size: max(0.75rem, var(--sc-fs-floor)); }
    .flash { padding: 8px 12px; border-radius: 4px; font-size: 0.84rem; }
    .flash.success { background: rgba(74, 222, 128, 0.1); border: 1px solid var(--sc-success); color: var(--sc-success); }
    .flash.error { background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger); }
    .pw-form .sc-btn { align-self: flex-start; justify-content: center; min-height: 44px; }
    @media (max-width: 640px) {
      .pw-form .sc-btn { align-self: stretch; }
    }
  `],
})
export class PasswordFormComponent {
  private readonly auth = inject(AuthService);

  /** i18n key for the submit button in its idle state. */
  readonly submitLabelKey = input('auth.setPassword.submit');

  /** Fired after Supabase accepted the new password. */
  readonly saved = output<void>();

  readonly minLength = MIN_LENGTH;
  readonly password = signal('');
  readonly confirm = signal('');
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);

  readonly valid = computed(
    () => this.password().length >= MIN_LENGTH && this.password() === this.confirm(),
  );

  asInput(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  async submit(e: Event): Promise<void> {
    e.preventDefault();
    if (this.busy() || !this.valid()) return;
    this.busy.set(true);
    this.error.set(null);
    this.done.set(false);
    try {
      const { error } = await this.auth.updatePassword(this.password());
      if (error) {
        this.error.set(error.message);
        return;
      }
      // Clear both fields on success — nothing keeps a password in memory for
      // longer than the request that sets it.
      this.password.set('');
      this.confirm.set('');
      this.done.set(true);
      this.saved.emit();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
