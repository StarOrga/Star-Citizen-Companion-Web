import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexBridgeComponent } from './codex-bridge.component';
import { CodexListRow, CodexService } from './codex.service';
import { RoleService } from '../auth/role.service';
import { HangarService } from '../hangar/hangar.service';
import { HangarShip } from '../hangar/hangar.types';

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

describe('CodexBridgeComponent', () => {
  async function setup(opts: {
    catalog: CodexListRow[];
    hangar: HangarShip[];
    byClassName?: Map<string, CodexListRow>;
    flagship?: string | null;
  }) {
    const compareKeys = signal<string[]>([]);
    const byClassName = opts.byClassName ?? new Map<string, CodexListRow>();

    const codex: Partial<CodexService> = {
      build: signal({ patchVersion: '4.2', buildNumber: '9000000' }) as never,
      // Freshness signals consumed by the embedded status banner.
      stale: signal(false) as never,
      latestLivePatch: signal(null) as never,
      compareKeys: compareKeys.asReadonly(),
      loadCurrentBuild: jasmine.createSpy('loadCurrentBuild').and.resolveTo(null),
      listBridgeShips: jasmine.createSpy('listBridgeShips').and.resolveTo(opts.catalog),
      listByKind: jasmine.createSpy('listByKind').and.resolveTo({ rows: [], count: 0 }),
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
      previewUrl: () => null,
      isPinned: (_k, c) => compareKeys().includes(`ship:${c}`),
      togglePin: jasmine.createSpy('togglePin'),
    };

    const hangarSignal = signal<HangarShip[]>(opts.hangar);
    const flagshipSignal = signal<string | null>(opts.flagship ?? null);
    const hangar: Partial<HangarService> = {
      ships: hangarSignal as never,
      flagshipClassName: flagshipSignal as never,
      loadAll: jasmine.createSpy('loadAll').and.resolveTo(undefined),
      addShip: jasmine.createSpy('addShip').and.resolveTo(null),
      isFlagship: (cn: string) => flagshipSignal() === cn,
      toggleFlagship: jasmine
        .createSpy('toggleFlagship')
        .and.callFake((cn: string) =>
          flagshipSignal.set(flagshipSignal() === cn ? null : cn),
        ),
    };

    await TestBed.configureTestingModule({
      imports: [CodexBridgeComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: codex },
        { provide: HangarService, useValue: hangar },
        // Stub RoleService so the embedded status banner never constructs the
        // real one (which pulls Auth/Supabase and hangs whenStable in tests).
        { provide: RoleService, useValue: { isCollaborator: signal(false) } },
      ],
    }).compileComponents();

    const fixture: ComponentFixture<CodexBridgeComponent> =
      TestBed.createComponent(CodexBridgeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('features the first catalog ship as the hero when the hangar is empty', async () => {
    const catalog = [shipRow({ classNameSlug: 'AEGS_Gladius' })];
    const fixture = await setup({ catalog, hangar: [] });
    const cmp = fixture.componentInstance;
    expect(cmp.heroFromHangar()).toBeFalse();
    expect(cmp.hero()?.classNameSlug).toBe('AEGS_Gladius');
    expect(fixture.nativeElement.querySelector('.hero-name')).not.toBeNull();
  });

  it('promotes the first hangar ship to the hero and shows the Your Hangar lane', async () => {
    const gladius = shipRow({ classNameSlug: 'AEGS_Gladius' });
    const arrow = shipRow({ classNameSlug: 'ANVL_Arrow' });
    const fixture = await setup({
      catalog: [arrow],
      hangar: [hangarShip('AEGS_Gladius')],
      byClassName: new Map([['AEGS_Gladius', gladius]]),
    });
    const cmp = fixture.componentInstance;
    expect(cmp.heroFromHangar()).toBeTrue();
    expect(cmp.hero()?.classNameSlug).toBe('AEGS_Gladius');
    expect(cmp.lanes().some((l) => l.id === 'hangar')).toBeTrue();
  });

  it('exposes an Index-mode escape hatch link', async () => {
    const fixture = await setup({ catalog: [shipRow({ classNameSlug: 'AEGS_Gladius' })], hangar: [] });
    const link: HTMLAnchorElement | null = fixture.nativeElement.querySelector('.index-link');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toContain('/codex/index');
  });

  it('picks crew as the single headline hero stat', async () => {
    const fixture = await setup({
      catalog: [shipRow({ classNameSlug: 'AEGS_Gladius', crewSize: 2 })],
      hangar: [],
    });
    expect(fixture.componentInstance.heroHeadline()).toEqual({
      labelKey: 'codex.detail.crew',
      value: '2',
    });
  });

  it('promotes the pinned flagship to the hero over the first hangar ship', async () => {
    const gladius = shipRow({ classNameSlug: 'AEGS_Gladius' });
    const arrow = shipRow({ classNameSlug: 'ANVL_Arrow' });
    const fixture = await setup({
      catalog: [],
      // hangar order would make Gladius the default hero; the flagship overrides.
      hangar: [hangarShip('AEGS_Gladius'), hangarShip('ANVL_Arrow')],
      byClassName: new Map([
        ['AEGS_Gladius', gladius],
        ['ANVL_Arrow', arrow],
      ]),
      flagship: 'ANVL_Arrow',
    });
    const cmp = fixture.componentInstance;
    expect(cmp.heroFromFlagship()).toBeTrue();
    expect(cmp.hero()?.classNameSlug).toBe('ANVL_Arrow');
    expect(fixture.nativeElement.querySelector('.hero-eyebrow.flagship')).not.toBeNull();
  });

  it('falls back to the first hangar ship when the flagship is unresolvable in this build', async () => {
    const gladius = shipRow({ classNameSlug: 'AEGS_Gladius' });
    const fixture = await setup({
      catalog: [],
      hangar: [hangarShip('AEGS_Gladius')],
      byClassName: new Map([['AEGS_Gladius', gladius]]),
      // flagship points at a ship not present in the current build catalog.
      flagship: 'ORIG_890Jump',
    });
    const cmp = fixture.componentInstance;
    expect(cmp.heroFromFlagship()).toBeFalse();
    expect(cmp.hero()?.classNameSlug).toBe('AEGS_Gladius');
  });

  it('toggles the flagship from the hero and reacts in the hero eyebrow', async () => {
    const gladius = shipRow({ classNameSlug: 'AEGS_Gladius' });
    const fixture = await setup({
      catalog: [],
      hangar: [hangarShip('AEGS_Gladius')],
      byClassName: new Map([['AEGS_Gladius', gladius]]),
    });
    const cmp = fixture.componentInstance;
    expect(cmp.isFlagship('AEGS_Gladius')).toBeFalse();
    cmp.toggleFlagship('AEGS_Gladius');
    fixture.detectChanges();
    expect(cmp.isFlagship('AEGS_Gladius')).toBeTrue();
    expect(cmp.heroFromFlagship()).toBeTrue();
  });
});
