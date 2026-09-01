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
import { LocaleService } from '../core/locale/locale.service';
import type { AppLanguage, RegionCode } from '../core/locale/locale.types';
import { PICKER_REGIONS } from '../core/locale/region.data';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { SupabaseClientProvider } from '../core/supabase.client';
import { memberSince } from './member-since';

// Only languages with a real translation file are offered (issue #23) — the
// other locale files are machine-stub placeholders; offering them silently
// fell back to English, which read as "translation exists but is broken".
type LangId = AppLanguage;

@Component({
  selector: 'sc-settings',
  standalone: true,
  imports: [TranslateModule, ScDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ 'settings.title' | translate }}</h1>

      <div class="grid">
        <!-- 1. Account info (read-only) -->
        @if (auth.user(); as user) {
          <div class="sc-card section account">
            <h2>{{ 'settings.account.title' | translate }}</h2>
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
            <!-- An account can hold several linked identities at once (signed up
                 with Google, then added a password, or the other way round), so
                 this lists every identity instead of one derived provider. -->
            <div class="row">
              <span class="label">{{ 'profile.provider' | translate }}</span>
              <span class="value pills">
                @for (p of providers(); track p) {
                  <span class="provider-pill">{{ providerLabel(p) }}</span>
                }
              </span>
            </div>
            <div class="row">
              <span class="label">{{ 'profile.created' | translate }}</span>
              <span
                class="value"
                [title]="
                  'profile.memberSince.exact'
                    | translate: { date: (user.created_at | scDate: 'datetime') }
                ">
                @if (memberSinceLabel(); as since) {
                  {{ since.key | translate: { count: since.count } }}
                } @else {
                  <span class="muted">{{ 'profile.memberSince.unknown' | translate }}</span>
                }
              </span>
            </div>
            <!-- The user id is support/debug metadata, not account identity — it
                 stays copyable but must not read as a peer of e-mail or role. -->
            <p class="id-line">
              <span class="id-label">{{ 'profile.id' | translate }}</span>
              <code class="id-value">{{ user.id }}</code>
              <button type="button" class="id-copy" (click)="copyUserId(user.id)">
                {{ (idCopied() ? 'profile.idCopied' : 'profile.idCopy') | translate }}
              </button>
            </p>
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

        <!-- 3. Language & region (feedback 38b3d25a) -->
        <div class="sc-card section wide">
          <h2>{{ 'settings.locale.title' | translate }}</h2>
          <p class="hint">{{ 'settings.locale.hint' | translate }}</p>

          <!-- One grid track per control: the two selects sit in separate cells,
               so they can never share a line partially and collide, at any
               viewport (feedback af058ca4). -->
          <div class="locale-grid">
            <label class="locale-field">
              <span class="inline-label">{{ 'settings.locale.language.label' | translate }}</span>
              <select
                class="sc-select"
                [value]="locale.languageSetting()"
                (change)="onLanguageChange($event)"
                [attr.aria-label]="'settings.locale.language.label' | translate">
                <option value="auto">{{ 'settings.locale.auto' | translate }}</option>
                @for (l of languages; track l) {
                  <option [value]="l">{{ 'settings.locale.languages.' + l | translate }}</option>
                }
              </select>
              @if (locale.languageIsAuto()) {
                <span class="field-note">
                  {{ 'settings.locale.detected' | translate: { value: languageLabel(locale.language()) } }}
                </span>
              }
            </label>

            <label class="locale-field">
              <span class="inline-label">{{ 'settings.locale.region.label' | translate }}</span>
              <select
                class="sc-select"
                [value]="locale.regionSetting()"
                (change)="onRegionChange($event)"
                [attr.aria-label]="'settings.locale.region.label' | translate">
                <option value="auto">{{ 'settings.locale.auto' | translate }}</option>
                @for (r of regions; track r) {
                  <option [value]="r">{{ 'settings.locale.regions.' + r | translate }}</option>
                }
              </select>
              @if (locale.regionIsAuto()) {
                <span class="field-note">
                  {{ 'settings.locale.detected' | translate: { value: regionLabel(locale.region()) } }}
                </span>
              }
            </label>
          </div>

          <div class="row">
            <span class="label">{{ 'settings.locale.preview' | translate }}</span>
            <span class="value">{{ sampleDate | scDate: 'datetime' }}</span>
          </div>
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
        <div class="sc-card danger-zone wide">
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
      </div>
    </section>
  `,
  styles: [`
    /* Settings used to cap itself at 720px while every other subpage runs the
       full shell width — it read as a broken, half-finished column (feedback
       af058ca4). It now fills the same width and spends it on a two-column
       card grid instead of stretching label/value rows across 1280px. */
    .page { display: flex; flex-direction: column; gap: 20px; }
    h1 { margin: 0; }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 20px;
      align-items: start;
    }
    @media (min-width: 900px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      /* Cards that need the whole line: the locale card carries two selects,
         the danger zone must not read as an equal sibling of a preference. */
      .wide { grid-column: 1 / -1; }
    }
    .section h2, .danger-zone h2 {
      margin: 0 0 6px;
      font-size: 1rem;
      font-family: var(--sc-font-display);
      letter-spacing: 0.04em;
    }
    .account h2 { margin-bottom: 2px; }
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
      font-size: max(0.78rem, var(--sc-fs-floor));
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .value { color: var(--sc-fg-0); min-width: 0; text-align: right; overflow-wrap: anywhere; }
    .label { flex: 0 0 auto; }
    .value.pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: flex-end;
    }
    .muted { color: var(--sc-fg-2); font-style: italic; }
    .role-pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: max(0.74rem, var(--sc-fs-floor));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: var(--sc-bg-2);
      color: var(--sc-fg-2);
      &.admin { background: rgba(0, 212, 255, 0.18); color: var(--sc-accent); }
      &.collaborator { background: rgba(74, 222, 128, 0.18); color: var(--sc-success); }
      &.viewer { background: rgba(122, 134, 156, 0.18); color: var(--sc-fg-2); }
    }
    .provider-pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: max(0.74rem, var(--sc-fs-floor));
      font-weight: 600;
      letter-spacing: 0.04em;
      background: var(--sc-bg-2);
      color: var(--sc-fg-1);
      border: 1px solid var(--sc-border);
    }

    /* De-emphasised metadata footer — deliberately not a .row, so the user id
       cannot be mistaken for a first-class account field. */
    .id-line {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0 0;
      padding-top: 10px;
      border-top: 1px dashed var(--sc-border);
      color: var(--sc-fg-2);
      font-size: max(0.72rem, var(--sc-fs-floor));
      min-width: 0;
    }
    .id-label { letter-spacing: 0.06em; text-transform: uppercase; flex: 0 0 auto; }
    .id-value {
      font-family: monospace;
      font-size: max(0.7rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1 1 auto;
    }
    .id-copy {
      flex: 0 0 auto;
      background: none;
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      color: var(--sc-fg-2);
      cursor: pointer;
      font: inherit;
      letter-spacing: 0.04em;
      /* 44px+ touch target without inflating the visual pill (mobile gate). */
      padding: 4px 12px;
      min-height: 32px;
    }
    .id-copy:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .hint { color: var(--sc-fg-2); margin: 0 0 12px; font-size: 0.85rem; }

    .consent-desc { color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); margin: 4px 0 10px; line-height: 1.45; }
    .consent-pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: max(0.74rem, var(--sc-fs-floor));
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

    .field-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .inline-label {
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
      font-size: max(0.78rem, var(--sc-fs-floor));
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

    .locale-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
      gap: 14px 16px;
      align-items: start;
      margin-bottom: 4px;
    }
    .locale-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .field-note {
      color: var(--sc-fg-2);
      font-size: max(0.75rem, var(--sc-fs-floor));
      line-height: 1.4;
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
      /* Full cell width: a select that sizes itself to its widest option is
         exactly what used to push it over its neighbour. */
      width: 100%;
      min-width: 0;
      max-width: 100%;
      min-height: 40px;
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

    /* Touch baseline: 44px is the project threshold, but the shell's loading
       scale animations shave a pixel off a measured target — so ask for 48. */
    @media (pointer: coarse) {
      .sc-select { min-height: 48px; }
      .id-copy { min-height: 48px; padding: 8px 16px; }
    }

    @media (max-width: 560px) {
      .row { flex-direction: column; gap: 4px; align-items: flex-start; }
      .value { text-align: left; }
      .value.pills { justify-content: flex-start; }
      .text-input { min-width: 0; flex: 1 1 100%; }
      .field-row .sc-btn { flex: 1 1 100%; justify-content: center; }
      .danger-btn { width: 100%; justify-content: center; }
      /* The id would otherwise squeeze the copy button off the card edge. */
      .id-line { flex-wrap: wrap; }
      .id-value { flex: 1 1 100%; order: 3; }
      .id-copy { margin-left: auto; }
    }
  `],
})
export class SettingsComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly roles = inject(RoleService);
  readonly profile = inject(ProfileService);
  readonly consent = inject(ConsentService);
  readonly composerPrefs = inject(ComposerPrefsService);
  readonly locale = inject(LocaleService);
  private readonly sb = inject(SupabaseClientProvider);
  private readonly translate = inject(TranslateService);
  private readonly analytics = inject(AnalyticsService);

  readonly languages: readonly LangId[] = ['de', 'en'];
  readonly regions: readonly RegionCode[] = PICKER_REGIONS;
  /** Stable reference so the live format preview does not re-render per tick. */
  readonly sampleDate = new Date();
  // Normalize legacy stored values (fr/es/pt/ru/zh from the old 7-language
  // dropdown) onto the supported pair so the select always has a valid option.
  readonly currentLang = computed<LangId>(() => this.locale.language());

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

  readonly idCopied = signal(false);

  // Danger zone
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  /**
   * Every sign-in method actually linked to the account.
   *
   * `app_metadata.provider` only ever names the identity the current session
   * was opened with, so an account that started on Google and later gained a
   * password looked single-provider. `user.identities` is the real link table;
   * `app_metadata.providers` is the fallback for a session minted before the
   * identities list was populated.
   */
  readonly providers = computed<readonly string[]>(() => {
    const user = this.auth.user();
    if (!user) return [];
    const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
    const listed = (user.identities ?? []).map((i) => i.provider);
    const fallback = [
      ...(Array.isArray(meta['providers']) ? (meta['providers'] as unknown[]) : []),
      meta['provider'],
    ];
    const raw = listed.length ? listed : fallback;
    const seen = new Set<string>();
    for (const entry of raw) {
      if (typeof entry !== 'string' || !entry.trim()) continue;
      seen.add(entry.trim().toLowerCase());
    }
    // `email` first (it is the account's own credential), the rest alphabetical
    // so the pill order does not shuffle between renders.
    return [...seen].sort((a, b) =>
      a === 'email' ? -1 : b === 'email' ? 1 : a.localeCompare(b),
    );
  });

  /**
   * Membership age as ONE coarse unit plus its plural key (feedback af058ca4).
   * The exact timestamp is the row's tooltip, so nothing is lost by rounding.
   */
  readonly memberSinceLabel = computed<{ key: string; count: number } | null>(() => {
    const raw = this.auth.user()?.created_at;
    if (!raw) return null;
    const created = new Date(raw);
    if (Number.isNaN(created.getTime())) return null;
    const { unit, count } = memberSince(created);
    if (unit === 'today') return { key: 'profile.memberSince.today', count: 0 };
    return {
      key: `profile.memberSince.${unit}.${count === 1 ? 'one' : 'other'}`,
      count,
    };
  });

  async ngOnInit() {
    // Seed the edit field from the shared handle (loaded once by ProfileService).
    if (!this.profile.loaded()) await this.profile.refresh();
    this.usernameInput.set(this.profile.username() ?? '');
  }

  asInput(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  /** Translated provider name, falling back to the raw id for a new provider. */
  providerLabel(provider: string): string {
    return this.translated(
      `profile.providers.${provider}`,
      provider.charAt(0).toUpperCase() + provider.slice(1),
    );
  }

  async copyUserId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      this.idCopied.set(true);
      setTimeout(() => this.idCopied.set(false), 2000);
    } catch {
      // Clipboard denied (insecure context / permission) — select the text so
      // the user can still copy it by hand.
      const sel = window.getSelection();
      const el = document.querySelector('.id-value');
      if (sel && el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
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

  /**
   * Language choice. `LocaleService` owns persistence + the ngx-translate
   * activation (the shell mirrors its resolved language), so this handler only
   * records the choice and syncs it to the account.
   */
  onLanguageChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    const setting = value === 'auto' ? 'auto' : (value as LangId);
    this.locale.setLanguage(setting);
    this.analytics.capture('settings_language_changed', { lang: setting });
    // Persist to the profile as the logged-in preference. Fire-and-forget:
    // a failure here (e.g. migration not yet applied) must not block the UI.
    // `null` clears the column, i.e. hands the decision back to detection.
    this.sb.client
      .rpc('set_preferred_lang', { lang: setting === 'auto' ? null : setting })
      .then(({ error }) => {
        if (error) console.warn('[settings] set_preferred_lang failed:', error.message);
      });
  }

  /** Region choice — decides date field order and the clock convention. */
  onRegionChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    const setting = value === 'auto' ? 'auto' : value.toUpperCase();
    this.locale.setRegion(setting);
    this.analytics.capture('settings_region_changed', { region: setting });
    this.sb.client
      .rpc('set_preferred_region', { region: setting === 'auto' ? null : setting })
      .then(({ error }) => {
        if (error) console.warn('[settings] set_preferred_region failed:', error.message);
      });
  }

  /** Translated language name, for the "detected automatically" line. */
  languageLabel(lang: string): string {
    return this.translated(`settings.locale.languages.${lang}`, lang.toUpperCase());
  }

  /**
   * Translated region name. A region resolved from the browser can legitimately
   * sit outside the curated picker list (e.g. `HR`) — show the raw ISO code
   * rather than leaking a translation key.
   */
  regionLabel(region: string): string {
    return this.translated(`settings.locale.regions.${region}`, region);
  }

  private translated(key: string, fallback: string): string {
    const value = this.translate.instant(key);
    return !value || value === key ? fallback : value;
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
