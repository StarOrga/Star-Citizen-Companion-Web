/** Browser fallback for `npm test` (scripts/run-karma.mjs). Kept in its own module so the
 *  entry script runs unconditionally: an is-main guard can silently skip Karma (a junctioned
 *  checkout or a drive-letter case mismatch makes the URLs differ) and `npm test` exits green. */
const WIN_CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const WIN_EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

/**
 * Pure: the CHROME_BIN to set, or null to leave the environment as it is.
 * Only Windows gets the fallback; LOCALAPPDATA covers a per-user Chrome.
 */
export function karmaChromeBin(env, platform, exists) {
  if (env.CHROME_BIN || platform !== 'win32') return null;
  const chrome = [...WIN_CHROME];
  if (env.LOCALAPPDATA) chrome.push(`${env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`);
  if (chrome.some((p) => exists(p))) return null;
  return WIN_EDGE.find((p) => exists(p)) ?? null;
}
