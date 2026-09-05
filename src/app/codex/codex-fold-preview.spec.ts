import {
  buildFoldPreview,
  buildShieldPreview,
  isPassiveShield,
  FOLD_PEEK_LOCK_KEY,
} from './codex-fold-preview';
import type { SummaryOccupant } from './ship-summary-panels';

function shieldOcc(count: number, hp: number, segments: number): SummaryOccupant {
  return {
    section: 'shields',
    kind: 'component',
    count,
    payload: {
      entityKind: 'component',
      kind: 'Shield',
      className: 'SHLD_SECO_S01_WEB',
      size: 1,
      name: { de: 'WEB', en: 'WEB', key: 'x' },
      stats: {
        SCItemShieldGeneratorParams: { MaxShieldHealth: hp, MaxShieldRegen: 410 },
        ItemResourceComponentParams: {
          'online.power.consumeSegments': segments,
          'online.power.minFraction': 0.5,
        },
      },
    },
  };
}

describe('buildShieldPreview — the concept’s Nomad shield module', () => {
  const preview = buildShieldPreview([shieldOcc(2, 2160, 3), shieldOcc(1, 2160, 0)]);

  it('emits one chip per generator with count, size, name, role and figure', () => {
    expect(preview.chips.length).toBe(2);
    const [active, passive] = preview.chips;
    expect({ count: active.count, size: active.size, name: active.name, figure: active.figure }).toEqual({
      count: 2,
      size: 1,
      name: 'WEB',
      figure: 4320,
    });
    expect(active.roleKey).toBe('codex.module.badge.active');
    expect(active.unitKey).toBe('codex.equipped.shieldHp');
    expect({ count: passive.count, figure: passive.figure, roleKey: passive.roleKey }).toEqual({
      count: 1,
      figure: 2160,
      roleKey: 'codex.module.badge.passive',
    });
  });

  it('aggregates the pool', () => {
    expect(preview.aggregate).toEqual(
      jasmine.objectContaining({ labelKey: 'codex.module.badge.pool', figure: 6480 }),
    );
  });

  it('counts the census the summary prints', () => {
    expect(preview.census).toEqual({ slots: 3, active: 2, passive: 1 });
  });

  it('always carries the expand hint', () => {
    expect(preview.lockKey).toBe(FOLD_PEEK_LOCK_KEY);
  });
});

describe('isPassiveShield', () => {
  it('needs resource data before it dares call a generator passive', () => {
    const noData: SummaryOccupant = {
      section: 'shields',
      kind: 'component',
      count: 1,
      payload: { entityKind: 'component', kind: 'Shield', className: 'X', stats: {} },
    };
    expect(isPassiveShield(noData)).toBeFalse();
    expect(isPassiveShield(shieldOcc(1, 100, 0))).toBeTrue();
    expect(isPassiveShield(shieldOcc(1, 100, 2))).toBeFalse();
  });
});

describe('buildFoldPreview dispatch', () => {
  it('sums weapon alpha damage', () => {
    const gun: SummaryOccupant = {
      section: 'weapons',
      kind: 'weapon',
      count: 2,
      payload: { entityKind: 'weapon', className: 'KLWE_LaserRepeater_S3', size: 3 },
      ammoPayload: { impactDamage: { energy: 43.65 } },
    };
    const preview = buildFoldPreview('weapons', [gun]);
    expect(preview.chips[0].figure).toBe(87.3);
    expect(preview.aggregate?.labelKey).toBe('codex.module.peek.alphaTotal');
  });

  it('reports the reactor budget for power plants', () => {
    const reactor: SummaryOccupant = {
      section: 'powerPlants',
      kind: 'component',
      count: 1,
      payload: {
        entityKind: 'component',
        kind: 'PowerPlant',
        className: 'POWR_LPLT_S01_IonBurst',
        stats: { ItemResourceComponentParams: { 'online.power.generateSegments': 14 } },
      },
    };
    const preview = buildFoldPreview('powerPlants', [reactor]);
    expect(preview.chips[0].figure).toBe(14);
    expect(preview.aggregate).toEqual(
      jasmine.objectContaining({ labelKey: 'codex.module.peek.budget', figure: 14 }),
    );
  });

  it('falls back to a bare census chip rather than inventing a figure', () => {
    const radar: SummaryOccupant = {
      section: 'radar',
      kind: 'component',
      count: 1,
      payload: { entityKind: 'component', className: 'RADAR_S01' },
    };
    const preview = buildFoldPreview('radar', [radar]);
    expect(preview.chips[0].figure).toBeNull();
    expect(preview.aggregate).toBeNull();
    expect(preview.census.slots).toBe(1);
  });
});
