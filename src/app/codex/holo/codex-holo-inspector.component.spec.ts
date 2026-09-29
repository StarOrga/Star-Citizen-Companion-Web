import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { LayoutSlot, LayoutTarget } from '../codex-hardpoint-layout.component';
import { CodexHoloInspectorComponent } from './codex-holo-inspector.component';
import type { JournalEntry, PinGroup, StagePin } from './codex-holo-model';

function slot(over: Partial<LayoutSlot> = {}): LayoutSlot {
  return {
    port: 'hardpoint_gun_left',
    rawPort: 'hardpoint_gun_left',
    className: 'BEHR_LaserCannon_S3',
    kind: 'weapon',
    name: 'Laser Cannon',
    size: 3,
    grade: null,
    manufacturerCode: 'BEHR',
    typeLabel: 'Gun',
    stats: [{ labelKey: 'codex.equipped.reload', value: 3, format: 'seconds' }],
    ...over,
  };
}

function target(s: LayoutSlot = slot()): LayoutTarget {
  return { slot: s, count: 1, child: null, rawPorts: [s.rawPort ?? s.port] };
}

function pin(portName: string, index: number, over: Partial<StagePin> = {}): StagePin {
  return {
    portName,
    index,
    x: 0,
    y: 0,
    resolved: true,
    side: 'right',
    label: `Label ${portName}`,
    short: null,
    tone: 'accent',
    slot: null,
    section: null,
    ...over,
  };
}

const GROUPS: PinGroup[] = [
  { key: 'weapons', labelKey: 'codex.module.weapons', pins: [pin('hp_a', 1, { short: '120 dps' }), pin('hp_b', 2)] },
  { key: 'shields', labelKey: 'codex.module.shields', pins: [pin('hp_c', 3, { tone: 'gold' })] },
];

describe('CodexHoloInspectorComponent', () => {
  function setup(inputs: Record<string, unknown> = {}): ComponentFixture<CodexHoloInspectorComponent> {
    TestBed.configureTestingModule({
      imports: [CodexHoloInspectorComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' })],
    });
    const fixture = TestBed.createComponent(CodexHoloInspectorComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  const root = (f: ComponentFixture<CodexHoloInspectorComponent>): HTMLElement => f.nativeElement as HTMLElement;

  afterEach(() => TestBed.resetTestingModule());

  describe('target set', () => {
    it('shows the occupant, its meta line, size badge and first values', () => {
      const fixture = setup({ target: target(), inspectedPort: 'hardpoint_gun_left' });
      const el = root(fixture);
      expect(el.querySelector('.inspector')).not.toBeNull();
      expect(el.querySelector('.insp-ident b')!.textContent).toContain('Laser Cannon');
      expect(el.querySelector('.insp-ident small')!.textContent).toBe('BEHR · Gun · hardpoint_gun_left');
      expect(el.querySelector('.size-tag')!.textContent).toBe('S3');
      expect(el.querySelector('.insp-stats dt')!.textContent).toContain('codex.equipped.reload');
      expect(el.querySelector('.insp-stats dd')!.textContent).toBe('3 s');
      expect(el.querySelector('.plist')).toBeNull();
      expect(el.querySelector('.empty')).toBeNull();
    });

    it('caps the value list at four rows', () => {
      const stats = ['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ labelKey: `codex.equipped.${k}`, value: i, format: 'int' as const }));
      const fixture = setup({ target: target(slot({ stats })), inspectedPort: 'p' });
      expect(root(fixture).querySelectorAll('.insp-stats dt').length).toBe(4);
    });

    it('names an empty bay through the slot label key', () => {
      const fixture = setup({ target: target(slot({ name: null, emptyLabelKey: 'codex.holo.stage.emptyBay' })), inspectedPort: 'p' });
      expect(root(fixture).querySelector('.insp-ident b')!.textContent).toContain('codex.holo.stage.emptyBay');
    });

    it('offers swap and open-stats, emitting the target', () => {
      const t = target();
      const fixture = setup({ target: t, inspectedPort: 'p' });
      const swaps: LayoutTarget[] = [];
      const opened: LayoutTarget[] = [];
      fixture.componentInstance.swapRequested.subscribe((x) => swaps.push(x));
      fixture.componentInstance.inspected.subscribe((x) => opened.push(x));
      const [swap, stats] = Array.from(root(fixture).querySelectorAll<HTMLButtonElement>('.insp-actions .btn'));
      swap.click();
      stats.click();
      expect(swaps).toEqual([t]);
      expect(opened).toEqual([t]);
    });

    it('a raw port has only a hint, no swap / open buttons', () => {
      const fixture = setup({ target: target(), inspectedPort: 'p', isRawPort: true });
      const el = root(fixture);
      expect(el.querySelector('.insp-actions')).toBeNull();
      expect(el.querySelector('p.mut')!.textContent).toContain('codex.holo.stage.rawPortHint');
    });

    it('the close button emits closed', () => {
      const fixture = setup({ target: target(), inspectedPort: 'p' });
      let closed = 0;
      fixture.componentInstance.closed.subscribe(() => closed++);
      root(fixture).querySelector<HTMLButtonElement>('.inspector-close')!.click();
      expect(closed).toBe(1);
    });

    it('shows the draft state and reverts its paths', () => {
      const fixture = setup({
        target: target(slot({ draftState: 'changed', draftPaths: ['a.b'] })),
        inspectedPort: 'p',
      });
      const reverted: string[][] = [];
      fixture.componentInstance.reverted.subscribe((p) => reverted.push(p));
      const el = root(fixture);
      expect(el.querySelector('.insp-draft .tag')!.textContent).toContain('codex.loadout.draftState.changed');
      el.querySelector<HTMLButtonElement>('.insp-draft .lnk')!.click();
      expect(reverted).toEqual([['a.b']]);
    });
  });

  describe('no target', () => {
    it('lists the pins grouped by block, numbered like the pins', () => {
      const fixture = setup({ pinGroups: GROUPS, hotkeyPinCount: 3 });
      const el = root(fixture);
      expect(el.querySelector('.inspector')).toBeNull();
      expect(el.querySelector('.empty')).toBeNull();
      expect(el.querySelectorAll('.pgroup').length).toBe(2);
      const rows = Array.from(el.querySelectorAll('button.prow'));
      expect(rows.map((r) => r.querySelector('i')!.textContent!.trim())).toEqual(['1', '2', '3']);
      expect(rows[0].querySelector('em')!.textContent).toBe('120 dps');
      expect(el.querySelector('.pg-head em')!.textContent).toBe('2');
      expect(rows[2].classList).toContain('gold');
    });

    it('a row click inspects the pin, hover lights it', () => {
      const fixture = setup({ pinGroups: GROUPS });
      const inspected: string[] = [];
      const hovered: (string[] | null)[] = [];
      fixture.componentInstance.pinInspect.subscribe((p) => inspected.push(p));
      fixture.componentInstance.hovered.subscribe((h) => hovered.push(h));
      const row = root(fixture).querySelector<HTMLButtonElement>('button.prow')!;
      row.dispatchEvent(new MouseEvent('mouseenter'));
      row.dispatchEvent(new MouseEvent('mouseleave'));
      row.click();
      expect(hovered).toEqual([['hp_a'], null]);
      expect(inspected).toEqual(['hp_a']);
    });
  });

  describe('nothing at all', () => {
    it('shows the empty title and the no-ports text', () => {
      const fixture = setup();
      const empty = root(fixture).querySelector('.empty')!;
      expect(empty.querySelector('b')!.textContent).toContain('codex.holo.stage.inspectorEmptyTitle');
      expect(empty.textContent).toContain('codex.holo.stage.noPorts');
      expect(root(fixture).querySelector('.plist')).toBeNull();
    });
  });

  describe('journal', () => {
    it('says the journal is empty without entries', () => {
      const fixture = setup();
      expect(root(fixture).querySelector('.card .mut')!.textContent).toContain('codex.holo.stage.journalEmpty');
      expect(root(fixture).querySelector('sc-codex-loadout-save-bar')).toBeNull();
    });

    it('lists entries with undo and the save bar, and reverts all paths at once', () => {
      const journal: JournalEntry[] = [
        { port: 'p1', label: 'Laser Cannon', state: 'changed', paths: ['x.1'] },
        { port: 'p2', label: 'Shield', state: 'pending', paths: ['x.2', 'x.3'] },
      ];
      const fixture = setup({ journal, draftChangedCount: 2, saveableCount: 2 });
      const el = root(fixture);
      const reverted: string[][] = [];
      fixture.componentInstance.reverted.subscribe((p) => reverted.push(p));
      expect(el.querySelectorAll('.journal li').length).toBe(2);
      expect(el.querySelector('sc-codex-loadout-save-bar')).not.toBeNull();

      el.querySelector<HTMLButtonElement>('.journal li .lnk')!.click();
      const all = Array.from(el.querySelectorAll<HTMLButtonElement>('.card > button.lnk')).pop()!;
      all.click();
      expect(reverted).toEqual([['x.1'], ['x.1', 'x.2', 'x.3']]);
    });
  });
});
