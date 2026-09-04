// A schema-3 Nomad-shaped loadout, derived from the live P4K records.
// -----------------------------------------------------------------------------
// EXPORTED, NOT TEST-ONLY. Specs use it, and a dev-only preview can render the
// dock / KPI strip / ranking with it while the production extract is still on
// schema 2 — without it every one of those surfaces would need a re-extract
// before anybody could look at it (R5).
//
// Provenance — every number below was read out of a real record dump, not
// invented (`scratchpad/probe_power_out/*.json`, LIVE 4.9.0):
//   POWR_LPLT_S01_IonBurst   generates 14 segments, EM 5250, HP 220
//   COOL_JUST_S01_UltraFlow  3 segments, minFraction 0.6666666865348816
//                            (stored 4-dp-rounded as 0.6667), 34 SRU coolant,
//                            EM 1490, IR 7130, HP 200, distortion pool 3000
//   SHLD_SECO_S01_WEB        2 segments, minFraction 0.5, 410 SRU shield regen,
//                            EM 750, IR 0, HP 150, MaxShieldHealth 2160
//   KLWE_LaserRepeater_S3    1.0 STANDARD units (no segments), minFraction 0,
//                            EM 0, IR 0, HP 1500, distortion pool 500000
// The thruster / radar / life-support entries are marked `SYNTHETIC` below:
// the Nomad's own thruster and `RADR_GRNP_S01_Ecouter` records were not part of
// the dump, so they carry a plain 1-segment draw. Nothing else is guessed.
//
// The point of the fixture in one line: three repeaters at 1.0 standard units
// each plus two coolers at 3 and two live shields at 2 want MORE segments than
// the IonBurst's 14 — which is exactly the distribution case the dock has to
// get right (R1).

import { RESOURCE_STATS_GROUP, resourceKey } from '../codex.types';
import type { SummaryOccupant } from '../ship-summary-panels';

/** The Nomad's `stateNames` — every one of these records carries only `Online`. */
export const NOMAD_STATE_NAMES = 'Online';

export interface ResourceFixture {
  /** whole `SPowerSegmentResourceUnit` segments consumed */
  consumeSegments?: number;
  /** `SStandardResourceUnit` power consumed */
  consumeUnits?: number;
  /** whole segments generated (reactors only) */
  generateSegments?: number;
  /** `minimumConsumptionFraction`, as the extractor stores it (4 dp) */
  minFraction?: number;
  coolantConsume?: number;
  coolantGenerate?: number;
  shieldGenerate?: number;
  emNominal?: number;
  irNominal?: number;
  /** override the state prefix — defaults to `online` */
  state?: string;
  stateNames?: string;
}

/**
 * Build the flat, state-prefixed stats group the extractor emits (schema 3).
 * Absent fields are LEFT OUT, never written as 0 — the model distinguishes
 * "the record says nothing" from "the record says zero".
 */
export function resourceStats(
  fx: ResourceFixture,
): Record<string, Record<string, unknown>> {
  const state = (fx.state ?? 'online').toLowerCase();
  const group: Record<string, unknown> = { stateNames: fx.stateNames ?? NOMAD_STATE_NAMES };
  const put = (field: string, v: number | undefined): void => {
    if (v !== undefined) group[resourceKey(field, state)] = v;
  };
  put('power.consumeSegments', fx.consumeSegments);
  put('power.consumeUnits', fx.consumeUnits);
  put('power.generateSegments', fx.generateSegments);
  put('power.minFraction', fx.minFraction);
  put('coolant.consume', fx.coolantConsume);
  put('coolant.generate', fx.coolantGenerate);
  put('shield.generate', fx.shieldGenerate);
  put('em.nominal', fx.emNominal);
  put('ir.nominal', fx.irNominal);
  return { [RESOURCE_STATS_GROUP]: group };
}

export interface OccupantFixture extends ResourceFixture {
  className: string;
  section: SummaryOccupant['section'];
  kind?: string;
  /** `ComponentPayload.kind` — PowerPlant / Shield / Cooler / Thruster / … */
  componentKind?: string;
  count?: number;
  size?: number | null;
  /** extra stats groups (shield HP, health, distortion) merged in verbatim. */
  extraStats?: Record<string, Record<string, unknown>>;
  mass?: number;
}

/** Assemble one `SummaryOccupant` in the shape the ship page hands the model. */
export function fixtureOccupant(fx: OccupantFixture): SummaryOccupant {
  return {
    section: fx.section,
    count: fx.count ?? 1,
    kind: fx.kind ?? 'component',
    payload: {
      className: fx.className,
      kind: fx.componentKind,
      entityKind: fx.kind,
      size: fx.size ?? null,
      mass: fx.mass,
      stats: { ...resourceStats(fx), ...(fx.extraStats ?? {}) },
    },
  } as unknown as SummaryOccupant;
}

const health = (hp: number): Record<string, Record<string, unknown>> => ({
  SHealthComponentParams: { Health: hp },
});

const distortion = (pool: number): Record<string, Record<string, unknown>> => ({
  SDistortionParams: { Maximum: pool },
});

// ── the individual items ─────────────────────────────────────────────────────

/** POWR_LPLT_S01_IonBurst — 14 segments of budget. */
export const NOMAD_REACTOR: OccupantFixture = {
  className: 'POWR_LPLT_S01_IonBurst_SCItem',
  section: 'powerPlants',
  componentKind: 'PowerPlant',
  size: 1,
  generateSegments: 14,
  coolantConsume: 0,
  emNominal: 5250,
  irNominal: 0,
  extraStats: health(220),
};

/** COOL_JUST_S01_UltraFlow — 3 segments, minFraction 0.6667 (R6's ceil case). */
export const NOMAD_COOLER: OccupantFixture = {
  className: 'COOL_JUST_S01_UltraFlow_SCItem',
  section: 'coolers',
  componentKind: 'Cooler',
  size: 1,
  count: 2,
  consumeSegments: 3,
  minFraction: 0.6667,
  coolantGenerate: 34,
  emNominal: 1490,
  irNominal: 7130,
  extraStats: { ...health(200), ...distortion(3000) },
  mass: 30,
};

/** SHLD_SECO_S01_WEB — the two generators that are ON the net. */
export const NOMAD_SHIELD_ACTIVE: OccupantFixture = {
  className: 'SHLD_SECO_S01_WEB_SCItem',
  section: 'shields',
  componentKind: 'Shield',
  size: 1,
  count: 2,
  consumeSegments: 2,
  minFraction: 0.5,
  shieldGenerate: 410,
  coolantConsume: 0,
  emNominal: 750,
  irNominal: 0,
  extraStats: { ...health(150), shield: { MaxShieldHealth: 2160 } },
};

/** The third generator: installed, contributes HP + EM, draws NOTHING (R2). */
export const NOMAD_SHIELD_PASSIVE: OccupantFixture = {
  className: 'SHLD_SECO_S01_WEB_SCItem_Passive',
  section: 'shields',
  componentKind: 'Shield',
  size: 1,
  count: 1,
  consumeSegments: 0,
  consumeUnits: 0,
  minFraction: 0,
  shieldGenerate: 410,
  emNominal: 750,
  irNominal: 0,
  extraStats: { ...health(150), shield: { MaxShieldHealth: 2160 } },
};

/** KLWE_LaserRepeater_S3 ×3 — 1.0 STANDARD unit each, no segments, no signature. */
export const NOMAD_REPEATERS: OccupantFixture = {
  className: 'KLWE_LaserRepeater_S3_SCItem',
  section: 'weapons',
  kind: 'weapon',
  size: 3,
  count: 3,
  consumeUnits: 1,
  minFraction: 0,
  emNominal: 0,
  irNominal: 0,
  extraStats: { ...health(1500), ...distortion(500000) },
  mass: 120,
};

/** SYNTHETIC — the Nomad's own thruster record was not in the probe dump. */
export const NOMAD_THRUSTER: OccupantFixture = {
  className: 'CNOU_Nomad_Thruster_Main_Left',
  section: 'thrusters',
  componentKind: 'Thruster',
  count: 1,
  consumeSegments: 1,
  minFraction: 0.5,
  coolantConsume: 2,
  emNominal: 0,
  irNominal: 0,
};

/** SYNTHETIC — `RADR_GRNP_S01_Ecouter` was not in the probe dump. */
export const NOMAD_RADAR: OccupantFixture = {
  className: 'RADR_GRNP_S01_Ecouter',
  section: 'radar',
  count: 1,
  consumeSegments: 1,
  minFraction: 1,
  coolantConsume: 1,
  emNominal: 0,
  irNominal: 0,
};

/** SYNTHETIC — life support carries no dedicated ComponentKind. */
export const NOMAD_LIFE_SUPPORT: OccupantFixture = {
  className: 'LFSP_RSIN_S01_LifeSupport',
  section: 'lifeSupport',
  count: 1,
  consumeSegments: 1,
  minFraction: 1,
  coolantConsume: 1,
};

/** The full stock-ish loadout, in module order. */
export const NOMAD_POWER_FIXTURE: readonly OccupantFixture[] = [
  NOMAD_REACTOR,
  NOMAD_COOLER,
  NOMAD_SHIELD_ACTIVE,
  NOMAD_SHIELD_PASSIVE,
  NOMAD_REPEATERS,
  NOMAD_THRUSTER,
  NOMAD_RADAR,
  NOMAD_LIFE_SUPPORT,
];

/** The occupant array `computePowerSheet` / `buildFoldPreview` take. */
export function nomadOccupants(
  over: readonly OccupantFixture[] = NOMAD_POWER_FIXTURE,
): SummaryOccupant[] {
  return over.map(fixtureOccupant);
}

/**
 * Ship-level whitelisted stats: hull HP / mass / armour / cargo / career, in
 * the shape the extractor writes them (schema 3, `career` stays the RAW loc
 * key — the page resolves it through the entity-string path).
 */
export const NOMAD_SHIP_STATS: Record<string, Record<string, unknown>> = {
  hull: { hp: 21500, mass: 78000 },
  armor: { armorHp: 0 },
  cargo: { cargoScu: 24 },
  vehicle: { career: '@vehicle_focus_Light_Freight' },
  // the whitelisted signature group the summary/KPI code reads
  SCItemVehicleSignatureParams: {
    'crossSection.x': 156,
    'crossSection.y': 88,
    'crossSection.z': 210,
  },
};

/** What the reactor funds — handy in specs and in the dev preview. */
export const NOMAD_BUDGET_SEGMENTS = 14;
