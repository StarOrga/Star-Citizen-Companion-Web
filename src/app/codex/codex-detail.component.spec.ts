import { provideNoShipBlueprints } from './ship-blueprint/ship-blueprint.testing';
import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CodexHoloStageComponent } from './holo/codex-holo-stage.component';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { CodexDetailComponent } from './codex-detail.component';
import { BlueprintDetail, CodexService, ResolvedEntity } from './codex.service';
import { HangarService } from '../hangar/hangar.service';
import { AuthService } from '../auth/auth.service';
import { AccountPrefsService } from '../core/account-prefs.service';
import { RoleService } from '../auth/role.service';
import { UexShopService } from './uex-shop.service';
import { UpcomingShipsService } from './upcoming-ships.service';
import { ShipLinkService } from './ship-link.service';
import { ShipSkin, ShipSkinsService } from './ship-skins.service';
import { AssetPackageService } from './asset-package/asset-package.service';
import { RankShipInput } from './codex-rank';
import {
  NOMAD_POWER_FIXTURE,
  NOMAD_SHIP_STATS,
  fixtureOccupant,
  type OccupantFixture,
} from './testing/nomad-power.fixture';
import type { ShipPayload, LoadoutEntry, CodexItemPort } from './codex.types';
import type { CodexKind, CodexListRow } from './codex.service';
import { CodexHoloForkGuard } from './holo/codex-holo-fork-guard';
import { LOCAL_DRAFT_STORAGE_KEY } from './codex-loadout-draft';
import type { SwapPick, SwapTarget } from './codex-swap-picker.component';

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

function makeCodexServiceStub(payload: ShipPayload = NOMAD_PAYLOAD): Partial<CodexService> {
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
        ? { classNameSlug: 'cnou_nomad', kind: 'ship', row: { role: null }, payload, ports: [], strings: [] }
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

async function setup(
  kind: 'ship' | 'weapon',
  skins: ShipSkin[] = [],
  payload: ShipPayload = NOMAD_PAYLOAD,
  svc: Partial<CodexService> = {},
) {
  const className = kind === 'ship' ? 'cnou_nomad' : 'klwe_laserrepeater_s3';
  await TestBed.configureTestingModule({
    imports: [CodexDetailComponent],
    providers: [
      provideNoShipBlueprints(),
      provideRouter([]),
      provideTranslateService({}),
      { provide: CodexService, useValue: { ...makeCodexServiceStub(payload), ...svc } },
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
          recentShips: signal([]),
          markShipPicked: () => undefined,
        } as Partial<HangarService>,
      },
      { provide: AuthService, useValue: { user: signal(null) } as Partial<AuthService> },
      { provide: AccountPrefsService, useValue: { prefs: signal(null), set: () => undefined } as unknown as Partial<AccountPrefsService> },
      { provide: RoleService, useValue: {} as Partial<RoleService> },
      {
        provide: ShipSkinsService,
        useValue: {
          listSkins: async () => ({ skins, error: false }),
          assetUrl: (path: string | null) => path,
        } as Partial<ShipSkinsService>,
      },
      { provide: UexShopService, useValue: { whereToBuy: async () => [] } as Partial<UexShopService> },
      // No 3D package lookups against the real Supabase from a spec.
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


  it('states the role once — in the eyebrow beside the maker, not also as a chip', () => {
    const el: HTMLElement = fixture.nativeElement;
    const eyebrow = el.querySelector('.hero.stage .mfr')?.textContent?.trim() ?? '';
    const chips = Array.from(el.querySelectorAll('.hero.stage .hchip')).map((c) =>
      c.textContent?.trim(),
    );
    // Whatever role the fixture carries, it belongs to the eyebrow line.
    if (eyebrow.includes(' · ')) {
      const role = eyebrow.split(' · ').slice(1).join(' · ');
      expect(role.length).toBeGreaterThan(0);
      expect(chips).not.toContain(role);
    }
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

  it('keeps the "no flight data at all" sentence the deleted block owned', () => {
    const groups = fixture.componentInstance.shipFactGroups();
    const flight = groups.find((g) => g.titleKey === 'codex.analysis.ship.flightPerformance');
    // The Nomad fixture HAS flight data, so the note must stay silent here.
    expect(flight?.note).toBeNull();
    expect(flight?.rows.length).toBe(6);
  });

  // ── the concept's page skeleton ──────────────────────────────────────────
  // #t1 draws crumbrow > m-top > m-kpis > m-mission > m-cols, and #f1/#h1
  // close m-wrap with the dock. Nothing may wedge between the masthead and
  // the KPI strip: the strip is the sticky one, and every block placed above
  // it pushes the page's only live feedback channel further down. Anything
  // this app adds beyond the concept goes BELOW m-cols.
});

// ── feedback 140dfb7e: the census must agree with the loadout column ───────

/**
 * The Nomad as the admin sees it: three gun mounts plus a tractor beam that
 * the generic port classifier used to count as a fourth "weapon", and two
 * MSD-442 racks carrying four missiles each.
 */
const NOMAD_ARMED_PAYLOAD: ShipPayload = {
  ...NOMAD_PAYLOAD,
  defaultLoadout: [
    ...(NOMAD_PAYLOAD.defaultLoadout ?? []),
    { itemPortName: 'hardpoint_weapon_top_right', entityClassName: 'KLWE_LaserRepeater_S3_SCItem' },
    { itemPortName: 'hardpoint_weapon_bottom', entityClassName: 'KLWE_LaserRepeater_S3_SCItem' },
    { itemPortName: 'hardpoint_tractor_beam', entityClassName: 'CNOU_Nomad_TractorBeam' },
    ...(['left', 'right'] as const).map((side) => ({
      itemPortName: `hardpoint_missile_rack_${side}`,
      entityClassName: 'MSD_442_SCItem',
      entries: [1, 2, 3, 4].map((n) => ({
        itemPortName: `missile_slot_${n}`,
        entityClassName: 'MSD_442_Missile_SCItem',
      })),
    })),
  ],
};

describe('CodexDetailComponent — stage census (feedback 140dfb7e)', () => {
  let fixture: ComponentFixture<CodexDetailComponent>;

  beforeEach(async () => {
    fixture = await setup('ship', [], NOMAD_ARMED_PAYLOAD);
  });

  it('counts three weapon slots, not four: the tractor beam is airframe', () => {
    const chips = fixture.componentInstance.stageCounts();
    const weapons = chips.find((c) => c.group === 'weapons');
    expect(weapons?.count).toBe(3);
    // …which is exactly what the armament block says.
    const block = fixture.componentInstance.moduleSections().find((s) => s.section === 'weapons');
    expect(block?.slots.length).toBe(3);
  });

  it('counts the missiles the racks carry and names the rack count as detail', () => {
    const missiles = fixture.componentInstance.stageCounts().find((c) => c.group === 'missiles');
    expect(missiles?.count).toBe(8);
    expect(missiles?.labelKey).toBe('codex.moduleSection.missiles');
    expect(missiles?.detailKey).toBe('codex.detail.stageLaunchers');
    expect(missiles?.detailCount).toBe(2);
    expect(holoStage(fixture).stageCounts()).toEqual(fixture.componentInstance.stageCounts());
  });

});

describe('CodexDetailComponent — stage census, racks without a nested fit', () => {
  it('falls back to the rack count when the extract names no missile', async () => {
    // Same hull, racks without nested entries: "unknown", never "empty".
    const racksOnly: ShipPayload = {
      ...NOMAD_ARMED_PAYLOAD,
      defaultLoadout: (NOMAD_ARMED_PAYLOAD.defaultLoadout ?? []).map((e) =>
        e.itemPortName?.startsWith('hardpoint_missile_rack') ? { ...e, entries: undefined } : e,
      ),
    };
    const fx = await setup('ship', [], racksOnly);
    const missiles = fx.componentInstance.stageCounts().find((c) => c.group === 'missiles');
    expect(missiles?.count).toBe(2);
    expect(missiles?.labelKey).toBe('codex.detail.stageMissileRacks');
    expect(missiles?.detailKey).toBeNull();
  });
});

// ── feedback #235: "Raketen auch zusammenfassend machen … wie bei der
// Bewaffnung" — two racks that CIG names with distinct per-side class names
// (`_Left` / `_Right`, verbatim from the 4.9.0 Nomad extract) must still
// collapse into one grouped row, the way two identical gimbal mounts do.
const NOMAD_SIDED_RACKS_PAYLOAD: ShipPayload = {
  ...NOMAD_PAYLOAD,
  defaultLoadout: [
    ...(NOMAD_PAYLOAD.defaultLoadout ?? []),
    ...(['Left', 'Right'] as const).map((side) => ({
      itemPortName: `hardpoint_missile_rack_${side.toLowerCase()}`,
      entityClassName: `MRCK_S04_CNOU_Quad_S02_${side}`,
    })),
  ],
};

describe('CodexDetailComponent — missile rack grouping (feedback #235)', () => {
  it('groups two racks with per-side class names into one row, like the weapons', async () => {
    const fixture = await setup('ship', [], NOMAD_SIDED_RACKS_PAYLOAD);
    const missiles = fixture.componentInstance
      .moduleSections()
      .find((s) => s.section === 'missiles');
    // Two hardpoints, but ONE group key — the row-collapsing the layout
    // component runs on `groupKey` therefore folds them into a single row.
    expect(missiles?.slots.length).toBe(2);
    const keys = new Set(missiles?.slots.map((s) => s.groupKey));
    expect(keys.size).toBe(1);
    const el: HTMLElement = fixture.nativeElement;
    const rows = el.querySelectorAll('sc-codex-hardpoint-layout .mod-sec[data-sec="missiles"] li.slot');
    expect(rows.length).toBe(1);
  });

  it('still keeps two DIFFERENT racks apart', async () => {
    const mixed: ShipPayload = {
      ...NOMAD_SIDED_RACKS_PAYLOAD,
      defaultLoadout: (NOMAD_SIDED_RACKS_PAYLOAD.defaultLoadout ?? []).map((e) =>
        e.itemPortName === 'hardpoint_missile_rack_right'
          ? { ...e, entityClassName: 'MRCK_S02_Different_Rack' }
          : e,
      ),
    };
    const fixture = await setup('ship', [], mixed);
    const missiles = fixture.componentInstance
      .moduleSections()
      .find((s) => s.section === 'missiles');
    const keys = new Set(missiles?.slots.map((s) => s.groupKey));
    expect(keys.size).toBe(2);
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

describe('CodexDetailComponent — armour hero icon (part glyph)', () => {
  it("passes the item's attach type to the hero icon (part glyph, not the generic item box)", async () => {
    const fixture = await setup('weapon', [], NOMAD_PAYLOAD, {
      getDetail: async () => ({
        classNameSlug: 'rsi_legs_01',
        kind: 'item',
        row: { attach_type: 'Char_Armor_Legs' },
        payload: {},
        ports: [],
        strings: [],
      }),
    });
    const el: HTMLElement = fixture.nativeElement;
    const icon = el.querySelector('.hero-icon path')!;
    // armorLegs' glyph path (codex-category-icon.component.ts) — distinct from
    // the generic 'item' box, which is what a missing attachType binding renders.
    expect(icon.getAttribute('d')).toContain('M7.5 3.5 H16.5');
  });
});

describe('CodexDetailComponent — crafting recipe (#187)', () => {
  const BP = 'BP_CRAFT_KLWE_LaserRepeater_S3';
  const ingredient = (ingredientIndex: number, ingredientClassName: string, quantity: number) => ({
    blueprintClassName: BP,
    ingredientIndex,
    ingredientClassName,
    quantity,
    minQuality: 0,
    role: 'FRAME',
    nameLocalized: null,
    entityKind: null,
  });
  // SCU amounts as codex_blueprint_ingredients stores them: 32-bit floats.
  const RECIPE: BlueprintDetail = {
    classNameSlug: BP,
    row: { class_name: BP, craft_time_seconds: 90 },
    ingredients: [
      ingredient(0, 'Aluminum', 0.20000000298023224),
      ingredient(1, 'Gold', 0.014999999664723873),
      ingredient(2, 'Iron', 15),
    ],
  };

  it('prints each material amount in SCU without the float noise', async () => {
    const fixture = await setup('weapon', [], NOMAD_PAYLOAD, { getCraftingRecipe: async () => RECIPE });
    const el: HTMLElement = fixture.nativeElement;
    const section = Array.from(el.querySelectorAll('section')).find((s) =>
      s.querySelector('h2')?.textContent?.includes('codex.detail.craftedFrom'),
    );
    expect(section).withContext('recipe section').toBeTruthy();
    const amounts = Array.from(section!.querySelectorAll('.compat-meta .chip:not(.subtle)')).map((c) =>
      c.textContent!.trim(),
    );
    expect(amounts).toEqual(['0.2 SCU', '0.015 SCU', '15 SCU']);
  });

  it('names CIG slots in words and shows only a real quality floor, on the 0–1000 scale — as the blueprint page does', async () => {
    const recipe: BlueprintDetail = {
      ...RECIPE,
      ingredients: [
        { ...ingredient(0, 'Titanium', 2), role: 'SUBSTRATE', minQuality: 900 },
        { ...ingredient(1, 'Agricium', 0.36000001430511475), role: 'BARREL:', minQuality: 1 },
        { ...ingredient(2, 'Iron', 0.2), role: 'PROTECTIVE SHEATHING', minQuality: 0 },
      ],
    };
    const fixture = await setup('weapon', [], NOMAD_PAYLOAD, { getCraftingRecipe: async () => recipe });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { codex: { detail: { minQuality: 'min. quality {{value}}' } } });
    translate.use('en');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const section = Array.from(el.querySelectorAll('section')).find((s) =>
      s.querySelector('h2')?.textContent?.includes('codex.detail.craftedFrom'),
    );
    expect(section).withContext('recipe section').toBeTruthy();
    const chips = Array.from(section!.querySelectorAll('.compat-list li')).map((li) =>
      Array.from(li.querySelectorAll('.chip')).map((c) => c.textContent!.trim()),
    );
    expect(chips).toEqual([
      ['Substrate', '2 SCU', 'min. quality 900 / 1,000'],
      ['Barrel', '0.36 SCU'],
      ['Protective Sheathing', '0.2 SCU'],
    ]);
  });
});

describe('CodexDetailComponent — stale follow-up answers', () => {
  it('keeps a late recipe of an earlier load off the page', async () => {
    // A quick livery switch re-enters load(); the first load's recipe read
    // answering last used to paint the previous entity's recipe.
    let releaseFirst!: (bp: BlueprintDetail | null) => void;
    let calls = 0;
    const getCraftingRecipe: CodexService['getCraftingRecipe'] = () => {
      calls++;
      if (calls === 1) return new Promise<BlueprintDetail | null>((r) => (releaseFirst = r));
      return Promise.resolve({ classNameSlug: 'BP_NEW', row: {}, ingredients: [] } as unknown as BlueprintDetail);
    };
    const fixture = await setup('weapon', [], NOMAD_PAYLOAD, { getCraftingRecipe });
    const cmp = fixture.componentInstance;

    cmp.retryLoad();
    await fixture.whenStable();
    expect(cmp.recipe()?.classNameSlug).toBe('BP_NEW');

    releaseFirst({ classNameSlug: 'BP_OLD', row: {}, ingredients: [] } as unknown as BlueprintDetail);
    await fixture.whenStable();
    expect(cmp.recipe()?.classNameSlug).toBe('BP_NEW');
  });
});

describe('CodexDetailComponent — failed load (non-ship archive pages)', () => {
  it('offers a retry on the error card, and the retry loads the entry', async () => {
    let calls = 0;
    const stub = makeCodexServiceStub(NOMAD_PAYLOAD);
    const getDetail: CodexService['getDetail'] = async (kind, className) => {
      calls++;
      if (calls === 1) throw new Error('network down');
      return stub.getDetail!(kind, className);
    };
    const fixture = await setup('weapon', [], NOMAD_PAYLOAD, { getDetail });
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.err')?.textContent).toContain('errors.generic');
    expect(el.querySelector('.err')?.textContent).not.toContain('network down');
    (el.querySelector('.err .retry') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(calls).toBe(2);
    expect(el.querySelector('.err')).toBeNull();
    expect(fixture.componentInstance.detail()?.classNameSlug).toBe('klwe_laserrepeater_s3');
  });
});

// ── D16 Schritt 6 (AUD-062): characterisation of codex-detail ────────────────
// These cases pin the page's CURRENT rendered behaviour through the DOM and
// the public methods only, so D17 (splitting codex-detail.component.ts) can
// prove the split changed nothing. Do not reach for private members here.

const WEAPON_PORT: CodexItemPort = {
  parentClassName: 'KLWE_LaserRepeater_S3_SCItem',
  parentKind: 'weapon',
  portName: 'magazine_attach',
  minSize: 1,
  maxSize: 2,
  types: ['WeaponAttachment'],
  flags: [],
  portIndex: 0,
  helperName: null,
  position: null,
  rotation: null,
};

/** The Nomad's first weapon hardpoint as a codex port, so a draft on it is saveable. */
const NOMAD_GUN_PORT: CodexItemPort = {
  ...WEAPON_PORT,
  parentClassName: 'CNOU_Nomad',
  parentKind: 'ship',
  portName: 'hardpoint_weapon_top_left',
  minSize: 3,
  maxSize: 3,
  types: ['WeaponGun'],
};

function skinRow(classNameSlug: string, nameLocalized: string): CodexListRow {
  return {
    classNameSlug,
    nameLocalized,
    manufacturerCode: null,
    size: null,
    grade: null,
    role: null,
    crewSize: null,
    weaponClass: null,
    componentKind: null,
    subType: null,
    attachType: null,
    speed: null,
    isVariant: false,
    payload: null,
    blueprintCategory: null,
    blueprintTier: null,
    craftTimeSec: null,
  };
}

interface CharacterisationOpts {
  params: { kind: string; className: string };
  svc?: Partial<CodexService>;
  hangar?: Partial<HangarService>;
  user?: { id: string } | null;
  shipLinks?: Partial<ShipLinkService>;
  forkGuard?: Partial<CodexHoloForkGuard>;
}

async function setupCharacterisation(opts: CharacterisationOpts): Promise<ComponentFixture<CodexDetailComponent>> {
  const params = convertToParamMap(opts.params);
  await TestBed.configureTestingModule({
    imports: [CodexDetailComponent],
    providers: [
      provideNoShipBlueprints(),
      provideRouter([]),
      provideTranslateService({}),
      { provide: CodexService, useValue: { ...makeCodexServiceStub(NOMAD_PAYLOAD), ...opts.svc } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(params),
          snapshot: { paramMap: params, queryParamMap: convertToParamMap({}) },
        },
      },
      {
        provide: HangarService,
        useValue: {
          ships: signal([]),
          loadAll: async () => undefined,
          addShip: async () => null,
          shipByClassName: () => null,
          recentShips: signal([]),
          markShipPicked: () => undefined,
          ...opts.hangar,
        } as Partial<HangarService>,
      },
      { provide: AuthService, useValue: { user: signal(opts.user ?? null) } as unknown as Partial<AuthService> },
      { provide: AccountPrefsService, useValue: { prefs: signal(null), set: () => undefined } as unknown as Partial<AccountPrefsService> },
      {
        provide: RoleService,
        useValue: { isAdmin: signal(false), isCollaborator: signal(false) } as unknown as Partial<RoleService>,
      },
      {
        provide: ShipSkinsService,
        useValue: {
          listSkins: async () => ({ skins: [], error: false }),
          assetUrl: (path: string | null) => path,
        } as Partial<ShipSkinsService>,
      },
      { provide: UexShopService, useValue: { whereToBuy: async () => [] } as Partial<UexShopService> },
      // No 3D package lookups against the real Supabase from a spec.
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
          saving: signal(false),
          loadForShip: async () => undefined,
          ...opts.shipLinks,
        } as unknown as Partial<ShipLinkService>,
      },
      ...(opts.forkGuard ? [{ provide: CodexHoloForkGuard, useValue: opts.forkGuard }] : []),
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(CodexDetailComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

/** The weapon stub's detail, with one expandable port. */
function weaponDetailWithPort(): CodexService['getDetail'] {
  const base = makeCodexServiceStub(NOMAD_PAYLOAD).getDetail!;
  return async (kind, className) => {
    const d = await base(kind, className);
    return d ? { ...d, ports: [WEAPON_PORT] } : d;
  };
}

/** The ship stub's detail, with the first weapon hardpoint as a joinable port. */
function shipDetailWithGunPort(): CodexService['getDetail'] {
  const base = makeCodexServiceStub(NOMAD_PAYLOAD).getDetail!;
  return async (kind, className) => {
    const d = await base(kind, className);
    return d ? { ...d, ports: [NOMAD_GUN_PORT] } : d;
  };
}

describe('CodexDetailComponent — characterisation (D16 step 6, safety net for D17)', () => {
  afterEach(() => {
    // A draft on the ship mirrors itself into localStorage; never leak it into the next case.
    localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
  });

  describe('invalid route', () => {
    it('names an unknown category on the error card and offers no retry', async () => {
      const getDetail = jasmine.createSpy('getDetail');
      const fixture = await setupCharacterisation({
        params: { kind: 'foo', className: 'x' },
        svc: { getDetail },
      });
      const el: HTMLElement = fixture.nativeElement;
      const err = el.querySelector('.err');
      expect(err).withContext('error card rendered').not.toBeNull();
      expect(err!.getAttribute('role')).toBe('alert');
      expect(err!.textContent).toContain('codex.detail.invalidRoute');
      expect(el.querySelector('.err .retry')).toBeNull();
      expect(getDetail).not.toHaveBeenCalled();
      expect(fixture.componentInstance.canRetry()).toBeFalse();
    });
  });

  describe('hardpoint compatibility (port fold-out)', () => {
    it('loads the compatible items once on the first open and serves re-opens from the cache', async () => {
      const getCompatibleItems = jasmine.createSpy('getCompatibleItems').and.resolveTo([
        {
          kind: 'item',
          classNameSlug: 'mag_s1',
          nameLocalized: 'Magazine S1',
          manufacturerCode: 'KLWE',
          size: 1,
          grade: null,
        },
      ]);
      const fixture = await setupCharacterisation({
        params: { kind: 'weapon', className: 'klwe_laserrepeater_s3' },
        svc: { getDetail: weaponDetailWithPort(), getCompatibleItems },
      });
      const el: HTMLElement = fixture.nativeElement;
      const head = el.querySelector('.hp-head') as HTMLButtonElement;
      expect(head).withContext('expandable port rendered').not.toBeNull();
      expect(head.disabled).toBeFalse();
      expect(el.querySelector('.compat')).toBeNull();

      head.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(getCompatibleItems).toHaveBeenCalledTimes(1);
      expect(getCompatibleItems).toHaveBeenCalledWith({ types: ['WeaponAttachment'], minSize: 1, maxSize: 2 });
      expect(el.querySelector('.hp')!.classList).toContain('open');
      const link = el.querySelector('.compat a.compat-link') as HTMLAnchorElement;
      expect(link).withContext('compatible item is an anchor').not.toBeNull();
      expect(link.getAttribute('href')).toBe('/codex/item/mag_s1');
      expect(el.querySelector('.compat-head')?.textContent).toContain('codex.detail.compatCount');

      // Close, then open again: the answer is cached, no second read.
      head.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector('.compat')).toBeNull();
      head.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector('.compat')).not.toBeNull();
      expect(getCompatibleItems).toHaveBeenCalledTimes(1);
    });

    it('shows an error key inline when the compatible-items read fails', async () => {
      const getCompatibleItems = jasmine.createSpy('getCompatibleItems').and.rejectWith(new Error('boom'));
      const fixture = await setupCharacterisation({
        params: { kind: 'weapon', className: 'klwe_laserrepeater_s3' },
        svc: { getDetail: weaponDetailWithPort(), getCompatibleItems },
      });
      const el: HTMLElement = fixture.nativeElement;
      (el.querySelector('.hp-head') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();
      const err = el.querySelector('.compat .err-inline');
      expect(err).withContext('inline error rendered').not.toBeNull();
      // A translated key, never the raw exception text (D05).
      expect(err!.textContent).toContain('errors.generic');
      expect(err!.textContent).not.toContain('boom');
    });

    it('shows the empty sentence when nothing fits', async () => {
      const fixture = await setupCharacterisation({
        params: { kind: 'weapon', className: 'klwe_laserrepeater_s3' },
        svc: { getDetail: weaponDetailWithPort(), getCompatibleItems: async () => [] },
      });
      const el: HTMLElement = fixture.nativeElement;
      (el.querySelector('.hp-head') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector('.compat')?.textContent).toContain('codex.detail.compatNone');
    });
  });

  describe('saving the loadout draft', () => {
    function hangarStubs(createResult: unknown) {
      return {
        shipByClassName: jasmine.createSpy('shipByClassName').and.returnValue({ id: 's1' }),
        addShip: jasmine.createSpy('addShip').and.resolveTo(null),
        listConfigs: jasmine.createSpy('listConfigs').and.resolveTo([]),
        createConfig: jasmine.createSpy('createConfig').and.resolveTo(createResult),
        activateConfig: jasmine.createSpy('activateConfig').and.resolveTo(true),
        updateConfig: jasmine
          .createSpy('updateConfig')
          .and.callFake(async (id: string, patch: { loadout: unknown }) => ({ id, loadout: patch.loadout })),
        forkFollowedLoadout: jasmine.createSpy('forkFollowedLoadout').and.resolveTo(null),
      };
    }

    async function setupDraftPage(createResult: unknown) {
      const hangar = hangarStubs(createResult);
      const ensureEditable = jasmine.createSpy('ensureEditable').and.resolveTo('own');
      const fixture = await setupCharacterisation({
        params: { kind: 'ship', className: 'cnou_nomad' },
        svc: { getDetail: shipDetailWithGunPort() },
        hangar: hangar as unknown as Partial<HangarService>,
        forkGuard: { ensureEditable } as unknown as Partial<CodexHoloForkGuard>,
      });
      // The draft mirrors itself into the URL; keep the Karma page where it is.
      spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
      return { fixture, hangar, ensureEditable, cmp: fixture.componentInstance };
    }

    function pickNewGun(cmp: CodexDetailComponent): void {
      const pick: SwapPick = {
        className: 'BEHR_LaserCannon_S3',
        target: {
          port: 'Weapon Top Left',
          count: 1,
          className: 'KLWE_LaserRepeater_S3_SCItem',
          kind: 'weapon',
          name: null,
          size: 3,
          rawPorts: ['hardpoint_weapon_top_left'],
        } as SwapTarget,
      };
      cmp.onSwapPicked(pick);
    }

    it('does nothing while there is nothing saveable', async () => {
      const { cmp, hangar } = await setupDraftPage({ id: 'c1', loadout: [], isActive: false });
      await cmp.saveLoadoutDraft();
      expect(hangar.shipByClassName).not.toHaveBeenCalled();
      expect(hangar.createConfig).not.toHaveBeenCalled();
      expect(hangar.updateConfig).not.toHaveBeenCalled();
    });

    it('creates and activates a config when the ship has none, then writes the merged loadout', async () => {
      const { fixture, cmp, hangar, ensureEditable } = await setupDraftPage({
        id: 'c1',
        loadout: [],
        isActive: false,
      });
      pickNewGun(cmp);
      await fixture.whenStable();
      expect(cmp.saveableEntries().length).withContext('draft is saveable').toBe(1);

      await cmp.saveLoadoutDraft();
      fixture.detectChanges();

      expect(hangar.shipByClassName).toHaveBeenCalledWith('cnou_nomad');
      expect(hangar.addShip).not.toHaveBeenCalled();
      expect(hangar.listConfigs).toHaveBeenCalledWith('s1');
      expect(hangar.createConfig).toHaveBeenCalledTimes(1);
      expect(hangar.createConfig.calls.mostRecent().args[0]).toBe('s1');
      expect(hangar.activateConfig).toHaveBeenCalledWith('c1', 's1');
      expect(ensureEditable).toHaveBeenCalledTimes(1);
      expect(hangar.updateConfig).toHaveBeenCalledTimes(1);
      const [id, patch] = hangar.updateConfig.calls.mostRecent().args as [string, { loadout: unknown[] }];
      expect(id).toBe('c1');
      expect(patch.loadout).toEqual([
        jasmine.objectContaining({ portName: 'hardpoint_weapon_top_left', className: 'BEHR_LaserCannon_S3' }),
      ]);
      expect(hangar.forkFollowedLoadout).not.toHaveBeenCalled();
      expect(cmp.saveError()).toBeNull();
    });

    it('says the hangar was unreachable when the config cannot be created', async () => {
      const { fixture, cmp, hangar } = await setupDraftPage(null);
      pickNewGun(cmp);
      await fixture.whenStable();

      await cmp.saveLoadoutDraft();
      fixture.detectChanges();

      expect(hangar.createConfig).toHaveBeenCalledTimes(1);
      expect(hangar.activateConfig).not.toHaveBeenCalled();
      expect(hangar.updateConfig).not.toHaveBeenCalled();
      // No translate loader in Karma: instant() hands back the key itself.
      expect(cmp.saveError()).toBe('codex.loadout.saveErrorHangar');
      // Visible without waiting for the arrival or opening the right rail.
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('codex.loadout.saveErrorHangar');
    });

    it('closes the picker and drafts nothing when the pick carries no raw port', async () => {
      const { cmp } = await setupDraftPage({ id: 'c1', loadout: [], isActive: false });
      cmp.onSwapPicked({
        className: 'BEHR_LaserCannon_S3',
        target: { port: 'x', count: 1, className: null, kind: null, name: null, size: null, rawPorts: [] } as SwapTarget,
      });
      expect(cmp.saveableEntries().length).toBe(0);
      expect(cmp.draftChangedCount()).toBe(0);
    });
  });

  describe('livery picker', () => {
    it('lists the livery family as anchors to their own routes and marks the open one', async () => {
      const listSkinSiblings = jasmine.createSpy('listSkinSiblings').and.resolveTo([
        skinRow('klwe_laserrepeater_s3', 'CF-337 Panther Repeater'),
        skinRow('klwe_laserrepeater_s3_ice01', 'CF-337 "Ice" Panther Repeater'),
      ]);
      const fixture = await setupCharacterisation({
        params: { kind: 'weapon', className: 'klwe_laserrepeater_s3' },
        svc: { listSkinSiblings },
      });
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;

      expect(listSkinSiblings).toHaveBeenCalledWith('weapon', 'klwe_laserrepeater_s3');
      const opts = Array.from(el.querySelectorAll<HTMLElement>('.skin-picker .sp-opt'));
      expect(opts.length).toBe(2);
      expect(opts.every((o) => o.tagName === 'A')).toBeTrue();
      expect(opts.map((o) => o.getAttribute('href'))).toEqual([
        '/codex/weapon/klwe_laserrepeater_s3',
        '/codex/weapon/klwe_laserrepeater_s3_ice01',
      ]);
      expect(opts[0].getAttribute('aria-current')).toBe('true');
      expect(opts[0].classList).toContain('current');
      expect(opts[1].hasAttribute('aria-current')).toBeFalse();
      expect(opts[0].textContent).toContain('codex.skinPicker.standard');
      expect(opts[1].textContent).toContain('Ice');
    });

    it('hides the picker for an entity without liveries', async () => {
      const fixture = await setupCharacterisation({
        params: { kind: 'weapon', className: 'klwe_laserrepeater_s3' },
      });
      expect((fixture.nativeElement as HTMLElement).querySelector('.skin-picker')).toBeNull();
    });
  });

});

// ── Holotable helpers ───────────────────────────────────────────────────────

function holoStage(fixture: ComponentFixture<CodexDetailComponent>): CodexHoloStageComponent {
  const de = fixture.debugElement.query(By.directive(CodexHoloStageComponent));
  expect(de).withContext('Holotable rendered').not.toBeNull();
  return de.componentInstance as CodexHoloStageComponent;
}

/** Runs the arrival to its end (what reduced motion or a repeat visit does). */
function arrive(fixture: ComponentFixture<CodexDetailComponent>): void {
  holoStage(fixture).phase.set('done');
  fixture.detectChanges();
}

function openDetails(fixture: ComponentFixture<CodexDetailComponent>): HTMLElement {
  const el: HTMLElement = fixture.nativeElement;
  (el.querySelector('.details-toggle') as HTMLButtonElement).click();
  fixture.detectChanges();
  const body = el.querySelector('.details-body') as HTMLElement;
  expect(body).withContext('details drawer open').not.toBeNull();
  return body;
}

describe('CodexDetailComponent — Holotable (Nomad fixture)', () => {
  let fixture: ComponentFixture<CodexDetailComponent>;

  beforeEach(async () => {
    fixture = await setup('ship');
  });

  it('hands the census, counted from the loadout blocks themselves, to the Holotable', () => {
    const cmp = fixture.componentInstance;
    const chips = cmp.stageCounts();
    const sections = cmp.moduleSections();
    // One chip per block, the airframe excluded.
    expect(chips.length).toBe(cmp.moduleCount() + cmp.tailModuleCount() - 1);
    expect(chips.find((c) => c.group === 'structure')).toBeUndefined();
    const weapons = chips.find((c) => c.group === 'weapons');
    expect(weapons?.count).toBe(sections.find((s) => s.section === 'weapons')?.slots.length);
    expect(weapons?.labelKey).toBe('codex.moduleSection.weapons');
    expect(holoStage(fixture).stageCounts()).toEqual(chips);
  });

  it('has exactly one source for the equipped mass', () => {
    arrive(fixture);
    const el: HTMLElement = fixture.nativeElement;
    // Every perspective tile unfolded — the ship panel is one of them.
    el.querySelectorAll<HTMLButtonElement>('.tile-expand').forEach((b) => b.click());
    fixture.detectChanges();
    const massRows = Array.from(el.querySelectorAll('dt')).filter((dt) =>
      dt.textContent?.includes('codex.hull.equippedMass'),
    );
    // Two perspective tiles unfold the same ship panel, so the row may show
    // twice — but always from the one source (the draft), never two values.
    expect(massRows.length).toBeGreaterThan(0);
    const values = new Set(massRows.map((dt) => dt.nextElementSibling?.textContent?.trim()));
    expect(values.size).toBe(1);
  });

  it('lists every loadout block once in the ports list, and the airframe card counts its blocks', () => {
    const cmp = fixture.componentInstance;
    const el: HTMLElement = fixture.nativeElement;
    // The Nomad fixture has more sections than blocks — that is the whole point.
    const sections = cmp.moduleSections().filter((s) => s.slots.length > 0);
    expect(cmp.moduleCount()).toBeLessThan(sections.length);
    const listed = el.querySelectorAll('.below-ports .mod-sec').length;
    expect(listed).toBe(cmp.moduleCount() + cmp.tailModuleCount());
    const body = openDetails(fixture);
    expect(body.querySelector('.col-loadout-tail .col-head .n')?.textContent?.trim()).toBe(String(cmp.tailModuleCount()));
  });

  // AUD-065 / AUD-268: add-to-hangar locks while it runs and says when it failed.
  it('locks "add to hangar" while the insert runs and alerts when it fails', async () => {
    const hangar = TestBed.inject(HangarService);
    let resolve!: (v: null) => void;
    const addShip = spyOn(hangar, 'addShip').and.returnValue(new Promise<null>((r) => (resolve = r)));
    const body = openDetails(fixture);
    const btn = body.querySelector('.add-hangar') as HTMLButtonElement;
    expect(btn).withContext('add-to-hangar button rendered').not.toBeNull();

    btn.click();
    fixture.detectChanges();
    expect(btn.disabled).toBeTrue();
    expect(btn.getAttribute('aria-busy')).toBe('true');
    void fixture.componentInstance.addToHangar();
    expect(addShip).toHaveBeenCalledTimes(1);

    resolve(null);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(btn.disabled).toBeFalse();
    const alert = body.querySelector('.add-err[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('codex.card.addToHangarFailed');
  });
});

describe('CodexDetailComponent — Holotable copy link', () => {
  let fixture: ComponentFixture<CodexDetailComponent>;
  beforeEach(async () => {
    fixture = await setupCharacterisation({ params: { kind: 'ship', className: 'cnou_nomad' } });
  });

  function openShareCopy(): HTMLButtonElement {
    const el: HTMLElement = fixture.nativeElement;
    const share = Array.from(el.querySelectorAll<HTMLButtonElement>('.tools5 button')).find((b) =>
      (b.textContent ?? '').includes('codex.holo.stage.viewShare'),
    );
    expect(share).withContext('share button rendered').toBeDefined();
    share!.click();
    fixture.detectChanges();
    const copy = el.querySelector('.link-copy') as HTMLButtonElement;
    expect(copy).withContext('copy row rendered').not.toBeNull();
    return copy;
  }

  it('confirms for two seconds after the URL reached the clipboard', fakeAsync(() => {
    const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    const copy = openShareCopy();
    expect(copy.classList).not.toContain('done');

    copy.click();
    flushMicrotasks();
    fixture.detectChanges();
    expect(write).toHaveBeenCalledOnceWith(location.href);
    expect(copy.classList).toContain('done');
    expect(copy.textContent).toContain('codex.holo.share.copied');

    tick(1999);
    fixture.detectChanges();
    expect(copy.classList).withContext('still confirmed just before 2 s').toContain('done');
    tick(1);
    fixture.detectChanges();
    expect(copy.classList).not.toContain('done');
  }));

  it('confirms nothing when the browser denies the clipboard', fakeAsync(() => {
    spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('denied'));
    const copy = openShareCopy();
    copy.click();
    flushMicrotasks();
    fixture.detectChanges();
    expect(copy.classList).not.toContain('done');
  }));
});

describe('CodexDetailComponent — Holotable RSI pledge link', () => {
  it('offers no link form to a signed-out reader', async () => {
    const fixture = await setupCharacterisation({ params: { kind: 'ship', className: 'cnou_nomad' } });
    const body = openDetails(fixture);
    const labels = Array.from(body.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.includes('codex.shipLink.add'))).toBeFalse();
    // The RSI link itself stays: a plain anchor into a new tab.
    const rsi = body.querySelector('a.rsi-link') as HTMLAnchorElement;
    expect(rsi).not.toBeNull();
    expect(rsi.target).toBe('_blank');
    expect(rsi.rel).toContain('noopener');
  });

  it('opens the form for a signed-in reader and names a rejected URL', async () => {
    const setMyLink = jasmine.createSpy('setMyLink').and.resolveTo('invalidUrl');
    const fixture = await setupCharacterisation({
      params: { kind: 'ship', className: 'cnou_nomad' },
      user: { id: 'u1' },
      hangar: { listConfigs: async () => [] } as Partial<HangarService>,
      shipLinks: { setMyLink } as unknown as Partial<ShipLinkService>,
    });
    const el: HTMLElement = fixture.nativeElement;
    const body = openDetails(fixture);
    const add = Array.from(body.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').includes('codex.shipLink.add'),
    );
    expect(add).withContext('"add link" button rendered').toBeDefined();
    expect(el.querySelector('.ship-link-form')).toBeNull();

    add!.click();
    fixture.detectChanges();
    const form = el.querySelector('.ship-link-form') as HTMLFormElement;
    expect(form).not.toBeNull();

    const input = form.querySelector('input.sl-input') as HTMLInputElement;
    input.value = 'not a url';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(setMyLink).toHaveBeenCalledOnceWith('cnou_nomad', 'not a url');
    const err = el.querySelector('.sl-error');
    expect(err).not.toBeNull();
    expect(err!.getAttribute('role')).toBe('alert');
    expect(err!.textContent).toContain('codex.shipLink.error.invalidUrl');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('.sl-ok')).toBeNull();
  });

  it('confirms a saved link', async () => {
    const setMyLink = jasmine.createSpy('setMyLink').and.resolveTo(null);
    const fixture = await setupCharacterisation({
      params: { kind: 'ship', className: 'cnou_nomad' },
      user: { id: 'u1' },
      hangar: { listConfigs: async () => [] } as Partial<HangarService>,
      shipLinks: { setMyLink } as unknown as Partial<ShipLinkService>,
    });
    const cmp = fixture.componentInstance;
    openDetails(fixture);
    cmp.toggleLinkForm();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.ship-link-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.sl-error')).toBeNull();
    expect(el.querySelector('.sl-ok')?.textContent).toContain('codex.shipLink.saved');
  });
});
