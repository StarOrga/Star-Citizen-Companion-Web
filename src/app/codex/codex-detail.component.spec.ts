import type { Mock } from 'vitest';
import { PageCornerService } from '../shell/corners/page-corner.service';
import { HqItemMarksService } from '../hq/data/hq-item-marks.service';
import { fakeItemMarks } from '../hq/data/hq-item-marks.testing';
import { provideNoShipBlueprints } from './ship-blueprint/ship-blueprint.testing';
import { ItemPathService } from '../hq/data/item-path.service';
import { NachschubService } from '../hq/nachschub/nachschub.service';
import { fakeItemPath } from '../shared/item-path/item-path.testing';
import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CodexHoloStageComponent } from './holo/codex-holo-stage.component';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { SilThumbsService } from '../shared/sil-thumb/sil-thumbs.service';
import { CodexDetailComponent } from './codex-detail.component';
import { BlueprintDetail, CodexService, ResolvedEntity } from './codex.service';
import { HangarService } from '../hangar/hangar.service';
import { HqOwnershipService } from '../hq/hq-ownership.service';
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

/**
 * Renders the page under a fake clock — call inside `fakeAsync`.
 *
 * Why not `await fixture.whenStable()` on a ship page: "stable" means no
 * timer and no animation frame is pending anywhere in the zone, and the
 * Holotable's arrival keeps a REAL 1.3 s timer (plus an animation frame for
 * the KPI ink) pending right after the first render. Every `whenStable()`
 * after the setup therefore sat out the arrival on the wall clock — 1.3 s
 * per case on a quiet machine, past Jasmine's 5 s on a loaded CI runner or a
 * page that renders no frames (CI run 37609592589 and its reruns). Under
 * `fakeAsync` the arrival, the 0 ms cohort timer and every frame are fake
 * tasks: the spec says when time passes, and nothing waits for the clock.
 * A real HTTP request inside `fakeAsync` throws, so this also proves the
 * page talks to the stubs only.
 */
function renderOnFakeClock(): ComponentFixture<CodexDetailComponent> {
  void TestBed.compileComponents();
  const fixture = TestBed.createComponent(CodexDetailComponent);
  fixture.detectChanges();
  // The stubbed reads (microtasks) and the 0 ms cohort kick-off — not the arrival.
  tick();
  fixture.detectChanges();
  return fixture;
}

async function setup(
  kind: 'ship' | 'weapon',
  skins: ShipSkin[] = [],
  payload: ShipPayload = NOMAD_PAYLOAD,
  svc: Partial<CodexService> = {},
) {
  configureSetup(kind, skins, payload, svc);
  await TestBed.compileComponents();
  const fixture: ComponentFixture<CodexDetailComponent> = TestBed.createComponent(CodexDetailComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function configureSetup(
  kind: 'ship' | 'weapon',
  skins: ShipSkin[] = [],
  payload: ShipPayload = NOMAD_PAYLOAD,
  svc: Partial<CodexService> = {},
): void {
  const className = kind === 'ship' ? 'cnou_nomad' : 'klwe_laserrepeater_s3';
  TestBed.configureTestingModule({
    imports: [CodexDetailComponent],
    providers: [
      provideNoShipBlueprints(),
      provideRouter([]),
      { provide: ItemPathService, useValue: fakeItemPath() }, { provide: HqItemMarksService, useValue: fakeItemMarks() },
      { provide: NachschubService, useValue: { active: () => [], linesOf: () => [], ensureLoaded: async () => undefined } },
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
          roleLoadouts: signal([]),
          error: signal(null),
          listAllConfigs: async () => [],
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
      { provide: UexShopService, useValue: { whereToBuy: async () => [], whereToBuyShip: async () => [] } as Partial<UexShopService> },
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
  });
}

describe('CodexDetailComponent — ship load skeleton', () => {
  it('shows page header + holodeck skeleton while the ship loads, then replaces it with the stage', async () => {
    let release!: () => void;
    const stub = makeCodexServiceStub(NOMAD_PAYLOAD);
    const getDetail: CodexService['getDetail'] = (kind, className) =>
      new Promise((r) => { release = () => r(stub.getDetail!(kind, className)); });
    configureSetup('ship', [], NOMAD_PAYLOAD, { getDetail });
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(CodexDetailComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-page-header')).not.toBeNull();
    expect(el.querySelector('.skel-stage .skel-ring')).not.toBeNull();
    expect(el.querySelector('.skel-stage .skel-scan')).not.toBeNull();
    expect(el.querySelector('.skel-stage')?.getAttribute('role')).toBe('status');
    expect(el.querySelector('.skel-card')).toBeNull();
    release();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.skel-stage')).toBeNull();
    expect(el.querySelector('sc-codex-holo-stage')).not.toBeNull();
  });

  it('draws only the real silhouette (no backdrop) while a ship with a silhouette loads', async () => {
    configureSetup('ship', [], NOMAD_PAYLOAD, { getDetail: () => new Promise(() => undefined) });
    TestBed.overrideProvider(SilThumbsService, {
      useValue: {
        request: () => undefined,
        thumbOf: () => ({ viewBox: '0 0 100 40', path: 'M0 20 L100 20 L50 0 Z', transform: '' }),
      } as Partial<SilThumbsService>,
    });
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(CodexDetailComponent);
    fixture.detectChanges();
    const stage = fixture.nativeElement.querySelector('.skel-stage.arrival') as HTMLElement;
    expect(stage).not.toBeNull();
    expect(stage.getAttribute('role')).toBe('status');
    expect(stage.querySelector('sc-ship-arrival svg path.outline')).not.toBeNull();
    expect(stage.querySelector('.skel-ring, .skel-scan, .sun, .star, .streak, canvas, img')).toBeNull();
    expect(Array.from(stage.querySelectorAll('i')).map((i) => i.className)).toEqual(['flash']);
  });

  it('keeps the stage skeleton when the ship has no silhouette', async () => {
    configureSetup('ship', [], NOMAD_PAYLOAD, { getDetail: () => new Promise(() => undefined) });
    TestBed.overrideProvider(SilThumbsService, {
      useValue: { request: () => undefined, thumbOf: () => null } as Partial<SilThumbsService>,
    });
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(CodexDetailComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-ship-arrival')).toBeNull();
    expect(el.querySelector('.skel-stage .skel-ring')).not.toBeNull();
  });

  it('keeps the plain skeleton card for non-ship kinds', async () => {
    const stub = makeCodexServiceStub(NOMAD_PAYLOAD);
    configureSetup('weapon', [], NOMAD_PAYLOAD, { getDetail: () => new Promise(() => undefined) });
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(CodexDetailComponent);
    fixture.detectChanges();
    expect(stub).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.skel-stage')).toBeNull();
    expect(fixture.nativeElement.querySelector('.skel-card')).not.toBeNull();
  });
});

describe('CodexDetailComponent — ship deck list (#796)', () => {
  // The classic view's Analyse card (the Holotable gets the same groups).
  const classic = async (fixture: ComponentFixture<CodexDetailComponent>) => {
    fixture.componentInstance.holoView.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const deckRow = (el: HTMLElement): string | null => {
    const dt = Array.from(el.querySelectorAll('dl.fact-grid dt')).find((n) => n.textContent?.trim() === 'codex.hull.decks');
    return dt ? (dt.nextElementSibling?.textContent ?? '').trim() : null;
  };

  it('renders the decks bottom-up in the hull facts, from the payload the page already loaded', async () => {
    const payload = {
      ...NOMAD_PAYLOAD,
      decks: [
        { key: 'Nomad_Upper_Deck', name: { en: 'Upper Deck', de: null }, order: 1 },
        { key: 'Nomad_Lower_Deck', name: null, order: 0 },
      ],
    } as ShipPayload;
    const fixture = await setup('ship', [], payload);
    expect(deckRow(await classic(fixture))).toBe('Lower Deck · Upper Deck');
  });

  it('renders no Decks row for a ship without decks', async () => {
    const fixture = await setup('ship');
    const el = await classic(fixture);
    expect(el.querySelector('dl.fact-grid')).not.toBeNull();
    expect(deckRow(el)).toBeNull();
  });
});

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


  it('keeps the hangar control above the picture, not on it (#239)', () => {
    // The stage is the CLASSIC view; the Holotable is the default.
    fixture.componentInstance.holoView.set(false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('header.hero.stage')).toBeTruthy();
    expect(el.querySelector('.hero.stage sc-hangar-picker')).toBeNull();
    const top = el.querySelector('.hero-stack > .stage-top') as HTMLElement;
    expect(top).toBeTruthy();
    // The picture and the ownership card share one box (#334: the 3D overlay covers both).
    expect(top.nextElementSibling?.matches('.hero-pair')).toBe(true);
    expect(top.nextElementSibling?.firstElementChild?.matches('header.hero.stage')).toBe(true);
    // Same functions as before: the button is an anchor into the hangar.
    const btn = top.querySelector('sc-hangar-picker a.picker-btn') as HTMLAnchorElement;
    expect(btn?.getAttribute('href')).toContain('hangar');
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
      silhouette: async () => null,
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
    const icon = el.querySelector('.hero-icon path, sc-codex-item-stage .ico path')!;
    // armorLegs' glyph path (codex-category-icon.component.ts) — distinct from
    // the generic 'item' box, which is what a missing attachType binding renders.
    expect(icon.getAttribute('d')).toContain('M7.5 3.5 H16.5');
  });
});

describe('CodexDetailComponent — missile on the item stage', () => {
  beforeEach(() => localStorage.setItem('sc.codex.itemView', 'holo'));
  afterEach(() => localStorage.removeItem('sc.codex.itemView'));
  it('renders the holotable item stage with the missile values and rank, not the classic hero', async () => {
    const fixture = await setup('weapon', [], NOMAD_PAYLOAD, {
      silhouette: async () => null,
      getMissileCohort: async () => [],
      getDetail: async () => ({
        classNameSlug: 'misl_s02_ir_novp_rattler',
        kind: 'component',
        row: { attach_type: 'Missile', size: 2 },
        payload: {},
        ports: [],
        strings: [],
      }),
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.item-page sc-codex-item-stage')).not.toBeNull();
    expect(el.querySelector('header.hero')).toBeNull();
    expect(el.querySelector('.it-pane sc-codex-rank-card')).not.toBeNull();
  });
});

describe('CodexDetailComponent — crafting recipe (#187)', () => {
  beforeEach(() => localStorage.setItem('sc.codex.itemView', 'holo'));
  afterEach(() => localStorage.removeItem('sc.codex.itemView'));
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
    // The recipe lives behind the "Herstellung" tab of the item page.
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.it-tab')[1].click();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const section = Array.from(el.querySelectorAll('section')).find((s) =>
      s.querySelector('h2')?.textContent?.includes('codex.detail.craftedFrom'),
    );
    expect(section, 'recipe section').toBeTruthy();
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
    // The recipe lives behind the "Herstellung" tab of the item page.
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.it-tab')[1].click();
    fixture.detectChanges();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { codex: { detail: { minQuality: 'min. quality {{value}}' } } });
    translate.use('en');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const section = Array.from(el.querySelectorAll('section')).find((s) =>
      s.querySelector('h2')?.textContent?.includes('codex.detail.craftedFrom'),
    );
    expect(section, 'recipe section').toBeTruthy();
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
  configureCharacterisation(opts);
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(CodexDetailComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function configureCharacterisation(opts: CharacterisationOpts): void {
  const params = convertToParamMap(opts.params);
  TestBed.configureTestingModule({
    imports: [CodexDetailComponent],
    providers: [
      provideNoShipBlueprints(),
      provideRouter([]),
      { provide: ItemPathService, useValue: fakeItemPath() }, { provide: HqItemMarksService, useValue: fakeItemMarks() },
      { provide: NachschubService, useValue: { active: () => [], linesOf: () => [], ensureLoaded: async () => undefined } },
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
          roleLoadouts: signal([]),
          listAllConfigs: async () => [],
          ships: signal([]),
          loadAll: async () => undefined,
          addShip: async () => null,
          shipByClassName: () => null,
          recentShips: signal([]),
          markShipPicked: () => undefined,
          error: signal(null),
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
      { provide: UexShopService, useValue: { whereToBuy: async () => [], whereToBuyShip: async () => [] } as Partial<UexShopService> },
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
  });
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
  // A draft on the ship mirrors itself into localStorage; never leak it into the next case.
  // Cleared before as well: a spec elsewhere (random order) may leave one behind.
  beforeEach(() => localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY));

  describe('invalid route', () => {
    it('names an unknown category in the not-found state (h1, line, way back) and offers no retry', async () => {
      const getDetail = vi.fn().mockName('getDetail');
      const fixture = await setupCharacterisation({
        params: { kind: 'foo', className: 'x' },
        svc: { getDetail },
      });
      const el: HTMLElement = fixture.nativeElement;
      const h1 = el.querySelector('sc-not-found h1');
      expect(h1, 'not-found heading rendered').not.toBeNull();
      expect(h1!.textContent).toContain('codex.detail.notFoundPage.title');
      expect(el.querySelector('sc-not-found')!.textContent).toContain('codex.detail.invalidRoute');
      expect(el.querySelector('sc-not-found a.nf-back')?.getAttribute('href')).toContain('/codex');
      expect(el.querySelector('.err')).toBeNull();
      expect(getDetail).not.toHaveBeenCalled();
      expect(fixture.componentInstance.canRetry()).toBe(false);
    });
  });

  describe('unknown entry (AUD-L17)', () => {
    it('renders a not-found state with an h1 and a real anchor back to the kind index when the read finds no row', async () => {
      const getDetail = vi.fn().mockName('getDetail').mockResolvedValue(null);
      const fixture = await setupCharacterisation({
        params: { kind: 'ship', className: 'NOPE_Ship' },
        svc: { getDetail },
      });
      const el: HTMLElement = fixture.nativeElement;
      const h1s = el.querySelectorAll('h1');
      expect(h1s.length).toBe(1);
      expect(h1s[0].textContent).toContain('codex.detail.notFoundPage.title');
      const back = el.querySelector('a.nf-back') as HTMLAnchorElement | null;
      expect(back, 'way back is an anchor').not.toBeNull();
      expect(back!.getAttribute('href')).toContain('/codex/index');
      expect(el.querySelector('.err')).toBeNull();
    });

    it('keeps the error state with retry when the read itself failed', async () => {
      const getDetail = vi.fn().mockName('getDetail').mockRejectedValue(new Error('network down'));
      const fixture = await setupCharacterisation({
        params: { kind: 'item', className: 'NOPE' },
        svc: { getDetail },
      });
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('sc-not-found')).toBeNull();
      expect(el.querySelector('.err .retry')).not.toBeNull();
    });
  });

  describe('hardpoint compatibility (port fold-out)', () => {
    it('loads the compatible items once on the first open and serves re-opens from the cache', async () => {
      const getCompatibleItems = vi.fn().mockName('getCompatibleItems').mockResolvedValue([
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
      expect(head, 'expandable port rendered').not.toBeNull();
      expect(head.disabled).toBe(false);
      expect(el.querySelector('.compat')).toBeNull();

      head.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(getCompatibleItems).toHaveBeenCalledTimes(1);
      expect(getCompatibleItems).toHaveBeenCalledWith({ types: ['WeaponAttachment'], minSize: 1, maxSize: 2 });
      expect(el.querySelector('.hp')!.classList).toContain('open');
      const link = el.querySelector('.compat a.compat-link') as HTMLAnchorElement;
      expect(link, 'compatible item is an anchor').not.toBeNull();
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
      const getCompatibleItems = vi.fn().mockName('getCompatibleItems').mockRejectedValue(new Error('boom'));
      const fixture = await setupCharacterisation({
        params: { kind: 'weapon', className: 'klwe_laserrepeater_s3' },
        svc: { getDetail: weaponDetailWithPort(), getCompatibleItems },
      });
      const el: HTMLElement = fixture.nativeElement;
      (el.querySelector('.hp-head') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();
      const err = el.querySelector('.compat .err-inline');
      expect(err, 'inline error rendered').not.toBeNull();
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
        shipByClassName: vi.fn().mockName('shipByClassName').mockReturnValue({ id: 's1' }),
        addShip: vi.fn().mockName('addShip').mockResolvedValue(null),
        listConfigs: vi.fn().mockName('listConfigs').mockResolvedValue([]),
        createConfig: vi.fn().mockName('createConfig').mockResolvedValue(createResult),
        activateConfig: vi.fn().mockName('activateConfig').mockResolvedValue(true),
        updateConfig: vi.fn().mockName('updateConfig').mockImplementation(async (id: string, patch: { loadout: unknown }) => ({ id, loadout: patch.loadout })),
        forkFollowedLoadout: vi.fn().mockName('forkFollowedLoadout').mockResolvedValue(null),
      };
    }

    /** A ship page with a saveable gun port, on the fake clock — call inside `fakeAsync`. */
    function renderDraftPage(createResult: unknown) {
      const hangar = hangarStubs(createResult);
      const ensureEditable = vi.fn().mockName('ensureEditable').mockResolvedValue('own');
      configureCharacterisation({
        params: { kind: 'ship', className: 'cnou_nomad' },
        svc: { getDetail: shipDetailWithGunPort() },
        hangar: hangar as unknown as Partial<HangarService>,
        forkGuard: { ensureEditable } as unknown as Partial<CodexHoloForkGuard>,
      });
      const fixture = renderOnFakeClock();
      // The draft mirrors itself into the URL; keep the test page where it is.
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      return { fixture, hangar, ensureEditable, cmp: fixture.componentInstance };
    }

    /** Runs a save to its end on the fake clock and proves it did end. */
    function save(cmp: CodexDetailComponent): void {
      let settled = false;
      void cmp.saveLoadoutDraft().finally(() => (settled = true));
      flushMicrotasks();
      expect(settled, 'save settled').toBe(true);
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

    it('does nothing while there is nothing saveable', fakeAsync(() => {
      const { cmp, hangar } = renderDraftPage({ id: 'c1', loadout: [], isActive: false });
      save(cmp);
      expect(hangar.shipByClassName).not.toHaveBeenCalled();
      expect(hangar.createConfig).not.toHaveBeenCalled();
      expect(hangar.updateConfig).not.toHaveBeenCalled();
    }));

    it('codex mode never saves; "In dein HQ übernehmen" creates a variant with the draft and opens it as ?v=', fakeAsync(() => {
      const { fixture, cmp, hangar } = renderDraftPage({
        id: 'c1',
        loadout: [],
        isActive: false,
      });
      pickNewGun(cmp);
      flushMicrotasks();
      expect(cmp.saveableEntries().length, 'draft is saveable').toBe(1);
      expect(cmp.personalMode(), 'no ?v= = codex mode').toBe(false);

      save(cmp);
      expect(hangar.updateConfig, 'codex mode never writes').not.toHaveBeenCalled();

      void cmp.addToHangar();
      flushMicrotasks();
      fixture.detectChanges();

      expect(hangar.createConfig).toHaveBeenCalledTimes(1);
      const [shipId, , , loadout] = vi.mocked(hangar.createConfig).mock.lastCall! as [string, string, string, unknown[]];
      expect(shipId).toBe('s1');
      expect(loadout).toEqual([
        expect.objectContaining({ portName: 'hardpoint_weapon_top_left', className: 'BEHR_LaserCannon_S3' }),
      ]);
      expect(hangar.updateConfig).not.toHaveBeenCalled();
      const nav = TestBed.inject(Router).navigate as Mock;
      expect(nav).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ v: 'c1' }) }));
      expect(cmp.saveError()).toBeNull();
    }));

    it('says the hangar was unreachable when the variant cannot be created', fakeAsync(() => {
      const { fixture, cmp, hangar } = renderDraftPage(null);
      pickNewGun(cmp);
      flushMicrotasks();

      void cmp.addToHangar();
      flushMicrotasks();
      fixture.detectChanges();

      expect(hangar.createConfig).toHaveBeenCalledTimes(1);
      expect(cmp.addFailed()).toBe(true);
      expect(hangar.updateConfig).not.toHaveBeenCalled();
      // No translate loader in the spec: instant() hands back the key itself.
      expect(cmp.saveError()).toBe('codex.loadout.saveErrorHangar');
      // Visible without waiting for the arrival or opening the right rail.
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('codex.loadout.saveErrorHangar');
    }));

    it('closes the picker and drafts nothing when the pick carries no raw port', fakeAsync(() => {
      const { cmp } = renderDraftPage({ id: 'c1', loadout: [], isActive: false });
      cmp.onSwapPicked({
        className: 'BEHR_LaserCannon_S3',
        target: { port: 'x', count: 1, className: null, kind: null, name: null, size: null, rawPorts: [] } as SwapTarget,
      });
      expect(cmp.saveableEntries().length).toBe(0);
      expect(cmp.draftChangedCount()).toBe(0);
    }));
  });

  describe('livery picker', () => {
    it('lists the livery family as anchors to their own routes and marks the open one', async () => {
      const listSkinSiblings = vi.fn().mockName('listSkinSiblings').mockResolvedValue([
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
      expect(opts.every((o) => o.tagName === 'A')).toBe(true);
      expect(opts.map((o) => o.getAttribute('href'))).toEqual([
        '/codex/weapon/klwe_laserrepeater_s3',
        '/codex/weapon/klwe_laserrepeater_s3_ice01',
      ]);
      expect(opts[0].getAttribute('aria-current')).toBe('true');
      expect(opts[0].classList).toContain('current');
      expect(opts[1].hasAttribute('aria-current')).toBe(false);
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
  expect(de, 'Holotable rendered').not.toBeNull();
  return de.componentInstance as CodexHoloStageComponent;
}

/** Runs the arrival to its end (what reduced motion or a repeat visit does). */
function arrive(fixture: ComponentFixture<CodexDetailComponent>): void {
  holoStage(fixture).phase.set('done');
  fixture.detectChanges();
}

/** The side column below the first screen (description + RSI, where to buy, variants — concept holotisch-unten d2). */
function openBlock(fixture: ComponentFixture<CodexDetailComponent>): HTMLElement {
  const open = (fixture.nativeElement as HTMLElement).querySelector('.holo-below .below-side') as HTMLElement;
  expect(open, 'open block').not.toBeNull();
  return open;
}

function openDetails(fixture: ComponentFixture<CodexDetailComponent>): HTMLElement {
  const el: HTMLElement = fixture.nativeElement;
  (el.querySelector('.details-toggle') as HTMLButtonElement).click();
  fixture.detectChanges();
  const body = el.querySelector('.details-body') as HTMLElement;
  expect(body, 'details drawer open').not.toBeNull();
  return body;
}

// Every Holotable case runs on the fake clock (see renderOnFakeClock): the
// arrival's timers and frames never make a case wait for the wall clock.
describe('CodexDetailComponent — Holotable (Nomad fixture)', () => {
  beforeEach(() => configureSetup('ship'));

  it('hands the census, counted from the loadout blocks themselves, to the Holotable', fakeAsync(() => {
    const fixture = renderOnFakeClock();
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
  }));

  it('has exactly one source for the equipped mass', fakeAsync(() => {
    const fixture = renderOnFakeClock();
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
  }));

  it('lists every loadout block once in the ports list, and the airframe card counts its blocks', fakeAsync(() => {
    const fixture = renderOnFakeClock();
    const cmp = fixture.componentInstance;
    const el: HTMLElement = fixture.nativeElement;
    // The Nomad fixture has more sections than blocks — that is the whole point.
    const sections = cmp.moduleSections().filter((s) => s.slots.length > 0);
    expect(cmp.moduleCount()).toBeLessThan(sections.length);
    // Four area columns (concept holotisch-unten r1): every section stands
    // once, in the column of the strip area it moves — no merged blocks.
    const listed = el.querySelectorAll('.holo-below .below-area .mod-sec').length;
    const withSlots = [...cmp.primaryModuleSections(), ...cmp.tailModuleSections()].filter((s) => s.slots.length > 0);
    expect(listed).toBe(withSlots.length);
    const body = openDetails(fixture);
    expect(body.querySelector('.col-loadout-tail .col-head .n')?.textContent?.trim()).toBe(String(cmp.tailModuleCount()));
  }));
});

describe('CodexDetailComponent — Holotable basics stand open (d-drawer)', () => {
  beforeEach(() => configureSetup('ship'));

  it('Beschreibung, Wo zu kaufen and the variants sit open on the page, the drawer keeps the rest', fakeAsync(() => {
    const fixture = renderOnFakeClock();
    arrive(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const open = openBlock(fixture);
    expect(open.querySelector('#bezugsquelle'), 'where to buy, open').not.toBeNull();
    expect(el.querySelector('.details-body'), 'drawer still closed').toBeNull();
    const body = openDetails(fixture);
    expect(body.querySelector('#bezugsquelle')).toBeNull();
  }));
});

describe('CodexDetailComponent — rank scope default per view', () => {
  beforeEach(() => {
    configureSetup('ship');
    localStorage.removeItem('sc.codex.rankScope');
    localStorage.removeItem('sc.codex.rankScopeByShip');
  });
  afterEach(() => {
    localStorage.removeItem('sc.codex.rankScope');
    localStorage.removeItem('sc.codex.rankScopeByShip');
  });

  it('nobody chose: Alle in the classic view, Rolle in the Holotable', fakeAsync(() => {
    const fixture = renderOnFakeClock();
    const cmp = fixture.componentInstance;
    cmp.holoView.set(true);
    expect(cmp.rankScope()).toBe('role');
    cmp.holoView.set(false);
    expect(cmp.rankScope()).toBe('all');
  }));

  it('the classic choice stays in the classic view; the Holotable keeps its own per ship (concept r1-default)', fakeAsync(() => {
    const fixture = renderOnFakeClock();
    const cmp = fixture.componentInstance;
    cmp.holoView.set(false);
    cmp.setRankScope('career');
    expect(cmp.rankScope()).toBe('career');
    cmp.holoView.set(true);
    // The account-wide choice no longer overrides the Holotable.
    expect(cmp.rankScope()).toBe('role');
    cmp.setRankScope('all');
    expect(cmp.rankScope()).toBe('all');
    expect(JSON.parse(localStorage.getItem('sc.codex.rankScopeByShip')!)[cmp.shipClassName()].scope).toBe('all');
    cmp.holoView.set(false);
    expect(cmp.rankScope()).toBe('career');
  }));
});

describe('CodexDetailComponent — one share per page (concept codex-kopf-besitz C9)', () => {
  beforeEach(() => configureCharacterisation({ params: { kind: 'ship', className: 'cnou_nomad' } }));

  it('the stage toolbar has no Teilen; the corner share FAB gets the whole view URL', fakeAsync(() => {
    const fixture = renderOnFakeClock();
    const el: HTMLElement = fixture.nativeElement;
    const tools = Array.from(el.querySelectorAll<HTMLButtonElement>('.tools5 button')).map((b) => b.textContent ?? '');
    expect(tools.length, '3D / Schema still there').toBeGreaterThan(0);
    expect(tools.some((t) => t.includes('Teilen') || t.includes('↗'))).toBe(false);
    expect(el.querySelector('sc-codex-holo-share')).toBeNull();
    expect(TestBed.inject(PageCornerService).share()?.url()).toBe(location.href);
    fixture.destroy();
    expect(TestBed.inject(PageCornerService).share(), 'released with the page').toBeNull();
    expect(TestBed.inject(PageCornerService).view()).toBeNull();
  }));

  it('the share FAB opens the page popover: plain link + save & share (#645), Escape closes it (F3)', fakeAsync(() => {
    const fixture = renderOnFakeClock();
    const corner = TestBed.inject(PageCornerService);
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    try {
      corner.share()!.open!(trigger);
      fixture.detectChanges();
      tick();
      const pop = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.ship-share-pop');
      expect(pop, 'popover rendered').not.toBeNull();
      expect(pop!.getAttribute('role')).toBe('dialog');
      expect(pop!.querySelector('.link-copy'), 'plain link of this view').not.toBeNull();
      expect(corner.share()!.expanded!()).toBe(true);
      pop!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      tick();
      expect(fixture.componentInstance.sharePopoverOpen()).toBe(false);
    } finally {
      trigger.remove();
      fixture.destroy();
    }
  }));

  it('no primary path panel on the page: Wo zu kaufen keeps a compact secondary wish control (F2)', fakeAsync(() => {
    const fixture = renderOnFakeClock();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-item-path.ip-primary')).toBeNull();
    fixture.componentInstance.holoView.set(false);
    fixture.detectChanges();
    expect(el.querySelector('.c-head h1'), 'classic title in the head row (F1)').not.toBeNull();
    expect(el.querySelector('.c-head .sc-head-strip')).not.toBeNull();
    expect(el.querySelectorAll('h1').length).toBe(1);
    fixture.destroy();
  }));
});

describe('CodexDetailComponent — Holotable RSI pledge link', () => {
  it('offers no link form to a signed-out reader', fakeAsync(() => {
    configureCharacterisation({ params: { kind: 'ship', className: 'cnou_nomad' } });
    const fixture = renderOnFakeClock();
    const body = openBlock(fixture);
    const labels = Array.from(body.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.includes('codex.shipLink.add'))).toBe(false);
    // The RSI link itself stays: a plain anchor into a new tab.
    const rsi = body.querySelector('a.rsi-link') as HTMLAnchorElement;
    expect(rsi).not.toBeNull();
    expect(rsi.target).toBe('_blank');
    expect(rsi.rel).toContain('noopener');
  }));

  it('opens the form for a signed-in reader and names a rejected URL', fakeAsync(() => {
    const setMyLink = vi.fn().mockName('setMyLink').mockResolvedValue('invalidUrl');
    configureCharacterisation({
      params: { kind: 'ship', className: 'cnou_nomad' },
      user: { id: 'u1' },
      hangar: { listConfigs: async () => [] } as Partial<HangarService>,
      shipLinks: { setMyLink } as unknown as Partial<ShipLinkService>,
    });
    const fixture = renderOnFakeClock();
    const el: HTMLElement = fixture.nativeElement;
    const body = openBlock(fixture);
    const add = Array.from(body.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').includes('codex.shipLink.add'),
    );
    expect(add, '"add link" button rendered').toBeDefined();
    expect(el.querySelector('.ship-link-form')).toBeNull();

    add!.click();
    fixture.detectChanges();
    const form = el.querySelector('.ship-link-form') as HTMLFormElement;
    expect(form).not.toBeNull();

    const input = form.querySelector('input.sl-input') as HTMLInputElement;
    input.value = 'not a url';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    flushMicrotasks();
    fixture.detectChanges();

    expect(setMyLink).toHaveBeenCalledTimes(1);
    expect(setMyLink).toHaveBeenCalledWith('cnou_nomad', 'not a url');
    const err = el.querySelector('.sl-error');
    expect(err).not.toBeNull();
    expect(err!.getAttribute('role')).toBe('alert');
    expect(err!.textContent).toContain('codex.shipLink.error.invalidUrl');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('.sl-ok')).toBeNull();
  }));

  it('confirms a saved link', fakeAsync(() => {
    const setMyLink = vi.fn().mockName('setMyLink').mockResolvedValue(null);
    configureCharacterisation({
      params: { kind: 'ship', className: 'cnou_nomad' },
      user: { id: 'u1' },
      hangar: { listConfigs: async () => [] } as Partial<HangarService>,
      shipLinks: { setMyLink } as unknown as Partial<ShipLinkService>,
    });
    const fixture = renderOnFakeClock();
    const cmp = fixture.componentInstance;
    openDetails(fixture);
    cmp.toggleLinkForm();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.ship-link-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    flushMicrotasks();
    fixture.detectChanges();
    expect(setMyLink).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.sl-error')).toBeNull();
    expect(el.querySelector('.sl-ok')?.textContent).toContain('codex.shipLink.saved');
  }));
});

describe('CodexDetailComponent — hangar legacy in the shell beta (B3)', () => {
  afterEach(() => localStorage.removeItem('sc.beta'));

  it('a /codex route is never HQ-hosted: input binding hands the host inputs undefined', async () => {
    const fixture = await setup('ship');
    // withComponentInputBinding() sets inputs the route does not carry to undefined.
    fixture.componentRef.setInput('hostClassName', undefined);
    fixture.componentRef.setInput('hostShipId', undefined);
    fixture.detectChanges();
    expect(fixture.componentInstance.hqHosted()).toBe(false);
    expect(fixture.componentInstance.hqShipId()).toBeNull();
  });

  it('classic page: the stage-top hangar row is gone with the shell beta (C24)', async () => {
    localStorage.setItem('sc.beta', JSON.stringify({ shell: true }));
    const fixture = await setup('ship');
    fixture.componentInstance.holoView.set(false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('header.hero.stage')).toBeTruthy();
    expect(el.querySelector('.hero-stack > .stage-top')).toBeNull();
    expect(el.querySelector('sc-hangar-picker')).toBeNull();
  });

  it('classic page: the row stays without the shell beta (C24)', async () => {
    localStorage.setItem('sc.beta', JSON.stringify({ shell: false }));
    const fixture = await setup('ship');
    fixture.componentInstance.holoView.set(false);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.hero-stack > .stage-top sc-hangar-picker')).toBeTruthy();
  });

  describe('own-ship actions (C26)', () => {
    function ownFixture(): ComponentFixture<CodexDetailComponent> {
      configureSetup('ship');
      const own = {
        ship: { id: 'sh1', shipClassName: 'CNOU_Nomad', customName: null, status: 'owned', pinnedRank: null, selectedSkinId: null, notes: null, createdAt: '', updatedAt: '' },
        configs: [], equippedOn: [], inSets: [],
      };
      vi.spyOn(TestBed.inject(HqOwnershipService), 'lookup').mockReturnValue(own as never);
      return renderOnFakeClock();
    }

    it('the ownership card sits on top of the Holotable panel and under the classic picture, never in the head', fakeAsync(() => {
      const fixture = ownFixture();
      const cmp = fixture.componentInstance;
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.holo-panel sc-codex-own-card')).not.toBeNull();
      expect(el.querySelector('.holo-topbar sc-codex-own-ship-actions'), 'the icon row left the head').toBeNull();
      expect(el.querySelector('.holo-topbar .sc-head-strip sc-codex-own-segment')).not.toBeNull();
      cmp.holoView.set(false);
      fixture.detectChanges();
      expect(el.querySelector('.hero-stack > .hero-pair > .hero-own sc-codex-own-card'), 'under the picture (#323)').not.toBeNull();
      expect(el.querySelector('.m-side sc-codex-own-card'), 'not in the headline side column').toBeNull();
      expect(el.querySelector('sc-item-path[level]')?.closest('.crumb-aside'), 'no path panel in the head').toBeFalsy();
    }));

    it('has no data pill in the head for anyone (C3)', fakeAsync(() => {
      const fixture = ownFixture();
      fixture.componentInstance.holoView.set(false);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.data-pill')).toBeNull();
      expect(el.querySelector('.crumb-aside .prov')).toBeNull();
    }));
  });
});

describe('CodexDetailComponent — personal mode lives in HQ under the shell beta', () => {
  const OWN_SHIP = { id: 'sh1', shipClassName: 'CNOU_Nomad', customName: null, status: 'owned', pinnedRank: null, selectedSkinId: null, notes: null, createdAt: '', updatedAt: '' };

  afterEach(() => localStorage.removeItem('sc.beta'));

  function prepare(opts: {
    shell: boolean;
    query?: Record<string, string>;
    host?: boolean;
    configs?: { id: string; name: string; active: boolean }[];
  }): { fixture: ComponentFixture<CodexDetailComponent>; nav: Mock } {
    localStorage.setItem('sc.beta', JSON.stringify({ shell: opts.shell }));
    configureSetup('ship');
    const query = convertToParamMap(opts.query ?? {});
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        paramMap: of(convertToParamMap(opts.host ? { id: 'sh1' } : { kind: 'ship', className: 'cnou_nomad' })),
        queryParamMap: of(query),
        snapshot: { paramMap: convertToParamMap({}), queryParamMap: query },
      },
    });
    const own = { ship: OWN_SHIP, configs: opts.configs ?? [], equippedOn: [], inSets: [] };
    const ownership = TestBed.inject(HqOwnershipService);
    vi.spyOn(ownership, 'lookup').mockReturnValue(own as never);
    vi.spyOn(ownership, 'shipFor').mockReturnValue(OWN_SHIP as never);
    vi.spyOn(ownership, 'ensureLoaded').mockResolvedValue(undefined);
    vi.spyOn(ownership, 'configById').mockImplementation(((id: string) =>
      opts.configs?.some((c) => c.id === id)
        ? { id, name: 'V', hangarShipId: 'sh1', isActive: true, loadout: [] }
        : null) as never);
    (TestBed.inject(HangarService).ships as unknown as ReturnType<typeof signal<unknown[]>>).set([OWN_SHIP]);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    void TestBed.compileComponents();
    const fixture = TestBed.createComponent(CodexDetailComponent);
    if (opts.host) {
      fixture.componentRef.setInput('hostClassName', 'cnou_nomad');
      fixture.componentRef.setInput('hostShipId', 'sh1');
    }
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    return { fixture, nav };
  }

  it('Codex page: an old ?mine on an owned ship redirects to the HQ ship page', fakeAsync(() => {
    const { nav } = prepare({ shell: true, query: { mine: '' } });
    tick();
    expect(nav).toHaveBeenCalledWith(['/hq/hangar', 'sh1'], { queryParams: {}, replaceUrl: true });
  }));

  it('Codex page: an old ?v= on an own variant redirects to the HQ ship page with that variant', fakeAsync(() => {
    const { nav } = prepare({ shell: true, query: { v: 'c1' }, configs: [{ id: 'c1', name: 'V', active: true }] });
    tick();
    expect(nav).toHaveBeenCalledWith(['/hq/hangar', 'sh1'], { queryParams: { v: 'c1' }, replaceUrl: true });
  }));

  it('Codex page: a variant that is not one of the reader own is dropped, with the note', fakeAsync(() => {
    const { fixture, nav } = prepare({ shell: true, query: { v: 'someone-elses' } });
    tick();
    expect(nav).toHaveBeenCalledWith([], expect.objectContaining({ replaceUrl: true, queryParams: expect.objectContaining({ v: null }) }));
    expect(fixture.componentInstance.foreignVariant()).toBe(true);
    expect(fixture.componentInstance.personalMode()).toBe(false);
  }));

  it('Codex page: no personal mode, switch or own-ship actions, even for an owned ship', fakeAsync(() => {
    const { fixture } = prepare({ shell: true, configs: [{ id: 'c1', name: 'V', active: true }] });
    const cmp = fixture.componentInstance;
    cmp.mineFlag.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(cmp.showModeSwitch()).toBe(false);
    expect(el.querySelector('sc-codex-mode-switch')).toBeNull();
  }));

  it('without the shell beta the Codex keeps its personal ?v= mode', fakeAsync(() => {
    const { nav } = prepare({ shell: false, query: { v: 'c1' }, configs: [{ id: 'c1', name: 'V', active: true }] });
    tick();
    expect(nav).not.toHaveBeenCalledWith(['/hq/hangar', 'sh1'], expect.anything());
  }));

  describe('hosted at /hq/hangar/:id', () => {
    it('shows the personal view of the variant with own-ship actions, the variant switch and HQ crumbs', fakeAsync(() => {
      const { fixture } = prepare({
        shell: true, host: true, query: { v: 'c1' }, configs: [{ id: 'c1', name: 'V', active: true }],
      });
      const cmp = fixture.componentInstance;
      const el: HTMLElement = fixture.nativeElement;
      expect(cmp.hqHosted()).toBe(true);
      expect(cmp.kind()).toBe('ship');
      expect(cmp.personalMode(), '?v= on the HQ URL opens the variant').toBe(true);
      expect(el.querySelector('sc-codex-own-card sc-codex-own-ship-actions'), 'rename / note / pin / remove in the card').not.toBeNull();
      expect(el.querySelector('.sc-head-strip sc-codex-mode-switch'), 'variant select in the head strip').not.toBeNull();
      expect(cmp.showModeSwitch()).toBe(true);
      expect(cmp.crumbs().map((c) => c.link)).toEqual(['/hq', '/hq/hangar']);
    }));
  });
});

describe('CodexDetailComponent — non-ship Klassisch / Holotisch', () => {
  const missile = () => setup('weapon', [], NOMAD_PAYLOAD, {
    silhouette: async () => null,
    getMissileCohort: async () => [],
    getDetail: async () => ({
      classNameSlug: 'misl_s02_ir_novp_rattler',
      kind: 'component',
      row: { attach_type: 'Missile', size: 2 },
      payload: {},
      ports: [],
      strings: [],
    }),
  });
  beforeEach(() => localStorage.removeItem('sc.codex.itemView'));
  afterEach(() => localStorage.removeItem('sc.codex.itemView'));

  it('opens Klassisch on the first visit and offers the toggle', async () => {
    const el: HTMLElement = (await missile()).nativeElement;
    expect(el.querySelector('.item-page')).toBeNull();
    expect(el.querySelector('header.hero')).not.toBeNull();
    // The switch lives in the corner (view toggle FAB): the page registers it for non-ships too.
    const v = TestBed.inject(PageCornerService).view();
    expect(v).not.toBeNull();
    expect(v!.holo()).toBe(false);
  });

  it('switches to Holotisch, remembers it, and the Holotisch panel does not scroll inside', async () => {
    const fixture = await missile();
    const el: HTMLElement = fixture.nativeElement;
    TestBed.inject(PageCornerService).view()!.toggle();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('.item-page.flow sc-codex-item-stage')).not.toBeNull();
    expect(localStorage.getItem('sc.codex.itemView')).toBe('holo');
  });

  it('opens Holotisch afterwards when it was the last choice', async () => {
    localStorage.setItem('sc.codex.itemView', 'holo');
    const el: HTMLElement = (await missile()).nativeElement;
    expect(el.querySelector('.item-page sc-codex-item-stage')).not.toBeNull();
  });
});
