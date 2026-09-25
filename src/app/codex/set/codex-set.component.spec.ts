import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { CodexSetComponent } from './codex-set.component';
import { CodexService } from '../codex.service';
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
}): Promise<ComponentFixture<CodexSetComponent>> {
  params$ = new BehaviorSubject(convertToParamMap({ id: opts.id ?? '' }));
  loadAllCalls = 0;
  const roleLoadouts = signal(opts.loadouts ?? []);
  const error = signal<string | null>(null);
  await TestBed.configureTestingModule({
    imports: [CodexSetComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      { provide: CodexService, useValue: makeCodexServiceStub() },
      {
        provide: ActivatedRoute,
        useValue: { paramMap: params$.asObservable(), snapshot: { paramMap: params$.value } },
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
        } as Partial<HangarService>,
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(CodexSetComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

async function navigateTo(fixture: ComponentFixture<CodexSetComponent>, id: string): Promise<void> {
  params$.next(convertToParamMap({ id }));
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
