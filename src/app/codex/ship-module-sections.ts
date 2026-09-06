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
 */
export const CONFIGURABLE_SHIP_SECTIONS: readonly ShipModuleSection[] = [
  'weapons',
  'remoteTurrets',
  'missiles',
  'pod',
  'shields',
  'powerPlants',
  'quantum',
  'radar',
  'coolers',
  'lifeSupport',
] as const;

/**
 * Blocks that are shown but cannot be swapped, between the configurable ones
 * and the airframe.
 *
 * `countermeasures` used to live directly under `missiles` as its own choice
 * (admin request 1add86a4). It came back the other way round in 32659942 —
 * *"Gegenmaßnahme kann man aktuell nicht ändern somit weiter runter und als
 * kein Auswählbares Fenster anzeigen"*: the game gives no way to change a
 * decoy or noise launcher, so a picker on it promises something that does not
 * exist. The block keeps its own heading and its explanation, it just stops
 * pretending to be a decision and moves below the things that are.
 */
const READ_ONLY_SHIP_SECTIONS: readonly ShipModuleSection[] = ['countermeasures'] as const;

/** Full display order — configurable blocks first, then read-only, airframe last. */
export const SHIP_MODULE_SECTION_ORDER: readonly ShipModuleSection[] = [
  ...CONFIGURABLE_SHIP_SECTIONS,
  ...READ_ONLY_SHIP_SECTIONS,
  'structure',
] as const;

const CONFIGURABLE_SET: ReadonlySet<ShipModuleSection> = new Set(CONFIGURABLE_SHIP_SECTIONS);

/** True for the sections a pilot can swap items in. */
export function isConfigurableSection(section: ShipModuleSection): boolean {
  return CONFIGURABLE_SET.has(section);
}

/**
 * Sections where every hardpoint is its OWN decision and must therefore keep
 * its own row (admin request 1add86a4: "Nomad hat insgesamt 3 Plätze … hier
 * müssten 3 Stück einzeln auswählbar sein").
 *
 * Collapsing identical occupants is right for twelve manoeuvring thrusters and
 * for a bank of identical guns — but a shield bank of "2× S1 Sechs Shield"
 * hides that those are two independently swappable generators, and a decoy plus
 * a noise launcher are never interchangeable. All three blocks list every slot.
 *
 * `coolers` joined them in 32659942 (*"Coolers müssten 2 sein nicht nur eins!"*):
 * a hull's two identical coolers collapsed into a single "2× S1" row, and the
 * multiplier in the badge is much easier to miss than a second line. Every other
 * block can be split on demand — see the layout component's per-block toggle.
 */
const INDIVIDUAL_SHIP_SECTIONS: ReadonlySet<ShipModuleSection> = new Set([
  'shields',
  'countermeasures',
  'coolers',
]);

/** True when a block must list every hardpoint separately (never collapse). */
export function isIndividualSection(section: ShipModuleSection): boolean {
  return INDIVIDUAL_SHIP_SECTIONS.has(section);
}

// ── Display GROUPS ───────────────────────────────────────────────────────────
// The classification above is deliberately fine-grained: a cooler is not a
// radar and the draft, the power dock and the fold preview all need to tell
// them apart. The ship PAGE has a different constraint — the concept
// (`docs/concepts/codex-schiffsseite-ui-spec.md` §6/§7) draws the loadout as a
// single column of FOUR blocks, and eleven headings in that column read as a
// list of parts rather than as a set of decisions.
//
// So the page groups what the model still separates. `powerPlants`, `quantum`,
// `coolers`, `radar` and `lifeSupport` are one block, "Antrieb & Systeme", with
// the five sections kept as SUBGROUPS inside it — nothing is merged away, the
// nesting is purely presentational and every section keeps its own census,
// notes, split toggle and fold preview. Countermeasures and the airframe keep
// their own block, exactly as before.
//
// This is a mapping, not a second taxonomy: `shipModuleGroupOf` is total over
// `ShipModuleSection`, so a new section has to declare where it shows up.

/** One block in the loadout column — a group of one or more sections. */
export type ShipModuleGroup =
  | 'weapons'
  | 'remoteTurrets'
  | 'missiles'
  | 'pod'
  | 'shields'
  | 'systems'
  | 'countermeasures'
  | 'structure';

/** The sections the "Antrieb & Systeme" block carries, in display order. */
export const SYSTEMS_GROUP_SECTIONS: readonly ShipModuleSection[] = [
  'powerPlants',
  'quantum',
  'coolers',
  'radar',
  'lifeSupport',
] as const;

const SECTION_GROUP: Readonly<Record<ShipModuleSection, ShipModuleGroup>> = {
  weapons: 'weapons',
  remoteTurrets: 'remoteTurrets',
  missiles: 'missiles',
  pod: 'pod',
  shields: 'shields',
  powerPlants: 'systems',
  quantum: 'systems',
  coolers: 'systems',
  radar: 'systems',
  lifeSupport: 'systems',
  countermeasures: 'countermeasures',
  structure: 'structure',
};

/** Which block a section is rendered in. Total by construction. */
export function shipModuleGroupOf(section: ShipModuleSection): ShipModuleGroup {
  return SECTION_GROUP[section];
}

/** Groups that carry more than one section and therefore nest. */
export function isMergedShipModuleGroup(group: ShipModuleGroup): boolean {
  return group === 'systems';
}

/** i18n key for a group's heading — a merged group has its own name. */
export function shipModuleGroupLabelKey(group: ShipModuleGroup): string {
  return `codex.moduleSection.${group}`;
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
 * 1add86a4 pulled it OUT of the fixed block and tagged it inside the shield
 * block, so a pilot counting shield slots could tell generator from controller.
 * 32659942 sent it back: *"'Schild Controller' kann man ingame nichts von sehen
 * also da uninteressant!!!"* — it is neither visible nor swappable in game, and
 * a fourth row in a three-shield block costs more than it explains. It is
 * airframe now, so the block's count is the number of shields and nothing else.
 */
const SHIELD_CONTROL_PORT = /controller[_a-z]*shield|shield[_a-z]*controller/i;
const SHIELD_CONTROL_TYPE = /^shieldcontroller$/i;

/** True for the shield CONTROL module rather than a shield generator. */
export function isShieldControlPort(
  portName: string | null | undefined,
  occupant?: ShipModuleOccupant | null,
): boolean {
  if (portName && SHIELD_CONTROL_PORT.test(portName)) return true;
  return !!occupant?.attachType && SHIELD_CONTROL_TYPE.test(occupant.attachType.trim());
}

/**
 * The quantum drive's own fuel tank (`hardpoint_quantum_fuel_tank`, the
 * "Internal Tank" row). It reads as a second quantum choice next to the drive,
 * but no ship lets you change it — 32659942: *"Quantum Antrieb 'Internal Tank'
 * ist auch uninteressant kann man nicht Ändern"*. Filed as airframe so the
 * quantum block holds the one thing that IS a decision: the drive.
 */
const FIXED_TANK_PORT = /(quantum|hydrogen|internal)[_a-z]*(fuel_?)?tank|fuel_?tank/i;
const FIXED_TANK_TYPE = /^(quantumfueltank|hydrogenfueltank|fueltank)$/i;

/** True for a fuel tank hardpoint — present on the hull, never a pilot's choice. */
export function isFixedTankPort(
  portName: string | null | undefined,
  occupant?: ShipModuleOccupant | null,
): boolean {
  if (portName && FIXED_TANK_PORT.test(portName)) return true;
  const type = (occupant?.attachType ?? occupant?.componentKind ?? '').trim();
  return !!type && FIXED_TANK_TYPE.test(type);
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
  // Control module and internal tank are hull furniture, not choices (32659942).
  shieldcontroller: 'structure',
  powerplant: 'powerPlants',
  quantumdrive: 'quantum',
  quantumfueltank: 'structure',
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
  // Two modules that name a configurable block but are not one: the shield
  // CONTROL module and the quantum drive's internal tank. Both are checked
  // before the port rules, which would otherwise file them by their keyword
  // ("shield" → shields, "quantum" → quantum) — see 32659942.
  if (isShieldControlPort(port, occupant)) return 'structure';
  if (isFixedTankPort(port, occupant)) return 'structure';
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
