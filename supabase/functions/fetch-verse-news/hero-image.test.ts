// Tests for hero-image.ts. Pure logic, no Deno APIs, so it runs under both
// `deno test` (Edge parity) and Node 24's built-in test runner + type stripping:
//   node --test hero-image.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroOgTargets, promoteHero } from './hero-image.ts';

const RSI = 'https://robertsspaceindustries.com';

function entry(id: string, daysAgo: number, images?: string[]) {
  return {
    url: `${RSI}/en/comm-link/transmission/${id}`,
    publishedAt: new Date(Date.UTC(2026, 7, 27) - daysAgo * 86400_000).toISOString(),
    images,
  };
}

test('takes the newest entries even when they already have images', () => {
  // The Chairman letter had 8 images and still needed the og:image, because the
  // first three were a lower third and two divider rules.
  const items = [entry('a', 0, ['x.jpg', 'y.jpg']), entry('b', 1, ['z.jpg'])];
  assert.deepEqual(heroOgTargets(items, RSI, 12, 10).map((i) => i.url), items.map((i) => i.url));
});

test('caps the lookahead at the newest N, by date and not by feed order', () => {
  const items = [entry('old', 30, ['a.jpg']), entry('new', 0, ['b.jpg']), entry('mid', 5, ['c.jpg'])];
  const picked = heroOgTargets(items, RSI, 2, 0);
  assert.deepEqual(picked.map((i) => i.url), [entry('new', 0).url, entry('mid', 5).url]);
});

test('still backfills an imageless entry that fell outside the lookahead', () => {
  const items = [entry('new', 0, ['a.jpg']), entry('roundup', 40, [])];
  const picked = heroOgTargets(items, RSI, 1, 10);
  assert.equal(picked.length, 2);
  assert.ok(picked.some((i) => i.url.endsWith('roundup')));
});

test('lists an entry that is in both sets exactly once', () => {
  const items = [entry('a', 0, [])];
  assert.equal(heroOgTargets(items, RSI, 12, 10).length, 1);
});

test('never scrapes an off-site url', () => {
  const items = [{ url: 'https://example.test/x', publishedAt: new Date().toISOString() }];
  assert.deepEqual(heroOgTargets(items, RSI, 12, 10), []);
});

test('puts the hero in front and keeps the rest of the media list', () => {
  const media = ['lower-third.webp', 'divider.webp', 'banner.jpg'];
  assert.deepEqual(
    promoteHero(media, 'heap_thumb.jpg', 10),
    ['heap_thumb.jpg', 'lower-third.webp', 'divider.webp', 'banner.jpg'],
  );
});

test('moves a hero that was already in the list instead of duplicating it', () => {
  const media = ['banner.jpg', 'extra.jpg'];
  assert.deepEqual(promoteHero(media, 'extra.jpg', 10), ['extra.jpg', 'banner.jpg']);
});

test('is the whole list when there was none, and respects the cap', () => {
  assert.deepEqual(promoteHero(undefined, 'hero.jpg', 10), ['hero.jpg']);
  assert.deepEqual(promoteHero(['a', 'b', 'c'], 'hero.jpg', 2), ['hero.jpg', 'a']);
});
