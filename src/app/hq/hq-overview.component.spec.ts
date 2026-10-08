import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { HangarService } from '../hangar/hangar.service';
import { HangarRoleLoadout, HangarShip, HangarShipConfig } from '../hangar/hangar.types';
import { HqOverviewComponent } from './hq-overview.component';
import { HqOwnershipService } from './hq-ownership.service';

const ship = (id: string, cn: string): HangarShip => ({
  id,
  shipClassName: cn,
  customName: null,
  status: 'owned',
  pinnedRank: null,
  selectedSkinId: null,
  notes: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});

const set = (id: string, name: string): HangarRoleLoadout => ({
  id,
  name,
  role: 'fps',
  items: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});

describe('HqOverviewComponent', () => {
  function setup(opts: { ships?: HangarShip[]; sets?: HangarRoleLoadout[]; configs?: HangarShipConfig[] }) {
    const ships = signal(opts.ships ?? []);
    const sets = signal(opts.sets ?? []);
    const order = signal<string[]>([]);
    const hangar = {
      ships,
      roleLoadouts: sets,
      loading: signal(false),
      error: signal<string | null>(null),
      recentShips: computed(() => {
        const picked = order().map((cn) => ships().find((s) => s.shipClassName === cn)!).filter(Boolean);
        return picked.length ? picked : ships().slice(0, 3);
      }),
      recentSets: computed(() => sets().slice(0, 3)),
      loadAll: jasmine.createSpy('loadAll').and.resolveTo(),
      markShipPicked: jasmine.createSpy('markShipPicked').and.callFake((cn: string) => order.set([cn])),
      markSetPicked: jasmine.createSpy('markSetPicked'),
    };
    const ownership = {
      error: signal<string | null>(null),
      ensureLoaded: jasmine.createSpy('ensureLoaded').and.resolveTo(),
      invalidate: jasmine.createSpy('invalidate'),
      configsForShip: (id: string) => (opts.configs ?? []).filter((c) => c.hangarShipId === id),
    };
    TestBed.configureTestingModule({
      imports: [HqOverviewComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: HangarService, useValue: hangar },
        { provide: HqOwnershipService, useValue: ownership },
      ],
    });
    const fixture = TestBed.createComponent(HqOverviewComponent);
    fixture.detectChanges();
    return { fixture, hangar, el: fixture.nativeElement as HTMLElement };
  }

  it('shows empty states with ways forward when hangar and locker are empty', () => {
    const { el, hangar } = setup({});
    expect(hangar.loadAll).toHaveBeenCalled();
    const links = Array.from(el.querySelectorAll('a.tile-link')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/hq/hangar', '/hq/spind']);
    expect(el.textContent).toContain('hq.overview.opsEmpty');
    expect(el.textContent).toContain('hq.overview.suppliesEmpty');
  });

  it('links the active ship into the hangar and its active variant into the codex (?v)', () => {
    const cfg = { id: 'cfg-1', hangarShipId: 's1', name: 'PvP', isActive: true } as HangarShipConfig;
    const { el } = setup({ ships: [ship('s1', 'AEGS_Gladius')], configs: [cfg] });
    const main = el.querySelector('a.tile-main');
    expect(main?.getAttribute('href')).toBe('/hq/hangar/s1');
    expect(main?.textContent).toContain('PvP');
    expect(el.querySelector('a.tile-link')?.getAttribute('href')).toBe('/codex/ship/AEGS_Gladius?v=cfg-1');
  });

  it('falls back to the plain codex ship page without an active variant', () => {
    const { el } = setup({ ships: [ship('s1', 'AEGS_Gladius')] });
    expect(el.querySelector('a.tile-link')?.getAttribute('href')).toBe('/codex/ship/AEGS_Gladius');
  });

  it('switches the active ship through the recent-ships chips (moved from the codex landing)', () => {
    const { fixture, el, hangar } = setup({ ships: [ship('s1', 'A_One'), ship('s2', 'B_Two')] });
    const chips = el.querySelectorAll<HTMLButtonElement>('.chips button.chip');
    expect(chips.length).toBe(2);
    chips[1].click();
    fixture.detectChanges();
    expect(hangar.markShipPicked).toHaveBeenCalledWith('B_Two');
    expect(el.querySelector('a.tile-main')?.getAttribute('href')).toBe('/hq/hangar/s2');
  });

  it('links the active set into the locker', () => {
    const { el } = setup({ sets: [set('l1', 'Boarding Kit')] });
    const setLink = Array.from(el.querySelectorAll('a.tile-main')).find((a) => a.textContent?.includes('Boarding Kit'));
    expect(setLink?.getAttribute('href')).toBe('/hq/spind/l1');
  });
});
