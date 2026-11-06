import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { CodexLandingCodexPaneComponent, WHEEL_ROWS, wheelWindow } from './codex-landing-codex-pane.component';
import { LandingCategory, LandingCodexEntry, LandingItem } from './codex-landing-data.types';
import de from '../../../../public/i18n/de.json';

function item(category: LandingCategory, className: string): LandingItem {
  return {
    category,
    kind: 'weapon',
    className,
    name: className,
    eyebrow: { manufacturer: null, descriptor: null },
    detailRoute: ['/codex', 'weapon', className],
    imageUrl: null,
    previewUrl: null,
    overview: [],
    topValues: [],
  };
}

function entries(n: number): LandingCodexEntry[] {
  return Array.from({ length: n }, (_, i) => ({ id: `E${i}`, name: `Entry ${i}`, route: ['/codex', 'weapon', `E${i}`], announced: false }));
}

describe('wheelWindow', () => {
  it('shows everything in order when it fits', () => {
    expect(wheelWindow(3, 1)).toEqual([0, 1, 2]);
    expect(wheelWindow(WHEEL_ROWS, 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it('centres the wheel and wraps around both ends', () => {
    expect(wheelWindow(8, 3)).toEqual([1, 2, 3, 4, 5]);
    expect(wheelWindow(8, 0)).toEqual([6, 7, 0, 1, 2]);
    expect(wheelWindow(8, 7)).toEqual([5, 6, 7, 0, 1]);
    expect(wheelWindow(8, -1)).toEqual([5, 6, 7, 0, 1]);
  });
});

describe('Codex landing pane', () => {
  let fixture: ComponentFixture<CodexLandingCodexPaneComponent>;
  let host: HTMLElement;

  /** The real pane size at 1280x720, the tightest window the landing is built for. */
  function mount(news: { category: LandingCategory; entries: LandingCodexEntry[] }[], active: LandingCategory, current: LandingItem | null, height = 348): void {
    TestBed.configureTestingModule({ imports: [CodexLandingCodexPaneComponent], providers: [provideRouter([]), provideTranslateService()] });
    const tr = TestBed.inject(TranslateService);
    tr.setTranslation('de', de as never);
    tr.use('de');
    fixture = TestBed.createComponent(CodexLandingCodexPaneComponent);
    host = fixture.nativeElement as HTMLElement;
    host.style.cssText = `display:flex;flex-direction:column;width:257px;height:${height}px;position:absolute;left:0;top:0;`;
    document.body.appendChild(host);
    fixture.componentRef.setInput('items', news.map((n) => item(n.category, `I_${n.category}`)));
    fixture.componentRef.setInput('codex', { patch: '4.10', categories: news.map((n) => ({ ...n, count: n.entries.length, announced: 0 })) });
    fixture.componentRef.setInput('active', active);
    fixture.componentRef.setInput('current', current);
    fixture.detectChanges();
  }

  afterEach(() => host?.remove());

  const rowsShown = () => Array.from(host.querySelectorAll<HTMLElement>('.new li .nm')).map((n) => n.textContent!.trim());

  it('without anything new the middle is gone, the on-table item included; title, tabs and foot stay', () => {
    mount([{ category: 'ship', entries: [] }], 'ship', item('ship', 'I_ship'));
    expect(host.querySelector('.open')).toBeNull();
    expect(host.querySelector('.ph')).not.toBeNull();
    expect(host.querySelector('.tabs')).not.toBeNull();
    expect(host.querySelector('.foot a.all')).not.toBeNull();
    expect(host.querySelector('.foot a.keys')).not.toBeNull();
    expect(host.querySelector('.foot a.more')).toBeNull();
  });

  it('too many entries: a fixed wheel with the table entry in the middle, "+ N" counts the rest and opens the filtered index', () => {
    const list = entries(20);
    mount([{ category: 'tool', entries: list }], 'tool', item('tool', 'E10'));
    expect(rowsShown()).toEqual(['Entry 8', 'Entry 9', 'Entry 10', 'Entry 11', 'Entry 12']);
    expect(host.querySelectorAll('.new li')[2].classList).toContain('table');
    const more = host.querySelector<HTMLAnchorElement>('a.more')!;
    expect(more.textContent).toContain('15');
    expect(more.getAttribute('href')).toContain('fresh=1');
    expect(more.getAttribute('href')).not.toContain('sort=');
    expect(host.querySelector<HTMLAnchorElement>('a.all')!.getAttribute('href')).not.toContain('fresh');
  });

  it('turning the wheel moves the rows and keeps the turn from the page; a short list leaves the wheel alone', () => {
    mount([{ category: 'tool', entries: entries(8) }], 'tool', item('tool', 'E3'));
    const list = host.querySelector<HTMLElement>('.new')!;
    const turn = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    list.dispatchEvent(turn);
    fixture.detectChanges();
    expect(turn.defaultPrevented).toBeTrue();
    expect(rowsShown()[0]).toBe('Entry 3');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(rowsShown()[0]).toBe('Entry 2');
    // Another entry on the table centres it again.
    fixture.componentRef.setInput('current', item('tool', 'E5'));
    fixture.detectChanges();
    expect(rowsShown()[2]).toBe('Entry 5');
    host.remove();
    TestBed.resetTestingModule();

    mount([{ category: 'tool', entries: entries(3) }], 'tool', item('tool', 'E1'));
    const still = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    host.querySelector('.new')!.dispatchEvent(still);
    expect(still.defaultPrevented).withContext('the page keeps the turn').toBeFalse();
  });

  it('title, tabs and foot hold their place from an empty middle to a full wheel, and everything fits at 1280x720', () => {
    const y = (sel: string) => Math.round(host.querySelector(sel)!.getBoundingClientRect().top);
    mount([{ category: 'tool', entries: entries(20) }], 'tool', item('tool', 'E10'));
    const full = { ph: y('.ph'), tabs: y('.tabs'), all: y('a.all'), keys: y('a.keys') };
    const body = host.querySelector<HTMLElement>('.body')!;
    expect(body.scrollHeight).withContext('no hidden overflow with a full wheel').toBeLessThanOrEqual(body.clientHeight);
    expect(rowsShown().length).toBe(WHEEL_ROWS);
    const lastRow = host.querySelectorAll('.new li')[WHEEL_ROWS - 1].getBoundingClientRect();
    expect(lastRow.bottom).withContext('the last row stands above the foot').toBeLessThanOrEqual(host.querySelector('.foot')!.getBoundingClientRect().top + 1);
    host.remove();
    TestBed.resetTestingModule();

    mount([{ category: 'tool', entries: [] }], 'tool', item('tool', 'E10'));
    expect({ ph: y('.ph'), tabs: y('.tabs'), all: y('a.all'), keys: y('a.keys') }).toEqual(full);
  });
});
