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
import { Role, RoleService } from '../auth/role.service';
import { UpcomingShip, UpcomingShipsFeed, UpcomingShipsService } from './upcoming-ships.service';
import { ShipPayload } from './codex.types';

function upcomingShip(over: Partial<UpcomingShip> & { id: string; name: string }): UpcomingShip {
  return {
    manufacturer: null,
    manufacturerCode: null,
    productionStatus: 'in-concept',
    type: null,
    focus: null,
    rsiUrl: `https://robertsspaceindustries.com/pledge/ships/${over.id}`,
    thumbnail: null,
    flightReadyButMissing: false,
    ...over,
  };
}

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
    upcomingShips?: UpcomingShip[];
    upcomingNotificationCount?: number;
    /** Effective role — drives the Data-Uploader download control in the terminal row. */
    role?: Role | null;
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
      realUser: signal(opts.user === undefined ? { id: 'u1' } : opts.user) as never,
    };

    // The terminal row hosts `sc-app-download-menu`, which reads the effective
    // role. Stubbed so no test ever reaches the real profile lookup.
    const role = signal<Role | null>(opts.role ?? null);
    const roles: Partial<RoleService> = {
      role: role as never,
      realRole: role as never,
      loaded: signal(true) as never,
      isAdmin: signal(opts.role === 'admin') as never,
      isCollaborator: signal(opts.role === 'admin' || opts.role === 'collaborator') as never,
    };

    await TestBed.configureTestingModule({
      imports: [CodexLandingComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: codex },
        { provide: HangarService, useValue: hangar },
        { provide: AuthService, useValue: auth },
        { provide: RoleService, useValue: roles },
        {
          provide: UpcomingShipsService,
          useValue: {
            ensureLoaded: jasmine.createSpy('ensureLoaded').and.resolveTo(undefined),
            artFor: () => [] as string[],
            feed: signal<UpcomingShipsFeed | null>(
              opts.upcomingShips
                ? { ships: opts.upcomingShips, counts: null, fetchedAt: '' }
                : null,
            ),
            notificationCount: signal(opts.upcomingNotificationCount ?? 0),
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
    // The empty bay is drawn, not greyed out — a missing scene turns the state
    // back into the blank card the redesign replaced.
    expect(el.querySelector('.hangar-empty svg.bay-scene')).not.toBeNull();
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

  it('shows the flagship on a cinematic hero — identity and mount-derived KPIs ON the art, never crew/cargo/mass/speed', async () => {
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
    expect(el.querySelector('.ship-hero')).not.toBeNull();
    // Identity and KPIs live INSIDE the hero frame, on its scrim — not in a
    // card row underneath it (feedback 2026-08-23).
    expect(el.querySelector('.ship-hero .hero-scrim .identity-mfr')?.textContent).toContain('AEGS');
    const link = el.querySelector<HTMLAnchorElement>('.ship-hero a.identity-name');
    expect(link?.getAttribute('href')).toContain('/codex/ship/AEGS_Gladius');
    // The ship KPI card row is gone; the on-foot zone keeps its own .kpi-row.
    expect(el.querySelector('.ship-hero .kpi-row')).toBeNull();
    const kpiText = el.querySelector('.ship-hero .hero-kpis')?.textContent ?? '';
    expect(kpiText).not.toMatch(/crew/i);
    expect(kpiText).not.toMatch(/cargo/i);
    expect(kpiText).not.toMatch(/\bspeed\b/i);
  });

  it('renders the whole fleet as art tiles with a sort bar, the flagship starred, deltas inline', async () => {
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
    const tiles = Array.from(el.querySelectorAll<HTMLAnchorElement>('.fleet-strip a.fleet-tile'));
    // The flagship is part of the strip (starred), not excluded from it —
    // grouping by manufacturer/role only reads right with every owned hull in.
    expect(tiles.length).toBe(2);
    const hrefs = tiles.map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => h?.includes('/codex/ship/ANVL_Arrow'))).toBeTrue();
    expect(hrefs.some((h) => h?.includes('/codex/ship/AEGS_Gladius'))).toBeTrue();
    expect(el.querySelector('.fleet-tile.flag .fleet-tile__badge.flag')).not.toBeNull();
    // Three grouping axes, exactly one active.
    const sortBtns = Array.from(el.querySelectorAll<HTMLButtonElement>('.fleet-sort__btn'));
    expect(sortBtns.length).toBe(3);
    expect(sortBtns.filter((b) => b.classList.contains('on')).length).toBe(1);
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

  it('renders the IM VERSUM domain chips as real anchors that all land on the same subview with the facet preselected', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    const chips = Array.from(el.querySelectorAll<HTMLAnchorElement>('.domain-strip a.domain-chip'));
    expect(chips.length).toBe(7);
    const shipChip = chips.find((a) => a.getAttribute('href')?.includes('kind=ship'));
    expect(shipChip?.querySelector('.domain-count')?.textContent?.trim()).toBe('353');
    // Every domain lands on the SAME subview with its facet preselected —
    // Baupläne used to jump to the separate /codex/blueprint page.
    expect(chips.every((a) => a.getAttribute('href')?.startsWith('/codex/index?kind='))).toBeTrue();
    expect(chips.some((a) => a.getAttribute('href')?.includes('kind=blueprint'))).toBeTrue();
    // The keybindings entry sits on the "Im Versum" heading line now, not in a
    // rail of its own below the page. The Showroom is gone entirely.
    const headHrefs = Array.from(el.querySelectorAll<HTMLAnchorElement>('.versum-head a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(headHrefs.some((h) => h?.includes('/codex/keybinds'))).toBeTrue();
    expect(el.querySelector('.versum-rail')).toBeNull();
    const allHrefs = Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).map((a) => a.getAttribute('href'));
    expect(allHrefs.some((h) => h?.includes('/codex/showroom'))).toBeFalse();
    expect(allHrefs.some((h) => h?.includes('/codex/upcoming'))).toBeFalse();
  });

  it('AN BORD and IM HANGAR zones are each a real routerLink entrance into their subview', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;

    const boardEntry = el.querySelector<HTMLAnchorElement>('.zone.board a.zone-entry');
    expect(boardEntry?.getAttribute('href')).toBe('/codex/fps');

    const hangarEntry = el.querySelector<HTMLAnchorElement>('.zone.hangar a.zone-entry');
    expect(hangarEntry?.getAttribute('href')).toBe('/hangar');
  });

  it('AN BORD zone entrance prefers an existing FPS role loadout over the bare /codex/fps fallback', async () => {
    const fixture = await setup({
      hangar: [],
      roleLoadouts: [fpsLoadout('fps-set-1', 'Boarding Kit')],
    });
    const el: HTMLElement = fixture.nativeElement;
    const boardEntry = el.querySelector<HTMLAnchorElement>('.zone.board a.zone-entry');
    expect(boardEntry?.getAttribute('href')).toBe('/hangar/loadout/fps-set-1');
  });

  it('zone entrances do not swallow their nested interactive children (no nested anchors, controls stay reachable)', async () => {
    const gladius = shipRow({ classNameSlug: 'AEGS_Gladius' });
    const fixture = await setup({
      hangar: [hangarShip('AEGS_Gladius')],
      byClassName: new Map([['AEGS_Gladius', gladius]]),
      flagship: 'AEGS_Gladius',
    });
    const el: HTMLElement = fixture.nativeElement;

    // The stretched entrance <a> must not contain another <a> (invalid HTML).
    const hangarEntry = el.querySelector('.zone.hangar a.zone-entry');
    expect(hangarEntry?.querySelector('a')).toBeNull();

    // The ship identity link and pin button, siblings of the entrance link,
    // still resolve to their own targets.
    const identityLink = el.querySelector<HTMLAnchorElement>('a.identity-name');
    expect(identityLink?.getAttribute('href')).toContain('/codex/ship/AEGS_Gladius');
    expect(el.querySelector('.identity .pin')).not.toBeNull();
  });

  it('renders the concept-ship rail inside Im Versum once the RSI feed has ships, each tile a real anchor carrying name + manufacturer over its art', async () => {
    const fixture = await setup({
      hangar: [],
      upcomingShips: [
        upcomingShip({ id: 'polaris', name: 'RSI Polaris', manufacturerCode: 'RSI' }),
        upcomingShip({ id: 'idris-m', name: 'Aegis Idris-M', manufacturerCode: 'AEGS' }),
      ],
      upcomingNotificationCount: 2,
    });
    const el: HTMLElement = fixture.nativeElement;

    const rail = el.querySelector('.upcoming-rail');
    expect(rail).not.toBeNull();
    const tiles = Array.from(el.querySelectorAll<HTMLAnchorElement>('.upcoming-tile'));
    expect(tiles.length).toBe(2);
    expect(tiles[0].getAttribute('href')).toBe('https://robertsspaceindustries.com/pledge/ships/polaris');
    expect(tiles[0].getAttribute('target')).toBe('_blank');
    expect(tiles[0].getAttribute('rel')).toBe('noopener noreferrer');
    // The tile IS the artwork: name + manufacturer ride a caption scrim on top
    // of it rather than sitting in a separate text block under a boxed thumb.
    expect(tiles[0].querySelector('.upcoming-tile__caption .upcoming-tile__name')?.textContent?.trim()).toBe(
      'RSI Polaris',
    );
    expect(tiles[0].querySelector('.upcoming-tile__caption .upcoming-tile__mfr')?.textContent?.trim()).toBe('RSI');
    expect(el.querySelector('.upcoming-rail__badge')?.textContent?.trim()).toBe('2');
  });

  it('renders no upcoming-ships rail while the RSI feed is empty/unloaded (no rail placeholder)', async () => {
    const fixture = await setup({ hangar: [], upcomingShips: [] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.upcoming-rail')).toBeNull();
  });

  it('keeps the upcoming-ships rail scroll contained to its own overflow-x container', async () => {
    const fixture = await setup({
      hangar: [],
      upcomingShips: [upcomingShip({ id: 'polaris', name: 'RSI Polaris' })],
    });
    const el: HTMLElement = fixture.nativeElement;
    const scroller = el.querySelector('.upcoming-rail__scroll');
    expect(scroller).not.toBeNull();
    expect(scroller?.closest('.upcoming-rail')).not.toBeNull();
  });

  it('retires the patch disclosure and carries the patch label in the status pill instead', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.status-pill .live-dot')).not.toBeNull();
    expect(el.querySelector('.status-pill .status-build')).toBeNull();
    // The far right of the terminal row belongs to the download control now.
    expect(el.querySelector('details.patch-badge')).toBeNull();
    expect(el.querySelector('.status-pill .status-patch')).not.toBeNull();
    expect(fixture.componentInstance.svc.build()?.patchVersion).toBe('4.2');
  });

  it('gives an admin the Data-Uploader download control at the far right of the terminal row', async () => {
    const fixture = await setup({ hangar: [], role: 'admin' });
    const el: HTMLElement = fixture.nativeElement;
    const trigger = el.querySelector<HTMLButtonElement>('sc-app-download-menu .dlm-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog');
    // Last element in the row — the Verse-online pill sits to its left.
    const row = el.querySelector('.terminal');
    expect(row?.lastElementChild?.tagName.toLowerCase()).toBe('sc-app-download-menu');
    expect(el.querySelector('.dlm-pop')).toBeNull();
  });

  it('gives a collaborator the same control', async () => {
    const fixture = await setup({ hangar: [], role: 'collaborator' });
    expect(fixture.nativeElement.querySelector('.dlm-trigger')).not.toBeNull();
  });

  it('renders NO uploader control for a viewer or an anonymous visitor', async () => {
    for (const role of ['viewer', null] as const) {
      const fixture = await setup({ hangar: [], role });
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.dlm-trigger')).withContext(String(role)).toBeNull();
      expect(el.querySelector('.status-pill')).not.toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('never renders the removed Zyklus-Report line', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.cycle-report')).toBeNull();
  });
});
