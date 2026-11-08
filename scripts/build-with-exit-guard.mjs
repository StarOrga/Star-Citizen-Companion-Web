#!/usr/bin/env node
// build-with-exit-guard — runs `ng build --configuration production` and
// works around ng build's intermittent no-exit hang: the process writes
// its complete output ("Application bundle generation complete" + output
// location) and the dist artefacts land on disk, but the process itself
// never exits. Seen on Vercel's build box (documented in vercel-build.sh)
// and in local worktrees under heavy parallel-agent load (2026-09-20/21).
//
// Both paths (npm run build locally, scripts/vercel-build.sh on Vercel)
// now share this one guard:
//   - once the child's output contains the completion marker, a grace
//     timer starts (NG_BUILD_EXIT_GRACE_MS, default 30_000 ms)
//   - if ng hasn't exited by the time it fires AND both
//     dist/verse-companion/browser/index.html and .../ngsw.json exist, the
//     child is killed and the guard exits 0
//   - a hard ceiling (NG_BUILD_TIMEOUT_MS, default 300_000 ms) kills the
//     child regardless of the marker and fails the build unless the same
//     two artefacts exist
//   - any other non-zero ng exit code propagates unchanged
//
// Never call process.exit() here after the async spawn/I/O has started —
// on Node 24/Windows that aborts before stdio flushes (repo memory #589).
// Use process.exitCode instead and let the event loop drain naturally.

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export const COMPLETION_MARKER = 'Application bundle generation complete';

const DIST_INDEX = path.join(repoRoot, 'dist/verse-companion/browser/index.html');
const DIST_NGSW = path.join(repoRoot, 'dist/verse-companion/browser/ngsw.json');

/**
 * True only when every file exists AND was written at/after `since` (epoch
 * ms). A dist left over from an earlier build must never vouch for this one.
 */
export function freshArtefacts(files, since) {
  return files.every((file) => {
    try {
      return statSync(file).mtimeMs >= since;
    } catch {
      return false;
    }
  });
}

function defaultArtefactsComplete(since) {
  return freshArtefacts([DIST_INDEX, DIST_NGSW], since);
}

function killTree(child) {
  if (child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 5000).unref();
  }
}

/**
 * Runs `command args…` and applies the exit guard. Resolves with the exit
 * code the wrapper should use (never rejects — spawn errors resolve as 1).
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {number} [opts.graceMs]
 * @param {number} [opts.timeoutMs]
 * @param {(since: number) => boolean} [opts.artefactsComplete] receives the build start time (epoch ms)
 * @param {NodeJS.WritableStream} [opts.stdout]
 * @param {NodeJS.WritableStream} [opts.stderr]
 */
export function runGuarded(command, args, opts = {}) {
  const {
    cwd = repoRoot,
    graceMs = Number(process.env.NG_BUILD_EXIT_GRACE_MS) || 30_000,
    timeoutMs = Number(process.env.NG_BUILD_TIMEOUT_MS) || 300_000,
    artefactsComplete = defaultArtefactsComplete,
    stdout = process.stdout,
    stderr = process.stderr,
  } = opts;

  // 1s slack for coarse filesystem timestamps.
  const startedAt = Date.now() - 1000;
  const complete = () => artefactsComplete(startedAt);

  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'], shell: false });

    let sawCompletion = false;
    let graceTimer = null;
    let settled = false;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      clearTimeout(hardTimer);
      resolve(code);
    };

    const onOutput = (chunk, out) => {
      out.write(chunk);
      if (!sawCompletion && chunk.toString('utf8').includes(COMPLETION_MARKER)) {
        sawCompletion = true;
        graceTimer = setTimeout(() => {
          // After a stalled event loop (parallel-agent load) the timers phase
          // runs before pending child 'close' events, so a child that already
          // exited non-zero would be mistaken for a hang. Let the poll phase
          // deliver those events first, then decide.
          setImmediate(() => {
            if (settled || child.exitCode !== null) return;
            if (complete()) {
              stdout.write('ng build hung after completing output — proceeding under exit guard\n');
              killTree(child);
              finish(0);
            }
            // else: let it keep running until the hard ceiling decides.
          });
        }, graceMs);
      }
    };

    child.stdout.on('data', (chunk) => onOutput(chunk, stdout));
    child.stderr.on('data', (chunk) => onOutput(chunk, stderr));

    const hardTimer = setTimeout(() => {
      if (settled) return;
      killTree(child);
      if (complete()) {
        stdout.write('ng build hung after completing output — proceeding under exit guard\n');
        finish(0);
      } else {
        stderr.write(`ng build exceeded the ${timeoutMs}ms hard ceiling without producing complete artefacts\n`);
        finish(1);
      }
    }, timeoutMs);

    child.on('error', (err) => {
      stderr.write(`${err.message}\n`);
      finish(1);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      if (code === null) {
        // Killed by a signal we did not send: a stale or partial dist must
        // not turn that into success.
        finish(1);
        return;
      }
      finish(code ?? (signal ? 1 : 0));
    });
  });
}

async function main() {
  // Resolve the Angular CLI entry point directly rather than through `ng`
  // or `npx ng` — on Windows those resolve to a .cmd/.ps1 shim, which
  // forces a shell wrapper (`shell: true`) just to spawn it. Running
  // node_modules/@angular/cli/bin/ng.js with the current `node` binary
  // works identically on Windows/Linux/macOS with a plain, unshelled spawn.
  const ngBin = path.join(repoRoot, 'node_modules/@angular/cli/bin/ng.js');
  const ngArgs = ['build', '--configuration', 'production'];
  const command = existsSync(ngBin) ? process.execPath : 'npx';
  const args = existsSync(ngBin) ? [ngBin, ...ngArgs] : ['ng', ...ngArgs];

  const code = await runGuarded(command, args);
  process.exitCode = code;
}

// Only auto-run when executed directly (not when imported by the test spec).
// Compare resolved paths, not raw URL strings — file:// URLs and
// process.argv[1] disagree on slash direction on Windows.
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main();
}
