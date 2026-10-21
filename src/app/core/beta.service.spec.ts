import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { AnalyticsService } from './analytics.service';
import { BETA_STORAGE_KEY, BetaService, betaAreaOf } from './beta.service';

describe('BetaService', () => {
  let flags: WritableSignal<Record<string, boolean | string>>;
  let captureVerse: jasmine.Spy;

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
    captureVerse = jasmine.createSpy('captureVerse');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.removeItem(BETA_STORAGE_KEY);
    localStorage.removeItem('sc.verse.beta');
  });

  it('defaults Verse to off and the already-live Codex/HQ split to on', () => {
    const svc = create();
    expect(svc.state()).toEqual({ verse: false, codex: true });
  });

  it('persists a per-area choice that touches no other area and emits beta_toggle', () => {
    const svc = create();
    svc.set('verse', true);
    expect(svc.state()).toEqual({ verse: true, codex: true });
    svc.set('codex', false);
    expect(svc.state()).toEqual({ verse: true, codex: false });
    expect(svc.isEnabled('codex')()).toBeFalse();
    expect(JSON.parse(localStorage.getItem(BETA_STORAGE_KEY) ?? '{}')).toEqual({ verse: true, codex: false });
    expect(captureVerse).toHaveBeenCalledWith('beta_toggle', { area: 'codex', enabled: false });
    TestBed.resetTestingModule();
    expect(create().state()).toEqual({ verse: true, codex: false });
  });

  it('treats a boolean flag as default and a flag false as a kill switch', () => {
    const svc = create();
    flags.set({ 'beta-verse': true, 'beta-codex': false });
    expect(svc.state().verse).toBeTrue();
    expect(svc.state().codex).toBeFalse();
    svc.set('codex', true);
    expect(svc.state().codex).toBeFalse();
    expect(svc.locked().codex).toBeTrue();
    svc.set('verse', false);
    expect(svc.state().verse).toBeFalse();
  });

  it('folds the old per-sub-area Verse choices into one and drops the old key', () => {
    localStorage.setItem('sc.verse.beta', JSON.stringify({ briefing: false, news: true }));
    expect(create().state().verse).toBeTrue();
    expect(localStorage.getItem('sc.verse.beta')).toBeNull();
    expect(JSON.parse(localStorage.getItem(BETA_STORAGE_KEY) ?? '{}')).toEqual({ verse: true });
  });

  it('survives unreadable and unwritable storage', () => {
    localStorage.setItem(BETA_STORAGE_KEY, '{not json');
    const svc = create();
    spyOn(Storage.prototype, 'setItem').and.throwError('quota');
    expect(() => svc.toggle('verse')).not.toThrow();
    expect(svc.state().verse).toBeTrue();
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
