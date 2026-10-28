// Tests for youtube-thumb.ts. Pure logic with an injected fetch, so it runs under
// both `deno test` and Node 24's built-in test runner + type stripping:
//   node --test youtube-thumb.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxresThumbnailUrl, upgradeYouTubeThumbnail } from './youtube-thumb.ts';

const HQ = 'https://i2.ytimg.com/vi/qv5vk7j5_X0/hqdefault.jpg';
const MAXRES = 'https://i2.ytimg.com/vi/qv5vk7j5_X0/maxresdefault.jpg';

const respond = (status: number) =>
  (async () => new Response(null, { status })) as unknown as typeof fetch;

test('maps the RSS hqdefault url to its maxres twin', () => {
  assert.equal(maxresThumbnailUrl(HQ), MAXRES);
  assert.equal(maxresThumbnailUrl('https://i.ytimg.com/vi/a-B_c/default.jpg'), 'https://i.ytimg.com/vi/a-B_c/maxresdefault.jpg');
});

test('leaves non-YouTube and already-maxres urls alone', () => {
  assert.equal(maxresThumbnailUrl('https://media.robertsspaceindustries.com/x/cover.jpg'), null);
  assert.equal(maxresThumbnailUrl(MAXRES), null);
});

test('upgrades when the maxres HEAD answers 200', async () => {
  let seen: { url: string; method?: string } | null = null;
  const fetchFn = (async (u: string, init?: RequestInit) => {
    seen = { url: u, method: init?.method };
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await upgradeYouTubeThumbnail(HQ, fetchFn), MAXRES);
  assert.deepEqual(seen, { url: MAXRES, method: 'HEAD' });
});

test('keeps hqdefault when maxres is missing (404 placeholder)', async () => {
  assert.equal(await upgradeYouTubeThumbnail(HQ, respond(404)), HQ);
});

test('keeps hqdefault when the probe fails', async () => {
  const failing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.equal(await upgradeYouTubeThumbnail(HQ, failing), HQ);
});

test('does not probe a url it cannot upgrade', async () => {
  const never = (async () => { throw new Error('must not be called'); }) as unknown as typeof fetch;
  const other = 'https://example.com/a.jpg';
  assert.equal(await upgradeYouTubeThumbnail(other, never), other);
});
