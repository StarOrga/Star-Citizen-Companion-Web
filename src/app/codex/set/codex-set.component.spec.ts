import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, signal } from '@angular/core';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { CodexSetComponent } from './codex-set.component';
import { CodexService, ResolvedEntity } from '../codex.service';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { HangarRoleLoadout } from '../../hangar/hangar.types';
import { LoadoutSharePanelComponent } from '../../social/loadout-share-panel.component';
import { ArmorRatingRow, setLensStorageKey } from './set-rating';

/** Stands in for the real share panel, which pulls friends + share RPCs. */
@Component({ selector: 'sc-loadout-share-panel', standalone: true, template: '<p class="share-stub">{{ loadoutId() }}</p>' })
class SharePanelStub {
  readonly loadoutId = input.required<string>();
}

const SET_A: HangarRoleLoadout = {
  id: 'set-a',
  name: 'Tech Set',
  role: 'engineering',
  items: [
    { slot: 'helmet', className: 'Test_Helmet', kind: 'item' },
    { slot: 'core', className: 'Test_Torso', kind: 'item' },
    { slot: 'arms', className: null, kind: null },
    { slot: 'legs', className: null, kind: null },
    { slot: 'undersuit', className: null, kind: null },
    { slot: 'backpack', className: null, kind: null },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const SET_B: HangarRoleLoadout = {
  ...SET_A,
  id: 'set-b',
  name: 'Medical Set',
  role: 'medical',
  updatedAt: '2026-01-03T00:00:00Z',
};

function makeCodexServiceStub(): Partial<CodexService> {
  return {
    resolveEntities: async () => new Map(),
    getEntityPayloads: async () => new Map(),
    listByKind: async () => ({ rows: [], count: 0 }) as never,
    countItemsByAttachType: async () => new Map(),
    armorRating: async () => [],
  };
}

/** The route's param stream — `next()` it to navigate the SAME component instance. */
let params$: BehaviorSubject<ParamMap>;
let loadAllCalls: number;

async function setup(opts: {
  id: string | null;
  loadouts?: HangarRoleLoadout[];
  signedIn?: boolean;
  /** What a fresh `loadAll()` finds on the server (defaults to `loadouts`). */
  serverLoadouts?: HangarRoleLoadout[];
  /** `loadAll()` fails the way the real one does: parked in `error`, never thrown. */
  loadFails?: boolean;
  codex?: Partial<CodexService>;
}): Promise<ComponentFixture<CodexSetComponent>> {
  params$ = new BehaviorSubject(convertToParamMap({ id: opts.id ?? '' }));
  loadAllCalls = 0;
  const roleLoadouts = signal(opts.loadouts ?? []);
  const error = signal<string | null>(null);
  await TestBed.configureTestingModule({
    imports: [CodexSetComponent],
    providers: [
      provideRouter([]),
      provideLocationMocks(),
      provideTranslateService({}),
      { provide: CodexService, useValue: opts.codex ?? makeCodexServiceStub() },
      {
        provide: ActivatedRoute,
        // The subject itself, so both navigateTo() here and a spec that reaches
        // for TestBed.inject(ActivatedRoute).paramMap can move the route on.
        useValue: { paramMap: params$, snapshot: { paramMap: params$.value } },
      },
      {
        provide: AuthService,
        useValue: { user: signal(opts.signedIn === false ? null : ({ id: 'u1' } as never)) } as Partial<AuthService>,
      },
      {
        provide: HangarService,
        useValue: {
          roleLoadouts,
          recentSets: roleLoadouts,
          error,
          loadAll: async () => {
            loadAllCalls++;
            if (opts.loadFails) {
              error.set('network down');
              return;
            }
            error.set(null);
            if (opts.serverLoadouts) roleLoadouts.set(opts.serverLoadouts);
          },
          markSetPicked: () => undefined,
          setRoleLoadoutSlot: async () => null,
        } as Partial<HangarService>,
      },
    ],
  })
    .overrideComponent(CodexSetComponent, {
      remove: { imports: [LoadoutSharePanelComponent] },
      add: { imports: [SharePanelStub] },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(CodexSetComponent);
  await settle(fixture);
  return fixture;
}

/** Let the page take in what just happened — pushed params, a service answer — and repaint. */
async function settle(fixture: ComponentFixture<CodexSetComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function navigateTo(fixture: ComponentFixture<CodexSetComponent>, id: string): Promise<void> {
  params$.next(convertToParamMap({ id }));
  await fixture.whenStable();
  fixture.detectChanges();
}

/** Lens keys this spec may have written — cleared around every spec. */
function clearLenses(): void {
  for (const id of ['set-a', 'set-b', 'set-m', 'set-new', 'missing']) localStorage.removeItem(setLensStorageKey(id));
}

describe('CodexSetComponent', () => {
  beforeEach(clearLenses);
  afterEach(clearLenses);

  it('resolves the requested set and renders one stage with six slot tiles — no second board', async () => {
    const fixture = await setup({ id: 'set-b', loadouts: [SET_A, SET_B] });
    const el: HTMLElement = fixture.nativeElement;
    expect(fixture.componentInstance.activeSet()?.id).toBe('set-b');
    expect(el.querySelector('sc-hangar-picker')).toBeTruthy();
    expect(el.querySelectorAll('.set-hero a.tile').length).toBe(6);
    expect(el.querySelectorAll('sc-codex-board-figure').length).toBe(1);
    expect(el.querySelector('sc-codex-board-panel')).toBeNull();
    expect(el.querySelector('.masthead sc-codex-set-rank-card')).not.toBeNull();
    expect(el.querySelector('sc-codex-set-mission-bar')).not.toBeNull();
  });

  it('switches sets through the stage picker', async () => {
    const fixture = await setup({ id: 'set-a', loadouts: [SET_A, SET_B] });
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture.componentInstance.onSetPick('set-b');
    expect(navigate).toHaveBeenCalledWith(['/codex', 'set', 'set-b']);
  });

  it('loads the rating of the equipped armour for the card and the lens', async () => {
    // A complete row: the rank card and the lens read values and percentiles off it.
    const rows: ArmorRatingRow[] = [
      {
        className: 'Test_Helmet',
        slot: 'helmet',
        itemType: 'Heavy Armor',
        values: { damageReduction: 40, tempMin: -90, tempMax: 115, radCapacity: 26800, radRate: 145.8, gForce: -0.125, mass: 5, carryMicroScu: null },
        pct: { protection: 72, mobility: 1, gForce: 0, heat: 89, cold: 91, radiation: 70, scrub: 16, carry: null },
      },
    ];
    const armorRating = jasmine.createSpy('armorRating').and.resolveTo(rows);
    const fixture = await setup({ id: 'set-a', loadouts: [SET_A], codex: { ...makeCodexServiceStub(), armorRating } });
    expect(armorRating).toHaveBeenCalledWith(jasmine.arrayWithExactContents(['Test_Helmet', 'Test_Torso']));
    expect(fixture.componentInstance.ratingRows()).toBe(rows);
    expect(fixture.componentInstance.ratingLoading()).toBe(false);
  });

  it('keeps an honest gap when the rating function is not there yet', async () => {
    const fixture = await setup({
      id: 'set-a',
      loadouts: [SET_A],
      codex: { ...makeCodexServiceStub(), armorRating: async () => null },
    });
    expect(fixture.componentInstance.ratingRows()).toBeNull();
    expect(fixture.componentInstance.ratingLoading()).toBe(false);
  });

  it('remembers the chosen lens per set', async () => {
    const fixture = await setup({ id: 'set-a', loadouts: [SET_A, SET_B] });
    const page = fixture.componentInstance;
    expect(page.lens()).toBe('all');

    page.setLens('env');
    expect(localStorage.getItem(setLensStorageKey('set-a'))).toBe('env');

    await navigateTo(fixture, 'set-b');
    expect(page.lens()).toBe('all');

    await navigateTo(fixture, 'set-a');
    expect(page.lens()).toBe('env');
  });

  it('ignores a stored lens that is unknown or disabled', async () => {
    localStorage.setItem(setLensStorageKey('set-a'), 'stealth');
    const fixture = await setup({ id: 'set-a', loadouts: [SET_A] });
    expect(fixture.componentInstance.lens()).toBe('all');
  });

  it("renders the set's weapon/tool positions below the masthead", async () => {
    const fixture = await setup({ id: 'set-a', loadouts: [SET_A, SET_B] });
    const el: HTMLElement = fixture.nativeElement;
    const gear = el.querySelector('.set-page > sc-codex-set-gear');
    expect(gear).not.toBeNull();
    // SET_A is an engineering set: multitool, repair attachment, tractor.
    const slots = Array.from(gear!.querySelectorAll<HTMLElement>('.gear-slot')).map((e) => e.dataset['slot']);
    expect(slots).toEqual(['multitool', 'repair-attachment', 'tractor']);
    const link = gear!.querySelector('a.gear-tile');
    expect(link?.getAttribute('href')).toBe('/codex/fps?cat=weapon&equipInto=set-a&equipSlot=multitool');
  });

  it('toggles the inline share panel from the share icon button', async () => {
    const fixture = await setup({ id: 'set-a', loadouts: [SET_A, SET_B] });
    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector('button.share-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.closest('a')).toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('codex.set.share');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('sc-loadout-share-panel')).toBeNull();

    btn.click();
    fixture.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('.share-stub')?.textContent).toBe('set-a');

    btn.click();
    fixture.detectChanges();
    expect(el.querySelector('sc-loadout-share-panel')).toBeNull();
  });

  it('closes the share panel when the page moves to another set', async () => {
    const fixture = await setup({ id: 'set-a', loadouts: [SET_A, SET_B] });
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('button.share-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('sc-loadout-share-panel')).not.toBeNull();

    await navigateTo(fixture, 'set-b');
    expect(el.querySelector('sc-loadout-share-panel')).toBeNull();
  });

  it('offers no share button to a signed-out visitor', async () => {
    const fixture = await setup({ id: null, signedIn: false, loadouts: [] });
    expect((fixture.nativeElement as HTMLElement).querySelector('button.share-btn')).toBeNull();
  });

  it('falls back to the most recently touched set when the requested id no longer exists', async () => {
    const fixture = await setup({ id: 'missing', loadouts: [SET_A, SET_B] });
    // Neither fixture id matches — sortByRecency picks the most recently
    // touched one (SET_B, updatedAt 2026-01-03), same fallback the ship page
    // uses (flagship-or-first).
    expect(fixture.componentInstance.activeSet()?.id).toBe('set-b');
    expect(fixture.componentInstance.notFound()).toBe(true);
  });

  it('follows an in-place navigation to another set instead of keeping the first one', async () => {
    // The picker navigates /codex/set/A → /codex/set/B on the SAME component
    // instance; a snapshot read in ngOnInit kept showing set A under B's URL.
    const fixture = await setup({ id: 'set-a', loadouts: [SET_A, SET_B] });
    expect(fixture.componentInstance.activeSet()?.id).toBe('set-a');

    await navigateTo(fixture, 'set-b');

    expect(fixture.componentInstance.activeSet()?.id).toBe('set-b');
    const title = (fixture.nativeElement as HTMLElement).querySelector('.stage-title');
    expect(title?.textContent).toContain('Medical Set');
  });

  it('drops the "not found" note once the page navigates to a set that exists', async () => {
    const fixture = await setup({ id: 'missing', loadouts: [SET_A, SET_B] });
    expect(fixture.componentInstance.notFound()).toBe(true);

    await navigateTo(fixture, 'set-a');

    expect(fixture.componentInstance.notFound()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('.hint.note')).toBeNull();
  });

  it('refreshes the sets once before reporting a set created elsewhere as not found', async () => {
    const created: HangarRoleLoadout = { ...SET_A, id: 'set-new', name: 'New Set' };
    const fixture = await setup({
      id: 'set-new',
      loadouts: [SET_A],
      serverLoadouts: [SET_A, created],
    });

    expect(loadAllCalls).toBe(1);
    expect(fixture.componentInstance.activeSet()?.id).toBe('set-new');
    expect(fixture.componentInstance.notFound()).toBe(false);
  });

  it('names a failed read and offers a retry instead of claiming there are no sets', async () => {
    const fixture = await setup({ id: 'set-a', loadouts: [], loadFails: true });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.load-err')).not.toBeNull();
    expect(el.textContent).not.toContain('codex.set.noSets');

    (el.querySelector('.load-err .retry') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(loadAllCalls).toBe(2);
  });

  it('points a reader without sets to the hangar, where sets are created', async () => {
    const fixture = await setup({ id: null, loadouts: [] });
    const link = (fixture.nativeElement as HTMLElement).querySelector('.hint a');
    expect(link?.getAttribute('href')).toBe('/hangar');
  });

  it('shows a sign-in hint when the visitor is signed out', async () => {
    const fixture = await setup({ id: null, signedIn: false, loadouts: [] });
    const el: HTMLElement = fixture.nativeElement;
    const link = el.querySelector('.hint a') as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toContain('/login');
  });
});

/** A set that carries other armour than SET_A, so switching to it has to resolve anew. */
const SET_M: HangarRoleLoadout = {
  ...SET_A,
  id: 'set-m',
  name: 'Medic Set',
  role: 'medical',
  items: [
    { slot: 'helmet', className: 'Medic_Helmet', kind: 'item' },
    { slot: 'core', className: null, kind: null },
    { slot: 'arms', className: null, kind: null },
    { slot: 'legs', className: null, kind: null },
    { slot: 'undersuit', className: null, kind: null },
    { slot: 'backpack', className: null, kind: null },
  ],
};

/** What the name lookup answers for `classNames`: each one named "Resolved <class>". */
function named(classNames: string[]): Map<string, ResolvedEntity> {
  return new Map(
    classNames.map((c): [string, ResolvedEntity] => [
      c,
      { kind: 'item', className: c, nameLocalized: `Resolved ${c}`, manufacturerCode: null, size: null, grade: null },
    ]),
  );
}

/**
 * A codex whose name lookups the spec answers by hand, keyed by the first class
 * name asked for — so they can arrive in any order, as they may over a slow network.
 */
function namesByHand() {
  const waiting = new Map<string, () => void>();
  return {
    codex: {
      ...makeCodexServiceStub(),
      resolveEntities: (classNames: string[]) =>
        new Promise<Map<string, ResolvedEntity>>((resolve) =>
          waiting.set(classNames[0], () => resolve(named(classNames))),
        ),
    } as Partial<CodexService>,
    answer: (className: string) => {
      const release = waiting.get(className);
      if (!release) throw new Error(`the page never asked for ${className}`);
      release();
    },
  };
}

/**
 * A params-only navigation to set `id`: the router keeps the page and pushes
 * the new params into its route — the stage's own set picker, back/forward
 * between two set pages.
 */
async function moveTo(fixture: ComponentFixture<CodexSetComponent>, id: string): Promise<void> {
  (TestBed.inject(ActivatedRoute).paramMap as BehaviorSubject<ParamMap>).next(convertToParamMap({ id }));
  await settle(fixture);
}

/** The hero title and the names on the stage's filled slot tiles. */
function shown(fixture: ComponentFixture<CodexSetComponent>): { title: string | null; slots: string[] } {
  const el: HTMLElement = fixture.nativeElement;
  return {
    title: el.querySelector('.set-hero .stage-title')?.textContent?.trim() ?? null,
    slots: Array.from(el.querySelectorAll('.set-hero a.tile:not(.open) .name')).map((s) => s.textContent!.trim()),
  };
}

describe('CodexSetComponent — switching sets', () => {
  it('switches hero and tiles to the set the route moves on to', async () => {
    const fixture = await setup({
      id: 'set-a',
      loadouts: [SET_A, SET_M],
      codex: { ...makeCodexServiceStub(), resolveEntities: async (classNames: string[]) => named(classNames) },
    });
    expect(shown(fixture)).toEqual({
      title: 'Tech Set',
      slots: jasmine.arrayWithExactContents(['Resolved Test_Helmet', 'Resolved Test_Torso']),
    });

    await moveTo(fixture, 'set-m');

    expect(fixture.componentInstance.activeSet()?.id).toBe('set-m');
    expect(shown(fixture)).toEqual({ title: 'Medic Set', slots: ['Resolved Medic_Helmet'] });
  });

  it('drops a late answer for the set it left', async () => {
    const names = namesByHand();
    const fixture = await setup({ id: 'set-a', loadouts: [SET_A, SET_M], codex: names.codex });
    await moveTo(fixture, 'set-m');

    names.answer('Medic_Helmet');
    await settle(fixture);
    names.answer('Test_Helmet');
    await settle(fixture);

    expect(shown(fixture)).toEqual({ title: 'Medic Set', slots: ['Resolved Medic_Helmet'] });
  });
});
