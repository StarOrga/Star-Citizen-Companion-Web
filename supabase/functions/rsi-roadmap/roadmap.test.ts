// Tests for roadmap.ts. Pure logic, no Deno APIs, so it runs under both
// `deno test` (Edge parity) and Node 24's built-in test runner + type stripping:
//   node --test roadmap.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROADMAP_BOARD_URL,
  normalizeStatus,
  parseBoardVersions,
  parseRoadmapBoard,
  pickCurrent,
  releasePatchLine,
  resolveMediaUrl,
} from './roadmap.ts';

// Trimmed copy of the real payload shape (verified against the live board on
// 2026-08-23): releases out of order, mixed statuses, one relative thumbnail.
const BOARD = {
  success: 1,
  data: {
    id: 1,
    description:
      'Live Version: 4.9.0 ([more info](https://robertsspaceindustries.com/comm-link/x)) ▪ ' +
      'Latest Roadmap Roundup: 08/12/2026 ▪ PTU Version: Alpha 4.10 12442953',
    last_updated: 1786570355,
    categories: [
      { id: 2, board_id: 1, name: 'Gameplay', order: 4 },
      { id: 6, board_id: 1, name: 'Ships and Vehicles', order: 7 },
    ],
    releases: [
      {
        id: 60, name: '4.11', description: 'Q4 2026', status: 'Tentative', order: 46,
        cards: [{ id: 900, url_slug: 'Later-Thing', name: 'Later Thing', description: '', body: '', status: 'Tentative', category_id: 2, thumbnail: null }],
      },
      {
        id: 40, name: '4.9', description: 'Q3 2026', status: 'Released', order: 44,
        cards: [
          {
            id: 700, url_slug: 'Ordnance-Cargo-Holder', name: 'Ordnance Cargo Holder',
            description: 'A rack for missiles.', body: 'A rack for missiles.',
            status: 'Released', category_id: 6,
            thumbnail: { id: 1, urls: { square: '/media/abc/heap_infobox.jpg', rect: '/media/abc/product_thumb_large.jpg' } },
          },
        ],
      },
      {
        id: 50, name: '4.10', description: 'Q3 2026', status: 'Committed', order: 45,
        cards: [
          {
            id: 800, url_slug: 'Siege-of-Orison', name: 'Siege of Orison',
            description: 'Instanced version of the event.',
            body: 'The event becomes instanced so it can run continuously.',
            status: 'Committed', category_id: 2,
            thumbnail: { id: 2, urls: { rect: 'https://media.robertsspaceindustries.com/xyz/product_thumb_large.jpg' } },
          },
        ],
      },
      {
        id: 70, name: 'Star Citizen 1.0', description: null, status: 'Tentative', order: 50,
        cards: [],
      },
    ],
  },
};

test('parses the board description for the live and PTU versions', () => {
  const v = parseBoardVersions(BOARD.data.description);
  assert.equal(v.live, '4.9.0');
  assert.equal(v.ptu, '4.10');
});

test('a description without version markers yields empty strings', () => {
  const v = parseBoardVersions('The Release View shows what is coming.');
  assert.equal(v.live, '');
  assert.equal(v.ptu, '');
});

test('release names map onto two-segment patch lines', () => {
  assert.equal(releasePatchLine('4.10'), '4.10');
  assert.equal(releasePatchLine('4.9'), '4.9');
  assert.equal(releasePatchLine('4.9.1'), '4.9');
  assert.equal(releasePatchLine('Star Citizen 1.0'), '1.0');
  assert.equal(releasePatchLine('Alpha'), '');
});

test('4.10 sorts above 4.9 as a line, not as a string', () => {
  // The regression this guards: a lexical compare puts '4.10' below '4.9'.
  const lines = ['4.9', '4.10'].map(releasePatchLine);
  assert.deepEqual(lines, ['4.9', '4.10']);
});

test('statuses collapse onto the closed set', () => {
  assert.equal(normalizeStatus('Released'), 'released');
  assert.equal(normalizeStatus('committed'), 'committed');
  assert.equal(normalizeStatus('Tentative'), 'tentative');
  assert.equal(normalizeStatus(''), 'unknown');
  assert.equal(normalizeStatus(null), 'unknown');
});

test('media urls resolve relative paths and reject foreign hosts', () => {
  assert.equal(resolveMediaUrl('/media/abc/x.jpg'), 'https://robertsspaceindustries.com/media/abc/x.jpg');
  assert.equal(
    resolveMediaUrl('https://media.robertsspaceindustries.com/xyz/x.jpg'),
    'https://media.robertsspaceindustries.com/xyz/x.jpg',
  );
  assert.equal(resolveMediaUrl('https://evil.example.com/x.jpg'), null);
  assert.equal(resolveMediaUrl('javascript:alert(1)'), null);
  assert.equal(resolveMediaUrl(''), null);
});

test('the current release is the one the board names as live', () => {
  const releases = [
    { patchLine: '4.9', status: 'released' as const },
    { patchLine: '4.10', status: 'committed' as const },
  ].map((r) => ({ ...r, id: r.patchLine, name: r.patchLine, quarter: '', cards: [] }));
  assert.equal(pickCurrent(releases, '4.9.0'), 0);
});

test('without a live version the newest released line wins', () => {
  const releases = [
    { patchLine: '4.8', status: 'released' as const },
    { patchLine: '4.9', status: 'released' as const },
    { patchLine: '4.10', status: 'committed' as const },
  ].map((r) => ({ ...r, id: r.patchLine, name: r.patchLine, quarter: '', cards: [] }));
  assert.equal(pickCurrent(releases, ''), 1);
});

test('parses a board into current, next and later', () => {
  const payload = parseRoadmapBoard(BOARD);
  assert.ok(payload);
  assert.equal(payload!.current?.name, '4.9');
  assert.equal(payload!.current?.status, 'released');
  assert.equal(payload!.next?.name, '4.10');
  assert.equal(payload!.next?.status, 'committed');
  assert.deepEqual(payload!.later.map((l) => l.name), ['4.11', 'Star Citizen 1.0']);
  assert.equal(payload!.boardUrl, ROADMAP_BOARD_URL);
  assert.equal(payload!.liveVersion, '4.9.0');
  assert.equal(payload!.ptuVersion, '4.10');
  assert.equal(payload!.updatedAt, new Date(1786570355 * 1000).toISOString());
});

test('cards carry their category name, status and a resolved thumbnail', () => {
  const payload = parseRoadmapBoard(BOARD)!;
  const card = payload.next!.cards[0];
  assert.equal(card.name, 'Siege of Orison');
  assert.equal(card.category, 'Gameplay');
  assert.equal(card.status, 'committed');
  assert.equal(card.thumbnail, 'https://media.robertsspaceindustries.com/xyz/product_thumb_large.jpg');
  assert.equal(card.body, 'The event becomes instanced so it can run continuously.');
});

test('a body that only repeats the description is dropped', () => {
  const payload = parseRoadmapBoard(BOARD)!;
  const card = payload.current!.cards[0];
  assert.equal(card.description, 'A rack for missiles.');
  assert.equal(card.body, '');
});

test('a non-board document parses to null instead of an empty roadmap', () => {
  assert.equal(parseRoadmapBoard({ success: 0, code: 'ErrValidationFailed' }), null);
  assert.equal(parseRoadmapBoard('<html>503</html>'), null);
  assert.equal(parseRoadmapBoard(null), null);
});
