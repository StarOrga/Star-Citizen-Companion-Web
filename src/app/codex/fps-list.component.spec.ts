import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { FpsListComponent } from './fps-list.component';
import { CodexListRow, CodexService } from './codex.service';
import { HangarService } from '../hangar/hangar.service';
import { HangarRoleLoadout } from '../hangar/hangar.types';
import { RoleService } from '../auth/role.service';

const HELMET: CodexListRow = {
  classNameSlug: 'rsi_helmet_01',
  nameLocalized: 'Test Helmet',
  manufacturerCode: 'RSI',
  size: 1,
  grade: 'A',
  role: null,
  crewSize: null,
  weaponClass: null,
  componentKind: null,
  subType: 'Light',
  attachType: 'Char_Armor_Helmet',
  speed: null,
  isVariant: false,
  payload: {},
  blueprintCategory: null,
  blueprintTier: null,
  craftTimeSec: null,
};

const SET: HangarRoleLoadout = {
  id: 'set-1',
  name: 'Recon',
  role: 'fps',
  items: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

describe('FpsListComponent (equip mode)', () => {
  async function setup(opts: {
    query: Record<string, string>;
    set?: HangarRoleLoadout | null;
    update?: jasmine.Spy;
    /** Leave the first list query pending, to look at the loading state. */
    holdList?: boolean;
    /** What the list query returns (defaults to one helmet). */
    rows?: CodexListRow[];
  }): Promise<{ fixture: ComponentFixture<FpsListComponent>; el: HTMLElement; update: jasmine.Spy }> {
    const list = opts.holdList
      ? jasmine.createSpy('listFpsCatalog').and.returnValue(new Promise(() => undefined))
      : jasmine.createSpy('listFpsCatalog').and.resolveTo(opts.rows ?? [HELMET]);
    const update = opts.update ?? jasmine.createSpy('setRoleLoadoutSlot').and.resolveTo(null);

    const codex: Partial<CodexService> = {
      build: signal({ id: 'b1', entityCounts: {} }) as never,
      stale: signal(false) as never,
      latestLivePatch: signal(null) as never,
      buildLoading: signal(false) as never,
      buildError: signal(null) as never,
      compareKeys: signal<string[]>([]).asReadonly(),
      compareCount: signal(0) as never,
      compareRejectedKind: signal(null) as never,
      loadCurrentBuild: jasmine.createSpy('loadCurrentBuild').and.resolveTo(null),
      listFpsCatalog: list,
      isPinned: () => false,
      previewUrl: () => null,
    };
    const hangar: Partial<HangarService> = {
      getRoleLoadout: jasmine.createSpy('getRoleLoadout').and.resolveTo(opts.set ?? null),
      setRoleLoadoutSlot: update,
    };

    await TestBed.configureTestingModule({
      imports: [FpsListComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: codex },
        { provide: HangarService, useValue: hangar },
        { provide: RoleService, useValue: { isCollaborator: signal(false) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(opts.query) } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(FpsListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, update };
  }

  it('says so when the equip write is refused instead of looking like a dead click', async () => {
    const { fixture, el, update } = await setup({
      query: { cat: 'armor', equipInto: 'set-1' },
      set: SET,
      update: jasmine.createSpy('setRoleLoadoutSlot').and.resolveTo(null),
    });

    (el.querySelector('.equip-btn') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(update).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.equip-err')).not.toBeNull();
    expect(el.querySelector('.equip-btn')!.classList).not.toContain('on');
  });

  it('marks the slot as equipped once the write lands, and clears an earlier error', async () => {
    const saved: HangarRoleLoadout = {
      ...SET,
      items: [{ slot: 'helmet', className: 'rsi_helmet_01', kind: 'item' }],
    };
    const update = jasmine.createSpy('setRoleLoadoutSlot').and.returnValues(
      Promise.resolve(null),
      Promise.resolve(saved),
    );
    const { fixture, el } = await setup({ query: { cat: 'armor', equipInto: 'set-1' }, set: SET, update });

    for (let i = 0; i < 2; i++) {
      (el.querySelector('.equip-btn') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    expect(el.querySelector('.equip-err')).toBeNull();
    expect(el.querySelector('.equip-btn')!.classList).toContain('on');
  });

  it('leads "back to the set" to the set page, not the landing', async () => {
    const { el } = await setup({ query: { cat: 'armor', equipInto: 'set-1' }, set: SET });
    expect(el.querySelector('.equip-back')!.getAttribute('href')).toBe('/codex/set/set-1');
  });

  it('tells the reader when the linked set cannot be loaded', async () => {
    const { el } = await setup({ query: { cat: 'armor', equipInto: 'gone' }, set: null });
    expect(el.querySelector('.equip-bar')).toBeNull();
    expect(el.querySelector('.equip-missing')).not.toBeNull();
    expect(el.querySelector('.equip-btn')).toBeNull();
  });

  it('shows no equip controls and no notice during ordinary browsing', async () => {
    const { el } = await setup({ query: { cat: 'armor' } });
    expect(el.querySelector('.equip-missing')).toBeNull();
    expect(el.querySelector('.equip-btn')).toBeNull();
  });

  it('does not announce "0 results" while the first page is still loading', async () => {
    const { el } = await setup({ query: { cat: 'weapon' }, holdList: true });
    const head = el.querySelector('.result-head .count')!.textContent!.trim();
    expect(head).toBe('codex.results.loading');
  });
});

function weapon(classNameSlug: string, nameLocalized: string, subType: string): CodexListRow {
  return { ...HELMET, classNameSlug, nameLocalized, subType, attachType: null, weaponClass: 'FPS' };
}

describe('FpsListComponent (honest slot fitting)', () => {
  async function render(query: Record<string, string>, set: HangarRoleLoadout, rows: CodexListRow[]) {
    const setSlot = jasmine.createSpy('setRoleLoadoutSlot').and.callFake(
      async (_id: string, slot: string, piece: { className: string; kind: string } | null) => ({
        ...set,
        items: piece ? [{ slot, className: piece.className, kind: piece.kind }] : [],
      }),
    );
    await TestBed.configureTestingModule({
      imports: [FpsListComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        {
          provide: CodexService,
          useValue: {
            build: signal({ id: 'b1', entityCounts: {} }),
            stale: signal(false),
            latestLivePatch: signal(null),
            buildLoading: signal(false),
            buildError: signal(null),
            compareKeys: signal<string[]>([]).asReadonly(),
            compareCount: signal(0),
            compareRejectedKind: signal(null),
            loadCurrentBuild: async () => null,
            listFpsCatalog: async (category: string) => (category === 'weapon' ? rows : []),
            isPinned: () => false,
            previewUrl: () => null,
          } as unknown as Partial<CodexService>,
        },
        {
          provide: HangarService,
          useValue: { getRoleLoadout: async () => set, setRoleLoadoutSlot: setSlot } as Partial<HangarService>,
        },
        { provide: RoleService, useValue: { isCollaborator: signal(false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(FpsListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttonsOf = (name: string): string[] => {
      // The equip buttons sit next to the card link, inside the card's wrapper.
      const wrap = Array.from(el.querySelectorAll('.card-wrap')).find((w) => w.querySelector('a.card .name')?.textContent?.trim() === name);
      return Array.from(wrap?.querySelectorAll('.equip-btn') ?? []).map((b) => b.textContent!.trim());
    };
    return { fixture, el, setSlot, buttonsOf };
  }

  const PISTOL = weapon('klwe_pistol_energy_01', 'Arclight Pistol', 'Small');
  const RIFLE = weapon('behr_rifle_ballistic_01', 'P4-AR Rifle', 'Medium');
  const MULTITOOL = weapon('grin_multitool_01', 'Pyro RYT Multi-Tool', 'Gadget');
  const MEDGUN = weapon('crlf_medgun_01', 'ParaMed Medical Device', 'Small');

  it('offers a pistol only the slots a pistol fills', async () => {
    const { buttonsOf } = await render({ cat: 'weapon', equipInto: 'set-1' }, SET, [PISTOL, RIFLE]);
    expect(buttonsOf('Arclight Pistol')).toEqual(['secondary', 'sidearm']);
    expect(buttonsOf('P4-AR Rifle')).toEqual(['primary', 'secondary']);
  });

  it('never offers a gun for a mining set, but the multi-tool for its tool slots', async () => {
    const mining: HangarRoleLoadout = { ...SET, role: 'mining' };
    const { buttonsOf } = await render({ cat: 'weapon', equipInto: 'set-1' }, mining, [PISTOL, MULTITOOL]);
    expect(buttonsOf('Arclight Pistol')).toEqual([]);
    // The multi-tool is a Gadget too, so the mining set's gadget position takes it as well.
    expect(buttonsOf('Pyro RYT Multi-Tool')).toEqual(['multitool', 'mining-attachment', 'gadget']);
  });

  it('puts the ParaMed into the medgun slot of a medical set, not into a gun slot', async () => {
    const medical: HangarRoleLoadout = { ...SET, role: 'medical' };
    const { buttonsOf } = await render({ cat: 'weapon', equipInto: 'set-1' }, medical, [MEDGUN]);
    expect(buttonsOf('ParaMed Medical Device')).toEqual(['medgun']);
  });

  it('offers only the slot the set page asked for (?equipSlot=)', async () => {
    const { buttonsOf } = await render(
      { cat: 'weapon', equipInto: 'set-1', equipSlot: 'sidearm' },
      SET,
      [PISTOL, RIFLE],
    );
    expect(buttonsOf('Arclight Pistol')).toEqual(['sidearm']);
    expect(buttonsOf('P4-AR Rifle')).toEqual([]);
  });

  it('shows a livery folded into its card as equipped, and clears the slot from there', async () => {
    const base = weapon('gmni_smg_ballistic_01', 'C54 SMG', 'Medium');
    const livery = weapon('gmni_smg_ballistic_01_grey_red01', 'C54 "Justified" SMG', 'Medium');
    const carrying: HangarRoleLoadout = {
      ...SET,
      items: [{ slot: 'primary', className: livery.classNameSlug, kind: 'weapon' }],
    };
    const { el, fixture, setSlot } = await render({ cat: 'weapon', equipInto: 'set-1' }, carrying, [base, livery]);

    const primary = Array.from(el.querySelectorAll('.equip-btn')).find((b) => b.textContent!.trim() === 'primary') as HTMLButtonElement;
    expect(el.querySelectorAll('a.card').length).toBe(1);
    expect(primary.classList).toContain('on');

    primary.click();
    await fixture.whenStable();
    expect(setSlot).toHaveBeenCalledWith('set-1', 'primary', null);
  });
});

describe('FpsListComponent (whole catalog)', () => {
  async function browse(query: Record<string, string>, rows: CodexListRow[], armor: CodexListRow[] = []) {
    await TestBed.configureTestingModule({
      imports: [FpsListComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        {
          provide: CodexService,
          useValue: {
            build: signal({ id: 'b1', entityCounts: {} }),
            stale: signal(false),
            latestLivePatch: signal(null),
            buildLoading: signal(false),
            buildError: signal(null),
            compareKeys: signal<string[]>([]).asReadonly(),
            compareCount: signal(0),
            compareRejectedKind: signal(null),
            loadCurrentBuild: async () => null,
            listFpsCatalog: async (category: string) => (category === 'weapon' ? rows : armor),
            isPinned: () => false,
            previewUrl: () => null,
          } as unknown as Partial<CodexService>,
        },
        { provide: HangarService, useValue: { getRoleLoadout: async () => null } as Partial<HangarService> },
        { provide: RoleService, useValue: { isCollaborator: signal(false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(FpsListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const names = () => Array.from(el.querySelectorAll('a.card .name')).map((n) => n.textContent!.trim());
    return { fixture, el, cmp: fixture.componentInstance, names };
  }

  it('folds every livery into its gun, even when the base record sorts after its paint jobs', async () => {
    // Paged by 60 on the server, `C54 "…" SMG` sorted onto page one and the
    // base `C54 SMG` onto page two: seven separate cards and an estimated count.
    const liveries = ['Justified', 'Luckbringer', 'Ochelo', 'Scorched'].map((l, i) =>
      weapon(`gmni_smg_ballistic_01_skin0${i}`, `C54 "${l}" SMG`, 'Medium'),
    );
    const { names, cmp } = await browse({ cat: 'weapon' }, [...liveries, weapon('gmni_smg_ballistic_01', 'C54 SMG', 'Medium')]);
    expect(names()).toEqual(['C54 SMG']);
    expect(cmp.total()).toBe(1);
  });

  it('restores search and facets from the URL, and ignores a slot the category cannot have', async () => {
    const { names, cmp } = await browse(
      { cat: 'weapon', q: 'arclight', slot: 'Foo' },
      [weapon('klwe_pistol_energy_01', 'Arclight Pistol', 'Small'), weapon('behr_rifle_ballistic_01', 'P4-AR Rifle', 'Medium')],
    );
    expect(cmp.subType()).toBe('');
    expect(cmp.searchInput()).toBe('arclight');
    expect(names()).toEqual(['Arclight Pistol']);
  });

  it('labels armour by position and weight class, never with raw tokens like "UNDEFINED"', async () => {
    const piece = (cls: string, name: string, attach: string, sub: string): CodexListRow => ({
      ...HELMET, classNameSlug: cls, nameLocalized: name, attachType: attach, subType: sub,
    });
    const { el } = await browse({ cat: 'armor' }, [], [
      piece('rsi_torso_01', 'Test Torso', 'Char_Armor_Torso', 'Heavy'),
      piece('rsi_undersuit_01', 'Test Undersuit', 'Char_Armor_Undersuit', 'UNDEFINED'),
    ]);
    const badges = Array.from(el.querySelectorAll('.badge')).map((b) => b.textContent!.trim());
    expect(badges).toContain('codex.landing.paperdoll.torso');
    expect(badges).toContain('fps.weight.heavy');
    expect(badges).not.toContain('UNDEFINED');
    expect(badges).not.toContain('Heavy');
  });

  it('keeps the pin and equip controls outside the card link', async () => {
    const { el } = await browse({ cat: 'weapon' }, [weapon('klwe_pistol_energy_01', 'Arclight Pistol', 'Small')]);
    expect(el.querySelector('a.card button')).toBeNull();
    expect(el.querySelector('.card-wrap > .pin')).not.toBeNull();
  });
});
