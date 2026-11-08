import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AnalyticsService } from '../core/analytics.service';
import { CodexDetailComponent } from '../codex/codex-detail.component';
import { HqOwnershipService } from '../hq/hq-ownership.service';
import { HangarService } from './hangar.service';
import { HangarShipPageComponent } from './hangar-ship-page.component';

/** Stands in for the real Codex view: the page only has to host it with the right ship. */
@Component({ selector: 'sc-codex-detail', standalone: true, template: '<i class="stub"></i>' })
class StubCodexDetailComponent {
  readonly hostClassName = input<string | null>(null);
  readonly hostShipId = input<string | null>(null);
}

describe('HangarShipPageComponent (/hq/hangar/:id)', () => {
  afterEach(() => {
    localStorage.removeItem('sc.beta');
    TestBed.resetTestingModule();
  });

  async function run(opts: { id: string; ships: unknown[]; configs: unknown[]; shell: boolean | null; query?: Record<string, string> }, analytics = { flags: signal<Record<string, boolean>>({}), flagsPending: signal(false) }) {
    if (opts.shell !== null) localStorage.setItem('sc.beta', JSON.stringify({ shell: opts.shell }));
    TestBed.configureTestingModule({
      imports: [HangarShipPageComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(convertToParamMap({ id: opts.id })),
            snapshot: { paramMap: convertToParamMap({ id: opts.id }), queryParamMap: convertToParamMap(opts.query ?? {}) },
          },
        },
        { provide: AnalyticsService, useValue: { ...analytics, captureVerse: () => undefined } },
        { provide: AuthService, useValue: { user: signal({ id: 'u' }) } },
        { provide: HangarService, useValue: { ships: signal(opts.ships), loadAll: async () => undefined } },
        { provide: HqOwnershipService, useValue: { ensureLoaded: async () => undefined, configsForShip: () => opts.configs } },
      ],
    });
    TestBed.overrideComponent(HangarShipPageComponent, {
      remove: { imports: [CodexDetailComponent] },
      add: { imports: [StubCodexDetailComponent] },
    });
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(HangarShipPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { nav, fixture, analytics };
  }

  const gladius = { id: 's1', shipClassName: 'AEGS_Gladius' };

  describe('without the shell beta', () => {
    it('sends an old link to the personal view of the active variant', async () => {
      const { nav, fixture } = await run({ id: 's1', ships: [gladius], configs: [{ id: 'c1', isActive: true }], shell: false });
      expect(nav).toHaveBeenCalledWith(['/codex/ship', 'AEGS_Gladius'], { queryParams: { v: 'c1' }, replaceUrl: true });
      expect((fixture.nativeElement as HTMLElement).querySelector('sc-codex-detail')).toBeNull();
    });

    it('sends an unknown id to the hangar list', async () => {
      const { nav } = await run({ id: 'gone', ships: [], configs: [], shell: false });
      expect(nav).toHaveBeenCalledWith(['/hq/hangar'], { replaceUrl: true });
    });
  });

  describe('with the shell beta', () => {
    it('renders the Codex ship view in place for the hangar ship, no redirect into /codex', async () => {
      const { nav, fixture } = await run({
        id: 's1', ships: [gladius], configs: [{ id: 'c1', isActive: true }], shell: true, query: { v: 'c1' },
      });
      const detail = fixture.debugElement.children.find((d) => d.name === 'sc-codex-detail');
      expect(detail).toBeTruthy();
      expect(detail!.componentInstance.hostClassName()).toBe('AEGS_Gladius');
      expect(detail!.componentInstance.hostShipId()).toBe('s1');
      expect(nav).not.toHaveBeenCalled();
    });

    it('puts the active variant on the HQ URL when none (or a variant of another ship) is named', async () => {
      const { nav } = await run({
        id: 's1', ships: [gladius], configs: [{ id: 'c0', isActive: false }, { id: 'c1', isActive: true }], shell: true, query: { v: 'foreign' },
      });
      expect(nav).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { v: 'c1' }, replaceUrl: true }));
    });

    it('does not bounce through /codex while the shell flag is still loading', async () => {
      const analytics = { flags: signal<Record<string, boolean>>({}), flagsPending: signal(true) };
      const { nav, fixture } = await run(
        { id: 's1', ships: [gladius], configs: [{ id: 'c1', isActive: true }], shell: null, query: { v: 'c1' } },
        analytics,
      );
      expect(nav).not.toHaveBeenCalled(); // default (off) must not decide yet
      expect((fixture.nativeElement as HTMLElement).querySelector('sc-codex-detail')).toBeNull();
      analytics.flags.set({ 'beta-shell': true });
      analytics.flagsPending.set(false);
      fixture.detectChanges(); // flushes the effect behind toObservable
      await fixture.whenStable();
      fixture.detectChanges();
      expect(nav).not.toHaveBeenCalled();
      expect((fixture.nativeElement as HTMLElement).querySelector('sc-codex-detail')).not.toBeNull();
    });

    it('sends an unknown id to the hangar list', async () => {
      const { nav, fixture } = await run({ id: 'gone', ships: [], configs: [], shell: true });
      expect(nav).toHaveBeenCalledWith(['/hq/hangar'], { replaceUrl: true });
      expect((fixture.nativeElement as HTMLElement).querySelector('sc-codex-detail')).toBeNull();
    });
  });
});
