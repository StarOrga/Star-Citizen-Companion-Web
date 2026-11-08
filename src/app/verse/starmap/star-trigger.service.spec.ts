import type { MockedObject } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { AnalyticsService } from '../../core/analytics.service';
import { VerseApiService } from '../data/verse-api.service';
import { StarTriggerService } from './star-trigger.service';

describe('StarTriggerService', () => {
  const authed = signal(true);
  let api: MockedObject<VerseApiService> & { digest: ReturnType<typeof signal> };
  let analytics: MockedObject<AnalyticsService>;

  beforeEach(() => {
    authed.set(true);
    const digest = signal<unknown>({ patch: { line: '4.4' } });
    api = Object.assign(
      {
        starPool: vi.fn().mockName("VerseApiService.starPool"),
        earnStar: vi.fn().mockName("VerseApiService.earnStar"),
        loadDigest: vi.fn().mockName("VerseApiService.loadDigest"),
        constellation: vi.fn().mockName("VerseApiService.constellation"),
        claimNewShip: vi.fn().mockName("VerseApiService.claimNewShip")
      },
      { digest, digestState: signal('ready') },
    ) as never;
    api.starPool.mockResolvedValue({ ok: true, data: ['cx-keybinds', 'cx-fps', 'cx-newship'] });
    api.earnStar.mockResolvedValue({ ok: true, data: true });
    api.constellation.mockResolvedValue({
      ok: true,
      data: { patchLine: '4.4', className: 'RSI_Zeus', kind: 'ship', points: [] },
    });
    analytics = {
      captureVerse: vi.fn().mockName("AnalyticsService.captureVerse")
    } as unknown as MockedObject<AnalyticsService>;
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
    expect(api.earnStar).toHaveBeenCalledTimes(1);
    expect(api.earnStar).toHaveBeenCalledWith('4.4', 'cx-keybinds');
    expect(analytics.captureVerse).toHaveBeenCalledTimes(1);
    expect(analytics.captureVerse).toHaveBeenCalledWith('verse_star_earned', { patch_line: '4.4', star_key: 'cx-keybinds' });
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
    api.earnStar.mockResolvedValue({ ok: true, data: false });
    await TestBed.inject(StarTriggerService).earn('cx-fps');
    expect(analytics.captureVerse).not.toHaveBeenCalled();
    api.starPool.mockRejectedValue(new Error('offline'));
    await expect(TestBed.inject(StarTriggerService).earn('cx-keybinds')).resolves.not.toThrow();
  });

  it('hands the opened vehicle to the server for cx-newship (no client-side answer)', async () => {
    api.claimNewShip.mockResolvedValue({ ok: true, data: 'earned' });
    const svc = TestBed.inject(StarTriggerService);
    await svc.codexDetail('ship', 'rsi_zeus');
    expect(api.claimNewShip).toHaveBeenCalledTimes(1);
    expect(api.claimNewShip).toHaveBeenCalledWith('4.4', 'rsi_zeus');
    expect(api.earnStar).not.toHaveBeenCalled();
    expect(api.constellation).not.toHaveBeenCalled();
    expect(analytics.captureVerse).toHaveBeenCalledTimes(1);
    expect(analytics.captureVerse).toHaveBeenCalledWith('verse_star_earned', { patch_line: '4.4', star_key: 'cx-newship' });
  });

  it('keeps cx-newship retryable while the guess is still open, and ignores non-vehicles', async () => {
    api.claimNewShip.mockResolvedValue({ ok: true, data: 'guess_first' });
    const svc = TestBed.inject(StarTriggerService);
    await svc.codexDetail('ship', 'rsi_zeus');
    await svc.codexDetail('ship', 'rsi_zeus');
    expect(api.claimNewShip).toHaveBeenCalledTimes(2);
    await svc.codexDetail('weapon', 'x');
    expect(api.claimNewShip).toHaveBeenCalledTimes(2);
  });
});
