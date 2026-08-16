import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexLandingComponent } from './codex-landing.component';
import { CodexListRow, CodexService, ResolvedEntity } from './codex.service';
import { PolySearchHit, scopeForKind } from './codex-poly-search';
import { ShipStatDelta } from './codex-build-diff';
import { HangarService } from '../hangar/hangar.service';
import { HangarRoleLoadout, HangarShip, HangarShipConfig } from '../hangar/hangar.types';
import { AuthService } from '../auth/auth.service';
import { UpcomingShipsService } from './upcoming-ships.service';
import { ShipPayload } from './codex.types';

function shipRow(over: Partial<CodexListRow> & { classNameSlug: string }): CodexListRow {
  return {
    nameLocalized: over.classNameSlug,
    manufacturerCode: 'AEGS',
    size: null,
    grade: null,
    role: null,
    crewSize: 1,
    weaponClass: null,
    componentKind: null,
    subType: null,
    attachType: null,
    speed: null,
    isVariant: false,
    payload: {},
    blueprintCategory: null,
    blueprintTier: null,
    craftTimeSec: null,
    ...over,
  };
}

function hangarShip(className: string, id = className): HangarShip {
  return {
    id,
    shipClassName: className,
    customName: null,
    status: 'owned',
    pinnedRank: null,
    selectedSkinId: null,
    notes: null,
    createdAt: '',
    updatedAt: '',
  };
}

function fpsLoadout(id: string, name: string): HangarRoleLoadout {
  return { id, name, role: 'fps', items: [], createdAt: '', updatedAt: '2026-08-10T00:00:00Z' };
}

function hit(kind: PolySearchHit['kind'], slug: string): PolySearchHit {
  return {
    kind,
    classNameSlug: slug,
    nameLocalized: slug,
    manufacturerCode: 'AEGS',
    size: null,
    grade: null,
    scope: scopeForKind(kind),
  };
}

describe('CodexLandingComponent', () => {
  async function setup(opts: {
    hangar?: HangarShip[];
    roleLoadouts?: HangarRoleLoadout[];
    byClassName?: Map<string, CodexListRow>;
    flagship?: string | null;
    deltas?: Map<string, ShipStatDelta[]>;
    searchResults?: PolySearchHit[];
    user?: { id: string } | null;
    entityCounts?: Record<string, number>;
    shipConfigs?: HangarShipConfig[];
    resolvedEntities?: Map<string, ResolvedEntity>;
  }) {
    const compareKeys = signal<string[]>([]);
    const byClassName = opts.byClassName ?? new Map<string, CodexListRow>();

    const codex: Partial<CodexService> = {
      build: signal({
        patchVersion: '4.2',
        buildNumber: 'desktop',
        entityCounts: opts.entityCounts ?? {
          ships: 353,
          items: 20015,
          components: 2172,
          weapons: 1312,
          blueprints: 1595,
          manufacturers: 1148,
          ammunition: 238,
        },
        extractedAt: '2026-08-02T20:29:00Z',
      }) as never,
      stale: signal(false) as never,
      compareKeys: compareKeys.asReadonly(),
      compareRejectedKind: signal(null) as never,
      compareCount: signal(0) as never,
      loadCurrentBuild: jasmine.createSpy('loadCurrentBuild').and.resolveTo(null),
      getShipsByClassNames: jasmine
        .createSpy('getShipsByClassNames')
        .and.callFake(async (names: string[]) => {
          const out = new Map<string, CodexListRow>();
          for (const n of names) {
            const r = byClassName.get(n);
            if (r) out.set(n, r);
          }
          return out;
        }),
      ownedFleetDeltas: jasmine
        .createSpy('ownedFleetDeltas')
        .and.resolveTo(opts.deltas ?? new Map<string, ShipStatDelta[]>()),
      searchAll: jasmine.createSpy('searchAll').and.resolveTo(opts.searchResults ?? []),
      previewUrl: () => null,
      isPinned: (_k, c) => compareKeys().includes(`ship:${c}`),
      togglePin: jasmine.createSpy('togglePin'),
      getEntityPayloads: jasmine.createSpy('getEntityPayloads').and.resolveTo(new Map()),
      resolveEntities: jasmine
        .createSpy('resolveEntities')
        .and.resolveTo(opts.resolvedEntities ?? new Map()),
      resolveLocaleKeys: jasmine.createSpy('resolveLocaleKeys').and.resolveTo(new Map()),
      listByKind: jasmine.createSpy('listByKind').and.resolveTo({ rows: [], count: 0 }),
    };

    const hangar: Partial<HangarService> = {
      ships: signal<HangarShip[]>(opts.hangar ?? []) as never,
      roleLoadouts: signal<HangarRoleLoadout[]>(opts.roleLoadouts ?? []) as never,
      flagshipClassName: signal<string | null>(opts.flagship ?? null) as never,
      loadAll: jasmine.createSpy('loadAll').and.resolveTo(undefined),
      shipByClassName: (className: string) => (opts.hangar ?? []).find((s) => s.shipClassName === className) ?? null,
      listConfigs: jasmine.createSpy('listConfigs').and.resolveTo(opts.shipConfigs ?? []),
    };

    const auth: Partial<AuthService> = {
      user: signal(opts.user === undefined ? { id: 'u1' } : opts.user) as never,
    };

    await TestBed.configureTestingModule({
      imports: [CodexLandingComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: codex },
        { provide: HangarService, useValue: hangar },
        { provide: AuthService, useValue: auth },
        {
          provide: UpcomingShipsService,
          useValue: {
            ensureLoaded: jasmine.createSpy('ensureLoaded').and.resolveTo(undefined),
            artFor: () => [] as string[],
          },
        },
      ],
    }).compileComponents();

    const fixture: ComponentFixture<CodexLandingComponent> =
      TestBed.createComponent(CodexLandingComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the empty-hangar invitation that links to the ship index', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.hangar-empty')).not.toBeNull();
    const cta = el.querySelector<HTMLAnchorElement>('.hangar-empty a.btn');
    expect(cta?.getAttribute('href')).toContain('/codex/index');
  });

  it('renders the honest AN BORD empty state (uncommissioned) with an armour CTA when no personal loadout exists', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.board-empty')).not.toBeNull();
    expect(el.querySelector('.paperdoll-wrap')).toBeNull();
    const cta = el.querySelector<HTMLAnchorElement>('.board-empty a.btn');
    expect(cta?.getAttribute('href')).toContain('/codex/fps');
  });

  it('renders the schematic paperdoll (not a list) once a personal loadout exists', async () => {
    const fixture = await setup({ hangar: [], roleLoadouts: [fpsLoadout('set1', 'Boarding Kit')] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.paperdoll-wrap svg.paperdoll')).not.toBeNull();
    expect(el.querySelector('.board-empty')).toBeNull();
    // Six anatomical slots: 1 circle (helmet) + 6 rects (torso/arms×2/legs×2/backpack) + undersuit path.
    expect(el.querySelectorAll('.doll-slot').length).toBe(7);
  });

  it('shows the flagship identity (manufacturer · name) and mount-derived KPIs, never crew/cargo/mass/speed', async () => {
    const gladius = shipRow({
      classNameSlug: 'AEGS_Gladius',
      payload: {
        itemPorts: [
          { portName: 'hp1', minSize: 2, maxSize: 2, types: ['WeaponGun'], flags: [] },
        ],
        defaultLoadout: [{ itemPortName: 'hp1', entityClassName: null }],
      } as unknown as ShipPayload,
    });
    const fixture = await setup({
      hangar: [hangarShip('AEGS_Gladius')],
      byClassName: new Map([['AEGS_Gladius', gladius]]),
      flagship: 'AEGS_Gladius',
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.identity-mfr')?.textContent).toContain('AEGS');
    const link = el.querySelector<HTMLAnchorElement>('a.identity-name');
    expect(link?.getAttribute('href')).toContain('/codex/ship/AEGS_Gladius');
    const kpiText = el.querySelector('.kpi-row')?.textContent ?? '';
    expect(kpiText).not.toMatch(/crew/i);
    expect(kpiText).not.toMatch(/cargo/i);
    expect(kpiText).not.toMatch(/\bspeed\b/i);
  });

  it('keeps the flagship-led fleet field: other owned ships render as thumbs with inline patch deltas', async () => {
    const gladius = shipRow({ classNameSlug: 'AEGS_Gladius' });
    const arrow = shipRow({ classNameSlug: 'ANVL_Arrow' });
    const deltas = new Map<string, ShipStatDelta[]>([
      [
        'AEGS_Gladius',
        [{ labelKey: 'codex.landing.diff.scm', from: 200, to: 250, delta: 50, direction: 'up', unit: 'm/s' }],
      ],
    ]);
    const fixture = await setup({
      hangar: [hangarShip('AEGS_Gladius'), hangarShip('ANVL_Arrow')],
      byClassName: new Map([
        ['AEGS_Gladius', gladius],
        ['ANVL_Arrow', arrow],
      ]),
      flagship: 'AEGS_Gladius',
      deltas,
    });
    const el: HTMLElement = fixture.nativeElement;
    const delta = el.querySelector('.delta.dir-up .delta-val');
    expect(delta?.textContent).toContain('+50');
    const other = el.querySelector<HTMLAnchorElement>('.fleet-others a.fleet-thumb');
    expect(other?.getAttribute('href')).toContain('/codex/ship/ANVL_Arrow');
    expect(el.querySelector('.compare-hint')).not.toBeNull();
  });

  it('stages cross-entity search results, scope-tinted, with correct per-kind links', async () => {
    const fixture = await setup({
      searchResults: [hit('ship', 'AEGS_Gladius'), hit('manufacturer', 'AEGS'), hit('blueprint', 'BP_Foo')],
    });
    const cmp = fixture.componentInstance;
    cmp.searchTerm.set('a');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.results')).not.toBeNull();
    const hits = el.querySelectorAll('a.hit');
    expect(hits.length).toBe(3);
    expect(el.querySelectorAll('a.hit.meta').length).toBe(2);
    const bp = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.hit')).find((a) =>
      a.getAttribute('href')?.includes('BP_Foo'),
    );
    expect(bp?.getAttribute('href')).toContain('/codex/blueprint/BP_Foo');
    // Pin buttons render an SVG glyph, never the old ☆/★ text characters.
    expect(el.querySelector('a.hit .pin svg')).not.toBeNull();
  });

  it('renders the IM VERSUM domain tiles as real anchors carrying the live entity counts', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    const tiles = Array.from(el.querySelectorAll<HTMLAnchorElement>('.domain-tile'));
    expect(tiles.length).toBe(7);
    const shipTile = tiles.find((a) => a.getAttribute('href')?.includes('kind=ship'));
    expect(shipTile?.querySelector('.domain-count')?.textContent?.trim()).toBe('353');
    const bpTile = tiles.find((a) => a.getAttribute('href') === '/codex/blueprint');
    expect(bpTile).toBeTruthy();
    // Keybinds, Showroom and Kommende Schiffe stay reachable.
    const railHrefs = Array.from(el.querySelectorAll<HTMLAnchorElement>('.versum-rail a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(railHrefs.some((h) => h?.includes('/codex/showroom'))).toBeTrue();
    expect(railHrefs.some((h) => h?.includes('/codex/upcoming'))).toBeTrue();
    expect(railHrefs.some((h) => h?.includes('/codex/keybinds'))).toBeTrue();
  });

  it('shows only the live dot + Verse-online text in the status pill; patch/build move behind the details disclosure', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.status-pill .live-dot')).not.toBeNull();
    expect(el.querySelector('.status-pill .status-build')).toBeNull();
    const badge = el.querySelector<HTMLDetailsElement>('details.patch-badge');
    expect(badge).not.toBeNull();
    expect(badge?.hasAttribute('open')).toBeFalse();
    expect(fixture.componentInstance.svc.build()?.patchVersion).toBe('4.2');
  });

  it('never renders the removed Zyklus-Report line', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.cycle-report')).toBeNull();
  });
});
