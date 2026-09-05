import { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { cpus } from 'node:os';
import log from 'electron-log';
import { initLogging, logFromRenderer } from './logging.js';
import { getSettings, setTelemetryEnabled, patchSettings, syncAutoStartWithOs } from './settings.js';
import { reportCrash, reportError, reportExtractAbort } from './telemetry-reporter.js';
import { classifyExtractAbort, type ExtractAbortReason } from '../lib/telemetry.js';
import { discoverAll, discoverManual } from '../lib/discovery.js';
import {
  PROFILES,
  DEFAULT_PROFILE,
  SELECTABLE_PROFILES,
  estimateForSize,
  workersFor,
} from '../lib/performance.js';
import { runOAuthFlow } from '../lib/oauth.js';
import { raiseWindow } from '../lib/window-focus.js';
import { uploadBundle, type UploadPayload } from '../lib/uploader.js';
import { createWatchdog } from '../lib/watchdog.js';
import { RELEASE_TOKEN, TOOL_VERSION, API_BASE, WEB_BASE } from '../lib/release-token.js';
import {
  initAutoUpdater,
  setUpdateChannel,
  checkForUpdatesSilently,
  installUpdateNow,
  getLastUpdateEvent,
} from './updater.js';
import {
  startExtraction,
  resolvePythonPaths,
  type ExtractRequest,
  type ExtractFinal,
  type PythonExtractEvent,
} from './python-bridge.js';
import {
  cleanupAfterUpload,
  scanAndCleanupDiscovered,
  purgeAllExtracts,
  type UploadMarkerInfo,
  type CleanupResult,
} from './cleanup.js';
import {
  startSkinExport,
  ensureConverter,
  type SkinExportRequest,
  type SkinExportFinal,
} from './skin-bridge.js';
import { uploadSkins, type SkinUploadResult } from './skin-ingest.js';
import { uploadCatalog, type CatalogUploadResult } from './catalog-bridge.js';
import {
  persistAuthResult,
  ensureAccessToken,
  fetchUserRole,
  getSessionStatus,
  clearSession,
  getCachedSnapshot,
  runSync,
} from './session.js';
import * as uploadJob from './upload-session.js';
import * as throttle from './throttle.js';
import { isInterrupt, PausedError } from '../lib/pause-control.js';
import { ProgressHub } from '../lib/progress-hub.js';
import { initTray, updateTray, destroyTray, notifyHidden, hasTray, type TrayMenuLabels } from './tray.js';
import { decideAutoRun, describeDecision, type AutoRunDecision } from '../lib/auto-run.js';

// Configure logging + install uncaughtException/unhandledRejection handlers
// before any window or IPC work, so a startup failure lands in main.log and
// crash telemetry instead of vanishing silently (the v0.8.2 failure mode).
initLogging();

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

/**
 * Resolve a runtime icon that ships under `build/` in dev but is copied to
 * `<resources>/` in the packaged app (electron-builder extraResources). Same
 * two-layout problem the tray solves — kept here so the BrowserWindow icon is
 * never a dead path in production.
 */
function runtimeIcon(name: string): string {
  const candidates = [
    join(process.resourcesPath ?? '', name),
    join(__dirname, '../../build', name),
  ];
  return candidates.find((p) => p && existsSync(p)) ?? candidates[candidates.length - 1]!;
}

// Main's own copy of pipeline progress — the tray renders from this, and must
// keep working while the window is hidden (i.e. with no renderer listening).
const hub = new ProgressHub();

// Set only by the tray's Quit item / app.quit(): distinguishes "the operator
// wants the process gone" from "the operator clicked X", which merely hides.
let quitting = false;

// Localized tray strings live in the renderer's i18n dictionary, so it pushes
// them to main. English defaults keep the tray sane before the first push (and
// if the renderer never loads).
let trayLabels: TrayMenuLabels = {
  open: 'Open',
  quit: 'Quit',
  pauseUpload: 'Pause upload',
  resumeUpload: 'Resume upload',
  idle: 'Idle',
  extract: 'Extraction',
  upload: 'Upload',
  done: 'done',
  error: 'failed',
  paused: 'paused',
};

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  // Reliable foregrounding (topmost-flash) so this works even when another app
  // (e.g. the browser right after the OAuth handoff) holds the OS foreground.
  raiseWindow(mainWindow);
}

function quitForReal(): void {
  quitting = true;
  destroyTray();
  app.quit();
}

/** True once the operator has been told where the window went (once per run). */
let hiddenNoticeShown = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#050810',
    title: 'Star Citizen Companion - Data Uploader',
    icon: runtimeIcon('icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Remove the native menu bar entirely (autoHideMenuBar still shows it on Alt-press).
  mainWindow.setMenu(null);

  // `--hidden` is passed by the autostart login item: come up straight into the
  // tray so an unattended run never steals focus at login.
  const startHidden = process.argv.includes('--hidden') && getSettings().minimizeToTray;
  mainWindow.on('ready-to-show', () => {
    if (startHidden) return;
    mainWindow?.show();
  });

  // X = minimize to tray. Intercept `close` (not `closed`) so the window is
  // merely hidden and any running extraction/upload keeps going. Guarded by
  // hasTray(): without a tray icon, hiding would make the app unreachable with
  // no way to get it back — in that case fall through to a real close.
  mainWindow.on('close', (e) => {
    if (quitting || !getSettings().minimizeToTray || !hasTray()) return;
    e.preventDefault();
    mainWindow?.hide();
    if (!hiddenNoticeShown) {
      hiddenNoticeShown = true;
      notifyHidden(trayLabels.hiddenHint ?? 'Still running in the tray.');
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only hand real web links to the OS browser. A renderer-driven window.open()
    // to file:// or a custom scheme must never reach shell.openExternal — that is
    // an arbitrary-protocol launch surface. Everything is denied in-window either
    // way; this just gates the external hand-off.
    try {
      const { protocol } = new URL(url);
      if (protocol === 'https:' || protocol === 'http:') {
        void shell.openExternal(url);
      } else {
        log.warn('[window-open] refused non-web url', { url });
      }
    } catch {
      log.warn('[window-open] refused unparseable url', { url });
    }
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// ============= IPC handlers =============

ipcMain.handle('sc:env', () => ({
  toolVersion: TOOL_VERSION,
  apiBase: API_BASE,
  webBase: WEB_BASE,
  releaseTokenFingerprint: RELEASE_TOKEN.slice(0, 8) + '…',
  platform: process.platform,
  // True only for the unattended autostart launch (`--hidden`). The renderer
  // uses this to require a fresh interactive login on a normal (foreground)
  // start, while letting the unattended auto-run reuse the persisted session.
  startedHidden: process.argv.includes('--hidden'),
}));

/**
 * A bearer token that is guaranteed fresh at call time. `ensureAccessToken`
 * silently refreshes a near-expiry session via the stored refresh token, so a
 * multi-hour upload keeps authorising instead of dying ~1h in. Falls back to the
 * token the renderer captured at stage start if the session store is somehow
 * unavailable.
 */
async function freshToken(fallback: string): Promise<string> {
  try {
    const r = await ensureAccessToken();
    return r.token ?? fallback;
  } catch {
    return fallback;
  }
}

// ============= Settings / Telemetry IPC =============

/** Everything the UI may see — deliberately excludes the opaque installId. */
function publicSettings(): {
  telemetryEnabled: boolean;
  minimizeToTray: boolean;
  autoStart: boolean;
  autoRunOnNewVersion: boolean;
  shutdownAfterUpload: boolean;
  quitAfterAutoRun: boolean;
  updateChannel: 'alpha' | 'beta' | 'stable';
} {
  const s = getSettings();
  // Never expose the raw installId to the renderer — it is an internal, opaque
  // dedup id.
  return {
    telemetryEnabled: s.telemetryEnabled,
    minimizeToTray: s.minimizeToTray,
    autoStart: s.autoStart,
    shutdownAfterUpload: s.shutdownAfterUpload,
    autoRunOnNewVersion: s.autoRunOnNewVersion,
    quitAfterAutoRun: s.quitAfterAutoRun,
    updateChannel: s.updateChannel,
  };
}

ipcMain.handle('sc:settings:get', () => publicSettings());

ipcMain.handle('sc:settings:setTelemetry', (_e, enabled: boolean) => {
  setTelemetryEnabled(Boolean(enabled));
  return publicSettings();
});

ipcMain.handle(
  'sc:settings:patch',
  (
    _e,
    partial: {
      minimizeToTray?: boolean;
      autoStart?: boolean;
      autoRunOnNewVersion?: boolean;
      shutdownAfterUpload?: boolean;
      quitAfterAutoRun?: boolean;
      updateChannel?: 'alpha' | 'beta' | 'stable';
    },
  ) => {
    // Whitelist: the renderer must not be able to write arbitrary keys (e.g.
    // overwrite installId) by posting an unexpected object.
    const clean: Parameters<typeof patchSettings>[0] = {};
    if (typeof partial?.minimizeToTray === 'boolean') clean.minimizeToTray = partial.minimizeToTray;
    if (typeof partial?.autoStart === 'boolean') clean.autoStart = partial.autoStart;
    if (typeof partial?.autoRunOnNewVersion === 'boolean') {
      clean.autoRunOnNewVersion = partial.autoRunOnNewVersion;
    }
    if (typeof partial?.shutdownAfterUpload === 'boolean') {
      clean.shutdownAfterUpload = partial.shutdownAfterUpload;
    }
    if (typeof partial?.quitAfterAutoRun === 'boolean') {
      clean.quitAfterAutoRun = partial.quitAfterAutoRun;
    }
    if (
      partial?.updateChannel === 'alpha' ||
      partial?.updateChannel === 'beta' ||
      partial?.updateChannel === 'stable'
    ) {
      clean.updateChannel = partial.updateChannel;
    }
    patchSettings(clean);
    // Re-point the auto-updater when the ring changed (re-checks the new feed).
    if (clean.updateChannel) setUpdateChannel(clean.updateChannel);
    return publicSettings();
  },
);

// ============= System power IPC =============

/** Run a shell command, resolving ok/err instead of throwing. */
function execAsync(cmd: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    exec(cmd, (err) => {
      if (err) {
        log.warn('[system] command failed', { cmd, error: err.message });
        resolve({ ok: false, error: err.message });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

// Schedule an OS shutdown with a cancelable grace window. The renderer only asks
// after a fully-confirmed upload AND when the operator opted in. `delaySeconds`
// is sanitised to a non-negative integer; the message is a fixed literal — no
// user-controlled data reaches the shell.
/**
 * Close the program from the renderer — the unattended launch's way out when
 * there was nothing to upload (feedback 71b1e402). Goes through `quitForReal`
 * so the tray icon is destroyed and `before-quit` still gets to flush pending
 * job telemetry; a plain `window.close()` would only hide us into the tray.
 */
ipcMain.handle('sc:system:quit', () => {
  log.info('[autorun] nothing to do after an unattended start — closing');
  quitForReal();
  return { ok: true };
});

ipcMain.handle('sc:system:shutdown', (_e, delaySeconds?: number) => {
  const secs =
    typeof delaySeconds === 'number' && Number.isFinite(delaySeconds)
      ? Math.max(0, Math.floor(delaySeconds))
      : 60;
  if (process.platform === 'win32') {
    return execAsync(`shutdown /s /t ${secs} /c "Star Citizen Companion: upload complete."`);
  }
  if (process.platform === 'darwin' || process.platform === 'linux') {
    // Unix `shutdown` takes minutes, not seconds, and typically needs privileges.
    const mins = Math.max(1, Math.ceil(secs / 60));
    return execAsync(`shutdown -h +${mins}`);
  }
  return Promise.resolve({ ok: false, error: `unsupported platform: ${process.platform}` });
});

ipcMain.handle('sc:system:abortShutdown', () => {
  if (process.platform === 'win32') return execAsync('shutdown /a');
  if (process.platform === 'darwin' || process.platform === 'linux') return execAsync('shutdown -c');
  return Promise.resolve({ ok: false, error: `unsupported platform: ${process.platform}` });
});

// ============= Tray IPC =============

// The renderer owns the i18n dictionary, so it pushes resolved tray strings to
// main on boot and on every locale change.
ipcMain.on('sc:tray:labels', (_e, labels: Partial<TrayMenuLabels>) => {
  trayLabels = { ...trayLabels, ...labels };
  updateTray(hub.get());
});

// ============= Auto-run IPC =============

/**
 * Decide whether to run the pipeline unattended: local data.p4k vs. what the
 * server already holds. Pure decision in `lib/auto-run`; this only gathers the
 * inputs. The renderer performs the run, because it owns the stage sequencing.
 */
ipcMain.handle('sc:autorun:decide', async (_e, signedIn: boolean): Promise<AutoRunDecision> => {
  const settings = getSettings();
  const decision = decideAutoRun({
    enabled: settings.autoRunOnNewVersion,
    signedIn: Boolean(signedIn),
    channels: settings.autoRunOnNewVersion ? await discoverAll() : [],
    snapshot: getCachedSnapshot(),
  });
  log.info(`[autorun] ${describeDecision(decision)}`);
  return decision;
});

// ============= Renderer logging / crash forwarding =============

ipcMain.on('sc:log:write', (_e, level: string, message: string) => {
  logFromRenderer(typeof level === 'string' ? level : 'info', String(message ?? ''));
});

ipcMain.on(
  'sc:log:crash',
  (_e, payload: { name?: string; message?: string; stack?: string | null }) => {
    logFromRenderer('error', `crash: ${payload?.name ?? 'Error'}: ${payload?.message ?? ''}`);
    void reportCrash({
      errorType: 'renderer',
      name: payload?.name ?? 'Error',
      message: payload?.message ?? '',
      stack: payload?.stack ?? null,
    });
  },
);

ipcMain.handle('sc:discover', async () => {
  return discoverAll();
});

ipcMain.handle('sc:discoverManual', async (_e, folderPath: string) => {
  return discoverManual(folderPath);
});

ipcMain.handle('sc:pickFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Star-Citizen-Channel-Ordner wählen',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

// Only the profiles that do what they say. `auto` stays defined (the throttle
// still accepts it, and Phase 2 will implement it) but is not offered: as a
// pill it read "Smart" while its only real effect was BelowNormal, so the
// smart-sounding choice quietly made the run slower than Standard.
ipcMain.handle('sc:profiles', () => ({
  profiles: Object.fromEntries(SELECTABLE_PROFILES.map((id) => [id, PROFILES[id]])),
  default: DEFAULT_PROFILE,
}));

ipcMain.handle('sc:estimate', (_e, profileId: keyof typeof PROFILES, sizeBytes: number) =>
  estimateForSize(profileId, sizeBytes),
);

// ============= Live performance-profile IPC =============
//
// The profile is owned by MAIN, not by the renderer's `state.profile`, because
// it has to keep steering sidecars that outlive a renderer reload — and because
// only main knows their pids. The renderer holds a display mirror and re-reads
// this on every switch.

ipcMain.handle('sc:perf:get', () => throttle.view());

// The one write path. Returns how many running sidecars the new profile
// actually reached, so the UI can say "applied to the running job" instead of
// implying an effect that never left the process.
ipcMain.handle('sc:perf:set', (_e, profileId: unknown) => {
  const result = throttle.set(profileId);
  // Every window mirrors the switch — including the one that did not send it,
  // and the Configure screen when the change came from the Run screen.
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('sc:perf:changed', result);
  }
  return result;
});

ipcMain.handle('sc:authenticate', async () => {
  const result = await runOAuthFlow(WEB_BASE);
  // Persist the session (encrypted) so the operator signs in ONCE. Best-effort:
  // a keyring-less OS falls back to in-memory (re-auth next launch).
  if (result.ok) {
    try {
      persistAuthResult(result);
    } catch {
      /* persistence is best-effort; never block the auth result on it */
    }
    // The OAuth handoff finishes in the browser, which now owns the OS
    // foreground. Pull our window back to the front so the operator lands in
    // the uploader instead of having to alt-tab back from the "you can close
    // this window" browser tab.
    try {
      showMainWindow();
    } catch {
      /* foregrounding is best-effort; never block the auth result on it */
    }
  }
  return result;
});

// ============= Session / Sync IPC =============

ipcMain.handle('sc:session:status', async () => getSessionStatus());

ipcMain.handle('sc:session:token', async () => {
  const r = await ensureAccessToken();
  return { token: r.token, email: r.email, reconnect: r.reconnect };
});

ipcMain.handle('sc:session:signOut', () => {
  clearSession();
  return { ok: true };
});

ipcMain.handle('sc:session:role', async () => fetchUserRole());

ipcMain.handle('sc:sync:cached', () => getCachedSnapshot());

ipcMain.handle('sc:sync:start', async (event) =>
  runSync((p) => event.sender.send('sc:sync:event', p)),
);

// ============= Resumable upload-job IPC =============

// The job file is the only thing that survives a kill, so every stage boundary
// below writes through it before doing network work.

ipcMain.handle('sc:upload:job', () => uploadJob.view());

// After a restart the renderer has no extraction result to resume with — hand
// it one rebuilt from the durable job + manifest (or say why that is impossible).
ipcMain.handle('sc:upload:rehydrate', () => uploadJob.rehydrate());

ipcMain.handle('sc:upload:begin', (_e, outDir: string, nat: { channel: string; patchVersion: string; buildNumber: string }) =>
  uploadJob.begin(outDir, nat),
);

/**
 * Stop local sidecar work that a cooperative checkpoint can never reach.
 *
 * The catalog stage is a chunk loop inside THIS process, so `PauseControl`
 * unwinds it at the next boundary. The 3D-skin **build** is a Python child that
 * runs for hours and never asks anyone for permission — so before this, hitting
 * Pause during a build looked completely dead: the job file flipped to
 * `paused`, the button did its thing, and the machine kept grinding for another
 * two hours.
 *
 * Killing it is safe precisely because that build is resumable:
 * `skin_export_app` writes a ship's `skins.json` only once that ship is fully
 * exported, and `--skip-existing` keys on exactly that file — so a resume
 * rebuilds only the one ship that was in flight and skips everything already
 * finished. Returns true when something was actually interrupted.
 */
function interruptLocalSkinBuild(): boolean {
  let hit = false;
  for (const job of activeJobs.values()) {
    if (job.kind !== 'skin') continue;
    job.cancel();
    hit = true;
  }
  if (hit) log.info('[upload-job] pause/cancel interrupted the in-flight 3D-skin build');
  return hit;
}

ipcMain.handle('sc:upload:pause', () => {
  hub.setPaused(true);
  const view = uploadJob.pause();
  // Do this AFTER the job flipped to `paused`: the renderer reads the job view
  // to tell "operator paused me" apart from "the build crashed".
  interruptLocalSkinBuild();
  return view;
});
ipcMain.handle('sc:upload:resume', () => {
  hub.setPaused(false);
  return uploadJob.resume();
});
// NOTE: deliberately NO telemetry here. A cancelled upload loses nothing — the
// persisted job file lets the operator resume it — so it is not an incident.
// Only *extraction* aborts are reported (see requestExtractAbort).
ipcMain.handle('sc:upload:cancel', () => {
  hub.setPaused(false);
  hub.finish('upload', 'error');
  const view = uploadJob.cancel();
  interruptLocalSkinBuild();
  return view;
});

// Record a hard stage failure without dropping the job file, so the upload view
// can still offer "continue" instead of silently starting the next run from
// zero. (`finish` is the success path — it deletes the job.)
ipcMain.handle('sc:upload:fail', (_e, error: string) => {
  uploadJob.fail(String(error ?? 'unknown'));
  hub.setPaused(false);
  hub.finish('upload', 'error');
  return uploadJob.view();
});
ipcMain.handle('sc:upload:finish', () => {
  uploadJob.finish();
  hub.setPaused(false);
  hub.finish('upload', 'done');
  return { ok: true };
});

ipcMain.handle('sc:upload', async (_e, payload: UploadPayload) => {
  // Skip a bundle POST this job already confirmed — a resume must not create a
  // second bundle row for the same extract.
  const job = uploadJob.get();
  if (job?.bundle.status === 'done' && job.bundle.bundleId) {
    return { ok: true, bundleId: job.bundle.bundleId, prevBundleId: null, diffSummary: null };
  }
  // Record the attempt BEFORE the POST: if we die in-flight we cannot know
  // whether the row landed, and `bundleNeedsRetry` uses this to say so.
  uploadJob.update((s) => ({ ...s, bundle: { ...s.bundle, status: 'running', attempted: true } }));
  hub.start('upload');
  hub.update('upload', 'bundle', null);
  // Refresh the token right before the POST — a resume can fire this long after
  // the renderer captured its token.
  const result = await uploadBundle(API_BASE, {
    ...payload,
    accessToken: await freshToken(payload.accessToken),
  });
  if (result.ok) {
    uploadJob.update((s) => ({
      ...s,
      bundle: { status: 'done', bundleId: result.bundleId ?? null, attempted: true },
    }));
  }
  // A timed-out upload throws nothing (we catch the AbortError internally), so
  // surface it to crash telemetry here — otherwise a hung upload is invisible.
  if (!result.ok && result.error === 'timeout') {
    void reportCrash({
      errorType: 'timeout',
      name: 'UploadTimeout',
      message: 'ingest-bundle upload aborted after client timeout',
      stack: null,
      extra: { channel: payload.channel, patchVersion: payload.patchVersion },
    });
  } else if (!result.ok) {
    // Handled upload failure (HTTP 4xx/5xx, network error) — surfaced to the
    // operator but previously never telemetried (#212), so the dashboard showed
    // 0 errors while operators hit them.
    void reportError('upload-failed', new Error(result.error ?? 'upload failed'), {
      channel: payload.channel,
      patchVersion: payload.patchVersion,
    });
  }
  return result;
});

// Sandboxed renderers can't reach the `clipboard` module, and navigator.clipboard
// is unreliable over file:// — route copy requests through the main process.
ipcMain.handle('sc:clipboard:write', (_e, text: string) => {
  clipboard.writeText(typeof text === 'string' ? text : String(text));
  return { ok: true };
});

// ============= Auto-Update IPC =============

ipcMain.handle('sc:update:status', () => getLastUpdateEvent());
// Fire-and-forget silent check driven by renderer navigation — results flow
// back through the sc:update:event broadcast, so no reply is needed.
ipcMain.on('sc:update:check-silent', () => checkForUpdatesSilently());
ipcMain.handle('sc:update:install', () => {
  installUpdateNow();
  return { ok: true };
});

// ============= Extract IPC =============

interface ActiveJob {
  /** Extraction aborts are telemetried; skin exports are not. */
  kind: 'extract' | 'skin';
  cancel: () => void;
  /**
   * Set the moment an abort is *requested* (operator cancel / app quit). Two
   * jobs it does: it records why, and it marks the abort as already reported so
   * the promise-resolution path doesn't send a second, duplicate event.
   */
  abortReason: ExtractAbortReason | null;
  startedAt: number;
  /** Last progress the sidecar reported — context for the abort payload. */
  lastPhase: string | null;
  lastPct: number | null;
  /** Where this job writes. The extract purge must never delete it. */
  outDir: string | null;
}
const activeJobs = new Map<string, ActiveJob>();

function newActiveJob(kind: ActiveJob['kind'], outDir: string | null = null): ActiveJob {
  return {
    kind,
    cancel: () => {},
    abortReason: null,
    startedAt: Date.now(),
    lastPhase: null,
    lastPct: null,
    outDir,
  };
}

/** Output dirs of every job running right now — the purge's keep-list. */
function liveJobOutDirs(): string[] {
  return [...activeJobs.values()].map((j) => j.outDir).filter((d): d is string => !!d);
}

/**
 * The install root behind an extract dir (`<root>/.sc-companion-extracts/<run>`),
 * as a 0- or 1-element list to hand the purge as an extra root. Keeps the
 * current install in scope even when discovery finds nothing.
 */
function installRootOf(outDir: string | undefined | null): string[] {
  if (!outDir) return [];
  const root = dirname(dirname(outDir));
  return root && root !== '.' ? [root] : [];
}

/**
 * The extract dir a paused/unfinished upload would resume from, if there is
 * one. A new extraction must not pull that out from under it — the renderer
 * takes the same care before its own post-upload cleanup. Once an upload
 * completes, the job file is dropped and this dir is fair game again.
 */
function resumableUploadOutDir(): string[] {
  const { state, resumable } = uploadJob.view();
  return resumable && state?.outDir ? [state.outDir] : [];
}

/**
 * Report an extraction abort that was just *requested* (operator cancel, app
 * quit). Reports here rather than at promise resolution because on quit the
 * process can be gone before the killed child's `exit` ever resolves it.
 *
 * Returns the in-flight report so the quit path can give it a grace window, or
 * null when there is nothing to send (not an extraction, or already reported).
 */
function requestExtractAbort(
  jobId: string,
  job: ActiveJob,
  reason: ExtractAbortReason,
): Promise<boolean> | null {
  if (job.kind !== 'extract' || job.abortReason) return null;
  job.abortReason = reason;
  return reportExtractAbort(reason, {
    jobId,
    phase: job.lastPhase,
    pct: job.lastPct,
    elapsedMs: Date.now() - job.startedAt,
  });
}

/** Report an extraction that ENDED badly on its own (sidecar failure/crash). */
function reportExtractOutcome(
  jobId: string,
  job: ActiveJob,
  final: { ok: boolean; error?: string | null },
): void {
  const reason = classifyExtractAbort(final, job.abortReason);
  if (!reason) return;
  void reportExtractAbort(reason, {
    jobId,
    phase: job.lastPhase,
    pct: job.lastPct,
    elapsedMs: Date.now() - job.startedAt,
    error: final.error ?? null,
  });
}

// A long-running native job (Python extract / cgf-converter skin export) that
// stops emitting events for this long is treated as WEDGED and reported to
// crash telemetry — a silent hang produces no exception on its own, so without
// this it would be invisible server-side. Generous enough to clear the longest
// legitimately-opaque stages ("open" the archive, "datacore" decompress).
const JOB_STALL_MS = 5 * 60_000;

/** Fire a one-shot stall crash report for a wedged native job. */
function reportJobStall(kind: string, idleMs: number, jobId: string): void {
  void reportCrash({
    errorType: 'hang',
    name: 'JobStall',
    message: `${kind} job made no progress for ${Math.round(idleMs / 1000)}s`,
    stack: null,
    extra: { kind, jobId, idleMs },
  });
}

ipcMain.handle('sc:extract:env', () => {
  const paths = resolvePythonPaths();
  return { interpreter: paths.interpreter, cwd: paths.cwd, source: paths.source };
});

ipcMain.handle('sc:extract:start', async (event, req: ExtractRequest): Promise<ExtractFinal> => {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Resolve the parallelism HERE, from the profile that is live at the moment
  // the sidecar starts — not from whatever the renderer had on screen when the
  // operator first opened Configure. Main owns the live profile (see
  // `main/throttle.ts`), so this is the only place that can be right.
  const liveProfile = throttle.control().profile();
  req = {
    ...req,
    workers: workersFor(liveProfile, cpus().length || 1),
    memCapMb: PROFILES[liveProfile].ramCapMb,
  };
  const watchdog = createWatchdog({
    timeoutMs: JOB_STALL_MS,
    onTimeout: (idle) => reportJobStall('extract', idle, jobId),
  });
  // A new extraction means every earlier extract on disk is superseded — drop
  // them all BEFORE the sidecar starts writing, so two full extracts never sit
  // side by side and fill the drive. The dir this run is about to fill and any
  // dir a concurrent job owns are excluded; `extraRoots` covers this install
  // even if discovery comes back empty.
  const purge = await purgeAllExtracts(
    [req.outDir, ...liveJobOutDirs(), ...resumableUploadOutDir()],
    installRootOf(req.outDir),
  );
  if (purge.removed > 0) {
    event.sender.send('sc:extract:event', {
      jobId,
      type: 'log',
      message: `cleanup: removed ${purge.removed} older extract folder(s)`,
      level: 'info',
    });
  }

  hub.start('extract');
  const job = newActiveJob('extract', req.outDir);
  const handle = startExtraction(req, (ev: PythonExtractEvent) => {
    watchdog.pet(); // every event is a sign of life — reset the stall timer
    // Mirror into main's hub so the tray shows extraction progress even while
    // the window is hidden.
    const e = ev as { phase?: string; pct?: number };
    if (typeof e.phase === 'string' || typeof e.pct === 'number') {
      // Remember the last position too: if the run is aborted, this is the only
      // clue the telemetry row has about HOW FAR it got.
      if (typeof e.phase === 'string') job.lastPhase = e.phase;
      if (typeof e.pct === 'number') job.lastPct = e.pct;
      hub.update('extract', e.phase ?? null, typeof e.pct === 'number' ? e.pct : null);
    }
    event.sender.send('sc:extract:event', { jobId, ...ev });
  });
  job.cancel = handle.cancel;
  activeJobs.set(jobId, job);
  // Hand the sidecar to the live throttle: it gets the profile in effect NOW,
  // and every later switch reaches it without restarting the extraction.
  throttle.registerJob(jobId, handle.pid);
  watchdog.start();
  try {
    const final = await handle.promise;
    hub.finish('extract', final.ok ? 'done' : 'error');
    // Covers what the old 'extract-failed' report could not: the bridge RESOLVES
    // (never throws) for a dead sidecar, a non-zero exit, or a missing 'done'
    // event, so those failures used to reach telemetry not at all.
    reportExtractOutcome(jobId, job, final);
    return final;
  } catch (err) {
    hub.finish('extract', 'error');
    const message = err instanceof Error ? err.message : String(err);
    reportExtractOutcome(jobId, job, { ok: false, error: message });
    return { ok: false, error: message };
  } finally {
    watchdog.stop();
    activeJobs.delete(jobId);
    // Deregister BEFORE the OS can recycle the pid — a later switch must never
    // re-prioritise whatever process inherited this number.
    throttle.unregisterJob(jobId);
  }
});

// ============= Ship-skin IPC =============

// Ensure the cgf-converter build tool is present (downloads on first use,
// streaming progress to the renderer). Returns its on-disk path.
ipcMain.handle('sc:skin:ensureTools', async (event) => {
  try {
    const path = await ensureConverter((pct) =>
      event.sender.send('sc:skin:toolProgress', { pct }),
    );
    return { ok: true, path };
  } catch (err) {
    void reportError('skin-tools-failed', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('sc:skin:start', async (event, req: SkinExportRequest): Promise<SkinExportFinal> => {
  const jobId = `skin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const watchdog = createWatchdog({
    timeoutMs: JOB_STALL_MS,
    onTimeout: (idle) => reportJobStall('skin', idle, jobId),
  });
  const job = newActiveJob('skin', req.outDir);
  const handle = startSkinExport(req, (ev) => {
    watchdog.pet();
    event.sender.send('sc:skin:event', { jobId, ...ev });
  });
  job.cancel = handle.cancel;
  activeJobs.set(jobId, job);
  throttle.registerJob(jobId, handle.pid);
  watchdog.start();
  try {
    const final = await handle.promise;
    // The build is killed from two places that mean opposite things: an
    // operator pause/cancel (control flow — the run is meant to continue later)
    // and a real crash. Only the job signal can tell them apart, so translate
    // here rather than letting the renderer paint a red "build failed" over an
    // interruption the operator asked for.
    if (!final.ok && final.error === 'cancelled') {
      const signal = uploadJob.view().signal;
      if (signal !== 'running') return { ok: false, error: signal };
    }
    return final;
  } catch (err) {
    void reportError('skin-failed', err, { jobId });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    watchdog.stop();
    activeJobs.delete(jobId);
    throttle.unregisterJob(jobId);
  }
});

ipcMain.handle('sc:skin:cancel', (_e, jobId: string) => {
  const job = activeJobs.get(jobId);
  if (!job) return { ok: false, error: 'unknown_job' };
  job.cancel();
  return { ok: true };
});

ipcMain.handle(
  'sc:skin:upload',
  async (event, accessToken: string, ships: { shipId: string; dir: string }[]): Promise<SkinUploadResult[]> => {
    try {
      const results = await uploadSkins(
        // Getter, not a static token: multi-GB ships take long enough that the
        // captured JWT would expire; re-read a fresh one per ingest call.
        () => freshToken(accessToken),
        ships,
        (message, level) => {
          // Mirror the bad news into main.log as well. A per-ship failure used
          // to exist only in a renderer event nobody was listening for, so a
          // run that shipped 21 of 309 ships left no trace of what went wrong
          // with the other 288 — not on screen, not on disk.
          if (level === 'warn' || level === 'error') log[level](`[skin-upload] ${message}`);
          event.sender.send('sc:skin:event', { jobId: 'upload', type: 'log', message, level: level ?? 'info' });
        },
        {
          ...uploadJob.hooksForSkins(),
          onProgress: (done, total, shipId) => {
            hub.update('upload', 'skins', total > 0 ? (done / total) * 100 : null);
            event.sender.send('sc:skin:event', {
              jobId: 'upload',
              type: 'progress',
              stage: 'skins',
              current: done,
              total,
              detail: shipId,
            });
          },
        },
      );
      uploadJob.update((s) => ({ ...s, skins: { ...s.skins, status: 'done' } }));
      const live = results.filter((r) => r.ok && !r.empty).length;
      const empty = results.filter((r) => r.empty).length;
      const failed = results.filter((r) => !r.ok);
      log.info(
        `[skin-upload] ${results.length} ship(s): ${live} uploaded, ${empty} without a built livery, ${failed.length} failed`,
      );
      if (failed.length) {
        log.warn(`[skin-upload] failed ships: ${failed.map((r) => `${r.ship_id} (${r.error})`).join(', ')}`);
      }
      return results;
    } catch (err) {
      if (isInterrupt(err)) {
        // Paused/cancelled between ships — the renderer reads the job view to
        // learn that, so an empty result here is not an error.
        event.sender.send('sc:upload:paused', uploadJob.view());
        return [];
      }
      throw err;
    }
  },
);

// ============= Catalog-promotion IPC =============

// Feed the just-uploaded extract into the public Codex (codex_* tables) via
// ingest-catalog. Runs AFTER the bundle upload and BEFORE cleanup so the
// out_dir still exists. Streams per-table progress to the renderer.
ipcMain.handle(
  'sc:catalog:upload',
  async (event, accessToken: string, outDir: string): Promise<CatalogUploadResult> => {
    try {
      const result = await uploadCatalog(
        // Getter, not a static token: the catalog stage runs for hours, so each
        // chunk request re-reads a fresh (auto-refreshed) JWT.
        () => freshToken(accessToken),
        outDir,
        (p) => {
          // Two-tier: the overall publish step drives the tray's percentage,
          // since the per-table current/total resets on every table.
          const pct =
            typeof p.phaseIndex === 'number' && typeof p.phaseTotal === 'number' && p.phaseTotal > 0
              ? ((p.phaseIndex - 1 + (p.total > 0 ? p.current / p.total : 0)) / p.phaseTotal) * 100
              : null;
          hub.update('upload', p.phase, pct);
          event.sender.send('sc:catalog:event', p);
        },
        uploadJob.hooksForCatalog(),
      );
      if (result.ok) uploadJob.update((s) => ({ ...s, catalog: { ...s.catalog, status: 'done' } }));
      return result;
    } catch (err) {
      if (isInterrupt(err)) {
        event.sender.send('sc:upload:paused', uploadJob.view());
        return { ok: false, error: err instanceof PausedError ? 'paused' : 'cancelled' };
      }
      throw err;
    }
  },
);

// ============= Cleanup IPC =============

ipcMain.handle(
  'sc:cleanup:extractDir',
  async (_e, outDir: string, info: UploadMarkerInfo): Promise<CleanupResult> => {
    const own = await cleanupAfterUpload(outDir, info ?? {});
    // The renderer only reaches this once the WHOLE upload (bundle + codex +
    // skins) is confirmed, so nothing on disk is needed any more — sweep the
    // leftovers of earlier runs too, not just this run's dir. Best-effort: the
    // per-run result is what the operator's status line reports.
    //
    // Except the livery build cache: this is the ONE call site that knows which
    // patch is current, so it is the only one allowed to reclaim a stale
    // `skins-<version>` dir. Purging this patch's cache here would throw away
    // the hours of glb work that make the next attempt cheap — and every ship
    // that failed to upload would have to be rebuilt from scratch.
    await purgeAllExtracts(liveJobOutDirs(), installRootOf(outDir), {
      keepSkinsVersion: info?.version,
    });
    return own;
  },
);

ipcMain.handle('sc:extract:cancel', (_e, jobId: string) => {
  const job = activeJobs.get(jobId);
  if (!job) return { ok: false, error: 'unknown_job' };
  // Operator-driven extraction abort — telemetried before the kill, so the
  // report is on the wire even if the teardown goes sideways. Fire-and-forget:
  // cancelling must never wait on (or fail because of) the network.
  void requestExtractAbort(jobId, job, 'cancelled');
  job.cancel();
  return { ok: true };
});

// ============= App lifecycle =============

// Single-instance lock: a second double-click on the .exe focuses the
// existing window instead of spawning a duplicate app process. The portable
// wrapper still extracts to TEMP and launches the actual app — that briefly
// shows two entries in the taskbar — but at most one app window exists.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  // Also un-hides a tray-resident instance: double-clicking the .exe while the
  // app sits in the tray should bring the window back, not appear to do nothing.
  showMainWindow();
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.sc-companion.data-uploader');
  Menu.setApplicationMenu(null); // Belt-and-suspenders alongside per-window setMenu(null)
  createWindow();
  // Tray first, then the close handler can safely rely on hasTray().
  initTray(
    {
      show: showMainWindow,
      quit: quitForReal,
      pause: () => {
        uploadJob.pause();
        hub.setPaused(true);
        interruptLocalSkinBuild();
      },
      resume: () => {
        uploadJob.resume();
        hub.setPaused(false);
        // Resuming is renderer-driven (it sequences the stages), so ask it to
        // pick the job back up. Restore the window: an upload the operator just
        // resumed by hand is something they want to watch.
        showMainWindow();
        mainWindow?.webContents.send('sc:upload:resumeRequested');
      },
      labels: () => trayLabels,
    },
    hub.get(),
  );
  // Keep the tray text in lockstep with pipeline progress.
  hub.onChange((s) => updateTray(s));
  // The OS Run key is the source of truth for autostart; re-assert our stored
  // preference in case it was cleared by an uninstall/reinstall or by policy.
  syncAutoStartWithOs();
  // Schedules an update check 4 s after launch (skipped in dev builds); follows
  // the operator's persisted release ring (default stable).
  initAutoUpdater(getSettings().updateChannel);
  // Fire-and-forget: reclaim leftover extract dirs from prior failed/uploaded
  // runs. Non-blocking so it never delays window paint; errors are swallowed.
  // The extract a paused/interrupted upload still needs is exempt — the sweep
  // once deleted a day-old paused job's dir, leaving its resume nothing to send.
  void scanAndCleanupDiscovered(resumableUploadOutDir());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// How long quitting may be held back so an extraction-abort report can reach
// the network. Short enough that quit still feels instant, and hard-capped so a
// dead network can never wedge the shutdown.
const QUIT_TELEMETRY_GRACE_MS = 1500;

// Kill any in-flight Python extraction so it can't linger as an orphaned
// process in Task Manager after the app window is closed. Passing a reason also
// telemetries the extraction jobs it tears down; returns those in-flight
// reports so the caller can wait on them briefly.
function cancelAllJobs(reason: ExtractAbortReason | null = null): Promise<boolean>[] {
  const pending: Promise<boolean>[] = [];
  for (const [jobId, job] of activeJobs) {
    if (reason) {
      const report = requestExtractAbort(jobId, job, reason);
      if (report) pending.push(report);
    }
    try {
      job.cancel();
    } catch {
      /* best-effort teardown */
    }
  }
  activeJobs.clear();
  return pending;
}

/** Set once we have already deferred a quit — a deferral must never repeat. */
let quitDeferredForTelemetry = false;

app.on('before-quit', (e) => {
  // Quitting mid-extraction throws away the whole scan, so it is reported —
  // but the process would normally die before the POST leaves. Hold the quit
  // for a bounded grace window, exactly once, then go regardless of outcome.
  const pending = cancelAllJobs('quit');
  if (!pending.length || quitDeferredForTelemetry) return;
  quitDeferredForTelemetry = true;
  e.preventDefault();
  void Promise.race([
    Promise.allSettled(pending),
    new Promise((resolve) => setTimeout(resolve, QUIT_TELEMETRY_GRACE_MS)),
  ]).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  // With minimize-to-tray on, X only hides the window, so this normally never
  // fires. It still can (e.g. the window is destroyed some other way) — staying
  // alive then would leave an invisible, unreachable process, so quit unless we
  // are deliberately tray-resident. Job teardown (and its abort telemetry) is
  // handled by the before-quit hook, which app.quit() always fires.
  if (hasTray() && getSettings().minimizeToTray && !quitting) return;
  app.quit();
});
