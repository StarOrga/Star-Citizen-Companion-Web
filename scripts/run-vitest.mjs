/**
 * `npm test`: every spec under src/ on Vitest (angular.json → test),
 * in a real headless Chromium via Playwright.
 *
 * The unit-test builder hands CHROME_BIN to Playwright as the executable, so
 * no Playwright browser download is needed: on Linux (CI) the system Google
 * Chrome is used, on a Windows box without Chrome Edge
 * (scripts/lib/vitest-chrome-bin.mjs). A box with neither
 * falls through to Playwright's own Chromium, if one was installed with
 * `npx playwright install chromium`.
 *
 * Extra arguments go to `ng run`, e.g. `-- --include=app/feedback/x.spec.ts`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { vitestChromeBin } from './lib/vitest-chrome-bin.mjs';

function main() {
  const env = { ...process.env };
  const bin = vitestChromeBin(env, process.platform, existsSync);
  if (bin) {
    env.CHROME_BIN = bin;
    console.log(`run-vitest: browser ${bin}`);
  }
  const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');
  const child = spawn(process.execPath, [ng, 'run', 'verse-companion:test', ...process.argv.slice(2)], {
    env,
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

main();
