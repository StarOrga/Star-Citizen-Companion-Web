import { Injectable, computed, signal } from '@angular/core';
import { readBrowserLocaleSignals, resolveLocale } from './locale-resolution';
import type {
  AppLanguage,
  BrowserLocaleSignals,
  LanguageSetting,
  RegionCode,
  RegionSetting,
} from './locale.types';
import { normalizeLanguage, normalizeRegion } from './region.data';

/** Explicit UI language. Pre-dates this service — keep the key, keep the users. */
export const LANG_STORAGE_KEY = 'sc.lang';
/** Explicit region (ISO 3166-1 alpha-2). */
export const REGION_STORAGE_KEY = 'sc.region';

/**
 * Single source of truth for "who is this user, locale-wise" (feedback
 * 38b3d25a).
 *
 * Holds the two explicit settings (language, region — each `'auto'` by
 * default), the signed-in profile preferences, and the browser signals, and
 * derives the effective locale from them via `resolveLocale()`. Everything that
 * renders a date reads `language()`/`region()` from here through `ScDatePipe`.
 *
 * Dependency-free on purpose: no `TranslateService`, no Supabase client. The
 * shell (`AppComponent`) pushes the profile values in and mirrors the resolved
 * language into ngx-translate; the settings page writes the choice back to the
 * profile. That keeps this service injectable from a bare `TestBed` and keeps
 * the date pipe free of any transitive HTTP dependency.
 *
 * Both settings are persisted unconditionally (essential category, like
 * `sc.lang` always was): a locale the user deliberately chose that forgets
 * itself on reload is simply broken. Neither value is personal data.
 */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly storedLanguage = signal<string | null>(readStored(LANG_STORAGE_KEY));
  private readonly storedRegion = signal<string | null>(readStored(REGION_STORAGE_KEY));
  private readonly profileLanguage = signal<string | null>(null);
  private readonly profileRegion = signal<string | null>(null);
  private readonly browser = signal<BrowserLocaleSignals>(readBrowserLocaleSignals());

  /**
   * Set once the user picks a value in the settings this session — including a
   * deliberate `'auto'`. The shell fetches the profile asynchronously, so its
   * answer can land AFTER the user already switched; without these flags that
   * late answer silently reverts the switch in front of the user.
   */
  private languageChosenThisSession = false;
  private regionChosenThisSession = false;

  /** The full resolution result, including which step produced each value. */
  readonly resolved = computed(() =>
    resolveLocale({
      profileLanguage: this.profileLanguage(),
      profileRegion: this.profileRegion(),
      storedLanguage: this.storedLanguage(),
      storedRegion: this.storedRegion(),
      browser: this.browser(),
    }),
  );

  readonly language = computed<AppLanguage>(() => this.resolved().language);
  readonly region = computed<RegionCode>(() => this.resolved().region);
  readonly dateOrder = computed(() => this.resolved().dateOrder);
  readonly intlLocale = computed(() => this.resolved().intlLocale);

  /** The stored *choice* — `'auto'` while the user has not picked one. */
  readonly languageSetting = computed<LanguageSetting>(
    () => normalizeLanguage(this.profileLanguage() ?? this.storedLanguage()) ?? 'auto',
  );
  readonly regionSetting = computed<RegionSetting>(
    () => normalizeRegion(this.profileRegion() ?? this.storedRegion()) ?? 'auto',
  );

  /** `true` when the effective value was detected rather than chosen. */
  readonly languageIsAuto = computed(() => this.languageSetting() === 'auto');
  readonly regionIsAuto = computed(() => this.regionSetting() === 'auto');

  /**
   * Applies an explicit language choice (or `'auto'` to hand it back to
   * detection). Writes localStorage AND the in-memory profile mirror, so a
   * later profile hydration cannot clobber a choice made this session.
   */
  setLanguage(setting: LanguageSetting): void {
    const value = setting === 'auto' ? null : (normalizeLanguage(setting) ?? null);
    this.languageChosenThisSession = true;
    this.storedLanguage.set(value);
    this.profileLanguage.set(value);
    persist(LANG_STORAGE_KEY, value);
  }

  /** Applies an explicit region choice (or `'auto'`). */
  setRegion(setting: RegionSetting): void {
    const value = setting === 'auto' ? null : normalizeRegion(setting);
    this.regionChosenThisSession = true;
    this.storedRegion.set(value);
    this.profileRegion.set(value);
    persist(REGION_STORAGE_KEY, value);
  }

  /**
   * Feeds the signed-in user's stored preferences in. Called once per login by
   * the shell; values that are not usable (legacy `fr`/`es`, a NULL column) are
   * ignored so the chain falls through to the browser signals.
   *
   * A value the user already chose this session wins over the profile answer,
   * however late it arrives — the settings page writes the same choice back to
   * the profile anyway, so the two converge without the UI ever flipping back.
   */
  hydrateFromProfile(language: string | null | undefined, region: string | null | undefined): void {
    const lang = this.languageChosenThisSession ? null : normalizeLanguage(language);
    const reg = this.regionChosenThisSession ? null : normalizeRegion(region);
    if (lang) {
      this.profileLanguage.set(lang);
      // Mirror into localStorage so the next cold start is already correct
      // before the profile round-trip finishes (no flash of the wrong locale).
      persist(LANG_STORAGE_KEY, lang);
      this.storedLanguage.set(lang);
    }
    if (reg) {
      this.profileRegion.set(reg);
      persist(REGION_STORAGE_KEY, reg);
      this.storedRegion.set(reg);
    }
  }

  /** Drops the in-memory profile preferences (sign-out). */
  clearProfile(): void {
    this.profileLanguage.set(null);
    this.profileRegion.set(null);
  }

  /** Test seam / re-read after a browser-side locale change. */
  setBrowserSignals(signals: BrowserLocaleSignals): void {
    this.browser.set(signals);
  }
}

function readStored(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist(key: string, value: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode / quota — the in-memory signal still applies this session */
  }
}
