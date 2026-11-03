import { TestBed } from '@angular/core/testing';
import { HINT_ROTATE_MS, FusionSearchHintComponent } from './fusion-search-hint.component';
import { FusionSearchChipComponent } from './fusion-search-chip.component';
import { searchContextOf } from './search-context';
import { fakeEngine, fxGroup, fxHit, setupFusionSearch } from './fusion-search.testing';
import { sizeChip } from '../../codex/search/search-query-parse';
import { provideTranslateService } from '@ngx-translate/core';
import type { OwnSearchResult } from '../../codex/search/search-own';

const ships = fxGroup('ship', [
  fxHit('ship', 'AEGS_Reclaimer', 'Aegis Reclaimer'),
  fxHit('ship', 'AEGS_Redeemer', 'Aegis Redeemer'),
  fxHit('ship', 'AEGS_Retaliator', 'Aegis Retaliator'),
  fxHit('ship', 'AEGS_Reliant', 'Aegis Re Four'),
  fxHit('ship', 'AEGS_Rex', 'Aegis Re Five'),
], 9);
const weapons = fxGroup('weapon', [fxHit('weapon', 'KLWE_Rhino', 'CF-447 Rhino', { size: 4 })]);
const own: OwnSearchResult = {
  total: 1,
  rows: [{
    type: 'own', id: 'own-ship-1', ownKind: 'ship', title: 'Aegis Redeemer', ownName: 'Bulwark', subtitle: null,
    classNameSlug: 'AEGS_Redeemer', qty: null, target: { link: ['/hq/hangar', '1'], queryParams: null },
  }],
};

describe('FusionSearchComponent panel (concept 2026-11-02)', () => {
  afterEach(() => (document.activeElement as HTMLElement | null)?.blur?.());

  it('draws group tiles: own first with its outline, three rows, "N weitere hier" and a real "Alle N" anchor (A2–A4)', () => {
    const engine = fakeEngine({ groups: [ships, weapons], compose: { own } });
    const { el, type } = setupFusionSearch(engine);
    type('aegis re');
    const groups = [...el.querySelectorAll<HTMLElement>('.group')];
    expect(groups[0].classList).toContain('own');
    expect(groups[0].querySelector('.group-head')!.textContent).toContain('search.group.own');
    const shipTile = groups.find((g) => g.textContent!.includes('codex.kinds.ship'))!;
    expect(shipTile.querySelectorAll('.row').length).toBe(3);
    expect(shipTile.querySelector('.expand')!.textContent).toContain('search.group.expand');
    const more = shipTile.querySelector('a.more') as HTMLAnchorElement;
    expect(more.getAttribute('href')).toContain('/codex/index');
  });

  it('rows: the whole row is an anchor, ONE quiet CTA, a separator and three icons; no compare star (B6, B8, B12)', () => {
    const engine = fakeEngine({ groups: [ships], compose: { flagshipClassName: 'AEGS_Gladius' } });
    const { el, type } = setupFusionSearch(engine);
    type('aegis re');
    const row = el.querySelector('.group .row') as HTMLElement;
    expect(row.querySelector('a.hit')!.getAttribute('href')).toContain('/codex/ship/');
    expect(row.querySelectorAll('.cta').length).toBe(1);
    expect(row.querySelector('.sep')).not.toBeNull();
    const icons = [...row.querySelectorAll<HTMLButtonElement>('.ib')];
    expect(icons.length).toBe(3);
    expect(icons[1].getAttribute('aria-label')).toBe('search.icon.hangar');
    expect(el.querySelector('.qi')).withContext('the old quick icons (pin star, new tab, copy) are gone').toBeNull();
  });

  it('an icon press runs its action and does not open the row', async () => {
    const engine = fakeEngine({ groups: [ships] });
    const { el, type, actions, cmp } = setupFusionSearch(engine);
    type('aegis re');
    const before = cmp.open();
    (el.querySelector('.row .ib') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(actions.icon).toHaveBeenCalledWith('wishlist', jasmine.objectContaining({ type: 'hit' }), 'Aegis Reclaimer');
    expect(engine.calls.noteOpened).withContext('no navigation').toBe(0);
    expect(cmp.open()).toBe(before);
  });

  it('patch rows and app pages carry no CTA and no icons (B10)', () => {
    const engine = fakeEngine({
      groups: [],
      compose: { patches: { total: 1, rows: [{ type: 'patch', id: 'patch-4.3', line: '4.3', title: '4.3', version: '4.3.2', publishedAt: '2026-10-01', target: { link: ['/verse', 'patches', '4.3'], queryParams: null } }] } },
    });
    const { el, type } = setupFusionSearch(engine);
    type('4.3');
    const rows = [...el.querySelectorAll('.row')];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.querySelector('.cta')).toBeNull();
      expect(r.querySelector('.ib')).toBeNull();
    }
  });

  it('accordion: "N weitere" expands in the panel, the others become one summary line, ← collapses (A4)', () => {
    const engine = fakeEngine({ groups: [ships, weapons] });
    const { el, type, key, cmp, fixture } = setupFusionSearch(engine);
    type('aegis re');
    const shipTile = [...el.querySelectorAll<HTMLElement>('.group')].find((g) => g.textContent!.includes('codex.kinds.ship'))!;
    (shipTile.querySelector('.expand') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.summary')).withContext('summary line on top').not.toBeNull();
    expect(el.querySelector('button.why.collapse')!.textContent).toContain('search.group.collapse');
    expect(cmp.expanded()).toBe('ship');
    expect(cmp.viewGroups().length).toBe(1);
    expect(cmp.viewGroups()[0].options.length).toBe(5);
    expect(cmp.summary()!.length).toBeGreaterThan(1);
    key('ArrowDown');
    key('ArrowLeft');
    expect(cmp.expanded()).toBeNull();

    key('ArrowDown');
    key('ArrowRight');
    expect(cmp.expanded()).withContext('→ on a row of an expandable group').toBe('ship');
  });

  it('the dashed outside group shows a fast-exact hit outside the chip filter (A10)', () => {
    const ctx = searchContextOf('/codex/index?kind=weapon');
    const engine = fakeEngine({ groups: [ships, weapons], context: ctx });
    const { el, type } = setupFusionSearch(engine);
    type('aegis reclaimer');
    const out = el.querySelector('.group.outside') as HTMLElement;
    expect(out).not.toBeNull();
    expect(out.textContent).toContain('search.why.outside');
  });

  it('chips: always shown in the field; ⌫ at the start removes the last chip (C3, C5)', () => {
    const engine = fakeEngine({ groups: [weapons], context: searchContextOf('/hq', 'bestand') });
    const { el, field, key, fixture } = setupFusionSearch(engine);
    expect(el.querySelectorAll('sc-fusion-search-chip').length).toBe(1);
    field.setSelectionRange(0, 0);
    key('Backspace');
    fixture.detectChanges();
    expect(engine.calls.removeLastChip).toBe(1);
    expect(el.querySelectorAll('sc-fusion-search-chip').length).toBe(0);
  });

  it('Esc closes at once and keeps the text; the ✕ only clears (A9)', () => {
    const engine = fakeEngine({ groups: [ships] });
    const { el, type, key, cmp, fixture } = setupFusionSearch(engine);
    type('aegis');
    expect(cmp.open()).toBeTrue();
    key('Escape');
    expect(cmp.open()).toBeFalse();
    expect(engine.input()).toBe('aegis');
    cmp.openPanel();
    fixture.detectChanges();
    (el.querySelector('.close.clear') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(engine.input()).toBe('');
    expect(cmp.open()).withContext('clearing does not close').toBeTrue();
  });

  it('the empty field offers recent searches and the rotating hint, no "Bereiche" and no "Hier" (A6, A7)', () => {
    const engine = fakeEngine();
    engine.recent.set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    const { el, field, fixture } = setupFusionSearch(engine);
    field.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('a.term').length).toBe(7);
    expect(el.querySelector('sc-fusion-search-hint')).not.toBeNull();
    expect(el.textContent).not.toContain('codex.search.bar.areas');
    expect(el.textContent).not.toContain('fusionBar.search.here');
  });

  it('the abbreviation line names the alias and the chip the text produced (C6)', () => {
    const engine = fakeEngine({ groups: [weapons] });
    engine.readings.set({ aliases: [{ word: 'rep', to: 'repeater' }], chips: [{ word: 's4', chip: sizeChip(4) }] });
    const { el, type } = setupFusionSearch(engine);
    type('rep s4');
    const line = el.querySelector('.abbr') as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.textContent).toContain('search.abbr.alias');
    expect(line.querySelector('b')!.textContent).toBe('Repeater');
    expect(line.textContent).toContain('search.abbr.chip');
  });

  it('no abbreviation line when nothing was read', () => {
    const { el, type } = setupFusionSearch(fakeEngine({ groups: [weapons] }));
    type('rhino');
    expect(el.querySelector('.abbr')).toBeNull();
  });

  it('the meta line carries concrete ownership: quantity in stock and pieces per ship name (B3)', () => {
    const engine = fakeEngine({
      groups: [weapons],
      compose: {
        ownership: () => ({
          shipId: null, equippedOnShipId: 'h1', inSetIds: [], inLager: true, lagerQty: 3,
          fittedOn: [{ shipId: 'h1', name: 'Nachtfalke', count: 2 }],
        }),
      },
    });
    const { el, type } = setupFusionSearch(engine);
    type('rhino');
    const mine = [...el.querySelectorAll<HTMLElement>('.row .meta .mine')].map((n) => n.textContent!.trim());
    expect(mine).toEqual(['search.own.qty', 'search.own.fittedOn']);
  });
});

describe('FusionSearchChipComponent (C4)', () => {
  function make(chip = sizeChip(4)) {
    TestBed.configureTestingModule({ imports: [FusionSearchChipComponent], providers: [provideTranslateService()] });
    const f = TestBed.createComponent(FusionSearchChipComponent);
    f.componentRef.setInput('chip', chip);
    f.componentRef.setInput('label', 'Größe 4');
    f.detectChanges();
    return f;
  }

  it('opens a menu out of the chip, counts per value, 0 greyed but clickable, mini-search past 7 values', async () => {
    const counts: Record<string, number> = { '1': 2, '2': 3, '3': 4, '4': 9, '5': 1 };
    const chip = sizeChip(4);
    const f = make({ ...chip, options: chip.options!.map((o) => ({ ...o, count: counts[o.value] ?? 0 })) });
    const picked: string[] = [];
    f.componentInstance.pick.subscribe((v) => picked.push(v));
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.menu')).toBeNull();
    (el.querySelector('button.lbl') as HTMLButtonElement).click();
    f.detectChanges();
    await Promise.resolve();
    const menu = el.querySelector('.menu') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(el.querySelector('input.mini')).withContext('11 sizes > 7').not.toBeNull();
    const opts = [...el.querySelectorAll<HTMLButtonElement>('.opt')];
    expect(opts.length).toBe(11);
    expect(opts.find((o) => o.textContent!.includes('9'))!.classList).toContain('on');
    const zero = opts[6];
    expect(zero.classList).toContain('zero');
    expect(zero.disabled).toBeFalse();
    zero.click();
    f.detectChanges();
    expect(picked).toEqual([chip.options![6].value]);
    expect(el.querySelector('.menu')).withContext('closes after a pick').toBeNull();
    // Same colour as the chip: the menu reads the chip's own background variable.
    expect(getComputedStyle(el.querySelector('.chip')!).getPropertyValue('--chip-bg')).toBeTruthy();
  });

  it('a chip that cannot switch has no ▾, only ×', () => {
    const f = make({ ...sizeChip(4), switchable: false });
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('button.lbl')).toBeNull();
    expect(el.querySelector('.cx')).not.toBeNull();
  });
});

describe('FusionSearchHintComponent (A7)', () => {
  it('rotates every ~6 s, pauses on hover, puts its example into the field on click', () => {
    jasmine.clock().install();
    try {
      TestBed.configureTestingModule({ imports: [FusionSearchHintComponent], providers: [provideTranslateService()] });
      const f = TestBed.createComponent(FusionSearchHintComponent);
      f.componentRef.setInput('hints', [{ t: 'eins', q: 'connie' }, { t: 'zwei' }, { t: 'drei', q: 'qt' }]);
      f.detectChanges();
      const cmp = f.componentInstance;
      const first = cmp.index();
      jasmine.clock().tick(HINT_ROTATE_MS + 10);
      expect(cmp.index()).toBe((first + 1) % 3);
      cmp.paused.set(true);
      jasmine.clock().tick(HINT_ROTATE_MS * 2);
      expect(cmp.index()).withContext('paused').toBe((first + 1) % 3);
      cmp.paused.set(false);
      while (!cmp.current()?.q) cmp.next();
      f.detectChanges();
      const picked: string[] = [];
      cmp.pick.subscribe((q) => picked.push(q));
      (f.nativeElement.querySelector('button.line') as HTMLButtonElement).click();
      expect(picked).toEqual([cmp.current()!.q!]);
      expect((f.nativeElement as HTMLElement).querySelectorAll('.line').length).withContext('one line').toBe(1);
      f.destroy();
    } finally {
      jasmine.clock().uninstall();
    }
  });
});

describe('Esc with a mouse-opened chip menu', () => {
  const esc = (target: EventTarget) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  it('the chip closes its own menu on Esc from the toggle (focus stays on it) and from the document', async () => {
    TestBed.configureTestingModule({ imports: [FusionSearchChipComponent], providers: [provideTranslateService()] });
    const f = TestBed.createComponent(FusionSearchChipComponent);
    f.componentRef.setInput('chip', sizeChip(4));
    f.componentRef.setInput('label', 'Größe 4');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const toggle = el.querySelector('button.lbl') as HTMLButtonElement;
    toggle.click();
    f.detectChanges();
    await Promise.resolve();
    expect(el.querySelector('.menu')).not.toBeNull();
    esc(toggle);
    f.detectChanges();
    expect(el.querySelector('.menu')).withContext('Esc on the toggle').toBeNull();
    toggle.click();
    f.detectChanges();
    await Promise.resolve();
    esc(document.body);
    f.detectChanges();
    expect(el.querySelector('.menu')).withContext('Esc with focus elsewhere').toBeNull();
  });

  it('the first Esc closes only the menu; the next closes the panel and keeps the text', async () => {
    const engine = fakeEngine({ groups: [ships], extraChips: [sizeChip(4)] });
    const { el, type, cmp, fixture } = setupFusionSearch(engine);
    type('aegis');
    const toggle = el.querySelector('sc-fusion-search-chip button.lbl') as HTMLButtonElement;
    expect(toggle).withContext('a switchable chip').not.toBeNull();
    toggle.click();
    fixture.detectChanges();
    await Promise.resolve();
    esc(toggle);
    fixture.detectChanges();
    expect(el.querySelector('.menu')).toBeNull();
    expect(cmp.open()).withContext('the panel survives the first Esc').toBeTrue();
    esc(toggle);
    fixture.detectChanges();
    expect(cmp.open()).toBeFalse();
    expect(engine.input()).toBe('aegis');
  });
});
