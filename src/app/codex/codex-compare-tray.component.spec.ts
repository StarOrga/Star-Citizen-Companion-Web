import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexService } from './codex.service';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';

describe('CodexCompareTrayComponent', () => {
  const keys = signal<string[]>([]);
  const rejected = signal<string | null>(null);
  let unpin: jasmine.Spy;
  let clearCompare: jasmine.Spy;
  let getDetail: jasmine.Spy;

  function mount(initial: string[]) {
    keys.set(initial);
    rejected.set(null);
    unpin = jasmine.createSpy('unpin');
    clearCompare = jasmine.createSpy('clearCompare');
    getDetail = jasmine.createSpy('getDetail').and.resolveTo(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        {
          provide: CodexService,
          useValue: { compareKeys: keys, compareRejectedKind: rejected, unpin, clearCompare, getDetail },
        },
      ],
    });
    const fixture = TestBed.createComponent(CodexCompareTrayComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renders nothing while nothing is pinned', () => {
    const { el } = mount([]);
    expect(el.querySelector('.tray')).toBeNull();
  });

  it('shows pinned entries as real anchors to /codex/<kind>/<className>', () => {
    const { el } = mount(['ship:aegis_avenger', 'weapon:klwe_laser']);
    const links = Array.from(el.querySelectorAll('a.chip-link')) as HTMLAnchorElement[];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/codex/ship/aegis_avenger',
      '/codex/weapon/klwe_laser',
    ]);
  });

  it('removes a pin via .chip-x and clears all via .clear', () => {
    const { el } = mount(['ship:a', 'ship:b']);
    (el.querySelectorAll('button.chip-x')[1] as HTMLButtonElement).click();
    expect(unpin).toHaveBeenCalledOnceWith('ship:b');
    (el.querySelector('button.clear') as HTMLButtonElement).click();
    expect(clearCompare).toHaveBeenCalled();
  });

  it('offers the compare toggle (a button) only from two pins and opens the panel', async () => {
    const { fixture, el } = mount(['ship:a']);
    expect(el.querySelector('button.toggle')).toBeNull();

    keys.set(['ship:a', 'ship:b']);
    fixture.detectChanges();
    const toggle = el.querySelector('button.toggle') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toContain('codex.compare.open');
    expect(el.querySelector('.panel')).toBeNull();

    toggle.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.tray.expanded')).not.toBeNull();
    expect(el.querySelector('.panel')).not.toBeNull();
    expect(getDetail).toHaveBeenCalledTimes(2);
    expect(el.querySelector('button.toggle')?.textContent).toContain('codex.compare.close');
  });

  it('announces a rejected mixed-kind pin', () => {
    const { fixture, el } = mount(['ship:a']);
    rejected.set('weapon');
    fixture.detectChanges();
    expect(el.querySelector('.reject')?.textContent).toContain('codex.compare.mixedKind');
  });
});
