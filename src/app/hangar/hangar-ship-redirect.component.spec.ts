import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { HqOwnershipService } from '../hq/hq-ownership.service';
import { HangarService } from './hangar.service';
import { HangarShipRedirectComponent } from './hangar-ship-redirect.component';

describe('HangarShipRedirectComponent (/hq/hangar/:id)', () => {
  async function run(id: string, ships: unknown[], configs: unknown[]): Promise<jasmine.Spy> {
    TestBed.configureTestingModule({
      imports: [HangarShipRedirectComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id }) } } },
        { provide: AuthService, useValue: { user: signal({ id: 'u' }) } },
        { provide: HangarService, useValue: { ships: signal(ships), loadAll: async () => undefined } },
        { provide: HqOwnershipService, useValue: { ensureLoaded: async () => undefined, configsForShip: () => configs } },
      ],
    });
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(HangarShipRedirectComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return nav;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('sends an old link to the personal view of the active variant', async () => {
    const nav = await run('s1', [{ id: 's1', shipClassName: 'AEGS_Gladius' }], [{ id: 'c1', isActive: true }]);
    expect(nav).toHaveBeenCalledWith(['/codex/ship', 'AEGS_Gladius'], { queryParams: { v: 'c1' }, replaceUrl: true });
  });

  it('sends an unknown id to the hangar list', async () => {
    const nav = await run('gone', [], []);
    expect(nav).toHaveBeenCalledWith(['/hq/hangar'], { replaceUrl: true });
  });
});
