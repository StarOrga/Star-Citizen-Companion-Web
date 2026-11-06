import { ItemPathService } from '../hq/data/item-path.service';
import { fakeItemPath } from '../shared/item-path/item-path.testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { HangarService } from '../hangar/hangar.service';
import { fakeSupabase } from '../testing/fake-supabase';
import { HqOwnershipService } from './hq-ownership.service';
import { HqSuppliesPopupComponent } from './hq-supplies-popup.component';
import { HqSuppliesService, SUPPLIES_STORAGE_KEY } from './hq-supplies.service';

describe('HqSuppliesPopupComponent', () => {
  beforeEach(() => {
    localStorage.removeItem(SUPPLIES_STORAGE_KEY);
    const path = fakeItemPath();
    (path as unknown as Record<string, unknown>)['tickOnly'] = jasmine.createSpy('tickOnly').and.returnValue({ ok: true, key: 'itemPath.done.ticked' });
    TestBed.configureTestingModule({ providers: [
        { provide: ItemPathService, useValue: path },
        provideRouter([]),
        provideTranslateService(),
        fakeSupabase().provider,
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: HangarService, useValue: { ships: signal([]), roleLoadouts: signal([]) } },
        { provide: HqOwnershipService, useValue: { configs: signal([]) } },
      ], });
  });
  afterEach(() => localStorage.removeItem(SUPPLIES_STORAGE_KEY));

  it('is a dialog on the shared frame (popup mode), takes no free text and ticks a line off', async () => {
    const f = TestBed.createComponent(HqSuppliesPopupComponent);
    let closed = 0;
    f.componentInstance.closed.subscribe(() => closed++);
    f.detectChanges();
    await f.whenStable();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();

    expect(el.querySelector('input[type="text"]')).toBeNull();

    TestBed.inject(HqSuppliesService).add('Quantum drive', 1);
    f.detectChanges();
    expect(el.querySelectorAll('li.line').length).toBe(1);
    expect(TestBed.inject(HqSuppliesService).open().length).toBe(1);

    el.querySelector<HTMLInputElement>('li.line input[type="checkbox"]')!.click();
    f.detectChanges();
    expect(el.querySelector('li.line.done')).not.toBeNull();
    expect(TestBed.inject(HqSuppliesService).open().length).toBe(0);

    el.querySelector<HTMLElement>('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(1);
  });

  it('has the tabs Wunschliste and Nachschub; the start tab can be chosen', () => {
    const f = TestBed.createComponent(HqSuppliesPopupComponent);
    f.componentRef.setInput('startTab', 'wish');
    f.detectChanges();
    return f.whenStable().then(() => {
      f.detectChanges();
      const tabs = [...(f.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')];
      expect(tabs.length).toBe(2);
      expect(tabs[0].getAttribute('aria-selected')).toBe('true');
      expect((f.nativeElement as HTMLElement).textContent).toContain('hq.supplies.wish.empty');
      tabs[1].click();
      f.detectChanges();
      expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    });
  });

  it('"Besorgt" asks for the place (default first), stores there, and "Nur abhaken" is the way out', async () => {
    const f = TestBed.createComponent(HqSuppliesPopupComponent);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    const svc = TestBed.inject(HqSuppliesService);
    svc.add('Quantum drive', 2, { entityKind: 'item', className: 'qd_s1' });
    f.detectChanges();
    const got = [...el.querySelectorAll<HTMLButtonElement>('li.line button')].find((b) => b.textContent?.includes('hq.supplies.got'))!;
    got.click();
    f.detectChanges();
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.place .chip-btn')];
    expect(chips[0].textContent?.trim()).toBe('Bei mir');
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
    const store = [...el.querySelectorAll<HTMLButtonElement>('.place button')].find((b) => b.textContent?.includes('hq.supplies.place.store'))!;
    store.click();
    const path = TestBed.inject(ItemPathService) as unknown as ReturnType<typeof fakeItemPath>;
    expect(path.moveToInventar).toHaveBeenCalledWith('item', 'qd_s1', 'Quantum drive', 'Bei mir', 2);

    await new Promise((r) => setTimeout(r));
    f.detectChanges();
    got.click();
    f.detectChanges();
    const tick = [...el.querySelectorAll<HTMLButtonElement>('.place button')].find((b) => b.textContent?.includes('hq.supplies.place.tickOnly'));
    expect(tick).toBeTruthy();
  });
});
