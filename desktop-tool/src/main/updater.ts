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
import { API_BASE, RELEASE_TOKEN, IS_UNSIGNED_DEV_BUILD, TOOL_VERSION } from '../lib/release-token.js';

// CommonJS interop — electron-updater's named exports aren't exposed via ESM.
const { autoUpdater } = electronUpdater;

export type UpdateEventPayload =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseDate?: string; notes?: string | null }
  | { type: 'not-available'; currentVersion: string }
  | { type: 'progress'; pct: number; bytesPerSecond?: number; transferred?: number; total?: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string };

const FEED_URL = `${API_BASE}/functions/v1/desktop-latest`;

let initialized = false;
let lastEvent: UpdateEventPayload = { type: 'not-available', currentVersion: TOOL_VERSION };

function broadcast(payload: UpdateEventPayload): void {
  lastEvent = payload;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sc:update:event', payload);
  }
}

export function getLastUpdateEvent(): UpdateEventPayload {
  return lastEvent;
}

export function initAutoUpdater(): void {
  if (initialized) return;
  initialized = true;

  if (IS_UNSIGNED_DEV_BUILD) {
    log.info('[updater] dev build — skipping auto-update');
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
  autoUpdater.on('error', (err) =>
    broadcast({ type: 'error', message: err?.message ?? String(err) }),
  );

  // Defer first check so the UI is interactive before any network call.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn('[updater] checkForUpdates failed:', err);
      broadcast({ type: 'error', message: err?.message ?? String(err) });
    });
  }, 4000);
}

export async function checkForUpdatesManually(): Promise<UpdateEventPayload> {
  if (IS_UNSIGNED_DEV_BUILD) {
    const ev: UpdateEventPayload = { type: 'not-available', currentVersion: TOOL_VERSION };
    broadcast(ev);
    return ev;
  }
  try {
    await autoUpdater.checkForUpdates();
    return lastEvent;
  } catch (err) {
    const ev: UpdateEventPayload = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    broadcast(ev);
    return ev;
  }
}

export function installUpdateNow(): void {
  if (IS_UNSIGNED_DEV_BUILD) return;
  // setImmediate so the IPC reply can finish before the app quits.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
}
