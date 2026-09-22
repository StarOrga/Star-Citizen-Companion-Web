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

  it('defaults afterAutoRun to quit and persists another choice', () => {
    const io = fakeIO();
    const store = new SettingsStore(io, seqIds());
    expect(store.load().afterAutoRun).toBe('quit');
    store.patch({ afterAutoRun: 'shutdown' });
    const reloaded = new SettingsStore(io, seqIds());
    expect(reloaded.load().afterAutoRun).toBe('shutdown');
  });

  it('rejects an unknown afterAutoRun value and falls back to the default', () => {
    const io = fakeIO();
    io.data = JSON.stringify({
      v: 2,
      settings: { installId: 'x', afterAutoRun: 'nonsense' },
    });
    const s = new SettingsStore(io, seqIds()).load();
    expect(s.afterAutoRun).toBe('quit');
  });

  it('drops a persisted opt-out of the retired uploadAfterExtract toggle', () => {
    // Upload after a successful extraction is no longer optional; an old
    // `false` in settings.json must neither survive a load nor a re-save.
    const io = fakeIO();
    io.data = JSON.stringify({ v: 2, settings: { installId: 'x', uploadAfterExtract: false } });
    const store = new SettingsStore(io, seqIds());
    expect('uploadAfterExtract' in store.load()).toBe(false);
    store.patch({ extractScope: 'minimal' });
    expect(io.data).not.toContain('uploadAfterExtract');
  });

  it('defaults extractScope to standard and round-trips a patch', () => {
    const io = fakeIO();
    const store = new SettingsStore(io, seqIds());
    expect(store.load().extractScope).toBe('standard');
    store.patch({ extractScope: 'maximum' });
    const reloaded = new SettingsStore(io, seqIds());
    expect(reloaded.load().extractScope).toBe('maximum');
  });

  it('rejects an unknown extractScope value and falls back to the default', () => {
    const io = fakeIO();
    io.data = JSON.stringify({ v: 2, settings: { installId: 'x', extractScope: 'ludicrous' } });
    const s = new SettingsStore(io, seqIds()).load();
    expect(s.extractScope).toBe('standard');
  });

  it('leaves language unset by default and round-trips a patch', () => {
    const io = fakeIO();
    const store = new SettingsStore(io, seqIds());
    expect(store.load().language).toBeUndefined();
    store.patch({ language: 'de' });
    const reloaded = new SettingsStore(io, seqIds());
    expect(reloaded.load().language).toBe('de');
  });

  it('drops a v1 shutdownAfterUpload flag silently and never lets it influence afterAutoRun', () => {
    const io = fakeIO();
    // A real v1 envelope: no afterAutoRun/extractScope yet,
    // but it does carry the removed shutdownAfterUpload flag turned ON.
    io.data = JSON.stringify({
      v: 1,
      settings: {
        telemetryEnabled: false,
        installId: 'legacy-id',
        minimizeToTray: true,
        autoStart: false,
        autoRunOnNewVersion: false,
        shutdownAfterUpload: true,
        quitAfterAutoRun: true,
        updateChannel: 'stable',
      },
    });
    const s = new SettingsStore(io, seqIds()).load();
    expect((s as unknown as { shutdownAfterUpload?: boolean }).shutdownAfterUpload).toBeUndefined();
    // The removed flag must never be migrated into the new setting.
    expect(s.afterAutoRun).toBe('quit');
    // New v2-only fields fall back to their defaults.
    expect(s.extractScope).toBe('standard');
    // Other v1 fields are still carried over.
    expect(s.installId).toBe('legacy-id');
    expect(s.telemetryEnabled).toBe(false);
  });

  it('upgrades a loaded v1 envelope to v2 on the next persist', () => {
    const io = fakeIO();
    io.data = JSON.stringify({
      v: 1,
      settings: { installId: 'legacy-id', shutdownAfterUpload: true },
    });
    const store = new SettingsStore(io, seqIds());
    store.load();
    store.patch({ minimizeToTray: false });
    const persisted = JSON.parse(io.data as string) as { v: number; settings: Record<string, unknown> };
    expect(persisted.v).toBe(2);
    expect(persisted.settings.shutdownAfterUpload).toBeUndefined();
  });
});
