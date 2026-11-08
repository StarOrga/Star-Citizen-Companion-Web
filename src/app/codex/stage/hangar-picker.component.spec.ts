import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { BETA_STORAGE_KEY } from '../../core/beta.service';
import { HangarPickerComponent, HangarPickerItem } from './hangar-picker.component';

const ITEMS: HangarPickerItem[] = [
  { id: 'a', label: 'Avenger Stalker', active: true },
  { id: 'b', label: 'Gladius', active: false },
  { id: 'c', label: 'Cutlass Black', active: false },
];

describe('HangarPickerComponent', () => {
  async function setup(items: HangarPickerItem[] = ITEMS): Promise<ComponentFixture<HangarPickerComponent>> {
    // No compileComponents(): the components are AOT-compiled, and its native
    // promise would escape fakeAsync (Angular code runs untransformed under Vitest).
    TestBed.configureTestingModule({
      imports: [HangarPickerComponent],
      providers: [provideRouter([]), provideTranslateService({ fallbackLang: 'en' })],
    });
    const fixture = TestBed.createComponent(HangarPickerComponent);
    fixture.componentRef.setInput('kind', 'ship');
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  /**
   * Ctrl+click an anchor the way a user would, minus the browser's part. The
   * component is meant to leave such a click to the browser — which, left
   * alone, opens a REAL tab and sends Karma's page to the background, where it
   * renders no frames for the rest of the run (see
   * `testing/new-tab-guard.spec.ts`). So the click is swallowed on `window`,
   * after every listener of the page has seen it. Returns whether the page
   * left the click to the browser.
   */
  function ctrlClick(target: HTMLElement): boolean {
    let leftToBrowser = false;
    const swallow = (ev: Event) => {
      leftToBrowser = !ev.defaultPrevented;
      ev.preventDefault();
    };
    window.addEventListener('click', swallow);
    target.dispatchEvent(new MouseEvent('click', { button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
    window.removeEventListener('click', swallow);
    return leftToBrowser;
  }

  it('does not expand on the first pixel of hover — 300 ms delay', fakeAsync(() => {
    return setup().then((fixture) => {
      const el: HTMLElement = fixture.nativeElement;
      const picker = el.querySelector('.picker')!;
      picker.dispatchEvent(new Event('mouseenter'));
      fixture.detectChanges();
      expect(fixture.componentInstance.expanded()).toBe(false);

      tick(299);
      fixture.detectChanges();
      expect(fixture.componentInstance.expanded()).toBe(false);

      tick(1);
      fixture.detectChanges();
      expect(fixture.componentInstance.expanded()).toBe(true);
    });
  }));

  it('expands immediately on focus, no wait', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector<HTMLAnchorElement>('.picker-btn')!;
    btn.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toBe(true);
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
    expect(cmp.expanded()).toBe(false);
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
      expect(cmp.expanded()).toBe(true);

      tick(149);
      expect(cmp.expanded()).toBe(true);
      tick(1);
      expect(cmp.expanded()).toBe(false);
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
    expect(fixture.componentInstance.expanded()).toBe(true);
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
    expect(btn.getAttribute('href')).toContain('/hq/hangar');

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
    expect(ctrlClick(item), 'the anchor keeps the click for its new tab').toBe(true);
    expect(picked).toEqual([]);
  });

  it('a ctrl+click on the button does not expand/open — it falls through to the anchor', async () => {
    const fixture = await setup();
    let opened = 0;
    fixture.componentInstance.open.subscribe(() => opened++);
    const el: HTMLElement = fixture.nativeElement;
    expect(ctrlClick(el.querySelector<HTMLAnchorElement>('.picker-btn')!), 'the anchor keeps the click for its new tab').toBe(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toBe(false);
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

  it('kind="set" routes chain items to /hq/locker/:id', async () => {
    const fixture = await setup();
    fixture.componentRef.setInput('kind', 'set');
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const items = el.querySelectorAll<HTMLAnchorElement>('.picker-chain__item');
    expect(items[1].getAttribute('href')).toContain('/hq/locker/b');
  });

  it('docked=true drops the absolute positioning so a wrapper alone places it', async () => {
    const fixture = await setup();
    fixture.componentRef.setInput('docked', true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const picker = el.querySelector<HTMLElement>('.picker')!;
    expect(picker.classList.contains('docked')).toBe(true);
    expect(getComputedStyle(picker).position).toBe('static');
  });
});

describe('HangarPickerComponent - shell beta (concept r1-flag)', () => {
  async function mount(kind: 'ship' | 'set', shell: boolean): Promise<HTMLElement> {
    localStorage.setItem(BETA_STORAGE_KEY, JSON.stringify({ shell }));
    await TestBed.configureTestingModule({
      imports: [HangarPickerComponent],
      providers: [provideRouter([]), provideTranslateService({ fallbackLang: 'en' })],
    }).compileComponents();
    const fixture = TestBed.createComponent(HangarPickerComponent);
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('items', ITEMS);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => {
    localStorage.removeItem(BETA_STORAGE_KEY);
    TestBed.resetTestingModule();
  });

  it('renders no hangar button with the shell beta on', async () => {
    expect((await mount('ship', true)).querySelector('.picker-btn')).toBeNull();
  });

  it('keeps the hangar button without the shell beta', async () => {
    expect((await mount('ship', false)).querySelector('.picker-btn')).not.toBeNull();
  });

  it('keeps the Sets button even with the shell beta on', async () => {
    expect((await mount('set', true)).querySelector('.picker-btn')).not.toBeNull();
  });
});
