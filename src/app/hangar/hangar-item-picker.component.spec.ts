import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { HangarItemPickerComponent, PickedItem } from './hangar-item-picker.component';
import { CodexService, CompatibleItem } from '../codex/codex.service';

// Audit D16 step 5 (AUD-267): the picker hands back the chosen entry and
// closes on Escape (a document-level host listener, not a dialog directive).
describe('HangarItemPickerComponent', () => {
  let fixture: ComponentFixture<HangarItemPickerComponent>;

  const ITEMS: CompatibleItem[] = [
    { kind: 'item', classNameSlug: 'WPN_A', nameLocalized: 'Laser A', manufacturerCode: 'BEHR', size: 3, subType: null, grade: null },
    { kind: 'item', classNameSlug: 'WPN_B', nameLocalized: 'Laser B', manufacturerCode: null, size: null, subType: null, grade: null },
  ];

  async function setup(compat: Promise<CompatibleItem[]> = Promise.resolve(ITEMS)): Promise<void> {
    TestBed.configureTestingModule({
      imports: [HangarItemPickerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: { getCompatibleItems: jasmine.createSpy().and.returnValue(compat) } },
      ],
    });
    fixture = TestBed.createComponent(HangarItemPickerComponent);
    fixture.componentRef.setInput('port', { types: ['WeaponGun'], minSize: 1, maxSize: 3 });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((e) => e.replaceChildren());
  });

  it('lists compatible items and emits the picked one', async () => {
    await setup();
    const picked: PickedItem[] = [];
    fixture.componentInstance.picked.subscribe((p) => picked.push(p));

    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button.result'));
    expect(buttons.length).toBe(2);
    buttons[0].click();

    expect(picked).toEqual([{ className: 'WPN_A', kind: 'item', nameLocalized: 'Laser A' }]);
  });

  it('filters the port list by the typed text', async () => {
    await setup();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input.search');
    input.value = 'laser b';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    const names = Array.from(fixture.nativeElement.querySelectorAll('.r-name')).map((e) => (e as HTMLElement).textContent?.trim());
    expect(names).toEqual(['Laser B']);
  });

  it('emits closed on Escape', async () => {
    await setup();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input.search');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(1);
  });

  it('emits closed from the close button', async () => {
    await setup();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    (fixture.nativeElement.querySelector('button.close') as HTMLButtonElement).click();
    expect(closed).toBe(1);
  });

  it('shows the failure with a retry instead of "nothing fits"', async () => {
    spyOn(console, 'warn');
    await setup(Promise.reject(new TypeError('Failed to fetch')));
    const err: HTMLElement | null = fixture.nativeElement.querySelector('.state.err[role="alert"]');
    expect(err).toBeTruthy();
    expect(err?.querySelector('button.retry')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('hangar.picker.emptyPort');
  });
});
