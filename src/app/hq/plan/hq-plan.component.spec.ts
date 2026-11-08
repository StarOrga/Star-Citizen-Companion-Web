import { ItemPathService } from '../../hq/data/item-path.service';
import { fakeItemPath } from '../../shared/item-path/item-path.testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, type Routes, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { fakeSupabase } from '../../testing/fake-supabase';
import { EINSATZ_CACHE_KEY, HqEinsatzService as EinsatzServiceToken } from '../data/hq-einsatz.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { SUPPLIES_CACHE_KEY, SUPPLIES_STORAGE_KEY, HqSuppliesService } from '../hq-supplies.service';
import { HqPageNavService } from '../hq-page-nav.service';
import { HqPlanComponent } from './hq-plan.component';

describe('HqPlanComponent', () => {
  const clean = () => {
    for (const k of [SUPPLIES_STORAGE_KEY, SUPPLIES_CACHE_KEY, EINSATZ_CACHE_KEY]) localStorage.removeItem(k);
  };
  beforeEach(clean);
  afterEach(clean);

  function make(withSupplies = true, routes: Routes = []) {
    TestBed.resetTestingModule();
    const fake = fakeSupabase();
    TestBed.configureTestingModule({
      providers: [ { provide: ItemPathService, useValue: fakeItemPath() },
        provideRouter(routes),
        provideTranslateService(),
        fake.provider,
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: HangarService, useValue: { ships: signal([]), roleLoadouts: signal([]) } },
        { provide: HqOwnershipService, useValue: { configs: signal([]), ensureLoaded: () => Promise.resolve() } },
      ],
    });
    const supplies = TestBed.inject(HqSuppliesService);
    if (withSupplies) {
      supplies.add('S3 Repeater', 2);
      supplies.add('Core', 1);
    }
    const f = TestBed.createComponent(HqPlanComponent);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  const click = (f: { detectChanges(): void }, el: Element | null) => {
    (el as HTMLElement).click();
    f.detectChanges();
  };

  it('opens on the seven Nachschub slots: free slots are a plus that starts the flow, no separate button', () => {
    const { f, el } = make(false);
    expect(el.querySelector('sc-hq-nachschub-board')).not.toBeNull();
    expect(el.querySelectorAll('.board .slot').length).toBe(7);
    expect(el.querySelectorAll('.board .slot.free').length).toBe(1);
    expect(el.querySelectorAll('.board .slot.ghost').length).toBe(6);
    expect(el.querySelector('.intro')).not.toBeNull();
    expect(el.querySelector('.classic')).toBeNull();
    click(f, el.querySelector('.board .slot.free .hit'));
    expect(el.querySelector('sc-hq-nachschub-flow')).not.toBeNull();
  });

  describe('"In einen Nachschub" from the cart', () => {
    const nach = (i: number) => ({ id: `n${i}`, name: `N${i}`, status: 'active' as const, slot: i, snapshot: {}, createdAt: '2026-11-07T10:00:00Z', archivedAt: null });
    const pick = async (active: number) => {
      localStorage.removeItem('sc.hq.nachschub.focus');
      const { f, el } = make(false, [{ path: '**', children: [] }]);
      const ns = f.componentInstance['ns'];
      ns.packages.set(Array.from({ length: active }, (_, i) => nach(i + 1)));
      ns.loaded.set(true);
      await TestBed.inject(Router).navigateByUrl('/hq?pick=' + encodeURIComponent('item:medpen~2'));
      f.detectChanges();
      await f.whenStable();
      f.detectChanges();
      return el;
    };

    it('opens a new Nachschub while a slot is free, straight on its Einsätze (the selection is made already)', async () => {
      const el = await pick(3);
      expect(el.querySelector('sc-hq-nachschub-flow .dlg-title')?.textContent).toContain('hq.flow.titleNew');
      expect(el.querySelector('sc-hq-nachschub-flow .steps li.on b')?.textContent).toBe('2');
    });

    it('with all 7 slots taken it adds to an existing Nachschub instead of a doomed "new" flow', async () => {
      const el = await pick(7);
      const title = el.querySelector('sc-hq-nachschub-flow .dlg-title');
      expect(title?.textContent).toContain('hq.flow.titleEdit');
      expect(title?.querySelector('small')).toBeNull();
    });
  });

  it('the archive opens from the end of the board', () => {
    const { f, el } = make(false);
    click(f, el.querySelector('.board .archive'));
    expect(el.querySelector('sc-hq-nachschub-archive-dialog')).not.toBeNull();
  });

  it('W5.2: the classic Auswahl / Route face, the opt-in, Blueprint progress, commodity prices and shared Einsaetze are gone from Planen', () => {
    const { el } = make();
    expect(el.querySelector('.classic')).toBeNull();
    expect(el.querySelector('.switch')).toBeNull();
    for (const tag of ['sc-hq-community-optin', 'sc-hq-blueprint-progress', 'sc-hq-commodity-prices', 'sc-hq-shared-einsaetze', 'sc-hq-plan-map', 'sc-hq-mood-toggles']) {
      expect(el.querySelector(tag), tag).toBeNull();
    }
  });

  it('an Einsatz that belongs to a Nachschub selects that Nachschub when it is opened from elsewhere', () => {
    const { f } = make();
    const row = { id: 'e1', title: 'Bounty v3', status: 'planned', steps: [], deletedAt: null, packageId: 'pkg-1' };
    (TestBed.inject(EinsatzServiceToken) as unknown as { rows: { set(v: unknown[]): void } }).rows.set([row]);
    const select = vi.spyOn(f.componentInstance['focus'], 'select').mockReturnValue(undefined as never);
    TestBed.inject(HqPageNavService).routeFocus.set({ id: row.id });
    f.detectChanges();
    expect(select).toHaveBeenCalledWith('pkg-1');
  });
});
