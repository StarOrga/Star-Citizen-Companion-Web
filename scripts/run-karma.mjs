/**
 * `npm test`: Karma in ChromeHeadless, with a browser fallback for machines
 * without Google Chrome (concept 2026-10-30, final report find).
 *
 * karma-chrome-launcher only looks for Chrome. On a Windows box that has Edge
 * but no Chrome, the run died before the first spec ("Please set env variable
 * CHROME_BIN"). Edge is Chromium and runs the suite unchanged, so when
 * CHROME_BIN is unset and no Chrome is installed, it is pointed at Edge.
 * CI (Linux, Chrome present) and any explicit CHROME_BIN are left alone.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

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

function main() {
  const env = { ...process.env };
  const bin = karmaChromeBin(env, process.platform, existsSync);
  if (bin) {
    env.CHROME_BIN = bin;
    console.log(`run-karma: no Chrome found, using ${bin}`);
  }
  const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');
  const child = spawn(process.execPath, [ng, 'test', '--watch=false', '--browsers=ChromeHeadless', ...process.argv.slice(2)], {
    env,
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
