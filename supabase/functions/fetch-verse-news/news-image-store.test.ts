// Tests for news-image-store.ts. Pure logic, runs under Node 24's test runner:
//   node --test news-image-store.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ASSETS_BASE_URL,
  assetsBaseUrl,
  cachedSourceKey,
  newsImagesPublicBase,
  newsR2FolderPrefix,
  newsR2Key,
  supabaseNewsImagesBase,
} from './news-image-store.ts';

const env = (vars: Record<string, string>) => (k: string) => vars[k];

test('assets base defaults to the workers.dev Worker', () => {
  assert.equal(assetsBaseUrl(env({})), DEFAULT_ASSETS_BASE_URL);
  assert.equal(assetsBaseUrl(env({ ASSETS_BASE_URL: '   ' })), DEFAULT_ASSETS_BASE_URL);
});

test('assets base honours ASSETS_BASE_URL and strips trailing slashes', () => {
  assert.equal(assetsBaseUrl(env({ ASSETS_BASE_URL: 'https://assets.example.com//' })), 'https://assets.example.com');
});

test('public base and R2 keys keep the bucket path below the prefix', () => {
  assert.equal(newsImagesPublicBase('https://w.example/'), 'https://w.example/news-images');
  assert.equal(newsR2Key('35cef2c43df3/w800.jpg'), 'news-images/35cef2c43df3/w800.jpg');
  assert.equal(newsR2Key('/35cef2c43df3/w0.gif'), 'news-images/35cef2c43df3/w0.gif');
  assert.equal(newsR2FolderPrefix('35cef2c43df3'), 'news-images/35cef2c43df3/');
});

test('legacy Supabase base', () => {
  assert.equal(
    supabaseNewsImagesBase('https://x.supabase.co/'),
    'https://x.supabase.co/storage/v1/object/public/news-images',
  );
});

test('cachedSourceKey recognises both the Worker and the legacy Supabase url', () => {
  const bases = ['https://w.example/news-images', 'https://x.supabase.co/storage/v1/object/public/news-images'];
  assert.equal(cachedSourceKey('https://w.example/news-images/abc/w800.jpg', bases), 'abc');
  assert.equal(
    cachedSourceKey('https://x.supabase.co/storage/v1/object/public/news-images/def/cover.png', bases),
    'def',
  );
  assert.equal(cachedSourceKey('https://media.robertsspaceindustries.com/abc/cover.jpg', bases), null);
  assert.equal(cachedSourceKey('https://w.example/news-images-other/abc/w1.jpg', bases), null);
  assert.equal(cachedSourceKey('https://w.example/news-images/abc', ['', ...bases]), 'abc');
});
