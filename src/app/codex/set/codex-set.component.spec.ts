import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { CodexSetComponent } from './codex-set.component';
import { CodexService, ResolvedEntity } from '../codex.service';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { HangarRoleLoadout } from '../../hangar/hangar.types';

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
  };
}

async function setup(opts: {
  id: string | null;
  loadouts?: HangarRoleLoadout[];
  signedIn?: boolean;
  codex?: Partial<CodexService>;
}): Promise<ComponentFixture<CodexSetComponent>> {
  await TestBed.configureTestingModule({
    imports: [CodexSetComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      { provide: CodexService, useValue: opts.codex ?? makeCodexServiceStub() },
      {
        provide: ActivatedRoute,
        useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: opts.id ?? '' })) },
      },
      {
        provide: AuthService,
        useValue: { user: signal(opts.signedIn === false ? null : ({ id: 'u1' } as never)) } as Partial<AuthService>,
      },
      {
        provide: HangarService,
        useValue: {
          roleLoadouts: signal(opts.loadouts ?? []),
          recentSets: signal(opts.loadouts ?? []),
          loadAll: async () => undefined,
          markSetPicked: () => undefined,
        } as Partial<HangarService>,
      },
    ],
  }).compileComponents();
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

describe('CodexSetComponent', () => {
  it('resolves the requested set and renders its hero + six slots', async () => {
    const fixture = await setup({ id: 'set-b', loadouts: [SET_A, SET_B] });
    const el: HTMLElement = fixture.nativeElement;
    expect(fixture.componentInstance.activeSet()?.id).toBe('set-b');
    expect(el.querySelector('sc-hangar-picker')).toBeTruthy();
    expect(el.querySelectorAll('.board-slot').length).toBe(6);
  });

  it('falls back to the most recently touched set when the requested id no longer exists', async () => {
    const fixture = await setup({ id: 'missing', loadouts: [SET_A, SET_B] });
    // Neither fixture id matches — sortByRecency picks the most recently
    // touched one (SET_B, updatedAt 2026-01-03), same fallback the ship page
    // uses (flagship-or-first).
    expect(fixture.componentInstance.activeSet()?.id).toBe('set-b');
    expect(fixture.componentInstance.notFound()).toBe(true);
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

/** The hero title and the names on the board's filled slots. */
function shown(fixture: ComponentFixture<CodexSetComponent>): { title: string | null; slots: string[] } {
  const el: HTMLElement = fixture.nativeElement;
  return {
    title: el.querySelector('.set-hero .stage-title')?.textContent?.trim() ?? null,
    slots: Array.from(el.querySelectorAll('.board-slot:not(.empty) .t-value')).map((s) => s.textContent!.trim()),
  };
}

describe('CodexSetComponent — switching sets', () => {
  it('switches hero and board to the set the route moves on to', async () => {
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
