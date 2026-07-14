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

ipcMain.handle('sc:upload', async (_e, payload: UploadPayload) =>
  uploadBundle(API_BASE, payload),
);

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

ipcMain.handle('sc:extract:env', () => {
  const paths = resolvePythonPaths();
  return { interpreter: paths.interpreter, cwd: paths.cwd, source: paths.source };
});

ipcMain.handle('sc:extract:start', async (event, req: ExtractRequest): Promise<ExtractFinal> => {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const handle = startExtraction(req, (ev: PythonExtractEvent) => {
    event.sender.send('sc:extract:event', { jobId, ...ev });
  });
  activeJobs.set(jobId, { cancel: handle.cancel });
  try {
    const final = await handle.promise;
    activeJobs.delete(jobId);
    return final;
  } catch (err) {
    activeJobs.delete(jobId);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
  const handle = startSkinExport(req, (ev) => {
    event.sender.send('sc:skin:event', { jobId, ...ev });
  });
  activeJobs.set(jobId, { cancel: handle.cancel });
  try {
    const final = await handle.promise;
    activeJobs.delete(jobId);
    return final;
  } catch (err) {
    activeJobs.delete(jobId);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
  async (event, accessToken: string, ships: { shipId: string; dir: string }[]): Promise<SkinUploadResult[]> =>
    uploadSkins(accessToken, ships, (message, level) =>
      event.sender.send('sc:skin:event', { jobId: 'upload', type: 'log', message, level: level ?? 'info' }),
    ),
);

// ============= Catalog-promotion IPC =============

// Feed the just-uploaded extract into the public Codex (codex_* tables) via
// ingest-catalog. Runs AFTER the bundle upload and BEFORE cleanup so the
// out_dir still exists. Streams per-table progress to the renderer.
ipcMain.handle(
  'sc:catalog:upload',
  async (event, accessToken: string, outDir: string): Promise<CatalogUploadResult> =>
    uploadCatalog(accessToken, outDir, (p) => event.sender.send('sc:catalog:event', p)),
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
