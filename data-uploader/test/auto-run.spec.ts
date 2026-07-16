import { describe, it, expect } from 'vitest';
import { decideAutoRun, describeDecision, type AutoRunInputs } from '../src/lib/auto-run.js';
import type { DiscoveredChannel, ChannelTag } from '../src/lib/discovery.js';
import type { CatalogSnapshot } from '../src/lib/sync.js';

function channel(tag: ChannelTag, version: string | null): DiscoveredChannel {
  return {
    channel: tag,
    installPath: `C:/SC/${tag}`,
    dataP4kPath: `C:/SC/${tag}/Data.p4k`,
    version,
    sizeBytes: 100_000_000_000,
    source: 'rsi-launcher',
  };
}

function snapshot(entries: Array<[string, string]>): CatalogSnapshot {
  return {
    syncedAt: 1,
    bundleCount: entries.length,
    channels: entries.map(([ch, patch]) => ({
      channel: ch as CatalogSnapshot['channels'][number]['channel'],
      patchVersion: patch,
      buildNumber: '1',
      qualityScore: 90,
      entityTotal: 10,
      bundleId: `b-${ch}`,
      createdAt: '2026-01-01T00:00:00Z',
    })),
  };
}

const base: AutoRunInputs = {
  enabled: true,
  signedIn: true,
  channels: [channel('LIVE', '4.0.1')],
  snapshot: snapshot([['live', '4.0.0']]),
};

describe('decideAutoRun', () => {
  it('runs when the local build differs from the uploaded one', () => {
    const d = decideAutoRun(base);
    expect(d.run).toBe(true);
    expect(d.channel?.channel).toBe('LIVE');
    expect(d.localVersion).toBe('4.0.1');
    expect(d.serverVersion).toBe('4.0.0');
  });

  it('runs when the server has nothing for that channel yet', () => {
    const d = decideAutoRun({ ...base, snapshot: snapshot([['ptu', '4.0.1']]) });
    expect(d.run).toBe(true);
    expect(d.serverVersion).toBeNull();
  });

  it('does nothing when the local build is already uploaded', () => {
    const d = decideAutoRun({ ...base, snapshot: snapshot([['live', '4.0.1']]) });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('already-uploaded');
  });

  it('matches channels case-insensitively (server lowercases, discovery does not)', () => {
    // A case mismatch here would make every launch look like "new version" and
    // re-extract + re-upload the same build forever.
    const d = decideAutoRun({ ...base, snapshot: snapshot([['LIVE', '4.0.1']]) });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('already-uploaded');
  });

  it('does nothing when the toggle is off', () => {
    const d = decideAutoRun({ ...base, enabled: false });
    expect(d).toEqual({ run: false, reason: 'disabled' });
  });

  it('does nothing when signed out — an unattended run must not open a browser login', () => {
    const d = decideAutoRun({ ...base, signedIn: false });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('no-session');
  });

  it('does nothing without a snapshot — it cannot know what is already uploaded', () => {
    // Running blind here would re-upload the current build on every launch.
    const d = decideAutoRun({ ...base, snapshot: null });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('no-snapshot');
  });

  it('does nothing when no channels were discovered', () => {
    const d = decideAutoRun({ ...base, channels: [] });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('no-channels');
  });

  it('never acts on a channel whose local version is unreadable', () => {
    // Unknown != new. Acting on it would start hours of work on a guess.
    const d = decideAutoRun({ ...base, channels: [channel('LIVE', null)] });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('unknown-local-version');
  });

  it('skips an unreadable channel but still runs a decidable one', () => {
    const d = decideAutoRun({
      ...base,
      channels: [channel('LIVE', null), channel('PTU', '4.1.0')],
      snapshot: snapshot([['ptu', '4.0.9']]),
    });
    expect(d.run).toBe(true);
    expect(d.channel?.channel).toBe('PTU');
  });

  it('prefers LIVE over PTU when both are new', () => {
    const d = decideAutoRun({
      ...base,
      channels: [channel('PTU', '4.1.0'), channel('LIVE', '4.0.1')],
      snapshot: snapshot([]),
    });
    expect(d.channel?.channel).toBe('LIVE');
  });

  it('falls through to PTU when LIVE is already uploaded', () => {
    const d = decideAutoRun({
      ...base,
      channels: [channel('LIVE', '4.0.0'), channel('PTU', '4.1.0')],
      snapshot: snapshot([['live', '4.0.0']]),
    });
    expect(d.run).toBe(true);
    expect(d.channel?.channel).toBe('PTU');
  });
});

describe('describeDecision', () => {
  it('describes a run', () => {
    expect(describeDecision(decideAutoRun(base))).toBe('LIVE: local 4.0.1 vs server 4.0.0 — starting');
  });

  it('describes a skip', () => {
    expect(describeDecision(decideAutoRun({ ...base, enabled: false }))).toBe('no auto-run (disabled)');
  });
});
