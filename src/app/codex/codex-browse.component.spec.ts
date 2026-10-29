import { provideNoShipBlueprints } from './ship-blueprint/ship-blueprint.testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideLocationMocks } from '@angular/common/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexBrowseComponent } from './codex-browse.component';
import { CodexListRow, CodexService } from './codex.service';
import { HangarService } from '../hangar/hangar.service';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';
import { UpcomingShipsService } from './upcoming-ships.service';
import { WeaponFacetRow } from './codex-weapon-taxonomy';
import { HoloSilhouette } from './holo-silhouette';
import {
  ARMOR_SLOT_IDS,
  armorAttachTypeOf,
  fpsToBrowseParams,
  inferWeaponSuperGroup,
} from './codex-browse-params';

function row(className: string, patch: Partial<CodexListRow> = {}): CodexListRow {
  return {
    classNameSlug: className,
    nameLocalized: className,
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
    payload: {},
    ...patch,
  } as CodexListRow;
}

function silhouette(className: string): HoloSilhouette {
  return {
    schema: 1,
    kind: 'weapon',
    classNameSlug: className,
    build: { channel: 'LIVE', patchVersion: '4.3', buildNumber: '1' },
    generatedAt: null,
    toolVersion: null,
    source: null,
    viewBox: '0 0 10 10',
    path: 'M0 0L10 0L10 10Z',
    bbox: { x: 0, y: 0, w: 10, h: 10 },
    scaleMPerUnit: null,
    anchors: [],
    unresolved: [],
  } as unknown as HoloSilhouette;
}

describe('fpsToBrowseParams (old /codex/fps links)', () => {
  it('opens on-foot weapons for a bare link', () => {
    expect(fpsToBrowseParams({})).toEqual({ kind: 'weapon', wg: 'fps' });
  });

  it('translates cat=armor and the old slot token', () => {
    expect(fpsToBrowseParams({ cat: 'armor', slot: 'Helmet', q: 'pembroke' })).toEqual({
      kind: 'armor',
      slot: 'helmet',
      q: 'pembroke',
    });
  });

  it('maps the old weapon facet to its sub group and keeps the rest', () => {
    expect(fpsToBrowseParams({ cat: 'weapon', slot: 'Medium', mfr: 'BEHR', size: '2', v: '1' })).toEqual({
      kind: 'weapon',
      wg: 'fps',
      wsg: 'primary',
      mfr: 'BEHR',
      size: '2',
      v: '1',
    });
  });

  it('drops an unknown slot instead of filtering to zero rows', () => {
    expect(fpsToBrowseParams({ cat: 'armor', slot: 'Foo' })).toEqual({ kind: 'armor' });
  });
});

describe('browse params helpers', () => {
  it('infers the super group of a lone sub group, never for an ambiguous one', () => {
    expect(inferWeaponSuperGroup('utility')).toBe('ship');
    expect(inferWeaponSuperGroup('sidearm')).toBe('fps');
    expect(inferWeaponSuperGroup('other')).toBeNull();
    expect(inferWeaponSuperGroup('nope')).toBeNull();
  });

  it('knows the attach type of every armour slot', () => {
    expect(ARMOR_SLOT_IDS).toContain('helmet');
    expect(armorAttachTypeOf('helmet')).toBe('Char_Armor_Helmet');
    expect(armorAttachTypeOf('backpack')).toBe('Char_Armor_Backpack');
    expect(armorAttachTypeOf('cape')).toBeNull();
  });
});

describe('CodexBrowseComponent', () => {
  async function setup(
    opts: {
      rows?: CodexListRow[];
      query?: Record<string, string>;
      weaponFacets?: WeaponFacetRow[];
      silhouettes?: Map<string, HoloSilhouette>;
      armorCounts?: Map<string, number>;
      crossCounts?: Map<string, number>;
    } = {},
  ): Promise<{
    fixture: ComponentFixture<CodexBrowseComponent>;
    cmp: CodexBrowseComponent;
    listByKind: jasmine.Spy;
    silhouettes: jasmine.Spy;
  }> {
    const listByKind = jasmine
      .createSpy('listByKind')
      .and.resolveTo({ rows: opts.rows ?? [], count: (opts.rows ?? []).length });
    const silhouettes = jasmine.createSpy('silhouettes').and.resolveTo(opts.silhouettes ?? new Map());
    const codex: Partial<CodexService> = {
      build: signal({ id: 'b1', patchVersion: '4.3.2', entityCounts: { ships: 10, weapons: 20, components: 5, items: 30 } }) as never,
      stale: signal(false) as never,
      latestLivePatch: signal(null) as never,
      buildLoading: signal(false) as never,
      buildRefresh: signal(0) as never,
      liveMovedNotice: signal<string | null>(null) as never,
      buildError: signal(null) as never,
      compareKeys: signal<string[]>([]).asReadonly(),
      compareCount: signal(0) as never,
      compareRejectedKind: signal(null) as never,
      viewingPastPatch: signal(false) as never,
      loadCurrentBuild: jasmine.createSpy('loadCurrentBuild').and.resolveTo(null),
      listByKind,
      silhouettes,
      countItemsByAttachType: jasmine.createSpy('countItemsByAttachType').and.resolveTo(opts.armorCounts ?? new Map()),
      blueprintCategories: jasmine.createSpy('blueprintCategories').and.resolveTo([]),
      isPinned: () => false,
      previewUrl: () => null,
      weaponFacets: jasmine.createSpy('weaponFacets').and.resolveTo(opts.weaponFacets ?? []),
      countSearchMatches: jasmine.createSpy('countSearchMatches').and.resolveTo(opts.crossCounts ?? new Map()),
      facetValues: jasmine.createSpy('facetValues').and.resolveTo(null),
      suggestNames: jasmine.createSpy('suggestNames').and.resolveTo([]),
    };
    const hangar: Partial<HangarService> = {
      roleLoadouts: signal([]),
      listAllConfigs: async () => [],
      ships: signal([]) as never,
      loadAll: jasmine.createSpy('loadAll').and.resolveTo(undefined),
    };
    await TestBed.configureTestingModule({
      imports: [CodexBrowseComponent],
      providers: [
        provideNoShipBlueprints(),
        provideRouter([]),
        provideLocationMocks(),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: codex },
        { provide: HangarService, useValue: hangar },
        { provide: AuthService, useValue: { user: signal(null) } as unknown as Partial<AuthService> },
        ...(opts.query
          ? [{ provide: ActivatedRoute, useValue: { snapshot: { data: {}, queryParamMap: convertToParamMap(opts.query) } } }]
          : []),
        { provide: RoleService, useValue: { isCollaborator: signal(false) } },
        {
          provide: UpcomingShipsService,
          useValue: {
            feed: signal(null),
            loading: signal(false),
            error: signal(null),
            concept: signal([]),
            flightReadyMissing: signal([]),
            query: signal(''),
            ensureLoaded: jasmine.createSpy('ensureLoaded').and.resolveTo(undefined),
            refresh: jasmine.createSpy('refresh').and.resolveTo(undefined),
            isFavorite: () => false,
            toggleFavorite: () => undefined,
            artFor: () => [] as string[],
            searchLoadedShips: () => [],
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CodexBrowseComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, cmp: fixture.componentInstance, listByKind, silhouettes };
  }

  it('reads the legacy weaponClass param as the weapon super group', async () => {
    const { cmp, listByKind } = await setup({ query: { kind: 'weapon', weaponClass: 'Ship' } });
    expect(cmp.weaponGroup()).toBe('ship');
    expect(listByKind.calls.mostRecent().args[0]).toBe('weapon');
    expect(listByKind.calls.mostRecent().args[1].weaponClass).toBe('Ship');
  });

  it('infers the super group of a legacy wsg-only link (wsg=utility)', async () => {
    const { cmp, listByKind } = await setup({ query: { kind: 'weapon', wsg: 'utility' } });
    expect(cmp.weaponGroup()).toBe('ship');
    expect(cmp.weaponSubGroup()).toBe('utility');
    expect(listByKind.calls.mostRecent().args[1].attachTypeIn).toEqual(['TractorBeam', 'TowingBeam', 'SalvageHead']);
  });

  it('opens armour as items scoped to the slot attach type', async () => {
    const { cmp, listByKind } = await setup({ query: { kind: 'armor', slot: 'helmet' } });
    expect(cmp.category()).toBe('armor');
    expect(cmp.kind()).toBe('item');
    const [kind, filters] = listByKind.calls.mostRecent().args;
    expect(kind).toBe('item');
    expect(filters.attachType).toBe('Char_Armor_Helmet');
  });

  it('counts every area of the tree and opens the current path', async () => {
    const facet = (attachType: string): WeaponFacetRow =>
      ({ weaponClass: 'Ship', attachType, subType: null, isVariant: false }) as WeaponFacetRow;
    const { cmp } = await setup({
      query: { kind: 'weapon', wg: 'ship' },
      weaponFacets: [facet('WeaponGun'), facet('WeaponGun'), facet('TractorBeam')],
      armorCounts: new Map([['Char_Armor_Helmet', 4], ['Char_Armor_Torso', 3]]),
    });
    const tree = cmp.areaTree();
    const weapon = tree.find((n) => n.id === 'weapon')!;
    expect(weapon.count).toBe(20);
    expect(weapon.open).toBeTrue();
    const ship = weapon.children.find((n) => n.id === 'weapon-ship')!;
    expect(ship.count).toBe(3);
    expect(ship.current).toBeTrue();
    expect(ship.children.find((n) => n.id === 'ship-gun')?.count).toBe(2);
    expect(ship.children.find((n) => n.id === 'ship-utility')?.count).toBe(1);
    const armor = tree.find((n) => n.id === 'armor')!;
    expect(armor.count).toBe(7);
    expect(tree.find((n) => n.id === 'ship')?.count).toBe(10);
  });

  it('renders the tree entries as real links', async () => {
    const { fixture } = await setup({ query: { kind: 'ship' } });
    const links = Array.from(fixture.nativeElement.querySelectorAll('.side a.node')) as HTMLAnchorElement[];
    expect(links.length).toBeGreaterThan(3);
    expect(links.every((a) => !!a.getAttribute('href'))).toBeTrue();
    expect(links.some((a) => a.getAttribute('href')!.includes('kind=armor'))).toBeTrue();
  });

  it('never renders a raw class chip, a size bar or an untranslated sub type', async () => {
    const { fixture } = await setup({
      query: { kind: 'weapon' },
      rows: [row('KLWE_LaserRepeater_S3', { nameLocalized: 'Laser Repeater', subType: 'UNDEFINED', weaponClass: 'Ship', size: 3, grade: 'A' })],
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-class-chip')).toBeNull();
    expect(el.querySelector('.size-bar')).toBeNull();
    expect(el.querySelector('.kind-bar')).toBeNull();
    expect(el.textContent).not.toContain('UNDEFINED');
    expect(el.textContent).not.toContain('KLWE_LaserRepeater_S3');
    const link = el.querySelector('.rows a.row-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/codex/weapon/KLWE_LaserRepeater_S3');
    expect(link.querySelector('.size')?.textContent).toContain('S3');
    // The Ship/FPS weapon-class badge stays.
    expect(link.querySelector('.wc')?.textContent).toContain('codex.weaponClass.Ship');
  });

  it('draws the silhouette where one exists and the category icon otherwise', async () => {
    const { fixture, silhouettes } = await setup({
      query: { kind: 'weapon' },
      rows: [row('A_Gun'), row('B_Gun')],
      silhouettes: new Map([['A_Gun', silhouette('A_Gun')]]),
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(silhouettes).toHaveBeenCalledWith('weapon', jasmine.arrayContaining(['A_Gun', 'B_Gun']));
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.rows li.row')) as HTMLElement[];
    expect(rows[0].querySelector('.sil:not(.icon) svg path')?.getAttribute('d')).toBe('M0 0L10 0L10 10Z');
    expect(rows[1].querySelector('.sil:not(.icon)')).toBeNull();
    expect(rows[1].querySelector('.sil.icon sc-codex-icon')).not.toBeNull();
  });

  it('shows a translated error with retry on a failed load, never the empty state', async () => {
    const { fixture, cmp, listByKind } = await setup({ query: { kind: 'ship' } });
    listByKind.and.rejectWith(new TypeError('Failed to fetch'));
    cmp.reload();
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const card = el.querySelector('.sc-card.err');
    expect(card?.textContent).toContain('errors.network');
    expect(card?.textContent).not.toContain('Failed to fetch');
    expect(card?.querySelector('button.retry')).not.toBeNull();
    expect(el.querySelector('.empty')).toBeNull();
  });

  it('names hits in other areas under the list', async () => {
    const { fixture } = await setup({
      query: { kind: 'weapon', q: 'sureg' },
      rows: [row('A_Gun')],
      crossCounts: new Map([['component', 1]]),
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const also = fixture.nativeElement.querySelector('.also a.also-link') as HTMLAnchorElement | null;
    expect(also).not.toBeNull();
    expect(also!.getAttribute('href')).toContain('kind=component');
  });
});
