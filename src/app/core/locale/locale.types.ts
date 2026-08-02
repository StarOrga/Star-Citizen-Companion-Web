/**
 * Shared vocabulary for the locale layer (language + region resolution and the
 * date formatting derived from it).
 *
 * Language and region are two INDEPENDENT axes. A user may read the UI in
 * German while living in the US, or read English in Austria — the language
 * picks the translation file and the month names, the region picks the date
 * ORDER (and the clock). Collapsing both into one "locale" string is what makes
 * most apps get this wrong, so the two are modelled separately throughout.
 */

/** UI languages that have a real translation file (see issue #23). */
export type AppLanguage = 'de' | 'en';

/** ISO 3166-1 alpha-2, uppercase (e.g. `DE`, `AT`, `US`). */
export type RegionCode = string;

/**
 * Calendar-field order used by a region.
 *  - `dmy` — 31 / July / 2026 (most of the world)
 *  - `mdy` — July / 31 / 2026 (US and its date-convention neighbours)
 *  - `ymd` — 2026 / July / 31 (CJK, Hungary, Lithuania, …)
 */
export type DateOrder = 'dmy' | 'mdy' | 'ymd';

/** `'auto'` = derive from the browser; anything else is an explicit choice. */
export type LanguageSetting = AppLanguage | 'auto';
export type RegionSetting = RegionCode | 'auto';

/** Which step of the precedence chain produced a resolved value. */
export type LocaleSource =
  /** The signed-in user's stored profile preference. */
  | 'profile'
  /** An explicit choice made while signed out (localStorage). */
  | 'stored'
  /** `navigator.languages` / `navigator.language`. */
  | 'browser'
  /** `Intl.DateTimeFormat().resolvedOptions().locale`. */
  | 'intl'
  /** IANA time zone mapped onto a country. */
  | 'timezone'
  /** Derived from the resolved language (e.g. `de` → `DE`). */
  | 'language'
  /** Nothing was detectable — the app default. */
  | 'fallback';

/** The fully resolved locale, everything downstream needs. */
export interface ResolvedLocale {
  readonly language: AppLanguage;
  readonly region: RegionCode;
  readonly dateOrder: DateOrder;
  /** BCP-47 tag handed to `Intl`, e.g. `de-AT`. */
  readonly intlLocale: string;
  readonly languageSource: LocaleSource;
  readonly regionSource: LocaleSource;
}

/** What the browser tells us about the user, captured once and injectable. */
export interface BrowserLocaleSignals {
  /** `navigator.languages`, most-preferred first (may be empty). */
  readonly languages: readonly string[];
  /** `Intl.DateTimeFormat().resolvedOptions().locale`, if available. */
  readonly intlLocale?: string | null;
  /** `Intl.DateTimeFormat().resolvedOptions().timeZone`, if available. */
  readonly timeZone?: string | null;
}

/** Everything `resolveLocale()` needs — no DI, no globals, fully testable. */
export interface LocaleResolutionInput {
  /** `profiles.preferred_lang` of the signed-in user. */
  readonly profileLanguage?: string | null;
  /** `profiles.preferred_region` of the signed-in user. */
  readonly profileRegion?: string | null;
  /** Explicit choice persisted in localStorage (signed-out users). */
  readonly storedLanguage?: string | null;
  readonly storedRegion?: string | null;
  readonly browser?: BrowserLocaleSignals;
}
