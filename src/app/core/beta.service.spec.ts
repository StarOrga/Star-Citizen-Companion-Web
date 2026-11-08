import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { AnalyticsService } from './analytics.service';
import { BETA_STORAGE_KEY, BetaService, betaAreaOf } from './beta.service';

describe('BetaService', () => {
  let flags: WritableSignal<Record<string, boolean | string>>;
  let captureVerse: Mock;

  function create(): BetaService {
    TestBed.configureTestingModule({
      providers: [{ provide: AnalyticsService, useValue: { flags: () => flags(), captureVerse } }],
    });
    return TestBed.inject(BetaService);
  }

  beforeEach(() => {
    localStorage.removeItem(BETA_STORAGE_KEY);
    localStorage.removeItem('sc.verse.beta');
    flags = signal<Record<string, boolean | string>>({});
    captureVerse = vi.fn().mockName('captureVerse');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.removeItem(BETA_STORAGE_KEY);
    localStorage.removeItem('sc.verse.beta');
  });

  it('keeps the app-wide shell switch off by default and lets it be toggled and persisted', () => {
    const svc = create();
    expect(svc.state().shell).toBe(false);
    svc.toggle('shell');
    expect(svc.state().shell).toBe(true);
    TestBed.resetTestingModule();
    expect(create().state().shell).toBe(true);
    expect(betaAreaOf('/verse')).toBe('verse');
  });

  it('defaults Verse to off and the already-live Codex/HQ split to on', () => {
    const svc = create();
    expect(svc.state()).toEqual({ verse: false, codex: true, shell: false });
  });

  it('persists a per-area choice that touches no other area and emits beta_toggle', () => {
    const svc = create();
    svc.set('verse', true);
    expect(svc.state()).toEqual({ verse: true, codex: true, shell: false });
    svc.set('codex', false);
    expect(svc.state()).toEqual({ verse: true, codex: false, shell: false });
    expect(svc.isEnabled('codex')()).toBe(false);
    expect(JSON.parse(localStorage.getItem(BETA_STORAGE_KEY) ?? '{}')).toEqual({ verse: true, codex: false });
    expect(captureVerse).toHaveBeenCalledWith('beta_toggle', { area: 'codex', enabled: false });
    TestBed.resetTestingModule();
    expect(create().state()).toEqual({ verse: true, codex: false, shell: false });
  });

  it('treats a boolean flag as default and a flag false as a kill switch', () => {
    const svc = create();
    flags.set({ 'beta-verse': true, 'beta-codex': false });
    expect(svc.state().verse).toBe(true);
    expect(svc.state().codex).toBe(false);
    svc.set('codex', true);
    expect(svc.state().codex).toBe(false);
    expect(svc.locked().codex).toBe(true);
    svc.set('verse', false);
    expect(svc.state().verse).toBe(false);
  });

  it('folds the old per-sub-area Verse choices into one and drops the old key', () => {
    localStorage.setItem('sc.verse.beta', JSON.stringify({ briefing: false, news: true }));
    expect(create().state().verse).toBe(true);
    expect(localStorage.getItem('sc.verse.beta')).toBeNull();
    expect(JSON.parse(localStorage.getItem(BETA_STORAGE_KEY) ?? '{}')).toEqual({ verse: true });
  });

  it('survives unreadable and unwritable storage', () => {
    localStorage.setItem(BETA_STORAGE_KEY, '{not json');
    const svc = create();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => svc.toggle('verse')).not.toThrow();
    expect(svc.state().verse).toBe(true);
  });
});

describe('betaAreaOf', () => {
  it('maps every page of a nav item with a switch, and nothing else', () => {
    expect(betaAreaOf('/verse')).toBe('verse');
    expect(betaAreaOf('/verse/patches/4.3?x=1')).toBe('verse');
    expect(betaAreaOf('/codex')).toBe('codex');
    expect(betaAreaOf('/codex/ship/aegs_gladius?v=abc')).toBe('codex');
    expect(betaAreaOf('/hq/hangar')).toBeNull();
    expect(betaAreaOf('/codexfoo')).toBeNull();
    expect(betaAreaOf('/admin')).toBeNull();
  });
});
