/**
 * The area tree's finer buckets (package C, 2026-11-06): what a player can
 * actually use, sorted into groups, and everything else out of the way.
 *
 * Items are grouped by `attach_type` with an ALLOWLIST: a type lands in a
 * player group only when it is named here. Everything not named — doors,
 * seats, displays, control panels, `NOITEM_*`, character-creator parts, ship
 * armour plates, storage props, and any type a future build adds — is "not
 * usable": hidden from the tree, the lists and the search unless the reader
 * turns it on in the settings (`CodexPrefsService.showNonUsable`).
 *
 * Personal armour (Char_Armor_*) has its own area (Rüstung); missiles, bombs
 * and ship modules hang under Schiffe.
 */

/**
 * Personal armour attach types — the same list as `FPS_ARMOR_ATTACH_TYPES` in
 * codex.service (a spec keeps them equal). Kept here as a literal because the
 * service imports this file: importing back would be a module cycle.
 */
const ARMOR_ATTACH_TYPES: readonly string[] = [
  'Char_Armor_Helmet', 'Char_Armor_Torso', 'Char_Armor_Arms', 'Char_Armor_Legs', 'Char_Armor_Undersuit', 'Char_Armor_Backpack',
];

export interface ItemGroup {
  id: string;
  attachTypes: readonly string[];
}

/** Player item groups under "Gegenstände", in tree order. */
export const ITEM_GROUPS: readonly ItemGroup[] = [
  { id: 'food', attachTypes: ['Food', 'Drink', 'Bottle'] },
  {
    id: 'clothing',
    attachTypes: [
      'Char_Clothing_Torso_0', 'Char_Clothing_Torso_1', 'Char_Clothing_Legs', 'Char_Clothing_Feet',
      'Char_Clothing_Hat', 'Char_Clothing_Hands', 'Char_Accessory_Eyes', 'Char_Accessory_Head', 'MobiGlas',
    ],
  },
  { id: 'medical', attachTypes: ['FPS_Consumable', 'Gadget', 'RemovableChip'] },
  { id: 'attachments', attachTypes: ['WeaponAttachment'] },
  { id: 'suits', attachTypes: ['Suit'] },
  { id: 'paints', attachTypes: ['Paints'] },
  { id: 'decor', attachTypes: ['Usable', 'Flair_Surface', 'Flair_Floor', 'Flair_Wall', 'Decal'] },
  { id: 'misc', attachTypes: ['Misc'] },
];

/** Item groups that hang under "Schiffe" instead (they belong to a ship). */
export const SHIP_ITEM_GROUPS: readonly ItemGroup[] = [
  { id: 'missiles', attachTypes: ['Missile', 'BombLauncher'] },
  { id: 'modules', attachTypes: ['Module', 'MiningModifier', 'ExternalFuelTank', 'Container'] },
];

/** The hidden bucket's id ("Nicht nutzbar"). */
export const NON_USABLE_GROUP = 'nonUsable';

/** Every attach type a player group, armour or a ship group names. */
export const USABLE_ITEM_ATTACH_TYPES: readonly string[] = [
  ...ITEM_GROUPS.flatMap((g) => g.attachTypes),
  ...SHIP_ITEM_GROUPS.flatMap((g) => g.attachTypes),
  ...ARMOR_ATTACH_TYPES,
];

/** Player groups only (what "Gegenstände" lists by default). */
export const PLAYER_ITEM_ATTACH_TYPES: readonly string[] = ITEM_GROUPS.flatMap((g) => g.attachTypes);

/** For the spec that keeps the armour list equal to the service's. */
export const TAXONOMY_ARMOR_ATTACH_TYPES = ARMOR_ATTACH_TYPES;

export function itemGroup(id: string): ItemGroup | null {
  return [...ITEM_GROUPS, ...SHIP_ITEM_GROUPS].find((g) => g.id === id) ?? null;
}

export function isItemGroupId(id: string): boolean {
  return id === NON_USABLE_GROUP || itemGroup(id) !== null;
}

/** True when an item's attach type is something a player can use. */
export function isUsableAttachType(attachType: string | null | undefined): boolean {
  return !!attachType && USABLE_ITEM_ATTACH_TYPES.includes(attachType);
}

/**
 * The attach-type scope of the item list for a group:
 * - a group id → exactly its types;
 * - `nonUsable` → everything no group names (NULLs included) — reachable only
 *   while the setting shows it;
 * - no group → the player groups. The hidden rest never mixes into them: with
 *   the setting on it is its own node at the end of the tree.
 */
export function itemGroupQuery(groupId: string): { attachTypeIn?: string[]; attachTypeNotIn?: string[] } {
  if (groupId === NON_USABLE_GROUP) return { attachTypeNotIn: [...USABLE_ITEM_ATTACH_TYPES] };
  const group = itemGroup(groupId);
  if (group) return { attachTypeIn: [...group.attachTypes] };
  return { attachTypeIn: [...PLAYER_ITEM_ATTACH_TYPES] };
}

/**
 * Ammunition: a vehicle round carries its weapon's size in the class name
 * (`BEHR_LaserCannon_S2_AMMO`), an on-foot round does not
 * (`behr_rifle_ballistic_02_ammo_civilian`, `12g_ballistic_1`).
 */
export const AMMO_GROUPS = ['fps', 'vehicle'] as const;
export type AmmoGroup = (typeof AMMO_GROUPS)[number];
export const VEHICLE_AMMO_PATTERN = '_S[0-9]+_';

export function isAmmoGroup(v: string): v is AmmoGroup {
  return (AMMO_GROUPS as readonly string[]).includes(v);
}

export function ammoGroupOf(className: string): AmmoGroup {
  return new RegExp(VEHICLE_AMMO_PATTERN, 'i').test(className) ? 'vehicle' : 'fps';
}

export function ammoGroupQuery(group: AmmoGroup | ''): { classNameMatch?: string; classNameNotMatch?: string } {
  if (group === 'vehicle') return { classNameMatch: VEHICLE_AMMO_PATTERN };
  if (group === 'fps') return { classNameNotMatch: VEHICLE_AMMO_PATTERN };
  return {};
}

/** Component kinds as tree children, in tree order (labels: codex.componentKind.*). */
export const COMPONENT_TREE_KINDS = [
  'Shield', 'Cooler', 'PowerPlant', 'QuantumDrive', 'Thruster', 'FuelTank', 'FuelIntake', 'CargoGrid', 'Radar', 'Other',
] as const;
