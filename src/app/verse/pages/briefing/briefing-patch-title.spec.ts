import { TEASER_MAX, patchTitleParts, plannedPatchItem } from './briefing-patch-title';

const item = (key: string, title = 'x') => ({ key, kind: 'patch' as const, title });
const none = {};

describe('patchTitleParts', () => {
  it('names LIVE with the full three-part version from channels.live', () => {
    expect(patchTitleParts(item('patch:4.10', '4.10'), { live: '4.10.3' }, none, 'de'))
      .toEqual({ channel: 'live', version: '4.10.3', teaser: null });
  });

  it('keeps the line when the live version belongs to another line', () => {
    expect(patchTitleParts(item('patch:4.10'), { live: '4.9.2' }, none, 'de')?.version).toBe('4.10');
  });

  it('maps build items to PTU and eptu to Evocati', () => {
    expect(patchTitleParts(item('build:ptu:4.11.0'), {}, none, 'en')).toEqual({ channel: 'ptu', version: '4.11.0', teaser: null });
    expect(patchTitleParts(item('build:eptu:4.11.0'), {}, none, 'en')?.channel).toBe('evocati');
  });

  it('reads the teaser in the UI language and ignores an over-long one', () => {
    const teasers = { '4.10.3': { de: 'Neuer Bergbau', en: 'New mining' } };
    expect(patchTitleParts(item('patch:4.10'), { live: '4.10.3' }, teasers, 'de')?.teaser).toBe('Neuer Bergbau');
    expect(patchTitleParts(item('patch:4.10'), { live: '4.10.3' }, teasers, 'en')?.teaser).toBe('New mining');
    const long = { '4.10.3': { de: 'x'.repeat(TEASER_MAX + 1), en: 'y' } };
    expect(patchTitleParts(item('patch:4.10'), { live: '4.10.3' }, long, 'de')?.teaser).toBeNull();
  });

  it('ignores non-patch items', () => {
    expect(patchTitleParts({ key: 'news:a:1', kind: 'news', title: 't' }, {}, none, 'de')).toBeNull();
  });
});

describe('plannedPatchItem', () => {
  it('turns the roadmap next release into a planned candidate with its own link', () => {
    const p = plannedPatchItem({ patchLine: '4.11', name: '4.11' }, { live: '4.10.3' });
    expect(p?.key).toBe('plan:4.11');
    expect(p?.url).toBe('/verse/patches?planned=4.11');
  });

  it('skips a release that already runs in a channel, and an empty one', () => {
    expect(plannedPatchItem({ patchLine: '4.11', name: '4.11' }, { ptu: '4.11.0' })).toBeNull();
    expect(plannedPatchItem(null, {})).toBeNull();
  });

  it('falls back to the release name when RSI gives no patch line', () => {
    expect(plannedPatchItem({ patchLine: '', name: 'Star Citizen 1.0' }, {})?.key).toBe('plan:Star Citizen 1.0');
  });
});
