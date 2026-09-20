// Wave 2 (item A) — the view toggle's persistence contract, kept in a
// SEPARATE file from codex-detail.component.spec.ts on purpose: that file
// "must stay green untouched" (no edits), so this one owns the new
// assertions instead, reusing the same Nomad fixture/stub shape.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { CodexDetailComponent } from './codex-detail.component';
import { CodexService, ResolvedEntity } from './codex.service';
import { HangarService } from '../hangar/hangar.service';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';
import { UexShopService } from './uex-shop.service';
import { UpcomingShipsService } from './upcoming-ships.service';
import { ShipLinkService } from './ship-link.service';
import { ShipSkinsService } from './ship-skins.service';
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

async function setup(queryParams: Record<string, string> = {}): Promise<ComponentFixture<CodexDetailComponent>> {
  await TestBed.configureTestingModule({
    imports: [CodexDetailComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      { provide: CodexService, useValue: makeCodexServiceStub() },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({ kind: 'ship', className: 'cnou_nomad' })),
          snapshot: {
            paramMap: convertToParamMap({ kind: 'ship', className: 'cnou_nomad' }),
            queryParamMap: convertToParamMap(queryParams),
          },
        },
      },
      {
        provide: HangarService,
        useValue: {
          ships: signal([]),
          loadAll: async () => undefined,
          addShip: async () => null,
          shipByClassName: () => null,
        } as Partial<HangarService>,
      },
      { provide: AuthService, useValue: { user: signal(null) } as Partial<AuthService> },
      { provide: RoleService, useValue: {} as Partial<RoleService> },
      {
        provide: ShipSkinsService,
        useValue: { listSkins: async () => ({ skins: [], error: false }), assetUrl: (p: string | null) => p } as Partial<ShipSkinsService>,
      },
      { provide: UexShopService, useValue: { whereToBuy: async () => [] } as Partial<UexShopService> },
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
  const fixture: ComponentFixture<CodexDetailComponent> = TestBed.createComponent(CodexDetailComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('CodexDetailComponent — Holotable view toggle (Wave 2, item A)', () => {
  const STORAGE_KEY = 'sc.codex.holoView';

  beforeEach(() => localStorage.removeItem(STORAGE_KEY));
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it('defaults to the classic view and switching persists to localStorage', async () => {
    const fixture = await setup();
    const component = fixture.componentInstance;
    expect(component.holoView()).toBe(false);

    component.toggleHoloView();
    fixture.detectChanges();

    expect(component.holoView()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('holo');
  });

  it('a stored classic preference is overridden by `?view=holo` in the URL', async () => {
    localStorage.setItem(STORAGE_KEY, 'classic');
    const fixture = await setup({ view: 'holo' });
    expect(fixture.componentInstance.holoView()).toBe(true);
  });

  it('a stored holo preference is overridden by `?view=classic` in the URL', async () => {
    localStorage.setItem(STORAGE_KEY, 'holo');
    const fixture = await setup({ view: 'classic' });
    expect(fixture.componentInstance.holoView()).toBe(false);
  });

  it('renders the sc-codex-holo-stage element instead of the classic masthead when holoView is true', async () => {
    const fixture = await setup({ view: 'holo' });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-codex-holo-stage')).toBeTruthy();
    expect(el.querySelector('.m-top')).toBeFalsy();
  });
});
