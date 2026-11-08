/**
 * `npm run test:vitest`: the specs already moved to Vitest (angular.json →
 * test-vitest), in a real headless Chromium via Playwright.
 *
 * The unit-test builder hands CHROME_BIN to Playwright as the executable, so
 * no Playwright browser download is needed: CI's runner image sets CHROME_BIN
 * to its Google Chrome, and on a Windows box without Chrome the same Edge
 * fallback as `npm test` applies (scripts/lib/karma-chrome-bin.mjs). A box
 * with neither falls through to Playwright's own Chromium, if one was
 * installed with `npx playwright install chromium`.
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
    console.log(`run-vitest: no Chrome found, using ${bin}`);
  }
  const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');
  const child = spawn(process.execPath, [ng, 'run', 'verse-companion:test-vitest', ...process.argv.slice(2)], {
    env,
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

main();
