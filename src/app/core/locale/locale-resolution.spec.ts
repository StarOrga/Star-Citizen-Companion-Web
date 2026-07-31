import { resolveLocale } from './locale-resolution';

describe('resolveLocale', () => {
  it('falls back to English + the day-first default region when nothing is known', () => {
    const r = resolveLocale({ browser: { languages: [] } });
    expect(r.language).toBe('en');
    expect(r.languageSource).toBe('fallback');
    expect(r.region).toBe('GB');
    expect(r.dateOrder).toBe('dmy');
  });

  it('prefers the profile over every other signal', () => {
    const r = resolveLocale({
      profileLanguage: 'de',
      profileRegion: 'AT',
      storedLanguage: 'en',
      storedRegion: 'US',
      browser: { languages: ['en-US'], timeZone: 'America/New_York' },
    });
    expect(r.language).toBe('de');
    expect(r.languageSource).toBe('profile');
    expect(r.region).toBe('AT');
    expect(r.regionSource).toBe('profile');
    expect(r.intlLocale).toBe('de-AT');
  });

  it('prefers an explicit signed-out choice over the browser', () => {
    const r = resolveLocale({
      storedLanguage: 'de',
      storedRegion: 'CH',
      browser: { languages: ['en-US'], timeZone: 'America/New_York' },
    });
    expect(r.language).toBe('de');
    expect(r.languageSource).toBe('stored');
    expect(r.region).toBe('CH');
    expect(r.regionSource).toBe('stored');
  });

  it('takes language and region from the browser tags', () => {
    const r = resolveLocale({ browser: { languages: ['de-AT', 'en-US'] } });
    expect(r.language).toBe('de');
    expect(r.languageSource).toBe('browser');
    expect(r.region).toBe('AT');
    expect(r.regionSource).toBe('browser');
  });

  it('skips unsupported browser languages but still uses their region', () => {
    // French UI is not translated (issue #23) → English UI, French-Canadian
    // region: the two axes really are independent.
    const r = resolveLocale({ browser: { languages: ['fr-CA'] } });
    expect(r.language).toBe('en');
    expect(r.region).toBe('CA');
    expect(r.dateOrder).toBe('mdy');
  });

  it('prefers the region of a tag written in the resolved language', () => {
    const r = resolveLocale({
      profileLanguage: 'de',
      browser: { languages: ['fr-CA', 'de-AT'] },
    });
    expect(r.region).toBe('AT');
  });

  it('falls back to the Intl locale when no tag carries a region', () => {
    const r = resolveLocale({ browser: { languages: ['de'], intlLocale: 'de-CH' } });
    expect(r.language).toBe('de');
    expect(r.region).toBe('CH');
    expect(r.regionSource).toBe('intl');
  });

  it('derives the region from the time zone when the tags carry none', () => {
    const r = resolveLocale({
      browser: { languages: ['de'], intlLocale: 'de', timeZone: 'Europe/Vienna' },
    });
    expect(r.region).toBe('AT');
    expect(r.regionSource).toBe('timezone');
  });

  it('falls back to the language home region for an unmapped time zone', () => {
    const r = resolveLocale({
      browser: { languages: ['de'], timeZone: 'Antarctica/Troll' },
    });
    expect(r.region).toBe('DE');
    expect(r.regionSource).toBe('language');
  });

  it('classifies the date order from the region, not the language', () => {
    expect(resolveLocale({ profileLanguage: 'de', profileRegion: 'US' }).dateOrder).toBe('mdy');
    expect(resolveLocale({ profileLanguage: 'en', profileRegion: 'DE' }).dateOrder).toBe('dmy');
    expect(resolveLocale({ profileLanguage: 'en', profileRegion: 'JP' }).dateOrder).toBe('ymd');
  });

  it('ignores junk in the stored/profile values instead of trusting it', () => {
    const r = resolveLocale({
      profileLanguage: 'fr',
      profileRegion: 'not-a-region',
      browser: { languages: ['de-DE'] },
    });
    expect(r.language).toBe('de');
    expect(r.region).toBe('DE');
  });

  it('normalizes case and separators of stored values', () => {
    const r = resolveLocale({ storedLanguage: 'DE_de', storedRegion: 'at' });
    expect(r.language).toBe('de');
    expect(r.region).toBe('AT');
  });
});
