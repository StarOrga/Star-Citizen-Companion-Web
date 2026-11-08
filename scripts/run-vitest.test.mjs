import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vitestChromeBin } from './lib/vitest-chrome-bin.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const has = (...paths) => (p) => paths.includes(p);

test('an explicit CHROME_BIN is left alone', () => {
  assert.equal(vitestChromeBin({ CHROME_BIN: '/x/chrome' }, 'linux', has('/usr/bin/google-chrome')), null);
  assert.equal(vitestChromeBin({ CHROME_BIN: 'C:/x.exe' }, 'win32', has(EDGE)), null);
});

test('Linux uses the system Google Chrome (the CI runner image)', () => {
  assert.equal(vitestChromeBin({}, 'linux', has('/usr/bin/google-chrome')), '/usr/bin/google-chrome');
  assert.equal(vitestChromeBin({}, 'linux', has('/usr/bin/chromium')), '/usr/bin/chromium');
});

test('Windows prefers an installed Chrome, also a per-user one', () => {
  assert.equal(vitestChromeBin({}, 'win32', has(CHROME, EDGE)), CHROME);
  const local = 'C:/Users/x/AppData/Local';
  assert.equal(vitestChromeBin({ LOCALAPPDATA: local }, 'win32', has(`${local}/Google/Chrome/Application/chrome.exe`, EDGE)), `${local}/Google/Chrome/Application/chrome.exe`);
});

test('Windows without Chrome falls back to Edge', () => {
  assert.equal(vitestChromeBin({}, 'win32', has(EDGE)), EDGE);
});

test('nothing found leaves it to Playwright', () => {
  assert.equal(vitestChromeBin({}, 'linux', has()), null);
  assert.equal(vitestChromeBin({}, 'win32', has()), null);
  assert.equal(vitestChromeBin({}, 'darwin', has()), null);
});
