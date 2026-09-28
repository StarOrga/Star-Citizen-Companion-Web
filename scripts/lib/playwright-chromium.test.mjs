import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { playwrightChromiumCandidates, playwrightRoots } from './playwright-chromium.mjs';

test('newest chromium-<rev> first, numeric not lexical order', () => {
  const c = playwrightChromiumCandidates('/opt/pw', ['chromium-999', 'chromium-1194', 'chromium-1010']);
  assert.equal(c[0], join('/opt/pw', 'chromium-1194', 'chrome-linux/chrome'));
  const firstPerRev = c.filter((p) => p.endsWith(join('chrome-linux', 'chrome')) || p.endsWith('chrome-linux/chrome'));
  assert.deepEqual(
    firstPerRev.map((p) => p.split(/[\\/]/).find((s) => s.startsWith('chromium-'))),
    ['chromium-1194', 'chromium-1010', 'chromium-999'],
  );
});

test('skips folders without a revision number and headless-shell folders', () => {
  const c = playwrightChromiumCandidates('/opt/pw', ['chromium', 'chromium_headless_shell-1194', 'ffmpeg-1011', 'chromium-1194']);
  assert.ok(c.length > 0);
  assert.ok(c.every((p) => p.includes('chromium-1194')));
});

test('no entries → no candidates', () => {
  assert.deepEqual(playwrightChromiumCandidates('/opt/pw', []), []);
});

test('PLAYWRIGHT_BROWSERS_PATH is the first root; LOCALAPPDATA only on Windows', () => {
  const linux = playwrightRoots({ PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers', LOCALAPPDATA: 'C:/x' }, 'linux');
  assert.equal(linux[0], '/opt/pw-browsers');
  assert.equal(linux.length, 2);
  const win = playwrightRoots({ LOCALAPPDATA: 'C:/x' }, 'win32');
  assert.equal(win.length, 2);
  assert.equal(win[1], join('C:/x', 'ms-playwright'));
});
