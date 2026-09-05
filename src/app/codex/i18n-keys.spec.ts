// Every i18n key the ship-page DOMAIN MODELS emit must resolve in BOTH files.
// -----------------------------------------------------------------------------
// R4: the literal keys were aligned by hand once; the DYNAMIC ones (built from
// a group id, a KpiKey, an axis name, a band) drifted the moment a slug did not
// match the designer's authored string — `codex.energy.tooltip.life.body`,
// `codex.rank.gap.sustainedDps`, `codex.rank.band.lower` all rendered as their
// own key in the UI and nothing failed. This spec walks the models' OUTPUT, so
// a renamed group or a new axis is caught without anybody remembering to add a
// case here.
//
// It reads the shipped catalogues directly (`resolveJsonModule`), not through
// ngx-translate: the point is the FILES, not the loader.
import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';

import { computePowerSheet, POWER_GROUP_ORDER, POWER_REQUIRED_SCHEMA } from './codex-power';
import { buildFoldPreview, FOLD_PEEK_LOCK_KEY } from './codex-fold-preview';
import { buildKpiStrip, kpiTooltipKey } from './codex-kpi-sets';
import { MISSIONS } from './codex-mission';
import { rankShip, RANK_PROFILES, rankProfileDisabledReason } from './codex-rank';
import type { RankShipInput } from './codex-rank';
import { swapScopeOptions, SWAP_VALUE_CATALOGUE, buildSwapCandidate } from './swap-table';
import { activeFilterChips } from './table-column-menu';
import type { ColumnDef, ColumnMenuState } from './table-column-menu';
import type { KpiSheet } from './codex-loadout-stats';
import { NOMAD_SHIP_STATS, nomadOccupants, NOMAD_REPEATERS, fixtureOccupant } from './testing/nomad-power.fixture';
import type { ShipModuleSection } from './ship-module-sections';

type Catalogue = Record<string, unknown>;

function lookup(cat: Catalogue, key: string): unknown {
  let node: unknown = cat;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

const collected = new Set<string>();
const take = (...keys: (string | null | undefined)[]): void => {
  for (const k of keys) if (typeof k === 'string' && k !== '') collected.add(k);
};

// ── the power dock, in every state the model can reach ───────────────────────
function collectPower(): void {
  const occupants = nomadOccupants();
  for (const mode of ['scm', 'nav'] as const) {
    for (const preset of ['auto', 'stealth'] as const) {
      for (const cut of [[], ['weapons'] as const]) {
        const s = computePowerSheet({
          occupants,
          shipStats: NOMAD_SHIP_STATS,
          mode,
          preset,
          cutGroups: [...cut],
        });
        take(s.readinessKey, ...s.gapKeys);
        for (const g of s.groups) take(g.labelKey, g.tooltipTitleKey, g.tooltipBodyKey, g.stateLabelKey);
        for (const f of s.facts) take(f.labelKey, f.tooltipKey, f.gapKey);
      }
    }
  }
  // the `available:false` path — an empty ship and a stale build
  for (const input of [
    { occupants: [] },
    { occupants, schemaVersion: POWER_REQUIRED_SCHEMA - 1 },
  ]) {
    const s = computePowerSheet(input);
    take(s.readinessKey, ...s.gapKeys);
    for (const g of s.groups) take(g.labelKey, g.tooltipTitleKey, g.tooltipBodyKey, g.stateLabelKey);
    for (const f of s.facts) take(f.labelKey, f.tooltipKey, f.gapKey);
  }
}

// ── ranking: every profile, every scope, plus the gap and fallback strings ───
function collectRank(): void {
  const sheet: Partial<KpiSheet> = { alpha: 100, sustainedDps: 500, cargo: 24, mass: 78000 };
  const target: RankShipInput = {
    className: 'CNOU_Nomad',
    sizeClass: 1,
    career: '@vehicle_focus_Light_Freight',
    sheet,
  };
  const cohort: RankShipInput[] = [
    target,
    { className: 'AEGS_Avenger', sizeClass: 1, career: null, sheet: { alpha: 80 } },
  ];
  for (const profile of RANK_PROFILES) {
    take(profile.labelKey);
    for (const scope of ['sizeClass', 'all', 'career'] as const) {
      const r = rankShip(target, cohort, { profile, scope });
      take(r.bandKey, r.scopeFallbackKey);
      for (const a of r.axes) take(a.labelKey, a.gapKey);
    }
    // and the degraded scope: a target with no career must fall back visibly
    const r = rankShip({ ...target, career: null }, cohort, { profile, scope: 'career' });
    take(r.scopeFallbackKey);
    take(rankProfileDisabledReason(profile.id, { ...target, sheet: {} }));
  }
  take('codex.rank.scope.sizeClass', 'codex.rank.scope.all', 'codex.rank.scope.career');
}

// ── fold preview: one call per section kind ──────────────────────────────────
const ALL_SECTIONS: readonly ShipModuleSection[] = [
  'weapons',
  'remoteTurrets',
  'missiles',
  'countermeasures',
  'pod',
  'shields',
  'powerPlants',
  'quantum',
  'radar',
  'coolers',
  'lifeSupport',
  'structure',
];

function collectFold(): void {
  const occupants = nomadOccupants();
  for (const section of ALL_SECTIONS) {
    const preview = buildFoldPreview(section, occupants);
    take(preview.lockKey, FOLD_PEEK_LOCK_KEY);
    for (const chip of [...preview.chips, preview.aggregate]) {
      if (!chip) continue;
      take(chip.roleKey, chip.unitKey, chip.labelKey);
    }
  }
}

// ── KPI strip: every mission's six cells ─────────────────────────────────────
function collectKpi(): void {
  const full: KpiSheet = {} as KpiSheet;
  for (const mission of MISSIONS) {
    for (const key of mission.kpis) (full as Record<string, number>)[key] = 1;
  }
  for (const mission of MISSIONS) {
    take(mission.labelKey);
    for (const cell of buildKpiStrip(mission, full, full)) {
      take(cell.labelKey, cell.tooltipKey, cell.gapKey);
    }
    for (const key of mission.kpis) take(kpiTooltipKey(key));
  }
}

// ── picker: scopes, the value catalogue, the filter chips ────────────────────
function collectPicker(): void {
  const candidate = buildSwapCandidate({
    className: 'KLWE_LaserRepeater_S3_SCItem',
    kind: 'weapon',
    nameLocalized: 'Bulldog',
    manufacturerCode: 'KLWE',
    size: 3,
    grade: 'A',
    subType: 'Gun',
    payload: fixtureOccupant(NOMAD_REPEATERS).payload,
  });
  for (const o of swapScopeOptions([candidate], candidate)) take(o.labelKey);
  for (const v of SWAP_VALUE_CATALOGUE) if (v.key.includes('.')) take(v.key);

  const columns: ColumnDef<unknown>[] = [
    { key: 'codex.picker.col.power', labelKey: 'codex.picker.col.power', kind: 'numeric', accessor: () => 1 },
    { key: 'codex.picker.col.grade', labelKey: 'codex.picker.col.grade', kind: 'categorical', accessor: () => 'A' },
  ];
  const states: ColumnMenuState[] = [
    { sort: null, filters: { 'codex.picker.col.power': { kind: 'numeric', min: 1, max: 3 } } },
    { sort: null, filters: { 'codex.picker.col.power': { kind: 'numeric', min: 1, max: null } } },
    { sort: null, filters: { 'codex.picker.col.power': { kind: 'numeric', min: null, max: 3 } } },
    { sort: null, filters: { 'codex.picker.col.grade': { kind: 'categorical', selected: ['A'] } } },
  ];
  for (const state of states) {
    for (const chip of activeFilterChips(columns, state)) take(chip.columnLabelKey, chip.textKey);
  }
}

describe('i18n keys emitted by the ship-page models', () => {
  beforeAll(() => {
    collectPower();
    collectRank();
    collectFold();
    collectKpi();
    collectPicker();
  });

  it('collects a non-trivial key set (guards against a silent no-op)', () => {
    expect(collected.size).toBeGreaterThan(60);
  });

  it('resolves every key in de.json', () => {
    const missing = [...collected].filter((k) => typeof lookup(de as Catalogue, k) !== 'string');
    expect(missing).toEqual([]);
  });

  it('resolves every key in en.json', () => {
    const missing = [...collected].filter((k) => typeof lookup(en as Catalogue, k) !== 'string');
    expect(missing).toEqual([]);
  });

  it('every power group has a flat tooltip body (R4)', () => {
    for (const g of POWER_GROUP_ORDER) {
      const s = computePowerSheet({ occupants: nomadOccupants() });
      const row = s.groups.find((r) => r.group === g)!;
      expect(row.tooltipBodyKey.split('.').length)
        .withContext(`${g} tooltip is flat, not .title/.body`)
        .toBe(4);
      expect(typeof lookup(de as Catalogue, row.tooltipBodyKey)).toBe('string');
    }
  });
});
