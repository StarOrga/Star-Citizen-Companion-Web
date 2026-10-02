/**
 * Pure fact builders of the codex detail page (AUD-090, seam 3): the hero's
 * fact tiles and chips, the Analyse card's Schiff panel and the stage's
 * module census. No signals and no injection: codex-detail's computeds read
 * the signals and hand the values in, so the page's reactivity stays exactly
 * where it was. `t` is the translate function (TranslateService.instant).
 */
import type { AmmunitionPayload, Dimensions, ShipPayload } from '../codex.types';
import type { CodexDetail } from '../codex.service';
import { cleanLocaleValue, formatNumber } from '../codex-format';
import { fpsArmorWeightKey, fpsWeaponTypeKey } from '../fps-labels';
import { crossSectionAxes, type computeKpiSheet } from '../codex-loadout-stats';
import type { ShipFactGroup, ShipFactRow } from '../codex-analysis-panels.component';
import type { LayoutSection } from '../codex-hardpoint-layout.component';
import { resolveCareerLabel } from '../codex-rank';
import { SHIP_MODULE_SECTION_ORDER, shipModuleGroupLabelKey, shipModuleGroupOf } from '../ship-module-sections';
import { SummaryOccupant, equippedMass } from '../ship-summary-panels';
import type { Fact, ShipTechStats, StageCountChip } from './codex-detail.types';

/** Translate function: i18n key (+ params) to text. */
export type Translate = (key: string, params?: Record<string, unknown>) => string;

/** One chip on the ship stage (career, role, crew, cargo, mass). */
export interface HeroChip {
  key: string;
  text: string;
  accent?: boolean;
  ghost?: boolean;
  gap?: boolean;
}

type KpiSheet = ReturnType<typeof computeKpiSheet>;

/** jumpRange comes in metres → giga-metre display (Gm), same as the hangar. */
export function fmtGm(v: number): string {
  return `${formatNumber(Math.round(v / 1_000_000))} Gm`;
}

/** Effective ballistic range = speed × lifetime (when both present). */
export function ammoRangeOf(detail: CodexDetail | null): number | null {
  const p = detail?.payload as AmmunitionPayload | undefined;
  if (!p) return null;
  const speed = p.speed ?? (p.raw?.['speed'] as number | undefined) ?? null;
  const life = p.lifetime ?? (p.raw?.['lifetime'] as number | undefined) ?? null;
  return speed && life ? speed * life : null;
}

/** Compact hero facts — kind-aware, only meaningful values (0, '' and null are left out). */
export function buildHeroFacts(
  input: {
    detail: CodexDetail | null;
    dimensions: Dimensions | null;
    techStats: ShipTechStats | null;
    ammoRange: number | null;
  },
  t: Translate,
): Fact[] {
  const d = input.detail;
  if (!d) return [];
  const out: Fact[] = [];
  const row = d.row;
  const add = (label: string, value: unknown, accent = false) => {
    if (value == null || value === '' || value === 0) return;
    out.push({ label: t(label), value: String(value), accent });
  };

  if (d.kind === 'ship') {
    const dim = input.dimensions;
    if (dim) {
      out.push({
        label: t('codex.detail.dimensions'),
        value: `${formatNumber(dim.length)} × ${formatNumber(dim.width)} × ${formatNumber(dim.height)} m`,
      });
    }
    // Tech facts from the stock loadout (#137): quantum + fuel numbers.
    const tech = input.techStats;
    if (tech) {
      if (tech.quantum.jumpRangeMm != null) {
        add('codex.detail.quantumRange', fmtGm(tech.quantum.jumpRangeMm), true);
      }
      if (tech.quantum.driveSpeedMs != null) {
        add('codex.detail.quantumSpeed', formatNumber(tech.quantum.driveSpeedMs / 1000) + ' km/s');
      }
      add('codex.detail.quantumFuel', tech.quantumFuelCapacity == null ? '' : formatNumber(tech.quantumFuelCapacity));
      add('codex.detail.fuelCapacity', tech.hydrogenCapacity == null ? '' : formatNumber(tech.hydrogenCapacity));
    }
  } else if (d.kind === 'weapon') {
    const wc = row['weapon_class'];
    if (typeof wc === 'string') add('codex.detail.weaponClass', t('codex.weaponClass.' + wc));
    // On-foot weapons carry the archive's size tokens (Small/Medium/Large) as
    // sub_type — say "Primärwaffe", not "Medium" (Codex UX audit L25).
    const personal = row['attach_type'] === 'WeaponPersonal';
    const fpsType = personal ? fpsWeaponTypeKey(row['sub_type'] as string | null) : null;
    add('codex.detail.subType', fpsType ? t(fpsType) : row['sub_type']);
    if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
    add('codex.detail.grade', row['grade']);
    add('codex.detail.attachType', attachTypeLabel(row['attach_type'], t));
  } else if (d.kind === 'component') {
    const ck = row['kind'];
    if (typeof ck === 'string') add('codex.detail.componentKind', t('codex.componentKind.' + ck));
    if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
    add('codex.detail.grade', row['grade']);
  } else if (d.kind === 'item') {
    const weight = fpsArmorWeightKey(row['sub_type'] as string | null);
    add('codex.detail.subType', weight ? t(weight) : row['sub_type']);
    if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
    add('codex.detail.grade', row['grade']);
    add('codex.detail.attachType', attachTypeLabel(row['attach_type'], t));
  } else if (d.kind === 'ammunition') {
    if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
    const speed = row['speed'];
    if (typeof speed === 'number' && speed > 0) add('codex.detail.speed', formatNumber(speed) + ' m/s');
    const range = input.ammoRange;
    if (range) add('codex.detail.range', formatNumber(range) + ' m');
  }
  return out;
}

/**
 * The ship stage's chips (concept order: career · role · size · crew · cargo ·
 * mass). `hasCargo` is a thunk: it is only consulted for a payload without a
 * cargoStatus, and the caller's computed must track the capability signal
 * only then, as it always has.
 */
export function buildHeroChips(
  input: {
    detail: CodexDetail | null;
    localeMap: ReadonlyMap<string, string>;
    hasCargo: () => boolean;
  },
  t: Translate,
): HeroChip[] {
  const d = input.detail;
  if (!d || d.kind !== 'ship') return [];
  const p = d.payload as ShipPayload;
  const out: HeroChip[] = [];
  const career = resolveCareerLabel(p.career ?? null);
  if (career) {
    const label = cleanLocaleValue(input.localeMap.get(career) ?? career);
    if (label) out.push({ key: 'career', text: label });
  }
  // Role. No size-class field exists on ShipPayload/row today, so that chip is
  // skipped entirely rather than guessed (MASTER gap rule).
  const row = d.row;
  const roleRaw = row?.['role'];
  if (typeof roleRaw === 'string' && roleRaw) {
    const label = cleanLocaleValue(input.localeMap.get(roleRaw) ?? roleRaw);
    if (label) out.push({ key: 'role', text: label });
  }
  const crew = row?.['crew_size'];
  if (crew != null && crew !== '' && crew !== 0) {
    out.push({ key: 'crew', text: t('codex.detail.chipCrew', { n: crew }) });
  }
  // Three outcomes, not two. `cargoScu: null` covers both "this hull has no
  // hold" (a Gladius) and "it hauls, the client files never size it" (the
  // Nomad's open bed is a door entity — verified against LIVE 4.9.0), and
  // printing "Kein Laderaum" on the second is a false statement. The
  // extractor says which via `cargoStatus`; pre-schema-3 payloads have no
  // such field, so fall back to the loadout-derived capability.
  const cargo = p.cargoScu ?? null;
  const cargoStatus = p.cargoStatus ?? null;
  const hauls = cargoStatus ? cargoStatus !== 'none' : input.hasCargo();
  if (cargo != null && cargo > 0) {
    out.push({ key: 'cargo', text: `${formatNumber(cargo)} SCU`, accent: true });
  } else if (hauls) {
    out.push({ key: 'cargo', text: t('codex.detail.chipCargoUnknown'), gap: true });
  } else {
    out.push({ key: 'cargo', text: t('codex.detail.chipNoCargo'), ghost: true });
  }
  const massKg = p.hull?.mass ?? null;
  if (massKg != null && massKg > 0) {
    // Hundredths of a tonne only mean something on a light hull; a capital
    // ship's "37.854,32 t" was noise that no longer fit its chip.
    const tonnes = massKg / 1000;
    out.push({ key: 'mass', text: `${formatNumber(tonnes >= 100 ? Math.round(tonnes) : tonnes)} t` });
  }
  return out;
}

/** Schiff panel — flight/mass/systems/signature/hull, grouped, gaps honoured. */
export function buildShipFactGroups(
  input: {
    detail: CodexDetail | null;
    dimensions: Dimensions | null;
    techStats: ShipTechStats | null;
    kpiSheet: KpiSheet;
    occupants: readonly SummaryOccupant[];
  },
  t: Translate,
): ShipFactGroup[] {
  const d = input.detail;
  if (!d || d.kind !== 'ship') return [];
  const p = d.payload as ShipPayload;
  const flight = p.flight;
  const dim = input.dimensions;
  const mass = equippedMass(input.occupants);
  const sheet = input.kpiSheet;
  const tech = input.techStats;
  const num = (v: number | null | undefined, unit: string): string | null =>
    v == null || !Number.isFinite(v) || v === 0 ? null : `${formatNumber(v)} ${unit}`;

  const flightRows: ShipFactRow[] = [
    { labelKey: 'codex.hull.scmSpeed', value: num(flight?.scmSpeed, 'm/s'), gapKey: 'codex.summary.gap.noFlight' },
    { labelKey: 'codex.hull.maxSpeed', value: num(flight?.maxSpeed, 'm/s'), gapKey: 'codex.summary.gap.noFlight' },
    { labelKey: 'codex.hull.boostSpeed', value: num(flight?.boostSpeed, 'm/s'), gapKey: 'codex.summary.gap.noFlight' },
    { labelKey: 'codex.hull.pitch', value: num(flight?.pitch, '°/s'), gapKey: 'codex.summary.gap.noFlight' },
    { labelKey: 'codex.hull.yaw', value: num(flight?.yaw, '°/s'), gapKey: 'codex.summary.gap.noFlight' },
    { labelKey: 'codex.hull.roll', value: num(flight?.roll, '°/s'), gapKey: 'codex.summary.gap.noFlight' },
  ];

  // "6.604 / 3.302 / 9.712" — only axes that actually exist; null when none do.
  const axes = crossSectionAxes(p.stats as Record<string, Record<string, unknown>> | undefined);
  const axisParts = [axes.x, axes.y, axes.z].filter((v): v is number => v != null);
  const crossSectionAxesLabel = axisParts.length > 0 ? axisParts.map((v) => formatNumber(v)).join(' / ') : null;

  return [
    {
      titleKey: 'codex.analysis.ship.flightPerformance',
      rows: flightRows,
      // The sentence the deleted "Rumpf & Flug" block used to carry: said
      // once, where the empty rows are, and only when they are ALL empty.
      note: flightRows.every((r) => r.value == null) ? t('codex.hull.flightMissing') : null,
    },
    {
      titleKey: 'codex.analysis.ship.mass',
      rows: [{ labelKey: 'codex.hull.equippedMass', value: num(mass, 'kg'), gapKey: 'codex.summary.gap.noEquipmentMass' }],
      note: t('codex.analysis.ship.massEquipmentNote'),
    },
    {
      titleKey: 'codex.analysis.ship.systems',
      rows: [
        { labelKey: 'codex.kpi.quantumSpeed', value: num(sheet.quantumSpeed, 'km/s'), gapKey: 'codex.summary.gap.noQuantum' },
        { labelKey: 'codex.kpi.quantumRange', value: sheet.quantumRange != null ? `${formatNumber(sheet.quantumRange / 1_000_000)} Gm` : null, gapKey: 'codex.summary.gap.noQuantum' },
        { labelKey: 'codex.kpi.spool', value: num(sheet.spool, 's'), gapKey: 'codex.summary.gap.noQuantum' },
        // The two tank figures. They lived ONLY in the hero's fact tiles, so
        // moving the tiles into this card had to bring them along or the
        // page would simply stop knowing them (decision 1, hard constraint).
        { labelKey: 'codex.detail.quantumFuel', value: tech?.quantumFuelCapacity != null ? formatNumber(tech.quantumFuelCapacity) : null, gapKey: 'codex.summary.gap.noQuantum' },
        { labelKey: 'codex.detail.fuelCapacity', value: tech?.hydrogenCapacity != null ? formatNumber(tech.hydrogenCapacity) : null, gapKey: 'codex.summary.gap.noFlight' },
      ],
    },
    {
      titleKey: 'codex.analysis.ship.signature',
      rows: [
        // IR/EM: the game files carry no scalar fields at all (verified live
        // Nomad) — distinct gap wording from the cross-section's "pending
        // upload" one.
        { labelKey: 'codex.kpi.ir', value: num(sheet.ir, ''), gapKey: 'codex.summary.gap.noEmissionModel' },
        { labelKey: 'codex.kpi.emIdle', value: num(sheet.emIdle, ''), gapKey: 'codex.summary.gap.noEmissionModel' },
        { labelKey: 'codex.kpi.emMax', value: num(sheet.emMax, ''), gapKey: 'codex.summary.gap.noEmissionModel' },
        // The three cross-section axes shown honestly (x/y/z), not
        // collapsed into one number — the KPI band uses the max of the
        // three for its single comparable cell (see crossSectionMax()).
        { labelKey: 'codex.kpi.crossSection', value: crossSectionAxesLabel, gapKey: 'codex.summary.gap.noSignature' },
      ],
      note: crossSectionAxesLabel != null ? t('codex.analysis.ship.crossSectionNote') : null,
    },
    {
      titleKey: 'codex.analysis.ship.hull',
      rows: [
        { labelKey: 'codex.hull.dimensions', value: dim ? `${formatNumber(dim.length)} × ${formatNumber(dim.width)} × ${formatNumber(dim.height)} m` : null },
        { labelKey: 'codex.hull.crew', value: p.crew?.size ? String(p.crew.size) : null },
        { labelKey: 'codex.hull.hullHp', value: null, gapKey: 'codex.summary.gap.noHullMass' },
      ],
    },
  ];
}

/**
 * Module census on the stage (feedback 140dfb7e). One chip per loadout BLOCK,
 * in the loadout column's own order and with its own headings, counting the
 * same hardpoints the block's "N Slots" census counts — the module sections
 * are the single source for both, so the two can never disagree again.
 *
 * Missiles are the one block where the slot is not the unit a pilot counts:
 * a rack is a slot, the missiles are what it carries. The chip therefore
 * reads "8 Raketen · 2 Werfer" — the stock missiles across every rack, with
 * the rack count as the detail — and falls back to counting the racks alone
 * when the extract names no missile on any of them.
 */
export function buildStageCounts(
  kind: string | null,
  sections: readonly LayoutSection[],
): StageCountChip[] {
  if (kind !== 'ship') return [];
  const bySection = new Map(sections.map((s) => [s.section, s] as const));
  // Blocks in the order their first section appears — the loadout column's
  // order. The airframe is the one block that is not a decision; it stays
  // off the picture.
  const groups = [...new Set(SHIP_MODULE_SECTION_ORDER.map((s) => shipModuleGroupOf(s)))];
  const out: StageCountChip[] = [];
  for (const group of groups) {
    if (group === 'structure') continue;
    const blockSections = SHIP_MODULE_SECTION_ORDER.filter((s) => shipModuleGroupOf(s) === group)
      .map((s) => bySection.get(s))
      .filter((s): s is LayoutSection => !!s && s.slots.length > 0);
    const slots = blockSections.reduce((n, s) => n + s.slots.length, 0);
    if (slots === 0) continue;
    const labelKey = shipModuleGroupLabelKey(group);
    if (group === 'missiles') {
      const missiles = blockSections
        .flatMap((s) => s.slots)
        .flatMap((slot) => slot.children ?? [])
        .filter((c) => !!c.className)
        .reduce((n, c) => n + c.count, 0);
      if (missiles > 0) {
        out.push({
          group,
          count: missiles,
          labelKey,
          detailKey: 'codex.detail.stageLaunchers',
          detailCount: slots,
        });
        continue;
      }
      out.push({ group, count: slots, labelKey: 'codex.detail.stageMissileRacks', detailKey: null, detailCount: 0 });
      continue;
    }
    out.push({ group, count: slots, labelKey, detailKey: null, detailCount: 0 });
  }
  return out;
}

/**
 * A game attach-type token in words when we have a translation
 * (`codex.attachType.<token>`), else the raw token — power users search by it.
 */
export function attachTypeLabel(token: unknown, t: Translate): string | null {
  if (typeof token !== 'string' || !token) return null;
  const key = `codex.attachType.${token}`;
  const label = t(key);
  return label && label !== key ? label : token;
}
