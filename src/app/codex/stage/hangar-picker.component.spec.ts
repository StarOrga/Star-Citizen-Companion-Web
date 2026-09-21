import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HangarPickerComponent, HangarPickerItem } from './hangar-picker.component';

const ITEMS: HangarPickerItem[] = [
  { id: 'a', label: 'Avenger Stalker', active: true },
  { id: 'b', label: 'Gladius', active: false },
  { id: 'c', label: 'Cutlass Black', active: false },
];

describe('HangarPickerComponent', () => {
  async function setup(items: HangarPickerItem[] = ITEMS): Promise<ComponentFixture<HangarPickerComponent>> {
    await TestBed.configureTestingModule({
      imports: [HangarPickerComponent],
      providers: [provideRouter([]), provideTranslateService({ fallbackLang: 'en' })],
    }).compileComponents();
    const fixture = TestBed.createComponent(HangarPickerComponent);
    fixture.componentRef.setInput('kind', 'ship');
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('does not expand on the first pixel of hover — 300 ms delay', fakeAsync(() => {
    return setup().then((fixture) => {
      const el: HTMLElement = fixture.nativeElement;
      const picker = el.querySelector('.picker')!;
      picker.dispatchEvent(new Event('mouseenter'));
      fixture.detectChanges();
      expect(fixture.componentInstance.expanded()).toBeFalse();

      tick(299);
      fixture.detectChanges();
      expect(fixture.componentInstance.expanded()).toBeFalse();

      tick(1);
      fixture.detectChanges();
      expect(fixture.componentInstance.expanded()).toBeTrue();
    });
  }));

  it('expands immediately on focus, no wait', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector<HTMLAnchorElement>('.picker-btn')!;
    btn.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toBeTrue();
  });

  it('Escape collapses the chain', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    cmp.expanded.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const picker = el.querySelector<HTMLElement>('.picker')!;
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(cmp.expanded()).toBeFalse();
  });

  it('collapses 150 ms after the pointer leaves', fakeAsync(() => {
    return setup().then((fixture) => {
      const cmp = fixture.componentInstance;
      cmp.expanded.set(true);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const picker = el.querySelector<HTMLElement>('.picker')!;
      picker.dispatchEvent(new Event('mouseleave'));
      fixture.detectChanges();
      expect(cmp.expanded()).toBeTrue();

      tick(149);
      expect(cmp.expanded()).toBeTrue();
      tick(1);
      expect(cmp.expanded()).toBeFalse();
    });
  }));

  it('emits `pick` with the item id when a chain entry is clicked', async () => {
    const fixture = await setup();
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();
    const picked: string[] = [];
    fixture.componentInstance.pick.subscribe((id) => picked.push(id));

    const el: HTMLElement = fixture.nativeElement;
    const items = el.querySelectorAll<HTMLAnchorElement>('.picker-chain__item');
    expect(items.length).toBe(3);
    items[1].click();
    expect(picked).toEqual(['b']);
  });

  it('emits `open` when the button is clicked while already expanded (a mouse click after hover)', async () => {
    const fixture = await setup();
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();
    let opened = 0;
    fixture.componentInstance.open.subscribe(() => opened++);

    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLAnchorElement>('.picker-btn')!.click();
    expect(opened).toBe(1);
  });

  it('a click while collapsed expands first (touch stand-in for hover) instead of opening', async () => {
    const fixture = await setup();
    let opened = 0;
    fixture.componentInstance.open.subscribe(() => opened++);

    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLAnchorElement>('.picker-btn')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toBeTrue();
    expect(opened).toBe(0);
  });

  it('with no items, a click opens directly — there is nothing to expand', async () => {
    const fixture = await setup([]);
    let opened = 0;
    fixture.componentInstance.open.subscribe(() => opened++);
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLAnchorElement>('.picker-btn')!.click();
    expect(opened).toBe(1);
    expect(el.querySelector('.picker-chain')).toBeNull();
  });

  it('renders chain items and the button as real anchors with a navigable href', async () => {
    const fixture = await setup();
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    const btn = el.querySelector<HTMLAnchorElement>('.picker-btn')!;
    expect(btn.getAttribute('href')).toContain('/hangar');

    const items = el.querySelectorAll<HTMLAnchorElement>('.picker-chain__item');
    expect(items[1].getAttribute('href')).toContain('/codex/ship/b');
  });

  it('a ctrl+click on a chain item does not emit `pick` — it falls through to the anchor', async () => {
    const fixture = await setup();
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();
    const picked: string[] = [];
    fixture.componentInstance.pick.subscribe((id) => picked.push(id));

    const el: HTMLElement = fixture.nativeElement;
    const item = el.querySelectorAll<HTMLAnchorElement>('.picker-chain__item')[1];
    item.dispatchEvent(new MouseEvent('click', { button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(picked).toEqual([]);
  });

  it('a ctrl+click on the button does not expand/open — it falls through to the anchor', async () => {
    const fixture = await setup();
    let opened = 0;
    fixture.componentInstance.open.subscribe(() => opened++);
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLAnchorElement>('.picker-btn')!.dispatchEvent(
      new MouseEvent('click', { button: 0, ctrlKey: true, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toBeFalse();
    expect(opened).toBe(0);
  });

  it('marks the active item and uses the amber styling hook for kind="set"', async () => {
    const fixture = await setup();
    fixture.componentRef.setInput('kind', 'set');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.picker.amber')).not.toBeNull();
    const on = el.querySelector('.picker-chain__item.on');
    expect(on?.textContent?.trim()).toBe('Avenger Stalker');
  });

  it('kind="set" routes chain items to /codex/set/:id', async () => {
    const fixture = await setup();
    fixture.componentRef.setInput('kind', 'set');
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const items = el.querySelectorAll<HTMLAnchorElement>('.picker-chain__item');
    expect(items[1].getAttribute('href')).toContain('/codex/set/b');
  });

  it('docked=true drops the absolute positioning so a wrapper alone places it', async () => {
    const fixture = await setup();
    fixture.componentRef.setInput('docked', true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const picker = el.querySelector<HTMLElement>('.picker')!;
    expect(picker.classList.contains('docked')).toBeTrue();
    expect(getComputedStyle(picker).position).toBe('static');
  });
});
