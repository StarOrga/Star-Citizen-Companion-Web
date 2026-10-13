import { describe, it, expect } from 'vitest';
import {
  decideAutoRun,
  describeDecision,
  shouldAutoResume,
  shouldQuitAfterAutoRun,
  launchAction,
  formatCountdown,
  AUTO_RUN_COUNTDOWN_S,
  type AutoRunInputs,
} from '../src/lib/auto-run.js';
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
    expect(describeDecision(decideAutoRun({ ...base, signedIn: false }))).toBe('no auto-run (no-session)');
  });
});

/**
 * "Close again when there is nothing to do" (feedback 71b1e402). The narrow
 * condition is the whole point: only `already-uploaded` is the tool asserting
 * that the server has this build. Every other skip means it could not tell, was
 * not allowed to look, or was never asked — and a process that vanishes at every
 * login would hide exactly those.
 */
describe('shouldQuitAfterAutoRun', () => {
  const on = { startedHidden: true, afterAutoRun: 'quit' } as const;

  it('quits the unattended launch when the build is already uploaded', () => {
    expect(shouldQuitAfterAutoRun({ ...on, reason: 'already-uploaded' })).toBe(true);
  });

  it('stays open on every skip that is not a proven "nothing to do"', () => {
    for (const reason of [
      'no-session',
      'no-snapshot',
      'no-channels',
      'unknown-local-version',
    ] as const) {
      expect(shouldQuitAfterAutoRun({ ...on, reason })).toBe(false);
    }
    expect(shouldQuitAfterAutoRun({ ...on, reason: undefined })).toBe(false);
  });

  it('never closes a window the operator opened themselves', () => {
    expect(
      shouldQuitAfterAutoRun({ startedHidden: false, afterAutoRun: 'quit', reason: 'already-uploaded' }),
    ).toBe(false);
  });

  it('is a fixed rule — also for "shut down afterwards"', () => {
    expect(
      shouldQuitAfterAutoRun({ startedHidden: true, afterAutoRun: 'shutdown', reason: 'already-uploaded' }),
    ).toBe(true);
  });

  it('keeps the launch open when the danach slot says "bleibt danach offen"', () => {
    expect(
      shouldQuitAfterAutoRun({ startedHidden: true, afterAutoRun: 'keep', reason: 'already-uploaded' }),
    ).toBe(false);
  });
});

describe('shouldAutoResume', () => {
  const on = { signedIn: true, startedHidden: false } as const;

  it('resumes a job killed mid-stage on any launch', () => {
    expect(shouldAutoResume({ ...on, status: 'running' })).toBe(true);
    expect(shouldAutoResume({ ...on, status: 'error' })).toBe(true);
  });

  it('resumes an operator-paused job only on the autostart launch', () => {
    expect(shouldAutoResume({ ...on, status: 'paused' })).toBe(false);
    expect(shouldAutoResume({ ...on, startedHidden: true, status: 'paused' })).toBe(true);
  });

  it('never resumes without a session or a job', () => {
    expect(shouldAutoResume({ ...on, signedIn: false, status: 'running' })).toBe(false);
    expect(shouldAutoResume({ ...on, status: null })).toBe(false);
    expect(shouldAutoResume({ ...on, status: 'done' })).toBe(false);
  });
});

describe('launchAction', () => {
  const found = { run: true, startedHidden: false, cancelled: false, operatorBusy: false };

  it('counts down on a launch the operator opened', () => {
    expect(launchAction(found)).toBe('countdown');
    expect(AUTO_RUN_COUNTDOWN_S).toBe(120);
  });

  it('starts at once on the unattended launch', () => {
    expect(launchAction({ ...found, startedHidden: true })).toBe('run');
  });

  it('does nothing without a new patch', () => {
    expect(launchAction({ ...found, run: false })).toBe('none');
    expect(launchAction({ ...found, run: false, startedHidden: true })).toBe('none');
  });

  it('stays quiet for the rest of the app start once "Abbrechen" was pressed', () => {
    expect(launchAction({ ...found, cancelled: true })).toBe('none');
  });

  it('never starts while the operator already started something', () => {
    expect(launchAction({ ...found, operatorBusy: true })).toBe('none');
    expect(launchAction({ ...found, startedHidden: true, operatorBusy: true })).toBe('none');
  });
});

describe('formatCountdown', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatCountdown(120)).toBe('2:00');
    expect(formatCountdown(107)).toBe('1:47');
    expect(formatCountdown(9)).toBe('0:09');
  });

  it('rounds partial seconds up and never goes negative', () => {
    expect(formatCountdown(0.2)).toBe('0:01');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});
