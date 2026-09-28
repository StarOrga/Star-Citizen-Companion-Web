import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../src/lib/i18n.js';

/**
 * Guard for the renderer dictionaries: every static t('…') / tOr('…') key
 * used in src/renderer and src/lib exists in every offered locale, and every
 * locale in LOCALES carries exactly the key set of en.json - a new language
 * enters the picker only with a complete dictionary. A missing key renders as the raw key
 * (t() returns the key itself), so this catches what users would see as
 * "silhouettes.building" instead of a label.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N = join(ROOT, 'src', 'i18n');

type Json = Record<string, unknown>;

function flatten(obj: Json, prefix = '', out = new Set<string>()): Set<string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Json, key, out);
    else out.add(key);
  }
  return out;
}

const dict = (loc: string): Set<string> =>
  flatten(JSON.parse(readFileSync(join(I18N, `${loc}.json`), 'utf8')) as Json);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Static keys per file; keys ending in '.' are dynamic prefixes ('run.counter.' + k) and skipped. */
function usedKeys(): Map<string, string[]> {
  const re = /\b(?:t|tOr)\(\s*'([A-Za-z0-9_.]+)'/g;
  const used = new Map<string, string[]>();
  for (const dir of ['renderer', 'lib']) {
    for (const file of tsFiles(join(ROOT, 'src', dir))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(re)) {
        const key = m[1] ?? '';
        if (key.endsWith('.') || !key.includes('.')) continue;
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        used.set(key, [...(used.get(key) ?? []), rel]);
      }
    }
  }
  return used;
}

describe('renderer i18n keys', () => {
  const en = dict('en');
  const dicts = LOCALES.map((loc) => [loc, dict(loc)] as const);

  it('offers German and English', () => {
    expect(LOCALES).toContain('de');
    expect(LOCALES).toContain('en');
  });

  for (const [loc, set] of dicts) {
    it(`${loc}.json carries the same key set as en.json`, () => {
      expect([...set].filter((k) => !en.has(k)), `only in ${loc}.json`).toEqual([]);
      expect([...en].filter((k) => !set.has(k)), `missing in ${loc}.json`).toEqual([]);
    });
  }

  it('every static t()/tOr() key exists in every offered locale', () => {
    const missing: string[] = [];
    for (const [key, files] of usedKeys()) {
      for (const [loc, set] of dicts) {
        if (!set.has(key)) missing.push(`${loc}: ${key} (${[...new Set(files)].join(', ')})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
