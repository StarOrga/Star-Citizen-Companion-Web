import { describe, it, expect } from 'vitest';
import { buildRunPlan } from '../src/lib/run-plan.js';
import type { Settings } from '../src/lib/settings-store.js';

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    telemetryEnabled: true,
    installId: 'id-1',
    minimizeToTray: true,
    autoStart: false,
    autoRunOnNewVersion: false,
    quitAfterAutoRun: true,
    afterAutoRun: 'quit',
    uploadAfterExtract: true,
    extractScope: 'standard',
    updateChannel: 'stable',
    ...overrides,
  };
}

describe('buildRunPlan', () => {
  it('manual run attended: whenDone comes from the per-run choice', () => {
    const plan = buildRunPlan({
      channel: 'LIVE',
      settings: baseSettings(),
      signedIn: true,
      whenDone: 'shutdown',
    });
    expect(plan).toEqual({
      channel: 'LIVE',
      scope: 'standard',
      uploadAfter: true,
      whenDone: 'shutdown',
      unattended: false,
    });
  });

  it('manual run not signed in: uploadAfter forced false even if the setting is on', () => {
    const plan = buildRunPlan({
      channel: 'PTU',
      settings: baseSettings({ uploadAfterExtract: true }),
      signedIn: false,
      whenDone: 'nothing',
    });
    expect(plan.uploadAfter).toBe(false);
    expect(plan.unattended).toBe(false);
    expect(plan.whenDone).toBe('nothing');
  });

  it('manual run respects uploadAfterExtract = false when signed in', () => {
    const plan = buildRunPlan({
      channel: 'LIVE',
      settings: baseSettings({ uploadAfterExtract: false }),
      signedIn: true,
      whenDone: 'nothing',
    });
    expect(plan.uploadAfter).toBe(false);
  });

  it('unattended run maps afterAutoRun=keep to whenDone=nothing', () => {
    const plan = buildRunPlan({
      unattended: true,
      channel: 'LIVE',
      settings: baseSettings({ afterAutoRun: 'keep' }),
      signedIn: true,
    });
    expect(plan.whenDone).toBe('nothing');
    expect(plan.unattended).toBe(true);
  });

  it('unattended run maps afterAutoRun=quit to whenDone=quit', () => {
    const plan = buildRunPlan({
      unattended: true,
      channel: 'LIVE',
      settings: baseSettings({ afterAutoRun: 'quit' }),
      signedIn: true,
    });
    expect(plan.whenDone).toBe('quit');
  });

  it('unattended run maps afterAutoRun=shutdown to whenDone=shutdown', () => {
    const plan = buildRunPlan({
      unattended: true,
      channel: 'LIVE',
      settings: baseSettings({ afterAutoRun: 'shutdown' }),
      signedIn: true,
    });
    expect(plan.whenDone).toBe('shutdown');
  });

  it('unattended run: uploadAfter is always true when signed in, ignoring uploadAfterExtract', () => {
    const plan = buildRunPlan({
      unattended: true,
      channel: 'LIVE',
      settings: baseSettings({ uploadAfterExtract: false }),
      signedIn: true,
    });
    expect(plan.uploadAfter).toBe(true);
  });

  it('unattended run: uploadAfter is false when not signed in', () => {
    const plan = buildRunPlan({
      unattended: true,
      channel: 'LIVE',
      settings: baseSettings(),
      signedIn: false,
    });
    expect(plan.uploadAfter).toBe(false);
  });

  it('scope always comes from settings.extractScope', () => {
    const manual = buildRunPlan({
      channel: 'LIVE',
      settings: baseSettings({ extractScope: 'maximum' }),
      signedIn: true,
      whenDone: 'nothing',
    });
    expect(manual.scope).toBe('maximum');

    const unattended = buildRunPlan({
      unattended: true,
      channel: 'LIVE',
      settings: baseSettings({ extractScope: 'minimal' }),
      signedIn: true,
    });
    expect(unattended.scope).toBe('minimal');
  });
});
