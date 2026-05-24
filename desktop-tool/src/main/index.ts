import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverAll, discoverManual } from '../lib/discovery.js';
import { PROFILES, DEFAULT_PROFILE, estimateForSize } from '../lib/performance.js';
import { runOAuthFlow } from '../lib/oauth.js';
import { uploadBundle, type UploadPayload } from '../lib/uploader.js';
import { RELEASE_TOKEN, TOOL_VERSION, API_BASE, WEB_BASE } from '../lib/release-token.js';
import {
  initAutoUpdater,
  checkForUpdatesManually,
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
    title: 'SC Companion',
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

ipcMain.handle('sc:authenticate', async () => runOAuthFlow(WEB_BASE));

ipcMain.handle('sc:upload', async (_e, payload: UploadPayload) =>
  uploadBundle(API_BASE, payload),
);

// ============= Auto-Update IPC =============

ipcMain.handle('sc:update:status', () => getLastUpdateEvent());
ipcMain.handle('sc:update:check', async () => checkForUpdatesManually());
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
  app.setAppUserModelId('com.sc-companion.desktop-tool');
  Menu.setApplicationMenu(null); // Belt-and-suspenders alongside per-window setMenu(null)
  createWindow();
  initAutoUpdater(); // Schedules an update check 4 s after launch (skipped in dev builds).
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
