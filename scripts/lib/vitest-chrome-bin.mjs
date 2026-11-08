/** Browser for `npm test` (scripts/run-vitest.mjs). The unit-test builder hands CHROME_BIN
 *  to Playwright as the executable, so a system Chrome / Edge is enough and no Playwright
 *  browser download is needed. Kept in its own module so the entry script runs
 *  unconditionally: an is-main guard can silently skip the run (a junctioned checkout or a
 *  drive-letter case mismatch makes the URLs differ) and `npm test` exits green. */

const WIN_CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'];
const WIN_EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const LINUX_CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

/**
 * Pure: the CHROME_BIN to set, or null to leave the environment as it is (an explicit
 * CHROME_BIN, or nothing found — then Playwright looks for its own Chromium and its
 * error names the fix).
 */
export function vitestChromeBin(env, platform, exists) {
  if (env.CHROME_BIN) return null;
  if (platform === 'linux') return LINUX_CHROME.find((p) => exists(p)) ?? null;
  if (platform !== 'win32') return null;
  // Windows: Chrome first (LOCALAPPDATA covers a per-user install), then Edge — a box
  // with Edge but no Chrome used to die before the first spec under Karma (2026-10-30).
  const chrome = [...WIN_CHROME];
  if (env.LOCALAPPDATA) chrome.push(`${env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`);
  return chrome.find((p) => exists(p)) ?? WIN_EDGE.find((p) => exists(p)) ?? null;
}
