import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import type { LayoutChild, LayoutSlot, LayoutTarget } from '../codex-hardpoint-layout.component';
import { ItemPathService } from '../../hq/data/item-path.service';
import { fakeItemPath } from '../../shared/item-path/item-path.testing';
import { CodexService } from '../codex.service';
import { CodexHoloInspectorComponent, partFocusOf } from './codex-holo-inspector.component';
import type { PinGroup, StagePin } from './codex-holo-model';
import type { PlacementRow } from '../asset-package/asset-package-viewer.component';

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

function kid(over: Partial<LayoutChild> = {}): LayoutChild {
  return {
    port: 'Class 2',
    typeLabel: 'Gatling',
    size: 3,
    className: 'GATS_Mantis',
    kind: 'weapon',
    name: 'Mantis GT-220',
    count: 1,
    rawPorts: ['hardpoint_class_2'],
    rawTypes: ['WeaponGun'],
    manufacturerCode: 'GAT',
    stats: [{ labelKey: 'codex.equipped.alpha', value: 32, format: 'dec' }],
    ...over,
  } as LayoutChild;
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
  { key: 'weapons', labelKey: 'codex.module.weapons', pins: [pin('hp_a', 1, { slot: slot({ rawPort: 'hp_a' }), section: 'shields' }), pin('hp_b', 2)] },
  { key: 'shields', labelKey: 'codex.module.shields', pins: [pin('hp_c', 3, { tone: 'gold' })] },
];

describe('CodexHoloInspectorComponent', () => {

  function setup(inputs: Record<string, unknown> = {}): ComponentFixture<CodexHoloInspectorComponent> {
    TestBed.configureTestingModule({
      imports: [CodexHoloInspectorComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ItemPathService, useValue: fakeItemPath() },
      ],
    });
    const fixture = TestBed.createComponent(CodexHoloInspectorComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  const root = (f: ComponentFixture<CodexHoloInspectorComponent>): HTMLElement => f.nativeElement as HTMLElement;

  afterEach(() => TestBed.resetTestingModule());

  describe('the selected part', () => {
    it('shows name, size, type, maker and its values', () => {
      const f = setup({ target: target(), inspectedPort: 'hardpoint_gun_left' });
      const el = root(f);
      expect(el.querySelector('.pn h2')!.textContent).toContain('Laser Cannon');
      expect(el.querySelector('.pn small')!.textContent).toBe('S3 · Gun · BEHR');
      const keys = Array.from(el.querySelectorAll('.insp-stats dt')).map((d) => d.textContent);
      expect(keys).toEqual(['codex.holo.stage.partSize', 'codex.equipped.reload']);
    });

    it('caps the values at six', () => {
      const stats = Array.from({ length: 9 }, (_, i) => ({ labelKey: `k${i}`, value: i, format: 'dec' as const }));
      const f = setup({ target: target(slot({ stats })) });
      expect(root(f).querySelectorAll('.insp-stats dd').length).toBe(6);
    });

    it('resolves the maker of a slot without a kind through the component facet', async () => {
      const facetValues = vi.fn().mockName('facetValues').mockResolvedValue({
        manufacturers: [{ code: 'AEG', name: { en: 'Aegis Dynamics', de: 'Aegis Dynamics' } }],
      });
      TestBed.overrideProvider(CodexService, { useValue: { facetValues } });
      const f = setup({ target: target(slot({ name: 'Regulus', manufacturerCode: 'AEG', kind: null })) });
      await f.whenStable();
      f.detectChanges();
      expect(facetValues).toHaveBeenCalledWith('component');
      expect(f.componentInstance.maker('AEG')).toBe('Aegis Dynamics');
    });

    it('names an empty bay through the slot label key', () => {
      const f = setup({ target: target(slot({ name: null, className: null, emptyLabelKey: 'k.empty' })) });
      expect(root(f).querySelector('.pn h2')!.textContent).toContain('k.empty');
    });

    it('a gun mount speaks through the gun it holds, the mount stays reachable', () => {
      const it0 = target(slot({ name: 'VariPuck Mount', children: [kid()] }));
      const part = partFocusOf(it0, 'weapons');
      expect(part.name).toBe('Mantis GT-220');
      expect(part.target.child?.className).toBe('GATS_Mantis');
      expect(part.mount?.name).toBe('VariPuck Mount');

      const f = setup({ target: it0, section: 'weapons' });
      const el = root(f);
      expect(el.querySelector('.pn h2')!.textContent).toContain('Mantis GT-220');
      expect(el.querySelector('.insp-kid')!.textContent).toContain('VariPuck Mount');
    });

    it('a rack keeps its own name, what it carries stays listed', () => {
      const part = partFocusOf(target(slot({ name: 'MSD-313', children: [kid({ name: 'Arrester' })] })), 'missiles');
      expect(part.name).toBe('MSD-313');
      expect(part.others.length).toBe(1);
    });

    it('swap is the main action, open-stats stays, both emit the target', () => {
      const f = setup({ target: target() });
      const swapped: LayoutTarget[] = [];
      const opened: LayoutTarget[] = [];
      f.componentInstance.swapRequested.subscribe((t) => swapped.push(t));
      f.componentInstance.inspected.subscribe((t) => opened.push(t));
      (root(f).querySelector('.swap') as HTMLButtonElement).click();
      (root(f).querySelector('.insp-actions .lnk') as HTMLButtonElement).click();
      expect(swapped.length).toBe(1);
      expect(opened.length).toBe(1);
    });

    it('a shared link has no swap', () => {
      const f = setup({ target: target(), readOnly: true });
      expect(root(f).querySelector('.swap')).toBeNull();
    });

    it('a raw port has only a hint, no swap or open', () => {
      const f = setup({ target: target(), isRawPort: true });
      expect(root(f).querySelector('.insp-actions')).toBeNull();
      expect(root(f).textContent).toContain('codex.holo.stage.rawPortHint');
    });

    it('"Alle Bauteile" goes back', () => {
      const f = setup({ target: target() });
      let closed = 0;
      f.componentInstance.closed.subscribe(() => closed++);
      (root(f).querySelector('.back') as HTMLButtonElement).click();
      expect(closed).toBe(1);
    });

    it('shows the draft state and reverts its paths', () => {
      const f = setup({ target: target(slot({ draftState: 'pending', draftPaths: ['a.b'] })) });
      const paths: string[][] = [];
      f.componentInstance.reverted.subscribe((p) => paths.push(p));
      expect(root(f).querySelector('.tag.draft')!.textContent).toContain('codex.loadout.draftState.pending');
      (root(f).querySelector('.insp-draft .lnk') as HTMLButtonElement).click();
      expect(paths).toEqual([['a.b']]);
    });

    it('carries the path control with its two stops, and writes through it', async () => {
      const f = setup({ target: target() });
      const nodes = Array.from(root(f).querySelectorAll<HTMLButtonElement>('.act sc-item-path .node'));
      expect(nodes.map((n) => n.getAttribute('data-step'))).toEqual(['wish', 'inventar']);
      nodes[0].click();
      await new Promise((r) => setTimeout(r));
      expect(TestBed.inject(ItemPathService).addWish).toHaveBeenCalledTimes(1);
    });

    it('previews the detail page with a real anchor, a missing line reads as a dash', () => {
      const f = setup({ target: target(), shipName: 'Aegis Gladius' });
      const a = root(f).querySelector('.prev a.more') as HTMLAnchorElement;
      expect(a.getAttribute('href')).toBe('/codex/weapon/BEHR_LaserCannon_S3');
      const rows = Array.from(root(f).querySelectorAll('.prev li')).map((l) => l.textContent);
      expect(rows[0]).toContain('BEHR');
      expect(rows[1]).toContain('Aegis Gladius');
      expect(rows[2]).toContain('—');
      expect(rows[3]).toContain('—');
    });
  });

  describe('the parts by block', () => {
    it('lists chips by block with a count, sized and named', () => {
      const el = root(setup({ pinGroups: GROUPS, total: 3 }));
      expect(el.querySelectorAll('.pgroup').length).toBe(2);
      expect(el.querySelector('.plist-head b')!.textContent).toContain('codex.holo.stage.partsTotal');
      const chip = el.querySelector('.part')!;
      expect(chip.querySelector('i')!.textContent).toBe('S3');
      expect(chip.textContent).toContain('Label hp_a');
    });

    it('names a block without an installed count and drops the key hint (C16)', () => {
      const el = root(setup({ pinGroups: GROUPS, total: 3 }));
      expect(el.querySelector('.pg-head')!.textContent).not.toContain('·');
      expect(el.textContent).not.toContain('codex.holo.stage.partsInstalled');
      expect(el.textContent).not.toContain('codex.holo.stage.inspectorEmptyBody');
    });

    it('marks a part that differs from the Werk with the one diamond, plus a legend (C19)', () => {
      const el = root(setup({ pinGroups: GROUPS, total: 3, changedPorts: new Set(['hp_b']) }));
      const chips = el.querySelectorAll('.part');
      expect(chips[0].querySelector('sc-holo-diff-marker')).toBeNull();
      expect(chips[1].querySelector('sc-holo-diff-marker')).not.toBeNull();
      expect(el.querySelector('.plist-legend sc-holo-diff-marker')).not.toBeNull();
    });

    it('a part with a page is an anchor: a plain click selects, a modified one stays the browser\'s', () => {
      const f = setup({ pinGroups: GROUPS });
      const picked: string[] = [];
      f.componentInstance.pinInspect.subscribe((p) => picked.push(p));
      const a = root(f).querySelector('a.part') as HTMLAnchorElement;
      expect(a.getAttribute('href')).toContain('/codex/weapon/');
      const ctrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
      f.componentInstance.pickPin(ctrl, 'hp_a');
      expect(ctrl.defaultPrevented).toBe(false);
      expect(picked).toEqual([]);
      const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      f.componentInstance.pickPin(plain, 'hp_a');
      expect(plain.defaultPrevented).toBe(true);
      expect(picked).toEqual(['hp_a']);
    });

    it('hover and focus light the part on the model', () => {
      const f = setup({ pinGroups: GROUPS });
      const seen: (string[] | null)[] = [];
      f.componentInstance.hovered.subscribe((p) => seen.push(p));
      const chip = root(f).querySelectorAll('.part')[1] as HTMLButtonElement;
      chip.dispatchEvent(new MouseEvent('mouseenter'));
      chip.dispatchEvent(new MouseEvent('mouseleave'));
      expect(seen).toEqual([['hp_b'], null]);
    });

    it('an Einsatz quiets what it is not about, the chip stays reachable', () => {
      const f = setup({ pinGroups: GROUPS, relevantPorts: new Set(['hp_a']) });
      const chips = root(f).querySelectorAll('.part');
      expect(chips[0].classList.contains('q')).toBe(false);
      expect(chips[1].classList.contains('q')).toBe(true);
      const picked: string[] = [];
      f.componentInstance.pinInspect.subscribe((p) => picked.push(p));
      (chips[1] as HTMLButtonElement).click();
      expect(picked).toEqual(['hp_b']);
    });

    it('says when the model has no position for a part', () => {
      const f = setup({ pinGroups: GROUPS, modelPorts: new Set(['hp_a']) });
      expect(root(f).querySelectorAll('.part')[1].classList.contains('unlocated')).toBe(true);
      expect(root(f).querySelectorAll('.part')[0].classList.contains('unlocated')).toBe(false);
    });

    it('shows the empty title and the no-ports text without parts', () => {
      const el = root(setup());
      expect(el.querySelector('.empty')!.textContent).toContain('codex.holo.stage.inspectorEmptyTitle');
      expect(el.querySelector('.empty')!.textContent).toContain('codex.holo.stage.noPorts');
    });
  });

  describe('"Alle Teile"', () => {
    const row = (id: string, group: string, over: Partial<PlacementRow> = {}): PlacementRow =>
      ({
        p: { id, portName: id, group, itemSize: 2, port: null },
        name: `Name ${id}`,
        link: ['/codex', 'item', id],
        href: `/codex/item/${id}`,
        visible: true,
        free: false,
        ...over,
      }) as unknown as PlacementRow;

    it('lists every row by group with its eye toggle, which the list chip of the viewer used to open', () => {
      const f = setup({ allParts: true, packageRows: [row('a', 'interior'), row('b', 'interior', { visible: false }), row('c', 'components')], pinGroups: GROUPS });
      const el = root(f);
      expect(el.querySelectorAll('.pgroup').length).toBe(2);
      expect(el.querySelectorAll('.part').length).toBe(3);
      const eyes: string[] = [];
      f.componentInstance.rowEye.subscribe((id) => eyes.push(id));
      (el.querySelector('.eye') as HTMLButtonElement).click();
      expect(eyes).toEqual(['a']);
      expect(el.querySelectorAll('.pline')[1].classList.contains('off')).toBe(true);
    });

    it('a plain click on a row selects it', () => {
      const r = row('a', 'interior');
      const f = setup({ allParts: true, packageRows: [r] });
      const picked: PlacementRow[] = [];
      f.componentInstance.rowPick.subscribe((x) => picked.push(x));
      const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      f.componentInstance.pickRow(plain, r);
      expect(plain.defaultPrevented).toBe(true);
      expect(picked).toEqual([r]);
    });
  });
});
