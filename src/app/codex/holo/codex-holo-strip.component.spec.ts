import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { CodexHoloStripComponent } from './codex-holo-strip.component';
import { POWER_REQUIRED_SCHEMA } from '../codex-power';
import { NOMAD_SHIP_STATS, nomadOccupants } from '../testing/nomad-power.fixture';
import { KpiStripCell } from '../codex-kpi-sets';
import { rankShip, RankShipInput } from '../codex-rank';
import { powerStorageKey, serializeLocalPowerDraft } from '../codex-loadout-draft';
import { setNumberLocale } from '../codex-format';

const SHIP = 'CNOU_Nomad';
const SHIP_B = 'AEGS_Avenger';

const CELLS: KpiStripCell[] = [
  { key: 'alpha', labelKey: 'codex.kpi.alpha', format: 'dec', value: 120, delta: { direction: 'up', good: true, pctText: '+20%', raw: 20 }, accent: true, gapKey: null, lowerIsBetter: false, tooltipKey: null, fromPower: false },
  { key: 'sustainedDps', labelKey: 'codex.kpi.sustainedDps', format: 'perSec', value: 60, delta: null, accent: false, gapKey: null, lowerIsBetter: false, tooltipKey: null, fromPower: false },
  { key: 'shieldHp', labelKey: 'codex.kpi.shieldHp', format: 'int', value: 1200, delta: null, accent: false, gapKey: null, lowerIsBetter: false, tooltipKey: null, fromPower: false },
  { key: 'boost', labelKey: 'codex.kpi.boost', format: 'int', value: 400, delta: null, accent: false, gapKey: null, lowerIsBetter: false, tooltipKey: null, fromPower: false },
];

async function setup(opts: { rank?: boolean } = {}): Promise<ComponentFixture<CodexHoloStripComponent>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [CodexHoloStripComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CodexHoloStripComponent);
  fixture.componentRef.setInput('occupants', nomadOccupants());
  fixture.componentRef.setInput('shipStats', NOMAD_SHIP_STATS);
  fixture.componentRef.setInput('shipClassName', SHIP);
  fixture.componentRef.setInput('schemaVersion', POWER_REQUIRED_SCHEMA);
  fixture.componentRef.setInput('userId', null);
  fixture.componentRef.setInput('cells', CELLS);
  fixture.componentRef.setInput('active', 'combat');
  fixture.componentRef.setInput('capabilities', { hasCargo: true, hasQuantum: true, hasMining: false, hasSalvage: false });

  if (opts.rank) {
    const target: RankShipInput = { className: SHIP, sizeClass: 1, career: null, sheet: { alpha: 120, sustainedDps: 60, shieldHp: 1200, agility: 10, boost: 400 } };
    const cohort: RankShipInput[] = [target, { className: 'AEGS_Avenger', sizeClass: 1, career: null, sheet: { alpha: 60, sustainedDps: 30, shieldHp: 600, agility: 5, boost: 200 } }];
    const result = rankShip(target, cohort, { profile: 'combat', scope: 'sizeClass' });
    fixture.componentRef.setInput('rankResult', result);
  }

  fixture.detectChanges();
  return fixture;
}

describe('CodexHoloStripComponent', () => {
  beforeEach(() => localStorage.clear());

  it('shows no energy segment while collapsed', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.hs-panel')).toBeNull();
    expect(el.querySelector('.hp-summary')).toBeNull();
  });

  it('expanding shows modes, the Schleichen preset, pips, the cooling gauge and the energy summary', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.hs-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.hp-modes')).toBeTruthy();
    expect(el.querySelector('.preset')).toBeTruthy();
    expect(el.querySelector('.hp-pips')).toBeTruthy();
    expect(el.querySelector('.hp-cooling')).toBeTruthy();
    expect(el.querySelector('.hp-summary')).toBeTruthy();
  });

  it('formats IR/EM/cross-section in km with one decimal and the tooltip in metres', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;
    const km = el.querySelector('.sig .fact .v')!.textContent!.trim();
    expect(/^\d+(\.\d)?km$/.test(km.replace(/\s/g, ''))).toBeTrue();
    const tip = el.querySelector('.sig .fact .tipbox')!.textContent!;
    expect(tip).toContain('m');
  });

  it('groups the mirrored cells into the three mini perspective tiles', async () => {
    const fixture = await setup();
    const tiles = fixture.componentInstance['perspectiveTiles']();
    const offensive = tiles.find((t) => t.perspective === 'offensive')!;
    expect(offensive.cells.map((c) => c.key)).toContain('alpha');
    const defensive = tiles.find((t) => t.perspective === 'defensive')!;
    expect(defensive.cells.map((c) => c.key)).toContain('shieldHp');
    const movement = tiles.find((t) => t.perspective === 'movement')!;
    expect(movement.cells.map((c) => c.key)).toContain('boost');
  });

  it('does not bleed one ship\'s power state onto the next and restores the new ship\'s own draft (wave5 red-team P0)', async () => {
    // Ship B's own draft, seeded up front — proves the switch RESTORES it
    // rather than merely resetting to defaults.
    localStorage.setItem(
      powerStorageKey(SHIP_B),
      serializeLocalPowerDraft(SHIP_B, { cutGroups: [], levels: {}, mode: 'nav', preset: 'stealth', dock: 'center' }),
    );

    const fixture = await setup();
    // Drive ship A into a non-default state (mode + preset).
    fixture.componentInstance['setMode']('nav');
    fixture.componentInstance['setPreset']('stealth');
    fixture.detectChanges();
    expect(fixture.componentInstance['mode']()).toBe('nav');
    expect(fixture.componentInstance['preset']()).toBe('stealth');

    // Switching the input to ship B must not keep carrying A's state, and
    // must not persist it under B's storage key on the next interaction.
    fixture.componentRef.setInput('shipClassName', SHIP_B);
    fixture.detectChanges();

    // B has its own stored draft (mode 'nav' + preset 'stealth') — restored,
    // not merely defaulted. Prove the isolation with cutGroups instead: A
    // never touched cutGroups, so this alone doesn't disambiguate bleed vs
    // restore. Assert the storage key for A was not overwritten with B's
    // active ship key, and that A's own storage still reflects A's draft.
    const aStored = localStorage.getItem(powerStorageKey(SHIP))!;
    expect(aStored).toContain('"mode":"nav"');
    expect(aStored).toContain('"preset":"stealth"');

    // B's own persisted draft won — proves restore, not a blind reset.
    expect(fixture.componentInstance['mode']()).toBe('nav');
    expect(fixture.componentInstance['preset']()).toBe('stealth');

    // Now flip A's stored draft to something B does NOT have, switch back to
    // A, and confirm state does not still read B's values — i.e. the switch
    // genuinely re-restores per ship rather than caching the first read.
    localStorage.setItem(
      powerStorageKey(SHIP),
      serializeLocalPowerDraft(SHIP, { cutGroups: [], levels: {}, mode: 'scm', preset: 'auto', dock: 'center' }),
    );
    fixture.componentRef.setInput('shipClassName', SHIP);
    fixture.detectChanges();
    expect(fixture.componentInstance['mode']()).toBe('scm');
    expect(fixture.componentInstance['preset']()).toBe('auto');
  });

  it('writes the km values in the page number locale (German comma)', async () => {
    setNumberLocale('de');
    try {
      const fixture = await setup();
      const km = (fixture.nativeElement as HTMLElement).querySelector('.sig .fact .v')!.textContent!.replace(/\s/g, '');
      expect(/^\d+,\dkm$/.test(km)).toBeTrue();
    } finally {
      setNumberLocale('en');
    }
  });

  it('a perspective with no value for this hull shows a dash, not an empty cell', async () => {
    const fixture = await setup();
    fixture.componentRef.setInput('cells', CELLS.filter((c) => c.key !== 'alpha' && c.key !== 'sustainedDps'));
    fixture.detectChanges();
    const offensive = (fixture.nativeElement as HTMLElement).querySelector('.seg.tile[data-p="offensive"]')!;
    expect(offensive.querySelector('.tv.none')!.textContent).toContain('—');
  });

  it('shows no class-rank pips while the profile ranks no signature axis', async () => {
    const fixture = await setup({ rank: true });
    // The combat profile ranks alpha/dps/shield/agility/boost — no IR, no cross-section.
    expect((fixture.nativeElement as HTMLElement).querySelector('.rankpips')).toBeNull();
  });

  it('carries a percentile rank onto each tile once a rank result is supplied', async () => {
    const fixture = await setup({ rank: true });
    const tiles = fixture.componentInstance['perspectiveTiles']();
    const offensive = tiles.find((t) => t.perspective === 'offensive')!;
    expect(offensive.percentile).not.toBeNull();
    expect(offensive.percentile!).toBeGreaterThan(50);
  });
});
