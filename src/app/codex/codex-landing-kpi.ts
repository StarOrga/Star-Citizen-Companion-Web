// Codex landing — pure KPI derivation.
// -----------------------------------------------------------------------------
// Every number here is computed from data that already ships on the ship row
// (`payload.itemPorts` / `payload.defaultLoadout`, zero extra queries) or from
// ONE extra batch fetch of component/armor payloads (CodexService
// .getEntityPayloads / .resolveEntities). Framework-free so it is cheap to
// unit-test the two numbers most likely to regress: the empty-mount count and
// the shield total.
//
// HARD RULE (verified against production, see the landing redesign spec):
// ship `crew`, `cargoCapacity`, `mass` and the whole `flight` object are NULL
// for every ship in the current build — never derive a KPI from them. FPS
// weapons carry no `stats` object and personal armour carries no protection
// values — "Stealth/Rüstung/Waffengewalt" are NOT computable; render an
// honest gap marker instead (see `FPS_GAP_KPI_KEYS`).

import type { CodexKind } from './codex.service';
import { categorizePort } from './codex-format';
import type { ComponentPayload, ItemPort, LoadoutEntry, ShipPayload } from './codex.types';

export interface KpiRow {
  labelKey: string;
  value: string;
  /** Emphasised presentation (e.g. "3 unbestückte Aufhängungen") — not an error state. */
  warn?: boolean;
  /** True = an honest "no data" marker, never a fabricated number. */
  gap?: boolean;
  /** Optional a11y/title text for a gap marker explaining WHY the number doesn't exist. */
  gapTitleKey?: string;
}

const SIZE_SEP = ' · ';

/** `4` → `"S4"`; unknown size → `"S?"`. */
function sizeLabel(size: number | null): string {
  return size != null ? `S${size}` : 'S?';
}

/** Group a set of hardpoints by size into a compact summary: "1× S4 · 2× S3". */
export function groupPortsBySize(ports: { size: number | null }[]): string {
  if (ports.length === 0) return '0';
  const counts = new Map<number | 'unknown', number>();
  for (const p of ports) {
    const key = p.size ?? 'unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (typeof a[0] === 'number' && typeof b[0] === 'number') return b[0] - a[0];
      return typeof a[0] === 'number' ? -1 : 1;
    })
    .map(([size, count]) => `${count}× ${typeof size === 'number' ? sizeLabel(size) : sizeLabel(null)}`)
    .join(SIZE_SEP);
}

export interface ShipMountAnalysis {
  ports: ItemPort[];
  loadout: LoadoutEntry[];
  loadoutByPort: Map<string, LoadoutEntry>;
  weaponPorts: ItemPort[];
  missilePorts: ItemPort[];
  quantumPort: ItemPort | null;
  /** Weapon-category ports with no fitted item — the single most actionable KPI. */
  emptyWeaponPorts: ItemPort[];
}

/** Pure structural analysis of a ship's hardpoints + default loadout. */
export function analyzeShipMounts(payload: ShipPayload | null | undefined): ShipMountAnalysis {
  const ports = payload?.itemPorts ?? [];
  const loadout = payload?.defaultLoadout ?? [];
  const loadoutByPort = new Map<string, LoadoutEntry>();
  for (const entry of loadout) {
    if (entry.itemPortName) loadoutByPort.set(entry.itemPortName, entry);
  }
  const weaponPorts = ports.filter((p) => categorizePort(p.types, p.portName) === 'weapons');
  const missilePorts = ports.filter((p) => categorizePort(p.types, p.portName) === 'missiles');
  const quantumPort = ports.find((p) => p.types.includes('QuantumDrive')) ?? null;
  const emptyWeaponPorts = weaponPorts.filter((p) => {
    const entry = p.portName ? loadoutByPort.get(p.portName) : undefined;
    return !entry?.entityClassName;
  });
  return { ports, loadout, loadoutByPort, weaponPorts, missilePorts, quantumPort, emptyWeaponPorts };
}

export interface EntityPayloadEntry {
  kind: CodexKind;
  payload: unknown;
}

/**
 * Ship KPI budget (max 7, all derived from mount structure + one optional
 * component-payload batch): Schildsumme, unbestückte Aufhängungen (the most
 * actionable number — surfaced first among the weapon-mount rows),
 * Waffenaufhängungen, Raketenkapazität, Quantum-Antrieb, Bestückungsgrad.
 * `componentPayloads` may be an empty map (best-effort fetch failed) — the
 * function degrades to the KPIs that don't need it rather than throwing.
 */
export function computeShipKpis(
  shipPayload: unknown,
  componentPayloads: ReadonlyMap<string, EntityPayloadEntry>,
): KpiRow[] {
  const payload = shipPayload as ShipPayload | null | undefined;
  if (!payload) return [];
  const rows: KpiRow[] = [];
  const { weaponPorts, missilePorts, quantumPort, emptyWeaponPorts, loadoutByPort, loadout } =
    analyzeShipMounts(payload);

  // Schildsumme — Σ MaxShieldHealth of fitted shield generators.
  let shieldSum = 0;
  let shieldFound = false;
  for (const entry of loadout) {
    if (!entry.entityClassName) continue;
    const comp = componentPayloads.get(entry.entityClassName);
    if (!comp || comp.kind !== 'component') continue;
    const cp = comp.payload as ComponentPayload;
    if (cp.kind !== 'Shield') continue;
    const mh = cp.stats?.['SCItemShieldGeneratorParams']?.['MaxShieldHealth'];
    if (typeof mh === 'number' && Number.isFinite(mh)) {
      shieldSum += mh;
      shieldFound = true;
    }
  }
  if (shieldFound) {
    rows.push({ labelKey: 'codex.landing.kpi.ship.shieldTotal', value: `${formatWhole(shieldSum)} HP` });
  }

  if (weaponPorts.length > 0) {
    // Unbestückte Aufhängungen — the most actionable number on the page.
    rows.push({
      labelKey: 'codex.landing.kpi.ship.emptyMounts',
      value: groupPortsBySize(emptyWeaponPorts.map((p) => ({ size: p.maxSize ?? p.minSize }))),
      warn: emptyWeaponPorts.length > 0,
    });
    rows.push({
      labelKey: 'codex.landing.kpi.ship.weaponMounts',
      value: groupPortsBySize(weaponPorts.map((p) => ({ size: p.maxSize ?? p.minSize }))),
    });
  }

  if (missilePorts.length > 0) {
    rows.push({
      labelKey: 'codex.landing.kpi.ship.missileCapacity',
      value: groupPortsBySize(missilePorts.map((p) => ({ size: p.maxSize ?? p.minSize }))),
    });
  }

  if (quantumPort?.portName) {
    const entry = loadoutByPort.get(quantumPort.portName);
    const cn = entry?.entityClassName;
    const comp = cn ? componentPayloads.get(cn) : undefined;
    if (comp) {
      const cp = comp.payload as ComponentPayload;
      const name = cleanText(cp.name?.en) || cleanText(cp.name?.de) || cn || '';
      const detail = [cp.size != null ? sizeLabel(cp.size) : '', cp.grade ? `Grad ${cp.grade}` : '']
        .filter(Boolean)
        .join(' · ');
      rows.push({
        labelKey: 'codex.landing.kpi.ship.quantumDrive',
        value: [name, detail].filter(Boolean).join(' — '),
      });
    }
  }

  // Bestückungsgrad — share of named ports still holding a stock item.
  const named = loadout.filter((e) => e.itemPortName);
  if (named.length > 0) {
    const filled = named.filter((e) => e.entityClassName).length;
    rows.push({
      labelKey: 'codex.landing.kpi.ship.fillRate',
      value: `${Math.round((filled / named.length) * 100)}%`,
    });
  }

  return rows.slice(0, 7);
}

function cleanText(v: string | undefined): string {
  const s = (v ?? '').trim();
  return s && !s.startsWith('@') ? s : '';
}

function formatWhole(v: number): string {
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ── on-foot (FPS) KPIs ────────────────────────────────────────────────────────

/** One of the six anatomical armour slots the paperdoll marks. */
export interface ArmorSlotSpec {
  /** `RoleLoadoutItem.slot` token used by hangar_role_loadouts (see ROLE_SLOT_SUGGESTIONS). */
  roleSlot: string;
  /** i18n key for the slot's human label ("Helm", "Torso", …). */
  labelKey: string;
  /** codex_items.attach_type for this slot (Char_Armor_*) — archive-depth lookup key. */
  attachType: string;
}

export const ARMOR_SLOT_SPECS: readonly ArmorSlotSpec[] = [
  { roleSlot: 'helmet', labelKey: 'codex.landing.paperdoll.helmet', attachType: 'Char_Armor_Helmet' },
  { roleSlot: 'core', labelKey: 'codex.landing.paperdoll.torso', attachType: 'Char_Armor_Torso' },
  { roleSlot: 'arms', labelKey: 'codex.landing.paperdoll.arms', attachType: 'Char_Armor_Arms' },
  { roleSlot: 'legs', labelKey: 'codex.landing.paperdoll.legs', attachType: 'Char_Armor_Legs' },
  { roleSlot: 'undersuit', labelKey: 'codex.landing.paperdoll.undersuit', attachType: 'Char_Armor_Undersuit' },
  { roleSlot: 'backpack', labelKey: 'codex.landing.paperdoll.backpack', attachType: 'Char_Armor_Backpack' },
] as const;

export interface ArmorSlotState extends ArmorSlotSpec {
  className: string | null;
}

/** Resolve the 6 anatomical slots against a role loadout's free-form item list. */
export function armorSlotsFromLoadout(
  items: readonly { slot: string; className: string | null }[],
): ArmorSlotState[] {
  const bySlot = new Map(items.map((i) => [i.slot, i.className]));
  return ARMOR_SLOT_SPECS.map((spec) => ({ ...spec, className: bySlot.get(spec.roleSlot) ?? null }));
}

export interface ResolvedArmorEntity {
  grade: string | null;
  manufacturerCode: string | null;
}

const WEIGHT_CLASS_RE = /(light|medium|heavy)/i;

// ── armour class — the ONLY honest protection signal this build carries ──────
//
// Verified against production 2026-09-01: `SCItemSuitArmorParams.DamageReduction`
// exists in 0 of 9.539 `Char_Armor_*` rows, and `damageResistance` is stored as
// an UNRESOLVED macro reference, exactly as p4k-format.md §56 warns. So there is
// no numeric protection value and there never was one — the old `gapArmor`
// marker was right for the wrong reason.
//
// What IS real is the macro's NAME, and it is a clean ordinal class:
//   Light 773 · Medium 575 · Heavy 560 · Undersuit 262 · HeavyArmorUtility 53
//   · CombatFlightsuit 42 · SuperHeavy 4 · Default 1
// Backpacks carry no armour params at all (0 of 540) — they resolve to null and
// must render as an honest gap, never as a guessed class.

export type ArmorClass =
  | 'light' | 'medium' | 'heavy' | 'superheavy'
  | 'undersuit' | 'flightsuit' | 'utility';

const ARMOR_CLASS_BY_MACRO: Readonly<Record<string, ArmorClass>> = {
  LightArmor: 'light',
  MediumArmor: 'medium',
  HeavyArmor: 'heavy',
  SuperHeavyArmor: 'superheavy',
  UndersuitArmor: 'undersuit',
  CombatFlightsuitArmor: 'flightsuit',
  HeavyArmorUtility: 'utility',
};

/**
 * Height of the "Gewicht" bar, 0..1 — the chosen encoding (concept iteration 6,
 * variant Ⓣ): the armour class is expressed by BAR HEIGHT, never by hue, so
 * colour is free to mean only "equipped vs. open".
 *
 * The three off-scale classes are deliberately NOT invented into the ramp:
 * undersuit and flightsuit sit at the light step, utility at the heavy step,
 * and both are additionally marked as off-scale by the caller.
 */
export const ARMOR_CLASS_WEIGHT: Readonly<Record<ArmorClass, number>> = {
  light: 0.28,
  medium: 0.55,
  heavy: 0.82,
  superheavy: 1,
  undersuit: 0.28,
  flightsuit: 0.28,
  utility: 0.82,
};

/** Classes that are a different KIND of piece, not a step on the light→heavy ramp. */
export const ARMOR_CLASS_OFF_SCALE: ReadonlySet<ArmorClass> = new Set<ArmorClass>([
  'undersuit',
  'flightsuit',
]);

/**
 * `DamageResistanceMacro.MediumArmor` → `'medium'`. Returns null when the piece
 * carries no armour params (every backpack) or an unknown macro — the caller
 * renders a gap, never a guess.
 */
export function armorClassFromPayload(payload: unknown): ArmorClass | null {
  const stats = (payload as { stats?: Record<string, Record<string, unknown>> } | null | undefined)
    ?.stats?.['SCItemSuitArmorParams'];
  const raw = stats?.['damageResistance._RecordName_'];
  if (typeof raw !== 'string') return null;
  const macro = raw.startsWith('DamageResistanceMacro.')
    ? raw.slice('DamageResistanceMacro.'.length)
    : raw;
  return ARMOR_CLASS_BY_MACRO[macro] ?? null;
}

// ── readiness — what the set actually carries, by real weapon class ──────────
//
// Verified 2026-09-01: personal gear has a clean sub_type taxonomy
// (Medium 1105 · Small 297 · Gadget 163 · Knife 140 · Grenade 74 · Large 57)
// plus `FPS_Consumable / Medical` (60) for medpens.
//
// There is deliberately NO mining/salvage/tractor entry: every `Mining*` and
// `Tractor` hit in the archive is a SHIP component (turrets, seats,
// `AEGS_Reclaimer_Salvage_Arm`), and a handheld multitool with attachments does
// not exist as a personal-item category in this build. A "mining ready ✓" mark
// would therefore be a fabricated claim.

export const READINESS_KEYS = [
  'primary', 'secondary', 'melee', 'throwable', 'gadget', 'medical',
] as const;
export type ReadinessKey = (typeof READINESS_KEYS)[number];

const READINESS_BY_WEAPON_SUBTYPE: Readonly<Record<string, ReadinessKey>> = {
  medium: 'primary',
  large: 'primary',
  small: 'secondary',
  knife: 'melee',
  grenade: 'throwable',
  gadget: 'gadget',
};

export interface ReadinessSlot {
  key: ReadinessKey;
  /** True = the set carries at least one piece of this class. */
  ok: boolean;
}

/**
 * Which of the six honest readiness classes the set covers. Pure: takes the
 * loadout's items plus the payload batch the zone already fetches.
 */
export function computeReadiness(
  items: readonly { className: string | null }[],
  payloads: ReadonlyMap<string, EntityPayloadEntry>,
): ReadinessSlot[] {
  const hit = new Set<ReadinessKey>();
  for (const item of items) {
    if (!item.className) continue;
    const entry = payloads.get(item.className);
    if (!entry) continue;
    const subType = (entry.payload as { subType?: string | null } | null)?.subType ?? null;
    if (!subType) continue;
    const key = subType.toLowerCase();
    if (entry.kind === 'weapon') {
      const mapped = READINESS_BY_WEAPON_SUBTYPE[key];
      if (mapped) hit.add(mapped);
    } else if (entry.kind === 'item' && key === 'medical') {
      hit.add('medical');
    }
  }
  return READINESS_KEYS.map((key) => ({ key, ok: hit.has(key) }));
}

/**
 * On-foot KPI budget (max 7): Belegte Slots, Grad-Mix, Gewichtsklasse,
 * Hersteller, Archivtiefe (for the still-empty slots), plus two HONEST GAP
 * markers where the owner's requested Stealth/Rüstung/Waffengewalt numbers
 * would sit — armour carries no protection stat block and FPS weapons carry
 * no `stats` object at all in this build, so those are never fabricated.
 */
export function computeFpsKpis(
  slots: readonly ArmorSlotState[],
  resolved: ReadonlyMap<string, ResolvedArmorEntity>,
  archiveDepth: ReadonlyMap<string, number>,
): KpiRow[] {
  const filled = slots.filter((s) => s.className);
  const empty = slots.filter((s) => !s.className);
  const rows: KpiRow[] = [
    {
      labelKey: 'codex.landing.kpi.fps.slotsFilled',
      value: `${filled.length} / ${slots.length}`,
    },
  ];

  const grades = new Set(
    filled.map((s) => resolved.get(s.className!)?.grade).filter((g): g is string => !!g),
  );
  if (grades.size > 0) {
    rows.push({ labelKey: 'codex.landing.kpi.fps.gradeMix', value: [...grades].sort().join('/') });
  }

  const weightHits = filled
    .map((s) => s.className!.match(WEIGHT_CLASS_RE)?.[1]?.toLowerCase())
    .filter((w): w is string => !!w);
  if (weightHits.length > 0) {
    const distinct = new Set(weightHits);
    rows.push({
      labelKey: 'codex.landing.kpi.fps.weightClass',
      value:
        distinct.size === 1
          ? distinct.values().next().value!
          : [...distinct].sort().join('/'),
    });
  }

  const mfrs = new Set(
    filled.map((s) => resolved.get(s.className!)?.manufacturerCode).filter((m): m is string => !!m),
  );
  if (mfrs.size > 0) {
    rows.push({ labelKey: 'codex.landing.kpi.fps.manufacturer', value: [...mfrs].sort().join(' / ') });
  }

  if (empty.length > 0) {
    const depthStr = empty
      .map((s) => {
        const n = archiveDepth.get(s.attachType);
        return n != null ? `${formatWhole(n)}` : null;
      })
      .filter((v): v is string => v != null);
    if (depthStr.length > 0) {
      rows.push({ labelKey: 'codex.landing.kpi.fps.archiveDepth', value: depthStr.join(SIZE_SEP) });
    }
  }

  rows.push(
    { labelKey: 'codex.landing.kpi.fps.gapArmor', value: '—', gap: true, gapTitleKey: 'codex.landing.kpi.fps.gapArmorTitle' },
    { labelKey: 'codex.landing.kpi.fps.gapWeapon', value: '—', gap: true, gapTitleKey: 'codex.landing.kpi.fps.gapWeaponTitle' },
  );

  return rows.slice(0, 7);
}

// ── "recently touched" ordering (no last_opened_at yet) ─────────────────────

/**
 * TODO(codex-landing): "die letzten drei angeklickten" needs a
 * `last_opened_at` (or equivalent) on hangar_ship_configs /
 * hangar_role_loadouts — it does not exist yet and adding it is a schema
 * change out of scope for this pass. Until then this sorts by the most
 * recent timestamp that DOES exist (`updatedAt`) — i.e. "zuletzt geändert"
 * rather than "zuletzt geöffnet", kept behind this one helper so the swap to
 * real open-tracking is a one-line change later.
 */
export function sortByRecency<T extends { updatedAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
