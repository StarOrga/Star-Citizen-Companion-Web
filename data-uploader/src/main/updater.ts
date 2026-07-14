/**
 * Auto-Update — Phase 2 § E1.
 *
 * Uses electron-updater's "generic" provider pointing at our Supabase Edge
 * Function `desktop-latest`. The function returns electron-updater-compatible
 * YAML metadata. Auth is via the X-SC-Release-Token header — the token is
 * baked into the Tool binary at build-time (per concept § B2).
 *
 * Update flow:
 *   1. App ready → check after 4 s (let renderer finish first paint)
 *   2. Found → download in background, notify renderer
 *   3. Downloaded → renderer can call sc:update:install (or installs on quit)
 *
 * Dev/unsigned builds skip the check (no release_token to validate).
 */

import { app, BrowserWindow } from 'electron';
import electronUpdater, { type UpdateInfo } from 'electron-updater';
import log from 'electron-log';
import {
  API_BASE,
  RELEASE_TOKEN,
  IS_UNSIGNED_DEV_BUILD,
  IS_PORTABLE_BUILD,
  TOOL_VERSION,
} from '../lib/release-token.js';
import { reportCrash } from './telemetry-reporter.js';

// CommonJS interop — electron-updater's named exports aren't exposed via ESM.
const { autoUpdater } = electronUpdater;

export type UpdateEventPayload =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseDate?: string; notes?: string | null }
  | { type: 'not-available'; currentVersion: string }
  | { type: 'progress'; pct: number; bytesPerSecond?: number; transferred?: number; total?: number }
  | { type: 'downloaded'; version: string }
  // Portable build with a NEWER version actually available on the feed. The
  // renderer shows a dismissible "download vX manually" hint on the first screen
  // only — never an error, and never when already up to date.
  | { type: 'manual'; currentVersion: string; latestVersion: string }
  | { type: 'error'; message: string };

const FEED_URL = `${API_BASE}/functions/v1/desktop-latest`;

/**
 * Re-check cadence for long-open sessions. The startup check alone never fires
 * again while the window stays open — so an uploader left running for hours (a
 * full extraction can take a while) would never notice a release published
 * mid-session. Mirrors the web app's SwUpdateService poll; a native, restart-
 * gated updater needn't be as eager as the 30-min web poll, so this is coarser.
 */
const UPDATE_POLL_MS = 6 * 60 * 60 * 1000;

let initialized = false;
let lastEvent: UpdateEventPayload = { type: 'not-available', currentVersion: TOOL_VERSION };

/**
 * True while an update is downloading or already staged. Re-checking then is
 * pointless (electron-updater is already on it) and could restart the download,
 * so the periodic poll skips these states.
 */
function isUpdateBusy(type: UpdateEventPayload['type']): boolean {
  return type === 'available' || type === 'progress' || type === 'downloaded';
}

function broadcast(payload: UpdateEventPayload): void {
  lastEvent = payload;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sc:update:event', payload);
  }
}

// De-dupe: the periodic poll + electron-updater emitting both a rejected
// promise AND an 'error' event for the same failure would otherwise report the
// identical error repeatedly. Only a *changed* message is worth a new report.
let lastReportedError: string | null = null;

/**
 * Forward an update failure to crash telemetry so 401s / feed outages show up
 * in the dashboard instead of dying silently in the renderer banner. Best-effort
 * and never throws (reportCrash swallows everything and honours the opt-out).
 */
function reportUpdateError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (message === lastReportedError) return;
  lastReportedError = message;
  void reportCrash({
    errorType: 'update',
    name: err instanceof Error ? err.name : null,
    message,
    stack: err instanceof Error ? (err.stack ?? null) : null,
    extra: { feed: FEED_URL, toolVersion: TOOL_VERSION },
  });
}

export function getLastUpdateEvent(): UpdateEventPayload {
  return lastEvent;
}

/**
 * Portable-only "is there a newer version?" check. The portable build can't
 * auto-update, but it CAN ask the same feed the auto-updater would (the feed
 * returns electron-updater YAML with a `version:` line) and, if that version is
 * newer than what's running, prompt a manual download. Best-effort: any failure
 * (offline, 401, malformed) simply yields no banner.
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(FEED_URL, {
      headers: {
        'X-SC-Release-Token': RELEASE_TOKEN,
        'X-SC-Tool-Version': TOOL_VERSION,
        Accept: 'application/yaml',
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/^\s*version:\s*['"]?(\d+\.\d+\.\d+[^\s'"]*)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Numeric x.y.z compare — true when `latest` is strictly newer than `current`. */
function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10));
  const b = current.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function checkPortableForUpdate(): Promise<void> {
  const latest = await fetchLatestVersion();
  if (latest && isNewerVersion(latest, TOOL_VERSION)) {
    broadcast({ type: 'manual', currentVersion: TOOL_VERSION, latestVersion: latest });
  } else {
    // Up to date (or feed unreachable) — no banner.
    broadcast({ type: 'not-available', currentVersion: TOOL_VERSION });
  }
}

export function initAutoUpdater(): void {
  if (initialized) return;
  initialized = true;

  if (IS_UNSIGNED_DEV_BUILD) {
    log.info('[updater] dev build — skipping auto-update');
    return;
  }

  if (IS_PORTABLE_BUILD) {
    // A portable exe can't replace itself in place while running (and the
    // portable target ships no app-update.yml), so electron-updater's in-place
    // flow only produces a confusing `ENOENT app-update.yml`. Skip it entirely.
    // Instead ask the feed whether a NEWER version exists and, only then, tell
    // the renderer to show a dismissible "download vX manually" hint.
    log.info('[updater] portable build — no in-place update; polling feed for a newer version');
    setTimeout(() => void checkPortableForUpdate(), 4000);
    setInterval(() => void checkPortableForUpdate(), UPDATE_POLL_MS);
    return;
  }

  // Pipe electron-updater's internal logger into electron-log (writes to
  // %USERPROFILE%/AppData/Roaming/<app>/logs/main.log on Windows).
  autoUpdater.logger = log;
  log.transports.file.level = 'info';

  // requestHeaders MUST be set on the autoUpdater instance directly.
  // electron-updater's setFeedURL() silently drops the `requestHeaders` field
  // from its options object — that branch only runs when options come from
  // app-update.yml via the updateConfigPath setter (AppUpdater.js L218-224).
  // Without this line the X-SC-Release-Token header never reaches the server,
  // and the Edge Function returns 401 unauthorized.
  autoUpdater.requestHeaders = {
    'X-SC-Release-Token': RELEASE_TOKEN,
    'X-SC-Tool-Version': TOOL_VERSION,
    Accept: 'application/yaml',
  };

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: FEED_URL,
    useMultipleRangeRequest: false,
  });

  // Don't install automatically — let the renderer decide so the user can
  // finish an extraction in progress before restarting.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => broadcast({ type: 'checking' }));
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    broadcast({
      type: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    }),
  );
  autoUpdater.on('update-not-available', () =>
    broadcast({ type: 'not-available', currentVersion: TOOL_VERSION }),
  );
  autoUpdater.on('download-progress', (p) =>
    broadcast({
      type: 'progress',
      pct: Math.round(p.percent ?? 0),
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total,
    }),
  );
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    broadcast({ type: 'downloaded', version: info.version }),
  );
  // electron-updater's canonical error channel — fires for check AND download
  // failures (the rejected promises below emit through here too), so this is the
  // single choke point where update errors reach both the banner and telemetry.
  autoUpdater.on('error', (err) => {
    broadcast({ type: 'error', message: err?.message ?? String(err) });
    reportUpdateError(err);
  });

  // Defer first check so the UI is interactive before any network call.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn('[updater] checkForUpdates failed:', err);
      broadcast({ type: 'error', message: err?.message ?? String(err) });
      // Some failures (e.g. a missing app-update.yml) only reject the promise
      // and never fire the 'error' event, so report here too — reportUpdateError
      // de-dupes so the 'error' handler firing as well is harmless.
      reportUpdateError(err);
    });
  }, 4000);

  // Re-check periodically so a long-open session eventually sees new releases.
  // Same silent path the renderer's navigation triggers use.
  setInterval(() => checkForUpdatesSilently(), UPDATE_POLL_MS);
}

/**
 * Silent, best-effort check. Used by the periodic poll AND by the renderer's
 * navigation triggers (opening the uploader, moving to the next step, …) now
 * that the manual "check for updates" button is gone. It NEVER paints an error
 * banner — a feed outage shouldn't nag the user every time they move between
 * steps — and it skips busy states so an in-flight download isn't disturbed.
 */
export function checkForUpdatesSilently(): void {
  if (IS_UNSIGNED_DEV_BUILD) return;
  if (isUpdateBusy(lastEvent.type)) return;
  if (IS_PORTABLE_BUILD) {
    void checkPortableForUpdate();
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => {
    log.warn('[updater] silent checkForUpdates failed:', err);
  });
}

export function installUpdateNow(): void {
  if (IS_UNSIGNED_DEV_BUILD) return;
  // setImmediate so the IPC reply can finish before the app quits.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
}
