import { mapChannelInfo, mapConstellation, mapDigest, mapExplorer, rankTopItems, VerseDigest } from './verse.models';

const item = (key: string, kind: string, rank: number, pinned = false) => ({
  key,
  kind,
  title: key,
  url: null,
  summary: null,
  image: null,
  at: null,
  pinned,
  score: 100 - rank,
  rank,
});

const rawDigest = {
  generated_at: '2026-10-08T10:00:00Z',
  suggested: 4,
  items: [
    item('news:a', 'news', 2),
    item('pin:1', 'link', 1, true),
    item('patch:4.3', 'patch', 3),
    item('gallery:g', 'gallery', 4),
    item('news:b', 'news', 5),
  ],
  patch: { line: '4.3', live_at: '2026-09-30T00:00:00Z', channels: { live: '4.3.1', ptu: '4.4.0' }, status: 'ptu' },
  counts: { news: { recent: 3 }, patches: { recent: 1, total: 12 }, gallery: { recent: 5, total: 900 } },
};

describe('verse.models', () => {
  it('maps the digest payload to camelCase', () => {
    const d = mapDigest(rawDigest) as VerseDigest;
    expect(d.items.length).toBe(5);
    expect(d.patch).toEqual({
      line: '4.3',
      liveAt: '2026-09-30T00:00:00Z',
      channels: { live: '4.3.1', ptu: '4.4.0' },
      channelInfo: {},
      status: 'ptu',
    });
  });

  it('maps patch.channel_info: running build + predecessor, numbers and nulls', () => {
    const info = mapChannelInfo({
      ptu: {
        version: '4.4.0', started_at: '2026-10-23T12:00:00Z', thread_first_at: '2026-10-23T12:00:00Z', wave: 2, replies: '121', votes: 7,
        ticket_share: '0.4', ticket_vote_share: null,
        previous: { version: '4.3.0', started_at: '2026-09-25T00:00:00Z', thread_first_at: '2026-09-25T00:00:00Z', wave: null, replies: 380, votes: 9, ticket_share: 0.2, ticket_vote_share: 0.1, ended_at: '2026-10-23T12:00:00Z' },
      },
      evocati: { version: '' },
      hotfix: { version: '4.3.2', replies: 3 },
    });
    expect(Object.keys(info).sort()).toEqual(['hotfix', 'ptu']);
    expect(info['ptu'].wave).toBe(2);
    expect(info['ptu'].replies).toBe(121);
    expect(info['ptu'].ticketShare).toBe(0.4);
    expect(info['ptu'].ticketVoteShare).toBeNull();
    expect(info['ptu'].previous?.version).toBe('4.3.0');
    expect(info['ptu'].previous?.wave).toBeNull();
    expect(info['ptu'].previous?.endedAt).toBe('2026-10-23T12:00:00Z');
    expect(info['hotfix'].previous).toBeNull();
    expect(info['hotfix'].startedAt).toBeNull();
    expect(mapChannelInfo(null)).toEqual({});
    expect(d.counts.gallery).toEqual({ recent: 5, total: 900 });
    expect(d.counts.news).toEqual({ recent: 3 });
  });

  it('drops the trailing "| Star Citizen" channel tag from titles', () => {
    const d = mapDigest({ items: [{ key: 'v', kind: 'gallery', title: 'Day of the Vara 2956 | Star Citizen' }], counts: {} });
    expect(d?.items[0].title).toBe('Day of the Vara 2956');
    expect(mapDigest({ items: [{ key: 'w', kind: 'news', title: 'Star Citizen Live' }], counts: {} })?.items[0].title).toBe('Star Citizen Live');
  });

  it('rejects a malformed digest and clamps suggested to 3..7', () => {
    expect(mapDigest(null)).toBeNull();
    expect(mapDigest({ items: [], suggested: 12, counts: {} })?.suggested).toBe(7);
    expect(mapDigest({ items: [], suggested: 0, counts: {} })?.suggested).toBe(3);
  });

  it('ranks pins first, unseen before seen, cut to the adaptive length', () => {
    const top = rankTopItems(mapDigest(rawDigest), new Set(['news:a']));
    expect(top.map((i) => i.key)).toEqual(['pin:1', 'patch:4.3', 'gallery:g', 'news:b']);
    expect(rankTopItems(null, new Set())).toEqual([]);
  });

  it('maps the explorer state and drops unknown star keys', () => {
    const e = mapExplorer({
      patches: [
        {
          patch_line: '4.4',
          live_at: null,
          stars: ['comet', 'bogus'],
          star_count: 1,
          sun: false,
          offered: ['notes', 'comet'],
          constellation: { class_name: 'X', kind: 'ground', points: [[0.1, 0.2]] },
          unlocks: { log_entry: true, community: false, wallpaper: false },
        },
      ],
      total_stars: 1,
      suns: [],
      streak: { current: 1, best: 3, reserve_available: false, reserves_used: 0 },
      kartograph: { unlocked: false, rank: 0 },
      rewards: { road: true, nebula: true, live: false, reserve: false, meteor: false, supernova: false, sun_collection: false },
    });
    expect(e?.patches[0].stars).toEqual(['comet']);
    expect(e?.patches[0].constellation?.kind).toBe('ground');
    expect(e?.patches[0].constellation?.points).toEqual([[0.1, 0.2]]);
    expect(e?.patches[0].unlocks.logEntry).toBeTrue();
    expect(e?.streak.best).toBe(3);
    expect(e?.rewards.nebula).toBeTrue();
    expect(mapExplorer(null)).toBeNull();
  });

  it('maps a constellation row', () => {
    expect(mapConstellation({ patch_line: '4.3', class_name: 'RSI_Zeus', kind: 'ship', points: [[0, 1]] })).toEqual({
      patchLine: '4.3',
      className: 'RSI_Zeus',
      kind: 'ship',
      points: [[0, 1]],
    });
    expect(mapConstellation(null)).toBeNull();
  });
});
