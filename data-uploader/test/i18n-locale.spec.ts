import { describe, it, expect, vi, afterEach } from 'vitest';

/** The locale is detected at module load, so every case re-imports i18n fresh. */
async function freshI18n(stored: string | null, browser: string) {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: () => stored, setItem: () => {} });
  vi.stubGlobal('navigator', { language: browser });
  return import('../src/lib/i18n.js');
}

describe('uploader locale selection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers only German and English', async () => {
    const m = await freshI18n(null, 'en-US');
    expect(m.LOCALES).toEqual(['de', 'en']);
  });

  it('a stored locale that is no longer offered falls back (fr → browser fr → en)', async () => {
    const m = await freshI18n('fr', 'fr-FR');
    expect(m.getLocale()).toBe('en');
  });

  it('without a stored value a German browser gets German', async () => {
    const m = await freshI18n(null, 'de-DE');
    expect(m.getLocale()).toBe('de');
  });
});
