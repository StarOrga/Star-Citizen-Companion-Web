import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { CodexHoloHangarComponent } from './codex-holo-hangar.component';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { HangarShip, HangarShipConfig } from '../../hangar/hangar.types';
import { CodexService } from '../codex.service';
import { HoloSilhouette } from '../holo-silhouette';

function ship(id: string, className: string): HangarShip {
  return {
    id,
    shipClassName: className,
    customName: null,
    status: 'owned',
    pinnedRank: null,
    selectedSkinId: null,
    notes: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

function config(id: string, hangarShipId: string, role: HangarShipConfig['role'], isActive: boolean): HangarShipConfig {
  return {
    id,
    hangarShipId,
    name: 'Default',
    role,
    loadout: [],
    isActive,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
    sourceConfigId: null,
    followsOwner: false,
    ownerUserId: null,
    forkedAt: null,
    ownerName: null,
    ownerUpdatedAt: null,
    sharedChannel: null,
    sharedPatchVersion: null,
  };
}

async function setup(opts: {
  signedIn?: boolean;
  ships?: HangarShip[];
  configsByShip?: Record<string, HangarShipConfig[]>;
} = {}): Promise<{ fixture: ComponentFixture<CodexHoloHangarComponent>; listConfigs: jasmine.Spy }> {
  const ships = opts.ships ?? [ship('s1', 'CNOU_Nomad')];
  const configsByShip = opts.configsByShip ?? {};
  const listConfigs = jasmine
    .createSpy('listConfigs')
    .and.callFake((id: string) => Promise.resolve(configsByShip[id] ?? []));

  const hangar: Partial<HangarService> = {
    ships: signal(ships) as never,
    loadAll: jasmine.createSpy('loadAll').and.resolveTo(undefined),
    listConfigs,
    refreshFollowedLoadout: jasmine.createSpy('refreshFollowedLoadout').and.callFake((id: string) => {
      for (const configs of Object.values(configsByShip)) {
        const cfg = configs.find((c) => c.id === id);
        if (cfg?.followsOwner) return Promise.resolve({ ...cfg, ownerName: 'Owner Name' });
      }
      return Promise.resolve(null);
    }),
  };
  const codex: Partial<CodexService> = {
    silhouettes: jasmine.createSpy('silhouettes').and.resolveTo(new Map<string, HoloSilhouette>()),
  };
  const auth: Partial<AuthService> = {
    user: signal(opts.signedIn === false ? null : ({ id: 'u1' } as never)) as never,
  };

  await TestBed.configureTestingModule({
    imports: [CodexHoloHangarComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      { provide: HangarService, useValue: hangar },
      { provide: CodexService, useValue: codex },
      { provide: AuthService, useValue: auth },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CodexHoloHangarComponent);
  fixture.detectChanges();
  return { fixture, listConfigs };
}

describe('CodexHoloHangarComponent', () => {
  it('shows only the sign-in hint when signed out', async () => {
    const { fixture } = await setup({ signedIn: false });
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.hh-tab') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.signin-hint')).toBeTruthy();
    expect(el.querySelector('.hh-search')).toBeNull();
  });

  it('opens a fixed-height overlay with no scrollbar and an always-visible search field', async () => {
    const { fixture } = await setup();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.hh-tab') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const overlay = el.querySelector('.hh-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(el.querySelector('.hh-search')).toBeTruthy();
    const style = getComputedStyle(overlay);
    expect(style.overflow).toBe('hidden');
  });

  it('groups ships by Einsatz once the fit threshold is exceeded', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ship(`s${i}`, `SHIP_${i}`));
    const configsByShip: Record<string, HangarShipConfig[]> = {};
    many.forEach((s, i) => {
      configsByShip[s.id] = [config(`c${i}`, s.id, i % 2 === 0 ? 'combat' : 'mining', true)];
    });
    const { fixture } = await setup({ ships: many, configsByShip });
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.hh-tab') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelectorAll('.hh-group').length).toBeGreaterThan(1);
    expect(el.querySelectorAll('.hh-tile').length).toBe(0);
  });

  it('shows a "verwaltet von" hint for a followed config instead of a source', async () => {
    const followed = config('c1', 's1', 'combat', true);
    followed.followsOwner = true;
    followed.ownerUserId = 'owner-1';
    followed.ownerUpdatedAt = '2026-09-19T00:00:00Z';
    const { fixture } = await setup({ configsByShip: { s1: [followed] } });
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.hh-tab') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.variant')).toBeTruthy();
    const tile = fixture.componentInstance['tiles']().find((t: { ship: { id: string } }) => t.ship.id === 's1');
    expect(tile!.variantHintKey).toBe('codex.holo.hangar.managedBy');
    expect(tile!.variantHintParams).toEqual({ owner: 'Owner Name' });
  });
});
