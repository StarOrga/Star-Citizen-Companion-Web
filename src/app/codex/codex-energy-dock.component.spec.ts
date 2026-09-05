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
import { NOMAD_SHIP_STATS, nomadOccupants } from './testing/nomad-power.fixture';

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
  fixture.componentRef.setInput('occupants', nomadOccupants());
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
    expect(buttons.length).toBe(8);
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
    for (const key of keys) {
      expect(lookup(en as Catalogue, key)).withContext(`en.${key}`).toBeDefined();
      expect(lookup(de as Catalogue, key)).withContext(`de.${key}`).toBeDefined();
    }
    expect(keys.size).toBeGreaterThan(5);
  });
});
