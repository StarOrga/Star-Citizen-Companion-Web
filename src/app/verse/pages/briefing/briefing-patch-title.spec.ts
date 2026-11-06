import { TEASER_MAX, channelBuildItems, cleanVersion, liveVersionOfSlug, patchTitleParts, plannedPatchItem, withLiveVersion } from './briefing-patch-title';

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

  it('maps build items to their channel and never calls eptu Evocati', () => {
    expect(patchTitleParts(item('build:ptu:4.11.0'), {}, none, 'en')).toEqual({ channel: 'ptu', version: '4.11.0', teaser: null });
    expect(patchTitleParts(item('build:evocati:4.11.0'), {}, none, 'en')?.channel).toBe('evocati');
    expect(patchTitleParts(item('build:hotfix:4.10.3'), {}, none, 'en')?.channel).toBe('hotfix');
    expect(patchTitleParts(item('build:eptu:4.11.0'), {}, none, 'en')?.channel).toBe('eptu');
  });

  it('shows a clean version for a build string and looks the teaser up by it', () => {
    expect(cleanVersion('4.8.0-LIVE.1825000')).toBe('4.8.0');
    const teasers = { '4.8.0': { de: 'Neu', en: 'New' } };
    expect(patchTitleParts(item('patch:4.8'), { live: '4.8.0-LIVE.1825000' }, teasers, 'en'))
      .toEqual({ channel: 'live', version: '4.8.0', teaser: 'New' });
  });

  it('gives a hotfix no teaser: it runs on the LIVE version', () => {
    const teasers = { '4.10.3': { de: 'Neu', en: 'New' } };
    expect(patchTitleParts(item('build:hotfix:4.10.3'), {}, teasers, 'en')?.teaser).toBeNull();
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

describe('channelBuildItems', () => {
  const b = (version: string) => ({ version, startedAt: '2026-11-01T00:00:00Z', threadFirstAt: null, wave: null, replies: 0, votes: 0, ticketShare: null, ticketVoteShare: null, previous: null });

  it('makes a candidate per running Evocati / PTU / Hotfix build with its own link', () => {
    const items = channelBuildItems({ evocati: b('4.12.0'), hotfix: b('4.10.3'), ptu: b('4.11.0') }, new Set());
    expect(items.map((i) => i.key)).toEqual(['build:evocati:4.12.0', 'build:ptu:4.11.0', 'build:hotfix:4.10.3']);
    expect(new Set(items.map((i) => i.url)).size).toBe(3);
  });

  it('skips builds the digest already lists and tolerates a missing channelInfo', () => {
    expect(channelBuildItems({ ptu: b('4.11.0') }, new Set(['build:ptu:4.11.0']))).toEqual([]);
    expect(channelBuildItems(undefined, new Set())).toEqual([]);
  });
});

describe('production digest 2026-11-05', () => {
  // verse_digest().patch as served: channels EMPTY, only a PTU channel_info; the only patch item is "patch:4.10".
  const patch = { line: '4.10', status: 'live', channels: {}, channel_info: { ptu: { version: '4.10.3', previous: { version: '4.10.2' } } } };
  const liveItem = { key: 'patch:4.10', kind: 'patch' as const, title: '4.10' };

  it('names the three-part LIVE version once the roadmap board supplies it (rsi-roadmap liveVersion 4.10.2)', () => {
    const channels = withLiveVersion(patch.channels, '4.10.2');
    expect(patchTitleParts(liveItem, channels, none, 'de')).toEqual({ channel: 'live', version: '4.10.2', teaser: null });
  });

  it('keeps the honest line "4.10" while the roadmap is unavailable', () => {
    expect(patchTitleParts(liveItem, withLiveVersion(patch.channels, undefined), none, 'de')?.version).toBe('4.10');
  });

  it('ignores a roadmap version of another line and never guesses from the PTU predecessor', () => {
    expect(patchTitleParts(liveItem, withLiveVersion(patch.channels, '4.9.0'), none, 'de')?.version).toBe('4.10');
  });

  it('prefers a digest-provided live version', () => {
    expect(withLiveVersion({ live: '4.10.1' }, '4.10.2')['live']).toBe('4.10.1');
  });

  it('still gives 4.10.2 when the roadmap call failed: the LIVE notes slug is the second source', () => {
    const slugLive = liveVersionOfSlug('star-citizen-alpha-4-10-2-live-release-notes');
    expect(slugLive).toBe('4.10.2');
    const channels = withLiveVersion(patch.channels, undefined, slugLive);
    expect(patchTitleParts(liveItem, channels, none, 'de')).toEqual({ channel: 'live', version: '4.10.2', teaser: null });
  });

  it('the roadmap wins over the slug, and a slug of another line is ignored by the line guard', () => {
    expect(withLiveVersion({}, '4.10.2', '4.10.1')['live']).toBe('4.10.2');
    expect(patchTitleParts(liveItem, withLiveVersion({}, null, '4.9.1'), none, 'de')?.version).toBe('4.10');
  });
});
