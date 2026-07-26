import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { ProfileService } from '../auth/profile.service';
import { RoleService } from '../auth/role.service';
import { ComposerPrefsService } from '../core/composer-prefs.service';
import { ConsentService } from '../core/consent.service';
import { AnalyticsService } from '../core/analytics.service';
import { SupabaseClientProvider } from '../core/supabase.client';

// Only languages with a real translation file are offered (issue #23) — the
// other locale files are machine-stub placeholders; offering them silently
// fell back to English, which read as "translation exists but is broken".
type LangId = 'de' | 'en';

@Component({
  selector: 'sc-settings',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ 'settings.title' | translate }}</h1>

      <!-- 1. Account info (read-only) -->
      @if (auth.user(); as user) {
        <div class="sc-card">
          <div class="row">
            <span class="label">{{ 'profile.username' | translate }}</span>
            <span class="value">
              @if (profile.username(); as name) {
                {{ name }}
              } @else {
                <span class="muted">{{ 'profile.usernameUnset' | translate }}</span>
              }
            </span>
          </div>
          <div class="row">
            <span class="label">{{ 'profile.email' | translate }}</span>
            <span class="value">{{ user.email }}</span>
          </div>
          <div class="row">
            <span class="label">{{ 'profile.role' | translate }}</span>
            <span class="value">
              <span class="role-pill" [class]="roles.role() ?? 'viewer'">
                {{ ('profile.roles.' + (roles.role() ?? 'viewer')) | translate }}
              </span>
            </span>
          </div>
          <div class="row">
            <span class="label">{{ 'profile.id' | translate }}</span>
            <span class="value mono">{{ user.id }}</span>
          </div>
          <div class="row">
            <span class="label">{{ 'profile.provider' | translate }}</span>
            <span class="value">{{ user.app_metadata['provider'] ?? 'email' }}</span>
          </div>
          <div class="row">
            <span class="label">{{ 'profile.created' | translate }}</span>
            <span class="value">{{ user.created_at }}</span>
          </div>
        </div>
      }

      <!-- 2. Username -->
      <div class="sc-card section">
        <h2>{{ 'settings.username.title' | translate }}</h2>
        <p class="hint">{{ 'settings.username.hint' | translate }}</p>
        <form class="field-row" (submit)="saveUsername($event)">
          <input
            type="text"
            class="text-input"
            [value]="usernameInput()"
            (input)="usernameInput.set(asInput($event))"
            [placeholder]="'settings.username.placeholder' | translate"
            [disabled]="usernameSaving()"
            maxlength="20"
            autocomplete="off"
            spellcheck="false" />
          <button
            type="submit"
            class="sc-btn sc-btn-primary"
            [disabled]="usernameSaving() || !usernameDirty()">
            {{ (usernameSaving() ? 'settings.username.saving' : 'settings.username.save') | translate }}
          </button>
        </form>
        @if (usernameOk()) {
          <div class="flash success">{{ 'settings.username.saved' | translate }}</div>
        }
        @if (usernameError(); as e) {
          <div class="flash error">{{ e | translate }}</div>
        }
      </div>

      <!-- 3. Language -->
      <div class="sc-card section">
        <h2>{{ 'settings.language.title' | translate }}</h2>
        <label class="field-row">
          <span class="inline-label">{{ 'settings.language.label' | translate }}</span>
          <select
            class="sc-select"
            [value]="currentLang()"
            (change)="onLangChange($event)"
            [attr.aria-label]="'settings.language.label' | translate">
            @for (l of locales; track l) {
              <option [value]="l">{{ l.toUpperCase() }}</option>
            }
          </select>
        </label>
      </div>

      <!-- 4. Input / composer keyboard (feedback aa8d5b18) -->
      <div class="sc-card section">
        <h2>{{ 'settings.composer.title' | translate }}</h2>
        <p class="hint">{{ 'settings.composer.hint' | translate }}</p>
        <div class="row">
          <span class="label">{{ 'settings.composer.sendOnEnter.label' | translate }}</span>
          <span class="value">
            <label class="consent-toggle">
              <input
                type="checkbox"
                [checked]="composerPrefs.sendOnEnter()"
                (change)="onSendOnEnterToggle($event)" />
              {{ (composerPrefs.sendOnEnter() ? 'consent.settings.on' : 'consent.settings.off') | translate }}
            </label>
          </span>
        </div>
        <p class="consent-desc">
          {{
            (composerPrefs.sendOnEnter()
              ? 'settings.composer.sendOnEnter.descOn'
              : 'settings.composer.sendOnEnter.descOff') | translate
          }}
        </p>
      </div>

      <!-- 5. Browser storage / consent (#130) -->
      <div class="sc-card section">
        <h2>{{ 'consent.settings.title' | translate }}</h2>
        <p class="hint">{{ 'consent.settings.hint' | translate }}</p>
        <div class="row">
          <span class="label">{{ 'consent.settings.essential.label' | translate }}</span>
          <span class="value">
            <span class="consent-pill locked">{{ 'consent.settings.alwaysOn' | translate }}</span>
          </span>
        </div>
        <p class="consent-desc">{{ 'consent.settings.essential.desc' | translate }}</p>
        <div class="row">
          <span class="label">{{ 'consent.settings.preferences.label' | translate }}</span>
          <span class="value">
            <label class="consent-toggle">
              <input
                type="checkbox"
                [checked]="consent.preferencesAllowed()"
                (change)="onConsentToggle($event)" />
              {{ (consent.preferencesAllowed() ? 'consent.settings.on' : 'consent.settings.off') | translate }}
            </label>
          </span>
        </div>
        <p class="consent-desc">{{ 'consent.settings.preferences.desc' | translate }}</p>
        <div class="row">
          <span class="label">{{ 'consent.settings.statistics.label' | translate }}</span>
          <span class="value">
            <label class="consent-toggle">
              <input
                type="checkbox"
                [checked]="consent.statisticsAllowed()"
                (change)="onStatisticsToggle($event)" />
              {{ (consent.statisticsAllowed() ? 'consent.settings.on' : 'consent.settings.off') | translate }}
            </label>
          </span>
        </div>
        <p class="consent-desc">{{ 'consent.settings.statistics.desc' | translate }}</p>
      </div>

      <!-- 6. Danger zone -->
      <div class="sc-card danger-zone">
        <h2>{{ 'settings.danger.title' | translate }}</h2>
        <p class="hint">{{ 'settings.danger.warning' | translate }}</p>
        @if (deleteError(); as e) {
          <div class="flash error">{{ e }}</div>
        }
        <button
          type="button"
          class="sc-btn danger-btn"
          [disabled]="deleting()"
          (click)="deleteAccount()">
          {{ (deleting() ? 'settings.danger.deleting' : 'settings.danger.deleteBtn') | translate }}
        </button>
      </div>
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; max-width: 720px; }
    h1 { margin: 0; }
    .section h2, .danger-zone h2 {
      margin: 0 0 6px;
      font-size: 1rem;
      font-family: var(--sc-font-display);
      letter-spacing: 0.04em;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--sc-border);
      &:last-child { border-bottom: 0; }
    }
    .label {
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
      font-size: 0.78rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .value { color: var(--sc-fg-0); min-width: 0; text-align: right; overflow-wrap: anywhere; }
    .label { flex: 0 0 auto; }
    .mono { font-family: monospace; font-size: 0.85rem; }
    .muted { color: var(--sc-fg-2); font-style: italic; }
    .role-pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 0.74rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: var(--sc-bg-2);
      color: var(--sc-fg-2);
      &.admin { background: rgba(0, 212, 255, 0.18); color: var(--sc-accent); }
      &.collaborator { background: rgba(74, 222, 128, 0.18); color: var(--sc-success); }
      &.viewer { background: rgba(122, 134, 156, 0.18); color: var(--sc-fg-2); }
    }

    .hint { color: var(--sc-fg-2); margin: 0 0 12px; font-size: 0.85rem; }

    .consent-desc { color: var(--sc-fg-2); font-size: 0.78rem; margin: 4px 0 10px; line-height: 1.45; }
    .consent-pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 0.74rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: rgba(122, 134, 156, 0.18);
      color: var(--sc-fg-2);
    }
    .consent-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 0.85rem;
      color: var(--sc-fg-0);
    }
    .consent-toggle input { accent-color: var(--sc-accent); width: 16px; height: 16px; }

    .field-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .inline-label {
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
      font-size: 0.78rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .text-input {
      flex: 1;
      min-width: 200px;
      padding: 8px 12px;
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      font: inherit;
      font-size: 0.9rem;
    }
    .text-input:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }
    .sc-select {
      background: var(--sc-bg-1);
      color: var(--sc-fg-0);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      padding: 8px 12px;
      font-family: var(--sc-font-display);
      font-size: 0.85rem;
      letter-spacing: 0.06em;
      cursor: pointer;
      min-width: 90px;
    }
    .sc-select:focus {
      outline: none;
      border-color: var(--sc-accent);
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.25);
    }
    .sc-btn-primary {
      background: var(--sc-accent);
      color: var(--sc-bg-0);
      border-color: var(--sc-accent);
    }
    .sc-btn-primary:hover:not(:disabled) {
      background: transparent;
      color: var(--sc-accent);
    }

    .flash {
      margin-top: 12px;
      padding: 9px 14px;
      border-radius: 4px;
      font-size: 0.85rem;
    }
    .flash.success {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid var(--sc-success);
      color: var(--sc-success);
    }
    .flash.error {
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
    }

    .danger-zone {
      border-color: var(--sc-danger);
      box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.15);
    }
    .danger-zone h2 { color: var(--sc-danger); }
    .danger-btn {
      color: var(--sc-danger);
      border-color: var(--sc-danger);
    }
    .danger-btn:hover:not(:disabled) {
      background: var(--sc-danger);
      color: var(--sc-bg-0);
    }

    @media (max-width: 560px) {
      .row { flex-direction: column; gap: 4px; align-items: flex-start; }
      .value { text-align: left; }
      .text-input { min-width: 0; flex: 1 1 100%; }
      .field-row .sc-btn { flex: 1 1 100%; justify-content: center; }
      .danger-btn { width: 100%; justify-content: center; }
    }
  `],
})
export class SettingsComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly roles = inject(RoleService);
  readonly profile = inject(ProfileService);
  readonly consent = inject(ConsentService);
  readonly composerPrefs = inject(ComposerPrefsService);
  private readonly sb = inject(SupabaseClientProvider);
  private readonly translate = inject(TranslateService);
  private readonly analytics = inject(AnalyticsService);

  readonly locales: readonly LangId[] = ['de', 'en'];
  // Normalize legacy stored values (fr/es/pt/ru/zh from the old 7-language
  // dropdown) onto the supported pair so the select always has a valid option.
  readonly currentLang = computed<LangId>(() =>
    (this.translate.getCurrentLang() ?? 'en').startsWith('de') ? 'de' : 'en',
  );

  // Username — the saved value is the shared ProfileService signal, so editing
  // here immediately updates the avatar/account-menu across the shell.
  private readonly savedUsername = computed(() => this.profile.username() ?? '');
  readonly usernameInput = signal<string>('');
  readonly usernameSaving = signal(false);
  readonly usernameOk = signal(false);
  readonly usernameError = signal<string | null>(null);
  readonly usernameDirty = computed(
    () => this.usernameInput().trim() !== this.savedUsername().trim(),
  );

  // Danger zone
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  async ngOnInit() {
    // Seed the edit field from the shared handle (loaded once by ProfileService).
    if (!this.profile.loaded()) await this.profile.refresh();
    this.usernameInput.set(this.profile.username() ?? '');
  }

  asInput(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  async saveUsername(e: Event) {
    e.preventDefault();
    if (this.usernameSaving() || !this.usernameDirty()) return;
    this.usernameSaving.set(true);
    this.usernameOk.set(false);
    this.usernameError.set(null);
    const next = this.usernameInput().trim();
    const { error } = await this.profile.setUsername(next);
    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('username_invalid')) {
        this.usernameError.set('settings.username.errInvalid');
      } else if (msg.includes('username_taken')) {
        this.usernameError.set('settings.username.errTaken');
      } else {
        this.usernameError.set('settings.username.errGeneric');
      }
      this.usernameSaving.set(false);
      return;
    }
    // savedUsername now derives from ProfileService (updated by setUsername),
    // so usernameDirty resets automatically.
    this.usernameInput.set(next);
    this.usernameOk.set(true);
    this.usernameSaving.set(false);
    this.analytics.capture('settings_username_saved');
  }

  onSendOnEnterToggle(e: Event) {
    const on = (e.target as HTMLInputElement).checked;
    this.composerPrefs.setSendOnEnter(on);
    this.analytics.capture('settings_send_on_enter_changed', { on });
  }

  onConsentToggle(e: Event) {
    this.consent.setPreferences((e.target as HTMLInputElement).checked);
  }

  onStatisticsToggle(e: Event) {
    this.consent.setStatistics((e.target as HTMLInputElement).checked);
  }

  onLangChange(e: Event) {
    const lang = (e.target as HTMLSelectElement).value as LangId;
    this.translate.use(lang);
    if (typeof localStorage !== 'undefined') localStorage.setItem('sc.lang', lang);
    this.analytics.capture('settings_language_changed', { lang });
    // Persist to the profile as the logged-in preference. Fire-and-forget:
    // a failure here (e.g. migration not yet applied) must not block the UI.
    this.sb.client
      .rpc('set_preferred_lang', { lang })
      .then(({ error }) => {
        if (error) console.warn('[settings] set_preferred_lang failed:', error.message);
      });
  }

  async deleteAccount() {
    if (this.deleting()) return;
    const user = this.auth.user();
    if (!user) return;
    const msg = this.translate.instant('settings.danger.confirm', { email: user.email });
    if (!window.confirm(msg)) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    const { data, error } = await this.sb.client.functions.invoke('delete-user', {
      body: { userId: user.id },
    });
    const payload = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      message?: string;
      deletedSelf?: boolean;
    };
    if (error || payload.error) {
      this.deleteError.set(
        payload.message ??
          payload.error ??
          error?.message ??
          this.translate.instant('settings.danger.failed'),
      );
      this.deleting.set(false);
      return;
    }
    if (payload.deletedSelf) {
      await this.auth.signOut();
      return;
    }
    this.deleting.set(false);
  }
}
