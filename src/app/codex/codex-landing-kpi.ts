// Codex on-foot sets — pure derivation for the AN BORD panel and the FPS archive.
// -----------------------------------------------------------------------------
// The six anatomical armour positions, the armour class, the readiness classes
// and the recency ordering of sets. Framework-free, so the parts most likely to
// regress stay cheap to unit-test.
//
// HARD RULE (verified against production): personal armour carries no
// protection VALUES — the armour class (damageResistance macro) is the one
// honest signal, so nothing here invents stealth/armour/firepower numbers.
// (The ship and FPS KPI rows of the old landing lived here too; unused since
// the 2026-09-20 landing redesign, removed in the archive audit 2026-09-25.)

import type { CodexKind } from './codex.service';
import { ROLE_SLOT_SUGGESTIONS, RoleLoadoutRole } from '../hangar/hangar.types';

export interface EntityPayloadEntry {
  kind: CodexKind;
  payload: unknown;
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

/**
 * Reverse of `ARMOR_SLOT_SPECS`: which role slot a `Char_Armor_*` attach_type
 * belongs in. The equip control on /codex/fps needs this to know that a helmet
 * can only ever go into `helmet` — an armour piece has exactly one home, so the
 * user is never asked to pick one.
 */
export function roleSlotForAttachType(attachType: string | null | undefined): string | null {
  if (!attachType) return null;
  return ARMOR_SLOT_SPECS.find((s) => s.attachType === attachType)?.roleSlot ?? null;
}

/** Resolve the 6 anatomical slots against a role loadout's free-form item list. */
export function armorSlotsFromLoadout(
  items: readonly { slot: string; className: string | null }[],
): ArmorSlotState[] {
  const bySlot = new Map(items.map((i) => [i.slot, i.className]));
  return ARMOR_SLOT_SPECS.map((spec) => ({ ...spec, className: bySlot.get(spec.roleSlot) ?? null }));
}

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
// There is deliberately NO mining/salvage/tractor entry. The handheld tools do
// exist as FPS weapons of sub-type `Gadget` (Pyro RYT multi-tool with its
// `_default_mining` / `_default_salvage_repair` / `_default_tractorbeam`
// records, MaxLift tractor beams, Cambio SRT — re-checked 2026-09-25), so they
// count as `gadget`; a separate "mining ready ✓" per attachment would still
// claim more than the record says.
//
// The one exception to "classify by sub-type": the ParaMed medical device
// (`crlf_medgun_01`) is sub-type Small like a pistol, but it heals — it marks
// `medical`, never `secondary`.

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
 * The readiness classes a piece in each set position can light — the same
 * fitting `slotAccepts` enforces: a sidearm is a Small gun (secondary), the
 * multi-tool and its attachments, tractor beams and the Cambio are Gadgets.
 * Armour positions and the medpen (no archive source) light nothing.
 */
export const READINESS_BY_SLOT: Readonly<Record<string, readonly ReadinessKey[]>> = {
  primary: ['primary'],
  secondary: ['primary', 'secondary'],
  sidearm: ['secondary'],
  melee: ['melee'],
  throwable: ['throwable'],
  multitool: ['gadget'],
  'mining-attachment': ['gadget'],
  'salvage-attachment': ['gadget'],
  'repair-attachment': ['gadget'],
  tractor: ['gadget'],
  gadget: ['gadget'],
  medgun: ['medical'],
};

/**
 * The readiness classes a set of this role can show at all — those some
 * position of the role takes a piece for. A glyph no position can ever light
 * says nothing: after the honest slot fitting, fps sets carried four of them
 * (harden scan 2026-09-25).
 */
export function readinessKeysFor(role: RoleLoadoutRole): ReadinessKey[] {
  const holdable = new Set((ROLE_SLOT_SUGGESTIONS[role] ?? []).flatMap((slot) => READINESS_BY_SLOT[slot] ?? []));
  return READINESS_KEYS.filter((key) => holdable.has(key));
}

/**
 * Which of the six honest readiness classes the set covers. Pure: takes the
 * loadout's items plus the payload batch the zone already fetches. With a
 * `role`, only that role's classes (`readinessKeysFor`) come back — plus any
 * class a piece already lights anyway (a free-form slot of the retired editor).
 */
export function computeReadiness(
  items: readonly { className: string | null }[],
  payloads: ReadonlyMap<string, EntityPayloadEntry>,
  role?: RoleLoadoutRole,
): ReadinessSlot[] {
  const hit = new Set<ReadinessKey>();
  for (const item of items) {
    if (!item.className) continue;
    const entry = payloads.get(item.className);
    if (!entry) continue;
    const subType = (entry.payload as { subType?: string | null } | null)?.subType ?? null;
    if (!subType) continue;
    const key = subType.toLowerCase();
    if (entry.kind === 'weapon' && item.className.toLowerCase().includes('medgun')) {
      hit.add('medical');
    } else if (entry.kind === 'weapon') {
      const mapped = READINESS_BY_WEAPON_SUBTYPE[key];
      if (mapped) hit.add(mapped);
    } else if (entry.kind === 'item' && key === 'medical') {
      hit.add('medical');
    }
  }
  const shown = role ? new Set(readinessKeysFor(role)) : null;
  return READINESS_KEYS.filter((key) => !shown || shown.has(key) || hit.has(key)).map((key) => ({
    key,
    ok: hit.has(key),
  }));
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
/**
 * Move the URL-named personal set to the front, leaving the rest in their
 * order. Position 0 IS the active set for the AN BORD zone, so reordering is
 * how `?set=<id>` selects one. An id that no longer resolves (deleted set,
 * stale bookmark from the retired `/hangar/loadout/:id` editor) changes
 * nothing — the list stays as it was rather than rendering an empty zone.
 */
export function withSelectedFirst<T extends { id: string }>(
  loadouts: readonly T[],
  selectedId: string | null,
): T[] {
  if (!selectedId) return [...loadouts];
  const i = loadouts.findIndex((l) => l.id === selectedId);
  if (i <= 0) return [...loadouts];
  return [loadouts[i], ...loadouts.filter((_, n) => n !== i)];
}

export function sortByRecency<T extends { updatedAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
