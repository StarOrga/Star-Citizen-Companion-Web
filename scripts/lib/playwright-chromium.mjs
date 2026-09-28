/**
 * Playwright-Chromium discovery for the mobile gate (AUD-081).
 *
 * Linux containers (cloud sessions, CI images) often ship no system Chrome but
 * a Playwright browser cache: `<root>/chromium-<rev>/chrome-linux/chrome`.
 * The gate looks there after the fixed system paths.
 *
 * `chromium_headless_shell-*` is deliberately not a candidate: the gate needs
 * the full browser (window sizing, screenshots); set CHROME_BIN for anything else.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const EXECUTABLES = [
  'chrome-linux/chrome',
  'chrome-linux64/chrome',
  'chrome-win/chrome.exe',
  'chrome-win64/chrome.exe',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
];

/**
 * Pure: candidate executable paths for one browser root, newest revision first.
 * `entries` are the directory names inside `root`; anything that is not
 * `chromium-<number>` (e.g. a bare `chromium` folder) is skipped.
 */
export function playwrightChromiumCandidates(root, entries) {
  return entries
    .map((name) => ({ name, m: /^chromium-(\d+)$/.exec(name) }))
    .filter((e) => e.m)
    .sort((a, b) => Number(b.m[1]) - Number(a.m[1]))
    .flatMap((e) => EXECUTABLES.map((exe) => join(root, e.name, exe)));
}

/** Browser-cache roots in lookup order; missing ones are fine. */
export function playwrightRoots(env = process.env, platform = process.platform) {
  const roots = [];
  if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0') roots.push(env.PLAYWRIGHT_BROWSERS_PATH);
  roots.push(join(homedir(), '.cache', 'ms-playwright'));
  if (platform === 'win32' && env.LOCALAPPDATA) roots.push(join(env.LOCALAPPDATA, 'ms-playwright'));
  return roots;
}

/** First existing Playwright Chromium executable, or null. */
export function findPlaywrightChromium(env = process.env, platform = process.platform) {
  for (const root of playwrightRoots(env, platform)) {
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue; // a missing root is not an error
    }
    for (const c of playwrightChromiumCandidates(root, entries)) if (existsSync(c)) return c;
  }
  return null;
}
