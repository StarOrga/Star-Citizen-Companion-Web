import type { Dimensions } from '../codex.types';
import type { CodexDetail } from '../codex.service';
import { computeKpiSheet } from '../codex-loadout-stats';
import type { LayoutSection, LayoutSlot } from '../codex-hardpoint-layout.component';
import { NOMAD_SHIP_STATS, nomadOccupants } from '../testing/nomad-power.fixture';
import {
  ammoRangeOf,
  attachTypeLabel,
  buildHeroChips,
  buildHeroFacts,
  buildShipFactGroups,
  buildStageCounts,
  fmtGm,
} from './codex-detail-facts';

/** A translate stand-in that shows what was asked for: `key|{params}`. */
const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}|${JSON.stringify(params)}` : key);

function detail(kind: CodexDetail['kind'], row: Record<string, unknown>, payload: unknown = {}): CodexDetail {
  return { classNameSlug: 'X', kind, row, payload, ports: [], strings: [] };
}

function slots(n: number, children?: LayoutSlot['children']): LayoutSlot[] {
  return Array.from({ length: n }, (_, i) => ({ port: `P${i}`, children }) as unknown as LayoutSlot);
}

describe('codex-detail facts', () => {
  describe('buildHeroFacts', () => {
    it('leaves 0, empty and missing values out', () => {
      const facts = buildHeroFacts(
        {
          detail: detail('weapon', { weapon_class: 'rifle', sub_type: '', size: 3, grade: 0, attach_type: null }),
          dimensions: null,
          techStats: null,
          ammoRange: null,
        },
        t,
      );
      expect(facts.map((f) => [f.label, f.value])).toEqual([
        ['codex.detail.weaponClass', 'codex.weaponClass.rifle'],
        ['codex.detail.size', 'S3'],
      ]);
    });

    it('puts dimensions and the quantum range (in Gm, accented) on a ship', () => {
      const facts = buildHeroFacts(
        {
          detail: detail('ship', {}),
          dimensions: { length: 20, width: 10, height: 5 } as Dimensions,
          techStats: {
            quantum: { jumpRangeMm: 12_000_000_000, driveSpeedMs: null } as never,
            quantumDriveClassName: null,
            hydrogenCapacity: null,
            quantumFuelCapacity: null,
          },
          ammoRange: null,
        },
        t,
      );
      expect(facts.map((f) => f.label)).toEqual(['codex.detail.dimensions', 'codex.detail.quantumRange']);
      expect(facts[1].value).toBe(fmtGm(12_000_000_000));
      expect(facts[1].accent).toBeTrue();
    });

    it('words the on-foot weapon type and attach type instead of raw game tokens (audit L25)', () => {
      const known = (key: string) => (key === 'codex.attachType.WeaponPersonal' ? 'Handwaffe' : key);
      const facts = buildHeroFacts(
        {
          detail: detail('weapon', { sub_type: 'Medium', attach_type: 'WeaponPersonal', size: 1 }),
          dimensions: null,
          techStats: null,
          ammoRange: null,
        },
        known,
      );
      expect(facts.find((f) => f.label === 'codex.detail.subType')?.value).toBe('fps.weaponType.primary');
      expect(facts.find((f) => f.label === 'codex.detail.attachType')?.value).toBe('Handwaffe');
    });

    it('keeps an untranslated attach type and a ship weapon sub type as they are', () => {
      const facts = buildHeroFacts(
        {
          detail: detail('weapon', { sub_type: 'Gun', attach_type: 'WeaponOdd' }),
          dimensions: null,
          techStats: null,
          ammoRange: null,
        },
        t,
      );
      expect(facts.find((f) => f.label === 'codex.detail.subType')?.value).toBe('Gun');
      expect(facts.find((f) => f.label === 'codex.detail.attachType')?.value).toBe('WeaponOdd');
    });

    it('words an armour piece weight class', () => {
      const facts = buildHeroFacts(
        { detail: detail('item', { sub_type: 'Heavy', attach_type: 'Char_Armor_Torso' }), dimensions: null, techStats: null, ammoRange: null },
        t,
      );
      expect(facts.find((f) => f.label === 'codex.detail.subType')?.value).toBe('fps.weight.heavy');
      expect(attachTypeLabel('Char_Armor_Torso', t)).toBe('Char_Armor_Torso');
      expect(attachTypeLabel(null, t)).toBeNull();
    });

    it('returns nothing without a detail', () => {
      expect(buildHeroFacts({ detail: null, dimensions: null, techStats: null, ammoRange: null }, t)).toEqual([]);
    });
  });

  describe('ammoRangeOf', () => {
    it('is speed × lifetime, or null when one is missing', () => {
      expect(ammoRangeOf(detail('ammunition', {}, { speed: 1000, lifetime: 2 }))).toBe(2000);
      expect(ammoRangeOf(detail('ammunition', {}, { speed: 1000 }))).toBeNull();
    });
  });

  describe('buildHeroChips', () => {
    const ship = (payload: Record<string, unknown>, row: Record<string, unknown> = {}) =>
      detail('ship', row, payload);

    it('resolves role through the locale map and prints crew via the translate key', () => {
      const chips = buildHeroChips(
        {
          detail: ship({ cargoScu: 32 }, { role: '@role_x', crew_size: 2 }),
          localeMap: new Map([['@role_x', 'Starter']]),
          hasCargo: () => false,
        },
        t,
      );
      expect(chips.map((c) => c.key)).toEqual(['role', 'crew', 'cargo']);
      expect(chips[0].text).toBe('Starter');
      expect(chips[1].text).toBe('codex.detail.chipCrew|{"n":2}');
      expect(chips[2].accent).toBeTrue();
    });

    it('asks the capability only when the payload carries no cargo status', () => {
      const hasCargo = jasmine.createSpy('hasCargo').and.returnValue(true);
      const withStatus = buildHeroChips({ detail: ship({ cargoStatus: 'none' }), localeMap: new Map(), hasCargo }, t);
      expect(hasCargo).not.toHaveBeenCalled();
      expect(withStatus.find((c) => c.key === 'cargo')?.ghost).toBeTrue();

      const legacy = buildHeroChips({ detail: ship({}), localeMap: new Map(), hasCargo }, t);
      expect(hasCargo).toHaveBeenCalledTimes(1);
      expect(legacy.find((c) => c.key === 'cargo')?.gap).toBeTrue();
    });

    it('has no chips off a ship', () => {
      expect(buildHeroChips({ detail: detail('weapon', {}), localeMap: new Map(), hasCargo: () => true }, t)).toEqual([]);
    });
  });

  describe('buildShipFactGroups', () => {
    it('builds the five groups and notes missing flight data once', () => {
      const occupants = nomadOccupants();
      const groups = buildShipFactGroups(
        {
          detail: detail('ship', {}, { stats: NOMAD_SHIP_STATS, crew: { size: 1 } }),
          dimensions: null,
          techStats: null,
          kpiSheet: computeKpiSheet(occupants, null),
          occupants,
        },
        t,
      );
      expect(groups.map((g) => g.titleKey)).toEqual([
        'codex.analysis.ship.flightPerformance',
        'codex.analysis.ship.mass',
        'codex.analysis.ship.systems',
        'codex.analysis.ship.signature',
        'codex.analysis.ship.hull',
      ]);
      expect(groups[0].note).toBe('codex.hull.flightMissing');
      const hull = groups[4].rows;
      expect(hull.find((r) => r.labelKey === 'codex.hull.crew')?.value).toBe('1');
      expect(hull.find((r) => r.labelKey === 'codex.hull.dimensions')?.value).toBeNull();
    });

    it('is empty off a ship', () => {
      expect(
        buildShipFactGroups(
          { detail: detail('weapon', {}), dimensions: null, techStats: null, kpiSheet: computeKpiSheet([], null), occupants: [] },
          t,
        ),
      ).toEqual([]);
    });
  });

  describe('buildStageCounts', () => {
    const sections: LayoutSection[] = [
      { section: 'weapons', slots: slots(3) },
      {
        section: 'missiles',
        slots: slots(2, [{ className: 'MISSILE_A', count: 4 }] as unknown as LayoutSlot['children']),
      },
      { section: 'structure', slots: slots(5) },
    ];

    it('counts one chip per block, missiles by what the racks carry, the airframe off the stage', () => {
      const chips = buildStageCounts('ship', sections);
      expect(chips.find((c) => c.group === 'structure')).toBeUndefined();
      expect(chips.find((c) => c.group === 'weapons')?.count).toBe(3);
      const missiles = chips.find((c) => c.group === 'missiles');
      expect(missiles?.count).toBe(8);
      expect(missiles?.detailKey).toBe('codex.detail.stageLaunchers');
      expect(missiles?.detailCount).toBe(2);
    });

    it('falls back to counting the racks when no missile is named', () => {
      const chips = buildStageCounts('ship', [{ section: 'missiles', slots: slots(2) }]);
      expect(chips).toEqual([
        { group: 'missiles', count: 2, labelKey: 'codex.detail.stageMissileRacks', detailKey: null, detailCount: 0 },
      ]);
    });

    it('is empty off a ship', () => {
      expect(buildStageCounts('weapon', sections)).toEqual([]);
    });
  });
});
