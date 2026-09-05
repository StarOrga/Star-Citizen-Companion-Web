import { describe, it, expect } from 'vitest';
import { SettingsStore, type TextIO } from '../src/lib/settings-store.js';

function fakeIO(): TextIO & { data: string | null } {
  const io = {
    data: null as string | null,
    read: () => io.data,
    write: (t: string) => {
      io.data = t;
    },
  };
  return io;
}

// Deterministic id factory so tests can assert persistence of the installId.
function seqIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe('SettingsStore', () => {
  it('defaults telemetry ON and mints a stable installId on first load', () => {
    const io = fakeIO();
    const store = new SettingsStore(io, seqIds());
    const s = store.load();
    expect(s.telemetryEnabled).toBe(true);
    expect(s.installId).toBe('id-1');
    // The freshly-minted id is persisted immediately…
    expect(io.data).not.toBeNull();
    // …and a NEW store over the same storage reuses it (no re-mint).
    const reloaded = new SettingsStore(io, seqIds()).load();
    expect(reloaded.installId).toBe('id-1');
  });

  it('persists an opt-out and reflects it via isTelemetryEnabled', () => {
    const io = fakeIO();
    const store = new SettingsStore(io, seqIds());
    store.load();
    store.setTelemetryEnabled(false);
    expect(store.isTelemetryEnabled()).toBe(false);
    // Survives a reload from the same backing store.
    const reloaded = new SettingsStore(io, seqIds());
    expect(reloaded.isTelemetryEnabled()).toBe(false);
    expect(reloaded.load().installId).toBe('id-1'); // id preserved across the toggle
  });

  it('falls back to defaults for a corrupt settings blob', () => {
    const io = fakeIO();
    io.data = '{ not valid json';
    const s = new SettingsStore(io, seqIds()).load();
    expect(s.telemetryEnabled).toBe(true);
    expect(s.installId).toBe('id-1');
  });

  it('ignores an envelope with the wrong schema version', () => {
    const io = fakeIO();
    io.data = JSON.stringify({ v: 999, settings: { telemetryEnabled: false, installId: 'old' } });
    const s = new SettingsStore(io, seqIds()).load();
    expect(s.telemetryEnabled).toBe(true); // reset to default, not the v999 value
    expect(s.installId).toBe('id-1');
  });

  it('caches within an instance (a second load does not re-read/re-mint)', () => {
    const io = fakeIO();
    const store = new SettingsStore(io, seqIds());
    const first = store.load();
    const second = store.load();
    expect(second.installId).toBe(first.installId);
  });

  it('defaults shutdownAfterUpload OFF and persists a deliberate opt-in', () => {
    const io = fakeIO();
    const store = new SettingsStore(io, seqIds());
    expect(store.load().shutdownAfterUpload).toBe(false);
    store.patch({ shutdownAfterUpload: true });
    // Survives a reload from the same backing store.
    const reloaded = new SettingsStore(io, seqIds());
    expect(reloaded.load().shutdownAfterUpload).toBe(true);
  });

  it('defaults quitAfterAutoRun ON and persists a deliberate opt-out', () => {
    const io = fakeIO();
    const store = new SettingsStore(io, seqIds());
    // ON by default, unlike the other two unattended options: this one only ever
    // ENDS a process nobody is looking at (feedback 71b1e402).
    expect(store.load().quitAfterAutoRun).toBe(true);
    store.patch({ quitAfterAutoRun: false });
    const reloaded = new SettingsStore(io, seqIds());
    expect(reloaded.load().quitAfterAutoRun).toBe(false);
  });

  it('defaults updateChannel to stable and round-trips a patch', () => {
    const io = fakeIO();
    const store = new SettingsStore(io, seqIds());
    expect(store.load().updateChannel).toBe('stable');
    store.patch({ updateChannel: 'beta' });
    // Survives a reload from the same backing store.
    const reloaded = new SettingsStore(io, seqIds());
    expect(reloaded.load().updateChannel).toBe('beta');
  });
});
