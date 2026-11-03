import { describe, it, expect } from 'vitest';
import { nextInstallStep, bannerModel } from '../src/lib/update-install.js';

const base = { staged: '0.9.0', feedVersion: null, superseded: false, workBusy: false };

describe('nextInstallStep', () => {
  it('has nothing to do without a staged update', () => {
    expect(nextInstallStep({ ...base, staged: null })).toBe('none');
  });
  it('fetches the newer release first when the staged one is outdated', () => {
    expect(nextInstallStep({ ...base, feedVersion: '0.10.0', superseded: true, workBusy: true })).toBe('refetch');
  });
  it('keeps the request standing while work runs (extraction, build or upload)', () => {
    expect(nextInstallStep({ ...base, workBusy: true })).toBe('wait');
  });
  it('installs once the work ended or was paused', () => {
    expect(nextInstallStep(base)).toBe('go');
  });
});

describe('bannerModel install states', () => {
  it('preparing locks the button with text', () => {
    const m = bannerModel({ type: 'install-state', state: 'preparing', version: '0.9.0' }, '0.9.0');
    expect(m.textKey).toBe('update.preparing');
    expect(m.button).toMatchObject({ disabled: true, action: 'install' });
  });
  it('waiting stays visible and offers a veto', () => {
    const m = bannerModel({ type: 'install-state', state: 'waiting', version: '0.9.0' }, '0.9.0');
    expect(m.textKey).toBe('update.waiting');
    expect(m.button).toMatchObject({ disabled: false, action: 'cancel' });
  });
  it('closing announces the 2-3 minute restart and locks the button', () => {
    const m = bannerModel({ type: 'install-state', state: 'closing', version: '0.9.0' }, '0.9.0');
    expect(m.textKey).toBe('update.closing');
    expect(m.button?.disabled).toBe(true);
  });
  it('failed re-enables the install button with an error message', () => {
    const m = bannerModel({ type: 'install-state', state: 'failed', version: '0.9.0' }, '0.9.0');
    expect(m.tone).toBe('error');
    expect(m.button).toMatchObject({ disabled: false, action: 'install' });
  });
  it('downloaded offers install', () => {
    const m = bannerModel({ type: 'downloaded', version: '0.9.0' }, null);
    expect(m.button).toMatchObject({ action: 'install', disabled: false });
  });
});

describe('bannerModel background checks', () => {
  it('a re-check keeps the staged install button', () => {
    for (const type of ['checking', 'not-available'] as const) {
      const m = bannerModel({ type }, '0.9.0');
      expect(m.visible).toBe(true);
      expect(m.button?.action).toBe('install');
    }
  });
  it('hides when nothing is staged', () => {
    expect(bannerModel({ type: 'checking' }, null).visible).toBe(false);
  });
  it('tells that a newer version replaces the staged one', () => {
    const m = bannerModel({ type: 'available', version: '0.10.0', supersedes: '0.9.0' }, '0.9.0');
    expect(m.textKey).toBe('update.supersedes');
    expect(m.params).toEqual({ version: '0.10.0', old: '0.9.0' });
    expect(m.button).toBeNull();
  });
});
