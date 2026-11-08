import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { CodexLandingCodexPaneComponent, visibleEntries } from './codex-landing-codex-pane.component';
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

describe('visibleEntries', () => {
  const list = (n: number, table = -1) => Array.from({ length: n }, (_, i) => ({ id: i, onTable: i === table }));

  it('shows everything in order when it fits', () => {
    expect(visibleEntries(list(3), 5).map((e) => e.id)).toEqual([0, 1, 2]);
    expect(visibleEntries(list(5, 4), 5).map((e) => e.id)).toEqual([0, 1, 2, 3, 4]);
  });

  it('cuts to the capacity and keeps the entry on the table among the rows', () => {
    expect(visibleEntries(list(10, 1), 4).map((e) => e.id)).toEqual([0, 1, 2, 3]);
    expect(visibleEntries(list(10, 8), 4).map((e) => e.id)).toEqual([0, 1, 2, 8]);
    expect(visibleEntries(list(10, 8), 0).map((e) => e.id)).toEqual([8]);
  });
});

describe('Codex landing pane', () => {
  let fixture: ComponentFixture<CodexLandingCodexPaneComponent>;
  let host: HTMLElement;

  /** The real pane at 1280x720, the tightest window the landing is built for. */
  function mount(news: { category: LandingCategory; entries: LandingCodexEntry[]; discover?: boolean }[], active: LandingCategory, current: LandingItem | null, height = 400): void {
    TestBed.configureTestingModule({ imports: [CodexLandingCodexPaneComponent], providers: [provideRouter([]), provideTranslateService()] });
    const tr = TestBed.inject(TranslateService);
    tr.setTranslation('de', de as never);
    tr.use('de');
    fixture = TestBed.createComponent(CodexLandingCodexPaneComponent);
    host = fixture.nativeElement as HTMLElement;
    host.style.cssText = `display:flex;flex-direction:column;width:200px;height:${height}px;position:absolute;left:0;top:0;`;
    document.body.appendChild(host);
    fixture.componentRef.setInput('items', news.map((n) => item(n.category, `I_${n.category}`)));
    fixture.componentRef.setInput('codex', { patch: '4.10', categories: news.map((n) => ({ ...n, count: n.discover ? 0 : n.entries.length, announced: 0 })) });
    fixture.componentRef.setInput('active', active);
    fixture.componentRef.setInput('current', current);
    fixture.detectChanges();
  }

  afterEach(() => host?.remove());

  const settle = () => {
    fixture.detectChanges();
    fixture.detectChanges();
  };
  const rowsShown = () => Array.from(host.querySelectorAll<HTMLElement>('.new li .nm')).map((n) => n.textContent!.trim());

  it('with nothing new the list offers entries to discover: title without "neu", no new tag, the index link without the fresh filter', () => {
    mount([{ category: 'ship', entries: entries(20), discover: true }], 'ship', item('ship', 'E0'));
    settle();
    expect(host.querySelector('.open')).not.toBeNull();
    expect(rowsShown().length).toBeGreaterThan(0);
    expect(host.querySelector('.ph')!.textContent).toContain('4.10');
    expect(host.querySelector('.ph')!.textContent).not.toContain('neu');
    expect(host.querySelector('.new .upd')).toBeNull();
    expect(host.querySelector<HTMLAnchorElement>('a.more')!.getAttribute('href')).not.toContain('fresh');
  });

  it('real new and changed entries carry their tags and the "neu in" title', () => {
    const list = entries(3);
    list[0] = { ...list[0], isNew: true };
    list[1] = { ...list[1], updated: true };
    mount([{ category: 'tool', entries: list }], 'tool', item('tool', 'E0'));
    settle();
    expect(host.querySelector('.ph')!.textContent).toContain('neu in');
    expect(Array.from(host.querySelectorAll('.new .upd')).map((e) => e.textContent!.trim())).toEqual(['neu', 'aktualisiert']);
  });

  it('a plain click on an entry puts it on the table (held), the arrow opens the page; no wheel', () => {
    mount([{ category: 'tool', entries: entries(4) }], 'tool', item('tool', 'E0'));
    settle();
    const picked = jasmine.createSpy('pickEntry');
    fixture.componentInstance.pickEntry.subscribe(picked);
    host.querySelectorAll<HTMLAnchorElement>('a.ent')[2].click();
    expect(picked).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('a.go')[2].getAttribute('href')).toContain('E2');
    const turn = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    host.querySelector('.new')!.dispatchEvent(turn);
    expect(turn.defaultPrevented).withContext('the page keeps the mouse wheel').toBeFalse();
  });

  // The landing pane is 400px high at 1280x720 and grows on a full-HD window.
  [400, 560].forEach((h) => {
    it(`pane height ${h}px: as many rows as fit, the rest behind "+ N weitere", the table entry visible, nothing scrolls`, () => {
      mount([{ category: 'tool', entries: entries(40) }], 'tool', item('tool', 'E30'), h);
      settle();
      const body = host.querySelector<HTMLElement>('.body')!;
      const open = host.querySelector<HTMLElement>('.open')!;
      const shown = rowsShown();
      expect(shown.length).toBeGreaterThanOrEqual(3);
      expect(shown).toContain('Entry 30');
      expect(body.scrollHeight).withContext('no hidden overflow in the pane').toBeLessThanOrEqual(body.clientHeight);
      expect(open.scrollHeight).withContext('no scrolling in the list').toBeLessThanOrEqual(open.clientHeight + 1);
      const lastRow = Array.from(host.querySelectorAll('.new li')).pop()!.getBoundingClientRect();
      expect(lastRow.bottom).withContext('the last row stands above the foot').toBeLessThanOrEqual(host.querySelector('.foot')!.getBoundingClientRect().top + 1);
      expect(host.querySelector('a.more')!.textContent).toContain(String(40 - shown.length));
      expect(host.querySelector('a.keys')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.getBoundingClientRect().bottom + 1);
    });
  });

  it('a taller pane shows more rows than a short one', () => {
    mount([{ category: 'tool', entries: entries(40) }], 'tool', item('tool', 'E0'), 400);
    settle();
    const short = rowsShown().length;
    host.remove();
    TestBed.resetTestingModule();
    mount([{ category: 'tool', entries: entries(40) }], 'tool', item('tool', 'E0'), 600);
    settle();
    expect(rowsShown().length).toBeGreaterThan(short);
  });

  it('a short list shows everything and no "+ N weitere"', () => {
    mount([{ category: 'tool', entries: entries(3) }], 'tool', item('tool', 'E1'));
    settle();
    expect(rowsShown().length).toBe(3);
    expect(host.querySelector('a.more')).toBeNull();
  });
});
