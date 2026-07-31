import type {
  BrowserLocaleSignals,
  LocaleResolutionInput,
  LocaleSource,
  ResolvedLocale,
} from './locale.types';
import {
  FALLBACK_LANGUAGE,
  FALLBACK_REGION,
  dateOrderForRegion,
  normalizeLanguage,
  normalizeRegion,
  regionForLanguage,
  regionFromLanguageTag,
  regionFromTimeZone,
} from './region.data';

/**
 * Resolves the effective language + region from every signal we have.
 *
 * Precedence, as specified by the admin (feedback 38b3d25a): profile setting
 * first, then browser information, then the English default region. Language
 * and region walk that chain independently, so a German-speaking user in the
 * US keeps the German UI *and* the US date order.
 *
 * Language chain:
 *   1. `profiles.preferred_lang`
 *   2. explicit localStorage choice (`sc.lang`, signed-out users)
 *   3. `navigator.languages` / `navigator.language`, first supported entry
 *   4. `Intl.DateTimeFormat().resolvedOptions().locale`
 *   5. English
 *
 * Region chain:
 *   1. `profiles.preferred_region`
 *   2. explicit localStorage choice (`sc.region`)
 *   3. region subtag of a browser language tag (`de-AT` → `AT`) — preferring
 *      a tag that matches the resolved language, so `["fr-CA","de-AT"]` with a
 *      German UI yields `AT`, not `CA`
 *   4. region subtag of the resolved `Intl` locale
 *   5. IANA time zone → country (`Europe/Vienna` → `AT`)
 *   6. the resolved language's home region (`de` → `DE`)
 *   7. `GB` (day-first, matching the product's default date style)
 *
 * Pure: everything it reads is passed in, so the whole chain is unit-testable
 * without touching `navigator`, `Intl` or the DOM.
 */
export function resolveLocale(input: LocaleResolutionInput): ResolvedLocale {
  const browser: BrowserLocaleSignals = input.browser ?? { languages: [] };
  const tags = browser.languages.filter((t) => typeof t === 'string' && t.trim() !== '');

  // ── language ───────────────────────────────────────────────────────────────
  let language = normalizeLanguage(input.profileLanguage);
  let languageSource: LocaleSource = 'profile';

  if (!language) {
    language = normalizeLanguage(input.storedLanguage);
    languageSource = 'stored';
  }
  if (!language) {
    for (const tag of tags) {
      const candidate = normalizeLanguage(tag);
      if (candidate) {
        language = candidate;
        languageSource = 'browser';
        break;
      }
    }
  }
  if (!language) {
    language = normalizeLanguage(browser.intlLocale);
    languageSource = 'intl';
  }
  if (!language) {
    language = FALLBACK_LANGUAGE;
    languageSource = 'fallback';
  }

  // ── region ─────────────────────────────────────────────────────────────────
  let region = normalizeRegion(input.profileRegion);
  let regionSource: LocaleSource = 'profile';

  if (!region) {
    region = normalizeRegion(input.storedRegion);
    regionSource = 'stored';
  }
  if (!region) {
    // A tag in the user's own UI language is the most trustworthy region hint;
    // only fall back to the first tag carrying any region at all.
    const matching = tags.find((t) => normalizeLanguage(t) === language && regionFromLanguageTag(t));
    const anyTagged = tags.find((t) => regionFromLanguageTag(t));
    region = regionFromLanguageTag(matching ?? anyTagged);
    regionSource = 'browser';
  }
  if (!region) {
    region = regionFromLanguageTag(browser.intlLocale);
    regionSource = 'intl';
  }
  if (!region) {
    region = regionFromTimeZone(browser.timeZone);
    regionSource = 'timezone';
  }
  if (!region) {
    region = regionForLanguage(language);
    regionSource = 'language';
  }
  if (!region) {
    region = FALLBACK_REGION;
    regionSource = 'fallback';
  }

  return {
    language,
    region,
    dateOrder: dateOrderForRegion(region),
    intlLocale: `${language}-${region}`,
    languageSource,
    regionSource,
  };
}

/** Reads the browser's locale signals; safe on a server / in a bare test env. */
export function readBrowserLocaleSignals(): BrowserLocaleSignals {
  const languages: string[] = [];
  if (typeof navigator !== 'undefined') {
    for (const tag of navigator.languages ?? []) languages.push(tag);
    if (languages.length === 0 && navigator.language) languages.push(navigator.language);
  }
  let intlLocale: string | null = null;
  let timeZone: string | null = null;
  try {
    const opts = new Intl.DateTimeFormat().resolvedOptions();
    intlLocale = opts.locale ?? null;
    timeZone = opts.timeZone ?? null;
  } catch {
    /* no Intl data — the language/fallback steps still apply */
  }
  return { languages, intlLocale, timeZone };
}
