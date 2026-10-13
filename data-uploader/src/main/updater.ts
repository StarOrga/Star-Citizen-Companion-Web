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
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import electronUpdater, { type UpdateInfo } from 'electron-updater';
import log from 'electron-log';
import {
  API_BASE,
  RELEASE_TOKEN,
  IS_UNSIGNED_DEV_BUILD,
  IS_PORTABLE_BUILD,
  TOOL_VERSION,
} from '../lib/release-token.js';
import { isNewerVersion } from '../lib/semver.js';
import { isStagedSuperseded, shouldReplaceStaged } from '../lib/update-staleness.js';
import { fetchWithTimeout } from '../lib/fetch-timeout.js';
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

export type ReleaseChannel = 'alpha' | 'beta' | 'stable';

/**
 * The release ring the updater currently follows. Pushed in from the main
 * process (persisted in settings; default 'stable'). electron-updater requests
 * `<feed>/<channel>.yml`, which the desktop-latest edge function resolves to
 * that channel's pointer.
 */
let currentChannel: ReleaseChannel = 'stable';

/**
 * Re-check cadence for long-open sessions. The startup check alone never fires
 * again while the window stays open — so an uploader left running for hours (a
 * full extraction can take a while) would never notice a release published
 * mid-session. Mirrors the web app's 30-min SwUpdateService poll: the old 6 h
 * cadence let a release published an hour into an upload go unnoticed all
 * evening, because the upload view has no navigation to trigger a check. A
 * check is one small yml fetch; the download stages silently and installs on
 * quit, so a running upload is never interrupted.
 */
const UPDATE_POLL_MS = 30 * 60 * 1000;

let initialized = false;
let lastEvent: UpdateEventPayload = { type: 'not-available', currentVersion: TOOL_VERSION };

/**
 * True while an update is downloading. Re-checking then could restart the
 * download, so the periodic poll skips it. A STAGED update is not busy: a
 * session left open across two releases must still notice the newer one and
 * offer that instead (see checkForUpdatesSilently).
 */
function isUpdateBusy(type: UpdateEventPayload['type']): boolean {
  return type === 'available' || type === 'progress';
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
    const res = await fetchWithTimeout(`${FEED_URL}/${currentChannel}.yml`, {
      headers: {
        'X-SC-Release-Token': RELEASE_TOKEN,
        'X-SC-Tool-Version': TOOL_VERSION,
        Accept: 'application/yaml',
      },
    }, 15_000);
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/^\s*version:\s*['"]?(\d+\.\d+\.\d+[^\s'"]*)/m);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
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

export function initAutoUpdater(channel: ReleaseChannel = 'stable'): void {
  if (initialized) return;
  initialized = true;
  currentChannel = channel;

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

  // electron-updater appends `/<channel>.yml` to the feed URL for this value,
  // so the desktop-latest edge function serves the matching channel pointer.
  autoUpdater.channel = currentChannel;

  // Update THIS copy, wherever it lives: passed to the installer as /D=. Without
  // it the silent installer picks the folder from the registry, and with both a
  // per-user and a per-machine install recorded it may update the other one.
  (autoUpdater as typeof autoUpdater & { installDirectory?: string }).installDirectory = dirname(
    app.getPath('exe'),
  );

  checkPendingUpdate();

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: FEED_URL,
    useMultipleRangeRequest: false,
  });

  // Gate downloads ourselves (autoDownload OFF): the 'update-available' handler
  // below decides whether the offered version is actually NEWER than what the
  // user is running before pulling it. Left ON, electron-updater would download
  // (and, with autoInstallOnAppQuit, silently stage on quit) whatever the feed
  // returns — so a stale channel pointer could DOWNGRADE the app.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // While an update is staged, a background re-check stays invisible: the install
  // banner must not flicker to 'checking' every 30 min.
  autoUpdater.on('checking-for-update', () => {
    if (!stagedUpdate) broadcast({ type: 'checking' });
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    // Downgrade guard. electron-updater compares the feed version against the
    // packaged app.getVersion(); we additionally gate on TOOL_VERSION — the
    // version shown in the UI and the one the user reasons about. If the two
    // ever drift, or the selected ring's pointer is stale (e.g. `stable` still
    // points at an older release than an installed alpha/beta build), the feed
    // can offer a version that is NOT newer. Never download or stage that.
    if (!isNewerVersion(info.version, TOOL_VERSION)) {
      log.warn(
        `[updater] feed offered v${info.version}, not newer than running v${TOOL_VERSION} — ignoring (no downgrade)`,
      );
      // A staged installer is still valid — keep its banner up.
      const keep = stagedVersion();
      if (keep) broadcast({ type: 'downloaded', version: keep });
      else broadcast({ type: 'not-available', currentVersion: TOOL_VERSION });
      return;
    }
    // Already staged and the feed offers nothing newer: keep the staged update
    // (and its "install" banner) instead of downloading the same version again.
    const staged = stagedVersion();
    if (!shouldReplaceStaged(staged, info.version)) {
      broadcast({ type: 'downloaded', version: staged as string });
      return;
    }
    if (staged) log.info(`[updater] v${info.version} supersedes staged v${staged} — downloading the newer one`);
    broadcast({
      type: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    });
    // autoDownload is off — kick the background download for a genuine upgrade.
    autoUpdater.downloadUpdate().catch((err) => {
      log.warn('[updater] downloadUpdate failed:', err);
    });
  });
  autoUpdater.on('update-not-available', () => {
    // A re-check while an update is staged must not drop its install banner.
    const staged = stagedVersion();
    if (staged) broadcast({ type: 'downloaded', version: staged });
    else broadcast({ type: 'not-available', currentVersion: TOOL_VERSION });
  });
  autoUpdater.on('download-progress', (p) =>
    broadcast({
      type: 'progress',
      pct: Math.round(p.percent ?? 0),
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total,
    }),
  );
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    stagedUpdate = info.version;
    broadcast({ type: 'downloaded', version: info.version });
  });
  // electron-updater's canonical error channel — fires for check AND download
  // failures (the rejected promises below emit through here too), so this is the
  // single choke point where update errors reach both the banner and telemetry.
  autoUpdater.on('error', (err) => {
    installRequested = false;
    reportUpdateError(err);
    // A failed re-check (or a failed download of a newer release) must not take
    // away the install button of the update that is already staged.
    if (stagedUpdate) broadcast({ type: 'downloaded', version: stagedUpdate });
    else broadcast({ type: 'error', message: err?.message ?? String(err) });
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

/**
 * Switch the auto-update ring at runtime (from the role-gated renderer picker).
 * Re-points electron-updater at `<feed>/<channel>.yml` and immediately
 * re-checks so the banner reflects the newly-selected channel.
 */
export function setUpdateChannel(channel: ReleaseChannel): void {
  currentChannel = channel;
  if (IS_UNSIGNED_DEV_BUILD) return;
  if (IS_PORTABLE_BUILD) {
    void checkPortableForUpdate();
    return;
  }
  autoUpdater.channel = channel;
  checkForUpdatesSilently();
}

/**
 * An update installs SILENTLY into the existing installation. The installer is
 * the assisted NSIS one (so a first install can pick "only me / all users" and
 * the folder), but run with UI it walked the operator through that wizard again
 * on every update — defaulting to "only me", which would put a second copy in
 * %LOCALAPPDATA%\Programs next to a C:\Program Files install. Silent mode
 * (`/S --updated`) reuses the install mode and folder recorded in the registry
 * (`InstallLocation` under the app's GUID key) and elevates via UAC only when
 * the existing install is per-machine.
 */
const UPDATE_SILENT = true;

/** quitAndInstall fired once already — a second click must not queue another run. */
let installRequested = false;

/**
 * The version a silent install is expected to produce. A silent installer that
 * fails (UAC declined, a locked file, "app cannot be closed") shows nothing and
 * the old version simply starts again — so the next launch compares and says so.
 */
const PENDING_UPDATE_FILE = 'pending-update.json';

function pendingUpdatePath(): string {
  return join(app.getPath('userData'), PENDING_UPDATE_FILE);
}

function rememberPendingUpdate(version: string | null): void {
  if (!version) return;
  try {
    writeFileSync(pendingUpdatePath(), JSON.stringify({ version, at: Date.now() }), 'utf-8');
  } catch (err) {
    log.warn('[updater] could not record the pending update:', err);
  }
}

function checkPendingUpdate(): void {
  const path = pendingUpdatePath();
  if (!existsSync(path)) return;
  let expected: string | null = null;
  try {
    expected = (JSON.parse(readFileSync(path, 'utf-8')) as { version?: string }).version ?? null;
  } catch {
    /* unreadable marker — treat as absent */
  }
  try {
    rmSync(path, { force: true });
  } catch {
    /* best-effort */
  }
  if (!expected || !isNewerVersion(expected, TOOL_VERSION)) return;
  const message = `update to v${expected} did not install — still running v${TOOL_VERSION}`;
  log.warn(`[updater] ${message}`);
  reportUpdateError(new Error(message));
  // Shown once the renderer asks for the last event; the next successful check
  // replaces it with the normal "update available" flow.
  lastEvent = { type: 'error', message };
}

/**
 * Version of the staged update, from the last 'update-downloaded'. Kept apart
 * from lastEvent: a background re-check broadcasts other states in between, and
 * the staged installer stays valid through them.
 */
let stagedUpdate: string | null = null;

function stagedVersion(): string | null {
  return stagedUpdate;
}

export function installUpdateNow(): void {
  if (IS_UNSIGNED_DEV_BUILD) return;
  if (installRequested) return;
  installRequested = true;
  void installNewestStaged();
}

/**
 * Install what is staged — unless the feed meanwhile has a newer release: then
 * fetch that one instead (its banner returns once downloaded) rather than
 * installing a version that is already outdated. An unreachable feed installs
 * the staged update as before.
 */
async function installNewestStaged(): Promise<void> {
  const staged = stagedVersion();
  if (isStagedSuperseded(staged, await fetchLatestVersion())) {
    log.info(`[updater] staged v${staged} is outdated — fetching the newest release before installing`);
    installRequested = false;
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn('[updater] re-check before install failed:', err);
    });
    return;
  }
  rememberPendingUpdate(staged);
  // setImmediate so the IPC reply can finish before the app quits.
  setImmediate(() => {
    autoUpdater.quitAndInstall(UPDATE_SILENT, true);
    // quitAndInstall returns without quitting when the staged installer is
    // gone; re-arm the button instead of leaving it dead for the session.
    setTimeout(() => {
      installRequested = false;
    }, 15_000);
  });
}

/** The on-quit install (autoInstallOnAppQuit) is silent too — remember what it should produce. */
export function noteQuitWithStagedUpdate(): void {
  if (IS_UNSIGNED_DEV_BUILD || IS_PORTABLE_BUILD) return;
  if (!installRequested) rememberPendingUpdate(stagedVersion());
}
