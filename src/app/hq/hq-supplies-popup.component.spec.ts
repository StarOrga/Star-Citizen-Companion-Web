import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HqSuppliesPopupComponent } from './hq-supplies-popup.component';
import { HqSuppliesService, SUPPLIES_STORAGE_KEY } from './hq-supplies.service';

describe('HqSuppliesPopupComponent', () => {
  beforeEach(() => {
    localStorage.removeItem(SUPPLIES_STORAGE_KEY);
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideTranslateService()] });
  });
  afterEach(() => localStorage.removeItem(SUPPLIES_STORAGE_KEY));

  it('is a dialog on the shared frame (popup mode), adds a line and ticks it off', async () => {
    const f = TestBed.createComponent(HqSuppliesPopupComponent);
    let closed = 0;
    f.componentInstance.closed.subscribe(() => closed++);
    f.detectChanges();
    await f.whenStable();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();

    const name = el.querySelector<HTMLInputElement>('#sup-name')!;
    name.value = 'Quantum drive';
    name.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form.add')!.dispatchEvent(new Event('submit'));
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
});
