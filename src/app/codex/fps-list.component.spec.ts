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
  }): Promise<{ fixture: ComponentFixture<FpsListComponent>; el: HTMLElement; update: jasmine.Spy }> {
    const list = opts.holdList
      ? jasmine.createSpy('list').and.returnValue(new Promise(() => undefined))
      : jasmine.createSpy('list').and.resolveTo({ rows: [HELMET], count: 1 });
    const update = opts.update ?? jasmine.createSpy('updateRoleLoadout').and.resolveTo(null);

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
      listFpsWeapons: list,
      listFpsArmor: list,
      isPinned: () => false,
      previewUrl: () => null,
    };
    const hangar: Partial<HangarService> = {
      getRoleLoadout: jasmine.createSpy('getRoleLoadout').and.resolveTo(opts.set ?? null),
      updateRoleLoadout: update,
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
      update: jasmine.createSpy('updateRoleLoadout').and.resolveTo(null),
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
    const update = jasmine.createSpy('updateRoleLoadout').and.returnValues(
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
