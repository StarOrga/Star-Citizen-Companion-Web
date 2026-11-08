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

function entries(n: number, prefix = 'E', label = 'Entry'): LandingCodexEntry[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${label} ${i}`, route: ['/codex', 'weapon', `${prefix}${i}`], announced: false }));
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

  /** The real pane at 1280x720, the tightest window the landing is built for. */
  function mount(news: { category: LandingCategory; entries: LandingCodexEntry[] }[], active: LandingCategory, current: LandingItem | null, height: number | 'auto' = 400): void {
    TestBed.configureTestingModule({ imports: [CodexLandingCodexPaneComponent], providers: [provideRouter([]), provideTranslateService()] });
    const tr = TestBed.inject(TranslateService);
    tr.setTranslation('de', de as never);
    tr.use('de');
    fixture = TestBed.createComponent(CodexLandingCodexPaneComponent);
    host = fixture.nativeElement as HTMLElement;
    const size = height === 'auto' ? 'height:auto;max-height:400px' : `height:${height}px`;
    host.style.cssText = `display:flex;flex-direction:column;width:200px;${size};position:absolute;left:0;top:0;`;
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

  it('lists the new items of every category, not only the active one (#318)', () => {
    mount(
      [
        { category: 'ship', entries: entries(2, 'S', 'Ship') },
        { category: 'fpsWeapon', entries: entries(1, 'W', 'Gun') },
        { category: 'armor', entries: [] },
        { category: 'tool', entries: entries(1, 'T', 'Tool') },
      ],
      'armor',
      item('armor', 'I_armor'),
    );
    expect(rowsShown()).toEqual(['Ship 0', 'Ship 1', 'Gun 0', 'Tool 0']);
    const glyphs = Array.from(host.querySelectorAll('.new li .cat')).map((g) => g.textContent!.trim());
    expect(new Set(glyphs).size).withContext('each row tagged with its category glyph').toBe(3);
    expect(host.querySelector('a.more')).withContext('armour has nothing new of its own').toBeNull();
  });

  it('the wheel spans all categories and centres the active one; "+ N" counts only the active category', () => {
    mount(
      [
        { category: 'ship', entries: entries(4, 'S', 'Ship') },
        { category: 'component', entries: entries(6, 'C', 'Comp') },
      ],
      'component',
      null,
    );
    expect(rowsShown()).toEqual(['Ship 2', 'Ship 3', 'Comp 0', 'Comp 1', 'Comp 2']);
    expect(host.querySelector('a.more')!.textContent).toContain('3');
    const click = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    let picked: unknown = null;
    fixture.componentInstance.pickEntry.subscribe((p) => (picked = p));
    host.querySelectorAll<HTMLAnchorElement>('.new li a.ent')[0].dispatchEvent(click);
    expect(picked).toEqual({ category: 'ship', entry: { id: 'S2', name: 'Ship 2', route: ['/codex', 'weapon', 'S2'], announced: false } });
  });

  it('is as tall as its content, and a full wheel still fits the 400px cap at 1280x720', () => {
    mount([{ category: 'tool', entries: entries(2) }], 'tool', item('tool', 'E1'), 'auto');
    expect(host.getBoundingClientRect().height).withContext('a short list keeps the pane short').toBeLessThan(330);
    const foot = host.querySelector('.foot')!.getBoundingClientRect();
    const lastRow = host.querySelectorAll('.new li')[1].getBoundingClientRect();
    expect(foot.top - lastRow.bottom).withContext('the foot follows the list, no empty middle').toBeLessThan(20);
    host.remove();
    TestBed.resetTestingModule();

    mount([{ category: 'tool', entries: entries(20) }], 'tool', item('tool', 'E10'), 'auto');
    const body = host.querySelector<HTMLElement>('.body')!;
    expect(host.getBoundingClientRect().height).toBeLessThanOrEqual(400);
    expect(body.scrollHeight).withContext('no hidden overflow with a full wheel').toBeLessThanOrEqual(body.clientHeight);
    expect(rowsShown().length).toBe(WHEEL_ROWS);
  });
});
