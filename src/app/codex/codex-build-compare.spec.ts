import {
  buildPerspectiveDeltas,
  compareKpiSheets,
  comparePortOccupants,
  compareShipBuilds,
  PERSPECTIVE_KPIS,
} from './codex-build-compare';
import { KpiSheet } from './codex-loadout-stats';

const EMPTY_SHEET: KpiSheet = {
  alpha: null,
  burstDps: null,
  sustainedDps: null,
  missiles: null,
  shieldHp: null,
  shieldRegen: null,
  hullHp: null,
  effectiveHp: null,
  cargo: null,
  mass: null,
  scm: null,
  maxSpeed: null,
  boost: null,
  agility: null,
  armorHp: null,
  quantumSpeed: null,
  quantumRange: null,
  spool: null,
  ir: null,
  emIdle: null,
  emMax: null,
  crossSection: null,
};

describe('compareKpiSheets', () => {
  it('returns an entry per key with delta null when nothing changed', () => {
    const cells = compareKpiSheets(EMPTY_SHEET, EMPTY_SHEET, ['alpha', 'mass']);
    expect(cells).toEqual([
      { key: 'alpha', from: null, to: null, delta: null, changed: false },
      { key: 'mass', from: null, to: null, delta: null, changed: false },
    ]);
  });

  it('marks a real numeric change as changed with a delta object', () => {
    const from = { ...EMPTY_SHEET, alpha: 100 };
    const to = { ...EMPTY_SHEET, alpha: 150 };
    const [cell] = compareKpiSheets(from, to, ['alpha']);
    expect(cell.changed).toBe(true);
    expect(cell.delta?.direction).toBe('up');
    expect(cell.delta?.raw).toBe(50);
  });

  it('renders nothing (delta null) when either side is a gap', () => {
    const from = { ...EMPTY_SHEET, mass: 500 };
    const to = { ...EMPTY_SHEET, mass: null };
    const [cell] = compareKpiSheets(from, to, ['mass']);
    expect(cell.changed).toBe(false);
    expect(cell.delta).toBeNull();
  });

  it('a lower-is-better key (mass) marks a decrease as good', () => {
    const from = { ...EMPTY_SHEET, mass: 500 };
    const to = { ...EMPTY_SHEET, mass: 400 };
    const [cell] = compareKpiSheets(from, to, ['mass']);
    expect(cell.delta?.direction).toBe('down');
    expect(cell.delta?.good).toBe(true);
  });
});

describe('buildPerspectiveDeltas', () => {
  it('groups cells into the four perspectives and counts only real changes', () => {
    const from = { ...EMPTY_SHEET, alpha: 100, ir: 10 };
    const to = { ...EMPTY_SHEET, alpha: 150, ir: 10 };
    const cells = compareKpiSheets(from, to);
    const perspectives = buildPerspectiveDeltas(cells);
    expect(perspectives.map((p) => p.perspective)).toEqual([
      'offensive',
      'defensive',
      'movement',
      'signature',
    ]);
    const offensive = perspectives.find((p) => p.perspective === 'offensive')!;
    expect(offensive.changedCount).toBe(1);
    expect(offensive.cells.map((c) => c.key)).toEqual([...PERSPECTIVE_KPIS.offensive]);
    const signature = perspectives.find((p) => p.perspective === 'signature')!;
    expect(signature.changedCount).toBe(0); // ir unchanged (10 -> 10)
  });
});

describe('comparePortOccupants', () => {
  it('returns nothing when both sides are identical', () => {
    const map = { hardpoint_gun_left: 'BEHR_LaserCannon_S3' };
    expect(comparePortOccupants(map, map)).toEqual([]);
  });

  it('reports a swapped occupant', () => {
    const from = { hardpoint_gun_left: 'BEHR_LaserCannon_S3' };
    const to = { hardpoint_gun_left: 'KLWE_LaserRepeater_S3' };
    expect(comparePortOccupants(from, to)).toEqual([
      { portName: 'hardpoint_gun_left', fromClassName: 'BEHR_LaserCannon_S3', toClassName: 'KLWE_LaserRepeater_S3' },
    ]);
  });

  it('reports a port that only exists on one side as a null/occupant delta', () => {
    const from = {};
    const to = { hardpoint_missile_1: 'MSLA_Rocket' };
    expect(comparePortOccupants(from, to)).toEqual([
      { portName: 'hardpoint_missile_1', fromClassName: null, toClassName: 'MSLA_Rocket' },
    ]);
  });

  it('sorts by port name', () => {
    const from = {};
    const to = { b_port: 'X', a_port: 'Y' };
    expect(comparePortOccupants(from, to).map((p) => p.portName)).toEqual(['a_port', 'b_port']);
  });
});

describe('compareShipBuilds', () => {
  it('assembles the full result from two build-scoped inputs', () => {
    const result = compareShipBuilds(
      {
        build: { id: 'b1', patchVersion: '4.9.0' },
        kpiSheet: { ...EMPTY_SHEET, alpha: 100 },
        occupants: { hardpoint_gun_left: 'BEHR_LaserCannon_S3' },
      },
      {
        build: { id: 'b2', patchVersion: '4.10.0' },
        kpiSheet: { ...EMPTY_SHEET, alpha: 150 },
        occupants: { hardpoint_gun_left: 'KLWE_LaserRepeater_S3' },
      },
    );
    expect(result.fromBuild).toEqual({ id: 'b1', patchVersion: '4.9.0' });
    expect(result.toBuild).toEqual({ id: 'b2', patchVersion: '4.10.0' });
    expect(result.ports.length).toBe(1);
    expect(result.perspectives.find((p) => p.perspective === 'offensive')!.changedCount).toBe(1);
  });
});
