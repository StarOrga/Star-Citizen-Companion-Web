import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
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

async function setup(opts: {
  id: string | null;
  loadouts?: HangarRoleLoadout[];
  signedIn?: boolean;
}): Promise<ComponentFixture<CodexSetComponent>> {
  await TestBed.configureTestingModule({
    imports: [CodexSetComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      { provide: CodexService, useValue: makeCodexServiceStub() },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ id: opts.id ?? '' }) } },
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
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
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
