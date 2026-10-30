import assert from 'node:assert/strict';
import { test } from 'node:test';
import { karmaChromeBin } from './lib/karma-chrome-bin.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const has = (...paths) => (p) => paths.includes(p);

test('Windows without Chrome falls back to Edge', () => {
  assert.equal(karmaChromeBin({}, 'win32', has(EDGE)), EDGE);
});

test('an installed Chrome wins, nothing is set', () => {
  assert.equal(karmaChromeBin({}, 'win32', has(CHROME, EDGE)), null);
});

test('a per-user Chrome under LOCALAPPDATA counts as installed', () => {
  const local = 'C:/Users/x/AppData/Local';
  assert.equal(karmaChromeBin({ LOCALAPPDATA: local }, 'win32', has(`${local}/Google/Chrome/Application/chrome.exe`, EDGE)), null);
});

test('an explicit CHROME_BIN and non-Windows platforms are left alone', () => {
  assert.equal(karmaChromeBin({ CHROME_BIN: '/x/chrome' }, 'win32', has(EDGE)), null);
  assert.equal(karmaChromeBin({}, 'linux', has(EDGE)), null);
});

test('no browser at all leaves the launcher error as it was', () => {
  assert.equal(karmaChromeBin({}, 'win32', has()), null);
});
