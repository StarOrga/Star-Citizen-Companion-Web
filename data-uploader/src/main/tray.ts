/**
 * System tray — live pipeline progress + window/quit control.
 *
 * Modelled on the Star Citizen Companion app's tray: the menu itself shows how
 * far the extraction and upload have got, so the operator sees the state of a
 * multi-hour run in one click without restoring the window.
 *
 * The menu is rebuilt on every progress change. Electron has no API to mutate a
 * built menu's labels in place, so a rebuild is the only way to keep the text
 * live — it is cheap (a handful of items) and only fires on actual changes.
 */

import { app, Tray, Menu, nativeImage, type BrowserWindow } from 'electron';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import log from 'electron-log';
import { trayLines, trayTooltip, type HubState, type TrayLabels } from '../lib/progress-hub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const APP_NAME = 'SC Data Uploader';

export interface TrayDeps {
  /** Restore + focus the main window. */
  show: () => void;
  /** Quit for real (bypasses the close-to-tray interception). */
  quit: () => void;
  /** Pause the running upload; undefined when nothing is pausable. */
  pause?: () => void;
  resume?: () => void;
  /** Localized menu strings, resolved by the caller. */
  labels: () => TrayMenuLabels;
}

export interface TrayMenuLabels extends Partial<TrayLabels> {
  open: string;
  quit: string;
  pauseUpload: string;
  resumeUpload: string;
  /** Balloon text shown once when the window first hides to the tray. */
  hiddenHint?: string;
}

let tray: Tray | null = null;
let deps: TrayDeps | null = null;
let lastState: HubState | null = null;

function iconPath(): string {
  // Packaged and dev layouts differ; fall back to the build icon either way.
  const candidates = [
    join(__dirname, '../../build/icon.png'),
    join(process.resourcesPath ?? '', 'build', 'icon.png'),
  ];
  return candidates.find((p) => p && existsSync(p)) ?? candidates[0]!;
}

function buildMenu(state: HubState): Menu {
  const l = deps!.labels();
  // Progress lines are informational only — disabled so they read as status
  // rather than as clickable actions.
  const progressItems = trayLines(state, l).map((line) => ({ label: line, enabled: false }));

  const items: Parameters<typeof Menu.buildFromTemplate>[0] = [
    { label: APP_NAME, enabled: false },
    { type: 'separator' },
    ...progressItems,
    { type: 'separator' },
  ];

  // Only offer pause/resume while an upload is actually in flight — a dead
  // entry would imply the tool can pause something it cannot.
  if (state.upload.active && !state.paused && deps!.pause) {
    items.push({ label: l.pauseUpload, click: () => deps!.pause!() });
  } else if (state.paused && deps!.resume) {
    items.push({ label: l.resumeUpload, click: () => deps!.resume!() });
  }

  items.push(
    { label: l.open, click: () => deps!.show() },
    { type: 'separator' },
    { label: l.quit, click: () => deps!.quit() },
  );
  return Menu.buildFromTemplate(items);
}

/** Create the tray icon. Safe to call once, after `app.whenReady()`. */
export function initTray(d: TrayDeps, initial: HubState): void {
  if (tray) return;
  deps = d;
  try {
    const image = nativeImage.createFromPath(iconPath());
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    tray.setToolTip(trayTooltip(initial, APP_NAME, d.labels()));
    tray.setContextMenu(buildMenu(initial));
    // Double-click is the conventional Windows "bring it back" gesture.
    tray.on('double-click', () => d.show());
    lastState = initial;
    log.info('[tray] ready');
  } catch (err) {
    // A tray failure must never take the app down — worst case the window
    // simply behaves like a normal one.
    log.error(`[tray] init failed: ${(err as Error).message}`);
    tray = null;
  }
}

/** Repaint the menu + tooltip from new progress. No-op without a tray. */
export function updateTray(state: HubState): void {
  lastState = state;
  if (!tray || !deps) return;
  try {
    tray.setContextMenu(buildMenu(state));
    tray.setToolTip(trayTooltip(state, APP_NAME, deps.labels()));
  } catch (err) {
    log.warn(`[tray] update failed: ${(err as Error).message}`);
  }
}

/** Re-render with the current state — used when the locale changes. */
export function refreshTray(): void {
  if (lastState) updateTray(lastState);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

/** Windows balloon shown once when the window first hides, so it isn't "gone". */
export function notifyHidden(message: string): void {
  if (!tray) return;
  try {
    tray.displayBalloon({ title: APP_NAME, content: message });
  } catch {
    /* balloons are unsupported on some platforms — non-essential */
  }
}

/** True when a tray exists — the close handler must not hide without one. */
export function hasTray(): boolean {
  return tray !== null;
}

export type { BrowserWindow };
