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
import { BetaService } from '../core/beta.service';
import { UpcomingShipsService } from './upcoming-ships.service';
import { BuyOption, UexShopService } from './uex-shop.service';
import { HqSuppliesService, SupplyItem } from '../hq/hq-supplies.service';
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
      /** UEX offers per row (package D). */
      offers?: BuyOption[];
      /** Beta shell flag; undefined = the real BetaService (shell off). */
      shell?: boolean;
    } = {},
  ): Promise<{
    fixture: ComponentFixture<CodexBrowseComponent>;
    cmp: CodexBrowseComponent;
    listByKind: jasmine.Spy;
    silhouettes: jasmine.Spy;
    uex: { shipOffers: jasmine.Spy; whereToBuyEntity: jasmine.Spy };
    supplies: { items: ReturnType<typeof signal<SupplyItem[]>>; add: jasmine.Spy };
  }> {
    const uex = {
      shipOffers: jasmine.createSpy('shipOffers').and.resolveTo(opts.offers ?? []),
      whereToBuyEntity: jasmine.createSpy('whereToBuyEntity').and.resolveTo(opts.offers ?? []),
    };
    const supplyItems = signal<SupplyItem[]>([]);
    const supplies = {
      items: supplyItems,
      add: jasmine.createSpy('add').and.callFake((name: string, _qty: number, meta: { className?: string }) => {
        supplyItems.update((l) => [...l, { id: 'x', name, qty: 1, done: false, className: meta.className ?? null } as SupplyItem]);
        return true;
      }),
    };
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
      facetValues: jasmine.createSpy('facetValues').and.callFake(async (kind: string) =>
        kind === 'ship' ? { manufacturers: [{ code: 'AEGS', name: { de: 'Aegis Dynamics', en: 'Aegis Dynamics', key: '' } }], sizes: [], grades: [], componentKinds: [] } : null),
      countByKind: jasmine.createSpy('countByKind').and.callFake(async (kind: string, f: { attachTypeIn?: string[]; attachTypeNotIn?: string[]; classNameMatch?: string; classNameNotMatch?: string; componentKind?: string }) => {
        if (kind === 'ammunition') return f.classNameMatch ? 70 : 170;
        if (kind === 'component') return f.componentKind === 'Shield' ? 67 : 0;
        if (f.attachTypeNotIn) return 9000;
        if (f.attachTypeIn?.includes('Missile')) return 66;
        if (f.attachTypeIn?.includes('Food')) return f.attachTypeIn.length > 3 ? 5000 : 280;
        return 0;
      }),
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
        { provide: UexShopService, useValue: uex },
        { provide: HqSuppliesService, useValue: supplies },
        ...(opts.shell === undefined
          ? []
          : [{ provide: BetaService, useValue: { state: signal({ verse: true, codex: true, shell: opts.shell }), isEnabled: () => () => opts.shell } }]),
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
    return { fixture, cmp: fixture.componentInstance, listByKind, silhouettes, uex, supplies };
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

  it('package C: ship weapons hang under Schiffe; Waffen is on-foot only', async () => {
    const facet = (weaponClass: string, attachType: string): WeaponFacetRow =>
      ({ weaponClass, attachType, subType: null, isVariant: false }) as WeaponFacetRow;
    const { cmp } = await setup({
      query: { kind: 'weapon', wg: 'ship' },
      weaponFacets: [facet('Ship', 'WeaponGun'), facet('Ship', 'WeaponGun'), facet('Ship', 'TractorBeam'), facet('FPS', 'WeaponPersonal')],
      armorCounts: new Map([['Char_Armor_Helmet', 4], ['Char_Armor_Torso', 3]]),
    });
    const tree = cmp.areaTree();
    const ship = tree.find((n) => n.id === 'ship')!;
    expect(ship.count).toBe(10);
    expect(ship.open).toBeTrue();
    expect(ship.current).toBeFalse();
    const shipWeapons = ship.children.find((n) => n.id === 'ship-weapons')!;
    expect(shipWeapons.count).toBe(3);
    expect(shipWeapons.current).toBeTrue();
    expect(shipWeapons.children.find((n) => n.id === 'ship-gun')?.count).toBe(2);
    expect(shipWeapons.children.find((n) => n.id === 'ship-utility')?.count).toBe(1);
    expect(ship.children.map((n) => n.id)).toEqual(['ship-weapons', 'ship-missiles', 'ship-modules', 'ship-ammo']);
    const weapon = tree.find((n) => n.id === 'weapon')!;
    expect(weapon.target).toEqual({ category: 'weapon', wg: 'fps' });
    expect(weapon.children.every((n) => n.target.wg === 'fps')).toBeTrue();
    expect(weapon.open).toBeFalse();
    expect(tree.find((n) => n.id === 'armor')?.count).toBe(7);
  });

  it('package C: items split into player groups; the hidden bucket only with the setting on', async () => {
    const { cmp, fixture, listByKind } = await setup({ query: { kind: 'item' } });
    await fixture.whenStable();
    const item = cmp.areaTree().find((n) => n.id === 'item')!;
    expect(item.current).toBeTrue();
    expect(item.count).toBe(5000);
    expect(item.children.some((n) => n.id === 'ig-food')).toBeTrue();
    expect(item.children.some((n) => n.id === 'ig-nonUsable')).toBeFalse();
    const filters = listByKind.calls.mostRecent().args[1];
    expect(filters.attachTypeIn).toContain('Food');
    expect(filters.attachTypeIn).not.toContain('Door');
    expect(filters.attachTypeIn).not.toContain('Missile');
  });

  it('package C: munition is on-foot, ship ammunition sits under Schiffe', async () => {
    const { cmp, listByKind, fixture } = await setup({ query: { kind: 'ammunition', ag: 'vehicle' } });
    await fixture.whenStable();
    expect(listByKind.calls.mostRecent().args[1].classNameMatch).toBe('_S[0-9]+_');
    const tree = cmp.areaTree();
    expect(tree.find((n) => n.id === 'ship')!.children.find((n) => n.id === 'ship-ammo')?.current).toBeTrue();
    expect(tree.find((n) => n.id === 'ammunition')?.current).toBeFalse();
    cmp.applyArea(tree.find((n) => n.id === 'ammunition')!.target);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(cmp.ammoGroup()).toBe('fps');
    expect(listByKind.calls.mostRecent().args[1].classNameNotMatch).toBe('_S[0-9]+_');
  });

  it('package C: components, manufacturers and blueprints open their sub areas', async () => {
    const { cmp, listByKind, fixture } = await setup({ query: { kind: 'component', ck: 'Shield' } });
    await fixture.whenStable();
    const tree = cmp.areaTree();
    const comp = tree.find((n) => n.id === 'component')!;
    expect(comp.children.map((n) => n.id)).toEqual(['ck-Shield']);
    expect(comp.children[0].current).toBeTrue();
    expect(listByKind.calls.mostRecent().args[1].componentKind).toBe('Shield');
    const makers = tree.find((n) => n.id === 'manufacturer')!;
    expect(makers.children.map((n) => n.label)).toEqual(['Aegis Dynamics']);
    cmp.applyArea(makers.children[0].target);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(cmp.category()).toBe('manufacturer');
    expect(listByKind.calls.mostRecent().args[1].manufacturer).toBe('AEGS');
    const bp = cmp.areaTree().find((n) => n.id === 'blueprint')!;
    expect(bp.children.map((n) => n.id)).toEqual(['bg-fps', 'bg-vehicle']);
  });

  it('package C: no component kind or blueprint group control in the filter bar any more', async () => {
    const { fixture } = await setup({ query: { kind: 'blueprint' } });
    expect(fixture.nativeElement.querySelector('.filterbar sc-segmented[ng-reflect-aria-label]')).toBeNull();
    const text = (fixture.nativeElement.querySelector('.filterbar') as HTMLElement | null)?.textContent ?? '';
    expect(text).not.toContain('codex.filters.blueprintGroup');
  });

  it('package B: reads role + crew from the URL and filters ships by career and crew range', async () => {
    const { cmp, listByKind } = await setup({ query: { kind: 'ship', role: 'industrial', crew: 'medium' } });
    expect(cmp.shipRole()).toBe('industrial');
    expect(cmp.crewBand()).toBe('medium');
    const [kind, filters] = listByKind.calls.mostRecent().args;
    expect(kind).toBe('ship');
    expect(filters.careerIn).toEqual(['@vehicle_focus_resources']);
    expect(filters.crewMin).toBe(4);
    expect(filters.crewMax).toBe(8);
  });

  it('package B: an open crew band has no upper bound; an unknown role is ignored', async () => {
    const { cmp, listByKind } = await setup({ query: { kind: 'ship', role: 'pirate', crew: 'large' } });
    expect(cmp.shipRole()).toBe('');
    const filters = listByKind.calls.mostRecent().args[1];
    expect(filters.careerIn).toBeUndefined();
    expect(filters.crewMin).toBe(9);
    expect(filters.crewMax).toBeUndefined();
  });

  it('package B: role and crew belong to ships and reset on a kind switch', async () => {
    const { cmp, fixture, listByKind } = await setup({ query: { kind: 'ship', role: 'combat' } });
    expect(fixture.nativeElement.querySelectorAll('.filterbar .chip').length).toBe(8);
    cmp.setCategory('weapon');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(cmp.shipRole()).toBe('');
    expect(listByKind.calls.mostRecent().args[1].careerIn).toBeUndefined();
    expect(fixture.nativeElement.querySelector('.filterbar .chip')).toBeNull();
  });

  it('package B: the list head carries its own search, without a dropdown', async () => {
    const { cmp, fixture } = await setup({ query: { kind: 'ship' } });
    const input = fixture.nativeElement.querySelector('.list-head .ls-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'gladius';
    input.dispatchEvent(new Event('input'));
    expect(cmp.searchInput()).toBe('gladius');
    cmp.onListSearch('');
    expect(cmp.searchInput()).toBe('');
  });

  it('package D: ship rows show the cheapest price and how many places sell it', async () => {
    const offer = (price: number, place: string): BuyOption => ({ price, priceAvg: null, terminal: 'New Deal', location: place, place });
    const { fixture, uex } = await setup({
      query: { kind: 'ship' },
      rows: [{ ...row('AEGS_Gladius', { nameLocalized: 'Aegis Gladius' }), guid: 'g-1' }],
      offers: [offer(1250000, 'Lorville'), offer(1300000, 'Area18')],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(uex.shipOffers).toHaveBeenCalledWith({ guid: 'g-1', name: 'Aegis Gladius' });
    const price = (fixture.nativeElement as HTMLElement).querySelector('.row .price')?.textContent ?? '';
    expect(price).toContain('codex.buy.from');
    expect(price).toContain('codex.buy.places');
  });

  it('package D: the shop button lists the offers and puts the row into the supplies once', async () => {
    const offer: BuyOption = { price: 4200, priceAvg: null, terminal: 'Skutters', location: 'Area18 · ArcCorp', place: 'Area18' };
    const { cmp, fixture, uex, supplies } = await setup({ query: { kind: 'weapon', wg: 'fps' }, rows: [row('behr_p4ar', { nameLocalized: 'P4-AR Rifle' })], offers: [offer] });
    const shop = (fixture.nativeElement as HTMLElement).querySelector('.act.shop') as HTMLButtonElement;
    expect(shop).not.toBeNull();
    shop.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(uex.whereToBuyEntity).toHaveBeenCalledWith('weapon', 'P4-AR Rifle');
    const panel = (fixture.nativeElement as HTMLElement).querySelector('.buy') as HTMLElement;
    expect(panel.querySelectorAll('.offer').length).toBe(1);
    expect(panel.querySelector('.to-plan')?.getAttribute('href')).toBe('/hq#planen');
    (panel.querySelector('.to-sup') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(supplies.add).toHaveBeenCalledOnceWith('P4-AR Rifle', 1, jasmine.objectContaining({ className: 'behr_p4ar', stepKind: 'buy', source: 'search' }));
    expect(cmp.inSupplies('behr_p4ar')).toBeTrue();
    expect(panel.querySelector('.to-sup')).toBeNull();
    expect(panel.querySelector('.in-sup')).not.toBeNull();
  });

  it('package D: compare is an icon button, not a star', async () => {
    const { fixture } = await setup({ query: { kind: 'item' }, rows: [row('food_lemon', { nameLocalized: 'Lemon', attachType: 'Food' })] });
    const pin = (fixture.nativeElement as HTMLElement).querySelector('.act.pin') as HTMLElement;
    expect(pin.querySelector('svg')).not.toBeNull();
    expect(pin.textContent).not.toContain('★');
    expect(pin.textContent).not.toContain('☆');
  });

  it('d-filter: with the beta shell on there is no phone filter button or sheet', async () => {
    const { fixture } = await setup({ query: { kind: 'ship' }, shell: true });
    expect(fixture.nativeElement.querySelector('.filter-fab')).toBeNull();
    expect(fixture.nativeElement.querySelector('.sheet')).toBeNull();
  });

  it('keeps the phone filter button with the shell off', async () => {
    const { fixture } = await setup({ query: { kind: 'ship' }, shell: false });
    expect(fixture.nativeElement.querySelector('.filter-fab')).not.toBeNull();
  });

  it('d-filter: the bar panel carries the tree levels the sheet had (weapon groups, armor slots)', async () => {
    const facet = (attachType: string): WeaponFacetRow =>
      ({ weaponClass: 'Ship', attachType, subType: null, isVariant: false }) as WeaponFacetRow;
    const weapon = await setup({
      query: { kind: 'weapon', wg: 'ship' },
      weaponFacets: [facet('WeaponGun'), facet('TractorBeam')],
      shell: true,
    });
    const ids = weapon.cmp.barFacets().map((f) => f.id);
    expect(ids).toContain('weaponGroup');
    expect(ids).toContain('weaponSubGroup');
    const sub = weapon.cmp.barFacets().find((f) => f.id === 'weaponSubGroup')!;
    sub.set('utility');
    expect(weapon.cmp.weaponSubGroup()).toBe('utility');
    weapon.cmp.barFacets().find((f) => f.id === 'weaponGroup')!.set('fps');
    expect(weapon.cmp.weaponGroup()).toBe('fps');
    expect(weapon.cmp.weaponSubGroup()).withContext('a new super group drops the old sub group').toBe('');
    TestBed.resetTestingModule();

    const armor = await setup({ query: { kind: 'armor' }, shell: true });
    const slot = armor.cmp.barFacets().find((f) => f.id === 'armorSlot')!;
    expect(slot.options.map((o) => o.value)).toEqual([...ARMOR_SLOT_IDS]);
    slot.set('helmet');
    expect(armor.cmp.armorSlot()).toBe('helmet');
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
