import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { CodexHoloStripComponent } from './codex-holo-strip.component';
import { POWER_REQUIRED_SCHEMA } from '../codex-power';
import { NOMAD_SHIP_STATS, nomadOccupants } from '../testing/nomad-power.fixture';
import { KpiStripCell } from '../codex-kpi-sets';
import { rankShip, RankShipInput } from '../codex-rank';

const SHIP = 'CNOU_Nomad';

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

  it('carries a percentile rank onto each tile once a rank result is supplied', async () => {
    const fixture = await setup({ rank: true });
    const tiles = fixture.componentInstance['perspectiveTiles']();
    const offensive = tiles.find((t) => t.perspective === 'offensive')!;
    expect(offensive.percentile).not.toBeNull();
    expect(offensive.percentile!).toBeGreaterThan(50);
  });
});
