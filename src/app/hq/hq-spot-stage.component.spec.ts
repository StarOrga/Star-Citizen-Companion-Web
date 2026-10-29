import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { CodexService } from '../codex/codex.service';
import { UpcomingShipsService } from '../codex/upcoming-ships.service';
import { HangarService } from '../hangar/hangar.service';
import { HangarRoleLoadout } from '../hangar/hangar.types';
import { HqSpotStageComponent } from './hq-spot-stage.component';

describe('HqSpotStageComponent', () => {
  async function setup(opts: { sets?: HangarRoleLoadout[] } = {}) {
    const hangar = {
      ships: signal([]),
      recentSets: signal(opts.sets ?? []),
      recentShips: signal([]),
      roleLoadouts: signal(opts.sets ?? []),
      flagshipClassName: signal<string | null>(null),
      loading: signal(false),
      error: signal<string | null>(null),
      loadAll: jasmine.createSpy('loadAll').and.resolveTo(),
      markShipPicked: jasmine.createSpy('markShipPicked'),
      markSetPicked: jasmine.createSpy('markSetPicked'),
    };
    const codex = {
      build: signal(null),
      loadCurrentBuild: jasmine.createSpy('loadCurrentBuild').and.resolveTo(),
      getShipsByClassNames: jasmine.createSpy('getShipsByClassNames').and.resolveTo(new Map()),
      previewUrl: () => null,
    };
    TestBed.configureTestingModule({
      imports: [HqSpotStageComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: HangarService, useValue: hangar },
        { provide: CodexService, useValue: codex },
        {
          provide: UpcomingShipsService,
          useValue: { ensureLoaded: () => Promise.resolve(), stageArtFor: () => ({ src: null, fallbacks: [] }) },
        },
      ],
    });
    const fixture = TestBed.createComponent(HqSpotStageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, codex, el: fixture.nativeElement as HTMLElement };
  }

  it('loads the current build and renders both stages', async () => {
    const { el, codex } = await setup();
    expect(codex.loadCurrentBuild).toHaveBeenCalled();
    expect(el.querySelectorAll('sc-codex-stage').length).toBe(2);
  });

  it('shows empty-state CTAs as real anchors into hangar, locker and codex', async () => {
    const { el } = await setup();
    const hrefs = Array.from(el.querySelectorAll('a.stage-cta')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/hq/hangar', '/codex', '/hq/spind']);
  });

  it('keeps the archive quick-access links', async () => {
    const { el } = await setup();
    const hrefs = Array.from(el.querySelectorAll('a.archive-line__link')).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.startsWith('/codex/index?kind=ship'))).toBeTrue();
    expect(hrefs.some((h) => h.startsWith('/codex/index?kind=armor'))).toBeTrue();
  });
});
