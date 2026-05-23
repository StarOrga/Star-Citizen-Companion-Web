import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverAll, discoverManual } from '../lib/discovery.js';
import { PROFILES, DEFAULT_PROFILE, estimateForSize } from '../lib/performance.js';
import { runOAuthFlow } from '../lib/oauth.js';
import { uploadBundle, type UploadPayload } from '../lib/uploader.js';
import { RELEASE_TOKEN, TOOL_VERSION, API_BASE } from '../lib/release-token.js';

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

ipcMain.handle('sc:authenticate', async () => runOAuthFlow(API_BASE));

ipcMain.handle('sc:upload', async (_e, payload: UploadPayload) =>
  uploadBundle(API_BASE, payload),
);

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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
