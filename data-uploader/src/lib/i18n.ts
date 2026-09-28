/**
 * Minimal i18n loader for the renderer.
 *
 * Dictionaries are bundled at build time via JSON imports (Vite handles
 * them natively). This avoids a runtime `fetch('./i18n/...')` which fails
 * silently in the packaged build under `file://` + the renderer's CSP —
 * the symptom there is the UI showing raw `discover.title` keys instead
 * of translated strings.
 */

import de from '../i18n/de.json';
import en from '../i18n/en.json';

export type LocaleId = 'de' | 'en';
/**
 * Languages offered in the settings dialog. Add another one only together
 * with a complete dictionary: test/i18n-keys.spec.ts fails when a locale in
 * this list lacks a key that en.json has. A stored locale that is no longer
 * listed (fr, es, ...) falls back to the browser language, else English.
 */
export const LOCALES: readonly LocaleId[] = ['de', 'en'];

type Dict = Record<string, unknown>;

const DICTS: Record<LocaleId, Dict> = {
  de: de as Dict,
  en: en as Dict,
};

const FALLBACK: Dict = DICTS.en;

let _active: LocaleId = detectLocale();

export function load(initial?: LocaleId): Promise<void> {
  if (initial) _active = initial;
  return Promise.resolve();
}

export function setLocale(loc: LocaleId): Promise<void> {
  _active = loc;
  if (typeof localStorage !== 'undefined') localStorage.setItem('sc.tool.lang', loc);
  return Promise.resolve();
}

export function getLocale(): LocaleId {
  return _active;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const dict = DICTS[_active] ?? FALLBACK;
  return interpolate(lookup(dict, key) ?? lookup(FALLBACK, key) ?? key, params);
}

function lookup(dict: Dict | null | undefined, key: string): string | null {
  if (!dict) return null;
  const parts = key.split('.');
  let node: unknown = dict;
  for (const p of parts) {
    if (!node || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[p];
  }
  return typeof node === 'string' ? node : null;
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
    name in params ? String(params[name]) : `{{${name}}}`,
  );
}

function detectLocale(): LocaleId {
  const fromStorage =
    typeof localStorage !== 'undefined'
      ? (localStorage.getItem('sc.tool.lang') as LocaleId | null)
      : null;
  if (fromStorage && LOCALES.includes(fromStorage)) return fromStorage;
  const fromBrowser =
    typeof navigator !== 'undefined'
      ? (navigator.language.slice(0, 2) as LocaleId)
      : 'en';
  return LOCALES.includes(fromBrowser) ? fromBrowser : 'en';
}
