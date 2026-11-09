import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { CodexLandingCodexPaneComponent, FILL_ROWS, visibleEntries, withEarlierPatches } from './codex-landing-codex-pane.component';
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

describe('withEarlierPatches (#318)', () => {
  interface R {
    id: string;
    isNew?: boolean;
    patch?: string;
    head?: string;
  }
  const head = (patch: string): R => ({ id: 'h' + patch, head: patch });
  const ids = (rows: R[]) => rows.map((r) => r.id);

  it('fills the space the current patch leaves with earlier patches, newest first, each under a header, new before updated', () => {
    const current: R[] = [{ id: 'c0', isNew: true }];
    const earlier: R[] = [
      { id: 'a0', patch: '4.10.2' },
      { id: 'a1', patch: '4.10.2', isNew: true },
      { id: 'b0', patch: '4.10.1', isNew: true },
    ];
    expect(ids(withEarlierPatches(current, earlier, head))).toEqual(['c0', 'h4.10.2', 'a1', 'a0', 'h4.10.1', 'b0']);
  });

  it('never grows past the fill budget, and a full current patch gets no fill', () => {
    const many = (n: number, patch?: string): R[] => Array.from({ length: n }, (_, i) => ({ id: (patch ?? 'c') + i, patch }));
    expect(withEarlierPatches(many(FILL_ROWS - 3), many(10, '4.9'), head).length).toBe(FILL_ROWS);
    expect(ids(withEarlierPatches(many(FILL_ROWS - 1), many(10, '4.9'), head))).toEqual(ids(many(FILL_ROWS - 1)));
    expect(withEarlierPatches(many(30), many(10, '4.9'), head).length).toBe(30);
  });
});

describe('Codex landing pane', () => {
  let fixture: ComponentFixture<CodexLandingCodexPaneComponent>;
  let host: HTMLElement;

  /** The real pane at 1280x720, the tightest window the landing is built for. */
  function mount(news: { category: LandingCategory; entries: LandingCodexEntry[]; discover?: boolean; earlier?: LandingCodexEntry[] }[], active: LandingCategory, current: LandingItem | null, height: number | 'auto' = 400): void {
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
  const rowsShown = () => Array.from(host.querySelectorAll<HTMLElement>('.new li:not(.cut) .nm')).map((n) => n.textContent!.trim());

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
    const picked = vi.fn().mockName('pickEntry');
    fixture.componentInstance.pickEntry.subscribe(picked);
    host.querySelectorAll<HTMLAnchorElement>('a.ent')[2].click();
    expect(picked).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('a.go')[2].getAttribute('href')).toContain('E2');
    const turn = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    host.querySelector('.new')!.dispatchEvent(turn);
    expect(turn.defaultPrevented, 'the page keeps the mouse wheel').toBe(false);
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
      expect(body.scrollHeight, 'no hidden overflow in the pane').toBeLessThanOrEqual(body.clientHeight);
      expect(open.scrollTop, 'the list never scrolls').toBe(0);
      const lastRow = Array.from(host.querySelectorAll('.new li:not(.cut)')).pop()!.getBoundingClientRect();
      expect(lastRow.bottom, 'the last row stands above the foot').toBeLessThanOrEqual(host.querySelector('.foot')!.getBoundingClientRect().top + 1);
      expect(host.querySelector('a.more')!.textContent).toContain(String(40 - shown.length));
      expect(host.querySelector('a.keys')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.getBoundingClientRect().bottom + 1);
    });
  });

  it('lists the new items of every category, the active one first (#318)', () => {
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
    settle();
    expect(rowsShown()).toEqual(['Tool 0', 'Ship 0', 'Ship 1', 'Gun 0']);
    const glyphs = Array.from(host.querySelectorAll('.new li .cat')).map((g) => g.textContent!.trim());
    expect(new Set(glyphs).size, 'each row tagged with its category glyph').toBe(3);
    expect(host.querySelector('a.more'), 'armour has nothing new of its own').toBeNull();
    expect(host.querySelector('.ph')!.textContent).toContain('neu in');
  });

  it('lists every completely new entry first, each with a "neu" tag, then the updated ones (#328)', () => {
    const ships = entries(3, 'S', 'Ship').map((e, i) => ({ ...e, ...(i === 2 ? { isNew: true } : { updated: true }) }));
    const guns = entries(2, 'W', 'Gun').map((e, i) => ({ ...e, ...(i === 0 ? { isNew: true } : { updated: true }) }));
    const tools = entries(1, 'T', 'Tool').map((e) => ({ ...e, isNew: true }));
    mount(
      [
        { category: 'ship', entries: ships },
        { category: 'fpsWeapon', entries: guns },
        { category: 'tool', entries: tools },
      ],
      'fpsWeapon',
      null,
    );
    settle();
    expect(rowsShown()).toEqual(['Gun 0', 'Tool 0', 'Ship 2', 'Gun 1', 'Ship 0', 'Ship 1']);
    const rows = Array.from(host.querySelectorAll<HTMLElement>('.new li:not(.cut)'));
    const fresh = rows.map((li) => !!li.querySelector('.upd.fresh'));
    expect(fresh).toEqual([true, true, true, false, false, false]);
    rows.slice(0, 3).forEach((li) => expect(li.querySelector('.upd.fresh')!.textContent!.trim()).toBe('neu'));
  });

  it('the more link names new & updated entries; in discovery mode it only says "weitere"', () => {
    mount([{ category: 'tool', entries: entries(40) }], 'tool', item('tool', 'E0'));
    settle();
    expect(host.querySelector('a.more')!.textContent).toContain('neue & aktualisierte');
    host.remove();
    TestBed.resetTestingModule();
    mount([{ category: 'ship', entries: entries(40), discover: true }], 'ship', item('ship', 'E0'));
    settle();
    const more = host.querySelector('a.more')!.textContent!;
    expect(more).toContain('weitere');
    expect(more).not.toContain('neue');
  });

  it('earlier patches fill the list under their own patch header; with no news of its own the title says "zuletzt neu" (#318)', () => {
    const older = (n: number, patch: string) => entries(n, 'P' + patch, 'Old ' + patch).map((e) => ({ ...e, patch, isNew: true }));
    mount(
      [
        { category: 'ship', entries: entries(4), discover: true, earlier: [...older(1, '4.8'), ...older(2, '4.9')] },
        { category: 'tool', entries: entries(2, 'T'), discover: true },
      ],
      'ship',
      null,
      'auto',
    );
    settle();
    expect(host.querySelector('.ph')!.textContent).toContain('zuletzt neu');
    const heads = Array.from(host.querySelectorAll<HTMLElement>('.new li.grp')).map((li) => li.textContent!.trim());
    expect(heads).toEqual(['Patch 4.9', 'Patch 4.8']);
    expect(rowsShown()).toEqual(['Old 4.9 0', 'Old 4.9 1', 'Old 4.8 0']);
  });

  it("a category with only discovery picks shows the others' news, not its picks", () => {
    mount(
      [
        { category: 'ship', entries: entries(2, 'S', 'Ship') },
        { category: 'armor', entries: entries(8, 'A', 'Armor'), discover: true },
      ],
      'armor',
      null,
    );
    settle();
    expect(rowsShown()).toEqual(['Ship 0', 'Ship 1']);
    expect(host.querySelector('a.more')).toBeNull();
  });

  it("\"+ N weitere\" counts only the active category; a click names the entry's own category", () => {
    mount(
      [
        { category: 'ship', entries: entries(4, 'S', 'Ship') },
        { category: 'component', entries: entries(30, 'C', 'Comp') },
      ],
      'component',
      null,
    );
    settle();
    const shown = rowsShown();
    expect(shown[0]).toBe('Comp 0');
    const comps = shown.filter((n) => n.startsWith('Comp')).length;
    expect(host.querySelector('a.more')!.textContent).toContain(String(30 - comps));
    let picked: { category: string } | null = null;
    fixture.componentInstance.pickEntry.subscribe((p) => (picked = p));
    host.querySelectorAll<HTMLAnchorElement>('.new li a.ent')[0].dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
    expect(picked!.category).toBe('component');
  });

  it('is as tall as its content, and a long list still fits the 400px cap', () => {
    mount([{ category: 'tool', entries: entries(2) }], 'tool', item('tool', 'E1'), 'auto');
    settle();
    expect(host.getBoundingClientRect().height, 'a short list keeps the pane short').toBeLessThan(330);
    const foot = host.querySelector('.foot')!.getBoundingClientRect();
    const lastRow = host.querySelectorAll('.new li')[1].getBoundingClientRect();
    expect(foot.top - lastRow.bottom, 'the foot follows the list, no empty middle').toBeLessThan(40);
    host.remove();
    TestBed.resetTestingModule();
    mount([{ category: 'tool', entries: entries(40) }], 'tool', item('tool', 'E10'), 'auto');
    settle();
    const body = host.querySelector<HTMLElement>('.body')!;
    expect(host.getBoundingClientRect().height).toBeLessThanOrEqual(400.5);
    expect(body.scrollHeight, 'no hidden overflow with a long list').toBeLessThanOrEqual(body.clientHeight);
    expect(rowsShown().length).toBeLessThan(40);
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
