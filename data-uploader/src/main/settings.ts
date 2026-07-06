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
