// How a ship's modules are ordered on the detail page.
// -----------------------------------------------------------------------------
// The loadout used to be bucketed by the generic `HardpointCategory` the codex
// uses everywhere (weapons / missiles / defense / power / …). That reads fine
// for a single hardpoint but it answers the wrong question on a ship page: a
// pilot wants the things they can actually CHANGE first — guns and the mounts
// they sit in, remote turrets, missiles, pods, shields, power plant, quantum
// drive, radar, coolers, life support — and only then the fixed rest (thrusters,
// seats, controllers, doors …) that no loadout screen ever touches.
//
// This module is that taxonomy, as pure functions:
//   * `SHIP_MODULE_SECTION_ORDER` — the display order, configurable first.
//   * `classifyShipModule` — TOTAL: every hardpoint lands in exactly one
//     section, `structure` being the catch-all. Nothing may be dropped, or the
//     ship silently loses hardpoints from its own page.
//
// Classification reads the PORT NAME first and the occupant's type second. That
// order matters: a VariPuck gimbal and a remote turret are both `GunTurret`
// weapons in the extract, and only the port they bolt onto ("…_weapon_wing…"
// vs "…_remote_turret_…") says which one a pilot is looking at.

/** One block of the ship-modules view. `structure` is the non-configurable rest. */
export type ShipModuleSection =
  | 'weapons'
  | 'remoteTurrets'
  | 'missiles'
  | 'countermeasures'
  | 'pod'
  | 'shields'
  | 'powerPlants'
  | 'quantum'
  | 'radar'
  | 'coolers'
  | 'lifeSupport'
  | 'structure';

/**
 * The sections a pilot can actually configure, in the order the ship page
 * shows them (admin request 461288f9: "Waffen / Remote Turrets / Raketen /
 * POD / Schilde / Quantum Drive / Radar / Coolers / Life Support", with the
 * power plant — "Generator" in the same request — kept next to the shields).
 *
 * `countermeasures` sits directly after `missiles` (admin request 1add86a4):
 * decoy and noise launchers used to be folded into the missile block, where
 * they read as ordnance a pilot cannot pick. They are their own choice, so they
 * get their own block right below the racks they defend against.
 */
export const CONFIGURABLE_SHIP_SECTIONS: readonly ShipModuleSection[] = [
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
] as const;

/** Full display order — configurable blocks first, the fixed rest last. */
export const SHIP_MODULE_SECTION_ORDER: readonly ShipModuleSection[] = [
  ...CONFIGURABLE_SHIP_SECTIONS,
  'structure',
] as const;

/** True for the sections a pilot can swap items in. */
export function isConfigurableSection(section: ShipModuleSection): boolean {
  return section !== 'structure';
}

/**
 * Sections where every hardpoint is its OWN decision and must therefore keep
 * its own row (admin request 1add86a4: "Nomad hat insgesamt 3 Plätze … hier
 * müssten 3 Stück einzeln auswählbar sein").
 *
 * Collapsing identical occupants is right for twelve manoeuvring thrusters and
 * for a bank of identical guns — but a shield bank of "2× S1 Sechs Shield"
 * hides that those are two independently swappable generators, and a decoy plus
 * a noise launcher are never interchangeable. Both blocks list every slot.
 */
const INDIVIDUAL_SHIP_SECTIONS: ReadonlySet<ShipModuleSection> = new Set([
  'shields',
  'countermeasures',
]);

/** True when a block must list every hardpoint separately (never collapse). */
export function isIndividualSection(section: ShipModuleSection): boolean {
  return INDIVIDUAL_SHIP_SECTIONS.has(section);
}

/** What we know about the thing installed on a hardpoint (all optional). */
export interface ShipModuleOccupant {
  /** `weapon` | `component` | `item` — the codex entity kind. */
  entityKind?: string | null;
  /** `ComponentPayload.kind` (Shield, Cooler, QuantumDrive, …). */
  componentKind?: string | null;
  /** `subType` of a weapon/item (Gun, GunTurret, MissileRack, …). */
  subType?: string | null;
  /** `attachType` — what the item bolts onto (Radar, LifeSupportGenerator, …). */
  attachType?: string | null;
}

// Furniture and control modules that merely CONTAIN a matching keyword. Checked
// before everything else so "hardpoint_turret_seataccess" (the ladder into the
// turret) never shows up as a turret, and "hardpoint_controller_weapon" (the
// fire-group module) never shows up as armament.
// NOTE: only `weapon_rack` is structural — a bare `_rack_` would swallow
// `hardpoint_missile_rack_right`, which is real armament.
const STRUCTURAL_PORT =
  /seat|access|console|cabinet|locker|weapon_?rack|door|light|ladder|interior|dashboard|flair|paint|decal|(^|_)cap(_|$)|(^|_)controller(_|$)/i;

/**
 * The ship's SHIELD CONTROL module (`hardpoint_controller_shield`, occupied by
 * `Controller_Shield_<Hull>` with `attachType: ShieldController`).
 *
 * It is a controller, so `STRUCTURAL_PORT` used to bury it in the fixed block —
 * yet it is the one shield-side module that is not a generator, and a pilot
 * counting their shield slots needs to tell the two apart (admin request
 * 1add86a4). The fire-group module `hardpoint_controller_weapon` deliberately
 * stays structural: it holds nothing and offers no choice.
 */
const SHIELD_CONTROL_PORT = /controller[_a-z]*shield|shield[_a-z]*controller/i;
const SHIELD_CONTROL_TYPE = /^shieldcontroller$/i;

/**
 * True for the shield CONTROL module rather than a shield generator. The ship
 * page tags that row separately so "3 generator bays + 1 control module" can
 * never be misread as four interchangeable shields.
 */
export function isShieldControlPort(
  portName: string | null | undefined,
  occupant?: ShipModuleOccupant | null,
): boolean {
  if (portName && SHIELD_CONTROL_PORT.test(portName)) return true;
  return !!occupant?.attachType && SHIELD_CONTROL_TYPE.test(occupant.attachType.trim());
}

// Port-name rules, in priority order. First match wins, so the more specific
// pattern has to come first ("…_weapon_missilerack_…" is a missile rack).
const PORT_SECTION_RULES: readonly [RegExp, ShipModuleSection][] = [
  // Countermeasures before ordnance: `hardpoint_countermeasure_launcher_left`
  // and `…_cml_…` carry launcher wording that the missile rule would swallow.
  [
    /countermeasure|(^|_)cml(_|$)|(^|_)decoy(_|$)|(^|_)chaff(_|$)|(^|_)flare(_|$)|(^|_)noise(_|$)/i,
    'countermeasures',
  ],
  [/missile|rocket|bomb|torpedo/i, 'missiles'],
  [/remote_?turret|(^|_)turret/i, 'remoteTurrets'],
  [/(^|_)pod(_|$)|_pod_|pod_\d|escape_?pod/i, 'pod'],
  [/shield/i, 'shields'],
  [/power_?plant|(^|_)powr(_|$)|generator/i, 'powerPlants'],
  [/quantum/i, 'quantum'],
  [/radar|scanner|(^|_)ping(_|$)/i, 'radar'],
  [/cooler/i, 'coolers'],
  [/life_?support/i, 'lifeSupport'],
  [/weapon|(^|_)gun|gimbal/i, 'weapons'],
];

// Occupant-type rules — the fallback when the port name says nothing useful
// (a hardpoint called `hardpoint_class_2` still identifies itself through what
// is bolted into it).
const TYPE_SECTION: Readonly<Record<string, ShipModuleSection>> = {
  // weapons + mounts
  gun: 'weapons',
  weapongun: 'weapons',
  nosemounted: 'weapons',
  weaponmount: 'weapons',
  // turrets
  gunturret: 'remoteTurrets',
  ballturret: 'remoteTurrets',
  mannedturret: 'remoteTurrets',
  pdcturret: 'remoteTurrets',
  topturret: 'remoteTurrets',
  bottomturret: 'remoteTurrets',
  canardturret: 'remoteTurrets',
  turret: 'remoteTurrets',
  turretbase: 'remoteTurrets',
  // ordnance
  missile: 'missiles',
  missilerack: 'missiles',
  missilelauncher: 'missiles',
  missileturret: 'missiles',
  bomblauncher: 'missiles',
  rocket: 'missiles',
  // decoy / noise launchers — `WeaponDefensive` is their attachType in 4.9.0
  countermeasurelauncher: 'countermeasures',
  weapondefensive: 'countermeasures',
  // the rest
  shield: 'shields',
  shieldgenerator: 'shields',
  shieldcontroller: 'shields',
  powerplant: 'powerPlants',
  quantumdrive: 'quantum',
  quantumfueltank: 'quantum',
  jumpdrive: 'quantum',
  radar: 'radar',
  scanner: 'radar',
  cooler: 'coolers',
  lifesupportgenerator: 'lifeSupport',
  lifesupporttank: 'lifeSupport',
};

// Engine placeholders that identify nothing — never let them win a lookup.
const PLACEHOLDER_TYPE = new Set(['undefined', 'unknown', 'none', 'other', '']);

function fromType(raw: string | null | undefined): ShipModuleSection | null {
  const key = (raw ?? '').trim().toLowerCase();
  if (PLACEHOLDER_TYPE.has(key)) return null;
  return TYPE_SECTION[key] ?? null;
}

/**
 * Which block a hardpoint belongs to. Total by construction: an unrecognised
 * port with an unrecognised occupant is `structure`, never dropped.
 */
export function classifyShipModule(
  portName: string | null | undefined,
  occupant?: ShipModuleOccupant | null,
): ShipModuleSection {
  const port = portName ?? '';
  // The shield control module is a `controller`, so it has to be pulled out
  // before the furniture rule buries it in the fixed block (1add86a4).
  if (isShieldControlPort(port, occupant)) return 'shields';
  // Furniture first — it is the only rule allowed to beat the occupant's type,
  // because a turret SEAT genuinely is not a turret.
  if (port && STRUCTURAL_PORT.test(port)) return 'structure';
  if (port) {
    for (const [re, section] of PORT_SECTION_RULES) {
      if (re.test(port)) return section;
    }
  }
  if (occupant) {
    const byKind = fromType(occupant.componentKind);
    if (byKind) return byKind;
    const bySub = fromType(occupant.subType);
    if (bySub) return bySub;
    const byAttach = fromType(occupant.attachType);
    if (byAttach) return byAttach;
  }
  return 'structure';
}

// Purely POSITIONAL tail words: they say where a hardpoint sits, never what it
// is. `hardpoint_shield_generator_01`, `_02` and `_03` are the same kind of bay
// in three places; `hardpoint_weapon_top_left` / `_top_right` / `_bottom` are
// one gun mount in three places.
const POSITIONAL_SUFFIX =
  /_(\d+|left|right|l|r|top|bot|bottom|up|upper|down|lower|front|fwd|forward|rear|back|aft|mid|middle|centre|center|inner|outer|port|starboard|wing|nose|tail|main|aux|a|b)$/i;

/**
 * The family a hardpoint belongs to — its name with every positional tail word
 * removed. Two ports share a family when they are the same bay in different
 * places, which is what lets an EMPTY slot borrow "what fits here" from an
 * identical, occupied sibling on the same hull (admin request 1add86a4: the
 * Nomad's unfitted `hardpoint_shield_generator_01` next to the fitted `_02`
 * and `_03`).
 *
 * Never strips the whole name: a port called just `left` keeps its own family.
 */
export function shipPortFamily(portName: string | null | undefined): string {
  let name = (portName ?? '').trim().toLowerCase();
  if (!name) return '';
  for (;;) {
    const next = name.replace(POSITIONAL_SUFFIX, '');
    if (next === name || next === '' || next === 'hardpoint') return name;
    name = next;
  }
}

/**
 * Group anything carrying a port name into sections, preserving input order
 * inside each block and emitting the blocks in display order. Sections without
 * a single hardpoint are omitted — an empty "Coolers" card says nothing.
 */
export function groupByShipSection<T>(
  rows: readonly T[],
  sectionOf: (row: T) => ShipModuleSection,
): { section: ShipModuleSection; rows: T[] }[] {
  const buckets = new Map<ShipModuleSection, T[]>();
  for (const row of rows) {
    const section = sectionOf(row);
    const hit = buckets.get(section);
    if (hit) hit.push(row);
    else buckets.set(section, [row]);
  }
  return SHIP_MODULE_SECTION_ORDER.filter((s) => buckets.has(s)).map((section) => ({
    section,
    rows: buckets.get(section)!,
  }));
}
