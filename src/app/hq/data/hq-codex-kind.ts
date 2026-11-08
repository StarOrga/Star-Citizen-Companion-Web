import { type ShipRole, shipRoleOf } from '../../codex/codex-ship-filters';
import { WEAPON_SUPER_GROUPS } from '../../codex/codex-weapon-taxonomy';
import type { HqCodexKindRow } from './hq-db.types';

/** Armour slots in display order (the Rüstung sub-filter of the Bestand). */
export const ARMOR_SUBS = ['helmet', 'torso', 'arms', 'legs', 'undersuit', 'backpack'] as const;
export type ArmorSub = (typeof ARMOR_SUBS)[number];

/** Personal-weapon sub-kinds in display order (ids of the Codex taxonomy: sidearm = Pistole, melee = Nahkampf ...). */
export const WEAPON_SUBS = ['sidearm', 'primary', 'heavy', 'melee', 'throwable', 'gadget', 'other'] as const;
export type WeaponSub = (typeof WEAPON_SUBS)[number];

/** The lane a class belongs to in the Bestand, from the Codex. `other` = not found in the Codex or nothing the lanes name. */
export type BestandArea = 'weapons' | 'armor' | 'ship' | 'other';

export interface BestandKind {
  area: BestandArea;
  /** ArmorSub for armor, WeaponSub for weapons, null otherwise. */
  sub: ArmorSub | WeaponSub | null;
  /** Ships only: the RSI-matrix role (combat, transport, exploration, industrial ...), null when unknown. */
  role: ShipRole | null;
}

const NONE: BestandKind = { area: 'other', sub: null, role: null };

const ARMOR_BY_ATTACH: Readonly<Record<string, ArmorSub>> = {
  Char_Armor_Helmet: 'helmet',
  Char_Armor_Torso: 'torso',
  Char_Armor_Arms: 'arms',
  Char_Armor_Legs: 'legs',
  Char_Armor_Undersuit: 'undersuit',
  Char_Armor_Backpack: 'backpack',
};

/**
 * Lane, sub-kind and ship role of a Codex row (`hq_codex_kinds`). Personal weapons (`weapon_class` FPS) split by the
 * Codex carry class through the taxonomy's own sub-groups, so the Bestand and the Codex never disagree; ship
 * weapons and everything the Codex does not name land in `other`. A null row (class not in the Codex) is `other`.
 */
export function bestandKindOf(row: HqCodexKindRow | null | undefined): BestandKind {
  if (!row) return NONE;
  if (row.entity === 'ship') return { area: 'ship', sub: null, role: shipRoleOf(row.career) ?? shipRoleOf(row.role) };
  if (row.entity === 'weapon') {
    if (row.weapon_class !== 'FPS') return NONE;
    const fps = WEAPON_SUPER_GROUPS.find((g) => g.id === 'fps');
    const hit = fps?.subGroups.find((s) => !s.rest && row.sub_type !== null && s.values.includes(row.sub_type));
    return { area: 'weapons', sub: ((hit?.id ?? 'other') as WeaponSub), role: null };
  }
  const armor = row.attach_type ? ARMOR_BY_ATTACH[row.attach_type] : undefined;
  return armor ? { area: 'armor', sub: armor, role: null } : NONE;
}

/** Maps a batch of `hq_codex_kinds` rows by class name (lower-cased, as inventory class names are matched). */
export function kindsByClass(rows: readonly HqCodexKindRow[]): Map<string, BestandKind> {
  return new Map(rows.map((r) => [r.class_name.toLowerCase(), bestandKindOf(r)]));
}
