import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { fakeSupabase } from '../../testing/fake-supabase';
import { EINSATZ_CACHE_KEY } from '../data/hq-einsatz.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { SUPPLIES_CACHE_KEY, SUPPLIES_STORAGE_KEY, HqSuppliesService } from '../hq-supplies.service';
import { HqStartFeedService } from '../start/hq-start-feed.service';
import { HqPlanComponent } from './hq-plan.component';
import { PLAN_SELECTION_KEY } from './hq-plan-selection';

describe('HqPlanComponent', () => {
  const clean = () => {
    sessionStorage.removeItem(PLAN_SELECTION_KEY);
    for (const k of [SUPPLIES_STORAGE_KEY, SUPPLIES_CACHE_KEY, EINSATZ_CACHE_KEY]) localStorage.removeItem(k);
  };
  beforeEach(clean);
  afterEach(clean);

  function make() {
    TestBed.resetTestingModule();
    const fake = fakeSupabase();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService(),
        fake.provider,
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: HangarService, useValue: { ships: signal([]), roleLoadouts: signal([]) } },
        { provide: HqOwnershipService, useValue: { configs: signal([]), ensureLoaded: () => Promise.resolve() } },
      ],
    });
    const supplies = TestBed.inject(HqSuppliesService);
    supplies.add('S3 Repeater', 2);
    supplies.add('Core', 1);
    const f = TestBed.createComponent(HqPlanComponent);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  const text = (el: HTMLElement, sel: string) => el.querySelector(sel)?.textContent?.trim();
  const click = (f: { detectChanges(): void }, el: Element | null) => {
    (el as HTMLElement).click();
    f.detectChanges();
  };

  it('keeps the section heading and shows Was with the Auswahl; Top 3 is the default (no mode toggle)', () => {
    const { el } = make();
    expect(el.querySelector('h2#hq-plan-title')).not.toBeNull();
    expect(text(el, '#hq-plan-sel')).toBe('hq.plan.selection');
    expect(text(el, '.state')).toBe('hq.plan.state.top3');
    // The switch is Was / Wie only - nothing offers Top 3 / Nach Lust / Gezielt as a control.
    expect(el.querySelectorAll('.switch .seg').length).toBe(2);
    expect(el.querySelectorAll('sc-hq-mood-toggles .pair').length).toBe(3);
    expect(el.querySelectorAll('.kinds .kind').length).toBe(7);
  });

  it('a mood click is Nach Lust, a step chip Eigene Auswahl, and it survives a new component in the same tab', () => {
    const { f, el } = make();
    click(f, el.querySelector('sc-hq-mood-toggles .pair .side.right'));
    expect(text(el, '.state')).toBe('hq.plan.state.mood');
    click(f, el.querySelectorAll('.kinds .kind')[0]);
    expect(text(el, '.state')).toBe('hq.plan.state.custom');
    expect(sessionStorage.getItem(PLAN_SELECTION_KEY)).toContain('"changed":true');

    const fresh = TestBed.createComponent(HqPlanComponent);
    fresh.detectChanges();
    expect(text(fresh.nativeElement, '.state')).toBe('hq.plan.state.custom');

    sessionStorage.removeItem(PLAN_SELECTION_KEY);
    const reloaded = TestBed.createComponent(HqPlanComponent);
    reloaded.detectChanges();
    expect(text(reloaded.nativeElement, '.state')).toBe('hq.plan.state.top3');
  });

  it('Wie shows the route without any filters, and an empty route cannot be saved as an Einsatz', () => {
    const { f, el } = make();
    click(f, el.querySelectorAll('.switch .seg')[1]);
    expect(el.querySelector('.select')).toBeNull();
    expect(el.querySelector('.kinds')).toBeNull();
    expect(el.querySelector('sc-hq-place-tree')).toBeNull();
    expect(text(el, '.route .save')).toBe('hq.plan.saveEinsatz');
    expect(el.querySelector<HTMLButtonElement>('.route .save')!.disabled).toBeTrue();
    expect(el.querySelector('.hq-plan-map-slot')?.getAttribute('data-view')).toBe('how');
  });

  it('lists the Nachschub lines as needs and opens the supplies popup from here', () => {
    const { f, el } = make();
    expect(el.querySelectorAll('.needs .need').length).toBe(2);
    click(f, el.querySelector('.nach'));
    expect(el.querySelector('sc-hq-supplies-popup')).not.toBeNull();
  });

  it('feeds the Start chips from upcoming Einsaetze and clears them on destroy', () => {
    const { f } = make();
    const feed = TestBed.inject(HqStartFeedService);
    expect(feed.chips()).toEqual([]);
    f.destroy();
    expect(feed.chips()).toEqual([]);
  });
});
