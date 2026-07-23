// Tests for comm-link-url.ts. Pure logic, no Deno APIs, so it runs under both
// `deno test` (Edge parity) and Node 24's built-in test runner + type stripping:
//   node --test comm-link-url.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCommLinkArticleUrl } from './comm-link-url.ts';

// Real article permalinks from the wiki API must be kept.
test('keeps a transmission article permalink', () => {
  assert.equal(
    isCommLinkArticleUrl('https://robertsspaceindustries.com/en/comm-link/transmission/21227-Grey-s-Market-Basher'),
    true,
  );
});

test('keeps an engineering article permalink', () => {
  assert.equal(
    isCommLinkArticleUrl('https://robertsspaceindustries.com/en/comm-link/engineering/21212-Q-A-Gatac-Tyilui'),
    true,
  );
});

test('keeps a locale-less article permalink', () => {
  assert.equal(
    isCommLinkArticleUrl('https://robertsspaceindustries.com/comm-link/transmission/21206-Star-Citizen-Alpha-483'),
    true,
  );
});

test('keeps an article permalink carrying query/hash', () => {
  assert.equal(
    isCommLinkArticleUrl('https://robertsspaceindustries.com/en/comm-link/transmission/21227-Grey-s-Market-Basher?utm=x#top'),
    true,
  );
});

// The failing cases this bug is about: promo/ad entries surfaced as comm-links
// that point at a non-article target (dead 404 or a client-side redirect page).
test('drops a promotions permalink (the "Fly with D-Box" 404 case)', () => {
  assert.equal(
    isCommLinkArticleUrl('https://robertsspaceindustries.com/en/promotions/x4oA9zfSjC7'),
    false,
  );
});

test('drops the bare comm-link index (the empty-rsi_url fallback)', () => {
  assert.equal(isCommLinkArticleUrl('https://robertsspaceindustries.com/comm-link'), false);
  assert.equal(isCommLinkArticleUrl('https://robertsspaceindustries.com/en/comm-link'), false);
});

test('drops a comm-link category listing with no article slug', () => {
  assert.equal(
    isCommLinkArticleUrl('https://robertsspaceindustries.com/en/comm-link/transmission'),
    false,
  );
});

test('drops an unrelated RSI path', () => {
  assert.equal(isCommLinkArticleUrl('https://robertsspaceindustries.com/en/pledge/ships'), false);
});

test('drops a malformed / empty url instead of throwing', () => {
  assert.equal(isCommLinkArticleUrl(''), false);
  assert.equal(isCommLinkArticleUrl('not a url'), false);
});
