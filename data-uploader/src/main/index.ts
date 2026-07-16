import { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initLogging, logFromRenderer } from './logging.js';
import { getSettings, setTelemetryEnabled } from './settings.js';
import { reportCrash } from './telemetry-reporter.js';
import { discoverAll, discoverManual } from '../lib/discovery.js';
import { PROFILES, DEFAULT_PROFILE, estimateForSize } from '../lib/performance.js';
import { runOAuthFlow } from '../lib/oauth.js';
import { uploadBundle, type UploadPayload } from '../lib/uploader.js';
import { createWatchdog } from '../lib/watchdog.js';
import { RELEASE_TOKEN, TOOL_VERSION, API_BASE, WEB_BASE } from '../lib/release-token.js';
import {
  initAutoUpdater,
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
  getSessionStatus,
  clearSession,
  getCachedSnapshot,
  runSync,
} from './session.js';
import * as uploadJob from './upload-session.js';
import { isInterrupt, PausedError } from '../lib/pause-control.js';

// Configure logging + install uncaughtException/unhandledRejection handlers
// before any window or IPC work, so a startup failure lands in main.log and
// crash telemetry instead of vanishing silently (the v0.8.2 failure mode).
initLogging();

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

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
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Remove the native menu bar entirely (autoHideMenuBar still shows it on Alt-press).
  mainWindow.setMenu(null);

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
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
}));

// ============= Settings / Telemetry IPC =============

ipcMain.handle('sc:settings:get', () => {
  const s = getSettings();
  // Never expose the raw installId to the renderer — it is an internal, opaque
  // dedup id. The UI only needs the opt-out flag.
  return { telemetryEnabled: s.telemetryEnabled };
});

ipcMain.handle('sc:settings:setTelemetry', (_e, enabled: boolean) => {
  const s = setTelemetryEnabled(Boolean(enabled));
  return { telemetryEnabled: s.telemetryEnabled };
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

ipcMain.handle('sc:profiles', () => ({
  profiles: PROFILES,
  default: DEFAULT_PROFILE,
}));

ipcMain.handle('sc:estimate', (_e, profileId: keyof typeof PROFILES, sizeBytes: number) =>
  estimateForSize(profileId, sizeBytes),
);

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

ipcMain.handle('sc:sync:cached', () => getCachedSnapshot());

ipcMain.handle('sc:sync:start', async (event) =>
  runSync((p) => event.sender.send('sc:sync:event', p)),
);

// ============= Resumable upload-job IPC =============

// The job file is the only thing that survives a kill, so every stage boundary
// below writes through it before doing network work.

ipcMain.handle('sc:upload:job', () => uploadJob.view());

ipcMain.handle('sc:upload:begin', (_e, outDir: string, nat: { channel: string; patchVersion: string; buildNumber: string }) =>
  uploadJob.begin(outDir, nat),
);

ipcMain.handle('sc:upload:pause', () => uploadJob.pause());
ipcMain.handle('sc:upload:resume', () => uploadJob.resume());
ipcMain.handle('sc:upload:cancel', () => uploadJob.cancel());
ipcMain.handle('sc:upload:finish', () => {
  uploadJob.finish();
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
  const result = await uploadBundle(API_BASE, payload);
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
  cancel: () => void;
}
const activeJobs = new Map<string, ActiveJob>();

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
  const watchdog = createWatchdog({
    timeoutMs: JOB_STALL_MS,
    onTimeout: (idle) => reportJobStall('extract', idle, jobId),
  });
  const handle = startExtraction(req, (ev: PythonExtractEvent) => {
    watchdog.pet(); // every event is a sign of life — reset the stall timer
    event.sender.send('sc:extract:event', { jobId, ...ev });
  });
  activeJobs.set(jobId, { cancel: handle.cancel });
  watchdog.start();
  try {
    const final = await handle.promise;
    return final;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    watchdog.stop();
    activeJobs.delete(jobId);
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
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('sc:skin:start', async (event, req: SkinExportRequest): Promise<SkinExportFinal> => {
  const jobId = `skin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const watchdog = createWatchdog({
    timeoutMs: JOB_STALL_MS,
    onTimeout: (idle) => reportJobStall('skin', idle, jobId),
  });
  const handle = startSkinExport(req, (ev) => {
    watchdog.pet();
    event.sender.send('sc:skin:event', { jobId, ...ev });
  });
  activeJobs.set(jobId, { cancel: handle.cancel });
  watchdog.start();
  try {
    const final = await handle.promise;
    return final;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    watchdog.stop();
    activeJobs.delete(jobId);
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
        accessToken,
        ships,
        (message, level) =>
          event.sender.send('sc:skin:event', { jobId: 'upload', type: 'log', message, level: level ?? 'info' }),
        uploadJob.hooksForSkins(),
      );
      uploadJob.update((s) => ({ ...s, skins: { ...s.skins, status: 'done' } }));
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
        accessToken,
        outDir,
        (p) => event.sender.send('sc:catalog:event', p),
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
  async (_e, outDir: string, info: UploadMarkerInfo): Promise<CleanupResult> =>
    cleanupAfterUpload(outDir, info ?? {}),
);

ipcMain.handle('sc:extract:cancel', (_e, jobId: string) => {
  const job = activeJobs.get(jobId);
  if (!job) return { ok: false, error: 'unknown_job' };
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
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.sc-companion.data-uploader');
  Menu.setApplicationMenu(null); // Belt-and-suspenders alongside per-window setMenu(null)
  createWindow();
  initAutoUpdater(); // Schedules an update check 4 s after launch (skipped in dev builds).
  // Fire-and-forget: reclaim leftover extract dirs from prior failed/uploaded
  // runs. Non-blocking so it never delays window paint; errors are swallowed.
  void scanAndCleanupDiscovered();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Kill any in-flight Python extraction so it can't linger as an orphaned
// process in Task Manager after the app window is closed.
function cancelAllJobs(): void {
  for (const job of activeJobs.values()) {
    try {
      job.cancel();
    } catch {
      /* best-effort teardown */
    }
  }
  activeJobs.clear();
}

app.on('before-quit', cancelAllJobs);

app.on('window-all-closed', () => {
  // Single-window utility: closing the window means quitting on every platform
  // (no macOS dock-resident behavior — pressing X should make the process gone,
  // not background it). Tear down extraction children first so nothing lingers.
  cancelAllJobs();
  app.quit();
});
