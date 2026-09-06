import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideRouter } from '@angular/router';
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
import { ShipSkin, ShipSkinsService } from './ship-skins.service';
import { RankShipInput } from './codex-rank';
import {
  NOMAD_POWER_FIXTURE,
  NOMAD_SHIP_STATS,
  fixtureOccupant,
  type OccupantFixture,
} from './testing/nomad-power.fixture';
import type { ShipPayload, LoadoutEntry } from './codex.types';
import type { CodexKind } from './codex.service';

// Port names driving `classifyShipModule`'s pattern rules (ship-module-sections.ts).
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
  hull: NOMAD_SHIP_STATS['hull'] as { hp: number | null; mass: number | null },
  armorHp: 0,
  cargoScu: 24,
  career: '@vehicle_focus_Light_Freight',
  stats: NOMAD_SHIP_STATS as never,
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
    getDetail: async (kind) =>
      kind === 'ship'
        ? { classNameSlug: 'cnou_nomad', kind: 'ship', row: { role: null }, payload: NOMAD_PAYLOAD, ports: [], strings: [] }
        : {
            classNameSlug: 'klwe_laserrepeater_s3',
            kind: 'weapon',
            row: {},
            payload: entityPayloads.get('KLWE_LaserRepeater_S3_SCItem')?.payload ?? {},
            ports: [],
            strings: [],
          },
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
  };
}

/** One livery with a real glb — enough for the hero to offer its 3D switch. */
const NOMAD_SKIN: ShipSkin = {
  shipId: 'CNOU_Nomad',
  skinId: 'default',
  name: 'Standard',
  description: '',
  source: 'factory',
  nameVerified: true,
  modelPath: 'cnou_nomad/default.glb',
  iconPath: null,
  modelBytes: 1,
  sort: 1,
};

async function setup(kind: 'ship' | 'weapon', skins: ShipSkin[] = []) {
  const className = kind === 'ship' ? 'cnou_nomad' : 'klwe_laserrepeater_s3';
  await TestBed.configureTestingModule({
    imports: [CodexDetailComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      { provide: CodexService, useValue: makeCodexServiceStub() },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({ kind, className })),
          snapshot: {
            paramMap: convertToParamMap({ kind, className }),
            queryParamMap: convertToParamMap({}),
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
        useValue: {
          listSkins: async () => ({ skins, error: false }),
          assetUrl: (path: string | null) => path,
        } as Partial<ShipSkinsService>,
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

describe('CodexDetailComponent — ship kind (Nomad fixture)', () => {
  let fixture: ComponentFixture<CodexDetailComponent>;

  beforeEach(async () => {
    fixture = await setup('ship');
  });

  it('renders the masthead and Einordnung rank card', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.m-top')).toBeTruthy();
    expect(el.querySelector('sc-codex-rank-card')).toBeTruthy();
  });

  it('renders the six-cell KPI band', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-codex-kpi-band')).toBeTruthy();
  });

  it('renders both column heads (Loadout / Analyse)', () => {
    const el: HTMLElement = fixture.nativeElement;
    const heads = el.querySelectorAll('.col-head');
    expect(heads.length).toBe(2);
  });

  it('renders the mission/draft bar', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.mission-draft-bar')).toBeTruthy();
    expect(el.querySelector('sc-codex-mission-bar')).toBeTruthy();
  });

  it('renders the hardpoint layout, energy dock, swap picker and weapon detail window', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-codex-hardpoint-layout')).toBeTruthy();
    expect(el.querySelector('sc-codex-energy-dock')).toBeTruthy();
    expect(el.querySelector('sc-codex-swap-picker')).toBeTruthy();
    expect(el.querySelector('sc-codex-weapon-detail')).toBeTruthy();
  });

  it('the Loadout head counts BLOCKS, the way a reader counts headings', () => {
    const el: HTMLElement = fixture.nativeElement;
    const sections = fixture.componentInstance.moduleSections().filter((s) => s.slots.length > 0);
    const blocks = fixture.componentInstance.moduleCount();
    // The Nomad fixture has more sections than blocks — that is the whole point.
    expect(blocks).toBeLessThan(sections.length);
    const rendered = el.querySelectorAll('sc-codex-hardpoint-layout .mod-sec').length;
    expect(rendered).toBe(blocks);
    expect(el.querySelector('.col-loadout .col-head .n')?.textContent?.trim()).toBe(String(blocks));
  });

  // ── decision 1: the BÜHNE and the tool row under it ──────────────────────

  it('draws the hero as a stage with the name on it and the tool row beneath', () => {
    const el: HTMLElement = fixture.nativeElement;
    const hero = el.querySelector('.hero') as HTMLElement;
    expect(hero.classList).toContain('stage');
    expect(hero.querySelector('.stage-fg h1')).toBeTruthy();
    expect(hero.querySelector('.acts')).toBeTruthy();
    // The fact tiles left the hero (they live in the Analyse card now).
    expect(hero.querySelector('.facts')).toBeNull();
    // …and the rarer things sit in the flat row below the card.
    const toolrow = el.querySelector('.toolrow') as HTMLElement;
    expect(toolrow).toBeTruthy();
    expect(toolrow.querySelector('.loadout-summary')).toBeTruthy();
    expect(toolrow.querySelector('.rsi-link')).toBeTruthy();
  });

  it('"Schiff wechseln" navigates, so it is an anchor and not a button', () => {
    const el: HTMLElement = fixture.nativeElement;
    const acts = el.querySelector('.hero .acts') as HTMLElement;
    const anchor = acts.querySelector('a[href]') as HTMLAnchorElement;
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute('href')).toContain('/codex');
  });

  // ── decision 1 (hard constraint): the two tank figures survived the move ──

  it('carries quantum fuel and hydrogen into the Analyse card', () => {
    const groups = fixture.componentInstance.shipFactGroups();
    const systems = groups.find((g) => g.titleKey === 'codex.analysis.ship.systems');
    const labels = systems?.rows.map((r) => r.labelKey) ?? [];
    expect(labels).toContain('codex.detail.quantumFuel');
    expect(labels).toContain('codex.detail.fuelCapacity');
  });

  // ── decision 3: the "Rumpf & Flug" block, and the two-masses bug with it ──

  it('no longer renders the Rumpf & Flug block', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.hull-grid')).toBeNull();
    expect(el.textContent).not.toContain('codex.hull.title');
  });

  it('has exactly one source for the equipped mass', () => {
    const el: HTMLElement = fixture.nativeElement;
    const massRows = Array.from(el.querySelectorAll('dt')).filter((dt) =>
      dt.textContent?.includes('codex.hull.equippedMass'),
    );
    expect(massRows.length).toBe(1);
  });

  it('keeps the "no flight data at all" sentence the deleted block owned', () => {
    const groups = fixture.componentInstance.shipFactGroups();
    const flight = groups.find((g) => g.titleKey === 'codex.analysis.ship.flightPerformance');
    // The Nomad fixture HAS flight data, so the note must stay silent here.
    expect(flight?.note).toBeNull();
    expect(flight?.rows.length).toBe(6);
  });

  // ── decision 4: the 2D/3D switch on the hero card ────────────────────────

  it('offers no view switch while the ship has no 3D model', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(fixture.componentInstance.has3dView()).toBeFalse();
    expect(el.querySelector('.view-switch')).toBeNull();
  });
});

describe('CodexDetailComponent — hero 2D/3D switch (ship with a livery)', () => {
  let fixture: ComponentFixture<CodexDetailComponent>;

  beforeEach(async () => {
    fixture = await setup('ship', [NOMAD_SKIN]);
  });

  it('swaps the stage art for the 3D view and back', async () => {
    const el: HTMLElement = fixture.nativeElement;
    const switchEl = () => el.querySelector('.view-switch') as HTMLButtonElement;

    // The skin catalog resolves in a floating promise inside the viewer, so
    // give it one more turn than the shared setup does.
    await fixture.whenStable();
    fixture.detectChanges();

    // The catalog answered "there is a model", so the card offers the switch.
    expect(fixture.componentInstance.has3dView()).toBeTrue();
    const btn = switchEl();
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    // Reachable by keyboard with a name that says what pressing it does.
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('codex.detail.heroSwitchTo3d');
    expect(btn.textContent?.trim()).toBe('codex.detail.heroView3d');
    // 2D: the picture is on the stage, the livery section owns the model.
    expect(el.querySelector('.stage-art sc-fallback-image')).toBeTruthy();
    expect(el.querySelector('.stage-art sc-ship-skin-viewer')).toBeNull();

    btn.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.heroView3d()).toBeTrue();
    expect(switchEl().getAttribute('aria-pressed')).toBe('true');
    expect(switchEl().getAttribute('aria-label')).toBe('codex.detail.heroSwitchTo2d');
    expect(switchEl().textContent?.trim()).toBe('codex.detail.heroView2d');
    // The model is on the stage now — and only there, never twice.
    expect(el.querySelector('.stage-art sc-ship-skin-viewer')).toBeTruthy();
    expect(el.querySelectorAll('sc-ship-skin-viewer').length).toBe(1);

    switchEl().click();
    fixture.detectChanges();
    expect(fixture.componentInstance.heroView3d()).toBeFalse();
    expect(el.querySelector('.stage-art sc-fallback-image')).toBeTruthy();
    expect(el.querySelector('.stage-art sc-ship-skin-viewer')).toBeNull();
  });
});

describe('CodexDetailComponent — weapon kind (legacy regions)', () => {
  let fixture: ComponentFixture<CodexDetailComponent>;

  beforeEach(async () => {
    fixture = await setup('weapon');
  });

  it('does not render the ship-only masthead/mission-bar regions', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-codex-rank-card')).toBeNull();
    expect(el.querySelector('.mission-draft-bar')).toBeNull();
  });

  it('renders the legacy detail block', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.detail-page')).toBeTruthy();
  });
});
