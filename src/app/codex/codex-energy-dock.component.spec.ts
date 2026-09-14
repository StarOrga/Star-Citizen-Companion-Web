import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';

import { CodexEnergyDockComponent } from './codex-energy-dock.component';
import { POWER_REQUIRED_SCHEMA, PowerSheet } from './codex-power';
import {
  DEFAULT_POWER_DRAFT,
  dockPositionStorageKey,
  encodePowerParam,
  powerStorageKey,
  serializeLocalPowerDraft,
} from './codex-loadout-draft';
import { NOMAD_COOLER, NOMAD_POWER_FIXTURE, NOMAD_SHIP_STATS, nomadOccupants } from './testing/nomad-power.fixture';

const SHIP = 'CNOU_Nomad';

type Catalogue = Record<string, unknown>;
function lookup(cat: Catalogue, key: string): unknown {
  let node: unknown = cat;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

async function setup(opts: {
  queryParam?: string | null;
  schemaVersion?: number | null;
  userId?: string | null;
  /** override the loadout (default: the Nomad with its two coolers). */
  occupants?: ReturnType<typeof nomadOccupants>;
  beforeDetect?: (fixture: ComponentFixture<CodexEnergyDockComponent>) => void;
} = {}): Promise<ComponentFixture<CodexEnergyDockComponent>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [CodexEnergyDockComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: convertToParamMap(opts.queryParam ? { pw: opts.queryParam } : {}),
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CodexEnergyDockComponent);
  fixture.componentRef.setInput('occupants', opts.occupants ?? nomadOccupants());
  fixture.componentRef.setInput('shipStats', NOMAD_SHIP_STATS);
  fixture.componentRef.setInput('shipClassName', SHIP);
  fixture.componentRef.setInput('schemaVersion', opts.schemaVersion ?? POWER_REQUIRED_SCHEMA);
  fixture.componentRef.setInput('userId', opts.userId ?? null);
  opts.beforeDetect?.(fixture);
  fixture.detectChanges();
  return fixture;
}

describe('CodexEnergyDockComponent', () => {
  beforeEach(() => localStorage.clear());

  it('emits the initial sheet on first render', async () => {
    const spy = jasmine.createSpy('sheetChange');
    await setup({ beforeDetect: (f) => f.componentInstance.sheetChange.subscribe(spy) });
    expect(spy).toHaveBeenCalled();
    const sheet = spy.calls.mostRecent().args[0] as PowerSheet;
    expect(sheet.available).toBeTrue();
    expect(sheet.budgetTotal).toBe(14);
  });

  it('a real signal-writing subscriber does not throw NG0600 (HIGH-1)', async () => {
    // `sheet` is a `computed()`; `sheetChange.emit()` must not run inside it,
    // because emit() invokes listeners synchronously and a plain jasmine spy
    // (unlike a real consumer) never touches Angular's write-guard at all.
    // The shell's actual wiring writes a signal from the listener — that is
    // the case that throws if the emit ever regresses back into the computed.
    const powerSheet = signal<PowerSheet | null>(null);
    const fixture = await setup({
      beforeDetect: (f) => f.componentInstance.sheetChange.subscribe((s) => powerSheet.set(s)),
    });
    expect(powerSheet()).not.toBeNull();
    expect(powerSheet()?.budgetTotal).toBe(14);

    const c = fixture.componentInstance;
    c['toggleGroup']('weapons');
    fixture.detectChanges();
    expect(powerSheet()?.budgetUsed).toBe(11);
  });

  it('renders the full budget with nothing cut', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.bud')?.textContent).toContain('14');
  });

  it('cutting weapons drops budgetUsed from 14 to 11 and restores on second click', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    expect(c['sheet']().budgetUsed).toBe(14);

    const rootA: HTMLElement = fixture.nativeElement;
    const weaponsBtn = Array.from(rootA.querySelectorAll<HTMLButtonElement>('.grp-btn'))[0];
    weaponsBtn.click();
    fixture.detectChanges();

    expect(c['sheet']().budgetUsed).toBe(11);
    expect(c['sheet']().weaponsCut).toBeTrue();

    weaponsBtn.click();
    fixture.detectChanges();
    expect(c['sheet']().budgetUsed).toBe(14);
    expect(c['sheet']().weaponsCut).toBeFalse();
  });

  it('stealth preset drives every eligible group to its minimum', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c['setPreset']('stealth');
    fixture.detectChanges();
    const sheet = c['sheet']();
    for (const g of sheet.groups) {
      if (g.state === 'active') expect(g.allocated).toBe(g.minimum);
    }
  });

  it('NAV mode gives the quantum drive a channel and drops the shield channel', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c['setMode']('nav');
    fixture.detectChanges();
    const sheet = c['sheet']();
    const quantum = sheet.groups.find((g) => g.group === 'quantum')!;
    const shields = sheet.groups.find((g) => g.group === 'shields')!;
    expect(quantum.state).not.toBe('noChannel');
    expect(shields.state).toBe('noChannel');
  });

  it('persists dock position per user and restores it on the next instance', async () => {
    const fixture = await setup({ userId: 'user-1' });
    const c = fixture.componentInstance;
    c['setPosition']('right');
    fixture.detectChanges();
    expect(localStorage.getItem(dockPositionStorageKey('user-1'))).toBe('right');

    const fixture2 = await setup({ userId: 'user-1' });
    expect(fixture2.componentInstance['position']()).toBe('right');
  });

  it('offers four placements and puts the chosen one on the HOST, which is what sticks', async () => {
    // The host is the sticky element: its box is what has travel inside
    // .detail-page. Sticking the inner .mini-dock instead gave it a zero-pixel
    // range and it never stuck at all — so the attribute has to reach the host.
    const fixture = await setup({ userId: 'user-pos' });
    const c = fixture.componentInstance;
    const host: HTMLElement = fixture.nativeElement;

    expect(c['positions']).toEqual(['left', 'center', 'right', 'inline']);
    expect(host.querySelectorAll('.pos-pick button').length).toBe(4);

    for (const pos of ['left', 'center', 'right', 'inline'] as const) {
      c['setPosition'](pos);
      fixture.detectChanges();
      expect(host.getAttribute('data-pos')).toBe(pos);
    }
  });

  it('keeps a stored position from before inline existed', async () => {
    // Old installs hold 'center'; widening the union must not reset them.
    localStorage.setItem(dockPositionStorageKey('user-old'), 'center');
    const fixture = await setup({ userId: 'user-old' });
    expect(fixture.componentInstance['position']()).toBe('center');
  });

  it('persists cut groups per ship and encodes them into the pw param', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c['toggleGroup']('weapons');
    fixture.detectChanges();
    const stored = localStorage.getItem(powerStorageKey(SHIP));
    expect(stored).toContain('weapons');

    const router = TestBed.inject(Router);
    const encoded = encodePowerParam({ ...DEFAULT_POWER_DRAFT, cutGroups: ['weapons'] });
    expect(encoded).not.toBeNull();
    void router; // navigate() is stubbed by provideRouter([]); this asserts the shape only
  });

  it('restores cut groups from the pw URL param', async () => {
    const pw = encodePowerParam({ ...DEFAULT_POWER_DRAFT, cutGroups: ['weapons'] })!;
    const fixture = await setup({ queryParam: pw });
    const c = fixture.componentInstance;
    expect(c['sheet']().weaponsCut).toBeTrue();
  });

  it('reports a gap state when schemaVersion is below POWER_REQUIRED_SCHEMA', async () => {
    const fixture = await setup({ schemaVersion: 2 });
    const c = fixture.componentInstance;
    expect(c['sheet']().available).toBeFalse();
    expect(c['sheet']().gapKeys).toContain('codex.energy.gap.reExtractPending');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.md-gap')).toBeTruthy();
    expect(el.querySelector('.stack')).toBeNull();
  });

  it('minimised state hides pips and controls, shows the read-only strip', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c['toggleMinimised']();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.md-body')).toBeNull();
    expect(el.querySelector('.md-foot')).toBeNull();
    expect(el.querySelector('.md-strip')).toBeTruthy();
    expect(el.querySelectorAll('.md-strip button').length).toBe(0);
  });

  it('defaults to minimised on a narrow viewport when nothing is stored yet', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('640px'),
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
    try {
      const fixture = await setup();
      expect(fixture.componentInstance['minimised']()).toBeTrue();
    } finally {
      window.matchMedia = original;
    }
  });

  it('a stored minimised=false preference sticks even on a narrow viewport', async () => {
    localStorage.setItem(`${dockPositionStorageKey(null)}:min`, 'false');
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('640px'),
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
    try {
      const fixture = await setup();
      expect(fixture.componentInstance['minimised']()).toBeFalse();
    } finally {
      window.matchMedia = original;
    }
  });

  it('every rendered group button has an accessible name', async () => {
    const fixture = await setup();
    const rootB: HTMLElement = fixture.nativeElement;
    const buttons = Array.from(rootB.querySelectorAll<HTMLButtonElement>('.grp-btn'));
    expect(buttons.length).toBe(9); // seven groups + one per Nomad cooler unit (F1d)
    for (const b of buttons) expect(b.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0);
  });

  it('tooltips are referenced via aria-describedby and have a matching id', async () => {
    const fixture = await setup();
    const rootC: HTMLElement = fixture.nativeElement;
    const btn = rootC.querySelector<HTMLButtonElement>('.grp-btn')!;
    const ids = (btn.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(fixture.nativeElement.querySelector(`#${id}`)).toBeTruthy();
  });

  it('fact tooltips are keyboard reachable via a focusable trigger + aria-describedby (HIGH-3)', async () => {
    const fixture = await setup();
    const root: HTMLElement = fixture.nativeElement;
    const triggers = Array.from(root.querySelectorAll<HTMLButtonElement>('.tip-trigger'));
    // 3 simple facts (IR/EM/CS) + the Kühllast/coolingLoad trigger = 4.
    expect(triggers.length).toBe(4);
    for (const t of triggers) {
      const ids = (t.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(root.querySelector(`#${id}`)).toBeTruthy();
    }
  });

  it('a noReactorData build keeps the facts and footer, only the pip area collapses (MEDIUM-5)', async () => {
    // Drop the power plant: no generateSegments anywhere means budgetTotal is
    // null, but every other occupant still carries resource data, so this is
    // `noReactorData` — NOT the compact `reExtractPending` gaptag that hides
    // facts and footer too.
    const occupants = nomadOccupants().filter((o) => o.section !== 'powerPlants');
    const fixture = await setup();
    fixture.componentRef.setInput('occupants', occupants);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    expect(c['sheet']().budgetTotal).toBeNull();
    expect(c['sheet']().available).toBeFalse();
    expect(c['sheet']().gapKeys).toContain('codex.energy.gap.noReactorData');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.md-gap-inline')).toBeTruthy();
    expect(el.querySelector('.md-facts')).toBeTruthy();
    expect(el.querySelector('.md-foot')).toBeTruthy();
  });

  // ── the pip stack (admin feedback 590230e3) ──────────────────────────────

  // columns are addressed by their COLUMN key: a group key, or `cooler<n>`
  // for one cooler unit (F1d) — `data-group` is `coolers` on every unit.
  const pipsOf = (root: HTMLElement, key: string): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll<HTMLButtonElement>(`.md-col[data-key="${key}"] button.pip`));
  const rowOf = (c: CodexEnergyDockComponent, key: string) =>
    c['sheet']().groups.find((g) => g.key === key)!;

  it('renders the seven groups in the fixed order plus one column per cooler, absent ones as an empty column', async () => {
    const fixture = await setup();
    const root: HTMLElement = fixture.nativeElement;
    const cols = Array.from(root.querySelectorAll<HTMLElement>('.md-col'));
    expect(cols.map((el) => el.dataset['key'])).toEqual([
      'weapons',
      'thrusters',
      'shields',
      'quantum',
      'tractor',
      'radar',
      'life',
      'cooler1',
      'cooler2',
    ]);
    expect(cols.map((el) => el.dataset['group'])).toEqual([
      'weapons',
      'thrusters',
      'shields',
      'quantum',
      'tractor',
      'radar',
      'life',
      'coolers',
      'coolers',
    ]);
    // the Nomad has no tractor beam: the column stays, with a ghost pip and no control
    const tractor = root.querySelector<HTMLElement>('.md-col[data-group="tractor"]')!;
    expect(tractor.classList.contains('absent')).toBeTrue();
    expect(tractor.querySelector('.pip.ghost')).toBeTruthy();
    expect(pipsOf(root, 'tractor').length).toBe(0);
    expect(tractor.querySelector('.grp-state')?.textContent?.trim()).toBe('codex.energy.state.absent');
  });

  it('pips fill upward: level 1 is the bottom pip, the stack grows toward the top', async () => {
    const fixture = await setup();
    const root: HTMLElement = fixture.nativeElement;
    const shields = pipsOf(root, 'shields');
    expect(shields.length).toBe(4);
    expect(shields.map((b) => b.dataset['level'])).toEqual(['1', '2', '3', '4']);
    const stack = root.querySelector<HTMLElement>('.md-col[data-key="shields"] .stack')!;
    expect(getComputedStyle(stack).flexDirection).toBe('column-reverse');
    const bottom = shields[0].getBoundingClientRect();
    const top = shields[3].getBoundingClientRect();
    expect(bottom.top).toBeGreaterThan(top.top);
    // each cooler unit is its own 3-pip stack: the auto deal lights 1..2 (gold
    // minimum), 3 stays empty — on BOTH units, never summed (F1d)
    for (const key of ['cooler1', 'cooler2']) {
      const cooler = pipsOf(root, key);
      expect(cooler.map((b) => b.dataset['level'])).toEqual(['1', '2', '3']);
      expect(cooler.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false']);
    }
  });

  it('every stack has the same height so the icon row sits on one line', async () => {
    const fixture = await setup();
    const root: HTMLElement = fixture.nativeElement;
    const stacks = Array.from(root.querySelectorAll<HTMLElement>('.md-col .stack'));
    expect(stacks.length).toBe(9);
    const heights = new Set(stacks.map((s) => Math.round(s.getBoundingClientRect().height)));
    expect(heights.size).withContext([...heights].join(',')).toBe(1);
    // the tallest stack (4 shield pips) sets the height, so it never clips
    const pipH = pipsOf(root, 'shields')[0].getBoundingClientRect().height;
    expect([...heights][0]).toBeGreaterThanOrEqual(Math.floor(4 * pipH));
    // icons: one row on a wide layout, at most two on the ≤640px phone grid —
    // and never one height per column.
    const icons = Array.from(root.querySelectorAll<HTMLElement>('.grp-btn'));
    const tops = new Set(icons.map((b) => Math.round(b.getBoundingClientRect().top)));
    expect(tops.size).toBeLessThanOrEqual(window.innerWidth > 640 ? 1 : 2);
  });

  it('clicking pip N sets the group to exactly N', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;
    expect(rowOf(c, 'cooler1').allocated).toBe(2);

    pipsOf(root, 'cooler1')[0].click(); // level 1 — below the unit's gold floor of 2
    fixture.detectChanges();
    expect(rowOf(c, 'cooler1').allocated).toBe(1);
    expect(rowOf(c, 'cooler1').pinned).toBeTrue();
    expect(rowOf(c, 'cooler1').belowMinimum).toBeTrue();
    expect(root.querySelector('.md-col[data-key="cooler1"] .grp-state')?.classList).toContain('warn');
    expect(c['sheet']().budgetUsed).toBe(13);
    // the sibling cooler is its own column and did not move (F1d)
    expect(rowOf(c, 'cooler2').allocated).toBe(2);
    expect(rowOf(c, 'cooler2').pinned).toBeFalse();

    pipsOf(root, 'cooler1')[2].click(); // level 3 — one more than the reactor has
    fixture.detectChanges();
    expect(rowOf(c, 'cooler1').allocated).toBe(3);
    expect(c['sheet']().budgetUsed).toBe(15);
    expect(c['sheet']().overBudget).toBeTrue();
    expect(root.querySelector('.bud')?.classList).toContain('over');
    // the other groups kept what the auto deal gave them
    expect(rowOf(c, 'shields').allocated).toBe(4);
    expect(rowOf(c, 'weapons').allocated).toBe(3);
  });

  it('the topmost pip switches a group at full capacity off; a lower pip brings it back', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;
    const weapons = pipsOf(root, 'weapons');
    expect(rowOf(c, 'weapons').allocated).toBe(3);
    expect(weapons[2].getAttribute('aria-label')).toContain('codex.energy.pip.topOff');
    expect(weapons[1].getAttribute('aria-label')).toContain('codex.energy.pip.level');

    weapons[2].click();
    fixture.detectChanges();
    expect(rowOf(c, 'weapons').state).toBe('off');
    expect(rowOf(c, 'weapons').allocated).toBe(0);
    expect(c['sheet']().weaponsCut).toBeTrue();
    expect(c['sheet']().budgetUsed).toBe(11);

    pipsOf(root, 'weapons')[1].click();
    fixture.detectChanges();
    expect(rowOf(c, 'weapons').state).toBe('active');
    expect(rowOf(c, 'weapons').allocated).toBe(2);
    expect(c['sheet']().weaponsCut).toBeFalse();
    expect(c['sheet']().budgetUsed).toBe(13);

    // at 2 of 3 the top pip is a raise, not a cut
    pipsOf(root, 'weapons')[2].click();
    fixture.detectChanges();
    expect(rowOf(c, 'weapons').allocated).toBe(3);
    expect(c['sheet']().weaponsCut).toBeFalse();
  });

  it('pips are disabled where nothing can be set (no channel in this mode)', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;
    c['setMode']('nav');
    fixture.detectChanges();
    const shields = pipsOf(root, 'shields');
    expect(shields.length).toBeGreaterThan(0);
    expect(shields.every((b) => b.disabled)).toBeTrue();
    shields[0].click();
    fixture.detectChanges();
    expect(rowOf(c, 'shields').pinned).toBeFalse();
  });

  it('arrow keys walk the stack upward and downward', async () => {
    const fixture = await setup();
    const root: HTMLElement = fixture.nativeElement;
    const coolers = pipsOf(root, 'cooler1');
    coolers[0].focus();
    coolers[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(coolers[1]);
    coolers[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(coolers[0]);
  });

  it('a preset or reset clears the pins, and pins survive a reload via the pw param', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;
    pipsOf(root, 'shields')[0].click();
    fixture.detectChanges();
    expect(rowOf(c, 'shields').allocated).toBe(1);
    expect(localStorage.getItem(powerStorageKey(SHIP))).toContain('"shields":1');
    expect(root.querySelector('.draft-note')).toBeTruthy();

    c['setPreset']('stealth');
    fixture.detectChanges();
    expect(rowOf(c, 'shields').pinned).toBeFalse();
    expect(rowOf(c, 'shields').allocated).toBe(2);

    const pw = encodePowerParam({ ...DEFAULT_POWER_DRAFT, levels: { cooler2: 3 } })!;
    const fixture2 = await setup({ queryParam: pw });
    expect(rowOf(fixture2.componentInstance, 'cooler2').allocated).toBe(3);
    expect(rowOf(fixture2.componentInstance, 'cooler1').allocated).toBe(2);
    fixture2.componentInstance['reset']();
    fixture2.detectChanges();
    expect(rowOf(fixture2.componentInstance, 'cooler2').allocated).toBe(2);
  });

  // ── one column per cooler unit (admin reply 2026-09-14, F1d) ────────────

  it('renders every installed cooler as its own column with its own label, pin and cut', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;
    const units = Array.from(root.querySelectorAll<HTMLElement>('.md-col[data-group="coolers"]'));
    expect(units.length).toBe(2);
    expect(rowOf(c, 'cooler1').labelKey).toBe('codex.energy.group.coolerUnit');
    expect(rowOf(c, 'cooler1').labelParams).toEqual({ n: 1 });
    // the stack's accessible name carries the unit index, not the group word
    const stack2 = root.querySelector<HTMLElement>('.md-col[data-key="cooler2"] .stack')!;
    expect(stack2.getAttribute('aria-label')).toBe('codex.energy.group.coolerUnit');
    // each unit has its own toggle: cutting unit 2 leaves unit 1 running
    units[1].querySelector<HTMLButtonElement>('.grp-btn')!.click();
    fixture.detectChanges();
    expect(rowOf(c, 'cooler2').state).toBe('off');
    expect(rowOf(c, 'cooler1').state).toBe('active');
    expect(c['sheet']().budgetUsed).toBe(12);
    expect(localStorage.getItem(powerStorageKey(SHIP))).toContain('cooler2');
    // ids are keyed by column, so the two tooltips never collide
    const tipIds = units.map((u) => u.querySelector('.tipbox')!.id);
    expect(new Set(tipIds).size).toBe(2);
  });

  it('a ship without coolers keeps ONE empty cooling column', async () => {
    const fixture = await setup({ occupants: nomadOccupants(NOMAD_POWER_FIXTURE.filter((f) => f !== NOMAD_COOLER)) });
    const root: HTMLElement = fixture.nativeElement;
    const cols = Array.from(root.querySelectorAll<HTMLElement>('.md-col'));
    expect(cols.length).toBe(8);
    const cooling = cols[7];
    expect(cooling.dataset['key']).toBe('coolers');
    expect(cooling.classList.contains('absent')).toBeTrue();
    expect(cooling.querySelector('.pip.ghost')).toBeTruthy();
    expect(cooling.querySelector('.grp-state')?.textContent?.trim()).toBe('codex.energy.state.absent');
  });

  it('a legacy draft with a single `coolers` pin or cut is mapped onto every unit', async () => {
    // a pw link shared before the split: the summed group pinned at 5 → ⌈5/2⌉ = 3 per unit
    const pinned = await setup({ queryParam: encodePowerParam({ ...DEFAULT_POWER_DRAFT, levels: { coolers: 5 } })! });
    expect(rowOf(pinned.componentInstance, 'cooler1').allocated).toBe(3);
    expect(rowOf(pinned.componentInstance, 'cooler2').allocated).toBe(3);
    expect(rowOf(pinned.componentInstance, 'cooler2').pinned).toBeTrue();
    expect(pinned.componentInstance['sheet']().budgetUsed).toBe(16);

    // a localStorage draft with the group cut: both units off, and a
    // per-unit toggle brings ONE back without fighting the old group cut
    localStorage.setItem(
      powerStorageKey(SHIP),
      serializeLocalPowerDraft(SHIP, { ...DEFAULT_POWER_DRAFT, cutGroups: ['coolers'] }),
    );
    const cut = await setup();
    const c = cut.componentInstance;
    expect(rowOf(c, 'cooler1').state).toBe('off');
    expect(rowOf(c, 'cooler2').state).toBe('off');
    c['toggleGroup']('cooler1');
    cut.detectChanges();
    expect(rowOf(c, 'cooler1').state).toBe('active');
    expect(rowOf(c, 'cooler2').state).toBe('off');
    expect(localStorage.getItem(powerStorageKey(SHIP))).not.toContain('"coolers"');
  });

  it('nine columns never make the dock scroll sideways', async () => {
    const fixture = await setup();
    const root: HTMLElement = fixture.nativeElement;
    const dock = root.querySelector<HTMLElement>('.mini-dock')!.getBoundingClientRect();
    const stripEl = root.querySelector<HTMLElement>('.md-pips')!;
    const strip = stripEl.getBoundingClientRect();
    // measured on the columns' boxes, not scrollWidth: the (hidden) tooltips
    // are absolutely positioned 230px boxes that count toward scrollWidth
    // without ever taking part in the layout.
    for (const col of Array.from(root.querySelectorAll<HTMLElement>('.md-col'))) {
      const r = col.getBoundingClientRect();
      expect(r.right).toBeLessThanOrEqual(strip.right + 1);
      expect(r.left).toBeGreaterThanOrEqual(strip.left - 1);
    }
    expect(strip.right).toBeLessThanOrEqual(dock.right + 1);
    expect(dock.width).toBeLessThanOrEqual(window.innerWidth);
    // the wide layout wraps rather than overflowing; the phone layout is a
    // grid that fits as many columns as have room (Karma renders at 749px,
    // so only the wide branch is measured here)
    const display = getComputedStyle(stripEl).display;
    if (display === 'flex') expect(getComputedStyle(stripEl).flexWrap).toBe('wrap');
    else expect(display).toBe('grid');
  });

  it('the tooltip names the demand the equipped modules ask for', async () => {
    const fixture = await setup();
    const root: HTMLElement = fixture.nativeElement;
    const tip = root.querySelector('.md-col[data-group="weapons"] .tipbox .demand');
    expect(tip).toBeTruthy();
    // three 1.0-unit repeaters = 2.25 segments, on 3 pips
    expect(rowOf(fixture.componentInstance, 'weapons').demand).toBe(2.25);
    expect(root.querySelector('.md-col[data-group="tractor"] .tipbox .demand')).toBeNull();
  });

  it('every group/fact/state/gap key rendered resolves in de and en', async () => {
    const fixture = await setup({ schemaVersion: 2 });
    const c = fixture.componentInstance;
    const keys = new Set<string>();
    const collect = (s: PowerSheet): void => {
      keys.add(s.readinessKey);
      for (const k of s.gapKeys) keys.add(k);
      for (const g of s.groups) {
        keys.add(g.labelKey);
        keys.add(g.tooltipTitleKey);
        keys.add(g.tooltipBodyKey);
        if (g.stateLabelKey) keys.add(g.stateLabelKey);
      }
      for (const f of s.facts) {
        keys.add(f.labelKey);
        keys.add(f.tooltipKey);
        if (f.gapKey) keys.add(f.gapKey);
      }
    };
    collect(c['sheet']());
    fixture.componentRef.setInput('schemaVersion', POWER_REQUIRED_SCHEMA);
    fixture.detectChanges();
    collect(c['sheet']());
    for (const key of [
      'codex.energy.pip.level',
      'codex.energy.pip.topOff',
      'codex.energy.demandLine',
      'codex.energy.belowMinimum',
      'codex.energy.pinned',
      'codex.energy.overBudget',
      'codex.energy.draftNote',
    ]) {
      keys.add(key);
    }
    for (const key of keys) {
      expect(lookup(en as Catalogue, key)).withContext(`en.${key}`).toBeDefined();
      expect(lookup(de as Catalogue, key)).withContext(`de.${key}`).toBeDefined();
    }
    expect(keys.size).toBeGreaterThan(5);
  });
});
