import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexLandingComponent } from './codex-landing.component';
import { CodexListRow, CodexService } from './codex.service';
import { PolySearchHit, scopeForKind } from './codex-poly-search';
import { ShipStatDelta } from './codex-build-diff';
import { HangarService } from '../hangar/hangar.service';
import { HangarRoleLoadout, HangarShip } from '../hangar/hangar.types';
import { AuthService } from '../auth/auth.service';
import { UpcomingShipsService } from './upcoming-ships.service';

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

function hangarShip(className: string): HangarShip {
  return {
    id: className,
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
  return { id, name, role: 'fps', items: [], createdAt: '', updatedAt: '' };
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
  }) {
    const compareKeys = signal<string[]>([]);
    const byClassName = opts.byClassName ?? new Map<string, CodexListRow>();

    const codex: Partial<CodexService> = {
      build: signal({ patchVersion: '4.2', buildNumber: '9000000' }) as never,
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
    };

    const hangar: Partial<HangarService> = {
      ships: signal<HangarShip[]>(opts.hangar ?? []) as never,
      roleLoadouts: signal<HangarRoleLoadout[]>(opts.roleLoadouts ?? []) as never,
      flagshipClassName: signal<string | null>(opts.flagship ?? null) as never,
      loadAll: jasmine.createSpy('loadAll').and.resolveTo(undefined),
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
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the empty-hangar invitation that links to the ship index', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.fleet-empty')).not.toBeNull();
    const cta = el.querySelector<HTMLAnchorElement>('.fleet-empty a.btn');
    expect(cta?.getAttribute('href')).toContain('/codex/index');
  });

  it('renders the honest ICH empty state (uncommissioned) with an armour CTA when no FPS set exists', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.me-empty')).not.toBeNull();
    expect(el.querySelector('.me-ready')).toBeNull();
    const cta = el.querySelector<HTMLAnchorElement>('.me-empty a.btn');
    expect(cta?.getAttribute('href')).toContain('/codex/fps');
  });

  it('lights the ICH panel up (combat-ready) and links to the personal set when an FPS role loadout exists', async () => {
    const fixture = await setup({ hangar: [], roleLoadouts: [fpsLoadout('set1', 'Combat Kit')] });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.me-ready')).not.toBeNull();
    expect(el.querySelector('.me-empty')).toBeNull();
    const link = el.querySelector<HTMLAnchorElement>('.me-ready a.btn');
    expect(link?.getAttribute('href')).toContain('/hangar/loadout/set1');
  });

  it('shows the fleet field with the flagship larger, others as thumbs, and inline patch deltas', async () => {
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
    const flag = el.querySelector<HTMLAnchorElement>('a.fleet-flagship');
    expect(flag).not.toBeNull();
    expect(flag!.getAttribute('href')).toContain('/codex/ship/AEGS_Gladius');
    // inline green delta
    const delta = el.querySelector('.delta.dir-up .delta-val');
    expect(delta?.textContent).toContain('+50');
    // the non-flagship ship renders as a thumb
    const other = el.querySelector<HTMLAnchorElement>('.fleet-others a.fleet-thumb');
    expect(other?.getAttribute('href')).toContain('/codex/ship/ANVL_Arrow');
    // >=2 ships -> the contextual compare hint appears
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
    // manufacturer + blueprint carry the violet meta scope
    expect(el.querySelectorAll('a.hit.meta').length).toBe(2);
    // blueprint routes to the dedicated blueprint detail
    const bp = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.hit')).find((a) =>
      a.getAttribute('href')?.includes('BP_Foo'),
    );
    expect(bp?.getAttribute('href')).toContain('/codex/blueprint/BP_Foo');
  });

  it('renders every WELT navigation as a real anchor', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    const hrefs = Array.from(el.querySelectorAll<HTMLAnchorElement>('.world a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs.some((h) => h?.includes('/codex/index'))).toBeTrue();
    expect(hrefs.some((h) => h?.includes('/codex/keybinds'))).toBeTrue();
    expect(hrefs.some((h) => h?.includes('/codex/blueprint'))).toBeTrue();
    expect(hrefs.some((h) => h?.includes('/news'))).toBeTrue();
    expect(hrefs.some((h) => h?.includes('/codex/upcoming'))).toBeTrue();
    expect(hrefs.some((h) => h?.includes('/codex/showroom'))).toBeTrue();
  });

  it('shows the Verse-online status pill and surfaces the current patch/build', async () => {
    const fixture = await setup({ hangar: [] });
    const el: HTMLElement = fixture.nativeElement;
    // Structure: the live dot + the build-scoped patch line render.
    expect(el.querySelector('.status-pill .live-dot')).not.toBeNull();
    expect(el.querySelector('.status-patch')).not.toBeNull();
    // Data path: the patch value the pill interpolates comes from the build.
    // (i18n text isn't asserted — the test harness has no translation loader.)
    expect(fixture.componentInstance.svc.build()?.patchVersion).toBe('4.2');
  });
});
