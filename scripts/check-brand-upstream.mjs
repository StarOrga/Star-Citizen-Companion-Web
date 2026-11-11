#!/usr/bin/env node
/**
 * Fail the build when the vendored master mark has fallen behind the desktop app.
 *
 * `public/icons/brand/vc-mark.svg` is a copy of the desktop app's
 * `modules/desktop/resources/app-icon-taskbar.svg`. Nothing tied the two
 * together, so the app redrew its icon on 2026-10-14 (#1450) and the web kept
 * showing the September artwork for a month (feedback #344). `check:brand-icons`
 * only proves the rasters match the copy, not that the copy matches the app.
 *
 * The app lives in a separate repository, so this can only run where a checkout
 * of it sits next to this one (`Star-Citizen-Companion-App`, found by walking up
 * from this repo, or `VC_APP_REPO`). On CI and Vercel there is none and the check
 * skips. It compares against the checkout's `origin/main` when that ref exists,
 * so a stale local branch in the app repo does not hide a newer icon; without a
 * fetch it is as fresh as the last `git fetch` there.
 *
 * Fix when it fails:
 *   git -C <app> show origin/main:modules/desktop/resources/app-icon-taskbar.svg > public/icons/brand/vc-mark.svg
 *   npm run gen:brand-icons
 * and rename the generated files if the change must reach existing caches (see
 * public/icons/brand/README.md, "Filenames are cache-busting").
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = join(ROOT, 'public/icons/brand/vc-mark.svg');
const UPSTREAM_PATH = 'modules/desktop/resources/app-icon-taskbar.svg';
const APP_DIR_NAME = 'Star-Citizen-Companion-App';

function findAppRepo() {
  if (process.env.VC_APP_REPO) return existsSync(process.env.VC_APP_REPO) ? process.env.VC_APP_REPO : null;
  // Worktrees sit several levels below the primary checkout, so walk up.
  let dir = ROOT;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dirname(dir), APP_DIR_NAME);
    if (existsSync(join(candidate, UPSTREAM_PATH))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function upstreamSvg(appRepo) {
  try {
    return execFileSync('git', ['-C', appRepo, 'show', `origin/main:${UPSTREAM_PATH}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return readFileSync(join(appRepo, UPSTREAM_PATH), 'utf8');
  }
}

const lf = (s) => s.replace(/\r\n/g, '\n');

const appRepo = findAppRepo();
if (!appRepo) {
  console.log('brand upstream: no desktop app checkout next to this repo, skipped.');
} else {
  const ours = lf(readFileSync(MASTER, 'utf8'));
  const theirs = lf(upstreamSvg(appRepo));
  if (ours !== theirs) {
    console.error(
      `\nbrand upstream: public/icons/brand/vc-mark.svg differs from ${APP_DIR_NAME}/${UPSTREAM_PATH}.\n` +
        'The desktop app has a newer icon. Re-vendor it:\n' +
        `  git -C "${appRepo}" show origin/main:${UPSTREAM_PATH} > public/icons/brand/vc-mark.svg\n` +
        '  npm run gen:brand-icons\n' +
        'See public/icons/brand/README.md before shipping (new file names for cache busting).',
    );
    process.exitCode = 1;
  } else {
    console.log('brand upstream: vc-mark.svg matches the desktop app.');
  }
}
