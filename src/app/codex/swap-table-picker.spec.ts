// Specs for the redesigned picker model appended to swap-table.ts (MASTER §9).
// The pre-existing helpers keep their own spec file (swap-table.spec.ts).
import {
  applySwapScope,
  baselineClassName,
  DEFAULT_SWAP_COLUMNS,
  DEFAULT_SWAP_COLUMN_CHOOSER,
  NAME_SORT_KEY,
  resetSwapColumns,
  swapCellState,
  swapDeltaColumn,
  swapMissingSourceColumns,
  swapScopeOptions,
  swapValueBars,
  swapValueDef,
  SWAP_VALUE_CATALOGUE,
  toggleSwapColumn,
  type SwapCandidate,
} from './swap-table';

const DPS = 'codex.equipped.dps';
const MASS = 'codex.picker.mass';
const AMMO = 'codex.picker.ammo';
const SPREAD = 'codex.picker.spread';

function cand(
  className: string,
  dps: number | null,
  opts: Partial<SwapCandidate> & { mass?: number } = {},
): SwapCandidate {
  const stats: SwapCandidate['stats'] = {};
  if (dps !== null) stats[DPS] = { value: dps, format: 'perSec' };
  if (opts.mass !== undefined) stats[MASS] = { value: opts.mass, format: 'int' };
  return {
    className,
    kind: 'weapon',
    name: className,
    manufacturerCode: 'KLWE',
    size: 3,
    grade: 'A',
    typeLabel: 'Laser Repeater',
    archetype: 'Repeater',
    damageChannels: ['energy'],
    stats,
    equipped: false,
    ...opts,
  };
}

const badger = cand('KLWE_Badger', 360, { mass: 128 });
const panther = cand('KLWE_Panther', 279, { mass: 120, equipped: true });
const attrition = cand('BEHR_Attrition', 331, { mass: 134, archetype: 'Cannon' });
const ballistic = cand('APAR_Scatter', 300, { archetype: 'Scattergun', damageChannels: ['physical'] });
const all = [badger, panther, attrition, ballistic];

describe('Δ baseline', () => {
  it('moves the ±0 row between fitted and factory', () => {
    const input = { fittedClassName: 'KLWE_Panther', factoryClassName: 'KLWE_Badger' };
    expect(baselineClassName('fitted', input)).toBe('KLWE_Panther');
    expect(baselineClassName('factory', input)).toBe('KLWE_Badger');
  });

  it('measures every row against the baseline row', () => {
    const deltas = swapDeltaColumn(all, DPS, 'KLWE_Panther');
    expect(deltas.get('KLWE_Panther')).toBe(0);
    expect(deltas.get('KLWE_Badger')).toBe(81);
    expect(deltas.get('BEHR_Attrition')).toBe(52);
  });

  it('yields null rather than a fabricated delta when a side has no value', () => {
    const blind = cand('NO_DPS', null);
    const deltas = swapDeltaColumn([...all, blind], DPS, 'KLWE_Panther');
    expect(deltas.get('NO_DPS')).toBeNull();
    expect(swapDeltaColumn(all, DPS, 'UNKNOWN').get('KLWE_Badger')).toBeNull();
  });
});

describe('comparison scope', () => {
  it('narrows to the fitted archetype, its damage family, or the whole size', () => {
    expect(applySwapScope(all, panther, 'sameClass').map((c) => c.className)).toEqual([
      'KLWE_Badger',
      'KLWE_Panther',
    ]);
    expect(applySwapScope(all, panther, 'sameFamily').length).toBe(3);
    expect(applySwapScope(all, panther, 'allSize').length).toBe(4);
  });

  it('reports the three stages with live counts', () => {
    const options = swapScopeOptions(all, panther);
    expect(options.map((o) => o.scope)).toEqual(['sameClass', 'sameFamily', 'allSize']);
    expect(options.map((o) => o.count)).toEqual([2, 3, 4]);
    expect(options[0].params['class']).toBe('Repeater');
    expect(options.every((o) => o.available)).toBeTrue();
  });

  it('marks a stage unavailable when the fitted component has no archetype', () => {
    const vague = cand('VAGUE', 10, { archetype: null, damageChannels: [] });
    const options = swapScopeOptions([...all, vague], vague);
    expect(options[0].available).toBeFalse();
    expect(options[1].available).toBeFalse();
    expect(options[2].available).toBeTrue();
  });
});

describe('column catalogue and chooser', () => {
  it('defaults to the concept’s 17 columns, in order', () => {
    expect(DEFAULT_SWAP_COLUMNS.length).toBe(17);
    expect(DEFAULT_SWAP_COLUMNS[0]).toBe(NAME_SORT_KEY);
    expect(DEFAULT_SWAP_COLUMNS[1]).toBe('codex.picker.deltaSustained');
    expect(DEFAULT_SWAP_COLUMNS[DEFAULT_SWAP_COLUMNS.length - 1]).toBe(SPREAD);
  });

  it('offers around thirty values overall with unique keys', () => {
    expect(SWAP_VALUE_CATALOGUE.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SWAP_VALUE_CATALOGUE.map((v) => v.key)).size).toBe(SWAP_VALUE_CATALOGUE.length);
  });

  it('flags the lower-is-better values', () => {
    expect(swapValueDef(MASS)!.lowerIsBetter).toBeTrue();
    expect(swapValueDef('codex.picker.power')!.lowerIsBetter).toBeTrue();
    expect(swapValueDef(DPS)!.lowerIsBetter).toBeFalse();
  });

  it('adds and removes columns, keeping catalogue order, and never drops the name', () => {
    const withShield = toggleSwapColumn(DEFAULT_SWAP_COLUMN_CHOOSER, 'codex.equipped.shieldHp');
    expect(withShield.visible.length).toBe(18);
    expect(withShield.visible[withShield.visible.length - 1]).toBe('codex.equipped.shieldHp');
    expect(toggleSwapColumn(withShield, 'codex.equipped.shieldHp').visible).toEqual(DEFAULT_SWAP_COLUMNS);
    expect(toggleSwapColumn(DEFAULT_SWAP_COLUMN_CHOOSER, NAME_SORT_KEY).visible).toEqual(DEFAULT_SWAP_COLUMNS);
    expect(resetSwapColumns().visible).toEqual(DEFAULT_SWAP_COLUMNS);
  });
});

describe('empty cells: not applicable vs. no source', () => {
  it('calls ammo and spread "not applicable" on an energy weapon', () => {
    expect(swapCellState(panther, AMMO)).toBe('notApplicable');
    expect(swapCellState(panther, SPREAD)).toBe('notApplicable');
  });

  it('calls a missing ballistic ammo count an extractor gap', () => {
    expect(swapCellState(ballistic, AMMO)).toBe('noSource');
  });

  it('names only the genuinely sourceless columns in the footer', () => {
    const missing = swapMissingSourceColumns(all, [NAME_SORT_KEY, DPS, AMMO, 'codex.picker.em']);
    expect(missing).toEqual(['codex.picker.em']);
  });

  it('reports a present value as a value', () => {
    expect(swapCellState(panther, DPS)).toBe('value');
  });
});

describe('percent bars', () => {
  it('scales against the best row in the filtered set', () => {
    const bars = swapValueBars([panther, attrition], all, DPS);
    expect(bars.get('BEHR_Attrition')!.percent).toBe(100);
    expect(bars.get('KLWE_Panther')!.percent).toBe(84);
  });

  it('marks the overall optimum even when it is filtered out', () => {
    const bars = swapValueBars([panther, attrition], all, DPS);
    expect(bars.get('BEHR_Attrition')!.optimum).toBeFalse(); // 360 (Badger) is better
    expect(swapValueBars(all, all, DPS).get('KLWE_Badger')!.optimum).toBeTrue();
  });

  it('inverts for lower-is-better values', () => {
    const bars = swapValueBars([badger, panther, attrition], all, MASS);
    expect(bars.get('KLWE_Panther')!.percent).toBe(100);
    expect(bars.get('KLWE_Panther')!.optimum).toBeTrue();
    expect(bars.get('BEHR_Attrition')!.percent).toBeLessThan(100);
  });

  it('paints nothing when there is no spread to show', () => {
    const bars = swapValueBars([panther], all, DPS);
    expect(bars.get('KLWE_Panther')!.percent).toBeNull();
  });
});
