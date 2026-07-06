/**
 * Central logging + crash capture for the main process.
 *
 * MUST be the very first thing the app does (before any other module can throw)
 * so that a startup crash lands in a file instead of vanishing silently — the
 * exact failure mode that left v0.8.2 crashes untraceable.
 *
 * What it sets up:
 *   1. electron-log file transport, configured EAGERLY (not lazily inside the
 *      auto-updater, which only ran 4 s in and only for signed builds).
 *      → logs at %APPDATA%/<app>/logs/main.log on Windows.
 *   2. process-level uncaughtException / unhandledRejection handlers that log
 *      the error AND forward it to anonymous crash telemetry (opt-out).
 *   3. app lifecycle event logging (ready / quit / gpu-crash …).
 *
 * A renderer-side counterpart forwards window.onerror / unhandledrejection over
 * IPC (see index.ts `sc:log:*` handlers) so the whole app funnels into one file.
 */

import log from 'electron-log';
import { app } from 'electron';
import { reportCrash } from './telemetry-reporter.js';
import type { CrashInput } from '../lib/telemetry.js';

let initialized = false;

/** Configure transports + install crash handlers. Idempotent. */
export function initLogging(): void {
  if (initialized) return;
  initialized = true;

  // --- file transport, eagerly ---------------------------------------------
  // Write everything from 'info' up to disk, keep the console at 'debug' in dev.
  log.transports.file.level = 'info';
  log.transports.console.level = 'debug';
  log.transports.file.maxSize = 5 * 1024 * 1024; // rotate at 5 MB
  // Route Node's console.* through electron-log so stray logs are captured too.
  Object.assign(console, log.functions);

  // --- renderer bridge ------------------------------------------------------
  // Wire the IPC channel electron-log uses so any renderer that opts into it is
  // captured. (Our sandboxed renderer additionally forwards errors explicitly
  // via sc:log:* — see index.ts — because it cannot import electron-log directly.)
  try {
    log.initialize();
  } catch {
    /* older electron-log without initialize() — file transport still works */
  }

  // --- app lifecycle breadcrumbs -------------------------------------------
  log.info(`[app] starting — version ${app.getVersion()} · ${process.platform}/${process.arch}`);
  app.on('will-quit', () => log.info('[app] will-quit'));
  app.on('render-process-gone', (_e, _wc, details) => {
    log.error(`[app] render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
    void reportCrash({
      errorType: 'renderer-gone',
      name: 'RenderProcessGone',
      message: `reason=${details.reason} exitCode=${details.exitCode}`,
      stack: null,
      extra: { reason: details.reason, exitCode: details.exitCode },
    });
  });
  app.on('child-process-gone', (_e, details) => {
    log.error(`[app] child-process-gone: type=${details.type} reason=${details.reason}`);
  });

  // --- fatal error handlers -------------------------------------------------
  process.on('uncaughtException', (err) => {
    log.error('[uncaughtException]', err);
    void reportCrashAndMaybeQuit({
      errorType: 'uncaughtException',
      name: err?.name ?? 'Error',
      message: err?.message ?? String(err),
      stack: err?.stack ?? null,
    });
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log.error('[unhandledRejection]', err);
    // Rejections are frequently non-fatal — report, but do NOT tear the app down.
    void reportCrash({
      errorType: 'unhandledRejection',
      name: err.name,
      message: err.message,
      stack: err.stack ?? null,
    });
  });
}

/**
 * For a genuinely fatal uncaught exception: fire the crash report, give it a
 * brief grace window to reach the network, then quit. Swallowing an
 * uncaughtException and continuing leaves Electron in an undefined state, so we
 * exit deliberately once the report is on its way.
 */
async function reportCrashAndMaybeQuit(crash: CrashInput): Promise<void> {
  try {
    await Promise.race([
      reportCrash(crash),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } finally {
    // exit(1) rather than app.quit() — the app is already in a bad state and we
    // want the OS exit code to reflect a crash.
    app.exit(1);
  }
}

/** Structured log line from the renderer (via IPC). */
export function logFromRenderer(level: string, message: string): void {
  const fn =
    level === 'error' ? log.error
    : level === 'warn' ? log.warn
    : level === 'debug' ? log.debug
    : log.info;
  fn(`[renderer] ${message}`);
}
