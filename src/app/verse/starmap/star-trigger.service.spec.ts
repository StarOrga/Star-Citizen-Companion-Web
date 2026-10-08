import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { AnalyticsService } from '../../core/analytics.service';
import { VerseApiService } from '../data/verse-api.service';
import { StarTriggerService } from './star-trigger.service';

describe('StarTriggerService', () => {
  const authed = signal(true);
  let api: jasmine.SpyObj<VerseApiService> & { digest: ReturnType<typeof signal> };
  let analytics: jasmine.SpyObj<AnalyticsService>;

  beforeEach(() => {
    authed.set(true);
    const digest = signal<unknown>({ patch: { line: '4.4' } });
    api = Object.assign(
      jasmine.createSpyObj<VerseApiService>('VerseApiService', ['starPool', 'earnStar', 'loadDigest', 'constellation']),
      { digest, digestState: signal('ready') },
    ) as never;
    api.starPool.and.resolveTo({ ok: true, data: ['cx-keybinds', 'cx-fps', 'cx-newship'] });
    api.earnStar.and.resolveTo({ ok: true, data: true });
    api.constellation.and.resolveTo({
      ok: true,
      data: { patchLine: '4.4', className: 'RSI_Zeus', kind: 'ship', points: [] },
    });
    analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', ['captureVerse']);
    TestBed.configureTestingModule({
      providers: [
        { provide: VerseApiService, useValue: api },
        { provide: AuthService, useValue: { isAuthenticated: authed } },
        { provide: AnalyticsService, useValue: analytics },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('earns an offered key for the current patch and reports it', async () => {
    await TestBed.inject(StarTriggerService).earn('cx-keybinds');
    expect(api.earnStar).toHaveBeenCalledOnceWith('4.4', 'cx-keybinds');
    expect(analytics.captureVerse).toHaveBeenCalledOnceWith('verse_star_earned', { patch_line: '4.4', star_key: 'cx-keybinds' });
  });

  it('ignores keys outside the offered pool', async () => {
    await TestBed.inject(StarTriggerService).earn('cx-blueprint');
    expect(api.earnStar).not.toHaveBeenCalled();
    expect(analytics.captureVerse).not.toHaveBeenCalled();
  });

  it('is a silent no-op when signed out', async () => {
    authed.set(false);
    await TestBed.inject(StarTriggerService).earn('cx-keybinds');
    expect(api.starPool).not.toHaveBeenCalled();
    expect(api.earnStar).not.toHaveBeenCalled();
  });

  it('asks the server only once per patch and key', async () => {
    const svc = TestBed.inject(StarTriggerService);
    await svc.earn('cx-fps');
    await svc.earn('cx-fps');
    expect(api.earnStar).toHaveBeenCalledTimes(1);
    expect(api.starPool).toHaveBeenCalledTimes(1);
  });

  it('does not report an already-earned star and never throws', async () => {
    api.earnStar.and.resolveTo({ ok: true, data: false });
    await TestBed.inject(StarTriggerService).earn('cx-fps');
    expect(analytics.captureVerse).not.toHaveBeenCalled();
    api.starPool.and.rejectWith(new Error('offline'));
    await expectAsync(TestBed.inject(StarTriggerService).earn('cx-keybinds')).toBeResolved();
  });

  it('earns cx-newship only on the vehicle the constellation was drawn from', async () => {
    const svc = TestBed.inject(StarTriggerService);
    await svc.codexDetail('ship', 'ANVL_Carrack');
    expect(api.earnStar).not.toHaveBeenCalled();
    await svc.codexDetail('ship', 'rsi_zeus');
    expect(api.earnStar).toHaveBeenCalledOnceWith('4.4', 'cx-newship');
  });
});
