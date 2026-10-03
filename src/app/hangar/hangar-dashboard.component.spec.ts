import { provideNoShipBlueprints } from '../codex/ship-blueprint/ship-blueprint.testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { AnalyticsService } from '../core/analytics.service';
import { CodexService } from '../codex/codex.service';
import { UpcomingShipsService } from '../codex/upcoming-ships.service';
import { LoadoutShareService } from '../social/loadout-share.service';
import { chainArgs, fakeSupabase, FakeCall, FakeResult } from '../testing/fake-supabase';
import { HangarDashboardComponent } from './hangar-dashboard.component';
import { HangarService } from './hangar.service';

// Role-loadout ("set") housekeeping on the hangar dashboard: create, rename and
// delete go through HangarService, a failure shows up as the `.sc-card.err`
// banner, and the role picker is the themed sc-select (REQ-9), never a native
// <select>. The real HangarService runs over the fake Supabase client so a
// failing write sets `hangar.error` exactly as in the app.
describe('HangarDashboardComponent role loadouts', () => {
  const setRow = (id: string, name: string, role = 'fps') => ({
    id,
    user_id: 'u1',
    name,
    role,
    items: [],
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00',
  });
  const forbidden = { code: '42501', message: 'permission denied for table hangar_role_loadouts' };

  /** Per-test override for the writes; reads (`select`) always answer the seeded sets. */
  let write: (call: FakeCall) => FakeResult;
  let seeded: ReturnType<typeof setRow>[];

  async function setup(): Promise<{ fixture: ComponentFixture<HangarDashboardComponent>; hangar: HangarService; calls: FakeCall[]; el: HTMLElement }> {
    const fake = fakeSupabase({
      answer: (call) => {
        if (call.target === 'hangar_role_loadouts') {
          const isWrite = call.chain.some(([m]) => ['insert', 'update', 'delete'].includes(m));
          return isWrite ? write(call) : { data: seeded };
        }
        if (call.target === 'profiles') return { data: { flagship_ship_class: null } };
        return { data: [] };
      },
    });
    TestBed.configureTestingModule({
      imports: [HangarDashboardComponent],
      providers: [
      provideNoShipBlueprints(),
        provideRouter([]),
        provideLocationMocks(),
        provideTranslateService({ fallbackLang: 'en' }),
        fake.provider,
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } as unknown as AuthService },
        { provide: AnalyticsService, useValue: { capture: jasmine.createSpy('capture') } },
        {
          provide: CodexService,
          useValue: {
            loadCurrentBuild: () => Promise.resolve(),
            getShipsByClassNames: () => Promise.resolve(new Map()),
            listByKind: () => Promise.resolve({ rows: [], total: 0 }),
            previewUrl: () => null,
          },
        },
        {
          provide: UpcomingShipsService,
          useValue: { ensureLoaded: () => Promise.resolve(), shipByName: () => null },
        },
        { provide: LoadoutShareService, useValue: { listSharedWithMe: () => Promise.resolve([]) } },
      ],
    });
    const fixture = TestBed.createComponent(HangarDashboardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, hangar: TestBed.inject(HangarService), calls: fake.calls, el: fixture.nativeElement as HTMLElement };
  }

  const settle = async (fixture: ComponentFixture<HangarDashboardComponent>) => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const typeInto = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  const buttonByKey = (root: ParentNode, key: string): HTMLButtonElement =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === key) as HTMLButtonElement;

  const nameInput = (el: HTMLElement) => el.querySelector('.new-loadout input.ld-name') as HTMLInputElement;

  beforeEach(() => {
    localStorage.clear();
    seeded = [setRow('set-1', 'Recon')];
    write = () => ({ data: null });
  });
  afterEach(() => localStorage.clear());

  describe('create', () => {
    it('creates the set with the typed name and the chosen role, then clears the field', async () => {
      write = () => ({ data: setRow('set-2', 'Boarding') });
      const { fixture, hangar, calls, el } = await setup();
      const create = spyOn(hangar, 'createRoleLoadout').and.callThrough();

      typeInto(nameInput(el), '  Boarding ');
      fixture.detectChanges();
      buttonByKey(el.querySelector('.new-loadout')!, 'hangar.roleLoadouts.create').click();
      await settle(fixture);

      expect(create).toHaveBeenCalledOnceWith('Boarding', 'fps');
      const insert = calls.find((c) => c.chain.some(([m]) => m === 'insert'))!;
      expect(chainArgs(insert, 'insert')).toEqual([{ user_id: 'u1', name: 'Boarding', role: 'fps', items: [] }]);
      expect(nameInput(el).value).toBe('');
      expect(el.querySelector('.sc-card.err')).toBeNull();
      expect(Array.from(el.querySelectorAll('.loadout-card .name')).map((n) => n.textContent?.trim())).toEqual(['Boarding', 'Recon']);
    });

    it('opens the new set, so picking gear for a slot is the next thing on screen (audit L09)', async () => {
      write = () => ({ data: setRow('set-2', 'Boarding') });
      const { fixture, el } = await setup();
      const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

      typeInto(nameInput(el), 'Boarding');
      fixture.detectChanges();
      buttonByKey(el.querySelector('.new-loadout')!, 'hangar.roleLoadouts.create').click();
      await settle(fixture);

      expect(nav).toHaveBeenCalledOnceWith(['/codex', 'set', 'set-2']);
    });

    it('keeps the typed name and shows the error banner when the write fails', async () => {
      write = () => ({ error: forbidden });
      const { fixture, hangar, el } = await setup();
      const create = spyOn(hangar, 'createRoleLoadout').and.callThrough();

      typeInto(nameInput(el), 'Boarding');
      fixture.detectChanges();
      buttonByKey(el.querySelector('.new-loadout')!, 'hangar.roleLoadouts.create').click();
      await settle(fixture);

      expect(create).toHaveBeenCalledTimes(1);
      expect(nameInput(el).value).toBe('Boarding');
      const banner = el.querySelector('.sc-card.err') as HTMLElement;
      expect(banner).not.toBeNull();
      expect(banner.textContent).toContain('errors.forbidden');
      expect(el.querySelectorAll('.loadout-card').length).toBe(1);
    });

    it('does not call the service for a blank name (button disabled)', async () => {
      const { fixture, hangar, el } = await setup();
      const create = spyOn(hangar, 'createRoleLoadout').and.callThrough();

      typeInto(nameInput(el), '   ');
      fixture.detectChanges();
      const button = buttonByKey(el.querySelector('.new-loadout')!, 'hangar.roleLoadouts.create');
      button.click();
      await settle(fixture);

      expect(button.disabled).toBeTrue();
      expect(create).not.toHaveBeenCalled();
    });

    // REQ-9: a native <select> opens as an unthemed OS menu.
    it('offers the role as a themed select, with no native <select> on the page', async () => {
      write = () => ({ data: setRow('set-2', 'Boarding', 'medical') });
      const { fixture, hangar, el } = await setup();
      const create = spyOn(hangar, 'createRoleLoadout').and.callThrough();

      expect(el.querySelector('.new-loadout sc-select.role-select')).not.toBeNull();
      expect(el.querySelector('select')).toBeNull();

      const picker = el.querySelector('sc-select.role-select')!;
      (picker.querySelector('.trigger') as HTMLButtonElement).click();
      fixture.detectChanges();
      const options = Array.from(picker.querySelectorAll('[role=option]'));
      expect(options.length).toBeGreaterThan(1);
      const medical = options.find((o) => o.textContent?.trim() === 'hangar.roles.medical') as HTMLElement;
      expect(medical).toBeDefined();
      medical.click();
      fixture.detectChanges();

      typeInto(nameInput(el), 'Boarding');
      fixture.detectChanges();
      buttonByKey(el.querySelector('.new-loadout')!, 'hangar.roleLoadouts.create').click();
      await settle(fixture);

      expect(create).toHaveBeenCalledOnceWith('Boarding', 'medical');
    });
  });

  describe('rename', () => {
    async function openRename() {
      const ctx = await setup();
      buttonByKey(ctx.el.querySelector('.loadout-card')!, 'hangar.roleLoadouts.rename').click();
      ctx.fixture.detectChanges();
      return ctx;
    }
    const renameInput = (el: HTMLElement) => el.querySelector('.ld-rename input') as HTMLInputElement;

    it('starts with the current name and saves the trimmed draft through updateRoleLoadout', async () => {
      write = () => ({ data: setRow('set-1', 'Recon 2') });
      const { fixture, hangar, calls, el } = await openRename();
      const update = spyOn(hangar, 'updateRoleLoadout').and.callThrough();

      expect(renameInput(el).value).toBe('Recon');
      typeInto(renameInput(el), ' Recon 2 ');
      fixture.detectChanges();
      buttonByKey(el.querySelector('.ld-rename')!, 'hangar.detail.save').click();
      await settle(fixture);

      expect(update).toHaveBeenCalledOnceWith('set-1', { name: 'Recon 2' });
      const call = calls.find((c) => c.chain.some(([m]) => m === 'update'))!;
      expect(chainArgs(call, 'update')).toEqual([{ name: 'Recon 2' }]);
      expect(el.querySelector('.ld-rename')).toBeNull();
      expect(el.querySelector('.loadout-card .name')!.textContent?.trim()).toBe('Recon 2');
    });

    it('shows the error banner when the rename is refused, and the list keeps the old name', async () => {
      write = () => ({ error: forbidden });
      const { fixture, hangar, el } = await openRename();
      spyOn(hangar, 'updateRoleLoadout').and.callThrough();

      typeInto(renameInput(el), 'Nope');
      fixture.detectChanges();
      buttonByKey(el.querySelector('.ld-rename')!, 'hangar.detail.save').click();
      await settle(fixture);

      expect((el.querySelector('.sc-card.err') as HTMLElement).textContent).toContain('errors.forbidden');
      expect(el.querySelector('.loadout-card .name')!.textContent?.trim()).toBe('Recon');
    });

    it('cancel leaves the service untouched', async () => {
      const { fixture, hangar, el } = await openRename();
      const update = spyOn(hangar, 'updateRoleLoadout').and.callThrough();

      buttonByKey(el.querySelector('.ld-rename')!, 'hangar.roleLoadouts.cancel').click();
      fixture.detectChanges();

      expect(update).not.toHaveBeenCalled();
      expect(el.querySelector('.ld-rename')).toBeNull();
    });
  });

  describe('delete', () => {
    const askDelete = (ctx: { fixture: ComponentFixture<HangarDashboardComponent>; el: HTMLElement }) => {
      buttonByKey(ctx.el.querySelector('.loadout-card')!, 'hangar.configs.delete').click();
      ctx.fixture.detectChanges();
    };

    it('needs the inline confirm step before it deletes', async () => {
      const ctx = await setup();
      const del = spyOn(ctx.hangar, 'deleteRoleLoadout').and.callThrough();

      askDelete(ctx);

      expect(del).not.toHaveBeenCalled();
      expect(buttonByKey(ctx.el, 'hangar.roleLoadouts.deleteConfirm')).toBeDefined();

      buttonByKey(ctx.el, 'hangar.roleLoadouts.cancel').click();
      ctx.fixture.detectChanges();
      expect(del).not.toHaveBeenCalled();
      expect(ctx.el.querySelectorAll('.loadout-card').length).toBe(1);
    });

    it('deletes through deleteRoleLoadout and drops the card', async () => {
      const ctx = await setup();
      const del = spyOn(ctx.hangar, 'deleteRoleLoadout').and.callThrough();

      askDelete(ctx);
      buttonByKey(ctx.el, 'hangar.roleLoadouts.deleteConfirm').click();
      await settle(ctx.fixture);

      expect(del).toHaveBeenCalledOnceWith('set-1');
      const call = ctx.calls.find((c) => c.chain.some(([m]) => m === 'delete'))!;
      expect(chainArgs(call, 'eq')).toEqual(['id', 'set-1']);
      expect(ctx.el.querySelectorAll('.loadout-card').length).toBe(0);
      expect(ctx.el.querySelector('.sc-card.err')).toBeNull();
    });

    it('keeps the card and shows the error banner when the delete fails', async () => {
      write = () => ({ error: forbidden });
      const ctx = await setup();
      spyOn(ctx.hangar, 'deleteRoleLoadout').and.callThrough();

      askDelete(ctx);
      buttonByKey(ctx.el, 'hangar.roleLoadouts.deleteConfirm').click();
      await settle(ctx.fixture);

      expect(ctx.el.querySelectorAll('.loadout-card').length).toBe(1);
      expect((ctx.el.querySelector('.sc-card.err') as HTMLElement).textContent).toContain('errors.forbidden');
    });
  });
});
