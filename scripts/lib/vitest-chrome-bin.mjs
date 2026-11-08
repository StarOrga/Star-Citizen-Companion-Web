/** Browser for `npm run test:vitest` (scripts/run-vitest.mjs). The unit-test builder hands
 *  CHROME_BIN to Playwright as the executable, so a system Chrome / Edge is enough and no
 *  Playwright browser download is needed. */
import { karmaChromeBin } from './karma-chrome-bin.mjs';

const LINUX_CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

/**
 * Pure: the CHROME_BIN to set, or null to leave the environment as it is (an explicit
 * CHROME_BIN, an installed Chrome Playwright finds itself, or nothing at all — then
 * Playwright's own error names the fix).
 */
export function vitestChromeBin(env, platform, exists) {
  if (env.CHROME_BIN) return null;
  if (platform === 'win32') return karmaChromeBin(env, platform, exists);
  if (platform === 'linux') return LINUX_CHROME.find((p) => exists(p)) ?? null;
  return null;
}
