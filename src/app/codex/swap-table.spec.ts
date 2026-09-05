import {
  EMPTY_SWAP_FILTERS,
  NAME_SORT_KEY,
  SwapCandidate,
  buildSwapCandidate,
  defaultSwapSort,
  filterSwapCandidates,
  pruneSwapFilters,
  sortSwapCandidates,
  swapArchetype,
  swapCell,
  swapCellState,
  swapColumnBars,
  swapColumns,
  swapFacets,
  swapMissingSourceColumns,
  swapStatRows,
  swapTypeLabel,
  toggleSwapSort,
} from './swap-table';
import { computeStatDeltas } from './codex-format';

// Fixtures mirror the SHAPE of the live 4.9.0 catalog (verified 2026-07-27
// against build b77f1586): a ship gun carries a weaponParams block whose
// fireRate is 0, and every real number lives on the `<class>_AMMO` projectile.

function weapon(over: Partial<Record<string, unknown>> = {}): unknown {
  return {
    entityKind: 'weapon',
    subType: 'Gun',
    attachType: 'WeaponGun',
    weaponParams: { fireRate: 0, ammoContainerRecord: null },
    ...over,
  };
}

function ammo(damage: number, speed: number, lifetime: number, pen?: number): unknown {
  return {
    speed,
    lifetime,
    impactDamage: { energy: damage },
    raw: pen == null ? {} : { projectileParams: { penetrationParams: { basePenetrationDistance: pen } } },
  };
}

function candidate(
  className: string,
  nameLocalized: string,
  dmg: number,
  speed: number,
  over: Partial<Parameters<typeof buildSwapCandidate>[0]> = {},
): SwapCandidate {
  return buildSwapCandidate({
    className,
    kind: 'weapon',
    nameLocalized,
    manufacturerCode: 'KLA',
    size: 3,
    grade: 'A',
    subType: 'Gun',
    payload: weapon(),
    ammoPayload: ammo(dmg, speed, 1.3, 0.085),
    ...over,
  });
}

const PANTHER = candidate('KLWE_LaserRepeater_S3', 'CF-337 Panther Repeater', 43.65, 1480);
const OMNISKY = candidate('AMRS_LaserCannon_S3', 'Omnisky IX Cannon', 219, 1184, {
  manufacturerCode: 'AMRS',
});
const REVENANT = candidate('ANVL_BallisticGatling_Bespoke', 'Revenant Gatling', 90, 1600, {
  manufacturerCode: 'ANVL',
});

describe('swapArchetype', () => {
  it('reads the archetype out of the class name', () => {
    expect(swapArchetype('AMRS_LaserCannon_S3', 'Omnisky IX Cannon', 'Gun')).toBe('Cannon');
    expect(swapArchetype('ANVL_BallisticGatling_Bespoke', 'Revenant Gatling', 'Gun')).toBe('Gatling');
    expect(swapArchetype('KLWE_LaserRepeater_S3_mr01', 'Panther Repeater', 'Gun')).toBe('Repeater');
  });

  it('reads it out of the display name when the class name spells nothing out', () => {
    // AMRS_AAgun_CC_S3 really is called "PyroBurst Scattergun" in the catalog.
    expect(swapArchetype('AMRS_AAgun_CC_S3', 'PyroBurst Scattergun', 'Gun')).toBe('Scattergun');
  });

  it('prefers the more specific archetype over the generic one', () => {
    // "ScatterGun" must not be read as a plain gun/turret.
    expect(swapArchetype('APAR_BallisticScatterGun_S3', 'Predator Scattergun', 'Gun')).toBe(
      'Scattergun',
    );
  });

  it('falls back to the humanized subType — a real extractor field', () => {
    expect(swapArchetype('AEGS_CML_Decoy_Small', 'Decoy Launcher', 'CountermeasureLauncher')).toBe(
      'Countermeasure Launcher',
    );
  });

  it('classifies nothing rather than guessing when the data offers nothing', () => {
    expect(swapArchetype('RN_Light_Basic', null, 'UNDEFINED')).toBeNull();
    expect(swapArchetype('RN_Light_Basic', null, null)).toBeNull();
  });
});

describe('swapTypeLabel', () => {
  it('spells out what the item is from the class name', () => {
    expect(swapTypeLabel('AMRS_LaserCannon_S3', 'weapon', weapon())).toBe('Laser Cannon');
    expect(swapTypeLabel('ANVL_BallisticGatling_Bespoke', 'weapon', weapon())).toBe(
      'Ballistic Gatling',
    );
  });

  it('ignores manufacturer, size and edition tokens', () => {
    expect(swapTypeLabel('KLWE_LaserRepeater_S3_mr01', 'weapon', weapon())).toBe('Laser Repeater');
  });

  it('falls back to the entity type when the class name says nothing', () => {
    expect(swapTypeLabel('AMRS_AAgun_CC_S3', 'weapon', weapon())).toBe('Gun');
  });
});

describe('buildSwapCandidate', () => {
  it('collects every curated stat, not just the six a hardpoint card shows', () => {
    expect(Object.keys(PANTHER.stats).sort()).toEqual([
      'codex.equipped.alphaDamage',
      'codex.equipped.penetration',
      'codex.equipped.projectileSpeed',
      'codex.equipped.range',
    ]);
  });

  it('never invents a stat the extract does not carry', () => {
    // fireRate is 0 on every ship weapon in 4.9.0 → no rate, and hence no DPS.
    expect(PANTHER.stats['codex.equipped.fireRate']).toBeUndefined();
    expect(PANTHER.stats['codex.equipped.dps']).toBeUndefined();
  });

  it('humanizes the class name when the extract carries no localized name', () => {
    const c = candidate('AMRS_LaserCannon_S3', '', 10, 100);
    expect(c.name).toBe('AMRS Laser Cannon S3');
  });

  it('tags the damage channel the projectile actually deals', () => {
    expect(PANTHER.damageChannels).toEqual(['energy']);
  });
});

describe('swapColumns', () => {
  it('omits a stat no candidate in the set carries', () => {
    const keys = swapColumns([PANTHER, OMNISKY]).map((c) => c.key);
    expect(keys).not.toContain('codex.equipped.dps');
    expect(keys).not.toContain('codex.equipped.fireRate');
  });

  it('orders the offensive numbers first, as the reference layout reads', () => {
    expect(swapColumns([PANTHER, OMNISKY]).map((c) => c.key)).toEqual([
      'codex.equipped.alphaDamage',
      'codex.equipped.penetration',
      'codex.equipped.range',
      'codex.equipped.projectileSpeed',
    ]);
  });

  it('keeps a column the OTHERS have even when one candidate lacks it', () => {
    const noPen = candidate('X_LaserCannon_S3', 'No Pen Cannon', 50, 900, {
      ammoPayload: ammo(50, 900, 1.1), // no penetration params
    });
    const cols = swapColumns([PANTHER, noPen]);
    const pen = cols.find((c) => c.key === 'codex.equipped.penetration')!;
    expect(pen).toBeTruthy();
    expect(swapCell(noPen, pen)).toBe('—');
    expect(swapCell(PANTHER, pen)).toBe('0.09 m');
  });

  it('marks a column whose values are derived rather than extracted', () => {
    const range = swapColumns([PANTHER]).find((c) => c.key === 'codex.equipped.range')!;
    expect(range.derived).toBeTrue();
  });
});

describe('sortSwapCandidates', () => {
  const ALPHA = 'codex.equipped.alphaDamage';

  it('opens on the leading column, best value first', () => {
    const sorts = defaultSwapSort(swapColumns([PANTHER, OMNISKY]));
    expect(sorts).toEqual([{ key: ALPHA, dir: 'desc' }]);
    expect(sortSwapCandidates([PANTHER, OMNISKY], sorts).map((c) => c.name)).toEqual([
      'Omnisky IX Cannon',
      'CF-337 Panther Repeater',
    ]);
  });

  it('inverts when the same column is clicked again', () => {
    const first = toggleSwapSort([], ALPHA);
    expect(first).toEqual([{ key: ALPHA, dir: 'desc' }]);
    expect(toggleSwapSort(first, ALPHA)).toEqual([{ key: ALPHA, dir: 'asc' }]);
  });

  it('replaces the sort on a plain click of another column', () => {
    expect(toggleSwapSort([{ key: ALPHA, dir: 'desc' }], NAME_SORT_KEY)).toEqual([
      { key: NAME_SORT_KEY, dir: 'asc' },
    ]);
  });

  it('appends a secondary sort on a Ctrl-click', () => {
    const sorts = toggleSwapSort([{ key: ALPHA, dir: 'desc' }], NAME_SORT_KEY, true);
    expect(sorts).toEqual([
      { key: ALPHA, dir: 'desc' },
      { key: NAME_SORT_KEY, dir: 'asc' },
    ]);
    // Ctrl-clicking an already-active column inverts it in place.
    expect(toggleSwapSort(sorts, ALPHA, true)[0]).toEqual({ key: ALPHA, dir: 'asc' });
  });

  it('breaks ties with the secondary sort', () => {
    const a = candidate('A_LaserCannon_S3', 'Bravo Cannon', 100, 900);
    const b = candidate('B_LaserCannon_S3', 'Alpha Cannon', 100, 900);
    const sorted = sortSwapCandidates(
      [a, b],
      [
        { key: ALPHA, dir: 'desc' },
        { key: NAME_SORT_KEY, dir: 'asc' },
      ],
    );
    expect(sorted.map((c) => c.name)).toEqual(['Alpha Cannon', 'Bravo Cannon']);
  });

  it('sorts a missing value last in BOTH directions', () => {
    const blank = candidate('Z_LaserCannon_S3', 'Blank Cannon', 0, 0, {
      payload: weapon(),
      ammoPayload: undefined,
    });
    for (const dir of ['asc', 'desc'] as const) {
      const sorted = sortSwapCandidates([blank, PANTHER, OMNISKY], [{ key: ALPHA, dir }]);
      expect(sorted[sorted.length - 1].name).toBe('Blank Cannon');
    }
  });
});

describe('filters and facets', () => {
  const SET = [PANTHER, OMNISKY, REVENANT];

  it('searches name, manufacturer and type together', () => {
    const byMaker = filterSwapCandidates(SET, { ...EMPTY_SWAP_FILTERS, query: 'amrs' });
    expect(byMaker.map((c) => c.name)).toEqual(['Omnisky IX Cannon']);
    // Every term must hit — "anvl gatling" narrows rather than widens.
    expect(
      filterSwapCandidates(SET, { ...EMPTY_SWAP_FILTERS, query: 'anvl gatling' }).length,
    ).toBe(1);
    expect(filterSwapCandidates(SET, { ...EMPTY_SWAP_FILTERS, query: 'anvl cannon' }).length).toBe(0);
  });

  it('derives the type options from the result set, most common first', () => {
    const facets = swapFacets(SET);
    expect(facets.type.map((f) => f.value)).toEqual(['Cannon', 'Gatling', 'Repeater']);
    expect(facets.type[0].count).toBe(1);
  });

  it('hides a facet group the data cannot narrow', () => {
    // All three deal energy damage → a damage filter would be a dead control.
    expect(swapFacets(SET).damage).toEqual([]);
  });

  it('offers the damage filter once the set really is mixed', () => {
    const ballistic = candidate('GATS_BallisticCannon_S3', 'Tarantula Cannon', 0, 900, {
      ammoPayload: { speed: 900, lifetime: 1.2, impactDamage: { physical: 180 } },
    });
    expect(swapFacets([...SET, ballistic]).damage.map((f) => f.value)).toEqual([
      'energy',
      'physical',
    ]);
  });

  it('filters by the selected archetype', () => {
    const only = filterSwapCandidates(SET, { ...EMPTY_SWAP_FILTERS, type: 'Cannon' });
    expect(only.map((c) => c.name)).toEqual(['Omnisky IX Cannon']);
  });

  it('drops a selection the current facets no longer offer', () => {
    const pruned = pruneSwapFilters(
      { query: 'x', damage: 'thermal', type: 'Cannon' },
      swapFacets(SET),
    );
    expect(pruned).toEqual({ query: 'x', damage: null, type: 'Cannon' });
  });
});

describe('swapColumnBars', () => {
  const ALPHA = 'codex.equipped.alphaDamage';

  it('scales each value against the column maximum', () => {
    const bars = swapColumnBars([PANTHER, OMNISKY], ALPHA);
    expect(bars.get(OMNISKY.className)).toBe(100);
    expect(bars.get(PANTHER.className)).toBe(20); // 43.65 / 219
  });

  it('paints nothing when there is no spread to visualise', () => {
    expect(swapColumnBars([PANTHER], ALPHA).get(PANTHER.className)).toBeNull();
  });
});

describe('swapStatRows', () => {
  it('feeds the existing delta maths with translatable keys', () => {
    const deltas = computeStatDeltas(swapStatRows(PANTHER), swapStatRows(OMNISKY));
    const alpha = deltas.find((d) => d.key === 'codex.equipped.alphaDamage')!;
    expect(alpha.from).toBe('43.65');
    expect(alpha.to).toBe('219');
    expect(alpha.pct).toBe(402);
  });

  it('is empty for a candidate the build has no payload for', () => {
    expect(swapStatRows(undefined)).toEqual([]);
  });
});

describe('swapCellState / swapCell — direct-field columns (grade, manufacturer, …)', () => {
  // Regression: these columns read a plain SwapCandidate field, not `.stats` —
  // before this fix `swapCellState` always reported them `noSource` (so the
  // column-chooser listed them as permanently unavailable) and `swapCell`
  // always rendered a dash, even though every candidate carries a real value.
  const GRADE = 'codex.picker.col.grade';
  const MANUFACTURER = 'codex.picker.col.manufacturer';

  it('reports a direct-field column as having a value when the candidate field is set', () => {
    expect(swapCellState(PANTHER, GRADE)).toBe('value');
    expect(swapCellState(PANTHER, MANUFACTURER)).toBe('value');
  });

  it('reports noSource for a direct-field column only when the field itself is null', () => {
    const noGrade = candidate('X_LaserCannon_S3', 'No Grade', 10, 900, { grade: null });
    expect(swapCellState(noGrade, GRADE)).toBe('noSource');
  });

  it('renders the direct field value as cell text instead of a dash', () => {
    expect(swapCell(PANTHER, { key: GRADE, format: 'int', derived: false })).toBe('A');
    expect(swapCell(OMNISKY, { key: MANUFACTURER, format: 'int', derived: false })).toBe('AMRS');
  });

  it('never lists a direct-field column as missing-source when every candidate has a value', () => {
    expect(swapMissingSourceColumns([PANTHER, OMNISKY], [GRADE, MANUFACTURER])).toEqual([]);
  });
});
