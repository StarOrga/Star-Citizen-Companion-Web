// #646 — a shared link (`?shared=`) and an own config (`?config=`) on the
// Holotable, on the real page with the same Nomad fixture/stub shape as
// codex-detail-holo-toggle.spec.ts.
import { provideNoShipBlueprints } from './ship-blueprint/ship-blueprint.testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { CodexDetailComponent } from './codex-detail.component';
import { CodexService, ResolvedEntity } from './codex.service';
import { HangarService } from '../hangar/hangar.service';
import { SharedLoadoutAdopter } from '../hangar/shared-loadout-adopter.service';
import type { PeekedSharedLoadout } from '../hangar/hangar.types';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';
import { UexShopService } from './uex-shop.service';
import { UpcomingShipsService } from './upcoming-ships.service';
import { ShipLinkService } from './ship-link.service';
import { ShipSkinsService } from './ship-skins.service';
import { AssetPackageService } from './asset-package/asset-package.service';
import { RankShipInput } from './codex-rank';
import { NOMAD_POWER_FIXTURE, fixtureOccupant, type OccupantFixture } from './testing/nomad-power.fixture';
import type { ShipPayload, LoadoutEntry } from './codex.types';
import type { CodexKind } from './codex.service';

const PORT_BY_SECTION: Record<string, string> = {
  powerPlants: 'hardpoint_powerplant_01',
  coolers: 'hardpoint_cooler_01',
  shields: 'hardpoint_shield_generator_01',
  weapons: 'hardpoint_weapon_top_left',
  structure: 'hardpoint_thruster_main_left',
  radar: 'hardpoint_radar_01',
  lifeSupport: 'hardpoint_life_support_01',
};

function loadoutEntriesFrom(fixtures: readonly OccupantFixture[]): LoadoutEntry[] {
  const seen = new Map<string, number>();
  return fixtures.map((fx) => {
    const n = (seen.get(fx.section) ?? 0) + 1;
    seen.set(fx.section, n);
    const base = PORT_BY_SECTION[fx.section] ?? `hardpoint_${fx.section}_01`;
    return { itemPortName: n === 1 ? base : `${base}_${n}`, entityClassName: fx.className };
  });
}

function entityPayloadsFrom(
  fixtures: readonly OccupantFixture[],
): Map<string, { kind: CodexKind; payload: unknown }> {
  const out = new Map<string, { kind: CodexKind; payload: unknown }>();
  for (const fx of fixtures) {
    const occ = fixtureOccupant(fx);
    out.set(fx.className, { kind: (fx.kind as CodexKind) ?? 'component', payload: occ.payload });
  }
  return out;
}

function resolvedEntitiesFrom(fixtures: readonly OccupantFixture[]): Map<string, ResolvedEntity> {
  const out = new Map<string, ResolvedEntity>();
  for (const fx of fixtures) {
    out.set(fx.className, {
      kind: (fx.kind as CodexKind) ?? 'component',
      className: fx.className,
      nameLocalized: fx.className,
      manufacturerCode: null,
      size: fx.size ?? null,
      grade: null,
    });
  }
  return out;
}

const NOMAD_PAYLOAD: ShipPayload = {
  entityKind: 'ship',
  className: 'CNOU_Nomad',
  role: null,
  crew: { size: 2 },
  vehicleName: { en_EN: 'Nomad' },
  dimensions: null,
  flight: { scmSpeed: 205, maxSpeed: 1180, boostSpeed: 340, pitch: 55, yaw: 55, roll: 90 },
  itemPorts: [],
  defaultLoadout: loadoutEntriesFrom(NOMAD_POWER_FIXTURE),
  hull: { hp: null, mass: null },
  armorHp: 0,
  cargoScu: 24,
  career: '@vehicle_focus_Light_Freight',
  stats: {} as never,
} as unknown as ShipPayload;

function makeCodexServiceStub(): Partial<CodexService> {
  const entityPayloads = entityPayloadsFrom(NOMAD_POWER_FIXTURE);
  const resolved = resolvedEntitiesFrom(NOMAD_POWER_FIXTURE);
  const cohort: RankShipInput[] = [
    { className: 'CNOU_Nomad', sizeClass: null, career: '@vehicle_focus_Light_Freight', sheet: {} },
  ];
  return {
    build: signal({
      id: 'build-1',
      patchVersion: '4.9.0',
      channel: 'LIVE',
      buildNumber: '1',
      schemaVersion: 3,
      isCurrent: true,
    }) as never,
    compareKeys: signal<string[]>([]) as never,
    getDetail: async () => ({
      classNameSlug: 'cnou_nomad',
      kind: 'ship',
      row: { role: null },
      payload: NOMAD_PAYLOAD,
      ports: [],
      strings: [],
    }),
    resolveEntities: async () => resolved,
    getEntityPayloads: async () => entityPayloads,
    getAmmoPayloads: async () => new Map(),
    resolveLocaleKeys: async () => new Map(),
    listSkinSiblings: async () => [],
    listEditionSiblings: async () => [],
    blueprintsUsingIngredient: async () => [],
    getCraftingRecipe: async () => null,
    getRankCohort: async () => cohort,
    previewUrl: () => null,
    getCompatibleItems: async () => [],
    isPinned: () => false,
    togglePin: async () => undefined,
    // Wave 2: optional-chained by the component, but stubbed anyway so the
    // holo-view toggle tests exercise the real (non-degraded) code path.
    silhouette: async () => null,
  } as Partial<CodexService>;
}

const GUN_PORT = 'hardpoint_weapon_top_left';
const SHARED_GUN = 'BEHR_LaserCannon_S3';

const PEEK: PeekedSharedLoadout = {
  shipClassName: 'cnou_nomad',
  loadout: [{ portName: GUN_PORT, className: SHARED_GUN, kind: 'weapon' }],
  name: 'Brawler',
  role: 'combat',
  channel: 'LIVE',
  patchVersion: '4.9.0',
  ownerName: 'Kestrel',
};

interface HangarStub {
  peekSharedLoadout: jasmine.Spy;
  listConfigs: jasmine.Spy;
}

async function setup(
  queryParams: Record<string, string>,
  hangar: HangarStub,
  adoptAndOpen = jasmine.createSpy('adoptAndOpen').and.resolveTo(true),
): Promise<ComponentFixture<CodexDetailComponent>> {
  await TestBed.configureTestingModule({
    imports: [CodexDetailComponent],
    providers: [
      provideNoShipBlueprints(),
      provideRouter([]),
      provideTranslateService({}),
      { provide: CodexService, useValue: makeCodexServiceStub() },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({ kind: 'ship', className: 'cnou_nomad' })),
          queryParamMap: of(convertToParamMap(queryParams)),
          snapshot: {
            paramMap: convertToParamMap({ kind: 'ship', className: 'cnou_nomad' }),
            queryParamMap: convertToParamMap(queryParams),
          },
        },
      },
      {
        provide: HangarService,
        useValue: {
          roleLoadouts: signal([]),
          listAllConfigs: async () => [],
          ships: signal([{ id: 'ship-1', shipClassName: 'cnou_nomad' }]),
          loadAll: async () => undefined,
          addShip: async () => null,
          shipByClassName: () => ({ id: 'ship-1' }),
          recentShips: signal([]),
          markShipPicked: () => undefined,
          ...hangar,
        } as unknown as Partial<HangarService>,
      },
      { provide: SharedLoadoutAdopter, useValue: { adoptAndOpen } },
      { provide: AuthService, useValue: { user: signal(authUser), whenReady: async () => undefined } as unknown as Partial<AuthService> },
      { provide: RoleService, useValue: {} as Partial<RoleService> },
      {
        provide: ShipSkinsService,
        useValue: { listSkins: async () => ({ skins: [], error: false }), assetUrl: (p: string | null) => p } as Partial<ShipSkinsService>,
      },
      { provide: UexShopService, useValue: { whereToBuy: async () => [] } as Partial<UexShopService> },
      { provide: AssetPackageService, useValue: { findRow: async () => null } as Partial<AssetPackageService> },
      {
        provide: UpcomingShipsService,
        useValue: { ensureLoaded: async () => undefined, heroArtFor: () => [] } as Partial<UpcomingShipsService>,
      },
      {
        provide: ShipLinkService,
        useValue: {
          myLinks: signal(new Map()),
          globalLinks: signal(new Map()),
          loadForShip: async () => undefined,
        } as Partial<ShipLinkService>,
      },
    ],
  }).compileComponents();
  spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
  const fixture: ComponentFixture<CodexDetailComponent> = TestBed.createComponent(CodexDetailComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

/** The signed-in reader of the next setup() (null = signed out). */
let authUser: { id: string } | null = null;

describe('CodexDetailComponent — shared link / own config on the Holotable (#646)', () => {
  beforeEach(() => {
    localStorage.removeItem('sc.codex.holoView');
    authUser = null;
  });

  it('?shared= puts the peeked loadout on the table READ-ONLY with the banner', async () => {
    const hangar = {
      peekSharedLoadout: jasmine.createSpy('peek').and.resolveTo(PEEK),
      listConfigs: jasmine.createSpy('listConfigs').and.resolveTo([]),
    };
    const fixture = await setup({ view: 'holo', shared: 'tok' }, hangar);
    const c = fixture.componentInstance;
    expect(hangar.peekSharedLoadout).toHaveBeenCalledWith('tok');
    expect(c.draftReadOnly()).toBeTrue();
    expect(c.sharedDraft()).toEqual(jasmine.objectContaining({ status: 'ready', ownerName: 'Kestrel', configName: 'Brawler' }));
    expect(c.draftChangedCount()).toBe(1);
    const banner = (fixture.nativeElement as HTMLElement).querySelector('.shared-banner');
    expect(banner?.textContent).toContain('codex.holo.shared.banner');
    // Read-only: the swap picker never opens.
    const open = spyOn(c, 'openSwapPicker');
    c.onHoloSwapRequested({} as never);
    expect(open).not.toHaveBeenCalled();
  });

  it('switching to the classic view leaves the read-only shared view', async () => {
    const hangar = {
      peekSharedLoadout: jasmine.createSpy('peek').and.resolveTo(PEEK),
      listConfigs: jasmine.createSpy('listConfigs').and.resolveTo([]),
    };
    const fixture = await setup({ view: 'holo', shared: 'tok' }, hangar);
    const c = fixture.componentInstance;
    expect(c.draftReadOnly()).toBeTrue();
    c.toggleHoloView();
    expect(c.draftReadOnly()).toBeFalse();
    expect(c.sharedDraft()).toBeNull();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { view: 'classic', shared: null } }),
    );
  });

  it('a failed peek is an error banner with retry; the retry loads it', async () => {
    const hangar = {
      peekSharedLoadout: jasmine.createSpy('peek').and.rejectWith({ message: 'Failed to fetch' }),
      listConfigs: jasmine.createSpy('listConfigs').and.resolveTo([]),
    };
    const fixture = await setup({ view: 'holo', shared: 'tok' }, hangar);
    const c = fixture.componentInstance;
    expect(c.sharedDraft()?.status).toBe('error');
    expect(c.draftReadOnly()).toBeFalse();
    hangar.peekSharedLoadout.and.resolveTo(PEEK);
    c.retrySharedDraft();
    await fixture.whenStable();
    expect(c.sharedDraft()?.status).toBe('ready');
    expect(c.draftReadOnly()).toBeTrue();
  });

  it('a link for another hull keeps stock and says so', async () => {
    const hangar = {
      peekSharedLoadout: jasmine.createSpy('peek').and.resolveTo({ ...PEEK, shipClassName: 'AEGS_Gladius' }),
      listConfigs: jasmine.createSpy('listConfigs').and.resolveTo([]),
    };
    const fixture = await setup({ view: 'holo', shared: 'tok' }, hangar);
    expect(fixture.componentInstance.sharedDraft()?.status).toBe('unavailable');
    expect(fixture.componentInstance.draftChangedCount()).toBe(0);
  });

  it('adopt hands the token to the adopter', async () => {
    const hangar = {
      peekSharedLoadout: jasmine.createSpy('peek').and.resolveTo(PEEK),
      listConfigs: jasmine.createSpy('listConfigs').and.resolveTo([]),
    };
    const adopt = jasmine.createSpy('adoptAndOpen').and.resolveTo(true);
    const fixture = await setup({ view: 'holo', shared: 'tok' }, hangar, adopt);
    await fixture.componentInstance.adoptSharedDraft();
    expect(adopt).toHaveBeenCalledWith('tok', 'cnou_nomad');
  });

  it('legacy ?config= becomes ?v= and opens THAT variant as the (saved) draft — not stock', async () => {
    const adopted = {
      id: 'cfg-adopted',
      hangarShipId: 'ship-1',
      name: 'Brawler',
      role: 'combat',
      isActive: false,
      loadout: [{ portName: GUN_PORT, className: SHARED_GUN, kind: 'weapon' }],
      followsOwner: true,
      ownerName: 'Kestrel',
    };
    authUser = { id: 'u1' };
    const configs = [{ id: 'other', hangarShipId: 'ship-1', name: 'Stock', isActive: true, loadout: [] }, adopted];
    const hangar = {
      peekSharedLoadout: jasmine.createSpy('peek'),
      listConfigs: jasmine.createSpy('listConfigs').and.resolveTo(configs),
      listAllConfigs: jasmine.createSpy('listAllConfigs').and.resolveTo(configs),
    };
    const fixture = await setup({ view: 'holo', config: 'cfg-adopted' }, hangar);
    const c = fixture.componentInstance;
    const nav = TestBed.inject(Router).navigate as jasmine.Spy;
    expect(nav).toHaveBeenCalledWith([], jasmine.objectContaining({
      queryParams: { config: null, v: 'cfg-adopted' },
      replaceUrl: true,
    }));
    expect(c.personalMode()).toBeTrue();
    expect(c.activeVariantId()).toBe('cfg-adopted');
    expect(c.draftReadOnly()).toBeFalse();
    expect(c.activeHangarConfig()?.id).toBe('cfg-adopted');
    expect(c.draftChangedCount()).toBe(1);
    expect(c.sharedDraft()).toBeNull();
    expect(hangar.peekSharedLoadout).not.toHaveBeenCalled();
    // Personal mode: the parent crumb leads to HQ, the switch names the variant.
    expect(c.crumbs()).toEqual([jasmine.objectContaining({ labelKey: 'codex.personal.hqCrumb', link: '/hq/hangar' })]);
    expect(c.showModeSwitch()).toBeTrue();
  });

  it('?v= of the reader puts that variant on the table and keeps v in the URL', async () => {
    authUser = { id: 'u1' };
    const mine = { id: 'cfg-mine', hangarShipId: 'ship-1', name: 'Brawler', isActive: true,
      loadout: [{ portName: GUN_PORT, className: SHARED_GUN, kind: 'weapon' }] };
    const fixture = await setup({ view: 'holo', v: 'cfg-mine' }, {
      listAllConfigs: jasmine.createSpy('listAllConfigs').and.resolveTo([mine]),
    });
    const c = fixture.componentInstance;
    expect(c.personalMode()).toBeTrue();
    expect(c.activeHangarConfig()?.id).toBe('cfg-mine');
    expect(c.foreignVariant()).toBeFalse();
    const nav = TestBed.inject(Router).navigate as jasmine.Spy;
    expect(nav.calls.allArgs().some(([, extras]) => (extras as { queryParams?: Record<string, unknown> })?.queryParams?.['v'] === null))
      .withContext('v stays').toBeFalse();
  });

  it('a foreign ?v= falls back to codex mode, drops v and says how variants are shared', async () => {
    authUser = { id: 'u1' };
    const fixture = await setup({ view: 'holo', v: 'cfg-someone-else' }, {
      listAllConfigs: jasmine.createSpy('listAllConfigs').and.resolveTo([]),
    });
    const c = fixture.componentInstance;
    expect(c.personalMode()).toBeFalse();
    expect(c.foreignVariant()).toBeTrue();
    expect(c.activeHangarConfig()).toBeNull();
    const nav = TestBed.inject(Router).navigate as jasmine.Spy;
    expect(nav).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { v: null }, replaceUrl: true }));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.foreign-note')?.textContent).toContain('codex.personal.foreignVariant');
  });
});
