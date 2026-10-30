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
import { karmaChromeBin } from './lib/karma-chrome-bin.mjs';

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

main();
