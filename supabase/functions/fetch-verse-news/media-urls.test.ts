// Tests for media-urls.ts. Pure logic, no Deno APIs, so it runs under both
// `deno test` (Edge parity) and Node 24's built-in test runner + type stripping:
//   node --test media-urls.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isImageUrl } from './media-urls.ts';

const MEDIA = 'https://media.robertsspaceindustries.com/2q1mo9uspa6ij';

test('rejects the clip variants a comm-link ships next to its artwork', () => {
  // The exact three urls that poisoned the image cache (2026-07-29).
  assert.equal(isImageUrl(`${MEDIA}/source.mp4`), false);
  assert.equal(isImageUrl(`${MEDIA}/source.webm`), false);
  assert.equal(isImageUrl(`${MEDIA}/cover.mp4`), false);
});

test('keeps the artwork of that same media id', () => {
  assert.equal(isImageUrl(`${MEDIA}/source.jpg`), true);
  assert.equal(isImageUrl(`${MEDIA}/cover.jpg`), true);
  assert.equal(isImageUrl(`${MEDIA}/post.png`), true);
});

test('keeps extension-less signed proxy urls (RSI serves real images there)', () => {
  assert.equal(
    isImageUrl('https://robertsspaceindustries.com/i/9d23f230e54c07e0/ADdPNihJzmPbNuTnFsH1DqU'),
    true,
  );
});

test('keeps our own cached storage urls', () => {
  assert.equal(
    isImageUrl('https://hcnqhvzlavdycidqyaai.supabase.co/storage/v1/object/public/news-images/35cef2c43df3/w800.jpg'),
    true,
  );
});

test('matches the extension through a query string or fragment', () => {
  assert.equal(isImageUrl(`${MEDIA}/source.mp4?v=2`), false);
  assert.equal(isImageUrl(`${MEDIA}/source.mp4#t=10`), false);
});

test('is case-insensitive', () => {
  assert.equal(isImageUrl(`${MEDIA}/SOURCE.MP4`), false);
  assert.equal(isImageUrl(`${MEDIA}/SOURCE.JPG`), true);
});

test('does not reject an image whose path merely contains a video word', () => {
  assert.equal(isImageUrl(`${MEDIA}/video-thumbnail.jpg`), true);
  assert.equal(isImageUrl(`${MEDIA}/mp4-preview.png`), true);
});
