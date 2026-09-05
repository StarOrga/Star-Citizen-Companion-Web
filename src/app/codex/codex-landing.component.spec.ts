import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
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
import { NewsService, VerseFeed } from '../news/news.service';

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
    manufacturerName: null,
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
      // The merged status/patch headline (sc-codex-patch-headline) rides in the
      // terminal row, so the landing's CodexService double has to answer its
      // patch-switch surface too. Nothing here is exercised by the landing's own
      // assertions — the switch has its own spec.
      liveBuild: signal(null) as never,
      viewingPastPatch: signal(false) as never,
      patchTimeline: signal([]) as never,
      loadPatchTimeline: jasmine.createSpy('loadPatchTimeline').and.resolveTo([]),
      selectBuild: jasmine.createSpy('selectBuild').and.returnValue(false),
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
        // The landing itself no longer reads playability, but sibling pieces of
        // the shell do — stubbed so no test reaches the real HTTP client.
        {
          provide: NewsService,
          useValue: {
            feed: signal<VerseFeed | null>(null),
            // The patch switch reads the published patch lines from here.
            patchLines: signal([]),
            refresh: jasmine.createSpy('refresh').and.resolveTo(undefined),
          },
        },
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

  /**
   * The surface is a switcher since feedback e80cc831 — IM HANGAR is expanded
   * on load, so every AN BORD assertion has to flip it first. Clicking the rail
   * rather than setting the signal, so the button stays part of the contract.
   */
  function openBoard(fixture: ComponentFixture<CodexLandingComponent>): void {
    const rail = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button.zone-rail.board',
    );
    expect(rail).not.toBeNull();
    rail!.click();
    fixture.detectChanges();
  }

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
    openBoard(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.board-empty')).not.toBeNull();
    expect(el.querySelector('.board-person')).toBeNull();
    const cta = el.querySelector<HTMLAnchorElement>('.board-empty a.btn');
    expect(cta?.getAttribute('href')).toContain('/codex/fps');
  });

  it('renders the figure with SIX individually clickable positions once a personal loadout exists', async () => {
    const fixture = await setup({ hangar: [], roleLoadouts: [fpsLoadout('set1', 'Boarding Kit')] });
    openBoard(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.board-person svg.board-doll')).not.toBeNull();
    expect(el.querySelector('.board-empty')).toBeNull();
    // The whole point of the 2026-09-01 rethink: the zone stopped being one
    // stretched link over a display case. Six anatomical positions, each a REAL
    // anchor, so middle-click / "open in new tab" work.
    const slots = el.querySelectorAll<HTMLAnchorElement>('a.board-slot');
    expect(slots.length).toBe(6);
    for (const a of Array.from(slots)) expect(a.getAttribute('href')).toContain('/codex/fps');
  });

  it('carries the equip intent in the slot URL, so equip controls cannot leak into ordinary browsing', async () => {
    const fixture = await setup({ hangar: [], roleLoadouts: [fpsLoadout('set1', 'Boarding Kit')] });
    openBoard(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const href = el.querySelector<HTMLAnchorElement>('a.board-slot')?.getAttribute('href') ?? '';
    expect(href).toContain('cat=armor');
    expect(href).toContain('slot=');
    expect(href).toContain('equipInto=set1');
  });

  it('never renders a numeric armour value — the archive carries none', async () => {
    const fixture = await setup({ hangar: [], roleLoadouts: [fpsLoadout('set1', 'Boarding Kit')] });
    openBoard(fixture);
    const el: HTMLElement = fixture.nativeElement;
    // Six squares, class encoded as bar HEIGHT (concept iteration 6, variant Ⓣ).
    expect(el.querySelectorAll('a.board-sq').length).toBe(6);
    // The two stale gap markers are gone with the KPI row they lived in.
    expect(el.querySelector('.kpi-row')).toBeNull();
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
    // The ship KPI card row is gone (and since 2026-09-01 so is the on-foot one).
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

  it('spells the manufacturer out on an archive-terminal search hit too', async () => {
    const fixture = await setup({
      searchResults: [
        {
          ...hit('ship', 'AEGS_Gladius'),
          manufacturerCode: 'AEG',
          manufacturerName: { de: 'Aegis Dynamics', en: 'Aegis Dynamics', key: '@manufacturer_NameAEGS' },
        },
      ],
    });
    fixture.componentInstance.searchTerm.set('gla');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('a.hit .hit-mfr')?.textContent?.trim()).toBe('Aegis Dynamics');
  });

  // Feedback cdc69f53: the landing abbreviated every maker to its 3-4 letter
  // code ("AEG", "DRAK") while the detail page already spelled it out. The full
  // name is extracted game data on the row payload, so the landing reads it too.
  it('spells the manufacturer out on the hero, the fleet tiles and the group heading', async () => {
    const mfr = (code: string, en: string) => ({
      manufacturer: { code, className: code, name: { de: en, en, key: `@manufacturer_Name${code}` } },
    });
    const gladius = shipRow({
      classNameSlug: 'AEGS_Gladius',
      manufacturerCode: 'AEG',
      payload: mfr('AEGS', 'Aegis Dynamics') as never,
    });
    const cutlass = shipRow({
      classNameSlug: 'DRAK_Cutlass_Black',
      manufacturerCode: 'DRAK',
      payload: mfr('DRAK', 'Drake Interplanetary') as never,
    });
    const fixture = await setup({
      hangar: [hangarShip('AEGS_Gladius'), hangarShip('DRAK_Cutlass_Black')],
      byClassName: new Map([
        ['AEGS_Gladius', gladius],
        ['DRAK_Cutlass_Black', cutlass],
      ]),
      flagship: 'AEGS_Gladius',
    });
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.ship-hero .hero-scrim .identity-mfr')?.textContent).toContain(
      'Aegis Dynamics',
    );
    const tileMfrs = Array.from(el.querySelectorAll('.fleet-tile__mfr')).map((n) =>
      n.textContent?.trim(),
    );
    expect(tileMfrs).toContain('Aegis Dynamics');
    expect(tileMfrs).toContain('Drake Interplanetary');
    expect(tileMfrs.some((t) => t === 'AEG' || t === 'DRAK')).toBeFalse();
    // The default axis is `recent` (ungrouped) since feedback e80cc831 — the
    // headings only exist once you group, and they read the same way.
    fixture.componentInstance.fleetSort.set('manufacturer');
    fixture.detectChanges();
    const groups = Array.from(el.querySelectorAll('.fleet-group')).map((n) => n.textContent?.trim());
    expect(groups).toContain('Aegis Dynamics');
    expect(groups).toContain('Drake Interplanetary');
  });

  it('keeps the bare manufacturer code when the extract has no name for it', async () => {
    const row = shipRow({ classNameSlug: 'AEGS_Gladius', manufacturerCode: 'AEG', payload: {} });
    const fixture = await setup({
      hangar: [hangarShip('AEGS_Gladius')],
      byClassName: new Map([['AEGS_Gladius', row]]),
      flagship: 'AEGS_Gladius',
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.fleet-tile__mfr')?.textContent?.trim()).toBe('AEG');
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

  // The "Im Versum" band is retired (concept docs/concepts/2026-09-02-codex-im-verse.html,
  // decision Ⓔ): each zone now ends with its OWN quiet quick-access line into
  // the full archive instead of a third plane below the surface.
  it('renders the page without the retired "Im Versum" band', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.versum')).toBeNull();
    expect(el.querySelector('.domain-strip')).toBeNull();
    expect(el.querySelector('.upcoming-rail')).toBeNull();
    const allHrefs = Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).map((a) => a.getAttribute('href'));
    expect(allHrefs.some((h) => h?.includes('/codex/showroom'))).toBeFalse();
  });

  it('keybindings sit in the terminal row now, not in a band of their own', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    const keybinds = el.querySelector<HTMLAnchorElement>('header.terminal a.terminal-tool');
    expect(keybinds?.getAttribute('href')).toBe('/codex/keybinds');
  });

  it('IM HANGAR ends with an archive quick-access line, real anchors, honest counts, even with an empty hangar', async () => {
    const fixture = await setup({ hangar: [], entityCounts: { ships: 353, components: 2172 } });
    const el: HTMLElement = fixture.nativeElement;

    const nav = el.querySelector<HTMLElement>('.zone.hangar nav.zone-archive');
    expect(nav).not.toBeNull();
    const links = Array.from(nav!.querySelectorAll<HTMLAnchorElement>('a'));
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/codex/index?kind=ship');
    expect(hrefs).toContain('/codex/index?kind=component');
    expect(hrefs).toContain('/codex/index?kind=weapon&weaponClass=Ship');
    expect(hrefs).toContain('/codex/index?kind=blueprint&group=vehicle');

    const shipLink = links.find((a) => a.getAttribute('href') === '/codex/index?kind=ship');
    expect(shipLink?.querySelector('.zone-archive__count')?.textContent?.trim()).toBe('353');
    const componentLink = links.find((a) => a.getAttribute('href') === '/codex/index?kind=component');
    expect(componentLink?.querySelector('.zone-archive__count')?.textContent?.trim()).toBe('2,172');
    // Weapons/Baupläne totals would be misleading once split FPS vs ship —
    // never invent a number for them.
    const weaponLink = links.find((a) => a.getAttribute('href') === '/codex/index?kind=weapon&weaponClass=Ship');
    expect(weaponLink?.querySelector('.zone-archive__count')).toBeNull();
  });

  it('AN BORD ends with an archive quick-access line into the FPS categories', async () => {
    const fixture = await setup({ hangar: [] });
    openBoard(fixture);
    const el: HTMLElement = fixture.nativeElement;

    const nav = el.querySelector<HTMLElement>('.zone.board nav.zone-archive');
    expect(nav).not.toBeNull();
    const hrefs = Array.from(nav!.querySelectorAll<HTMLAnchorElement>('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/codex/fps?cat=armor');
    expect(hrefs).toContain('/codex/fps?cat=weapon');
    expect(hrefs).toContain('/codex/index?kind=blueprint&group=fps');
  });

  it('AN BORD and IM HANGAR zones are each a real routerLink entrance into their subview', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;

    // IM HANGAR is the expanded half on load — this is the fleet page.
    const hangarEntry = el.querySelector<HTMLAnchorElement>('.zone.hangar a.zone-entry');
    expect(hangarEntry?.getAttribute('href')).toBe('/hangar');

    // AN BORD lost its stretched zone-wide link in the 2026-09-01 rethink — it
    // was what made every anatomical position unclickable. The entrance now
    // lives on the set name, and the positions carry their own links.
    openBoard(fixture);
    const boardEntry = el.querySelector<HTMLAnchorElement>('.zone.board a.board-name');
    expect(boardEntry?.getAttribute('href')).toBe('/codex/fps');
  });

  // Feedback e80cc831: the two zones used to grow vertically against each other.
  // They are ONE toggle now — never both open, never both shut.
  it('AN BORD and IM HANGAR are a mutually exclusive switcher, the collapsed one a rail', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelectorAll('.surface > .zone').length).toBe(1);
    expect(el.querySelectorAll('.surface button.zone-rail').length).toBe(1);
    expect(el.querySelector('.surface.open-hangar')).not.toBeNull();
    expect(el.querySelector('.zone.hangar')).not.toBeNull();
    expect(el.querySelector('.zone.board')).toBeNull();
    // The rail names the zone it opens and says what is in it.
    const rail = el.querySelector<HTMLButtonElement>('button.zone-rail.board');
    expect(rail?.getAttribute('aria-expanded')).toBe('false');
    expect(rail?.getAttribute('aria-controls')).toBe('zone-board');

    openBoard(fixture);
    expect(el.querySelector('.surface.open-board')).not.toBeNull();
    expect(el.querySelector('.zone.board')).not.toBeNull();
    expect(el.querySelector('.zone.hangar')).toBeNull();
    expect(el.querySelectorAll('.surface > .zone').length).toBe(1);
    expect(el.querySelector('button.zone-rail.hangar')).not.toBeNull();
  });

  // Feedback 77668f11 round three: "wenn ich ship im hangar aufrufe, dann sehe
  // ich fuer zu fuss an board immer noch nicht die person als spalte sondern nur
  // die textleiste." The admin's own set ("FixIt") has NO items — which used to
  // withhold the figure. It no longer does: the figure is the character, not the
  // set, so the collapsed AN BORD rail carries it in every state.
  it('shows the AN BORD figure on the collapsed rail even with an empty set', async () => {
    const fixture = await setup({
      hangar: [],
      roleLoadouts: [fpsLoadout('set1', 'FixIt')],
    });
    const el: HTMLElement = fixture.nativeElement;

    const rail = el.querySelector('button.zone-rail.board');
    expect(rail).not.toBeNull();
    expect(rail!.classList).toContain('has-hero');
    expect(rail!.querySelector('.rail-hero sc-codex-board-figure')).not.toBeNull();
    // Still no words beyond the zone label — the hero replaces the summary.
    expect(rail!.querySelector('.rail-sub')).toBeNull();
    // ...and the surface gives the rail its extra width.
    expect(el.querySelector('.surface.hero-rail')).not.toBeNull();
  });

  // Feedback e80cc831: "dann kann man aber auch irgendwie den einsatzzweck
  // umschalten, in dem fall brauche ich die schiffs hero card nicht mehr sehen".
  it('drops the flagship hero when the fleet lane is grouped, and gets it back in the default mode', async () => {
    const gladius = shipRow({ classNameSlug: 'AEGS_Gladius' });
    const fixture = await setup({
      hangar: [hangarShip('AEGS_Gladius')],
      byClassName: new Map([['AEGS_Gladius', gladius]]),
      flagship: 'AEGS_Gladius',
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(fixture.componentInstance.fleetSort()).toBe('recent');
    expect(el.querySelector('.ship-hero')).not.toBeNull();
    expect(el.querySelector('.fleet-lane.browse')).toBeNull();

    // No translation loader in the TestBed, so the buttons render their keys —
    // pick by axis order instead of by label. `role` is the Einsatzzweck axis.
    expect(fixture.componentInstance.fleetSortAxes[1]).toBe('role');
    const sortBtns = Array.from(el.querySelectorAll<HTMLButtonElement>('.fleet-sort__btn'));
    sortBtns[1].click();
    fixture.detectChanges();
    expect(el.querySelector('.ship-hero')).toBeNull();
    // The freed height goes to the groups, which wrap instead of scrolling away.
    expect(el.querySelector('.fleet-lane.browse')).not.toBeNull();
    expect(el.querySelectorAll('.fleet-strip a.fleet-tile').length).toBe(1);

    Array.from(el.querySelectorAll<HTMLButtonElement>('.fleet-sort__btn'))[0].click();
    fixture.detectChanges();
    expect(el.querySelector('.ship-hero')).not.toBeNull();
  });

  // Admin feedback 34505d70 ("2A"): the standalone /hangar/loadout/:id editor is
  // gone, so the zone entrance no longer leaves the Codex. It opens the on-foot
  // archive with the ACTIVE set as the equip target — the surface that replaced
  // the editor.
  it('AN BORD zone entrance opens the on-foot archive with the active set as the equip target', async () => {
    const fixture = await setup({
      hangar: [],
      roleLoadouts: [fpsLoadout('fps-set-1', 'Boarding Kit')],
    });
    openBoard(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const boardEntry = el.querySelector<HTMLAnchorElement>('.zone.board a.board-name');
    expect(boardEntry?.getAttribute('href')).toBe('/codex/fps?equipInto=fps-set-1');
  });

  it('has no link left into the retired hangar loadout editor', async () => {
    const fixture = await setup({
      hangar: [],
      roleLoadouts: [fpsLoadout('set1', 'Boarding Kit'), fpsLoadout('set2', 'Salvage Kit')],
    });
    openBoard(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('/hangar/loadout'))).toBeFalse();
  });

  it('switches the shown set through the URL, so a set is bookmarkable and middle-clickable', async () => {
    const fixture = await setup({
      hangar: [],
      roleLoadouts: [fpsLoadout('set1', 'Boarding Kit'), fpsLoadout('set2', 'Salvage Kit')],
    });
    openBoard(fixture);
    const el: HTMLElement = fixture.nativeElement;

    // The switcher navigates to the landing itself with ?zone=board&set=<id>.
    const dial = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.dial-node'));
    expect(dial.length).toBe(2);
    expect(dial[1].getAttribute('href')).toBe('/codex?zone=board&set=set2');

    // …and the landing reads that back: the named set leads, which is what
    // every downstream read (paperdoll, plinth, entrance link) uses.
    const router = TestBed.inject(Router);
    await router.navigate([], { queryParams: { zone: 'board', set: 'set2' } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.activeLoadout()?.id).toBe('set2');
    expect(fixture.componentInstance.openZone()).toBe('board');
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

  it('carries the patch headline in the terminal row, without repeating the playable state', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    const headline = el.querySelector('sc-codex-patch-headline');
    expect(headline).not.toBeNull();
    expect(headline?.closest('.terminal')).not.toBeNull();
    // The header chip says "Spielbar" app-wide; the landing no longer echoes it.
    expect(el.querySelector('.status-pill .live-dot')).toBeNull();
    expect(el.querySelector('.status-pill .status-online')).toBeNull();
    expect(el.querySelector('.status-pill .status-build')).toBeNull();
    // The far right of the terminal row belongs to the download control now.
    expect(el.querySelector('details.patch-badge')).toBeNull();
    // The patch label is the switch trigger, not a dead chip (463872dd).
    const patch = el.querySelector<HTMLButtonElement>('.status-pill .status-patch');
    expect(patch?.tagName.toLowerCase()).toBe('button');
    expect(patch?.getAttribute('aria-haspopup')).toBe('listbox');
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
