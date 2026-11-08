import { ItemPathService } from '../../hq/data/item-path.service';
import { fakeItemPath } from '../../shared/item-path/item-path.testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

  function make(withSupplies = true) {
    TestBed.resetTestingModule();
    const fake = fakeSupabase();
    TestBed.configureTestingModule({
      providers: [ { provide: ItemPathService, useValue: fakeItemPath() },
        provideRouter([]),
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
    expect(el.querySelectorAll('.board .slot').length).toBe(1);
    expect(el.querySelectorAll('.board .slot.free').length).toBe(1);
    expect(el.querySelector('.intro')).not.toBeNull();
    expect(el.querySelector('.classic')).toBeNull();
    click(f, el.querySelector('.board .slot.free .hit'));
    expect(el.querySelector('sc-hq-nachschub-flow')).not.toBeNull();
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
      expect(el.querySelector(tag)).withContext(tag).toBeNull();
    }
  });

  it('an Einsatz that belongs to a Nachschub selects that Nachschub when it is opened from elsewhere', () => {
    const { f } = make();
    const row = { id: 'e1', title: 'Bounty v3', status: 'planned', steps: [], deletedAt: null, packageId: 'pkg-1' };
    (TestBed.inject(EinsatzServiceToken) as unknown as { rows: { set(v: unknown[]): void } }).rows.set([row]);
    const select = spyOn(f.componentInstance['focus'], 'select');
    TestBed.inject(HqPageNavService).routeFocus.set({ id: row.id });
    f.detectChanges();
    expect(select).toHaveBeenCalledWith('pkg-1');
  });
});
