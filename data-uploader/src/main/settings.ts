/**
 * Main-process settings singleton — wires the pure `SettingsStore` to a plain
 * JSON file under `app.getPath('userData')` and Node's crypto for the installId.
 */

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsStore, type TextIO, type Settings } from '../lib/settings-store.js';

const SETTINGS_FILE = 'settings.json';

let _store: SettingsStore | null = null;

function store(): SettingsStore {
  if (_store) return _store;
  const path = join(app.getPath('userData'), SETTINGS_FILE);
  const io: TextIO = {
    read: () => (existsSync(path) ? readFileSync(path, 'utf-8') : null),
    write: (text) => writeFileSync(path, text, { encoding: 'utf-8', mode: 0o600 }),
  };
  _store = new SettingsStore(io, randomUUID);
  return _store;
}

export function getSettings(): Settings {
  return store().load();
}

export function isTelemetryEnabled(): boolean {
  return store().isTelemetryEnabled();
}

export function setTelemetryEnabled(enabled: boolean): Settings {
  return store().setTelemetryEnabled(enabled);
}

/** Merge a partial settings update and persist it. */
export function patchSettings(partial: Partial<Omit<Settings, 'installId'>>): Settings {
  const next = store().patch(partial);
  // Autostart lives in the OS (registry Run key), not just in our JSON — keep
  // the two in sync on every write, or a toggle would only *look* applied.
  if ('autoStart' in partial) applyAutoStart(next.autoStart);
  return next;
}

/**
 * Register/unregister the app as a login item.
 *
 * `openAsHidden` is macOS-only; on Windows we pass `--hidden` as an arg and the
 * app reads it to start straight into the tray — an unattended auto-run should
 * not steal focus at login.
 *
 * Never applied in dev: registering the electron-vite dev binary would leave a
 * broken Run entry on the developer's machine after the session ends.
 */
export function applyAutoStart(enabled: boolean): void {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: enabled,
      args: enabled ? ['--hidden'] : [],
    });
  } catch {
    /* best-effort: a locked-down policy must not break settings */
  }
}

/** Re-assert the stored autostart preference against the OS at launch. */
export function syncAutoStartWithOs(): void {
  applyAutoStart(getSettings().autoStart);
}
