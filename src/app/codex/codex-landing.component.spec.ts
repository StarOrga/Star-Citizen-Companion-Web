import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexLandingComponent, gridColumns } from './codex-landing.component';
import { CodexListRow, CodexService, ResolvedEntity } from './codex.service';
import { PolySearchHit, scopeForKind } from './codex-poly-search';
import { ShipStatDelta } from './codex-build-diff';
import { HangarService } from '../hangar/hangar.service';
import { HangarRoleLoadout, HangarShip, HangarShipConfig } from '../hangar/hangar.types';
import { AuthService } from '../auth/auth.service';
import { Role, RoleService } from '../auth/role.service';
import { UpcomingShip, UpcomingShipsFeed, UpcomingShipsService } from './upcoming-ships.service';
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

function hangarShip(className: string, id = className, updatedAt = ''): HangarShip {
  return {
    id,
    shipClassName: className,
    customName: null,
    status: 'owned',
    pinnedRank: null,
    selectedSkinId: null,
    notes: null,
    createdAt: '',
    updatedAt,
  };
}

function fpsLoadout(id: string, name: string, role: HangarRoleLoadout['role'] = 'fps'): HangarRoleLoadout {
  return { id, name, role, items: [], createdAt: '', updatedAt: '2026-08-10T00:00:00Z' };
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
      buildRefresh: signal(0) as never,
      liveMovedNotice: signal<string | null>(null) as never,
      patchTimeline: signal([]) as never,
      patchTimelineError: signal<string | null>(null) as never,
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

    // HangarPicker's data source (M1/M6): a minimal stand-in for the real
    // localStorage-backed "recently chosen" lists — top 3, falls back to the
    // first 3 when nothing was picked, `mark*Picked` moves an id to the front.
    const shipsSig = signal<HangarShip[]>(opts.hangar ?? []);
    const loadoutsSig = signal<HangarRoleLoadout[]>(opts.roleLoadouts ?? []);
    const recentShipIds = signal<string[]>([]);
    const recentSetIds = signal<string[]>([]);
    const recentShips = computed(() => {
      const byClass = new Map(shipsSig().map((s) => [s.shipClassName, s]));
      const picked = recentShipIds().map((c) => byClass.get(c)).filter((s): s is HangarShip => !!s);
      return (picked.length > 0 ? picked : shipsSig().slice(0, 3)).slice(0, 3);
    });
    const recentSets = computed(() => {
      const byId = new Map(loadoutsSig().map((l) => [l.id, l]));
      const picked = recentSetIds().map((id) => byId.get(id)).filter((l): l is HangarRoleLoadout => !!l);
      return (picked.length > 0 ? picked : loadoutsSig().slice(0, 3)).slice(0, 3);
    });

    const hangar: Partial<HangarService> = {
      ships: shipsSig as never,
      roleLoadouts: loadoutsSig as never,
      flagshipClassName: signal<string | null>(opts.flagship ?? null) as never,
      loadAll: jasmine.createSpy('loadAll').and.resolveTo(undefined),
      shipByClassName: (className: string) => (opts.hangar ?? []).find((s) => s.shipClassName === className) ?? null,
      listConfigs: jasmine.createSpy('listConfigs').and.resolveTo(opts.shipConfigs ?? []),
      recentShips: recentShips as never,
      recentSets: recentSets as never,
      markShipPicked: (id: string) => recentShipIds.set([id, ...recentShipIds().filter((c) => c !== id)]),
      markSetPicked: (id: string) => recentSetIds.set([id, ...recentSetIds().filter((c) => c !== id)]),
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
            stageArtFor: () => ({ src: '', fallbacks: [] as string[] }),
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

  // ── the two stages ──────────────────────────────────────────────────────

  it('renders both stages side by side, ship first, at all times — no switcher left', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    const split = el.querySelector('.stage-split');
    expect(split).not.toBeNull();
    const stages = Array.from(split!.querySelectorAll('sc-codex-stage'));
    expect(stages.length).toBe(2);
    expect(stages[0].classList).toContain('stage-ship');
    expect(stages[1].classList).toContain('stage-person');
  });

  it('the ship stage shows the flagship\'s manufacturer/role/name and is a routerLink anchor into its page', async () => {
    const gladius = shipRow({ classNameSlug: 'AEGS_Gladius', role: 'Fighter' });
    const fixture = await setup({
      hangar: [hangarShip('AEGS_Gladius')],
      byClassName: new Map([['AEGS_Gladius', gladius]]),
      flagship: 'AEGS_Gladius',
    });
    const el: HTMLElement = fixture.nativeElement;
    const anchor = el.querySelector<HTMLAnchorElement>('.stage-ship .stage-hit');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('/codex/ship/AEGS_Gladius');
    expect(anchor?.querySelector('.stage-eyebrow')?.textContent).toContain('AEGS');
    expect(anchor?.querySelector('.stage-title')?.textContent?.trim()).toBe('AEGS_Gladius');
  });

  it('the ship stage falls back honestly when the hangar is empty — text, but no anchor into nothing', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    const hit = el.querySelector('.stage-ship .stage-hit');
    expect(hit).not.toBeNull();
    expect(hit?.tagName.toLowerCase()).toBe('div');
    expect(hit?.hasAttribute('href')).toBeFalse();
  });

  it('the person stage shows the "uncommissioned" fallback and the figure when no personal loadout exists', async () => {
    const fixture = await setup({ hangar: [], roleLoadouts: [] });
    const el: HTMLElement = fixture.nativeElement;
    const stage = el.querySelector('.stage-person')!;
    expect(stage.querySelector('sc-codex-board-figure')).not.toBeNull();
    // No translation loader in the TestBed — the key itself is the rendered text.
    expect(stage.querySelector('.stage-title')?.textContent?.trim()).toBe('codex.landing.me.uncommissioned');
  });

  it('the person stage shows the active set\'s name and role, with the honest equipped fraction (U1)', async () => {
    const fixture = await setup({
      hangar: [],
      roleLoadouts: [fpsLoadout('set1', 'FixIt', 'fps')],
    });
    const el: HTMLElement = fixture.nativeElement;
    const stage = el.querySelector('.stage-person')!;
    expect(stage.querySelector('.stage-title')?.textContent?.trim()).toBe('FixIt');
    // No translation loader in the TestBed, so the key renders — but the
    // honest-fraction key (U1) is what's used, never a bare-percentage one.
    // Armour only — the set page lists weapon positions too, so the count says what it counts.
    expect(fixture.componentInstance.stagePersonEquipSuffix()).toContain('codex.stage.armorEquipped');
    expect(fixture.componentInstance.boardHero().size).toBe(0);
  });

  // ── HangarPicker ─────────────────────────────────────────────────────────

  it('feeds the ship stage picker HangarService.recentShips(), active = the one on stage', async () => {
    const rows = new Map([
      ['A', shipRow({ classNameSlug: 'A' })],
      ['B', shipRow({ classNameSlug: 'B' })],
      ['C', shipRow({ classNameSlug: 'C' })],
      ['D', shipRow({ classNameSlug: 'D' })],
    ]);
    const fixture = await setup({
      hangar: [hangarShip('A'), hangarShip('B'), hangarShip('C'), hangarShip('D')],
      byClassName: rows,
      flagship: 'B',
    });
    const cmp = fixture.componentInstance;
    // Nothing picked yet: HangarService's own fallback is the first 3 owned hulls.
    const items = cmp.shipPickerItems();
    expect(items.map((i) => i.id)).toEqual(['A', 'B', 'C']);
    expect(items.find((i) => i.id === 'B')?.active).toBeTrue();
  });

  it('picking a ship switches the stage subject', async () => {
    const rows = new Map([
      ['A', shipRow({ classNameSlug: 'A' })],
      ['B', shipRow({ classNameSlug: 'B' })],
    ]);
    const fixture = await setup({
      hangar: [hangarShip('A', 'A', '2026-01-02'), hangarShip('B', 'B', '2026-01-01')],
      byClassName: rows,
      flagship: 'A',
    });
    const cmp = fixture.componentInstance;
    expect(cmp.stageShipRow()?.classNameSlug).toBe('A');
    cmp.onShipPick('B');
    fixture.detectChanges();
    expect(cmp.stageShipRow()?.classNameSlug).toBe('B');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.stage-ship .stage-hit')?.getAttribute('href')).toBe('/codex/ship/B');
  });

  it('picking a set switches the person stage subject and re-resolves the figure', async () => {
    const fixture = await setup({
      hangar: [],
      roleLoadouts: [fpsLoadout('set1', 'Boarding Kit'), fpsLoadout('set2', 'Salvage Kit')],
    });
    const cmp = fixture.componentInstance;
    expect(cmp.activeLoadout()?.id).toBe('set1');
    cmp.onSetPick('set2');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(cmp.activeLoadout()?.id).toBe('set2');
    expect(fixture.nativeElement.querySelector('.stage-person .stage-title')?.textContent?.trim()).toBe(
      'Salvage Kit',
    );
  });

  it('has exactly one h1 (AUD-187)', async () => {
    const fixture = await setup({ hangar: [], roleLoadouts: [fpsLoadout('set1', 'Boarding Kit')] });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('h1').length).toBe(1);
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('codex.title');
    expect(root.querySelector('sc-codex-stage[title]')).toBeNull();
  });

  it('opening the picker (no overlay in this round) navigates to /hangar', async () => {
    const fixture = await setup({ hangar: [] });
    const router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl');
    fixture.componentInstance.onHangarOpen();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/hangar');
  });

  it('the picker and the archive line are siblings of the whole-image anchor, never nested inside it', async () => {
    const gladius = shipRow({ classNameSlug: 'AEGS_Gladius' });
    const fixture = await setup({
      hangar: [hangarShip('AEGS_Gladius')],
      byClassName: new Map([['AEGS_Gladius', gladius]]),
      flagship: 'AEGS_Gladius',
    });
    const el: HTMLElement = fixture.nativeElement;
    const anchor = el.querySelector('.stage-ship .stage-hit');
    expect(anchor?.querySelector('sc-hangar-picker')).toBeNull();
    expect(anchor?.querySelector('.archive-line')).toBeNull();
    expect(el.querySelector('.stage-ship sc-hangar-picker')).not.toBeNull();
  });

  // ── archive lines, drawn inside each stage ─────────────────────────────

  it('the ship stage ends with an archive line — real anchors, honest counts', async () => {
    const fixture = await setup({ hangar: [], entityCounts: { ships: 353, components: 2172 } });
    const el: HTMLElement = fixture.nativeElement;
    const nav = el.querySelector<HTMLElement>('.stage-ship .archive-line');
    expect(nav).not.toBeNull();
    const links = Array.from(nav!.querySelectorAll<HTMLAnchorElement>('a'));
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/codex/index?kind=ship');
    expect(hrefs).toContain('/codex/index?kind=component');
    expect(hrefs).toContain('/codex/index?kind=weapon&weaponClass=Ship');

    const shipLink = links.find((a) => a.getAttribute('href') === '/codex/index?kind=ship');
    expect(shipLink?.querySelector('b')?.textContent?.trim()).toBe('353');
    const weaponLink = links.find((a) => a.getAttribute('href') === '/codex/index?kind=weapon&weaponClass=Ship');
    expect(weaponLink?.querySelector('b')).toBeNull();
  });

  it('the person stage ends with an archive line into the FPS categories, no counts', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    const nav = el.querySelector<HTMLElement>('.stage-person .archive-line');
    expect(nav).not.toBeNull();
    const hrefs = Array.from(nav!.querySelectorAll<HTMLAnchorElement>('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/codex/fps?cat=armor');
    expect(hrefs).toContain('/codex/fps?cat=weapon');
    expect(nav!.querySelector('b')).toBeNull();
  });

  it('has no link left into the retired hangar loadout editor', async () => {
    const fixture = await setup({
      hangar: [],
      roleLoadouts: [fpsLoadout('set1', 'Boarding Kit'), fpsLoadout('set2', 'Salvage Kit')],
    });
    const el: HTMLElement = fixture.nativeElement;
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('/hangar/loadout'))).toBeFalse();
  });

  it('switches the shown set through the URL, so a set is bookmarkable and middle-clickable', async () => {
    const fixture = await setup({
      hangar: [],
      roleLoadouts: [fpsLoadout('set1', 'Boarding Kit'), fpsLoadout('set2', 'Salvage Kit')],
    });
    const router = TestBed.inject(Router);
    await router.navigate([], { queryParams: { set: 'set2' } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.activeLoadout()?.id).toBe('set2');
  });

  // ── manufacturer spelling ───────────────────────────────────────────────

  it('spells the manufacturer out on an archive-terminal search hit too', async () => {
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

  it('keeps the compare pin a small icon button, never a card-sized star (audit L01)', async () => {
    const fixture = await setup({ searchResults: [hit('ship', 'AEGS_Gladius')] });
    fixture.componentInstance.searchTerm.set('gladius');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const card = el.querySelector('a.hit') as HTMLElement;
    const pin = el.querySelector('a.hit .pin') as HTMLElement;
    const star = pin.querySelector('svg') as SVGElement;
    expect(pin.getBoundingClientRect().width).toBeLessThanOrEqual(44);
    expect(star.getBoundingClientRect().width).toBeLessThanOrEqual(16.5);
    expect(pin.getBoundingClientRect().width).toBeLessThan(card.getBoundingClientRect().width / 3);
  });

  it('clearing the terminal while a search is in flight leaves no hits behind', async () => {
    let resolve!: (v: unknown[]) => void;
    const fixture = await setup({});
    const svc = TestBed.inject(CodexService) as unknown as { searchAll: jasmine.Spy };
    svc.searchAll.and.returnValue(new Promise((r) => (resolve = r)));
    const cmp = fixture.componentInstance;
    cmp.searchTerm.set('gladius');
    fixture.detectChanges();
    cmp.clearSearch();
    fixture.detectChanges();
    resolve([hit('ship', 'AEGS_Gladius')]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(cmp.searchResults()).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).querySelector('a.hit')).toBeNull();
  });

  // ── archive terminal, driven through the real input ─────────────────────
  describe('archive terminal input', () => {
    function terminal(fixture: ComponentFixture<CodexLandingComponent>): HTMLInputElement {
      return (fixture.nativeElement as HTMLElement).querySelector('input.terminal-input') as HTMLInputElement;
    }

    function type(fixture: ComponentFixture<CodexLandingComponent>, value: string): void {
      const input = terminal(fixture);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    async function settle(fixture: ComponentFixture<CodexLandingComponent>): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    function searchSpy(): jasmine.Spy {
      return (TestBed.inject(CodexService) as unknown as { searchAll: jasmine.Spy }).searchAll;
    }

    // The debounce runs on a mocked clock; the clock comes off again before the
    // fixture settles, so Angular's own scheduling keeps its real timers.
    afterEach(() => {
      try {
        jasmine.clock().uninstall();
      } catch {
        /* already off */
      }
    });

    it('searches only after the debounce and renders the hits as anchors into their pages', async () => {
      const upcoming: PolySearchHit = {
        ...hit('upcoming', 'rsi-arrastra'),
        nameLocalized: 'Arrastra',
      };
      const fixture = await setup({
        searchResults: [hit('ship', 'AEGS_Gladius'), hit('weapon', 'behr_rifle_ballistic_01'), upcoming],
      });
      jasmine.clock().install();
      type(fixture, 'gla');
      jasmine.clock().tick(200);
      expect(searchSpy()).not.toHaveBeenCalled();

      jasmine.clock().tick(60);
      jasmine.clock().uninstall();
      await settle(fixture);

      expect(searchSpy()).toHaveBeenCalledOnceWith('gla', 6);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.results-term')?.textContent).toContain('gla');
      const hrefs = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.hit')).map((a) => a.getAttribute('href'));
      expect(hrefs).toEqual([
        '/codex/ship/AEGS_Gladius',
        '/codex/weapon/behr_rifle_ballistic_01',
        '/codex/upcoming?q=Arrastra',
      ]);
      const soon = el.querySelector('a.hit.upcoming');
      expect(soon?.querySelector('.hit-badge.soon')).not.toBeNull();
      // Nothing to compare on an announced hull: no pin on the upcoming card.
      expect(soon?.querySelector('.pin')).toBeNull();
    });

    it('coalesces rapid typing into one search for the last term', async () => {
      const fixture = await setup({ searchResults: [hit('ship', 'AEGS_Gladius')] });
      jasmine.clock().install();
      type(fixture, 'g');
      jasmine.clock().tick(100);
      type(fixture, 'gl');
      jasmine.clock().tick(100);
      type(fixture, 'gladius');
      jasmine.clock().tick(250);
      jasmine.clock().uninstall();
      await settle(fixture);

      expect(searchSpy()).toHaveBeenCalledTimes(1);
      expect(searchSpy()).toHaveBeenCalledWith('gladius', 6);
    });

    it('shows the empty state with the term when nothing matches', async () => {
      const fixture = await setup({ searchResults: [] });
      jasmine.clock().install();
      type(fixture, 'zzqx');
      jasmine.clock().tick(250);
      jasmine.clock().uninstall();
      await settle(fixture);

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('a.hit')).toBeNull();
      expect(el.querySelector('.results-note')?.textContent).toContain('codex.landing.results.empty');
    });

    it('the clear button empties the input and takes the results away', async () => {
      const fixture = await setup({ searchResults: [hit('ship', 'AEGS_Gladius')] });
      jasmine.clock().install();
      type(fixture, 'gladius');
      jasmine.clock().tick(250);
      jasmine.clock().uninstall();
      await settle(fixture);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelectorAll('a.hit').length).toBe(1);

      (el.querySelector('button.terminal-clear') as HTMLButtonElement).click();
      await settle(fixture);

      expect(terminal(fixture).value).toBe('');
      expect(el.querySelector('.results')).toBeNull();
      expect(el.querySelector('a.hit')).toBeNull();
      expect(el.querySelector('button.terminal-clear')).toBeNull();
    });

    it('a clear before the debounce fires never starts the search', async () => {
      const fixture = await setup({ searchResults: [hit('ship', 'AEGS_Gladius')] });
      jasmine.clock().install();
      type(fixture, 'gladius');
      (fixture.nativeElement.querySelector('button.terminal-clear') as HTMLButtonElement).click();
      jasmine.clock().tick(500);
      jasmine.clock().uninstall();
      await settle(fixture);

      expect(searchSpy()).not.toHaveBeenCalled();
    });

    // Was a BUG (audit wave 3): a rejected searchAll rendered "no results".
    // CLAUDE.md: a load failure renders an error state with retry.
    it('a failed search shows an error state with retry, not "no results"', async () => {
      const fixture = await setup({});
      jasmine.clock().install();
      searchSpy().and.rejectWith(new Error('network down'));
      type(fixture, 'gladius');
      jasmine.clock().tick(250);
      jasmine.clock().uninstall();
      await settle(fixture);

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.results-note')?.textContent ?? '').not.toContain('codex.landing.results.empty');
      expect(el.querySelector('.results [role="alert"], .results .err')).not.toBeNull();

      // Retry runs the same term again and clears the error once it answers.
      searchSpy().and.resolveTo([]);
      (el.querySelector('.results-retry') as HTMLButtonElement).click();
      await settle(fixture);
      expect(searchSpy()).toHaveBeenCalledTimes(2);
      expect(el.querySelector('.results [role="alert"]')).toBeNull();
    });
  });

  it('spells the manufacturer out on the ship stage eyebrow', async () => {
    const gladius = shipRow({ classNameSlug: 'AEGS_Gladius' });
    const fixture = await setup({
      hangar: [hangarShip('AEGS_Gladius')],
      byClassName: new Map([['AEGS_Gladius', gladius]]),
      flagship: 'AEGS_Gladius',
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.stage-ship .stage-eyebrow')?.textContent).toContain('AEGS');
  });

  // The "Im Versum" band is retired (concept docs/concepts/2026-09-02-codex-im-verse.html,
  // decision Ⓔ): each stage now ends with its OWN quiet quick-access line into
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

  // ── Archive Terminal keyboard (audit L15) ───────────────────────────────

  async function withHits(fixture: ComponentFixture<CodexLandingComponent>): Promise<HTMLElement> {
    fixture.componentInstance.onSearchInput('a');
    fixture.componentInstance.searchTerm.set('a');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  it('ArrowDown moves from the terminal into the hits, arrows walk them, ArrowUp from the first row returns', async () => {
    const fixture = await setup({
      searchResults: [hit('ship', 'AEGS_Gladius'), hit('ship', 'AEGS_Avenger'), hit('ship', 'AEGS_Sabre')],
    });
    const el = await withHits(fixture);
    const input = el.querySelector('.terminal-input') as HTMLInputElement;
    const hits = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.hit'));
    input.focus();
    key(input, 'ArrowDown');
    expect(document.activeElement).toBe(hits[0]);
    key(hits[0], 'ArrowRight');
    expect(document.activeElement).toBe(hits[1]);
    key(hits[1], 'End');
    expect(document.activeElement).toBe(hits[2]);
    key(hits[2], 'Home');
    key(hits[0], 'ArrowUp');
    expect(document.activeElement).toBe(input);
    // The hits stay real anchors in the Tab order.
    expect(hits.every((a) => a.getAttribute('href') && a.tabIndex === 0)).toBeTrue();
  });

  it('Enter in the terminal opens the first hit the way its anchor does', async () => {
    const fixture = await setup({ searchResults: [hit('ship', 'AEGS_Gladius'), hit('ship', 'AEGS_Avenger')] });
    const el = await withHits(fixture);
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    key(el.querySelector('.terminal-input')!, 'Enter');
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav.calls.mostRecent().args[0]).toEqual(fixture.componentInstance.hitLink(hit('ship', 'AEGS_Gladius')));
  });

  it('Escape clears the terminal', async () => {
    const fixture = await setup({ searchResults: [hit('ship', 'AEGS_Gladius')] });
    const el = await withHits(fixture);
    key(el.querySelector('.terminal-input')!, 'Escape');
    expect(fixture.componentInstance.searchInput()).toBe('');
    expect(fixture.componentInstance.searchTerm()).toBe('');
  });

  it('reads the column count of the hit grid from the layout', () => {
    const at = (top: number) => ({ offsetTop: top }) as HTMLElement;
    expect(gridColumns([at(0), at(0), at(0), at(60), at(60)])).toBe(3);
    expect(gridColumns([at(0), at(50)])).toBe(1);
    expect(gridColumns([])).toBe(1);
  });

  // ── empty landing (audit L24) ───────────────────────────────────────────

  it('gives an empty hangar and a set-less person stage real ways forward', async () => {
    const fixture = await setup({ hangar: [], roleLoadouts: [] });
    const el: HTMLElement = fixture.nativeElement;
    const shipCta = el.querySelector<HTMLAnchorElement>('.stage-ship a.stage-cta');
    expect(shipCta?.getAttribute('href')).toBe('/hangar');
    expect(el.querySelector('.stage-ship button.stage-cta')).not.toBeNull();
    const setCta = el.querySelector<HTMLAnchorElement>('.stage-person a.stage-cta');
    expect(setCta?.getAttribute('href')).toBe('/hangar');
    // "Unkommissioniert" itself leads somewhere now.
    expect(el.querySelector('.stage-person a.stage-hit, .stage-person a.stage-text--link')).not.toBeNull();
  });

  it('the "search a ship" CTA focuses the terminal', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.stage-ship button.stage-cta') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(el.querySelector('.terminal-input'));
  });
});
